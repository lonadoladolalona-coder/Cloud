// Stand-in for a local video model, used by the tests. Follows the command-backend contract.
import { readFileSync, writeFileSync } from 'node:fs';

const job = JSON.parse(readFileSync(process.env.H3_JOB_JSON, 'utf8'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (process.env.FAKE_PID_FILE) writeFileSync(process.env.FAKE_PID_FILE, String(process.pid));
console.log('loading model…');
console.log('PROGRESS 25 warming up');
await sleep(Number(process.env.FAKE_SLEEP_MS ?? 20));
console.log(JSON.stringify({ progress: 0.6, message: 'sampling' }));

if (process.env.FAKE_HANG) await sleep(60_000);
if (process.env.FAKE_FAIL) {
  console.error('CUDA out of memory');
  process.exit(3);
}
if (!process.env.FAKE_NO_OUTPUT) {
  const summary = { prompt: job.prompt, assets: job.assets.map((a) => `${a.label}:${a.role}`), env: process.env.CUSTOM_VAR ?? null };
  writeFileSync(process.env.H3_OUTPUT, `FAKEMP4\n${JSON.stringify(summary)}`);
}
console.log('PROGRESS 100');
