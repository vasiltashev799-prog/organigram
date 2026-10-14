import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const rd = (f) => readFileSync(join(root, 'src', f), 'utf8');

const assets = { viewer: rd('viewer.html'), css: rd('chart.css'), chart: rd('chart.js'), crypto: rd('crypto.js') };
const assetsJson = JSON.stringify(assets).replace(/<\//g, '<\\/');

const map = {
  __CSS_CHART__: rd('chart.css'), __CSS_APP__: rd('app.css'),
  __JS_CRYPTO__: rd('crypto.js'), __JS_CHART__: rd('chart.js'), __JS_APP__: rd('app.js'),
  __ASSETS__: assetsJson,
};
const html = rd('index.html').replace(/__(CSS_CHART|CSS_APP|JS_CRYPTO|JS_CHART|JS_APP|ASSETS)__/g, (m) => map[m]);

mkdirSync(join(root, 'dist'), { recursive: true });
writeFileSync(join(root, 'dist', 'index.html'), html);
console.log('dist/index.html', (html.length / 1024).toFixed(0) + ' KB');
