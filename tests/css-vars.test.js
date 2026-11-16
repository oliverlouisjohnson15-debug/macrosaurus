'use strict';
// Every colour a screen asks for has to exist. A misspelt or never-defined custom property doesn't
// error: it silently resolves to nothing, which is how the exercise picker shipped see-through
// (`var(--page)`, a token that was never defined) and nine Train warnings rendered as plain text
// (`var(--warn-ink)`).
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

test('every var(--token) used in the app source is defined in styles.css', () => {
  const css = fs.readFileSync(path.join(__dirname, '../app/src/styles.css'), 'utf8');
  const defined = new Set([...css.matchAll(/(--[a-z0-9-]+)\s*:/g)].map(m => m[1]));
  const dir = path.join(__dirname, '../app/src');
  const missing = [];
  for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.jsx'))) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    for (const m of src.matchAll(/var\((--[a-z0-9-]+)/g)) {
      const name = m[1];
      if (name.endsWith('-')) continue;                  // a prefix built at runtime: 'var(--terra-' + c + ')'
      if (!defined.has(name)) missing.push(f + ': ' + name);
    }
  }
  assert.deepEqual([...new Set(missing)], []);
});
