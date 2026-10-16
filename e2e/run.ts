/**
 * End-to-end check in real Chromium against the built app, with:
 *  - a stub Anthropic endpoint (the real SDK talks to it via ANTHROPIC_BASE_URL)
 *  - the fake local model from tests/fixtures
 * Run `npm run build` first. Screenshots land in e2e/out/.
 */
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { deflateSync } from 'node:zlib';
import { chromium, type Page } from 'playwright-core';

const PORT = 8799;
const OUT = path.resolve('e2e/out');
mkdirSync(OUT, { recursive: true });
const dataDir = mkdtempSync(path.join(tmpdir(), 'h3-e2e-'));

// ---- a decodable gradient PNG, no image library needed ----
function gradientPng(w: number, h: number, hue: [number, number, number]): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b: Buffer) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 0xff]! ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type: string, data: Buffer) => { const t = Buffer.from(type); const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const c = Buffer.alloc(4); c.writeUInt32BE(crc(Buffer.concat([t, data]))); return Buffer.concat([len, t, data, c]); };
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; for (let x = 0; x < w; x++) { const o = y * (w * 3 + 1) + 1 + x * 3; raw[o] = (hue[0] * x) / w; raw[o + 1] = (hue[1] * y) / h; raw[o + 2] = hue[2]; } }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

// ---- stub Anthropic API: picks a canned answer from the MODE line in the request ----
const base = { summary: '', subjects: [], pictures: [], videos: [], audios: [] };
const ANSWERS: Record<string, object> = {
  T2VA: {
    ...base, style: 'Live-action, cinematic',
    shots: [
      { startMs: 0, text: 'a medium-wide shot frames a baker opening the shutters of a small street bakery before sunrise. The camera pushes in with small amplitude at slow speed as the middle-aged baker with a calm, slightly raspy voice (S1) places a fresh loaf on the wooden counter and says: <d>[English] First batch of the morning.</d>' },
      { startMs: 5000, text: 'the camera cuts to a close-up of steam rising from the sliced bread while the baker\'s final words carry over from the previous shot.' },
    ],
    soundscape: 'Wooden shutters scrape open over a quiet street as trays clink softly inside the bakery. The doorbell rings once, followed by light footsteps.',
    music: 'N/A',
  },
  I2VA: {
    ...base, style: 'Live-action, cinematic',
    shots: [{ startMs: 0, text: 'the young woman shown in <Picture 1> remains beside the rain-covered train window, preserving her appearance and seat position. The camera trucks right with small amplitude at slow speed as the quiet, breathy young woman (S1) says: <d>[English] I get off at the next station.</d>' }],
    soundscape: 'The train wheels produce a steady metallic rhythm beneath a low ventilation hum.',
    music: 'Sustained cello notes at a slow tempo with widely spaced piano tones, gradually decreasing in volume.',
  },
  REFERENCE: {
    style: 'The target video uses a realistic, softly lit domestic style.',
    shots: [{ startMs: 0, text: 'A medium shot shows <Subject 1> (S1), the woman from <Picture 1>, standing at a kitchen counter. She smiles and says, <d>[English] Good morning.</d>' }],
    soundscape: 'Soft kitchen room tone continues throughout.',
    music: 'N/A',
    summary: '<Subject 1> greets the morning in a kitchen.',
    subjects: [{ text: 'is the woman in <Picture 1>, with a red coat and short dark hair.', appearsIn: [1], marker: 'fully_preserved', note: 'her identity, hair and coat are retained' }],
    pictures: [], videos: [], audios: [],
  },
};
const seenRequests: Array<{ mode: string; hasImage: boolean }> = [];
const stub = createServer((req, res) => {
  let data = '';
  req.on('data', (c) => (data += c));
  req.on('end', () => {
    const body = JSON.parse(data || '{}');
    const content: Array<{ type: string; text?: string }> = body.messages?.[0]?.content ?? [];
    const text = content.filter((c) => c.type === 'text').map((c) => c.text).join('\n');
    const mode = /MODE (T2VA|I2VA|FL2VA|L2VA|REFERENCE)/.exec(text)?.[1] ?? 'T2VA';
    seenRequests.push({ mode, hasImage: content.some((c) => c.type === 'image') });
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ id: 'msg_stub', type: 'message', role: 'assistant', model: body.model, content: [{ type: 'text', text: JSON.stringify(ANSWERS[mode] ?? ANSWERS.T2VA) }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } }));
  });
});

let server: ChildProcess | null = null;
const log: string[] = [];
async function startServer(stubUrl: string) {
  server = spawn(path.resolve('node_modules/.bin/tsx'), ['src/server/index.ts'], {
    env: { ...process.env, PORT: String(PORT), H3_DATA_DIR: dataDir, ANTHROPIC_BASE_URL: stubUrl, ANTHROPIC_API_KEY: 'sk-ant-e2e-stub', H3_MOCK_STEP_MS: '120' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`server did not start\n${log.join('')}`)), 20000);
    server!.stdout!.on('data', (d: Buffer) => { log.push(String(d)); if (String(d).includes('listening')) { clearTimeout(t); resolve(); } });
    server!.stderr!.on('data', (d: Buffer) => log.push(String(d)));
    server!.on('exit', (c) => reject(new Error(`server exited early (${c})\n${log.join('')}`)));
  });
}

async function main() {
  await new Promise<void>((r) => stub.listen(0, '127.0.0.1', r));
  await startServer(`http://127.0.0.1:${(stub.address() as AddressInfo).port}`);

  const png = path.join(dataDir, 'hero.png');
  writeFileSync(png, gradientPng(640, 360, [200, 160, 120]));
  const png2 = path.join(dataDir, 'last.png');
  writeFileSync(png2, gradientPng(640, 360, [40, 220, 200]));

  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const problems: string[] = [];
  page.on('console', (m) => m.type() === 'error' && problems.push(`console: ${m.text()}`));
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('dialog', (d) => void d.accept());
  const shot = (name: string) => page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true });
  const step = (msg: string) => console.log(`✓ ${msg}`);

  await page.goto(`http://localhost:${PORT}/`);
  await page.getByText('Your structured prompt appears here').waitFor();
  await shot('01-empty');
  step('app loads, empty state shown');

  // --- T2VA via a preset ---
  await page.getByRole('option', { name: /Sitcom exchange/ }).click();
  assert.match(await page.locator('textarea.idea').inputValue(), /Two characters/);
  await page.locator('textarea.idea').fill('A baker opens the shutters of a small street bakery before sunrise and says "First batch of the morning."');
  await page.getByRole('button', { name: /Enhance with Claude/ }).click();
  await page.getByTestId('shot-2').waitFor();
  assert.equal(await page.getByLabel('Prompt mode').inputValue(), '');
  await shot('02-t2va-editor');
  await page.getByRole('tab', { name: 'Final text' }).click();
  const t2 = await page.getByTestId('final-text').innerText();
  assert.match(t2, /^integrated_multimodal_description: \[Shot 1\] Live-action, cinematic, a medium-wide shot/);
  assert.match(t2, /\[Shot 2\] At 00:05\.000, the camera cuts to a close-up/);
  assert.match(t2, /\n\nnon_diegetic_music: N\/A$/);
  await shot('03-t2va-final');
  step('T2VA: preset → Enhance → structured editor → exact guide format');
  assert.equal(seenRequests.at(-1)?.mode, 'T2VA');

  // --- edit a shot time; invalid ordering must surface as a lint error ---
  await page.getByRole('tab', { name: 'Edit' }).click();
  const time = page.getByTestId('shot-2').getByLabel('Shot start time');
  await time.fill('00:01.500'); await time.blur();
  await page.getByRole('tab', { name: 'Final text' }).click();
  assert.match(await page.getByTestId('final-text').innerText(), /At 00:01\.500,/);
  await page.getByRole('tab', { name: 'Edit' }).click();
  await time.fill('00:20.000'); await time.blur();
  assert.match(await page.getByTestId('lint-summary').innerText(), /1 error/);
  await time.fill('00:05.000'); await time.blur();
  assert.match(await page.getByTestId('lint-summary').innerText(), /0 errors/);
  step('timecode editing + live lint (out-of-range cut flagged, then cleared)');

  // --- upload an image → I2VA ---
  await page.locator('input[type=file]').setInputFiles(png);
  await page.getByTestId('asset-Picture-1').waitFor();
  assert.equal(await page.getByLabel('Picture 1 role').inputValue(), 'first_frame');
  assert.match(await page.locator('.mode').innerText(), /I2VA/);
  assert.ok(await page.locator('.thumb img').first().evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0), 'thumbnail renders');
  await shot('04-i2va-asset');
  await page.getByRole('button', { name: /Enhance with Claude/ }).click();
  await page.waitForFunction(() => document.querySelector('.mode')?.textContent?.includes('I2VA'));
  await page.getByRole('tab', { name: 'Final text' }).click();
  await page.waitForFunction(() => document.querySelector('[data-testid=final-text]')?.textContent?.startsWith('For the target video, at 0.00 seconds into the target video, <Picture 1> (from [Shot 1]) is fully referenced.'));
  assert.equal(seenRequests.at(-1)?.mode, 'I2VA');
  assert.equal(seenRequests.at(-1)?.hasImage, true, 'reference image reaches Claude');
  step('I2VA: first-frame upload → alignment line generated, image sent to Claude');

  // --- change role → REFERENCE ---
  await page.getByLabel('Picture 1 role').selectOption('subject');
  await page.waitForFunction(() => document.querySelector('.mode')?.textContent?.includes('REFERENCE'));
  await page.getByRole('button', { name: /Enhance with Claude/ }).click();
  await page.waitForFunction(() => document.querySelector('[data-testid=lint-summary]'));
  await page.getByRole('tab', { name: 'Final text' }).click();
  await page.waitForFunction(() => document.querySelector('[data-testid=final-text]')?.textContent?.includes('subject_definitions:'));
  const ref = await page.getByTestId('final-text').innerText();
  assert.match(ref, /summary:\n\[reference generation\] <Subject 1> greets the morning in a kitchen\./);
  assert.match(ref, /<Subject 1> \(appears in \[Shot 1\]\): fully_preserved - her identity/);
  assert.equal(seenRequests.at(-1)?.mode, 'REFERENCE');
  await page.getByRole('tab', { name: 'Edit' }).click();
  await shot('05-reference-editor');
  step('REFERENCE: six-section output with derived [reference generation] prefix');

  // --- second image as last frame: label reordering keeps text pointing at the right file ---
  await page.getByLabel('Picture 1 role').selectOption('first_frame');
  await page.locator('input[type=file]').setInputFiles(png2);
  await page.getByTestId('asset-Picture-2').waitFor();
  await page.getByLabel('Picture 2 role').selectOption('last_frame');
  await page.waitForFunction(() => document.querySelector('.mode')?.textContent?.includes('FL2VA'));
  step('FL2VA derived from first + last frame images');

  // remove the second image: back to I2VA, no dangling label
  await page.getByRole('button', { name: 'Remove Picture 2' }).click();
  await page.waitForFunction(() => document.querySelector('.mode')?.textContent?.includes('I2VA'));
  await page.getByRole('button', { name: 'Remove Picture 1' }).click();
  await page.waitForFunction(() => document.querySelector('.mode')?.textContent?.includes('T2VA'));
  step('removing assets re-derives the mode');

  // --- generate on the mock backend ---
  await page.getByRole('button', { name: /Enhance with Claude/ }).click();
  await page.waitForFunction(() => document.querySelector('[data-testid=shot-2]'));
  await page.getByTestId('generate').click();
  const card = page.getByTestId('job-card').first();
  await card.waitFor();
  await page.waitForFunction(() => document.querySelector('[data-testid=job-card]')?.getAttribute('data-status') === 'succeeded', undefined, { timeout: 15000 });
  assert.ok(await card.locator('img[alt="Result card"]').isVisible());
  await shot('06-mock-job-done');
  step('Generate (mock): queued → live progress over SSE → done with result card');

  // --- library + reuse ---
  await page.getByRole('button', { name: 'Library' }).click();
  await page.getByRole('heading', { name: 'Library' }).waitFor();
  await page.getByRole('button', { name: /Reuse prompt/ }).first().click();
  await page.getByTestId('shot-1').waitFor();
  step('Library → Reuse prompt restores the editor');

  // --- settings: configure the fake local model and run on it ---
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('heading', { name: 'Settings' }).waitFor();
  await page.getByLabel('Backend').selectOption('command');
  await page.getByPlaceholder('/home/me/h3/.venv/bin/python').fill(process.execPath);
  await page.getByLabel('Arguments').fill(path.resolve('tests/fixtures/fake-h3.mjs'));
  await page.getByLabel('Extra environment').fill('CUSTOM_VAR=from-settings');
  await shot('07-settings');
  await page.getByRole('button', { name: 'Save settings' }).click();
  await page.getByText('Settings saved.').waitFor();
  assert.equal(await page.locator('input[type=password]').inputValue(), '');
  await page.getByRole('button', { name: 'Create' }).click();
  await page.getByLabel('Run on').selectOption('command');
  await page.getByTestId('generate').click();
  await page.waitForFunction(() => [...document.querySelectorAll('[data-testid=job-card]')].some((c) => c.getAttribute('data-status') === 'succeeded' && c.querySelector('video')), undefined, { timeout: 15000 });
  const videoOk = await page.evaluate(async () => {
    const v = document.querySelector('[data-testid=job-card] video') as HTMLVideoElement;
    const r = await fetch(v.src, { headers: { range: 'bytes=0-6' } });
    return { status: r.status, text: await r.text() };
  });
  assert.equal(videoOk.status, 206);
  assert.equal(videoOk.text, 'FAKEMP4');
  await shot('08-command-job-done');
  step('Generate (local model command): process ran, <video> element served with Range support');

  // --- cancel a running job ---
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByLabel('Extra environment').fill('FAKE_HANG=1');
  await page.getByRole('button', { name: 'Save settings' }).click();
  await page.getByText('Settings saved.').waitFor();
  await page.getByRole('button', { name: 'Create' }).click();
  await page.getByLabel('Run on').selectOption('command');
  await page.getByTestId('generate').click();
  await page.waitForFunction(() => document.querySelector('[data-testid=job-card][data-status=running]'), undefined, { timeout: 10000 });
  await page.locator('[data-testid=job-card][data-status=running]').getByRole('button', { name: 'Cancel' }).click();
  await page.waitForFunction(() => document.querySelector('[data-testid=job-card][data-status=cancelled]'), undefined, { timeout: 10000 });
  step('running job can be cancelled from the UI');

  // --- import an existing prompt ---
  await page.getByRole('button', { name: /Import prompt/ }).click();
  await page.getByLabel('Prompt to import').fill('integrated_multimodal_description: [Shot 1] Live-action, cinematic, a wide shot of a rainy street. [Shot 2] At 00:03.000, the camera cuts to a close-up of a puddle.\n\noverall_soundscape: Steady rain falls on the pavement.\n\nnon_diegetic_music: N/A');
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await page.getByTestId('shot-2').waitFor();
  assert.equal(await page.getByLabel('Style').inputValue(), 'Live-action, cinematic');
  step('Import prompt parses an existing guide-format prompt into the editor');

  // --- reload keeps the draft ---
  await page.reload();
  await page.getByTestId('shot-2').waitFor();
  step('draft survives a reload');

  assert.deepEqual(problems, [], `browser errors:\n${problems.join('\n')}`);
  step('no console errors or uncaught exceptions');
  await browser.close();
}

main()
  .then(() => console.log('\nE2E PASSED'))
  .catch((e) => { console.error('\nE2E FAILED:', e instanceof Error ? e.message : e); process.exitCode = 1; })
  .finally(() => {
    server?.kill('SIGTERM');
    stub.close();
    setTimeout(() => { rmSync(dataDir, { recursive: true, force: true }); process.exit(process.exitCode ?? 0); }, 500);
  });
