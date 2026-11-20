/**
 * The feature switches, persisted in the plugin's own config file.
 *
 * ## Why a file of our own
 *
 * The switches used to be plain Host Config fields, so the Settings page wrote
 * them through `configForms` and they landed in the profile's
 * `cordis.patch.yml`. That file is the patch layer for the WHOLE profile: it is
 * edited by the app, by other plugins, and by hand, and a user who wants to flip
 * one switch has to open a file where every other entry is also editable. It is
 * also not ours to back up or migrate.
 *
 * This module gives the switches their own channel, the address this package
 * already uses for its own data ({@link ../plugin-dir.js}):
 *
 *   `$DSH_HOME/plugins/dsh-pocket-kit/config.yaml`
 *
 * Precedence, lowest to highest:
 *
 *   Config defaults  <  profile patch (`cordis.patch.yml`)  <  this file
 *
 * The file wins because it is the user's most explicit, most recent statement:
 * it is what the Settings page writes. A key the file does not mention still
 * falls back to the patch, so an existing install keeps its current behaviour
 * across the upgrade and a hand-written patch entry is not silently ignored.
 *
 * A missing file is normal and silent (zero-config users must see nothing). A
 * file that is present but malformed is NOT silent: it is reported, because
 * "I changed it and nothing happened" is the hardest failure to self-diagnose.
 *
 * @module dsh-pocket-kit/config-file
 */

import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parseDocument } from "yaml";
import { PLUGIN_NAME, resolvePluginDir } from "./plugin-dir.js";

/** This package's directory name under `$DSH_HOME/plugins/` (from ./plugin-dir.js). */
export const PLUGIN_DIR = PLUGIN_NAME;

/** File name of the switch store inside this package's directory. */
export const CONFIG_FILE = "config.yaml";

/** Every switch this package persists, in Settings display order. */
export const SWITCH_KEYS = ["customLogo", "pinBrowsePicker", "forceSystemModelPicker", "inputRecovery"];

/**
 * Full path of the switch store.
 *
 * The address comes from {@link resolvePluginDir}, so this file and the recovery
 * store share one definition of "where this package keeps its own files" and one
 * DSH-home resolution. `options` are passed straight through, so a test can point
 * the whole package at a temp directory with `{ env }`.
 *
 * @param options - `env` / `configured`, see {@link resolvePluginDir}.
 * @returns `<DSH_HOME>/plugins/dsh-pocket-kit/config.yaml`.
 */
export function resolveConfigFile(options = {}) {
	return join(resolvePluginDir(options), CONFIG_FILE);
}


/**
 * Read the switch store.
 *
 * Only keys in {@link SWITCH_KEYS} are returned; anything else in the file is
 * left to whoever wrote it and is never treated as an error. A value that is
 * not a boolean is reported in `errors` and skipped, so one bad line cannot
 * take the other switches down with it.
 *
 * @param path - file to read; defaults to {@link resolveConfigFile}.
 * @returns the parsed switches, the errors found, and whether the file exists.
 */
export function readSwitchFile(path = resolveConfigFile()) {
	const result = { values: {}, errors: [], missing: false, path };
	let text;
	try {
		text = readFileSync(path, "utf8");
	} catch (error) {
		if (error?.code === "ENOENT") {
			result.missing = true;
			return result;
		}
		result.errors.push("could not read " + path + ": " + String(error?.message ?? error));
		return result;
	}
	if (text.trim() === "") return result;

	const document = parseDocument(text);
	if (document.errors.length > 0) {
		result.errors.push(path + " is not valid YAML: " + document.errors[0].message);
		return result;
	}
	let parsed;
	try {
		parsed = document.toJS() ?? {};
	} catch (error) {
		result.errors.push(path + " could not be read as a mapping: " + String(error?.message ?? error));
		return result;
	}
	if (typeof parsed !== "object" || Array.isArray(parsed)) {
		result.errors.push(path + " must be a mapping of switch names to true/false");
		return result;
	}

	for (const key of SWITCH_KEYS) {
		if (!Object.hasOwn(parsed, key)) continue;
		const value = parsed[key];
		if (typeof value !== "boolean") {
			result.errors.push(path + ": " + key + " must be true or false, found " + JSON.stringify(value));
			continue;
		}
		result.values[key] = value;
	}
	// A near-miss key is almost always a typo the user expects to work, so name
	// it instead of letting the switch silently keep its old value.
	for (const key of Object.keys(parsed)) {
		if (SWITCH_KEYS.includes(key)) continue;
		const match = SWITCH_KEYS.find((known) => known.toLowerCase() === key.toLowerCase());
		if (match !== undefined) result.errors.push(path + ": unknown switch " + key + " (did you mean " + match + "?)");
	}
	return result;
}

/** Header written into a file this module creates. */
const HEADER = [
	"# dsh-pocket-kit 功能开关 / feature switches",
	"#",
	"# 这个文件归本插件所有，设置页的开关就写在这里。",
	"# 删掉某个键等于「回到默认值」，不需要写注释掉的行。",
	"# 文件里没写的键会回落到 profile 的 cordis.patch.yml。",
	"#",
	"# This file belongs to the plugin: the Settings page writes its switches here.",
	"# Delete a key to fall back to the default; keys the file omits fall back to",
	"# the profile's cordis.patch.yml.",
	"",
].join("\n");

/**
 * Write switches to the store, preserving everything else in the file.
 *
 * The file is a hand-editable document, so a write must not reformat it: it is
 * parsed into a YAML document tree, only the named keys are touched, and the
 * result is serialized back, which keeps comments and key order. The write is
 * atomic (temporary file plus rename) so a killed process cannot leave a
 * half-written file that fails to parse on the next start.
 *
 * @param values - switch values to write; `undefined` deletes that key.
 * @param path - file to write; defaults to {@link resolveConfigFile}.
 * @returns the path written.
 */
export function writeSwitchFile(values, path = resolveConfigFile()) {
	let document;
	if (existsSync(path)) {
		const text = readFileSync(path, "utf8");
		document = parseDocument(text);
		// Refuse to overwrite a file we cannot read: rewriting it would discard
		// whatever the user wrote there.
		if (document.errors.length > 0) {
			throw new Error(path + " is not valid YAML, refusing to overwrite: " + document.errors[0].message);
		}
		if (document.contents === null) document = parseDocument(HEADER);
	} else {
		document = parseDocument(HEADER);
	}

	for (const [key, value] of Object.entries(values)) {
		if (!SWITCH_KEYS.includes(key)) continue;
		if (value === undefined) document.delete(key);
		else document.set(key, value);
	}

	mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
	const temporary = path + ".tmp-" + process.pid;
	writeFileSync(temporary, document.toString(), { encoding: "utf8", mode: 0o600 });
	renameSync(temporary, path);
	// `mode` only applies when the file is created; a file an editor recreated
	// may be 0644, and this one is the plugin's own preference store.
	try {
		chmodSync(path, 0o600);
	} catch {
		/* a filesystem without chmod must not block the save */
	}
	return path;
}


/**
 * A live view of the switches: the file first, the Config fallback second.
 *
 * The Host reads through {@link SwitchStore#get} on every check, so a feature
 * that supports a live swap stops the moment its switch is written. Reads are
 * served from a cache that {@link SwitchStore#write} and
 * {@link SwitchStore#reload} refresh, so a poll loop does not hit the disk on
 * every event and an out-of-process edit is still picked up.
 *
 * @param options - `file` path, `fallback` values from Config, and an optional logger.
 * @returns the store.
 */
export function createSwitchStore({ file = resolveConfigFile(), fallback = {}, logger } = {}) {
	let cache;
	let errors = [];

	/** Re-read the file, keeping the last good values when it cannot be read. */
	const refresh = () => {
		const read = readSwitchFile(file);
		cache = read.values;
		errors = read.errors;
		for (const error of errors) logger?.warn?.("dsh-pocket-kit: " + error);
		return read;
	};

	refresh();

	return {
		/** Path of the file this store reads and writes. */
		file,
		/** The last read's parse errors, for the Settings page to show. */
		get errors() {
			return errors;
		},
		/** Re-read the file; used when something outside this process edited it. */
		reload() {
			return refresh();
		},
		/**
		 * Read one switch.
		 * @param id - switch name.
		 * @returns the file value, else the fallback, else undefined.
		 */
		get(id) {
			if (Object.hasOwn(cache, id)) return cache[id];
			return fallback[id];
		},
		/**
		 * Every switch as one plain object, file values over fallback values.
		 * @returns the effective switches.
		 */
		values() {
			const merged = {};
			for (const key of SWITCH_KEYS) {
				const value = this.get(key);
				if (value !== undefined) merged[key] = value;
			}
			return merged;
		},
		/**
		 * Write switches and refresh the cache.
		 * @param values - switch values to write.
		 * @returns the effective switches after the write.
		 */
		write(values) {
			writeSwitchFile(values, file);
			refresh();
			return this.values();
		},
	};
}
