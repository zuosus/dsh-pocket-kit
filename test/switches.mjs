/**
 * The feature switches persist in the plugin's own config file,
 * `$DSH_HOME/plugins/dsh-pocket-kit/config.yaml`, not in the browser's
 * localStorage and not in the profile patch.
 *
 * Written before the implementation, following the repo's test-first rule: every
 * assertion here fails against a build that still stores switches elsewhere (or
 * that puts the file at the pre-Plugins-layout address), never on a syntax error.
 *
 * Every case runs against a fresh temp directory injected through `env`; the real
 * `~/.dsh` is never read and never written.
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

let pass = 0;
let fail = 0;
const check = (name, ok) => {
  if (ok) { pass += 1; console.log('  ok  ' + name); }
  else { fail += 1; console.log('  FAIL ' + name); }
};

const homes = [];
function makeHome() {
  const home = mkdtempSync(join(tmpdir(), 'pbk-cfg-'));
  homes.push(home);
  return home;
}
function writeAt(path, text) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text, 'utf8');
}

const mod = await import('../lib/config-file.js');
const {
  resolveConfigFile,
  readSwitchFile,
  writeSwitchFile,
  createSwitchStore,
  SWITCH_KEYS,
  CONFIG_FILE,
} = mod;
const { PLUGIN_DIR } = mod;

// --- the address ---------------------------------------------------------

check('the config file name is config.yaml', CONFIG_FILE === 'config.yaml');
check('the plugin directory name is dsh-pocket-kit', PLUGIN_DIR === 'dsh-pocket-kit');
check('the file lives under $DSH_HOME/plugins/<name>',
  resolveConfigFile({ env: { DSH_HOME: '/tmp/h' } })
    === join('/tmp/h', 'plugins', 'dsh-pocket-kit', 'config.yaml'));
check('a blank DSH_HOME falls back to ~/.dsh',
  resolveConfigFile({ env: { DSH_HOME: '   ' } }).endsWith(join('.dsh', 'plugins', 'dsh-pocket-kit', 'config.yaml')));
check('an unset DSH_HOME falls back to ~/.dsh',
  resolveConfigFile({ env: {} }).endsWith(join('.dsh', 'plugins', 'dsh-pocket-kit', 'config.yaml')));

// --- every feature switch is known ---------------------------------------

check('all four feature switches are tracked',
  JSON.stringify(SWITCH_KEYS) === JSON.stringify(['customLogo', 'pinBrowsePicker', 'forceSystemModelPicker', 'inputRecovery']));

// --- reading -------------------------------------------------------------

{
  const home = makeHome();
  const env = { DSH_HOME: home };

  // A missing file is the normal state of a fresh install: silent, no values.
  const missing = readSwitchFile(resolveConfigFile({ env }));
  check('a missing file is reported missing, not an error', missing.missing === true && missing.errors.length === 0);
  check('a missing file yields no values', Object.keys(missing.values).length === 0);

  // An empty file is also fine.
  const emptyPath = resolveConfigFile({ env });
  writeAt(emptyPath, '');
  const empty = readSwitchFile(emptyPath);
  check('an empty file is not an error', empty.errors.length === 0 && Object.keys(empty.values).length === 0);
}

{
  const home = makeHome();
  const env = { DSH_HOME: home };
  const path = resolveConfigFile({ env });
  writeAt(path, [
    '# a comment the user wrote',
    'customLogo: false',
    'inputRecovery: true',
    '',
  ].join('\n'));

  const read = readSwitchFile(path);
  check('a written switch is read back', read.values.customLogo === false && read.values.inputRecovery === true);
  check('a switch the file omits is absent, not false',
    Object.hasOwn(read.values, 'pinBrowsePicker') === false);
  check('a good file reports no errors', read.errors.length === 0);
}

{
  const home = makeHome();
  const env = { DSH_HOME: home };
  const path = resolveConfigFile({ env });

  // A malformed file must be reported, not silently ignored: "I changed it and
  // nothing happened" is the hardest failure to self-diagnose.
  writeAt(path, 'customLogo: [unclosed');
  const bad = readSwitchFile(path);
  check('a malformed file reports an error', bad.errors.length > 0);

  // A non-boolean value is reported and skipped, so one bad line cannot take the
  // other switches down with it.
  writeAt(path, 'customLogo: "no"\npinBrowsePicker: true\n');
  const mixed = readSwitchFile(path);
  check('a non-boolean value is reported', mixed.errors.some((e) => e.includes('customLogo')));
  check('a non-boolean value is skipped', Object.hasOwn(mixed.values, 'customLogo') === false);
  check('the other switches still read', mixed.values.pinBrowsePicker === true);

  // A near-miss key is almost always a typo the user expects to work.
  writeAt(path, 'customlogo: true\n');
  const typo = readSwitchFile(path);
  check('a near-miss key is named as a probable typo',
    typo.errors.some((e) => e.includes('customlogo') && e.includes('customLogo')));
}

// --- writing -------------------------------------------------------------

{
  const home = makeHome();
  const env = { DSH_HOME: home };
  const path = resolveConfigFile({ env });

  // Creating the file in a directory that does not exist yet.
  writeSwitchFile({ customLogo: false }, path);
  check('a write creates the file and its parent directories', existsSync(path));
  const first = readSwitchFile(path);
  check('a written switch reads back', first.values.customLogo === false);

  // The write is atomic + comment preserving: a second write must not reformat
  // the file or drop the header comment.
  const withHeader = [
    '# my note',
    'customLogo: true',
    'inputRecovery: false',
    '',
  ].join('\n');
  writeAt(path, withHeader);
  writeSwitchFile({ customLogo: false }, path);
  const text = readFileSync(path, 'utf8');
  check('a write preserves an existing comment', text.includes('# my note'));
  check('a write touches only the named key',
    text.includes('customLogo: false') && text.includes('inputRecovery: false'));

  // Deleting a key (undefined) removes it, so it falls back to the default.
  writeSwitchFile({ customLogo: undefined }, path);
  const afterDelete = readSwitchFile(path);
  check('an undefined value deletes the key', Object.hasOwn(afterDelete.values, 'customLogo') === false);

  // The file is not world readable: it is the plugin's own preference store.
  const mode = statSync(path).mode & 0o777;
  check('the file is not world readable', (mode & 0o004) === 0);
}

{
  const home = makeHome();
  const env = { DSH_HOME: home };
  const path = resolveConfigFile({ env });

  // Refuse to overwrite a file we cannot parse: rewriting it would discard
  // whatever the user wrote there.
  writeAt(path, 'customLogo: [unclosed');
  let threw = false;
  try { writeSwitchFile({ customLogo: false }, path); } catch { threw = true; }
  check('a write refuses to overwrite a malformed file', threw);
  check('the malformed file is left untouched', readFileSync(path, 'utf8').includes('[unclosed'));
}

// --- the live store ------------------------------------------------------

{
  const home = makeHome();
  const env = { DSH_HOME: home };
  const path = resolveConfigFile({ env });

  // The store is the file first, the Config fallback second.
  writeSwitchFile({ inputRecovery: true }, path);
  const store = createSwitchStore({ file: path, fallback: { inputRecovery: false, customLogo: true } });
  check('the store reads the file first (file beats fallback)', store.get('inputRecovery') === true);
  check('the store falls back to Config for a key the file omits', store.get('customLogo') === true);

  writeSwitchFile({ inputRecovery: true }, path);
  store.reload();
  check('after a reload the file wins over the fallback', store.get('inputRecovery') === true);
  check('values() merges file over fallback', store.values().inputRecovery === true);

  // A write through the store refreshes the cache without an explicit reload.
  store.write({ customLogo: false });
  check('a store write is visible immediately', store.get('customLogo') === false);
  check('a store write reaches the disk', readSwitchFile(path).values.customLogo === false);
}

for (const dir of homes) { try { rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ } }

console.log('');
console.log(fail === 0 ? 'PASS ' + pass : 'FAILED ' + fail + ' of ' + (pass + fail));
process.exit(fail === 0 ? 0 : 1);
