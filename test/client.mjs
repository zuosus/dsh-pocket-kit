import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

let pass = 0; let fail = 0;
const check = (n, ok) => { if (ok) { pass += 1; console.log('  ok  ' + n); } else { fail += 1; console.log('  FAIL ' + n); } };

// --- stubs -------------------------------------------------------------
const calls = { fetch: [] };
const fakeFetch = async (url, init) => {
  calls.fetch.push({ url: String(url), init });
  if (String(url).includes('/ack')) {
    return { ok: true, json: async () => ({ ok: true }) };
  }
  return {
    ok: true,
    json: async () => ({ items: [{ id: 'a:1:m', text: 'hello', reason: 'boom', turn: 1, at: 1 }] }),
  };
};
globalThis.fetch = fakeFetch;

const React = {
  createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
  Fragment: 'Fragment',
  useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
  useEffect: () => {},
  useCallback: (fn) => fn,
  useMemo: (fn) => fn(),
  useRef: (v) => ({ current: v }),
};

const primitives = {
  Switch: 'Switch',
  Button: 'Button',
};

let captured = null;
globalThis.window = {
  __ModuleLoader__: {
    load: (spec) => { captured = spec; },
  },
};

const requireShim = (id) => {
  if (id === 'react') return React;
  if (id === '@deepseek-ai/dsh-client-ui-primitives') return primitives;
  throw new Error('unexpected require: ' + id);
};

// --- load the bundle ---------------------------------------------------
const source = readFileSync(new URL('../lib/client.js', import.meta.url).pathname, 'utf8');
const factory = new Function('window', 'navigator', 'document', 'setInterval', 'clearInterval', source);
factory(globalThis.window, { clipboard: { writeText: async () => {} } }, undefined, () => 0, () => {});
check('bundle registered itself', captured !== null);
check('loader id', captured?.id === 'dsh-pocket-kit');

const exported = captured.factory(requireShim);
check('exports apply', typeof exported.apply === 'function');
check('exports inject list', Array.isArray(exported.inject));
check('inject has the settings seats', exported.inject.includes('configForms') && exported.inject.includes('slots'));
check('feature list', exported.FEATURES.map((f) => f.id).join(',') === 'pinBrowsePicker,inputRecovery,customLogo,forceSystemModelPicker');
check('the force-system switch is reload-scoped', exported.FEATURES.find((f) => f.id === 'forceSystemModelPicker')?.hint === 'reloadHint');
check('custom logo is not restart-scoped', exported.FEATURES.find((f) => f.id === 'customLogo')?.restart !== true);
check('logo route constant', exported.LOGO_ROUTE === '/dsh-pocket-kit/logo');
check('logo route is the only logo export', exported.DEFAULT_LOGO_FILE === undefined);
check('picker feature is restart-scoped', exported.FEATURES.find((f) => f.id === 'pinBrowsePicker')?.restart === true);
check('input recovery is not restart-scoped', exported.FEATURES.find((f) => f.id === 'inputRecovery')?.restart !== true);
check('route constants', exported.RECOVERED_PATH === '/dsh-pocket-kit/recovered-input'
  && exported.RECOVERED_ACK_PATH === '/dsh-pocket-kit/recovered-input/ack');

// --- route helpers -----------------------------------------------------
const items = await exported.fetchRecovered('session-1');
check('fetch returns items', items.length === 1 && items[0].text === 'hello');
check('fetch encodes the session', calls.fetch.at(-1).url === '/dsh-pocket-kit/recovered-input?session=session-1');
check('empty session makes no request', (await exported.fetchRecovered('')).length === 0);

await exported.ackRecovered('session-1', ['a:1:m']);
const ackCall = calls.fetch.at(-1);
check('ack posts json', ackCall.init.method === 'POST'
  && JSON.parse(ackCall.init.body).ids[0] === 'a:1:m');
check('empty ack is a no-op', await (async () => {
  const before = calls.fetch.length;
  await exported.ackRecovered('s', []);
  return calls.fetch.length === before;
})());

// --- apply() installs the section and the dock -------------------------
const registrations = [];
const ctx = {
  effect(fn) { return fn(); },
  slots: {
    inject(seat, body) { registrations.push(seat); return body(); },
    register(spec, Component) { registrations.push({ ...spec, Component }); return () => {}; },
  },
  locale: {
    register() { return () => {}; },
    bind() { return (key, params) => key + (params?.reason ? ':' + params.reason : ''); },
  },
  configForms: {
    get() {
      return { getSnapshot: () => ({ value: { inputRecovery: true } }), set: async () => true };
    },
    whileServed(namespaces, body) { return body(); },
  },
};
exported.apply(ctx);
check('registers the settings section', registrations.some((r) => r?.name === 'settings.section'));
check('registers the logo seat', registrations.includes('sidebar.brand.mark'));
check('registers the composer dock', registrations.some((r) => r?.name === 'conversation.input.dock'));
check('section id is the namespace', registrations.some((r) => r?.name === 'settings.section' && r.id === 'dsh-pocket-kit'));
check('registers the nav icon', registrations.some((r) => r?.name === 'settings.section.icon' && r.id === 'dsh-pocket-kit'));
check('nav icon is an svg component', typeof registrations.find((r) => r?.name === 'settings.section.icon')?.Component === 'function');

// --- the force-system switch drives the shared picker key --------------
// apply() must reconcile the key from Config on install, so a page that loads
// with the switch already on shows the system picker without opening Settings.
{
  const storage = new Map();
  globalThis.localStorage = {
    getItem: (k) => (storage.has(k) ? storage.get(k) : null),
    setItem: (k, v) => { storage.set(k, String(v)); },
    removeItem: (k) => { storage.delete(k); },
  };
  const config = { forceSystemModelPicker: true };
  let listener;
  const forceCtx = {
    effect(fn) { return fn(); },
    slots: { inject(seat, body) { return body(); }, register() { return () => {}; } },
    locale: { register() { return () => {}; }, bind() { return (k) => k; } },
    configForms: {
      get() {
        return {
          getSnapshot: () => ({ value: { ...config } }),
          set: async () => true,
          subscribe(fn) { listener = fn; return () => { listener = undefined; }; },
        };
      },
      whileServed(ns, body) { return body(); },
    },
  };
  exported.apply(forceCtx);
  check('apply forces the system picker when the switch is on', storage.get('dshmf:mode') === 'native');
  check('apply subscribes to the switch for live changes', typeof listener === 'function');

  // Flip the switch off: the key returns to the state it had before forcing.
  config.forceSystemModelPicker = false;
  listener?.();
  check('flipping the switch off stops forcing', storage.has('dshmf:mode') === false);
  delete globalThis.localStorage;
}

// --- the corner logo replaces the shell's mark -------------------------
const brand = registrations.find((r) => r?.name === 'sidebar.brand.mark');
check('registers a sidebar brand mark', brand !== undefined);
check('brand mark id is namespaced', brand?.id === 'dsh-pocket-kit/logo');
// A single-kind slot renders its LOWEST priority, and the official mark sits at
// the default 0: -1 is what actually wins the corner.
check('brand mark shadows the official one', brand?.priority === -1);
check('brand mark is a component', typeof brand?.Component === 'function');

console.log('');
console.log(fail === 0 ? 'PASS ' + pass : 'FAILED ' + fail + ' of ' + (pass + fail));
process.exit(fail === 0 ? 0 : 1);