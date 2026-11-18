/**
 * Feature: custom-logo.
 *
 * Replaces the DeepSeek Harness mark in the sidebar's top-left corner (the
 * whale next to the wordmark) with the image at `customLogoPath`.
 *
 * ## How the corner is actually owned
 *
 * The sidebar shell renders its brand through two single-kind slots it
 * declares itself (`sidebar.brand.mark` and `sidebar.brand.name`, see
 * `@deepseek-ai/dsh-client-ui-sidebar`). The shipped official plugin fills the
 * mark with `<FishLogo/>` at the default priority 0, and the slot contract
 * says a single slot renders the LOWEST-priority registration — so a client
 * plugin can replace the mark by registering at a lower priority and leave the
 * wordmark, the New-Session affordance and the collapsed rail untouched.
 *
 * That also answers the format question: the slot owner receives a React node,
 * not a file, so no SVG is required. A raster PNG works as-is; an SVG source
 * works too. The one thing the browser needs is a URL, which is what this Host
 * half provides.
 *
 * ## Why the bytes come from the Host
 *
 * The image lives outside the page bundle (it is a user file under `~/`), and
 * the page cannot read local paths. So the Host serves it on one same-origin
 * route, fenced with the composition's `connection.requestRejection` exactly
 * like the open-in-app routes:
 *
 *   GET /dsh-pocket-kit/logo
 *
 * The file is read per request, so replacing the image needs no DSH restart —
 * the response carries an ETag and `no-cache`, so the browser revalidates
 * instead of pinning the old picture.
 *
 * @module dsh-pocket-kit/features/custom-logo
 */

import { readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { extname, join } from "node:path";

/** Route that serves the configured logo image. */
export const LOGO_ROUTE = "/dsh-pocket-kit/logo";

/** Logo used when `customLogoPath` is not set. */
export const DEFAULT_LOGO_FILE = "~/Downloads/whale-girl.png";

/** Content type per supported image extension. */
const MIME = {
	".png": "image/png",
	".svg": "image/svg+xml",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".webp": "image/webp",
	".gif": "image/gif",
	".avif": "image/avif",
};

/**
 * Resolve a leading `~/` against the home directory.
 *
 * @param {string} file - configured path, possibly starting with `~/`.
 * @returns {string} an absolute path.
 */
export function expandHome(file) {
	if (file === "~") return homedir();
	if (file.startsWith("~/")) return join(homedir(), file.slice(2));
	return file;
}

/**
 * Content type for one image path.
 *
 * @param {string} file - image path.
 * @returns {string} a MIME type; octet-stream for an unknown extension.
 */
export function logoMime(file) {
	return MIME[extname(file).toLowerCase()] ?? "application/octet-stream";
}

/**
 * Read the configured image and its validators.
 *
 * @param {string} file - configured path.
 * @returns {{ bytes: Buffer, etag: string } | undefined} the image, or undefined when unreadable.
 */
function loadImage(file) {
	const path = expandHome(file);
	try {
		const stats = statSync(path);
		if (!stats.isFile()) return undefined;
		const bytes = readFileSync(path);
		return { bytes, etag: '"' + stats.size + "-" + Math.floor(stats.mtimeMs) + '"' };
	} catch {
		return undefined;
	}
}

/**
 * Install the custom-logo route.
 *
 * @param {any} ctx - the Host plugin context.
 * @param {() => boolean} enabled - live switch reader; while off the route answers 404.
 * @param {(key: string, fallback?: unknown) => unknown} read - live Config reader.
 */
export function applyCustomLogo(ctx, enabled, read) {
	ctx.inject(["webServer", "connection"], (child) => {
		child.effect(() => child.webServer.register({
			kind: "exact",
			path: LOGO_ROUTE,
			handler: async (req, res) => {
				const rejection = child.connection.requestRejection(req);
				if (rejection !== undefined) {
					res.statusCode = rejection;
					res.end();
					return;
				}
				if (req.method !== "GET" && req.method !== "HEAD") {
					res.statusCode = 405;
					res.setHeader("allow", "GET");
					res.end();
					return;
				}
				// Read the switch and the path per request: both are live
				// preferences, and the image itself may have been replaced.
				const configured = read("customLogoPath", DEFAULT_LOGO_FILE);
				const image = enabled() && typeof configured === "string" && configured !== ""
					? loadImage(configured)
					: undefined;
				if (image === undefined) {
					res.statusCode = 404;
					res.end();
					return;
				}
				res.setHeader("content-type", logoMime(expandHome(configured)));
				res.setHeader("content-length", String(image.bytes.length));
				res.setHeader("etag", image.etag);
				// The page must revalidate: replacing the file at the same path has
				// to change the picture, and only the ETag tells the browser that.
				res.setHeader("cache-control", "no-cache");
				if (req.headers?.["if-none-match"] === image.etag) {
					res.statusCode = 304;
					res.end();
					return;
				}
				res.statusCode = 200;
				res.end(req.method === "HEAD" ? undefined : image.bytes);
			},
		}), "dsh-pocket-kit: logo route");
	});
}
