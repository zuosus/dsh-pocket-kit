
import { createRequire } from 'node:module';
const require = createRequire('/Users/chi/.dsh/profiles/desktop/node_modules/dsh-pocket-kit/package.json');
const pkg = require('dsh-pocket-kit/package.json');
console.log('package.json ->', require.resolve('dsh-pocket-kit/package.json'));
console.log('main:', pkg.main, '| client export:', pkg.exports['./client'].default);
console.log('dsh.bundle.patch:', pkg.dsh.bundle.patch);
console.log('dsh.client.platform:', pkg.dsh.client.platform);
const mod = await import('dsh-pocket-kit');
console.log('host name:', mod.name, '| apply:', typeof mod.apply, '| Config:', typeof mod.Config);
const cfg = mod.Config({});
console.log('default switches:', cfg.inputRecovery.get(), cfg.pinBrowsePicker.get());
