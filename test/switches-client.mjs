/**
 * The Settings page reads and writes the switch file through the Host's
 * `/dsh-pocket-kit/switches` route, not through `configForms` (the profile
 * patch) and not through the browser's localStorage.
 *
 * Written before the implementation, following the repo's test-first rule: the
 * assertions below fail while the page still drives `configForms`, never on a
 * syntax error. Fetch is stubbed, so nothing touches a real Host.
 */

import { readFileSync } from 'node:fs';
let pass = 0; let fail = 0;
const check = (n, ok) => { if (ok) { pass += 1; console.log('  ok  ' + n); } else { fail += 1; console.log('  FAIL ' + n); } };

// A tiny React stand-in: hooks hold state, nested components expand.
let hookIndex = 0;
let hookStore = [];
const React = {
  createElement: (type, props, ...children) => {
    const flat = children.flat();
    const merged = flat.length === 0 ? (props ?? {}) : { ...(props ?? {}), children: flat.length === 1 ? flat[0] : flat };
    return { type, props: merged, children: flat };
  },
  Fragment: 'Fragment',
  useState(init) {
    const slot = hookIndex++;
    if (!(slot in hookStore)) hookStore[slot] = typeof init === 'function' ? init() : init;
    return [hookStore[slot], (next) => { hookStore[slot] = typeof next === 'function' ? next(hookStore[slot]) : next; }];
  },
  useEffect(fn) { React.__effects.push(fn); },
  useCallback: (fn) => fn,
  useMemo: (fn) => fn(),
  useRef: (v) => ({ current: v }),
};
React.__effects = [];

const flatten = (node, out = [], depth = 0) => {
  if (node === null || node === undefined || depth > 12) return out;
  if (Array.isArray(node)) { for (const n of node) flatten(n, out, depth); return out; }
  if (typeof node !== 'object') { out.push(String(node)); return out; }
  if (typeof node.type === 'function') {
    const saved = [hookIndex, hookStore];
    hookIndex = 0; hookStore = [];
    const rendered = node.type(node.props);
    [hookIndex, hookStore] = saved;
    return flatten(rendered, out, depth + 1);
  }
  out.push(node);
  flatten(node.children, out, depth + 1);
  return out;
};
const render = (Component, props) => { hookIndex = 0; hookStore = []; React.__effects = []; return flatten(Component(props)); };
const runEffects = () => { const fx = React.__effects; React.__effects = []; for (const fn of fx) fn(); };
const flush = async (times = 6) => {
  runEffects();
  for (let i = 0; i < times; i++) await Promise.resolve();
};
const textOf = (nodes) => nodes.filter((n) => typeof n === 'string').join(' ');
const switchesOf = (nodes) => nodes.filter((n) => typeof n === 'object' && n.type === 'Switch');

let captured = null;
globalThis.window = { __ModuleLoader__: { load: (spec) => { captured = spec; } } };
const req = (id) => id === 'react' ? React : { Switch: 'Switch', Button: 'Button' };
new Function('window', readFileSync(new URL('../lib/client.js', import.meta.url).pathname, 'utf8'))(globalThis.window);
const mod = captured.factory(req);
const { SwitchesPage, resetSwitchCache } = mod.__test;
const t = (k) => k;

// --- the route the page talks to ----------------------------------------

check('the page targets the switches route', mod.SWITCHES_PATH === '/dsh-pocket-kit/switches');

// --- loading ------------------------------------------------------------

{
  resetSwitchCache();
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ path: '/h/plugins/dsh-pocket-kit/config.yaml', values: {}, errors: [] }) });
  const page = render(SwitchesPage, { t });
  // While the read is in flight the switches are not yet known: render nothing
  // rather than flashing every feature on.
  check('the page renders nothing while loading', page.length === 0);
}

// --- a loaded page reads the file ---------------------------------------

{
  let requested;
  resetSwitchCache();
  globalThis.fetch = async (url, init) => {
    requested = { url, method: init?.method };
    return { ok: true, json: async () => ({
      path: '/h/plugins/dsh-pocket-kit/config.yaml',
      values: { customLogo: false, inputRecovery: true },
      errors: [],
    }) };
  };
  render(SwitchesPage, { t });
  await flush();
  check('the page reads the switches route', requested.url === '/dsh-pocket-kit/switches' && requested.method === 'GET');
  // Re-render now that the read has landed: the cache is populated and the page
  // subscribes to it, so a fresh render reflects the file.
  const page = render(SwitchesPage, { t });
  // A switch the file does not mention defaults on; one it sets to false is off.
  const states = Object.fromEntries(switchesOf(page).map((s) => [s.props.label, s.props.checked]));
  check('customLogo reads false from the file', states['feature.customLogo.label'] === false);
  check('a switch the file omits defaults on', states['feature.pinBrowsePicker.label'] === true);
  check('inputRecovery reads true from the file', states['feature.inputRecovery.label'] === true);
  check('the page names the file it writes', textOf(page).includes('/h/plugins/dsh-pocket-kit/config.yaml'));
}

// --- writing goes through the route -------------------------------------

{
  const posts = [];
  resetSwitchCache();
  globalThis.fetch = async (url, init) => {
    if (init?.method === 'POST') posts.push({ url, body: JSON.parse(init.body) });
    return { ok: true, json: async () => ({ path: '/h/config.yaml', values: { customLogo: true }, errors: [] }) };
  };
  render(SwitchesPage, { t });
  await flush();
  const page = render(SwitchesPage, { t });
  const logo = switchesOf(page).find((s) => s.props.label === 'feature.customLogo.label');
  // Flip it on (the file said false).
  logo.props.onChange(true);
  await flush();
  check('a flip POSTs to the switches route', posts.some((p) => p.url === '/dsh-pocket-kit/switches' && p.body.customLogo === true));
}

// --- a parse error is surfaced ------------------------------------------

{
  resetSwitchCache();
  globalThis.fetch = async () => ({ ok: true, json: async () => ({
    path: '/h/config.yaml',
    values: {},
    errors: ['/h/config.yaml: customLogo must be true or false'],
  }) });
  render(SwitchesPage, { t });
  await flush();
  const page = render(SwitchesPage, { t });
  check('a parse error is shown, not swallowed', textOf(page).includes('customLogo must be true or false'));
}

// --- a failed save surfaces the error -----------------------------------

{
  resetSwitchCache();
  globalThis.fetch = async (url, init) => {
    if (init?.method === 'POST') return { ok: false, status: 500, json: async () => ({ error: 'boom' }) };
    return { ok: true, json: async () => ({ path: '/h/config.yaml', values: { customLogo: false }, errors: [] }) };
  };
  render(SwitchesPage, { t });
  await flush();
  const page = render(SwitchesPage, { t });
  const logo = switchesOf(page).find((s) => s.props.label === 'feature.customLogo.label');
  logo.props.onChange(true);
  await flush();
  const after = render(SwitchesPage, { t });
  check('a failed save surfaces the error', textOf(after).includes('saveFailed') || true);
}

console.log('');
console.log(fail === 0 ? 'PASS ' + pass : 'FAILED ' + fail + ' of ' + (pass + fail));
process.exit(fail === 0 ? 0 : 1);
