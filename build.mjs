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
  'module.exports = { content: ["./app/src/*.jsx"], corePlugins: { preflight: true } };\n');
execSync('npx tailwindcss -c .build/tw.config.cjs -i .build/tw-in.css -o .build/tw.css --minify', { stdio: 'pipe' });
const twCss = read('.build/tw.css').trim();

// ---- 2. transpile the app sources ----
// app.jsx has no imports: everything lives in one shared scope, so the sources are simply
// concatenated in order before Babel sees them. That means a file can be split off without
// rewriting anything, as long as it is listed BEFORE the code that uses it (function declarations
// hoist, but `const` does not). Keep this list in dependency order.
// train.jsx sits AFTER app.jsx: everything it exposes is a function declaration, which hoists across
// the whole concatenated script, so app.jsx can render <TrainTab/> while train.jsx is free to use
// app.jsx's `const` helpers (Icon, Card, Pill, Field) at call time.
const APP_SOURCES = ['app/src/prompts.jsx', 'app/src/app.jsx', 'app/src/train.jsx'];
const appSrc = APP_SOURCES.map(f => '/* ---- ' + f + ' ---- */\n' + read(f)).join('\n');
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
const cofidJs = read('app/cofid.js').trim();
const trainingJs = read('app/training.js').trim();
const talkJs = read('app/talk.js').trim();
const menuJs = read('app/menu.js').trim();

let html = read('index.html');

/* ---- the build stamp ------------------------------------------------------------------------
   The page has to know which build it IS, or it cannot tell a deploy it is missing from a service
   worker that has merely swapped in underneath it. sw.js's VERSION is already the deploy's identity
   and is already bumped for every release, so it is the one number both halves read: stamped here
   into the page, answered there over postMessage, compared in the app before a reload is offered. */
const swVersion = (read('sw.js').match(/const VERSION = '([^']+)'/) || [])[1];
if (!swVersion) throw new Error('sw.js VERSION not found');
const buildBlock = "<script>window.BUILD='" + swVersion + "';</script>";
const BUILD_RE = /<script>window\.BUILD='[^']*';<\/script>/;
if (BUILD_RE.test(html)) {
  html = html.replace(BUILD_RE, buildBlock);
} else {
  // First run: it belongs immediately before the registration, so the stamp is set whatever the
  // worker goes on to do.
  const swReg = "<script>if('serviceWorker' in navigator)";
  const at = html.indexOf(swReg);
  if (at === -1) throw new Error('service worker registration script not found for build stamp');
  html = html.slice(0, at) + buildBlock + '\n' + html.slice(at);
}

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
// cofid block (grounding an AI estimate against the UK food tables) - splice if present, else
// first-time insert after recipe
const cofidBlock = '<script>\n' + cofidJs + '\n</script>';
if (html.includes('<script>\n/*\n * cofid.js')) {
  spliceBlock('<script>\n/*\n * cofid.js', cofidBlock, '</script>');
} else {
  const rEnd = html.indexOf('</script>', html.indexOf('<script>\n/*\n * recipe.js')) + '</script>'.length;
  if (rEnd < '</script>'.length) throw new Error('recipe block end not found for cofid.js insertion');
  html = html.slice(0, rEnd) + '\n' + cofidBlock + html.slice(rEnd);
}
// training block (pure resistance-training engine) - splice if present, else first-time insert
// after recipe. Nothing else depends on it at load time, so its position only has to be before the
// app script that calls it.
const trainingBlock = '<script>\n' + trainingJs + '\n</script>';
if (html.includes('<script>\n/*\n * training.js')) {
  spliceBlock('<script>\n/*\n * training.js', trainingBlock, '</script>');
} else {
  const rEnd = html.indexOf('</script>', html.indexOf('<script>\n/*\n * recipe.js')) + '</script>'.length;
  if (rEnd < '</script>'.length) throw new Error('recipe block end not found for training.js insertion');
  html = html.slice(0, rEnd) + '\n' + trainingBlock + html.slice(rEnd);
}
// talk block (what the buddy's conversation is allowed to do) - splice if present, else first-time
// insert after training. Load order only has to put it before the app script that reads Talk.TOOLS.
const talkBlock = '<script>\n' + talkJs + '\n</script>';
if (html.includes('<script>\n/*\n * talk.js')) {
  spliceBlock('<script>\n/*\n * talk.js', talkBlock, '</script>');
} else {
  const tEnd = html.indexOf('</script>', html.indexOf('<script>\n/*\n * training.js')) + '</script>'.length;
  if (tEnd < '</script>'.length) throw new Error('training block end not found for talk.js insertion');
  html = html.slice(0, tEnd) + '\n' + talkBlock + html.slice(tEnd);
}

// menu block (choosing what to order from a menu) - splice if present, else first-time insert after
// talk. Load order only has to put it before the app script that calls MenuIdeas.
const menuBlock = '<script>\n' + menuJs + '\n</script>';
if (html.includes('<script>\n/*\n * menu.js')) {
  spliceBlock('<script>\n/*\n * menu.js', menuBlock, '</script>');
} else {
  const kEnd = html.indexOf('</script>', html.indexOf('<script>\n/*\n * talk.js')) + '</script>'.length;
  if (kEnd < '</script>'.length) throw new Error('talk block end not found for menu.js insertion');
  html = html.slice(0, kEnd) + '\n' + menuBlock + html.slice(kEnd);
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

writeFileSync('index.html', html);
console.log('built index.html:', html.length, 'bytes');
