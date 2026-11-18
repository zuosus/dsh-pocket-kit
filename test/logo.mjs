import { readFileSync, mkdtempSync, writeFileSync, rmSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

let pass = 0; let fail = 0;
const check = (n, ok) => { if (ok) { pass += 1; console.log('  ok  ' + n); } else { fail += 1; console.log('  FAIL ' + n); } };

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

// --- module under test -------------------------------------------------
const logo = await import('../lib/features/custom-logo.js');

check('route constant', logo.LOGO_ROUTE === '/dsh-pocket-kit/logo');

// The logo ships with the package: one fixed image, no user configuration.
check('bundled logo is an absolute path', typeof logo.BUNDLED_LOGO === 'string' && logo.BUNDLED_LOGO.startsWith('/'));
check('bundled logo lives in this package', logo.BUNDLED_LOGO.endsWith('/lib/assets/whale-girl.png'));
check('bundled logo exists on disk', (() => { try { return readFileSync(logo.BUNDLED_LOGO).length > 0; } catch { return false; } })());
check('bundled logo is a png', (() => {
  const head = readFileSync(logo.BUNDLED_LOGO).subarray(1, 4).toString('ascii');
  return head === 'PNG';
})());

check('logo mime', logo.logoMime('a.png') === 'image/png');
check('svg mime', logo.logoMime('a.SVG') === 'image/svg+xml');
check('unknown mime falls back', logo.logoMime('a.bin') === 'application/octet-stream');

// --- host harness ------------------------------------------------------
function harness(options = {}) {
  const routes = [];
  const rejection = options.rejection ?? (() => undefined);
  const ctx = {
    effect(fn) { return fn(); },
    inject(deps, body) {
      body({
        effect(fn) { fn(); },
        webServer: { register(spec) { routes.push(spec); return () => {}; } },
        connection: { requestRejection: rejection },
      });
    },
    logger: { warn() {} },
  };
  return { ctx, routes };
}

function request(route, { method = 'GET', headers = {} } = {}) {
  const res = {
    statusCode: 0,
    headers: {},
    body: undefined,
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    end(body) { this.body = body ?? ''; },
  };
  return Promise.resolve(route.handler({ method, url: logo.LOGO_ROUTE, headers }, res)).then(() => res);
}

// --- route registration ------------------------------------------------
{
  const { ctx, routes } = harness();
  logo.applyCustomLogo(ctx, () => true);
  check('registers exactly one route', routes.length === 1);
  check('route is exact and at the logo path', routes[0]?.kind === 'exact' && routes[0]?.path === logo.LOGO_ROUTE);
}

// --- serving -----------------------------------------------------------
{
  const { ctx, routes } = harness();
  logo.applyCustomLogo(ctx, () => true);
  const res = await request(routes[0]);
  const bundled = readFileSync(logo.BUNDLED_LOGO);
  check('serves 200', res.statusCode === 200);
  check('serves the bundled bytes', Buffer.compare(Buffer.from(res.body), bundled) === 0);
  check('sends the png content type', res.headers['content-type'] === 'image/png');
  check('sends a content length', String(res.headers['content-length']) === String(bundled.length));
  check('sends an etag', typeof res.headers.etag === 'string' && res.headers.etag.length > 2);
  check('revalidates instead of pinning', res.headers['cache-control'] === 'no-cache');

  const again = await request(routes[0], { headers: { 'if-none-match': res.headers.etag } });
  check('conditional request answers 304', again.statusCode === 304);
  check('304 carries no body', again.body === '');
}

// --- failure paths -----------------------------------------------------
{
  const { ctx, routes } = harness();
  logo.applyCustomLogo(ctx, () => false);
  check('switch off answers 404', (await request(routes[0])).statusCode === 404);
}
{
  const { ctx, routes } = harness();
  logo.applyCustomLogo(ctx, () => true);
  const res = await request(routes[0], { method: 'POST' });
  check('non-GET answers 405', res.statusCode === 405);
  check('405 advertises GET', res.headers.allow === 'GET');
}
{
  const { ctx, routes } = harness({ rejection: () => 401 });
  logo.applyCustomLogo(ctx, () => true);
  const res = await request(routes[0]);
  check('fenced request answers 401', res.statusCode === 401);
  check('fenced request leaks no bytes', res.body === '');
}

// A missing bundled file must degrade to a 404, never to a crash.
{
  const dir = mkdtempSync(join(tmpdir(), 'pbp-logo-'));
  const gone = join(dir, 'gone.png');
  const { ctx, routes } = harness();
  logo.applyCustomLogo(ctx, () => true, gone);
  check('missing file answers 404', (await request(routes[0])).statusCode === 404);
  rmSync(dir, { recursive: true, force: true });
}

// The optional path argument exists for tests only; production passes nothing.
{
  const dir = mkdtempSync(join(tmpdir(), 'pbp-logo2-'));
  const alt = join(dir, 'alt.svg');
  writeFileSync(alt, '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"/>');
  const { ctx, routes } = harness();
  logo.applyCustomLogo(ctx, () => true, alt);
  const res = await request(routes[0]);
  check('an svg source is served as svg', res.headers['content-type'] === 'image/svg+xml');
  rmSync(dir, { recursive: true, force: true });
}

console.log('');
console.log(fail === 0 ? 'PASS ' + pass : 'FAILED ' + fail + ' of ' + (pass + fail));
process.exit(fail === 0 ? 0 : 1);
