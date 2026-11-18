import { applyPinBrowsePicker } from '../lib/features/pin-browse-picker.js';

let pass = 0; let fail = 0;
const check = (n, ok) => { if (ok) { pass += 1; console.log('  ok  ' + n); } else { fail += 1; console.log('  FAIL ' + n); } };

/** Fake loader mirroring the create/resolve/store/fiber-await contract. */
function harness() {
  const store = Object.create(null);
  const created = [];
  const ctx = {
    loader: {
      store,
      async create({ id, name }) {
        if (store[id] !== undefined) throw new Error('duplicate entry ' + id);
        store[id] = { id, name, fiber: { await: async () => undefined } };
        created.push(name);
        return id;
      },
    },
    inject(deps, body) {
      // A cordis child ctx inherits the parent's services, so `child.loader`
      // is the same loader.
      body({ effect(fn) { return fn(); }, loader: ctx.loader });
    },
  };
  return { ctx, store, created };
}

// --- switch on: the pinned browse pair, backend before surface -----------
{
  const { ctx, created } = harness();
  applyPinBrowsePicker(ctx, () => true);
  await new Promise((r) => setTimeout(r, 20));
  check('on: two rows mounted', created.length === 2);
  check('on: backend first', created[0] === '@deepseek-ai/dsh-host-directory-picker-browse');
  check('on: surface second', created[1] === '@deepseek-ai/dsh-client-ui-directory-picker-browse');
  check('on: no auto selector', !created.some((n) => n.includes('directory-picker-auto')));
}

// --- switch off: the stock auto selector, nothing pinned -----------------
{
  const { ctx, created, store } = harness();
  applyPinBrowsePicker(ctx, () => false);
  await new Promise((r) => setTimeout(r, 20));
  check('off: exactly one row mounted', created.length === 1);
  check('off: it is the auto selector', created[0] === '@deepseek-ai/dsh-host-directory-picker-auto');
  check('off: no pinned browse rows', !created.some((n) => n.includes('-browse')));
  check('off: mounted row has a stable id', store['directory-picker-auto-mounted'] !== undefined);
}

// --- idempotent: a row that already exists is not mounted twice ----------
{
  const { ctx, created, store } = harness();
  store['directory-picker-browse'] = { id: 'directory-picker-browse', name: 'x', fiber: { await: async () => undefined } };
  applyPinBrowsePicker(ctx, () => true);
  await new Promise((r) => setTimeout(r, 20));
  check('existing row is reused', !created.includes('@deepseek-ai/dsh-host-directory-picker-browse'));
  check('missing row is still mounted', created.includes('@deepseek-ai/dsh-client-ui-directory-picker-browse'));
}

// --- read once per boot: a later switch change does not re-compose -------
{
  const { ctx, created } = harness();
  let on = true;
  applyPinBrowsePicker(ctx, () => on);
  await new Promise((r) => setTimeout(r, 20));
  const afterBoot = created.length;
  on = false;
  await new Promise((r) => setTimeout(r, 20));
  check('no live swap after boot', created.length === afterBoot);
}

console.log('');
console.log(fail === 0 ? 'PASS ' + pass : 'FAILED ' + fail + ' of ' + (pass + fail));
process.exit(fail === 0 ? 0 : 1);
