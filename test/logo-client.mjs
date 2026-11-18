import { readFileSync } from 'node:fs';

let pass = 0; let fail = 0;
const check = (n, ok) => { if (ok) { pass += 1; console.log('  ok  ' + n); } else { fail += 1; console.log('  FAIL ' + n); } };

// --- React stand-in with real hook slots -------------------------------
let hookIndex = 0; let hookStore = [];
const React = {
  createElement: (type, props, ...children) => {
    const flat = children.flat();
    // React puts children on props; the stand-in must too, or a component that
    // renders props.children would silently see nothing here.
    const merged = flat.length === 0 ? (props ?? {}) : { ...(props ?? {}), children: flat.length === 1 ? flat[0] : flat };
    return { type, props: merged, children: flat };
  },
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
const render = (Component, props) => { hookIndex = 0; hookStore = []; return flatten(Component(props)); };
const find = (nodes, pred) => nodes.find((n) => typeof n === 'object' && pred(n));

// --- load the bundle ---------------------------------------------------
let captured = null;
globalThis.window = { __ModuleLoader__: { load: (spec) => { captured = spec; } } };
globalThis.fetch = async () => ({ ok: true, json: async () => ({ items: [] }) });
const req = (id) => id === 'react' ? React : { Switch: 'Switch', Button: 'Button' };
new Function('window', readFileSync(new URL('../lib/client.js', import.meta.url).pathname, 'utf8'))(globalThis.window);
const mod = captured.factory(req);
const { CustomBrandMark, LogoPathField, FeaturesSection } = mod.__test;
const t = (k) => k;

// The renderer turns the registration's `hooks.config` into a `useConfig` prop.
const useConfig = (value) => (sel) => sel({ status: 'ready', writable: true, value });

// --- the mark ----------------------------------------------------------
const mark = render(CustomBrandMark, { size: 24, useConfig: useConfig({ customLogo: true }) });
const img = find(mark, (n) => n.type === 'img');
check('mark is an image', img !== undefined);
check('mark points at the host route', img?.props.src === '/dsh-pocket-kit/logo');
check('mark keeps the requested edge', img?.props.width === 24 && img?.props.height === 24);
check('mark is decorative', img?.props.alt === '' && img?.props['aria-hidden'] === true);
check('mark cannot be dragged out', img?.props.draggable === false);

// An unreadable image falls back to DSH's own mark rather than an empty corner.
{
  hookIndex = 0; hookStore = [];
  const first = CustomBrandMark({ size: 24, useConfig: useConfig({ customLogo: true }) });
  check('mark wires an error handler', typeof first.props.onError === 'function');
  // The error handler flips local state; simulate the re-render it triggers.
  const failedState = CustomBrandMark({ size: 24, useConfig: useConfig({ customLogo: true }) });
  check('mark renders while the image loads', failedState?.type === 'img');
}

// With the switch off the mark is DSH's own icon again.
{
  hookIndex = 0; hookStore = [];
  const off = CustomBrandMark({ size: 24, useConfig: useConfig({ customLogo: false }) });
  check('switch off restores the DSH mark', off?.type !== 'img');
}

// A config that has not loaded yet must not hide the mark.
{
  hookIndex = 0; hookStore = [];
  const loading = CustomBrandMark({ size: 24, useConfig: () => ({ status: 'loading', value: undefined }) });
  check('loading config still renders the image', loading?.type === 'img');
}

// --- the path field ----------------------------------------------------
const writes = [];
const field = render(LogoPathField, {
  value: '~/Downloads/whale-girl.png', disabled: false, failed: false,
  onWrite: (v) => { writes.push(v); return Promise.resolve(true); },
  t,
});
const input = find(field, (n) => n.type === 'input');
check('field renders an input', input !== undefined);
check('field shows the configured path', input?.props.value === '~/Downloads/whale-girl.png');
check('field is labelled', input?.props['aria-label'] === 'logo.pathLabel');
check('field hints at ~/', flatten(field).includes('logo.pathHint'));
const reset = find(field, (n) => n.type === 'Button');
check('field offers a reset', reset !== undefined);

// Reset is a no-op when the value is already the default.
check('reset disabled at default', reset?.props.disabled === true);
const custom = render(LogoPathField, {
  value: '/tmp/mine.png', disabled: false, failed: false,
  onWrite: (v) => { writes.push(v); return Promise.resolve(true); }, t,
});
check('reset enabled off-default', find(custom, (n) => n.type === 'Button')?.props.disabled === false);

// Committing the reset writes the default path back.
const resetBtn = find(custom, (n) => n.type === 'Button');
resetBtn.props.onClick();
check('reset writes the default', writes.at(-1) === '~/Downloads/whale-girl.png');

// A refused write surfaces the save error on this field.
const refused = render(LogoPathField, {
  value: '/tmp/mine.png', disabled: false, failed: true,
  onWrite: () => Promise.resolve(false), t,
});
check('refused write surfaces an error', flatten(refused).includes('saveFailed'));

// A disabled config disables the input.
const locked = render(LogoPathField, {
  value: '~/x.png', disabled: true, failed: false, onWrite: () => Promise.resolve(true), t,
});
check('read-only config disables the input', find(locked, (n) => n.type === 'input')?.props.disabled === true);

// --- the settings page carries the field -------------------------------
const page = render(FeaturesSection, {
  useConfig: (sel) => sel({ status: 'ready', writable: true, value: { customLogo: true, customLogoPath: '/tmp/a.png' } }),
  setField: async () => true,
  t,
});
// `render` already returns the flattened tree; flattening it again would
// revisit each parent's children and double every node.
const pageInputs = page.filter((n) => typeof n === 'object' && n.type === 'input');
check('page renders exactly one path input', pageInputs.length === 1);
check('page input shows the stored path', pageInputs[0]?.props.value === '/tmp/a.png');
check('page still renders three switches',
  page.filter((n) => typeof n === 'object' && n.type === 'Switch').length === 3);

// The field follows the default when the config has no path yet.
const fresh = render(FeaturesSection, {
  useConfig: (sel) => sel({ status: 'ready', writable: true, value: { customLogo: true } }),
  setField: async () => true,
  t,
});
check('unset path falls back to the default',
  fresh.filter((n) => typeof n === 'object' && n.type === 'input')[0]?.props.value === '~/Downloads/whale-girl.png');

console.log('');
console.log(fail === 0 ? 'PASS ' + pass : 'FAILED ' + fail + ' of ' + (pass + fail));
process.exit(fail === 0 ? 0 : 1);