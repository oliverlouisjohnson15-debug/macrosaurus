'use strict';
// Tests for the shell caching in sw.js - the thing that decides how much bandwidth an app open
// costs. The shell is a single ~2.9MB self-contained bundle, so "does a launch hit the network"
// is not a detail: fetching it network-first on every navigation was the entire hosting bill.
//
// These tests run sw.js inside a fake ServiceWorkerGlobalScope with a fake CacheStorage, and
// assert on the network calls it makes. The two properties that matter, and that are easy to
// silently break in opposite directions:
//   1. a launch on an installed build must cost NOTHING (no shell fetch), and
//   2. a new build must still reach the user (a new VERSION must re-fetch the shell),
// plus 3. install must fetch the shell ONCE, not once per cache key.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SW_SRC = fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8');

// VERSION is a top-level `const` in sw.js, so it is a lexical binding and never shows up as a
// property of the sandbox global. Read it out of the source the same way build.mjs writes it.
const versionOf = (src) => src.match(/const VERSION = '([^']*)';/)[1];
const coreName = (src) => 'macrosaurus-core-v' + versionOf(src);

// The worker caches a network-fetched shell fire-and-forget (it must not delay the response on a
// cache write). Let those microtasks settle before asserting on the cache.
const settle = () => new Promise((r) => setImmediate(r));

// ---- fakes -------------------------------------------------------------------------------

class FakeResponse {
  constructor(body, init) {
    this.body = body;
    this.status = (init && init.status) || 200;
    this.ok = this.status >= 200 && this.status < 300;
    this.headers = new Map(Object.entries((init && init.headers) || {}));
    this.used = false;
  }
  clone() {
    assert.ok(!this.used, 'clone() after the body was consumed: the shell would be cached empty');
    return new FakeResponse(this.body, { status: this.status });
  }
}

class FakeCache {
  constructor() { this.store = new Map(); }
  async put(req, res) {
    assert.ok(!res.used, 'the same Response body was put into two caches without cloning');
    res.used = true;
    this.store.set(String(req), res);
  }
  async match(req) { return this.store.get(String(req)) || undefined; }
  async add(req) { const r = await this.scope.fetch(String(req)); return this.put(req, r); }
  async keys() { return [...this.store.keys()]; }
  async delete(req) { return this.store.delete(String(req)); }
}

class FakeCaches {
  constructor(scope) { this.map = new Map(); this.scope = scope; }
  async open(name) {
    if (!this.map.has(name)) { const c = new FakeCache(); c.scope = this.scope; this.map.set(name, c); }
    return this.map.get(name);
  }
  async keys() { return [...this.map.keys()]; }
  async delete(name) { return this.map.delete(name); }
  async match(req) {
    for (const c of this.map.values()) { const hit = await c.match(req); if (hit) return hit; }
    return undefined;
  }
}

// Boots sw.js in a sandbox. `caches` can be handed in from a previous boot to model a browser that
// already has this app installed, which is the only way to test a second launch or an upgrade.
function boot(source, existingCaches) {
  const listeners = {};
  const fetched = [];
  const scope = {
    fetch: (url, opts) => {
      fetched.push({ url: String(url), opts: opts || {} });
      return Promise.resolve(new FakeResponse('SHELL-' + String(url)));
    },
    addEventListener: (type, fn) => { (listeners[type] = listeners[type] || []).push(fn); },
    skipWaiting: () => Promise.resolve(),
    clients: { claim: () => Promise.resolve(), matchAll: async () => [] },
    registration: { showNotification: async () => {} },
    URL,
    Response: FakeResponse,
    Promise,
    console,
    setTimeout,
  };
  scope.self = scope;
  scope.caches = existingCaches || new FakeCaches(scope);
  scope.caches.scope = scope;
  for (const c of scope.caches.map.values()) c.scope = scope;

  vm.createContext(scope);
  vm.runInContext(source, scope);

  // Drive a lifecycle event and wait for everything it registered via waitUntil.
  const dispatch = async (type, extra) => {
    const waits = [];
    const ev = Object.assign({ waitUntil: (p) => waits.push(p) }, extra);
    for (const fn of listeners[type] || []) fn(ev);
    await Promise.all(waits);
    return ev;
  };

  // Drive a fetch event and return the Response the worker chose to respond with.
  const navigate = async (pathname) => {
    let responded;
    const ev = {
      request: { url: 'https://macrosaurus.com' + pathname, method: 'GET', mode: 'navigate' },
      respondWith: (p) => { responded = p; },
    };
    for (const fn of listeners['fetch'] || []) fn(ev);
    return responded ? await responded : undefined;
  };

  return { scope, fetched, dispatch, navigate, caches: scope.caches };
}

const shellFetches = (fetched) =>
  fetched.filter(f => f.url === '/index.html' || f.url === '/' || /\/index\.html$/.test(f.url));

// A second build: same worker, different content hash. This is exactly what build.mjs writes.
const rebuild = (src, version) => src.replace(/const VERSION = '[^']*';/, "const VERSION = '" + version + "';");

// ---- install -----------------------------------------------------------------------------

test('install fetches the shell exactly once, not once per cache key', async () => {
  const w = boot(SW_SRC);
  await w.dispatch('install');
  assert.strictEqual(shellFetches(w.fetched).length, 1,
    'the shell is the single biggest asset we serve; fetching it twice doubles the cost of a deploy');
});

test('install fetches the shell with no-store, so a fresh deploy is not read from the HTTP cache', async () => {
  const w = boot(SW_SRC);
  await w.dispatch('install');
  assert.strictEqual(shellFetches(w.fetched)[0].opts.cache, 'no-store');
});

test('install caches the shell under both keys a navigation can ask for', async () => {
  const w = boot(SW_SRC);
  await w.dispatch('install');
  const core = await w.caches.open(coreName(SW_SRC));
  assert.ok(await core.match('/index.html'), 'no shell cached at /index.html');
  assert.ok(await core.match('/'), 'no shell cached at /');
});

// ---- the launch that used to cost a megabyte ---------------------------------------------

test('a launch on an installed build serves the shell without touching the network', async () => {
  const w = boot(SW_SRC);
  await w.dispatch('install');
  await w.dispatch('activate');
  const before = w.fetched.length;
  const res = await w.navigate('/');
  assert.ok(res, 'the worker did not respond to the navigation at all');
  assert.strictEqual(w.fetched.length, before,
    'a navigation hit the network: this is the regression that produced the bandwidth bill');
});

test('every subsequent launch is free too, at / and at /index.html alike', async () => {
  const w = boot(SW_SRC);
  await w.dispatch('install');
  await w.dispatch('activate');
  const before = w.fetched.length;
  for (let i = 0; i < 20; i++) { await w.navigate('/'); await w.navigate('/index.html'); }
  assert.strictEqual(w.fetched.length, before);
});

// ---- but a new build must still get through -----------------------------------------------

test('a new build re-fetches the shell, so a deploy still reaches an installed app', async () => {
  const first = boot(SW_SRC);
  await first.dispatch('install');
  await first.dispatch('activate');

  // Same browser, same caches, new worker: what a deploy looks like from the client side.
  const NEXT_SRC = rebuild(SW_SRC, 'deadbeef0002');
  const next = boot(NEXT_SRC, first.caches);
  await next.dispatch('install');
  assert.strictEqual(shellFetches(next.fetched).length, 1, 'the new build never fetched its shell');

  await next.dispatch('activate');
  const res = await next.navigate('/');
  assert.strictEqual(res.body, 'SHELL-/index.html');
  const core = await next.caches.open(coreName(NEXT_SRC));
  assert.ok(await core.match('/index.html'), 'the new build did not cache its own shell');
});

test('a new build cannot be served the previous build\'s shell', async () => {
  const first = boot(SW_SRC);
  await first.dispatch('install');
  await first.dispatch('activate');
  // Poison the old cache with something identifiable, then upgrade WITHOUT letting install fetch.
  const oldCore = await first.caches.open(coreName(SW_SRC));
  await oldCore.put('/index.html', new FakeResponse('STALE-SHELL'));

  const next = boot(rebuild(SW_SRC, 'deadbeef0003'), first.caches);
  await next.dispatch('activate'); // activate first: sweeps old caches, new CORE is empty
  const res = await next.navigate('/');
  assert.notStrictEqual(res.body, 'STALE-SHELL',
    'a cross-cache lookup served a previous build - users would be pinned to an old app');
});

// ---- the caches around it -----------------------------------------------------------------

test('activate drops the previous build\'s shell cache', async () => {
  const first = boot(SW_SRC);
  await first.dispatch('install');
  await first.dispatch('activate');
  const oldName = coreName(SW_SRC);

  const next = boot(rebuild(SW_SRC, 'deadbeef0004'), first.caches);
  await next.dispatch('install');
  await next.dispatch('activate');
  assert.ok(!(await next.caches.keys()).includes(oldName), 'old shell caches are piling up on disk');
});

test('the asset cache survives a deploy, so sprites and food tables are not re-downloaded', async () => {
  const first = boot(SW_SRC);
  await first.dispatch('install');
  await first.dispatch('activate');
  const rt = await first.caches.open('macrosaurus-rt-v1');
  await rt.put('/sprites/female/olaf/egg/move.png', new FakeResponse('SPRITE'));

  const next = boot(rebuild(SW_SRC, 'deadbeef0005'), first.caches);
  await next.dispatch('install');
  await next.dispatch('activate');
  const stillThere = await (await next.caches.open('macrosaurus-rt-v1')).match('/sprites/female/olaf/egg/move.png');
  assert.ok(stillThere, 'a deploy threw away assets whose bytes had not changed');
});

test('activate leaves the share-target cache alone', async () => {
  const w = boot(SW_SRC);
  await w.dispatch('install');
  const share = await w.caches.open('share-incoming');
  await share.put('/shared-file-0', new FakeResponse('PHOTO'));
  await w.dispatch('activate');
  assert.ok(await (await w.caches.open('share-incoming')).match('/shared-file-0'),
    'a share handed off mid-activate would lose its photos');
});

// ---- offline ------------------------------------------------------------------------------

test('a launch with no cache and no network still gets a response, not a crash', async () => {
  const w = boot(SW_SRC);
  w.scope.fetch = () => Promise.reject(new Error('offline'));
  const res = await w.navigate('/');
  assert.ok(res, 'the worker responded with nothing at all while offline');
  assert.strictEqual(res.status, 503);
});

test('a cache miss on a live network fetches the shell and caches it for next time', async () => {
  const w = boot(SW_SRC);
  const res = await w.navigate('/');           // no install ran: cold cache
  assert.strictEqual(shellFetches(w.fetched).length, 1);
  assert.ok(res.ok);
  await settle();
  const core = await w.caches.open(coreName(SW_SRC));
  assert.ok(await core.match('/index.html'), 'the miss was not cached, so every launch would refetch');
});
