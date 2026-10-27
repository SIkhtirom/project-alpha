import { build } from 'esbuild';
import fs from 'node:fs';

const STAR = String.fromCharCode(42);
const SLASH = String.fromCharCode(47);
const BS = String.fromCharCode(92);
const CSS_COMMENT = new RegExp(BS + STAR + BS + SLASH + '[\\s\\S]*?' + BS + STAR + BS + SLASH, 'g');
const stripCssComments = (css) => css.replace(CSS_COMMENT, (m) => '\n'.repeat(m.split('\n').length - 1));

const out = await build({ entryPoints: ['public/app.js'], bundle: true, format: 'iife', minify: true, write: false, target: 'es2020' });
const js = out.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const css = [fs.readFileSync('public/styles.css', 'utf8'), fs.readFileSync('public/security.css', 'utf8')].map(stripCssComments).join('\n');
const html = `<title>KMH Pendanaan</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;600&display=swap">
<style>${css}</style>
<div id="app"></div>
<script>${js}</script>
`;
fs.mkdirSync('dist', { recursive: true });
fs.writeFileSync(process.argv[2] || 'dist/kmh-pendanaan-demo.html', html);
console.log('OK', html.length);
