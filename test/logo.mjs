import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';

let pass = 0; let fail = 0;
const check = (n, ok) => { if (ok) { pass += 1; console.log('  ok  ' + n); } else { fail += 1; console.log('  FAIL ' + n); } };

// --- fixtures ----------------------------------------------------------
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8"/></svg>', 'utf8');
const dir = mkdtempSync(join(tmpdir(), 'pbp-logo-'));
const pngFile = join(dir, 'whale.png');
const svgFile = join(dir, 'whale.svg');
const missingFile = join(dir, 'nope.png');
writeFileSync(pngFile, PNG);
writeFileSync(svgFile, SVG);

// --- module under test -------------------------------------------------
const logo = await import('../lib/features/custom-logo.js');

check('route constant', logo.LOGO_ROUTE === '/dsh-pocket-kit/logo');
check('default file is the whale-girl download', logo.DEFAULT_LOGO_FILE === '~/Downloads/whale-girl.png');

check('expandHome resolves ~', logo.expandHome('~/Downloads/whale-girl.png') === join(homedir(), 'Downloads', 'whale-girl.png'));
check('expandHome keeps absolute paths', logo.expandHome('/tmp/a.png') === '/tmp/a.png');
check('expandHome only rewrites a leading ~/', logo.expandHome('/tmp/~x.png') === '/tmp/~x.png');

check('png mime', logo.logoMime('a.png') === 'image/png');
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

const read = (file, extra = {}) => (key, fallback) => {
  if (key === 'customLogoPath' && file !== undefined) return file;
  if (key in extra) return extra[key];
  return fallback;
};

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
  logo.applyCustomLogo(ctx, () => true, read(pngFile));
  check('registers exactly one route', routes.length === 1);
  check('route is exact and at the logo path', routes[0]?.kind === 'exact' && routes[0]?.path === logo.LOGO_ROUTE);
}

// --- serving -----------------------------------------------------------
{
  const { ctx, routes } = harness();
  logo.applyCustomLogo(ctx, () => true, read(pngFile));
  const res = await request(routes[0]);
  check('serves 200', res.statusCode === 200);
  check('serves the file bytes', Buffer.compare(Buffer.from(res.body), PNG) === 0);
  check('sends the png content type', res.headers['content-type'] === 'image/png');
  check('sends a content length', String(res.headers['content-length']) === String(PNG.length));
  check('sends an etag', typeof res.headers.etag === 'string' && res.headers.etag.length > 2);
  check('revalidates instead of pinning', res.headers['cache-control'] === 'no-cache');

  const again = await request(routes[0], { headers: { 'if-none-match': res.headers.etag } });
  check('conditional request answers 304', again.statusCode === 304);
  check('304 carries no body', again.body === '');
}

// --- an svg source is served as svg ------------------------------------
{
  const { ctx, routes } = harness();
  logo.applyCustomLogo(ctx, () => true, read(svgFile));
  const res = await request(routes[0]);
  check('svg served as image/svg+xml', res.headers['content-type'] === 'image/svg+xml');
  check('svg bytes preserved', Buffer.from(res.body).toString('utf8') === SVG.toString('utf8'));
}

// --- failure paths -----------------------------------------------------
{
  const { ctx, routes } = harness();
  logo.applyCustomLogo(ctx, () => true, read(missingFile));
  check('missing file answers 404', (await request(routes[0])).statusCode === 404);
}
{
  const { ctx, routes } = harness();
  logo.applyCustomLogo(ctx, () => false, read(pngFile));
  check('switch off answers 404', (await request(routes[0])).statusCode === 404);
}
{
  const { ctx, routes } = harness();
  logo.applyCustomLogo(ctx, () => true, read(pngFile));
  const res = await request(routes[0], { method: 'POST' });
  check('non-GET answers 405', res.statusCode === 405);
  check('405 advertises GET', res.headers.allow === 'GET');
}
{
  const { ctx, routes } = harness({ rejection: () => 401 });
  logo.applyCustomLogo(ctx, () => true, read(pngFile));
  const res = await request(routes[0]);
  check('fenced request answers 401', res.statusCode === 401);
  check('fenced request leaks no bytes', res.body === '');
}

// --- the configured path drives the served file ------------------------
{
  const { ctx, routes } = harness();
  const seen = [];
  logo.applyCustomLogo(ctx, () => true, (key, fallback) => {
    seen.push(key);
    return key === 'customLogoPath' ? pngFile : fallback;
  });
  await request(routes[0]);
  check('reads the configured path key', seen.includes('customLogoPath'));
}

rmSync(dir, { recursive: true, force: true });

console.log('');
console.log(fail === 0 ? 'PASS ' + pass : 'FAILED ' + fail + ' of ' + (pass + fail));
process.exit(fail === 0 ? 0 : 1);
