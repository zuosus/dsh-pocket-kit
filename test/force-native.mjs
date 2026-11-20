import { readFileSync } from 'node:fs';

let pass = 0; let fail = 0;
const check = (n, ok) => { if (ok) { pass += 1; console.log('  ok  ' + n); } else { fail += 1; console.log('  FAIL ' + n); } };

const source = readFileSync(new URL('../lib/client.js', import.meta.url).pathname, 'utf8');

// Load the bundle exactly like the page does, with a minimal module table.
let captured = null;
const React = {
  createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
  Fragment: 'Fragment',
  useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
  useEffect: () => {},
  useCallback: (fn) => fn,
  useMemo: (fn) => fn(),
  useRef: (v) => ({ current: v }),
};
globalThis.window = { __ModuleLoader__: { load: (spec) => { captured = spec; } } };
const factory = new Function('window', 'navigator', 'document', 'setInterval', 'clearInterval', source);
factory(globalThis.window, { clipboard: { writeText: async () => {} } }, undefined, () => 0, () => {});
const exported = captured.factory((id) => {
  if (id === 'react') return React;
  if (id === '@deepseek-ai/dsh-client-ui-primitives') return { Switch: 'Switch', Button: 'Button' };
  throw new Error('unexpected require: ' + id);
});

const create = exported.__test?.createForceSystemModelPicker;
check('driver factory is exported', typeof create === 'function');

/** A minimal localStorage double over a Map. */
const makeStore = (initial) => {
  const map = new Map(Object.entries(initial ?? {}));
  return {
    map,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
  };
};

// --- scenario 1: normal path — the switch forces the system picker ---------
{
  const storage = makeStore({});
  const driver = create({ localStorage: storage });
  driver.sync(true);
  check('on: writes dshmf:mode = native', storage.map.get('dshmf:mode') === 'native');
  driver.sync(true);
  check('on: is idempotent', storage.map.get('dshmf:mode') === 'native');
}

// --- scenario 2: boundary — off restores what the user had ---------------
{
  // The user had deliberately chosen the flat panel before the switch was on.
  const storage = makeStore({ 'dshmf:mode': 'flat' });
  const driver = create({ localStorage: storage });
  driver.sync(true);
  check('force displaces the user choice', storage.map.get('dshmf:mode') === 'native');
  driver.sync(false);
  check('off: restores the displaced user choice', storage.map.get('dshmf:mode') === 'flat');

  // A user who never chose anything gets no invented preference written back.
  const fresh = makeStore({});
  const driver2 = create({ localStorage: fresh });
  driver2.sync(true);
  driver2.sync(false);
  check('off: never invents a preference that was absent', fresh.map.has('dshmf:mode') === false);
}

// --- scenario 3: failure path — blocked storage never throws --------------
{
  const hostile = {
    getItem() { throw new Error('blocked'); },
    setItem() { throw new Error('blocked'); },
    removeItem() { throw new Error('blocked'); },
  };
  let threw = false;
  try {
    const driver = create({ localStorage: hostile });
    driver.sync(true);
    driver.sync(false);
  } catch { threw = true; }
  check('blocked storage does not throw', threw === false);

  let missingThrew = false;
  try {
    const driver = create({ localStorage: undefined });
    driver.sync(true);
    driver.sync(false);
  } catch { missingThrew = true; }
  check('missing storage does not throw', missingThrew === false);
}

// --- read is defensive ----------------------------------------------------
{
  const storage = makeStore({ 'dshmf:mode': 'native' });
  check('read returns the stored mode', create({ localStorage: storage }).read() === 'native');
  check('read degrades to flat when absent', create({ localStorage: makeStore({}) }).read() === 'flat');
  check('read ignores unknown values', create({ localStorage: makeStore({ 'dshmf:mode': 'bogus' }) }).read() === 'flat');
}

console.log('');
console.log(fail === 0 ? 'PASS ' + pass : 'FAILED ' + fail + ' of ' + (pass + fail));
process.exit(fail === 0 ? 0 : 1);
