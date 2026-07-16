/*
 * build.mjs - Rebuilds the deployable root index.html from sources in app/.
 * The root index.html is a self-contained bundle: Tailwind CSS + custom styles +
 * inlined vendors (React, ReactDOM) + engine/store/quantity + Babel-transpiled app.jsx.
 * This script splices freshly built blocks into the existing bundle by signature,
 * leaving the vendor blocks and document skeleton untouched.
 *
 * Usage: node build.mjs   (expects npm i @babel/core @babel/preset-react tailwindcss@3)
 */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { execSync } from 'child_process';
import { transformSync } from '@babel/core';

const read = (p) => readFileSync(p, 'utf8');

// ---- 1. compile tailwind ----
mkdirSync('.build', { recursive: true });
writeFileSync('.build/tw-in.css', '@tailwind base;\n@tailwind utilities;\n');
writeFileSync('.build/tw.config.cjs',
  'module.exports = { content: ["./app/src/app.jsx"], corePlugins: { preflight: true } };\n');
execSync('npx tailwindcss -c .build/tw.config.cjs -i .build/tw-in.css -o .build/tw.css --minify', { stdio: 'pipe' });
const twCss = read('.build/tw.css').trim();

// ---- 2. transpile app.jsx ----
const appSrc = read('app/src/app.jsx');
const transpiled = transformSync(appSrc, {
  presets: [['@babel/preset-react', { runtime: 'classic' }]],
  compact: false,
  comments: true,
}).code;

// guard: transpiled output must parse as plain JS
new Function(transpiled); // throws on syntax error

const stylesCss = read('app/src/styles.css').trim();
const engineJs = read('app/engine.js').trim();
const storeJs = read('app/store.js').trim();
const gameJs = read('app/game.js').trim();
const quantityJs = read('app/quantity.js').trim();
const recipeJs = read('app/recipe.js').trim();

let html = read('index.html');

function spliceBlock(startSig, replacement, endTag) {
  const start = html.indexOf(startSig);
  if (start === -1) throw new Error('signature not found: ' + startSig.slice(0, 60));
  const end = html.indexOf(endTag, start + startSig.length);
  if (end === -1) throw new Error('end tag not found after: ' + startSig.slice(0, 60));
  html = html.slice(0, start) + replacement + html.slice(end + endTag.length);
}

// tailwind block: always the first <style> in the document (older tailwind emitted a
// /*! tailwindcss */ banner, newer minified builds do not, so match on the tag itself)
spliceBlock('<style>', '<style>' + twCss + '</style>', '</style>');
// custom styles block (starts with the Press Start 2P @import)
spliceBlock("<style>@import url('https://fonts.googleapis.com", '<style>' + stylesCss + '\n</style>', '</style>');
// engine block
spliceBlock('<script>/*\n * engine.js', '<script>' + engineJs + '\n</script>', '</script>');
// store block
spliceBlock('<script>\n/*\n * store.js', '<script>\n' + storeJs + '\n</script>', '</script>');
// game block (pure gamification logic) - splice if present, else first-time insert before quantity
const gameBlock = '<script>\n' + gameJs + '\n</script>';
if (html.includes('<script>\n/*\n * game.js')) {
  spliceBlock('<script>\n/*\n * game.js', gameBlock, '</script>');
} else {
  const qStart = html.indexOf('<script>\n/*\n * quantity.js');
  if (qStart === -1) throw new Error('quantity block not found for game.js insertion');
  html = html.slice(0, qStart) + gameBlock + '\n' + html.slice(qStart);
}
// quantity block
spliceBlock('<script>\n/*\n * quantity.js', '<script>\n' + quantityJs + '\n</script>', '</script>');
// recipe block (pure recipe helpers) - splice if present, else first-time insert after quantity
const recipeBlock = '<script>\n' + recipeJs + '\n</script>';
if (html.includes('<script>\n/*\n * recipe.js')) {
  spliceBlock('<script>\n/*\n * recipe.js', recipeBlock, '</script>');
} else {
  const qEnd = html.indexOf('</script>', html.indexOf('<script>\n/*\n * quantity.js')) + '</script>'.length;
  if (qEnd < '</script>'.length) throw new Error('quantity block end not found for recipe.js insertion');
  html = html.slice(0, qEnd) + '\n' + recipeBlock + html.slice(qEnd);
}
// app block (transpiled)
spliceBlock('<script>const {', '<script>' + transpiled + '\n</script>', '</script>');

// sanity checks
if (html.includes('—')) throw new Error('em dash found in bundle');
if (!html.includes('ReactDOM.createRoot')) throw new Error('app render call missing');

writeFileSync('index.html', html);
console.log('built index.html:', html.length, 'bytes');
