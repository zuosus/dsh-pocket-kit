import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// `apply()` performs the one-time move of this package's data directory, so it
// must run against a temp DSH home. Setting the env before the dynamic import is
// what makes that stick: a static import would hoist above this line.
const HOME = mkdtempSync(join(tmpdir(), 'pbk-config-'));
process.env.DSH_HOME = HOME;

const { Config, apply, name } = await import('../lib/index.js');

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
check('default installs every feature', installed.length === 3);

installed.length = 0;
apply(makeCtx(), Config({ inputRecovery: false }));
check('inputRecovery off leaves the others installed', installed.length === 2);

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
check('undefined config installs defaults', installed.length === 3);

// live flip: the enabled() predicate reads the reference each time
installed.length = 0;
const live = Config({});
const routes = [];
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
      webServer: { register(spec) { routes.push(spec); return () => {}; } },
      connection: { requestRejection: () => undefined },
    });
  },
  on() {},
  logger: { warn() {} },
};
apply(liveCtx, live);
check('live: features installed', routes.length === 3);

// turn it off through the volatile write path, then confirm the route answers empty
live.inputRecovery[live.inputRecovery && Symbol.for('cosmokit.volatile.write')]
  ? live.inputRecovery[Symbol.for('cosmokit.volatile.write')](false)
  : null;
const readRoute = routes.find((r) => r.path.endsWith('/recovered-input'));
const res = { statusCode: 0, setHeader() {}, end(body) { this.body = body ?? ''; } };
await readRoute.handler({ method: 'GET', url: '/dsh-pocket-kit/recovered-input?session=x', headers: {} }, res);
check('live: off answers empty', JSON.parse(res.body).items.length === 0);

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