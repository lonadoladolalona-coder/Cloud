// Packs the demo build into one self-contained HTML fragment (title + style + root + inline module script),
// the shape a hosted single-page viewer wants. Run after `npm run build:demo`.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const dir = path.resolve('dist/demo/assets');
const files = readdirSync(dir);
const js = files.filter((f) => f.endsWith('.js')).map((f) => readFileSync(path.join(dir, f), 'utf8')).join('\n');
const css = files.filter((f) => f.endsWith('.css')).map((f) => readFileSync(path.join(dir, f), 'utf8')).join('\n');
if (!js) throw new Error('No JavaScript found in dist/demo/assets — run `npm run build:demo` first.');

// Keep the inline script from ending its own tag or opening an HTML comment.
const safeJs = js.replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '<\\!--');
const safeCss = css.replace(/<\/style/gi, '<\\/style');
const html = `<title>Studio H3</title>
<meta name="claude:viewport-fit-sides" content="cover">
<style>${safeCss}</style>
<div id="root"></div>
<script type="module">${safeJs}</script>
`;
const out = path.resolve('dist/demo/studio-h3-demo.html');
writeFileSync(out, html);
console.log(`${out}  ${(html.length / 1024).toFixed(0)} KB`);
