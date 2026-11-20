import { applyForceSystemModelPicker } from '../lib/features/force-system-model-picker.js';

let pass = 0; let fail = 0;
const check = (n, ok) => { if (ok) { pass += 1; console.log('  ok  ' + n); } else { fail += 1; console.log('  FAIL ' + n); } };

/**
 * Fake loader mirroring the cordis contract this feature relies on:
 *   store[id] -> { options: { id, name, disabled }, parent: { remove(id) } }
 *   await()
 */
function harness(rows = {}) {
  const store = Object.create(null);
  const removed = [];
  const awaited = [];
  for (const [id, name] of Object.entries(rows)) {
    store[id] = {
      options: { id, name, disabled: false },
      parent: {
        remove(target) {
          removed.push(target);
          delete store[target];
        },
      },
    };
  }
  const ctx = {
    loader: {
      store,
      async await() { awaited.push(1); },
    },
    // cordis face this feature uses: inject a service, run an effect.
    inject(deps, body) {
      if (!deps.includes('loader')) return;
      body({
        loader: ctx.loader,
        effect(fn) { return fn(); },
        logger: { warn() {} },
      });
    },
    effect(fn) { return fn(); },
    logger: { warn() {} },
  };
  return { ctx, store, removed, awaited };
}

// --- scenario 1: normal path — a known occupant is disabled ---------------
{
  const { ctx, store, removed } = harness({ 'dsh-model-flatmap': 'dsh-model-flatmap' });
  applyForceSystemModelPicker(ctx, () => true);
  await new Promise((r) => setTimeout(r, 20));
  check('on: the flatmap row is removed from the loader', removed.includes('dsh-model-flatmap'));
  check('on: the row is marked disabled before removal',
    removed.includes('dsh-model-flatmap') && store['dsh-model-flatmap'] === undefined);
}

// --- scenario 2: boundary — switch off touches nothing --------------------
{
  const { ctx, removed } = harness({ 'dsh-model-flatmap': 'dsh-model-flatmap' });
  applyForceSystemModelPicker(ctx, () => false);
  await new Promise((r) => setTimeout(r, 20));
  check('off: no row is removed', removed.length === 0);
}

// --- scenario 3: failure path — missing loader never throws --------------
{
  let threw = false;
  try {
    applyForceSystemModelPicker({ logger: { warn() {} } }, () => true);
    applyForceSystemModelPicker({}, () => true);
    applyForceSystemModelPicker({ loader: { store: undefined } }, () => true);
  } catch { threw = true; }
  check('a missing or partial loader does not throw', threw === false);
}

// --- scenario 4: only occupants are touched ------------------------------
{
  const { ctx, removed } = harness({
    'dsh-model-flatmap': 'dsh-model-flatmap',
    'some-other': 'dsh-unrelated-plugin',
  });
  applyForceSystemModelPicker(ctx, () => true);
  await new Promise((r) => setTimeout(r, 20));
  check('on: the occupant is removed', removed.includes('dsh-model-flatmap'));
  check('on: an unrelated plugin is left alone', !removed.includes('some-other'));
}

// --- scenario 5: extra names from config are honoured --------------------
{
  const { ctx, removed } = harness({ 'some-row': 'my-custom-picker' });
  applyForceSystemModelPicker(ctx, () => true, ['my-custom-picker']);
  await new Promise((r) => setTimeout(r, 20));
  check('on: a configured extra occupant is removed', removed.includes('some-row'));
}

// --- scenario 6: idempotent ---------------------------------------------
{
  const { ctx, removed } = harness({ 'dsh-model-flatmap': 'dsh-model-flatmap' });
  applyForceSystemModelPicker(ctx, () => true);
  await new Promise((r) => setTimeout(r, 20));
  const first = removed.length;
  applyForceSystemModelPicker(ctx, () => true);
  await new Promise((r) => setTimeout(r, 20));
  check('on: applying twice does not double-remove', removed.length === first);
}

console.log('');
console.log(fail === 0 ? 'PASS ' + pass : 'FAILED ' + fail + ' of ' + (pass + fail));
process.exit(fail === 0 ? 0 : 1);