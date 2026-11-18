
import { createRequire } from 'node:module';
const require = createRequire('/Users/chi/.dsh/profiles/desktop/node_modules/pin-browse-picker/package.json');
const pkg = require('pin-browse-picker/package.json');
console.log('package.json ->', require.resolve('pin-browse-picker/package.json'));
console.log('main:', pkg.main, '| client export:', pkg.exports['./client'].default);
console.log('dsh.bundle.patch:', pkg.dsh.bundle.patch);
console.log('dsh.client.platform:', pkg.dsh.client.platform);
const mod = await import('pin-browse-picker');
console.log('host name:', mod.name, '| apply:', typeof mod.apply, '| Config:', typeof mod.Config);
console.log('default switch:', mod.Config({}).inputRecovery.get());
