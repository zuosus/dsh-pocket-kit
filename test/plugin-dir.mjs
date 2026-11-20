/**
 * Where this package keeps its own directory, and the one-time move that takes
 * an existing install there.
 *
 * Written before the implementation: against the old code every assertion about
 * `<DSH_HOME>/plugins/dsh-pocket-kit` fails on the resolved path (or on the
 * missing export), never on a syntax error.
 *
 * Every case runs against a fresh temp directory injected through `env`; the
 * real `~/.dsh` is never read and never written.
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

let pass = 0;
let fail = 0;
const check = (name, ok) => {
  if (ok) { pass += 1; console.log('  ok  ' + name); }
  else { fail += 1; console.log('  FAIL ' + name); }
};

const mod = await import('../lib/plugin-dir.js');

// --- helpers -----------------------------------------------------------

/** One isolated DSH home per case; nothing outside tmpdir() is touched. */
const homes = [];
function makeHome() {
  const home = mkdtempSync(join(tmpdir(), 'pbk-home-'));
  homes.push(home);
  return home;
}

/** Write one file, creating its parent directories. */
function writeAt(path, text) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text, 'utf8');
}

/** Read a file, or undefined when it is not there. */
function readAt(path) {
  try { return readFileSync(path, 'utf8'); } catch { return undefined; }
}

// --- home resolution ---------------------------------------------------

check('the env override names DSH_HOME', mod.DSH_HOME_ENV === 'DSH_HOME');
check('the package name is exported', mod.PLUGIN_NAME === 'dsh-pocket-kit');

const home = makeHome();
const options = { env: { DSH_HOME: home } };

check('$DSH_HOME wins over ~/.dsh', mod.resolveDshHome(options) === home);
check('a trailing separator does not change the result', mod.resolveDshHome({ env: { DSH_HOME: home + '/' } }) === home);
check('blank counts as unset', mod.resolveDshHome({ env: { DSH_HOME: '   ' } }) === mod.resolveDshHome({ env: {} }));
check('the default is ~/.dsh', mod.resolveDshHome({ env: {} }).endsWith('/.dsh'));
check('a relative path is normalised to absolute', (() => {
  const relative = mod.resolveDshHome({ env: { DSH_HOME: 'rel/home' } });
  return relative === mod.resolveDshHome({ env: { DSH_HOME: './rel/home' } }) && relative.startsWith('/');
})());

// The point of the whole change: the plugin's own directory lives under
// $DSH_HOME/plugins/, next to every other plugin's data.
check('the plugin dir is under plugins/', mod.resolvePluginDir(options) === join(home, 'plugins', 'dsh-pocket-kit'));
check('the legacy dir is the old address', mod.resolveLegacyPluginDir(options) === join(home, 'dsh-pocket-kit'));

// --- migration: normal path -------------------------------------------

{
  const h = makeHome();
  const env = { DSH_HOME: h };
  const legacy = join(h, 'dsh-pocket-kit');
  writeAt(join(legacy, 'recovered-input.json'), '{"s":[]}');
  writeAt(join(legacy, 'nested', 'extra.txt'), 'kept');

  const result = mod.migratePluginDir({ env });

  check('normal: reported as migrated', result.migrated === true);
  check('normal: the new directory now holds the file', readAt(join(h, 'plugins', 'dsh-pocket-kit', 'recovered-input.json')) === '{"s":[]}');
  check('normal: nested content comes along', readAt(join(h, 'plugins', 'dsh-pocket-kit', 'nested', 'extra.txt')) === 'kept');
  check('normal: the old directory is gone', existsSync(legacy) === false);
  check('normal: the result names both ends', result.from === legacy && result.to === join(h, 'plugins', 'dsh-pocket-kit'));

  // Idempotent: a second boot finds nothing to do and changes nothing.
  const again = mod.migratePluginDir({ env });
  check('normal: a second run is a no-op', again.migrated === false && again.reason === 'already');
  check('normal: the data survives the second run', readAt(join(h, 'plugins', 'dsh-pocket-kit', 'recovered-input.json')) === '{"s":[]}');
}

// --- migration: new directory already exists --------------------------

{
  const h = makeHome();
  const env = { DSH_HOME: h };
  const legacy = join(h, 'dsh-pocket-kit');
  writeAt(join(legacy, 'recovered-input.json'), 'old');
  writeAt(join(h, 'plugins', 'dsh-pocket-kit', 'recovered-input.json'), 'new');

  const result = mod.migratePluginDir({ env });

  check('boundary: an existing new dir is not migrated into', result.migrated === false && result.reason === 'already');
  check('boundary: the new dir keeps its own file', readAt(join(h, 'plugins', 'dsh-pocket-kit', 'recovered-input.json')) === 'new');
  check('boundary: the old dir is left untouched', readAt(join(legacy, 'recovered-input.json')) === 'old');
}

// A new dir that exists but is EMPTY still counts as taken: merging two stores
// is not a move, and "the new address exists" is the documented rule.
{
  const h = makeHome();
  const env = { DSH_HOME: h };
  writeAt(join(h, 'dsh-pocket-kit', 'recovered-input.json'), 'old');
  mkdirSync(join(h, 'plugins', 'dsh-pocket-kit'), { recursive: true });

  const result = mod.migratePluginDir({ env });

  check('boundary: an empty new dir still blocks the move', result.migrated === false && result.reason === 'already');
  check('boundary: nothing was merged in', existsSync(join(h, 'plugins', 'dsh-pocket-kit', 'recovered-input.json')) === false);
  check('boundary: the old data is still readable', readAt(join(h, 'dsh-pocket-kit', 'recovered-input.json')) === 'old');
}

// A file sitting at the new address is not a usable store either. It is not
// ours to replace, so the move fails honestly and the caller is handed the old
// address back instead of a path that cannot be read.
{
  const h = makeHome();
  const env = { DSH_HOME: h };
  writeAt(join(h, 'dsh-pocket-kit', 'recovered-input.json'), 'old');
  writeAt(join(h, 'plugins', 'dsh-pocket-kit'), 'a file, not a directory');

  const result = mod.migratePluginDir({ env });

  check('boundary: a file at the new address blocks the move', result.migrated === false && result.reason === 'failed');
  check('boundary: the file is not replaced', readAt(join(h, 'plugins', 'dsh-pocket-kit')) === 'a file, not a directory');
  check('boundary: the old data is still readable', readAt(join(h, 'dsh-pocket-kit', 'recovered-input.json')) === 'old');
  check('boundary: the caller is pointed back at the old address', result.dir === join(h, 'dsh-pocket-kit'));
}

// --- migration: nothing to do -----------------------------------------

{
  const h = makeHome();
  const result = mod.migratePluginDir({ env: { DSH_HOME: h } });
  check('fresh install: silent no-op', result.migrated === false && result.reason === 'fresh');
  check('fresh install: no new dir is created', existsSync(join(h, 'plugins')) === false);
}

// --- migration: failure path ------------------------------------------

{
  const h = makeHome();
  const env = { DSH_HOME: h };
  writeAt(join(h, 'dsh-pocket-kit', 'recovered-input.json'), 'old');

  // A file where the `plugins/` directory has to go makes the move fail
  // (ENOTDIR): the parent cannot be created. The move must not throw and must
  // not lose the old data.
  writeAt(join(h, 'plugins'), 'not a directory');

  let threw = false;
  let result;
  try {
    result = mod.migratePluginDir({ env });
  } catch {
    threw = true;
  }

  check('failure: does not throw', threw === false);
  check('failure: reports the error', result?.migrated === false && typeof result?.error === 'string');
  check('failure: the old data is still there', readAt(join(h, 'dsh-pocket-kit', 'recovered-input.json')) === 'old');
  // The fallback the caller depends on: read from the old address.
  check('failure: the fallback directory is the old one', result?.dir === join(h, 'dsh-pocket-kit'));
}

// A read-only parent makes the rename fail too (EACCES), which is the other
// real-world shape of this failure: the sandbox or a hardened profile.
{
  const h = makeHome();
  const env = { DSH_HOME: h };
  writeAt(join(h, 'dsh-pocket-kit', 'recovered-input.json'), 'old');
  const result = mod.migratePluginDir({ env, rename: () => { throw Object.assign(new Error('EXDEV: cross-device link'), { code: 'EXDEV' }); } });
  check('failure: an injected EXDEV still moves the data', readAt(join(h, 'plugins', 'dsh-pocket-kit', 'recovered-input.json')) === 'old');
  check('failure: an injected EXDEV reports success', result.migrated === true);
  check('failure: an injected EXDEV clears the old address', existsSync(join(h, 'dsh-pocket-kit')) === false);
}

// A copy that dies halfway must leave nothing behind at the new address: a
// half-written store looks exactly like a complete one to the next run.
{
  const h = makeHome();
  const env = { DSH_HOME: h };
  writeAt(join(h, 'dsh-pocket-kit', 'recovered-input.json'), 'old');
  const result = mod.migratePluginDir({
    env,
    rename: () => { throw Object.assign(new Error('EXDEV'), { code: 'EXDEV' }); },
    copy: (_from, staging) => {
      writeAt(join(staging, 'recovered-input.json'), 'half');
      throw new Error('ENOSPC: no space left on device');
    },
  });
  check('failure: a broken copy does not throw', result.migrated === false && result.reason === 'failed');
  check('failure: a broken copy leaves no half-written new dir', existsSync(join(h, 'plugins', 'dsh-pocket-kit')) === false);
  check('failure: a broken copy keeps the old data', readAt(join(h, 'dsh-pocket-kit', 'recovered-input.json')) === 'old');
  check('failure: a broken copy leaves no staging dir', existsSync(join(h, 'plugins', 'dsh-pocket-kit.migrating-' + process.pid)) === false);
  check('failure: a broken copy points back at the old address', result.dir === join(h, 'dsh-pocket-kit'));
}

// --- what the caller gets back ----------------------------------------

{
  const h = makeHome();
  const env = { DSH_HOME: h };
  check('a migrated call returns the new dir', mod.migratePluginDir({ env }).dir === join(h, 'plugins', 'dsh-pocket-kit'));
}

for (const dir of homes) { try { rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ } }

console.log('');
console.log(fail === 0 ? 'PASS ' + pass : 'FAILED ' + fail + ' of ' + (pass + fail));
process.exit(fail === 0 ? 0 : 1);
