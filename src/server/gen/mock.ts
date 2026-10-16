import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Backend } from './types';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Stand-in backend: simulates progress and writes a poster card, so the whole app can be exercised without a model. */
export function createMockBackend(stepMs = Number(process.env.H3_MOCK_STEP_MS ?? 400)): Backend {
  return {
    async run(ctx) {
      const steps = 8;
      for (let i = 1; i <= steps; i++) {
        await new Promise((resolve, reject) => {
          const t = setTimeout(resolve, stepMs);
          ctx.signal.addEventListener('abort', () => { clearTimeout(t); reject(new Error('cancelled')); }, { once: true });
        });
        ctx.progress(i / steps, `Mock render ${i}/${steps}`);
      }
      const excerpt = esc(ctx.job.prompt.replace(/\s+/g, ' ').slice(0, 220));
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1f2937"/><stop offset="1" stop-color="#312e81"/></linearGradient></defs>
<rect width="640" height="360" fill="url(#g)"/>
<text x="32" y="56" fill="#b6ff3b" font-family="monospace" font-size="18">MOCK BACKEND · no video produced</text>
<foreignObject x="32" y="80" width="576" height="240"><div xmlns="http://www.w3.org/1999/xhtml" style="color:#e5e7eb;font:14px/1.5 monospace">${excerpt}…</div></foreignObject>
</svg>`;
      await writeFile(path.join(ctx.dir, 'poster.svg'), svg);
      return { poster: 'poster.svg' };
    },
  };
}
