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

import { applyCustomLogo } from "./custom-logo.js";
import { applyForceSystemModelPicker } from "./force-system-model-picker.js";
import { applyInputRecovery } from "./input-recovery.js";
import { applyPinBrowsePicker } from "./pin-browse-picker.js";

/**
 * @typedef {object} Feature
 * @property {string} id - Config key and Settings row identity.
 * @property {(ctx: unknown, enabled: () => boolean) => void} apply - Install the feature.
 */

/** Every feature, in Settings display order. */
export const FEATURES = [
	{
		id: "customLogo",
		apply: applyCustomLogo,
	},
	{
		id: "pinBrowsePicker",
		apply: applyPinBrowsePicker,
		/** Always installed: toggling off must actively swap the picker rows. */
		always: true,
	},
	{
		id: "forceSystemModelPicker",
		apply: applyForceSystemModelPicker,
		/** Config key holding extra occupant package names. */
		listFrom: "extraOccupants",
		/** Off by default: opting in must be an explicit choice. */
		defaultOn: false,
	},
	{
		id: "inputRecovery",
		apply: applyInputRecovery,
	},
];