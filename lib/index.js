/**
 * Host half of `dsh-pocket-kit`.
 *
 * The package began as a pure patch bundle (see cordis.patch.yml) that pins the
 * workspace directory picker to the in-app browse backend. It is now a small
 * collection of independent features, so it also carries a Host plugin body of
 * its own: the patch still pins the picker, and this file installs the features
 * whose switches are on.
 *
 * Adding a feature means adding one module under ./features and one row in
 * ./features/index.js. Nothing here needs editing, and the picker patch is
 * untouched by feature work.
 *
 * ## Where a switch lives
 *
 * A switch is persisted in this package's own file,
 * `$DSH_HOME/plugins/dsh-pocket-kit/config.yaml` (see ./config-file.js), NOT in
 * the profile patch and NOT in the browser's localStorage. The Config fields
 * below still exist, but only as the fallback for a key that file does not
 * mention: that keeps an existing install working across the upgrade and keeps a
 * hand-written patch entry meaningful. The Settings page reads and writes the
 * file through the two routes installed here, so the file stays the single source
 * of truth for both halves.
 *
 * @module dsh-pocket-kit
 */

import z from "@deepseek-ai/schemastery";
import { FEATURES } from "./features/index.js";
import { createSwitchStore, SWITCH_KEYS } from "./config-file.js";
import { migratePluginDir } from "./plugin-dir.js";

/** Diagnostic name of this Host plugin. */
export const name = "dsh-pocket-kit";

/** Route that reads the switches and their file path. */
export const SWITCHES_PATH = "/dsh-pocket-kit/switches";

/** Request-body cap for the switch write route. */
const MAX_BODY_BYTES = 8 * 1024;

/**
 * Host Config: the fallback value of each switch.
 *
 * These are NOT where a switch is stored any more: the config file wins (see
 * ./config-file.js). They remain so a profile that already carries
 * `config: { customLogo: false }` in its patch keeps working, and so a fresh
 * install has a defined default. `volatile()` keeps each key a live reference,
 * which is what lets a feature read the patch value on every check.
 */
export const Config = z.object({
	/** Force the workspace directory picker to the in-app browse backend. */
	pinBrowsePicker: z.boolean().default(true).volatile(),
	/** Detect a user prompt a failed turn swallowed, and offer it back. */
	inputRecovery: z.boolean().default(true).volatile(),
	/** Replace the sidebar's top-left logo with this package's own artwork. */
	customLogo: z.boolean().default(true).volatile(),
	/** Force the composer model seat back to DSH's shipped (system) picker. */
	forceSystemModelPicker: z.boolean().default(false).volatile(),
	/**
	 * Extra plugin package names that occupy the model seat but are not in this
	 * release's known list. A plugin manifest does not declare seat occupancy,
	 * so a plugin newer than this package must be named here.
	 */
	extraOccupants: z.array(z.string()).default([]).volatile(),
});

/**
 * Read one Config value, unwrapping a `volatile()` reference.
 *
 * Schemastery turns a volatile key into a live reference (`{ get() }`) rather
 * than a plain value, so a caller must not compare the field directly.
 *
 * @param value - the Config field, plain or volatile.
 * @returns the current plain value, or undefined when unset.
 */
function unwrap(value) {
	if (value !== null && typeof value === "object" && typeof value.get === "function") {
		try {
			return value.get();
		} catch {
			return undefined;
		}
	}
	return value;
}

/**
 * Install every enabled feature.
 *
 * @param ctx - the Host plugin context.
 * @param config - the accepted Config value (defaults already filled in).
 */
export function apply(ctx, config) {
	const value = config ?? {};
	// One-time move of this package's data from `$DSH_HOME/dsh-pocket-kit/` to
	// `$DSH_HOME/plugins/dsh-pocket-kit/`. It runs before anything reads the
	// switch file or opens a store, so nothing ever observes the old address
	// after a successful move. A failure is contained: migratePluginDir never
	// throws, and a reader that needs the directory resolves the old address
	// itself rather than starting empty.
	const migration = migratePluginDir();
	if (migration.reason === "failed") {
		ctx.logger?.warn?.("dsh-pocket-kit: " + migration.error + " (keeping the old directory)");
	} else if (migration.migrated) {
		ctx.logger?.info?.("dsh-pocket-kit: moved plugin data to " + migration.to);
	}

	// The switches live in the config file; the Config value is only the fallback
	// for a key the file does not mention (see ./config-file.js). One store serves
	// both the feature `enabled()` readers here and the two routes below, so a
	// write from the Settings page is visible to every feature on its next check.
	//
	// The fallback is resolved once, from the patch as accepted at boot. A patch
	// edit mid-session is not a supported path (the Settings page writes the file),
	// and re-reading the volatile reference per check would only matter for a value
	// the file never mentions -- exactly the case where the patch is the standing
	// answer anyway.
	const fallback = {};
	for (const key of SWITCH_KEYS) {
		const raw = unwrap(value[key]);
		if (raw !== undefined) fallback[key] = raw !== false;
	}
	const switches = createSwitchStore({ fallback, logger: ctx.logger });

	// The Client half registers a dedicated Settings page for this package, so
	// ask the inventory to hold off an auto-generated form for the same
	// namespace: one preference must be editable from exactly one place.
	ctx.inject(["settings"], (child) => {
		child.effect(() => child.settings.configure({ auto: false }, ctx.fiber), "dsh-pocket-kit: own settings page");
	});

	// Two methods on one exact route are the only way the Settings page reaches
	// the file: GET reads the effective switches, POST writes them. It is fenced
	// with the composition `connection.requestRejection` exactly like the recovery
	// routes, so a page from another origin cannot read or flip switches.
	ctx.inject(["webServer", "connection"], (child) => {
		child.effect(() => child.webServer.register({
			kind: "exact",
			path: SWITCHES_PATH,
			handler: async (req, res) => {
				const rejection = child.connection.requestRejection(req);
				if (rejection !== undefined) {
					res.statusCode = rejection;
					res.end();
					return;
				}
				res.setHeader("content-type", "application/json; charset=utf-8");
				res.setHeader("cache-control", "no-store");
				if (req.method === "GET") {
					res.statusCode = 200;
					res.end(JSON.stringify({
						path: switches.file,
						values: switches.values(),
						errors: switches.errors,
					}));
					return;
				}
				if (req.method !== "POST") {
					res.statusCode = 405;
					res.setHeader("allow", "GET, POST");
					res.end();
					return;
				}
				let parsed;
				try {
					parsed = JSON.parse(await readBody(req));
				} catch {
					res.statusCode = 400;
					res.end();
					return;
				}
				// Only known switches, boolean values. An empty patch is not an error:
				// the page may re-save what it just read.
				const patch = {};
				if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
					for (const [key, next] of Object.entries(parsed)) {
						if (!SWITCH_KEYS.includes(key)) continue;
						if (typeof next !== "boolean") continue;
						patch[key] = next;
					}
				}
				let values;
				try {
					values = switches.write(patch);
				} catch (error) {
					// Most likely the file is hand-edited into invalid YAML. Report it
					// rather than losing the user's edit silently.
					ctx.logger?.warn?.("dsh-pocket-kit: could not write switches: " + String(error));
					res.statusCode = 500;
					res.end(JSON.stringify({
						error: String(error?.message ?? error),
						path: switches.file,
						values: switches.values(),
						errors: switches.errors,
					}));
					return;
				}
				res.statusCode = 200;
				res.end(JSON.stringify({ path: switches.file, values, errors: switches.errors }));
			},
		}), "dsh-pocket-kit: switches route");
	});

	for (const feature of FEATURES) {
		// Read through the store on every check, so a switch that supports live
		// swaps (e.g. inputRecovery) stops the moment the file changes.
		// pinBrowsePicker is read once at boot by its module; its change needs a
		// DSH restart. A feature whose switch defaults OFF must not install when
		// neither the file nor Config mentions it (undefined is not "on").
		const fallbackOn = feature.defaultOn === false ? false : true;
		const enabled = () => {
			const raw = switches.get(feature.id);
			return raw === undefined ? fallbackOn : raw !== false;
		};
		if (!enabled() && !feature.always) continue;
		try {
			// A feature that consumes a declared list reads it from Config here, so
			// the registry row stays a plain `apply(ctx, enabled)` contract.
			const extra = feature.listFrom === undefined ? undefined : unwrap(value[feature.listFrom]);
			feature.apply(ctx, enabled, extra);
		} catch (error) {
			// One feature failing to install must not take the others down with
			// it, and must not fail the whole profile entry.
			ctx.logger?.warn?.("dsh-pocket-kit: feature " + feature.id + " failed to install: " + String(error));
		}
	}
}

/**
 * Read a bounded request body as UTF-8 text.
 * @param req - the incoming request.
 * @returns the body, or an empty string when it exceeds the cap.
 */
function readBody(req) {
	return new Promise((resolve) => {
		let size = 0;
		const chunks = [];
		req.on("data", (chunk) => {
			size += chunk.length;
			if (size > MAX_BODY_BYTES) {
				resolve("");
				return;
			}
			chunks.push(chunk);
		});
		req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
		req.on("error", () => resolve(""));
	});
}
