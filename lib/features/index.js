/**
 * Feature registry for the `dsh-pocket-kit` collection.
 *
 * Every small feature this package ships is one module in this directory plus
 * one row in {@link FEATURES}. The Settings page (Client half) and the Host
 * `apply` both read the same ids, so a feature can never be installed without
 * a switch and a switch can never point at nothing.
 *
 * Each feature gets its own boolean in the Host Config (named after its id,
 * default true), so turning one off is a normal preference edit rather than a
 * patch edit.
 *
 * @module dsh-pocket-kit/features
 */

import { applyInputRecovery } from "./input-recovery.js";

/**
 * @typedef {object} Feature
 * @property {string} id - Config key and Settings row identity.
 * @property {(ctx: unknown, enabled: () => boolean) => void} apply - Install the feature.
 */

/** Every feature, in Settings display order. */
export const FEATURES = [
	{
		id: "inputRecovery",
		apply: applyInputRecovery,
	},
];
