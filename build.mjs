/*
 * build.mjs - Rebuilds the deployable root index.html from sources in app/.
 * The root index.html is a self-contained bundle: Tailwind CSS + custom styles +
 * inlined vendors (React, ReactDOM) + engine/store/quantity + Babel-transpiled app.jsx.
 * This script splices freshly built blocks into the existing bundle by signature,
 * leaving the vendor blocks and document skeleton untouched.
 *
 * Usage: node build.mjs   (expects npm i @babel/core @babel/preset-react tailwindcss@3)
 *
 * buildHtml() is also imported by dev.mjs, which serves the result from memory and
 * never writes index.html, so a dev session leaves the working tree clean.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { execSync } from 'child_process';
import { fileURLToPath, pathToFileURL } from 'url';
import { dirname, join } from 'path';
import { transformSync } from '@babel/core';

// Resolve every path against the repo root, not the caller's cwd, so the build
// behaves the same whether it is run from here or from a watcher elsewhere.
const ROOT = dirname(fileURLToPath(import.meta.url));
const at = (...p) => join(ROOT, ...p);
const read = (p) => readFileSync(at(p), 'utf8');

// Tailwind and Babel are the two slow passes, and both depend only on app.jsx. The dev
// server rebuilds on every save, so caching them on the exact source they ran against
// lets a styles.css or engine.js edit skip both and rebuild in well under a second.
let twCache = { src: null, css: null };
let jsxCache = { src: null, code: null };

function compileTailwind(appSrc) {
  if (twCache.src === appSrc && twCache.css !== null) return twCache.css;
  mkdirSync(at('.build'), { recursive: true });
  writeFileSync(at('.build/tw-in.css'), '@tailwind base;\n@tailwind utilities;\n');
  writeFileSync(at('.build/tw.config.cjs'),
    'module.exports = { content: ["./app/src/app.jsx"], corePlugins: { preflight: true } };\n');
  execSync('npx tailwindcss -c .build/tw.config.cjs -i .build/tw-in.css -o .build/tw.css --minify',
    { stdio: 'pipe', cwd: ROOT });
  const css = read('.build/tw.css').trim();
  twCache = { src: appSrc, css };
  return css;
}

function transpileApp(appSrc) {
  if (jsxCache.src === appSrc && jsxCache.code !== null) return jsxCache.code;
  const code = transformSync(appSrc, {
    presets: [['@babel/preset-react', { runtime: 'classic' }]],
    compact: false,
    comments: true,
  }).code;

  // guard: transpiled output must parse as plain JS
  new Function(code); // throws on syntax error

  jsxCache = { src: appSrc, code };
  return code;
}

/*
 * Builds the full bundle and returns it as a string. Does not touch the filesystem
 * beyond the .build scratch dir; the caller decides whether to write it.
 */
export function buildHtml() {
  // ---- 1. compile tailwind ----
  const appSrc = read('app/src/app.jsx');
  const twCss = compileTailwind(appSrc);

  // ---- 2. transpile app.jsx ----
  const transpiled = transpileApp(appSrc);

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
  // app block (transpiled): the script holding the React app. Babel's output start can vary between
  // versions (some hoist an `_extends` helper before `const { ... } = React`), so we don't match on the
  // first line. Instead we locate the block by the render call it always contains and splice the whole
  // enclosing <script>...</script>.
  {
    const marker = 'ReactDOM.createRoot';
    const mi = html.indexOf(marker);
    if (mi === -1) throw new Error('app render marker not found: ' + marker);
    const start = html.lastIndexOf('<script>', mi);
    const end = html.indexOf('</script>', mi);
    if (start === -1 || end === -1) throw new Error('app script bounds not found');
    html = html.slice(0, start) + '<script>' + transpiled + '\n</script>' + html.slice(end + '</script>'.length);
  }

  // sanity checks
  if (html.includes('—')) throw new Error('em dash found in bundle');
  if (!html.includes('ReactDOM.createRoot')) throw new Error('app render call missing');

  return html;
}

export { ROOT };

// Only write index.html when run directly (node build.mjs), not when imported by dev.mjs.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const html = buildHtml();
  writeFileSync(at('index.html'), html);
  console.log('built index.html:', html.length, 'bytes');
}
