/**
 * Feature: force-system-model-picker.
 *
 * Client-side only: when this switch is on, Pocket Kit writes the shared
 * `dshmf:mode` preference to `native` so the composer's model seat is handed
 * back to DSH's shipped (system) picker instead of a third-party replacement
 * such as dsh-model-flatmap. See lib/client.js for the driver.
 *
 * The Host half deliberately does nothing: the switch is a volatile Config
 * field read by the Client, and there is no server-side capability to install.
 *
 * @module dsh-pocket-kit/features
 */

/**
 * No-op Host installer. The feature lives entirely in the Client half.
 *
 * @param ctx - the Host plugin context (unused).
 * @param {() => boolean} enabled - live switch reader (unused).
 */
export function applyForceSystemModelPicker(ctx, enabled) {
	// Intentionally empty. Registered so the Config key appears on the Settings
	// page and the switch persists in the profile patch.
}
