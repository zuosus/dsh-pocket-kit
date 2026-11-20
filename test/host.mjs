import { FEATURES } from '../lib/features/index.js';
import { resolvePluginDir } from '../lib/plugin-dir.js';
import { applyInputRecovery } from '../lib/features/input-recovery.js';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// This suite records real recoveries, so it must never point at the developer's
// own store: a temp $DSH_HOME isolates it, and the cleanup below only ever
// touches that temp directory.
const HOME = mkdtempSync(join(tmpdir(), 'pbk-host-'));
process.env.DSH_HOME = HOME;

const PLUGIN_DIR = resolvePluginDir();
const STORE = join(PLUGIN_DIR, 'recovered-input.json');

// A store left over from the old address must be moved before the first read.
const LEGACY = join(HOME, 'dsh-pocket-kit');
mkdirSync(LEGACY, { recursive: true });
writeFileSync(join(LEGACY, 'recovered-input.json'), JSON.stringify({}), 'utf8');

let pass = 0;
let fail = 0;
const check = (name, ok) => {
  if (ok) { pass += 1; console.log('  ok  ' + name); }
  else { fail += 1; console.log('  FAIL ' + name); }
};

check('registry lists every feature', FEATURES.map((f) => f.id).join(',') === 'customLogo,pinBrowsePicker,forceSystemModelPicker,inputRecovery');
check('pin feature is always installed', FEATURES.find((f) => f.id === 'pinBrowsePicker')?.always === true);

const listeners = [];
const routes = [];
const ctx = {
  effect(fn) { return fn(); },
  inject(deps, body) {
    body({
      effect(fn) { fn(); },
      webServer: { register(spec) { routes.push(spec); return () => {}; } },
      connection: { requestRejection: () => undefined },
    });
  },
  on(event, listener) { if (event === 'session/event') listeners.push(listener); },
  logger: { warn: (...args) => console.log('WARN', ...args) },
};

applyInputRecovery(ctx, () => true);
check('one session/event listener', listeners.length === 1);
check('two routes', routes.length === 2);

// The one-time move ran before the store was read: the old address is gone and
// the store now lives under $DSH_HOME/plugins/dsh-pocket-kit.
check('the store lives under $DSH_HOME/plugins', STORE === join(HOME, 'plugins', 'dsh-pocket-kit', 'recovered-input.json'));
check('the legacy directory was moved away', existsSync(LEGACY) === false);

const emit = (sessionId, type, data) => {
  for (const listener of listeners) listener({ id: sessionId }, { type, data, seq: 0, time: 0 });
};

const read = async (sessionId) => {
  const route = routes.find((r) => r.path.endsWith('/recovered-input'));
  const res = { statusCode: 0, setHeader() {}, end(body) { this.body = body ?? ''; } };
  await route.handler({ method: 'GET', url: '/dsh-pocket-kit/recovered-input?session=' + sessionId, headers: {} }, res);
  return JSON.parse(res.body).items;
};

const ack = async (sessionId, ids) => {
  const route = routes.find((r) => r.path.endsWith('/ack'));
  const req = {
    method: 'POST', headers: {},
    on(evt, cb) {
      if (evt === 'data') cb(Buffer.from(JSON.stringify({ session: sessionId, ids })));
      if (evt === 'end') cb();
    },
  };
  const res = { statusCode: 0, setHeader() {}, end(body) { this.body = body ?? ''; } };
  await route.handler(req, res);
  return res.statusCode;
};

const text = '新增大功能：模仿我本地已经安装的插件 aa2246740/dsh-model-fusion 的实现细节，增加一个自动化功能。';
const sid = 'session-swallowed';

emit(sid, 'agent/inbox/spliced', {
  target: 'next-turn', start: 0,
  inserted: [{ id: 'msg-1', role: 'user', content: [{ type: 'text', text }], source: { kind: 'user', rpcId: 'rpc-1' } }],
});
emit(sid, 'turn/start', { turn: 1 });
emit(sid, 'agent/inbox/spliced', { target: 'next-turn', start: 0, removedCount: 1, inserted: [] });
emit(sid, 'turn/end', { turn: 1, reason: { kind: 'error', error: { message: 'scope.tools.presentAs is not a function', code: 'UNKNOWN' } } });

const items = await read(sid);
check('one recovery recorded', items.length === 1);
check('text preserved exactly', items[0]?.text === text);
check('reason surfaced', items[0]?.reason === 'scope.tools.presentAs is not a function');
check('turn recorded', items[0]?.turn === 1);
check('stable id', items[0]?.id === sid + ':1:msg-1');

// Persistence goes to the new directory, not the old one.
const persisted = (() => {
  try { return JSON.parse(readFileSync(STORE, 'utf8')); } catch { return undefined; }
})();
check('recovery is persisted under $DSH_HOME/plugins', persisted?.[sid]?.[0]?.text === text);
check('nothing is written to the legacy path', existsSync(join(LEGACY, 'recovered-input.json')) === false);

check('ack accepted', await ack(sid, [items[0].id]) === 200);
check('ack clears it', (await read(sid)).length === 0);

const sid2 = 'session-healthy';
emit(sid2, 'agent/inbox/spliced', {
  target: 'next-turn', start: 0,
  inserted: [{ id: 'msg-2', role: 'user', content: [{ type: 'text', text: 'hello' }], source: { kind: 'user' } }],
});
emit(sid2, 'turn/start', { turn: 1 });
emit(sid2, 'agent/inbox/spliced', { target: 'next-turn', start: 0, removedCount: 1, inserted: [] });
emit(sid2, 'user/message', { id: 'msg-2', role: 'user', content: [{ type: 'text', text: 'hello' }], source: { kind: 'user' } });
emit(sid2, 'turn/end', { turn: 1, reason: { kind: 'completed' } });
check('healthy turn records nothing', (await read(sid2)).length === 0);

const sid3 = 'session-interrupted';
emit(sid3, 'agent/inbox/spliced', {
  target: 'next-turn', start: 0,
  inserted: [{ id: 'msg-3', role: 'user', content: [{ type: 'text', text: 'crashed prompt' }], source: { kind: 'user' } }],
});
emit(sid3, 'turn/start', { turn: 2 });
emit(sid3, 'agent/inbox/spliced', { target: 'next-turn', start: 0, removedCount: 1, inserted: [] });
emit(sid3, 'turn/end', { turn: 2, reason: { kind: 'interrupted' } });
const interrupted = await read(sid3);
check('interrupted turn recovers', interrupted.length === 1 && interrupted[0].text === 'crashed prompt');
check('interrupted reason', interrupted[0]?.reason === 'the DSH process exited before this turn finished');

const sid4 = 'session-notice';
emit(sid4, 'agent/inbox/spliced', {
  target: 'next-turn', start: 0,
  inserted: [{ id: 'msg-4', role: 'user', content: [{ type: 'text', text: 'wake' }], source: { kind: 'notice' } }],
});
emit(sid4, 'turn/start', { turn: 1 });
emit(sid4, 'agent/inbox/spliced', { target: 'next-turn', start: 0, removedCount: 1, inserted: [] });
emit(sid4, 'turn/end', { turn: 1, reason: { kind: 'error', error: { message: 'boom' } } });
check('non-human source ignored', (await read(sid4)).length === 0);

// Only the temp home this suite created is removed.
rmSync(HOME, { recursive: true, force: true });

console.log('');
console.log(fail === 0 ? 'PASS ' + pass : 'FAILED ' + fail + ' of ' + (pass + fail));
process.exit(fail === 0 ? 0 : 1);