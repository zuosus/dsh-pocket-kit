import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// `apply()` performs the one-time move of this package's data directory, so it
// must run against a temp DSH home. Setting the env before the dynamic import is
// what makes that stick: a static import would hoist above this line.
const HOME = mkdtempSync(join(tmpdir(), 'pbk-config-'));
process.env.DSH_HOME = HOME;

const { Config, apply, name } = await import('../lib/index.js');
const { writeSwitchFile, resolveConfigFile } = await import('../lib/config-file.js');

let pass = 0; let fail = 0;
const check = (n, ok) => { if (ok) { pass += 1; console.log('  ok  ' + n); } else { fail += 1; console.log('  FAIL ' + n); } };

check('name', name === 'dsh-pocket-kit');

const defaults = Config({});
// A volatile key is a live reference; unwrap it the way the Host does.
const plain = (v) => (v !== null && typeof v === 'object' && typeof v.get === 'function' ? v.get() : v);
check('forceSystemModelPicker defaults off', plain(defaults.forceSystemModelPicker) === false);
check('the other switches still default on', plain(defaults.inputRecovery) === true && plain(defaults.pinBrowsePicker) === true && plain(defaults.customLogo) === true);
check('extraOccupants defaults to an empty list', Array.isArray(plain(defaults.extraOccupants)) && plain(defaults.extraOccupants).length === 0);

const installed = [];
const makeCtx = () => ({
  effect(fn) { return fn(); },
  fiber: {},
  inject(deps, body) {
    // `settings` is the auto-page policy seat; only feature installs count.
    if (deps.includes("settings")) {
      body({ effect(fn) { fn(); }, settings: { configure: () => () => {} } });
      return;
    }
    installed.push(1);
    body({
      effect(fn) { fn(); },
      // The switches route is installed alongside the features; the harness
      // provides the seats it needs so apply() runs to completion.
      webServer: { register() { return () => {}; } },
      connection: { requestRejection: () => undefined },
    });
  },
  on() {},
  logger: { warn() {} },
});

const on = Config({});
check('default inputRecovery on', on.inputRecovery.get() === true);
check('default pinBrowsePicker on', on.pinBrowsePicker.get() === true);
apply(makeCtx(), on);
check('default installs every feature', installed.length === 4);

// The switch file is the source of truth: a key it writes wins over Config.
writeSwitchFile({ inputRecovery: false }, resolveConfigFile());
installed.length = 0;
apply(makeCtx(), Config({ inputRecovery: true }));
check('the switch file beats a Config that says on', installed.length === 3);

// A key the file does not mention still falls back to the patch.
writeSwitchFile({}, resolveConfigFile());
installed.length = 0;
apply(makeCtx(), Config({ inputRecovery: false }));
check('Config is still the fallback for a key the file omits', installed.length === 3);
// The file the off-case wrote must not leak into the cases below: a missing file
// is the normal state, so remove it rather than leaving an empty mapping behind.
rmSync(resolveConfigFile(), { force: true });

// The new feature is Host-inert: it must install without throwing and without
// claiming a Host capability, whether its switch is on or off.
let forceThrew = false;
try {
  apply(makeCtx(), Config({ forceSystemModelPicker: true }));
  apply(makeCtx(), Config({ forceSystemModelPicker: false }));
} catch {
  forceThrew = true;
}
check('forceSystemModelPicker installs without a Host capability', forceThrew === false);

installed.length = 0;
apply(makeCtx(), undefined);
check('undefined config installs defaults', installed.length === 4);

// live flip: the enabled() predicate reads the reference each time
installed.length = 0;
const live = Config({});
const routes = [];
// A mock request that feeds one JSON body to the route's readBody().
const jsonReq = (payload) => {
  const body = JSON.stringify(payload);
  return { method: 'POST', url: '/dsh-pocket-kit/switches', headers: {},
    on(event, fn) { if (event === 'data') fn(Buffer.from(body)); if (event === 'end') fn(); } };
};
const call = async (route, method, req) => {
  const res = { statusCode: 0, setHeader() {}, end(body) { this.body = body ?? ''; } };
  await route.handler({ ...req, method }, res);
  return res;
};
const liveCtx = {
  effect(fn) { return fn(); },
  fiber: {},
  inject(deps, body) {
    if (deps.includes("settings")) {
      body({ effect(fn) { fn(); }, settings: { configure: () => () => {} } });
      return;
    }
    body({
      effect(fn) { fn(); },
      // The switches route and every feature install now consume this seat, so
      // the route list (not an inject count) is what the live assertions read.
      webServer: { register(spec) { routes.push(spec); return () => {}; } },
      connection: { requestRejection: () => undefined },
    });
  },
  on() {},
  logger: { warn() {} },
};
apply(liveCtx, live);
// Three feature routes (recovery read, recovery ack, logo) plus the switches
// route. Counting routes is the live stand-in for "every feature installed",
// because a feature install and the switches route now share the webServer seat.
check('live: features installed', routes.length === 4);
check('live: the switches route is registered', routes.some((r) => r.path.endsWith('/switches')));

// Turn inputRecovery off through the switches route -- the same write the
  // Settings page makes -- then confirm the recovery route answers empty without
  // a restart: the two share one switch store, so the write is visible at once.
const switchesRoute = routes.find((r) => r.path.endsWith('/switches'));
const read1 = await call(switchesRoute, 'GET', { url: '/dsh-pocket-kit/switches', headers: {} });
check('live: GET reads the effective switches', JSON.parse(read1.body).values.inputRecovery === true);

const written = await call(switchesRoute, 'POST', jsonReq({ inputRecovery: false }));
check('live: the write lands', JSON.parse(written.body).values.inputRecovery === false);

const readRoute = routes.find((r) => r.path.endsWith('/recovered-input'));
const res = { statusCode: 0, setHeader() {}, end(body) { this.body = body ?? ''; } };
await readRoute.handler({ method: 'GET', url: '/dsh-pocket-kit/recovered-input?session=x', headers: {} }, res);
check('live: off answers empty without a restart', JSON.parse(res.body).items.length === 0);

// contained failure
const FEATURES = (await import('../lib/features/index.js')).FEATURES;
const original = FEATURES[0].apply;
FEATURES[0].apply = () => { throw new Error('boom'); };
let threw = false;
try { apply(makeCtx(), Config({})); } catch { threw = true; }
FEATURES[0].apply = original;
check('a failing feature is contained', threw === false);

// Only the temp home this suite created is removed.
rmSync(HOME, { recursive: true, force: true });

console.log('');
console.log(fail === 0 ? 'PASS ' + pass : 'FAILED ' + fail + ' of ' + (pass + fail));
process.exit(fail === 0 ? 0 : 1);