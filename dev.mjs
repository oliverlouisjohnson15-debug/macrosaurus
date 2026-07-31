/*
 * dev.mjs - Local development server for Macrosaurus.
 *
 * Serves the app at http://localhost:5173 built fresh from app/ sources, watches those
 * sources, and reloads the browser on every save. The build happens in memory: the
 * committed index.html is read as the document skeleton but never written, so a dev
 * session leaves the working tree clean. Run `npm run build` when you are ready to
 * update the deployable bundle for a commit.
 *
 * Usage:
 *   npm run dev                 (http://localhost:5173)
 *   npm run dev -- --open       also opens the browser
 *   npm run dev -- --port 3000  use a different port
 *   npm run dev -- --host       also listen on the LAN, for testing on a phone
 */
import { createServer } from 'http';
import { readFile, stat } from 'fs/promises';
import { watch } from 'fs';
import { join, extname, normalize, sep } from 'path';
import { networkInterfaces } from 'os';
import { execFile } from 'child_process';
import { buildHtml, ROOT } from './build.mjs';

// ---- args ----
const argv = process.argv.slice(2);
const flag = (name) => argv.includes('--' + name);
const value = (name, fallback) => {
  const i = argv.indexOf('--' + name);
  return i !== -1 && argv[i + 1] ? argv[i + 1] : fallback;
};
const START_PORT = Number(value('port', process.env.PORT || 5173));
const HOST = flag('host') ? '0.0.0.0' : '127.0.0.1';
const OPEN = flag('open');

// ---- build state ----
// lastGood keeps the previous bundle serving while a build is broken, so a syntax error
// mid-edit shows an overlay instead of an unreachable page.
let lastGood = null;
let buildError = null;
let buildToken = 0;

const RELOAD_CLIENT = `
<script>
(function () {
  var es = new EventSource('/__dev/events');
  var overlayId = '__macrosaurus_dev_overlay';
  function clearOverlay() {
    var el = document.getElementById(overlayId);
    if (el) el.remove();
  }
  function showOverlay(message) {
    clearOverlay();
    var el = document.createElement('div');
    el.id = overlayId;
    el.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:rgba(20,10,10,.94);' +
      'color:#ffb4b4;font:13px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;padding:24px;' +
      'overflow:auto;white-space:pre-wrap;-webkit-user-select:text;user-select:text';
    el.textContent = 'Build failed\\n\\n' + message + '\\n\\nFix the error and save; this overlay clears on the next good build.';
    document.body.appendChild(el);
  }
  es.addEventListener('reload', function () { location.reload(); });
  es.addEventListener('builderror', function (e) { showOverlay(e.data ? JSON.parse(e.data) : 'unknown error'); });
  es.addEventListener('open', clearOverlay);
})();
</script>
`;

function withReloadClient(html) {
  const i = html.lastIndexOf('</body>');
  if (i === -1) return html + RELOAD_CLIENT;
  return html.slice(0, i) + RELOAD_CLIENT + html.slice(i);
}

function rebuild() {
  const started = Date.now();
  try {
    lastGood = withReloadClient(buildHtml());
    buildError = null;
    return { ok: true, ms: Date.now() - started };
  } catch (err) {
    buildError = err && err.stack ? err.stack : String(err);
    return { ok: false, ms: Date.now() - started, error: buildError };
  }
}

// ---- live reload channel ----
const clients = new Set();

function broadcast(event, data) {
  const payload = 'event: ' + event + '\ndata: ' + JSON.stringify(data == null ? '' : data) + '\n\n';
  for (const res of clients) {
    try { res.write(payload); } catch { clients.delete(res); }
  }
}

// ---- static serving ----
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
};

// A no-op service worker for dev. The real sw.js caches the app shell, which fights
// live reload and serves stale bundles. This one registers cleanly, wipes any caches a
// previous real sw.js left behind, and installs no fetch handler, so every request goes
// straight to the network. It deliberately does not unregister itself: index.html
// re-registers on load, and unregister-then-reregister would loop forever.
const DEV_SW = `/* dev stub service worker, served by dev.mjs. Not the real sw.js. */
self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (e) {
  e.waitUntil((async function () {
    for (const key of await caches.keys()) await caches.delete(key);
    await self.clients.claim();
  })());
});
`;

// Resolve a URL path to a file inside ROOT, refusing anything that escapes it.
function resolveSafe(urlPath) {
  const decoded = decodeURIComponent(urlPath.split('?')[0]);
  const rel = normalize(decoded).replace(/^([/\\]|\.\.[/\\])+/, '');
  const full = join(ROOT, rel);
  if (full !== ROOT && !full.startsWith(ROOT + sep)) return null;
  return full;
}

function send(res, status, body, type, extraHeaders) {
  res.writeHead(status, Object.assign({
    'Content-Type': type,
    // Nothing in dev should ever be cached; the whole point is seeing the latest build.
    'Cache-Control': 'no-store, must-revalidate',
  }, extraHeaders || {}));
  res.end(body);
}

async function serveStatic(res, urlPath) {
  const full = resolveSafe(urlPath);
  if (!full) return send(res, 403, 'Forbidden', 'text/plain; charset=utf-8');
  let info;
  try {
    info = await stat(full);
  } catch {
    return send(res, 404, 'Not found: ' + urlPath, 'text/plain; charset=utf-8');
  }
  if (info.isDirectory()) return serveStatic(res, join(urlPath, 'index.html'));
  const body = await readFile(full);
  send(res, 200, body, MIME[extname(full).toLowerCase()] || 'application/octet-stream');
}

function serveApp(res) {
  if (!lastGood) {
    return send(res, 500, 'Build failed and no previous good bundle exists.\n\n' + buildError,
      'text/plain; charset=utf-8');
  }
  send(res, 200, lastGood, 'text/html; charset=utf-8');
}

const server = createServer(async (req, res) => {
  const path = (req.url || '/').split('?')[0];

  if (path === '/__dev/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
    });
    res.write('retry: 1000\n\n');
    clients.add(res);
    // If the current build is broken, tell the page that just connected.
    if (buildError) res.write('event: builderror\ndata: ' + JSON.stringify(buildError) + '\n\n');
    const beat = setInterval(() => { try { res.write(': ping\n\n'); } catch {} }, 25000);
    req.on('close', () => { clearInterval(beat); clients.delete(res); });
    return;
  }

  if (path === '/sw.js') return send(res, 200, DEV_SW, MIME['.js']);
  if (path === '/' || path === '/index.html') return serveApp(res);

  try {
    await serveStatic(res, path);
  } catch (err) {
    send(res, 500, String(err), 'text/plain; charset=utf-8');
  }
});

// ---- file watching ----
// Watch directories rather than individual files: editors save atomically (write a temp
// file, then rename over the original), which detaches a per-file watch from the inode.
const WATCHED = [
  { dir: '.', files: new Set(['index.html', 'build.mjs']) },
  { dir: 'app', files: new Set(['engine.js', 'store.js', 'game.js', 'quantity.js', 'recipe.js']) },
  { dir: 'app/src', files: new Set(['app.jsx', 'styles.css']) },
];

let pending = null;
function scheduleRebuild(reason) {
  clearTimeout(pending);
  // Debounce: a single save can emit several change events, and large writes land in chunks.
  pending = setTimeout(() => {
    const token = ++buildToken;
    const result = rebuild();
    if (token !== buildToken) return; // a newer save superseded this build
    if (result.ok) {
      console.log(`  rebuilt in ${result.ms}ms (${reason}), reloading`);
      broadcast('reload');
    } else {
      console.error(`  build failed (${reason}):\n${result.error}\n`);
      broadcast('builderror', result.error);
    }
  }, 120);
}

for (const { dir, files } of WATCHED) {
  try {
    watch(join(ROOT, dir), (_event, filename) => {
      if (filename && files.has(filename)) scheduleRebuild(join(dir, filename));
    });
  } catch (err) {
    console.warn(`  could not watch ${dir}: ${err.message}`);
  }
}

// ---- start ----
function lanAddress() {
  for (const addrs of Object.values(networkInterfaces())) {
    for (const a of addrs || []) {
      if (a.family === 'IPv4' && !a.internal) return a.address;
    }
  }
  return null;
}

function listen(port, attemptsLeft) {
  server.once('error', (err) => {
    if (err.code === 'EADDRINUSE' && attemptsLeft > 0) {
      console.log(`  port ${port} in use, trying ${port + 1}`);
      return listen(port + 1, attemptsLeft - 1);
    }
    console.error(err.message);
    process.exit(1);
  });
  server.listen(port, HOST, () => {
    const url = `http://localhost:${port}`;
    console.log(`\n  Macrosaurus dev server\n`);
    console.log(`  local:   ${url}`);
    if (HOST === '0.0.0.0') {
      const lan = lanAddress();
      console.log(`  network: ${lan ? `http://${lan}:${port}` : 'unavailable'}`);
    } else {
      console.log(`  network: use --host to expose on your LAN`);
    }
    console.log(`\n  watching app/src and app/ - saves rebuild and reload the browser`);
    console.log(`  index.html is NOT written; run \`npm run build\` before committing\n`);
    if (OPEN) execFile('open', [url], () => {});
  });
}

console.log('  building...');
const first = rebuild();
if (!first.ok) {
  console.error('  initial build failed:\n' + first.error);
  console.error('  starting anyway; fix the error and save to recover.\n');
} else {
  console.log(`  built in ${first.ms}ms`);
}
listen(START_PORT, 10);
