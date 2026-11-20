/**
 * Where this package keeps its own directory, and the one-time move that takes
 * an existing install there.
 *
 * ## The address
 *
 * Plugin data used to live at `$DSH_HOME/dsh-pocket-kit/`, next to the
 * `profiles/` and `runtimes/` directories the Host owns. That made a plugin's
 * own files look like part of the Host layout. Every plugin now keeps its data
 * under `$DSH_HOME/plugins/<package-name>/` (the convention
 * `$DSH_HOME/plugins/dsh-generative-ui/` already used), so this package reads
 * and writes `$DSH_HOME/plugins/dsh-pocket-kit/`.
 *
 * ## DSH home resolution
 *
 * This file reproduces the Host's `resolveDshHome()` behaviour instead of
 * depending on `@deepseek-ai/dsh-home-paths`: the package has to load in a bare
 * checkout without the Host's node_modules. The three rules are the Host's:
 *
 *   1. **Priority**: an explicit path > `$DSH_HOME` > `~/.dsh`
 *   2. **Blank means unset**: an empty or whitespace-only `$DSH_HOME` counts as
 *      absent — otherwise the data directory would resolve to the process's
 *      working directory
 *   3. **Tilde expansion**: `~`, `~/` and `~\\` (the Windows spelling)
 *      expand to the OS home directory
 *
 * Plus the step the Host also takes and an early hand-rolled version missed:
 * normalise to an absolute path. A relative `DSH_HOME=./home` would otherwise
 * move the store with the process's working directory, which shows up as "the
 * setting is sometimes there and sometimes not".
 *
 * ## Why the move is synchronous, and why it tries rename first
 *
 * The move has to finish before anything reads the store, and `apply()` is a
 * synchronous Host hook, so the whole thing is sync. `rename` is the cheap
 * correct answer for the normal case (same filesystem, target absent). It is
 * not the only case: `$DSH_HOME` may span mount points (a symlinked or
 * separately mounted home), where `rename` fails with `EXDEV`. That falls back
 * to a recursive copy followed by a delete, which is what "move" means when the
 * two ends cannot share an inode.
 *
 * ## Strategy
 *
 *   1. The new directory exists → do nothing. **Never overwrite, never merge**:
 *      an empty new directory still counts as taken, because a move is not a
 *      merge and guessing which side wins would silently drop one of them.
 *   2. The old directory does not exist → do nothing. That is the normal state
 *      of a fresh install.
 *   3. Otherwise move, and on any failure swallow the error and hand back the
 *      **old** directory so the caller can keep reading there. A one-time
 *      convenience must never be the reason a plugin stops working.
 *
 * The result is idempotent: a second call finds the new directory present (or
 * the old one absent) and does no I/O.
 *
 * @module dsh-pocket-kit/plugin-dir
 */

import { cpSync, existsSync, mkdirSync, renameSync, rmSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

/** Default Harness home directory name (the Host's constant of the same name). */
export const DSH_HOME_DIR_NAME = ".dsh";

/** Environment variable that overrides the default home (the Host's constant). */
export const DSH_HOME_ENV = "DSH_HOME";

/** This package's name; also the directory name under `plugins/`. */
export const PLUGIN_NAME = "dsh-pocket-kit";

/**
 * Expand a `~`, `~/` or `~\\` prefix.
 *
 * Only "the home directory" and "the current user" forms are handled;
 * `~alice/...` is returned unchanged, matching the Host's `expandHomePath`
 * rather than guessing what the user meant.
 *
 * @param path - a path that may carry a tilde prefix.
 * @returns the expanded path, unchanged when there is no recognised prefix.
 */
export function expandHomePath(path) {
	const text = typeof path === "string" ? path : "";
	if (text === "~") return homedir();
	if (text.startsWith("~/") || text.startsWith("~\\")) return join(homedir(), text.slice(2));
	return text;
}

/**
 * Resolve the DSH home directory.
 *
 * @param options.configured - an explicit path, highest priority (this package
 *   has no such setting yet; the parameter exists to mirror the Host signature).
 * @param options.env - the environment table, `process.env` by default;
 *   injectable so tests never read or write the real home.
 * @returns the normalised absolute path.
 */
export function resolveDshHome(options = {}) {
	const env = options.env ?? process.env;
	const raw = env?.[DSH_HOME_ENV];
	const fromEnv = typeof raw === "string" && raw.trim().length > 0 ? raw : undefined;
	const configured = typeof options.configured === "string" && options.configured.trim().length > 0
		? options.configured
		: undefined;
	const chosen = configured ?? fromEnv ?? join(homedir(), DSH_HOME_DIR_NAME);
	// resolve() both expands a relative path and collapses "." / "..", so every
	// working directory resolves the same store to the same absolute path.
	return resolve(expandHomePath(chosen));
}

/**
 * This package's own directory: `<DSH_HOME>/plugins/<name>`.
 *
 * @param options.configured - see {@link resolveDshHome}.
 * @param options.env - see {@link resolveDshHome}.
 * @returns the absolute path (the directory may not exist yet).
 */
export function resolvePluginDir(options = {}) {
	return join(resolveDshHome(options), "plugins", PLUGIN_NAME);
}

/**
 * The address this package used before the move: `<DSH_HOME>/<name>`.
 *
 * @param options.configured - see {@link resolveDshHome}.
 * @param options.env - see {@link resolveDshHome}.
 * @returns the absolute path (usually absent on a fresh install).
 */
export function resolveLegacyPluginDir(options = {}) {
	return join(resolveDshHome(options), PLUGIN_NAME);
}

/**
 * Whether a path is an existing directory.
 * @param path - the path to test.
 * @returns true for a directory, false for anything else (including absent).
 */
function isDirectory(path) {
	try {
		return statSync(path).isDirectory();
	} catch {
		return false;
	}
}

/**
 * @typedef {object} MigrationResult
 * @property {boolean} migrated - the move actually happened.
 * @property {"moved" | "already" | "fresh" | "failed"} reason - why.
 * @property {string} dir - where the caller should read and write now; the old
 *   address when the move failed, the new one otherwise.
 * @property {string} from - the old address.
 * @property {string} to - the new address.
 * @property {string} [error] - the failure, when `reason` is `"failed"`.
 */

/**
 * Move `<DSH_HOME>/<name>/` to `<DSH_HOME>/plugins/<name>/` once.
 *
 * Idempotent and non-fatal: any failure is reported in the result, never
 * thrown, and `dir` then points back at the old address.
 *
 * @param options.env - see {@link resolveDshHome}.
 * @param options.configured - see {@link resolveDshHome}.
 * @param options.from - override the old address (defaults to
 *   {@link resolveLegacyPluginDir}).
 * @param options.to - override the new address (defaults to
 *   {@link resolvePluginDir}).
 * @param options.rename - the move primitive; injectable so a test can force
 *   the cross-device path.
 * @param options.copy - the copy primitive used on that path; injectable so a
 *   test can make the copy fail.
 * @returns {MigrationResult}
 */
export function migratePluginDir(options = {}) {
	const from = resolve(options.from ?? resolveLegacyPluginDir(options));
	const to = resolve(options.to ?? resolvePluginDir(options));

	// Rule 1: the new address is taken. A move never overwrites and never
	// merges, so this is a no-op even when the new directory is empty.
	//
	// "Taken" means an actual directory. Something else sitting at the new
	// address (a stray file) is not a usable store either: fall through to the
	// move, which fails honestly and hands the caller the old address back
	// instead of pointing it at a file that cannot be read.
	if (isDirectory(to)) return { migrated: false, reason: "already", dir: to, from, to };

	// Rule 2: nothing to move — the ordinary state of a fresh install. No
	// directory is created here; the store's own write path does that.
	if (!existsSync(from)) return { migrated: false, reason: "fresh", dir: to, from, to };

	const rename = options.rename ?? renameSync;
	const copy = options.copy ?? cpSync;
	try {
		// The parent may not exist yet: <DSH_HOME>/plugins/ is created on demand.
		mkdirSync(dirname(to), { recursive: true });
		try {
			rename(from, to);
		} catch (error) {
			// EXDEV: the two ends are on different devices, so no inode can be
			// shared and rename cannot express the move. Copy then delete.
			if (error?.code !== "EXDEV") throw error;
			// The copy lands in a staging directory beside the target, which is
			// on the target's device by construction: the rename that publishes
			// it can then never EXDEV. A copy that dies halfway is removed, so
			// the new address never holds a half-written store that a later run
			// would mistake for a complete one.
			const staging = `${to}.migrating-${process.pid}`;
			try {
				rmSync(staging, { recursive: true, force: true });
				copy(from, staging, { recursive: true, force: true, errorOnExist: false, preserveTimestamps: true });
				renameSync(staging, to);
			} catch (copyError) {
				try { rmSync(staging, { recursive: true, force: true }); } catch { /* best effort */ }
				throw copyError;
			}
			rmSync(from, { recursive: true, force: true });
		}
		return { migrated: true, reason: "moved", dir: to, from, to };
	} catch (error) {
		// Rule 3: a failed move must not take the plugin down with it. Report it
		// and let the caller keep reading the old address.
		return {
			migrated: false,
			reason: "failed",
			dir: from,
			from,
			to,
			error: `could not move ${from} to ${to}: ${error?.message ?? String(error)}`,
		};
	}
}
