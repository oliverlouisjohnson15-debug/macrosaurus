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

/* The same screens, but MOUNTED and clicked rather than rendered once.
 *
 * renderToStaticMarkup above is the right tool for what a screen SAYS, and it cannot reach what a
 * screen DOES: every sheet, picker and menu in the Train module is behind component state, so the
 * half of the app that opens when you tap something is invisible to it. The replacement flow is
 * exactly that shape - tap a movement, tap Replace, read the options - and wiring it wrongly
 * (passing no options, so the picker opens on a search box) is a change no static render can see.
 *
 * So this mounts into jsdom with the real react-dom and clicks with real events. Effects run, which
 * is the point and also the cost: it is slower and closer to a browser than anything else in here,
 * so reach for `render` first and this only when the thing under test is a tap.
 */
function mount(component, props) {
  const A = app();
  const ReactDOM = require('react-dom/client');
  const { act } = React;
  const doc = A.document;
  const host = doc.createElement('div');
  doc.body.appendChild(host);
  // React reads the environment off globalThis, not off the context the app was built in.
  const prevWindow = global.window, prevDoc = global.document, prevNav = global.navigator;
  global.window = A; global.document = doc;
  try { global.navigator = A.navigator; } catch (e) { /* already defined and read-only: harmless */ }
  global.IS_REACT_ACT_ENVIRONMENT = true;
  const restore = () => {
    global.window = prevWindow; global.document = prevDoc;
    try { global.navigator = prevNav; } catch (e) { /* see above */ }
  };
  let root;
  // Restored even when the first render throws, or a failing test poisons every test after it with
  // a jsdom window that has already been torn down.
  try {
    root = ReactDOM.createRoot(host);
    act(() => { root.render(React.createElement(component, props)); });
  } catch (e) { restore(); throw e; }
  const api = {
    // The mounted DOM itself, for tests that walk the screen rather than reading it: the dead-control
    // sweep enumerates every button on a screen and presses them one at a time, which needs the
    // elements and not their words.
    host: host,
    get text() { return host.textContent.replace(/\s+/g, ' ').trim(); },
    has: (s) => host.textContent.replace(/\s+/g, ' ').indexOf(s) !== -1,
    // Find a clickable by the words on it, the way somebody scanning the screen would.
    click(label) {
      const hits = Array.from(host.querySelectorAll('button, [role="button"]'))
        .filter(b => b.textContent.replace(/\s+/g, ' ').indexOf(label) !== -1);
      if (!hits.length) throw new Error('nothing to click reading "' + label + '" in: ' + api.text.slice(0, 400));
      // The most specific match, so "Replace it" is not swallowed by a card that contains it.
      const el = hits.sort((a, b) => a.textContent.length - b.textContent.length)[0];
      act(() => { el.dispatchEvent(new A.MouseEvent('click', { bubbles: true })); });
      return api;
    },
    // Press an element you already have a handle on, inside act() so effects and state settle the
    // same way they do for click(label).
    clickEl(el) { act(() => { el.dispatchEvent(new A.MouseEvent('click', { bubbles: true })); }); return api; },
    unmount() {
      try { act(() => { root.unmount() }); } finally { host.remove(); restore(); }
    },
  };
  return api;
}

module.exports = { app, render, mount, accountWith, React };
