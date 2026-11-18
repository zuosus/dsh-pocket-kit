import { applyPinBrowsePicker } from '../lib/features/pin-browse-picker.js';

let pass = 0; let fail = 0;
const check = (n, ok) => { if (ok) { pass += 1; console.log('  ok  ' + n); } else { fail += 1; console.log('  FAIL ' + n); } };

// Fake loader + ctx that mirror the real loader.create/remove/store contract.
const store = Object.create(null);
let seq = 0;
const events = {};
const ctx = {
  loader: {
    store,
    async create({ name }) {
      const id = 'gen-' + (++seq);
      store[id] = { id, name };
      return id;
    },
    remove(id) { delete store[id]; },
  },
  effect(fn) { return fn(); },
  inject(deps, body) {
    body({
      effect(fn) { fn(); },
      on(evt, cb) { (events[evt] ??= []).push(cb); },
    });
  },
  logger: { warn() {} },
};

let switchOn = true;
const enabled = () => switchOn;
applyPinBrowsePicker(ctx, enabled);

// Wait for the initial async sync to settle.
await new Promise((r) => setTimeout(r, 20));

// Default on: auto row must not be mounted; browse rows from the patch remain assumed.
const autoId = Object.values(store).find((e) => e.name.includes('directory-picker-auto'))?.id;
check('on: no auto picker mounted', autoId === undefined);

// Turn it off -> auto gets mounted.
switchOn = false;
for (const cb of events['loader/volatile-update'] ?? []) cb();
await new Promise((r) => setTimeout(r, 20));
const autoRows = Object.values(store).filter((e) => e.name.includes('directory-picker-auto'));
check('off: auto picker mounted', autoRows.length === 1);

// Turn it back on -> auto removed.
switchOn = true;
for (const cb of events['loader/volatile-update'] ?? []) cb();
await new Promise((r) => setTimeout(r, 20));
const autoRows2 = Object.values(store).filter((e) => e.name.includes('directory-picker-auto'));
check('on again: auto picker removed', autoRows2.length === 0);

// When it re-mounts browse it creates both host + surface rows.
const browseRows = Object.values(store).filter((e) => e.name.includes('browse'));
check('on again: browse rows present', browseRows.length === 2);

console.log('');
console.log(fail === 0 ? 'PASS ' + pass : 'FAILED ' + fail + ' of ' + (pass + fail));
process.exit(fail === 0 ? 0 : 1);
