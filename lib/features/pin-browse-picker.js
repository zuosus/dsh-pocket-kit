/**
 * Feature: pin-browse-picker.
 *
 * Forces the workspace directory picker to use the in-app **browse** backend
 * instead of the boot-time auto selector, which on macOS would pick the
 * native Finder panel (and can flip between launches when proxy / bind facts
 * change). This is thefeature that used to live as static rows in
 * cordis.patch.yml; it is now a real switch.
 *
 * ## How the switch works
 *
 * The two browse rows (host backend + client surface) are still mounted by
 * the patch at boot, so the default-on state needs no work and the picker is
 * available from the very first frame. This feature only reacts to a change:
 *
 *   - turned OFF  -> remove the two browse rows and mount the stock auto
 *                    picker, which restores the system default (native on
 *                    macOS) exactly as if this plugin were not installed;
 *   - turned ON   -> remove the auto row and re-create the two browse rows.
 *
 * This mirrors how @deepseek-ai/dsh-host-directory-picker-auto mounts its own
 * interaction entries via `ctx.loader.create`, so the client module scanner
 * discovers a dynamically created surface row the same way.
 *
 * @module dsh-pocket-kit/features/pin-browse-picker
 */

/** Auto picker package (the stock behaviour when the switch is off). */
const AUTO_PICKER_NAME = "@deepseek-ai/dsh-host-directory-picker-auto";

/** The two rows the patch mounts by default for the pinned browse backend. */
const BROWSE_ROWS = [
	"directory-picker-browse",
	"directory-picker-browse-surface",
];

/**
 * Mount the auto picker on the in-memory root tree and remember its id.
 * @param ctx - Host context carrying the `loader` service.
 * @param state - mutable feature state holding created row ids.
 * @returns the created row id.
 */
async function mountAuto(ctx, state) {
	if (state.autoId !== undefined && ctx.loader.store[state.autoId] !== undefined) {
		return state.autoId;
	}
	const id = await ctx.loader.create({ name: AUTO_PICKER_NAME });
	state.autoId = id;
	return id;
}

/**
 * Remove the auto picker row this feature created, if any.
 * @param ctx - Host context carrying the `loader` service.
 * @param state - mutable feature state holding created row ids.
 */
function unmountAuto(ctx, state) {
	if (state.autoId === undefined) return;
	if (ctx.loader.store[state.autoId] !== undefined) ctx.loader.remove(state.autoId);
	state.autoId = undefined;
}

/**
 * Remove the browse backend + surface rows, whether from the patch or a
 * previous mount of this feature.
 * @param ctx - Host context carrying the `loader` service.
 * @param state - mutable feature state holding created row ids.
 */
function unmountBrowse(ctx, state) {
	const ids = [...new Set([...BROWSE_ROWS, ...state.browseIds])];
	for (const id of ids) {
		if (ctx.loader.store[id] !== undefined) ctx.loader.remove(id);
	}
	state.browseIds = [];
}

/**
 * Re-create the browse backend + surface rows after they were removed.
 * @param ctx - Host context carrying the `loader` service.
 * @param state - mutable feature state holding created row ids.
 */
async function mountBrowse(ctx, state) {
	const names = [
		"@deepseek-ai/dsh-host-directory-picker-browse",
		"@deepseek-ai/dsh-client-ui-directory-picker-browse",
	];
	const created = [];
	for (const name of names) {
		created.push(await ctx.loader.create({ name }));
	}
	state.browseIds = created;
}

/**
 * Install the pin-browse-picker switch watcher.
 *
 * Unlike inputRecovery this feature must stay installed even while its
 * switch is off: a toggle from on to off has to actively swap the mounted
 * rows. So the watcher is always mounted and simply reacts to `enabled()`.
 *
 * @param ctx - the Host plugin context.
 * @param {() => boolean} enabled - live switch reader.
 */
export function applyPinBrowsePicker(ctx, enabled) {
	const state = { autoId: undefined, browseIds: [] };
	let applied = undefined;
	let busy = false;

	/** Reconcile the mounted picker rows with the current switch value. */
	const sync = async () => {
		if (busy) return;
		const want = enabled();
		if (applied === want) return;
		busy = true;
		try {
			if (want) {
				unmountAuto(ctx, state);
				// The patch already mounted the browse rows at boot; only re-create
				// them if an earlier toggle removed them.
				const present = BROWSE_ROWS.some((id) => ctx.loader.store[id] !== undefined)
					|| state.browseIds.some((id) => ctx.loader.store[id] !== undefined);
				if (!present) await mountBrowse(ctx, state);
			} else {
				unmountBrowse(ctx, state);
				await mountAuto(ctx, state);
			}
			applied = want;
		} catch (error) {
			ctx.logger?.warn?.("pin-browse-picker: switch sync failed: " + String(error));
			// Leave `applied` unset so the next config event retries.
		} finally {
			busy = false;
		}
	};

	ctx.inject(["loader"], (child) => {
		child.effect(() => {
			// Reconcile once at startup (a switch persisted as off is applied
			// here), then on every volatile config commit.
			void sync();
			child.on("loader/volatile-update", () => { void sync(); });
			return () => {
				// Only tear down rows this feature itself created. The patch rows
				// are owned by the loader and disappear with it.
				unmountAuto(child, state);
			};
		}, "pin-browse-picker: switch watcher");
	});
}
