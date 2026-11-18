import { Config, apply, name } from '../lib/index.js';

let pass = 0; let fail = 0;
const check = (n, ok) => { if (ok) { pass += 1; console.log('  ok  ' + n); } else { fail += 1; console.log('  FAIL ' + n); } };

check('name', name === 'dsh-pocket-kit');

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

console.log('');
console.log(fail === 0 ? 'PASS ' + pass : 'FAILED ' + fail + ' of ' + (pass + fail));
process.exit(fail === 0 ? 0 : 1);
