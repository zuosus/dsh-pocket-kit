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
 * @module dsh-pocket-kit
 */

import z from "@deepseek-ai/schemastery";
import { FEATURES } from "./features/index.js";
import { migratePluginDir } from "./plugin-dir.js";

/** Diagnostic name of this Host plugin. */
export const name = "dsh-pocket-kit";

/**
 * Host Config: one switch per feature, all on by default.
 *
 * `volatile()` makes each key a live preference: the Settings page writes it
 * through `configForms`, and features that support live swaps read the new value
 * on their next check. `volatile()` alone does not make a feature live-swappable:
 * `pinBrowsePicker` mounts a Host-backend + Client-surface pair at boot, so its
 * switch is saved immediately but only takes effect after a DSH restart.
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
	// `$DSH_HOME/plugins/dsh-pocket-kit/`. It runs before any feature reads a
	// config file or opens a store, so nothing ever observes the old address
	// after a successful move. A failure is contained: migratePluginDir never
	// throws, and a feature that needs the directory resolves the old address
	// itself rather than starting empty.
	const migration = migratePluginDir();
	if (migration.reason === "failed") {
		ctx.logger?.warn?.("dsh-pocket-kit: " + migration.error + " (keeping the old directory)");
	} else if (migration.migrated) {
		ctx.logger?.info?.("dsh-pocket-kit: moved plugin data to " + migration.to);
	}
	// The Client half registers a dedicated Settings page for this package, so
	// ask the inventory to hold off an auto-generated form for the same
	// namespace: one preference must be editable from exactly one place.
	ctx.inject(["settings"], (child) => {
		child.effect(() => child.settings.configure({ auto: false }, ctx.fiber), "dsh-pocket-kit: own settings page");
	});
	for (const feature of FEATURES) {
		// Read through the reference on every check, so a switch that supports
		// live swaps (e.g. inputRecovery) stops immediately. pinBrowsePicker is
		// read once at boot by its module; its change needs a DSH restart.
		// A feature whose switch defaults OFF must not install when Config has not
		// been resolved yet (an undefined field is not the same as "on").
		const fallback = feature.defaultOn === false ? false : true;
		const enabled = () => {
			const raw = unwrap(value[feature.id]);
			return raw === undefined ? fallback : raw !== false;
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