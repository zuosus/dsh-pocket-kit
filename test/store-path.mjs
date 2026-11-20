/**
 * Where input-recovery persists, and what it does when the move fails.
 *
 * The store path used to be a module-level constant built from `homedir()`, so
 * it ignored `$DSH_HOME` entirely and no test could point it at a temp
 * directory. It is a function now, which is also what lets the fallback below
 * exist: a failed migration reads the old address instead of losing the data.
 *
 * Every case runs against a fresh temp directory injected through `env`.
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

let pass = 0;
let fail = 0;
const check = (name, ok) => {
  if (ok) { pass += 1; console.log('  ok  ' + name); }
  else { fail += 1; console.log('  FAIL ' + name); }
};

const recovery = await import('../lib/features/input-recovery.js');

const homes = [];
function makeHome() {
  const home = mkdtempSync(join(tmpdir(), 'pbk-store-'));
  homes.push(home);
  return home;
}

function writeAt(path, text) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text, 'utf8');
}

/** Minimal Host ctx: enough to install the watcher and its two routes. */
function harness() {
  const listeners = [];
  const routes = [];
  const ctx = {
    effect(fn) { return fn(); },
    inject(deps, body) {
      body({
        effect(fn) { fn(); },
        webServer: { register(spec) { routes.push(spec); return () => {}; } },
        connection: { requestRejection: () => undefined },
      });
    },
    on(event, listener) { if (event === 'session/event') listeners.push(listener); },
    logger: { warn() {} },
  };
  return { ctx, listeners, routes };
}

const readRoute = (routes) => routes.find((r) => r.path.endsWith('/recovered-input'));
const read = async (routes, sessionId) => {
  const res = { statusCode: 0, setHeader() {}, end(body) { this.body = body ?? ''; } };
  await readRoute(routes).handler({ method: 'GET', url: '/dsh-pocket-kit/recovered-input?session=' + sessionId, headers: {} }, res);
  return JSON.parse(res.body).items;
};

// --- the resolved path -------------------------------------------------

check('the store path is a function, not a constant', typeof recovery.resolveStorePath === 'function');

// Until the implementation lands the export is missing; report that as a failed
// assertion instead of crashing the whole suite on the first call.
const resolveStorePath = recovery.resolveStorePath ?? (() => undefined);

{
  const home = makeHome();
  const path = resolveStorePath({ env: { DSH_HOME: home } });
  check('the store lives under $DSH_HOME/plugins', path === join(home, 'plugins', 'dsh-pocket-kit', 'recovered-input.json'));
  check('the old constant is gone', recovery.STORE_PATH === undefined);
}

// --- the fallback ------------------------------------------------------

{
  // The new address is blocked by a file, so the move cannot happen. The store
  // must then be read from the old address: a failed migration may not lose a
  // pending recovery, and it may not fail the feature either.
  const home = makeHome();
  const env = { DSH_HOME: home };
  writeAt(join(home, 'dsh-pocket-kit', 'recovered-input.json'), JSON.stringify({
    'session-legacy': [{ id: 'session-legacy:1:m', sessionId: 'session-legacy', turn: 1, text: 'kept across the failed move', reason: 'boom', at: 1 }],
  }));
  writeAt(join(home, 'plugins', 'dsh-pocket-kit'), 'a file, not a directory');

  const path = resolveStorePath({ env });
  check('a failed move falls back to the old address', path === join(home, 'dsh-pocket-kit', 'recovered-input.json'));

  const { ctx, routes } = harness();
  let threw = false;
  try { recovery.applyInputRecovery(ctx, () => true, { env }); } catch { threw = true; }
  check('a failed move does not break the feature', threw === false);
  check('the fallback store is still served', (await read(routes, 'session-legacy'))[0]?.text === 'kept across the failed move');
}

// --- the normal path ---------------------------------------------------

{
  const home = makeHome();
  const env = { DSH_HOME: home };
  writeAt(join(home, 'dsh-pocket-kit', 'recovered-input.json'), JSON.stringify({
    'session-moved': [{ id: 'session-moved:1:m', sessionId: 'session-moved', turn: 1, text: 'moved', reason: 'boom', at: 1 }],
  }));

  const { ctx, routes } = harness();
  recovery.applyInputRecovery(ctx, () => true, { env });

  check('a moved store is served from the new address', (await read(routes, 'session-moved'))[0]?.text === 'moved');
  check('the old address is gone after the move', (() => { try { readFileSync(join(home, 'dsh-pocket-kit', 'recovered-input.json')); return false; } catch { return true; } })());
  check('the new address holds the store', (() => {
    try { return readFileSync(join(home, 'plugins', 'dsh-pocket-kit', 'recovered-input.json'), 'utf8').includes('moved'); } catch { return false; }
  })());
}

for (const dir of homes) { try { rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ } }

console.log('');
console.log(fail === 0 ? 'PASS ' + pass : 'FAILED ' + fail + ' of ' + (pass + fail));
process.exit(fail === 0 ? 0 : 1);
