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
check('feature list', exported.FEATURES.map((f) => f.id).join(',') === 'pinBrowsePicker,inputRecovery');
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
check('registers the composer dock', registrations.some((r) => r?.name === 'conversation.input.dock'));
check('section id is the namespace', registrations.some((r) => r?.name === 'settings.section' && r.id === 'dsh-pocket-kit'));
check('registers the nav icon', registrations.some((r) => r?.name === 'settings.section.icon' && r.id === 'dsh-pocket-kit'));
check('nav icon is an svg component', typeof registrations.find((r) => r?.name === 'settings.section.icon')?.Component === 'function');

console.log('');
console.log(fail === 0 ? 'PASS ' + pass : 'FAILED ' + fail + ' of ' + (pass + fail));
process.exit(fail === 0 ? 0 : 1);
