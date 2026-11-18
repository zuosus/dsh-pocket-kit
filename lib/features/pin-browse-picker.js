/**
 * Feature: pin-browse-picker.
 *
 * Chooses which directory-picker interaction the Host mounts: the in-app
 * **browse** backend (switch on) or the stock boot-time **auto** selector
 * (switch off, which on macOS picks the native Finder panel).
 *
 * ## Why the composition happens at boot, not on toggle
 *
 * A picker interaction is a *pair* of Loader entries: a Host backend
 * (registers `ctx.directoryPicker`) and a Client surface (fills ui-workspace's
 * directory-flow slot). The browser only receives the client bundles that are
 * Loader rows **when the page's boot graph is composed**, so a surface added
 * after the page loaded cannot appear in that page — and swapping only the Host
 * half would leave the page driving a capability the Host no longer has.
 *
 * So this feature decides once, during Host boot, and the page then loads a
 * consistent pair. Changing the switch is persisted immediately and applied by
 * the next DSH start; the Settings row says so.
 *
 * @module dsh-pocket-kit/features/pin-browse-picker
 */

/** Stock selector used when the switch is off. */
const AUTO = {
	id: "directory-picker-auto-mounted",
	name: "@deepseek-ai/dsh-host-directory-picker-auto",
};

/**
 * The pinned interaction: backend first, because the surface's browser half
 * drives the capability the backend registers.
 */
const BROWSE = [
	{ id: "directory-picker-browse", name: "@deepseek-ai/dsh-host-directory-picker-browse" },
	{ id: "directory-picker-browse-surface", name: "@deepseek-ai/dsh-client-ui-directory-picker-browse" },
];

/**
 * Create one Loader row and wait for its fiber, so a mounted surface is
 * already present when the boot graph is composed.
 *
 * @param ctx - Host context carrying the `loader` service.
 * @param row - entry id and package name to mount.
 */
async function mount(ctx, row) {
	// A row of this id may already exist (for example a previous install whose
	// patch still carried it); mounting twice would collide on the id.
	if (ctx.loader.store[row.id] !== undefined) return;
	await ctx.loader.create({ id: row.id, name: row.name });
	const entry = ctx.loader.store[row.id];
	if (entry?.fiber !== undefined) await entry.fiber.await();
}

/**
 * Install the picker composition for this boot.
 *
 * Always installed (see FEATURES' `always` flag): with the switch off this is
 * the code that mounts the stock selector in place of the pinned pair.
 *
 * @param ctx - the Host plugin context.
 * @param {() => boolean} enabled - live switch reader.
 */
export function applyPinBrowsePicker(ctx, enabled) {
	const pinned = enabled();
	const rows = pinned ? BROWSE : [AUTO];
	ctx.inject(["loader"], (child) => {
		child.effect(() => {
			// Mount both faces of one interaction so the page's boot graph, which
			// is composed after this settles, carries the matching client surface.
			void (async () => {
				for (const row of rows) await mount(child, row);
			})().catch((error) => {
				// A failed mount leaves no picker at all, which is worse than a
				// logged warning: surface it instead of failing the whole boot.
				child.logger?.warn?.("pin-browse-picker: could not mount " + rows.map((r) => r.name).join(", ") + ": " + String(error));
			});
			return () => {
				// The rows belong to this boot and the loader tears them down with
				// itself; nothing swaps at runtime, so nothing to undo here.
			};
		}, "pin-browse-picker: boot composition");
	});
}
