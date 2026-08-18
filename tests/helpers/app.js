'use strict';
/* Rendering the real app in a test.
 *
 * The sources have no imports: build.mjs concatenates them and hands the lot to Babel, so every
 * component is a plain function declaration sharing one scope. That is why this harness exists and
 * why it is short - it does exactly what the build does (concatenate, transform), then evaluates the
 * result in a jsdom context and hands back the scope. Every component in the app is a property of
 * it, which is as close to "the app as shipped" as a test can get without a browser.
 *
 * Rendered with react-dom/server rather than mounted: effects do not run, which suits smoke tests
 * of what a screen SAYS. The bugs these were written after were all of that kind - a coverage bar
 * measured against the wrong table, a button offering four weeks of a six-week block, a stall with
 * nothing to press.
 */
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { transformSync } = require('@babel/core');
const { JSDOM } = require('jsdom');
const React = require('react');
const ReactDOMServer = require('react-dom/server');

const ROOT = path.join(__dirname, '..', '..');
const ENGINES = ['app/engine.js', 'app/store.js', 'app/game.js', 'app/quantity.js', 'app/recipe.js',
  'app/cofid.js', 'app/training.js', 'app/talk.js', 'app/menu.js'];
// The same list build.mjs uses, read from the same file, so this cannot quietly stop being a test of
// the app that ships.
const SOURCES = JSON.parse(readFileSync(path.join(ROOT, 'app/src/manifest.json'), 'utf8')
  .replace(/^\s*"_":[\s\S]*?",\n/m, '')).sources;

let cached = null;
function app() {
  if (cached) return cached;
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://macrosaurus.test/' });
  const w = dom.window;
  // The handful of browser things the app touches at module scope and jsdom does not provide.
  w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  w.indexedDB = { open: () => ({ addEventListener() {} }) };
  w.fetch = () => Promise.reject(new Error('the tests do not have a network'));
  w.scrollTo = () => {};
  const ctx = vm.createContext(w);
  ctx.React = React;
  ctx.console = console;
  ctx.globalThis = ctx;
  ctx.ReactDOM = { createRoot: () => ({ render() {}, unmount() {} }) };
  const read = (f) => readFileSync(path.join(ROOT, f), 'utf8');
  vm.runInContext(ENGINES.map(read).join('\n'), ctx, { filename: 'engines.js' });
  const src = SOURCES.map(read).join('\n');
  const code = transformSync(src, { presets: [['@babel/preset-react', { runtime: 'classic' }]], compact: false }).code;
  vm.runInContext(code, ctx, { filename: 'app.js' });
  cached = ctx;
  return ctx;
}

// The words a screen puts in front of somebody, with the markup taken out. Every assertion in these
// tests is about what is READ, which is the only part of a screen a person actually meets.
function render(component, props) {
  const html = ReactDOMServer.renderToStaticMarkup(React.createElement(component, props));
  return {
    html,
    text: html.replace(/<[^>]+>/g, ' ').replace(/&middot;|&#xB7;/g, '·').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim(),
    has: (s) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').indexOf(s) !== -1,
  };
}

// A plausible account with one block in it, running from today.
function accountWith(block, extra) {
  const A = app();
  const b = block || A.Training.generateBlock({ style: 'minmax', shape: 'minmax6', weeks: 6, daysPerWeek: 5, sessionMinutes: 60 });
  b.startISO = A.Store.todayISO();
  return Object.assign({
    training: {
      blocks: [b], logs: [], custom: [], volumeTargets: {}, volumeTargetsMinmax: {},
      prefs: { units: 'kg', style: b.style || 'minmax', daysPerWeek: b.daysPerWeek, sessionMinutes: 60, experience: 'intermediate', equipment: [] },
    },
    buddy: { name: 'Rex' },
    profile: { goalType: 'cut' },
  }, extra || {});
}

module.exports = { app, render, accountWith, React };
