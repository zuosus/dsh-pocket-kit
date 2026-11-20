import { readFileSync } from 'node:fs';
let pass = 0; let fail = 0;
const check = (n, ok) => { if (ok) { pass += 1; console.log('  ok  ' + n); } else { fail += 1; console.log('  FAIL ' + n); } };

let hookIndex = 0; let hookStore = [];
const React = {
  createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat() }),
  Fragment: 'Fragment',
  useState(init) { const s = hookIndex++; if (!(s in hookStore)) hookStore[s] = typeof init === 'function' ? init() : init; return [hookStore[s], (next) => { hookStore[s] = typeof next === 'function' ? next(hookStore[s]) : next; }]; },
  useEffect() {}, useCallback: (fn) => fn, useMemo: (fn) => fn(), useRef: (v) => ({ current: v }),
};
const flatten = (node, out = [], depth = 0) => {
  if (node === null || node === undefined || depth > 12) return out;
  if (Array.isArray(node)) { for (const n of node) flatten(n, out, depth); return out; }
  if (typeof node !== 'object') { out.push(String(node)); return out; }
  if (typeof node.type === 'function') {
    const saved = [hookIndex, hookStore]; hookIndex = 0; hookStore = [];
    const rendered = node.type(node.props);
    [hookIndex, hookStore] = saved;
    return flatten(rendered, out, depth + 1);
  }
  out.push(node);
  flatten(node.children, out, depth + 1);
  return out;
};

let captured = null;
globalThis.window = { __ModuleLoader__: { load: (spec) => { captured = spec; } } };
const records = [{ id: 'a:1:m', sessionId: 's1', turn: 1, text: 'the swallowed prompt', reason: 'boom', at: 1 }];
globalThis.fetch = async (url) => String(url).includes('/ack')
  ? { ok: true, json: async () => ({ ok: true }) }
  : { ok: true, json: async () => ({ items: records }) };
const req = (id) => id === 'react' ? React : { Switch: 'Switch', Button: 'Button' };
new Function('window', readFileSync(new URL('../lib/client.js', import.meta.url).pathname, 'utf8'))(globalThis.window);
const mod = captured.factory(req);
const { RecoveryBanner } = mod.__test;
const t = (k, p) => p?.count !== undefined ? k + ':' + p.count : p?.reason ? k + ':' + p.reason : k;

// The banner fills itself from an effect the stand-in does not run, so seed the
// state through a first render and then read the tree it produced.
const renderBanner = (inputActions) => {
  hookIndex = 0;
  hookStore = [records, null];
  return flatten(RecoveryBanner({ sessionId: 's1', inputActions, enabled: true, t }));
};

const withDraft = renderBanner({ setDraft() {} });
check('shows the recovered text', withDraft.some((n) => n === 'the swallowed prompt'));
check('offers restore with a draft seat', withDraft.some((n) => n === 'recovery.restore'));
check('offers copy', withDraft.some((n) => n === 'recovery.copy'));
check('offers dismiss', withDraft.some((n) => n === 'recovery.dismiss'));

const withoutDraft = renderBanner({});
check('no restore without a draft seat', !withoutDraft.some((n) => n === 'recovery.restore'));
check('still offers copy', withoutDraft.some((n) => n === 'recovery.copy'));

// --- banner hierarchy --------------------------------------------------
const byClass = (nodes, name) => nodes.find((n) => typeof n === 'object' && String(n.props?.className ?? '').split(' ').includes(name));
const buttonWith = (nodes, label) => nodes.find((n) => typeof n === 'object' && n.type === 'Button' && flatten([n]).includes(label));
const textIn = (node) => flatten([node]).filter((n) => typeof n === 'string').join(' ');

const card = byClass(withDraft, 'pbp-recovery');
check('one quiet card wrapper', card !== undefined);
check('header eyebrow names the recovered input', textIn(byClass(withDraft, 'pbp-recoveryEyebrow')) === 'recovery.eyebrow');
check('title carries the message', textIn(byClass(withDraft, 'pbp-recoveryTitle')) === 'recovery.head');
check('header icon is decorative', byClass(withDraft, 'pbp-recoveryBadge')?.props['aria-hidden'] === true);
check('meta shows the size', textIn(byClass(withDraft, 'pbp-recoveryMeta')) === 'recovery.size:20');
check('prompt sits in a quoted preview', byClass(withDraft, 'pbp-recoveryPreview') !== undefined);
check('cause is separated from the message', textIn(byClass(withDraft, 'pbp-recoveryCauseText')) === 'boom');
check('cause label is its own line', textIn(byClass(withDraft, 'pbp-recoveryCauseLabel')) === 'recovery.reasonLabel');
check('restore is the primary action', buttonWith(withDraft, 'recovery.restore')?.props.variant === 'primary');
check('copy is a quiet action', buttonWith(withDraft, 'recovery.copy')?.props.variant === 'ghost');
check('dismiss is a quiet action', buttonWith(withDraft, 'recovery.dismiss')?.props.variant === 'ghost');

const source = readFileSync(new URL('../lib/client.js', import.meta.url).pathname, 'utf8');
check('card uses an existing surface token', source.includes('--dsw-alias-bg-layer-2') && !source.includes('--dsw-alias-bg-l2'));

console.log('');
console.log(fail === 0 ? 'PASS ' + pass : 'FAILED ' + fail + ' of ' + (pass + fail));
process.exit(fail === 0 ? 0 : 1);
