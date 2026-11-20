/**
 * Feature: force-system-model-picker.
 *
 * Hands the composer's model seat back to DSH's shipped picker by disabling
 * the Loader rows of plugins that occupy that seat.
 *
 * ## Why the Host disables rows instead of the Client writing a preference
 *
 * The first attempt had the Client write the shared `dshmf:mode` localStorage
 * key that a replacement picker reads. That cannot work here:
 *
 *   - the Web GUI's port changes on every launch, and `localStorage` is
 *     origin-scoped (scheme + host + **port**), so the key never survives a
 *     restart — the next page starts from an empty store;
 *   - a replacement such as `dsh-model-flatmap` activates BEFORE this package
 *     (bundle order) and reads that key during activation, so a write from here
 *     always arrives too late.
 *
 * A Loader row, by contrast, is decided on the Host at boot and has no
 * origin, no storage and no ordering race. Disabling the occupying rows elects
 * the shipped `ModelSelect` underneath, which is the system control this
 * feature promises.
 *
 * ## Why a declared list rather than discovery
 *
 * A plugin manifest does not say "I occupy the model seat", so the Host cannot
 * discover occupants by inspecting packages. The list is therefore explicit:
 * known occupants ship as defaults, and `extraOccupants` in Config lets a user
 * name a plugin this release does not know about yet.
 *
 * @module dsh-pocket-kit/features/force-system-model-picker
 */

/**
 * Loader row ids of plugins known to occupy the composer's model seat.
 *
 * These are the row ids a profile uses when it mounts the plugin, not package
 * names: the Loader addresses rows by id. `dsh-model-flatmap` ships the row id
 * `model-flatmap`, and `dsh-acp-agents` ships `acp-agents`.
 */
export const KNOWN_OCCUPANTS = [
	// Flat model picker: registers the seat at a negative priority so it
	// shadows the shipped picker outright. Its bundle patch inserts the row
	// under the id `dsh-model-flatmap` (not the shorter `model-flatmap`).
	{ id: "dsh-model-flatmap", name: "dsh-model-flatmap" },
	// ACP agents: also registers the seat (at the default priority), plus a
	// model-label cell. Disabling this row also turns off ACP delegation, which
	// the Settings copy states.
	{ id: "acp-agents", name: "dsh-acp-agents" },
];

/**
 * Disable one Loader row and wait for its fiber, so the seat is free before
 * the page's boot graph is composed.
 *
 * A row that is absent, already disabled, or owned by a Host without the
 * expected shape is skipped rather than treated as an error: this feature must
 * never be able to fail a profile boot.
 *
 * @param ctx - Host context carrying the `loader` service.
 * @param occupant - the row id and the package name expected on it.
 * @returns whether the row was actually removed.
 */
function disableRow(ctx, occupant) {
	const store = ctx?.loader?.store;
	if (store === undefined || store === null) return false;
	let row = store[occupant.id];
	let rowId = occupant.id;
	if (row === undefined || row === null || row?.options?.name !== occupant.name) {
		// Fall back to a package-name lookup: a row id is a profile-local label,
		// so the package name is the reliable identity. This also covers a
		// caller-supplied occupant, whose row id the caller may not know.
		for (const key of Object.keys(store)) {
			const candidate = store[key];
			if (candidate?.options?.name === occupant.name) {
				row = candidate;
				rowId = key;
				break;
			}
		}
	}
	if (row === undefined || row === null) return false;
	// A row mounted under the same id but for another package is not ours to
	// touch; the id is only a claim, the package name is the evidence.
	// Refuse a row whose package is not the one we mean: the id alone is only a
	// claim, and removing the wrong row would disable an unrelated plugin.
	if (row.options?.name !== occupant.name) return false;
	if (row.options?.disabled === true) return true;
	try {
		// Mark first: if removal throws, the row still must not come back on the
		// next composition.
		row.options.disabled = true;
		const parent = row.parent;
		if (typeof parent?.remove === "function") parent.remove(rowId);
		return true;
	} catch (error) {
		ctx.logger?.warn?.("force-system-model-picker: could not disable " + rowId + ": " + String(error));
		return false;
	}
}

/**
 * Install the row-disable pass for this boot.
 *
 * Read once at boot like `pinBrowsePicker`: the composition of the page is
 * decided before the browser asks for its bundles, so changing the switch is
 * persisted immediately and applied by the next DSH start.
 *
 * @param ctx - the Host plugin context.
 * @param {() => boolean} enabled - live switch reader.
 * @param {string[]} [extra] - additional plugin names from Config.
 */
export function applyForceSystemModelPicker(ctx, enabled, extra) {
	if (enabled() !== true) return;
	const wanted = [...KNOWN_OCCUPANTS];
	for (const name of Array.isArray(extra) ? extra : []) {
		if (typeof name !== "string" || name === "") continue;
		// A configured name may be either the Loader row id or the package name;
		// both are accepted so a caller does not have to know which one it is.
		wanted.push({ id: name, name, byName: true });
	}
	// A Host without the loader service (or without `inject` at all) cannot
	// host this feature. Skipping is correct: the composer keeps whatever picker
	// it already had, which is exactly the behaviour without this package.
	if (typeof ctx?.inject !== "function") return;
	ctx.inject(["loader"], (child) => {
		child.effect(() => {
			void (async () => {
				const removed = [];
				for (const occupant of wanted) {
					if (disableRow(child, occupant)) removed.push(occupant.id);
				}
				if (removed.length === 0) return;
				// Wait for the removed fibers so the seat is settled before the
				// boot graph is composed for the first page.
				try {
					await child.loader?.await?.();
				} catch {
					/* the rows are already disabled; a failed await changes nothing */
				}
			})().catch((error) => {
				child.logger?.warn?.("force-system-model-picker: the disable pass failed: " + String(error));
			});
			return () => {
				/* Rows belong to this boot; nothing is restored at runtime. */
			};
		}, "force-system-model-picker: disable occupying rows");
	});
}