import { readFileSync } from 'node:fs';
let pass = 0; let fail = 0;
const check = (n, ok) => { if (ok) { pass += 1; console.log('  ok  ' + n); } else { fail += 1; console.log('  FAIL ' + n); } };

// A tiny React stand-in. Hooks hold real state, and nested function
// components are expanded, so one render yields the full element tree.
let hookIndex = 0;
let hookStore = [];
const React = {
  createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat() }),
  Fragment: 'Fragment',
  useState(init) {
    const slot = hookIndex++;
    if (!(slot in hookStore)) hookStore[slot] = typeof init === 'function' ? init() : init;
    return [hookStore[slot], (next) => { hookStore[slot] = typeof next === 'function' ? next(hookStore[slot]) : next; }];
  },
  useEffect() {},
  useCallback: (fn) => fn,
  useMemo: (fn) => fn(),
  useRef: (v) => ({ current: v }),
};

const flatten = (node, out = [], depth = 0) => {
  if (node === null || node === undefined || depth > 12) return out;
  if (Array.isArray(node)) { for (const n of node) flatten(n, out, depth); return out; }
  if (typeof node !== 'object') { out.push(String(node)); return out; }
  if (typeof node.type === 'function') {
    // A nested component: render it in its own hook frame and descend.
    const saved = [hookIndex, hookStore];
    hookIndex = 0;
    hookStore = [];
    const rendered = node.type(node.props);
    [hookIndex, hookStore] = saved;
    return flatten(rendered, out, depth + 1);
  }
  out.push(node);
  flatten(node.children, out, depth + 1);
  return out;
};
const render = (Component, props) => { hookIndex = 0; hookStore = []; return flatten(Component(props)); };
const textOf = (nodes) => nodes.filter((n) => typeof n === 'string').join(' ');
const typesOf = (nodes) => nodes.filter((n) => typeof n === 'object').map((n) => n.type);
const findType = (nodes, type) => nodes.find((n) => typeof n === 'object' && n.type === type);

let captured = null;
globalThis.window = { __ModuleLoader__: { load: (spec) => { captured = spec; } } };
globalThis.fetch = async () => ({ ok: true, json: async () => ({ items: [] }) });
const req = (id) => id === 'react' ? React : { Switch: 'Switch', Button: 'Button' };
new Function('window', readFileSync(new URL('../lib/client.js', import.meta.url).pathname, 'utf8'))(globalThis.window);
const mod = captured.factory(req);
const { FeaturesSection, FeatureRow, RecoveryBanner } = mod.__test;
const t = (k, p) => p?.reason ? k + ':' + p.reason : k;

// --- Settings page -----------------------------------------------------
const section = render(FeaturesSection, {
  useConfig: (sel) => sel({ status: 'ready', writable: true, value: { inputRecovery: true } }),
  setField: async () => true,
  t,
});
const sectionText = textOf(section);
check('page title', sectionText.includes('page.title'));
check('page intro', sectionText.includes('page.intro'));
check('feature label', sectionText.includes('feature.inputRecovery.label'));
check('feature description', sectionText.includes('feature.inputRecovery.description'));
check('two switch rows', typesOf(section).filter((x) => x === 'Switch').length === 2);
check('switches start on', flatten(section).filter((n) => typeof n === 'object' && n.type === 'Switch').every((s) => s.props.checked === true));

const offSection = render(FeaturesSection, {
  useConfig: (sel) => sel({ status: 'ready', writable: true, value: { pinBrowsePicker: false, inputRecovery: false } }),
  setField: async () => true,
  t,
});
check('both switches follow config off', flatten(offSection).filter((n) => typeof n === 'object' && n.type === 'Switch').every((s) => s.props.checked === false));

const readOnlySection = render(FeaturesSection, {
  useConfig: (sel) => sel({ status: 'ready', writable: false, value: { inputRecovery: true } }),
  setField: async () => true,
  t,
});
check('read-only config disables the switch', findType(readOnlySection, 'Switch')?.props.disabled === true);

// --- rows --------------------------------------------------------------
const row = render(FeatureRow, { title: 'T', description: 'D', checked: true, disabled: false, failed: false, onChange: () => {}, t });
check('row switch labelled', findType(row, 'Switch')?.props.label === 'T');
check('row switch has onChange', typeof findType(row, 'Switch')?.props.onChange === 'function');
const failedRow = render(FeatureRow, { title: 'T', description: 'D', checked: true, disabled: false, failed: true, onChange: () => {}, t });
check('failed row surfaces the error', textOf(failedRow).includes('saveFailed'));

// --- recovery banner ---------------------------------------------------
check('no records renders nothing', render(RecoveryBanner, { sessionId: 's1', inputActions: {}, enabled: true, t }).length === 0);
check('disabled feature renders nothing', render(RecoveryBanner, { sessionId: 's1', inputActions: {}, enabled: false, t }).length === 0);
const glyph = mod.__test.KitNavIcon({ size: 16 });
check('nav glyph is an svg', glyph.type === 'svg');
check('nav glyph uses currentColor', glyph.props.stroke === 'currentColor');
check('nav glyph has toolbox paths', glyph.children.length === 4);


// --- populated banner --------------------------------------------------
const records = [{ id: 'a:1:m', sessionId: 's1', turn: 1, text: 'the swallowed prompt', reason: 'scope.tools.presentAs is not a function', at: 1 }];
globalThis.fetch = async (url) => String(url).includes('/ack')
  ? { ok: true, json: async () => ({ ok: true }) }
  : { ok: true, json: async () => ({ items: records }) };

// The banner reads through an effect, which the stand-in does not run; drive
// the exported helper directly to prove the Host route round-trip.
const items = await mod.fetchRecovered('s1');
check('helper returns the record', items.length === 1 && items[0].text === 'the swallowed prompt');
check('reason reaches the copy key', t('recovery.reason', { reason: items[0].reason }).includes('scope.tools.presentAs'));

console.log('');
console.log(fail === 0 ? 'PASS ' + pass : 'FAILED ' + fail + ' of ' + (pass + fail));
process.exit(fail === 0 ? 0 : 1);
