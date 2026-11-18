/**
 * Feature: custom-logo.
 *
 * Replaces the DeepSeek Harness mark in the sidebar's top-left corner (the
 * whale next to the wordmark) with this package's own artwork.
 *
 * ## How the corner is actually owned
 *
 * The sidebar shell renders its brand through two single-kind slots it declares
 * itself (`sidebar.brand.mark` and `sidebar.brand.name`, see
 * `@deepseek-ai/dsh-client-ui-sidebar`). The shipped official plugin fills the
 * mark with `<FishLogo/>` at the default priority 0, and the slot contract says
 * a single slot renders the LOWEST-priority registration — so a client plugin
 * can replace the mark by registering at a lower priority and leave the
 * wordmark, the New-Session affordance and the collapsed rail untouched.
 *
 * That also answers the format question: the slot owner receives a React node,
 * not a file, so no SVG is required. A raster PNG works as-is; the mark is an
 * `<img>` over a URL this Host half serves.
 *
 * ## The image ships with the package
 *
 * `lib/assets/whale-girl.png` is part of the plugin, not a user preference:
 * the point of the feature is one fixed, reviewed piece of artwork, so there is
 * nothing to configure and nothing to point at the wrong file. The bytes cannot
 * be read by the page directly (a browser cannot open a path inside an installed
 * package), so the Host serves them on one same-origin route, fenced with the
 * composition's `connection.requestRejection` exactly like the open-in-app
 * routes:
 *
 *   GET /dsh-pocket-kit/logo
 *
 * The file is read per request and the response carries an ETag with
 * `no-cache`, so swapping the asset in the package (and reloading the plugin)
 * changes the picture without the browser pinning the old one.
 *
 * @module dsh-pocket-kit/features/custom-logo
 */

import { readFileSync, statSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Route that serves the bundled logo image. */
export const LOGO_ROUTE = "/dsh-pocket-kit/logo";

/** Absolute path of the artwork this package ships. */
export const BUNDLED_LOGO = join(dirname(fileURLToPath(import.meta.url)), "..", "assets", "whale-girl.png");

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
 * Content type for one image path.
 *
 * @param {string} file - image path.
 * @returns {string} a MIME type; octet-stream for an unknown extension.
 */
export function logoMime(file) {
	return MIME[extname(file).toLowerCase()] ?? "application/octet-stream";
}

/**
 * Read the image and its validators.
 *
 * @param {string} file - absolute image path.
 * @returns {{ bytes: Buffer, etag: string } | undefined} the image, or undefined when unreadable.
 */
function loadImage(file) {
	try {
		const stats = statSync(file);
		if (!stats.isFile()) return undefined;
		const bytes = readFileSync(file);
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
 * @param {string} [file] - override for the bundled artwork; tests use it to
 *   exercise the missing-file and non-PNG branches without touching the package.
 */
export function applyCustomLogo(ctx, enabled, file = BUNDLED_LOGO) {
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
				const image = enabled() ? loadImage(file) : undefined;
				if (image === undefined) {
					res.statusCode = 404;
					res.end();
					return;
				}
				res.setHeader("content-type", logoMime(file));
				res.setHeader("content-length", String(image.bytes.length));
				res.setHeader("etag", image.etag);
				// Revalidate rather than pin: replacing the asset in the package must
				// change the picture, and only the ETag tells the browser that.
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
