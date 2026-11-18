import { readFileSync } from 'node:fs';
let hookIndex = 0; let hookStore = [];
const React = {
  createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat() }),
  Fragment: 'Fragment',
  useState(init) { const s = hookIndex++; if (!(s in hookStore)) hookStore[s] = typeof init === 'function' ? init() : init; return [hookStore[s], () => {}]; },
  useEffect() {}, useCallback: (fn) => fn, useMemo: (fn) => fn(), useRef: (v) => ({ current: v }),
};
let captured = null;
globalThis.window = { __ModuleLoader__: { load: (spec) => { captured = spec; } } };
globalThis.fetch = async () => ({ ok: true, json: async () => ({ items: [] }) });
const req = (id) => id === 'react' ? React : { Switch: 'Switch', Button: 'Button' };
new Function('window', readFileSync('/Users/chi/.dsh/workspace/pin-browse-picker/lib/client.js', 'utf8'))(globalThis.window);
const mod = captured.factory(req);
hookIndex = 0; hookStore = [];
const tree = mod.__test.FeaturesSection({
  useConfig: (sel) => sel({ status: 'ready', writable: true, value: { inputRecovery: true } }),
  setField: async () => true,
  t: (k) => k,
});
console.log(JSON.stringify(tree, (k, v) => typeof v === 'function' ? '[fn]' : v, 1).slice(0, 2500));
