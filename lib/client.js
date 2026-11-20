/**
 * Client half of `dsh-pocket-kit`.
 *
 * The package is a small collection of independent features, so this file has
 * two jobs:
 *
 *   1. one Settings page (`dsh-pocket-kit`) listing every feature with a
 *      switch, all on by default. The switches are ordinary Host Config fields,
 *      so they persist in the profile patch. Most apply live, but the
 *      `pinBrowsePicker` row is marked restart-scoped: its picker pair is mounted
 *      at boot, so the page shows a restart hint and the change applies after
 *      DSH restarts;
 *   2. the browser side of the features themselves. Today that is
 *      `inputRecovery`: when a turn fails after claiming the user prompt but
 *      before logging it, the prompt is recovered from the Host and offered
 *      back above the composer, where one click returns it to the draft.
 *
 * A Module Loader package: this file is the package `./client` export, served
 * to the page as a `window.__ModuleLoader__.load({ id, factory })`
 * registration. React and the shared primitives come from the module table
 * instead of being bundled a second time.
 *
 * @module dsh-pocket-kit/client
 */

window.__ModuleLoader__.load({
	id: "dsh-pocket-kit",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		const React = require("react");
		const primitives = require("@deepseek-ai/dsh-client-ui-primitives");
		const { Switch, Button, FishLogo } = primitives;
		const { createElement: h, useCallback, useEffect, useMemo, useRef, useState } = React;

		//#region shared contracts

		/** Settings namespace this package Host entry serves. */
		const NS = "dsh-pocket-kit";

		/** Route that lists a Session unacknowledged recoveries (Host half owns it). */
		const RECOVERED_PATH = "/dsh-pocket-kit/recovered-input";

		/** Route that acknowledges recoveries. */
		const RECOVERED_ACK_PATH = "/dsh-pocket-kit/recovered-input/ack";

		/** Route that serves this package's bundled logo (Host half owns it). */
		const LOGO_ROUTE = "/dsh-pocket-kit/logo";

		/** Every feature, in Settings display order: config key plus copy keys. */
		const FEATURES = [
			// The picker interaction is a Host backend + Client surface pair, and a
			// page only receives the surfaces that were Loader rows when its boot
			// graph was composed. Swapping mid-session would leave the open page
			// driving a capability the Host no longer serves, so this switch is
			// honest about needing a restart instead of half-applying.
			{ id: "pinBrowsePicker", label: "feature.pinBrowsePicker.label", description: "feature.pinBrowsePicker.description", restart: true },
			{ id: "inputRecovery", label: "feature.inputRecovery.label", description: "feature.inputRecovery.description" },
			{ id: "customLogo", label: "feature.customLogo.label", description: "feature.customLogo.description" },
			{ id: "forceSystemModelPicker", label: "feature.forceSystemModelPicker.label", description: "feature.forceSystemModelPicker.description", restart: true, defaultOn: false },
		];

		//#endregion

		//#region styles

		/** Stylesheet identity, keyed so a reloaded bundle reuses its tag. */
		const STYLE_TAG_ID = "dsh-pocket-kit/styles";

		const CSS = [
			".pbp-section{max-width:720px;color:var(--dsw-alias-label-primary);flex-direction:column;gap:12px;display:flex}",
			".pbp-title{color:var(--dsw-alias-label-primary);margin:0;font-size:16px;font-weight:500;line-height:24px}",
			".pbp-intro{color:var(--dsw-alias-label-tertiary);margin:0;font-size:14px;line-height:22px}",
			".pbp-rows{flex-direction:column;margin:12px 0 0;display:flex}",
			".pbp-row{border-bottom:.5px solid var(--dsw-alias-border-l2);justify-content:space-between;align-items:center;gap:16px 24px;padding:16px 0;display:flex;flex-wrap:wrap}",
			".pbp-row>div:first-child{flex:1;min-width:220px}",
			".pbp-rows>:last-child{border-bottom:none}",
			".pbp-rowTitle{font-size:14px;line-height:20px}",
			".pbp-rowDescription{color:var(--dsw-alias-label-secondary);margin-top:4px;font-size:12px;line-height:18px}",
			".pbp-rowHint{color:var(--dsw-alias-label-tertiary);margin-top:4px;font-size:12px;line-height:18px}",
			".pbp-error{color:var(--dsw-alias-state-error-primary);margin-top:4px;font-size:12px;line-height:18px}",
			// The composer dock is wider than the composer card, so a bare block
			// overhangs the input box. The width/max-width below are copied verbatim
			// from the shell's own dock panel (its todo panel), so this banner lines
			// up with the panels above the composer instead of overhanging them.
			".pbp-recovery{--pbp-mark:26px;--pbp-markGap:10px;box-sizing:border-box;width:calc(100% - var(--dsh-composer-side-clearance,16px)*2 - var(--dsh-composer-dock-inset,8px)*4);max-width:calc(var(--dsh-composer-card-max-width,952px) - var(--dsh-composer-dock-inset,8px)*4);margin:0 auto 8px;position:relative;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);border-radius:12px;flex-direction:column;gap:10px;padding:13px 15px 12px;display:flex;overflow:hidden}",
			".pbp-recoveryHeader{align-items:flex-start;gap:var(--pbp-markGap);display:flex}",
			".pbp-recoveryBadge{background:var(--dsw-alias-interactive-bg-hover,var(--dsw-alias-bg-layer-2));color:var(--dsw-alias-label-secondary);border-radius:8px;flex:none;justify-content:center;align-items:center;width:var(--pbp-mark);height:var(--pbp-mark);margin-top:1px;display:flex}",
			".pbp-recoveryHeading{flex-direction:column;gap:1px;min-width:0;flex:1;display:flex}",
			".pbp-recoveryEyebrow{color:var(--dsw-alias-label-tertiary);letter-spacing:.09em;text-transform:uppercase;font-size:10px;font-weight:600;line-height:14px}",
			".pbp-recoveryTitle{color:var(--dsw-alias-label-primary);letter-spacing:-.005em;font-size:14px;font-weight:500;line-height:20px}",
			".pbp-recoveryMeta{color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums;white-space:nowrap;flex:none;padding-top:3px;font-size:11px;line-height:16px}",
			".pbp-recoveryPreview{border-left:2px solid var(--dsw-alias-border-l3);margin-left:calc(var(--pbp-mark) + var(--pbp-markGap));padding:1px 0 1px 12px}",
			".pbp-recoveryText{color:var(--dsw-alias-label-primary);white-space:pre-wrap;word-break:break-word;max-height:140px;overflow:auto;font-size:13px;line-height:1.72;overscroll-behavior:contain;scrollbar-width:thin}",
			".pbp-recoveryFooter{flex-wrap:wrap;justify-content:space-between;align-items:center;gap:8px 16px;display:flex}",
			".pbp-recoveryCause{color:var(--dsw-alias-label-tertiary);align-items:baseline;gap:6px;min-width:0;flex:1 1 320px;margin-left:calc(var(--pbp-mark) + var(--pbp-markGap));font-size:11px;line-height:16px;display:flex}",
			".pbp-recoveryCauseLabel{flex:none}",
			// Two lines, not one: a provider error is the only explanation the user
			// gets, and a single clipped line usually cuts it before the useful part.
			".pbp-recoveryCauseText{-webkit-line-clamp:2;-webkit-box-orient:vertical;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;white-space:normal;word-break:break-word;text-overflow:ellipsis;min-width:0;overflow:hidden;display:-webkit-box;font-size:10.5px;line-height:15px}",
			".pbp-recoveryActions{align-items:center;gap:4px;margin-left:auto;display:flex;flex:none}",
			".pbp-logo{display:block;object-fit:contain;border-radius:6px}",
		].join("");

		/**
		 * Install the stylesheet, or refresh the one an earlier bundle left behind.
		 *
		 * A hot update re-runs this module while the page still holds the previous
		 * `<style>` element. Returning early there is not a no-op: the new markup
		 * renders against the old rules, so a redesigned surface appears with the
		 * previous typography and spacing. Overwriting `textContent` in place keeps
		 * one tag and makes the sheet always match the code that installed it.
		 */
		function insertStyles() {
			if (typeof document === "undefined") return;
			const existing = document.getElementById(STYLE_TAG_ID);
			if (existing !== null) {
				if (existing.textContent !== CSS) existing.textContent = CSS;
				return;
			}
			const style = document.createElement("style");
			style.id = STYLE_TAG_ID;
			style.textContent = CSS;
			document.head.appendChild(style);
		}

		//#endregion

		//#region dictionaries

		const zh = {
			"nav": "口袋工具箱",
			"page.title": "口袋工具箱",
			"page.intro": "这个插件把若干互不相关的小功能收在一起。每个功能都可以单独关掉，关掉后它的 Host 与界面部分都不再工作。",
			"restartHint": "更改后需重启 DSH 生效。",
			"feature.pinBrowsePicker.label": "固定目录选择器为应用内浏览",
			"feature.pinBrowsePicker.description": "让「添加工作区」始终使用应用内目录浏览器，而不是 macOS 系统文件选择器。关闭后恢复系统默认（可能被代理或启动环境改变）。",
			"feature.inputRecovery.label": "找回被吞掉的输入",
			"feature.inputRecovery.description": "某一轮在真正开始前就失败时（插件报错、进程退出等），你发出的那段文字会留在会话记录里，却不会出现在对话中。开启后，这段文字会重新显示在输入框上方，一键即可放回。",
			"feature.customLogo.label": "更换左上角 Logo",
			"feature.customLogo.description": "把侧边栏左上角的鲸鱼图标换成插件自带的鲸鱼娘插画。图片随插件一起分发、不可定制；关掉即回到 DSH 原生图标。",
			"feature.forceSystemModelPicker.label": "强制模型选择器使用系统控件",
			"feature.forceSystemModelPicker.description": "开启后，在启动时停用占用输入框模型座位的第三方插件（如平铺面板、ACP 控件），让 DSH 自带的原生选择器接管。注意：停用 ACP 会同时关闭 ACP 委托功能。",
			"recovery.eyebrow": "已找回的输入",
			"recovery.head": "这一轮的输入没有发出去",
			"recovery.reason": "原因：{reason}",
			"recovery.reasonLabel": "原因",
			"recovery.size": "{count} 字",
			"recovery.restore": "放回输入框",
			"recovery.copy": "复制",
			"recovery.dismiss": "忽略",
			"recovery.copied": "已复制",
			"saveFailed": "保存失败，请重试。",
		};

		const en = {
			"nav": "Pocket Kit",
			"page.title": "Pocket Kit",
			"page.intro": "This plugin collects several unrelated small features. Each one can be turned off on its own; a disabled feature stops running in both the Host and the page.",
			"restartHint": "Takes effect after you restart DSH.",
			"feature.pinBrowsePicker.label": "Pin picker to in-app browse",
			"feature.pinBrowsePicker.description": "Keep Add workspace using the in-app directory browser instead of the macOS system file panel. Turn off to restore the system default (which can change with proxy or launch environment).",
			"feature.inputRecovery.label": "Recover swallowed input",
			"feature.inputRecovery.description": "When a turn fails before it really starts (a plugin throws, the process exits), the text you sent stays in the session log but never appears in the conversation. With this on, that text is shown above the composer and one click puts it back in the draft.",
			"feature.customLogo.label": "Replace the corner logo",
			"feature.customLogo.description": "Swap the whale mark in the sidebar's top-left corner for the whale-girl artwork bundled with this plugin. The image ships with the package and is not user-configurable; switch it off to get DSH's own mark back.",
			"feature.forceSystemModelPicker.label": "Force model picker to use system control",
			"feature.forceSystemModelPicker.description": "When on, disables the plugins that occupy the composer's model seat at startup (such as the flat panel or the ACP control) so DSH's shipped picker takes over. Note: disabling ACP also turns off ACP delegation.",
			"recovery.eyebrow": "Recovered input",
			"recovery.head": "This prompt never went out",
			"recovery.reason": "Cause: {reason}",
			"recovery.reasonLabel": "Cause",
			"recovery.size": "{count} characters",
			"recovery.restore": "Put it back",
			"recovery.copy": "Copy",
			"recovery.dismiss": "Dismiss",
			"recovery.copied": "Copied",
			"saveFailed": "Could not save. Try again.",
		};

		//#endregion

		//#region nav glyph

		/**
		 * The Settings nav glyph: a compact toolbox, matching the plugin icon.
		 *
		 * Drawn at 16x16 with `stroke="currentColor"` so the shell nav color rules
		 * keep driving it, exactly like the shipped section glyphs.
		 *
		 * @param props - `size` in pixels and whether the section is active.
		 * @returns the glyph element.
		 */
		function KitNavIcon({ size = 16 }) {
			return h("svg", {
				width: size,
				height: size,
				viewBox: "0 0 16 16",
				fill: "none",
				stroke: "currentColor",
				strokeWidth: 1.3,
				strokeLinecap: "round",
				"aria-hidden": true,
			}, KIT_ICON_PATHS.map((d) => h("path", { key: d, d })));
		}

		/** Toolbox outline: body, handle, hinge band and the latch in the middle. */
		const KIT_ICON_PATHS = [
			"M2.2 5.9h11.6v7.1a1 1 0 0 1-1 1H3.2a1 1 0 0 1-1-1V5.9Z",
			"M5.8 5.9V4.8c0-.6.5-1.1 1.1-1.1h2.2c.6 0 1.1.5 1.1 1.1v1.1",
			"M2.2 8.2h11.6",
			"M6.8 8.2v2.1h2.4V8.2",
		];

		//#endregion

		//#region custom logo

		/**
		 * The sidebar brand mark, replaced with the configured image.
		 *
		 * The sidebar declares `sidebar.brand.mark` as a single-kind slot and the
		 * official plugin fills it at the default priority 0. A single slot renders
		 * its LOWEST-priority registration, so registering at priority -1 replaces
		 * the mark while leaving the wordmark, the New-Session behaviour and the
		 * collapsed rail exactly as the shell built them.
		 *
		 * The image is a Host-served URL, not a bundle asset, so the same code
		 * handles PNG and SVG alike: the slot owner wants a node, and an `<img>`
		 * over a same-origin route is one.
		 *
		 * @param props - the square edge the sidebar requests.
		 * @returns the mark, or nothing while the image is unavailable.
		 */
		function CustomBrandMark({ size, useConfig }) {
			// The registration injects `hooks: { config }`, which the renderer turns
			// into this prop. The fallback keeps the component callable without one
			// (and keeps the hook count stable: the prop's presence is fixed per
			// registration, so this is not a conditional hook).
			const readConfig = typeof useConfig === "function"
				? useConfig
				: (selector) => selector({ status: "loading", value: undefined });
			const snapshot = readConfig((state) => state);
			// The switch is live, so the mark follows it: turning the feature off
			// restores DSH's own icon immediately, and turning it back on retries
			// the image instead of leaving a failed state pinned.
			const on = snapshot?.value?.customLogo !== false;
			const [failed, setFailed] = useState(false);
			useEffect(() => {
				setFailed(false);
			}, [on]);
			if (!on || failed) {
				// DSH's own mark, so the corner never ends up empty.
				return FishLogo === undefined ? null : h(FishLogo, { size });
			}
			return h("img", {
				className: "pbp-logo",
				src: LOGO_ROUTE,
				width: size,
				height: size,
				alt: "",
				draggable: false,
				"aria-hidden": true,
				onError: () => setFailed(true),
			});
		}

		//#endregion
		//#region settings page

		/**
		 * One switch row: label, description, and the switch itself.
		 *
		 * @param props - row copy, current value, writability and the write callback.
		 * @returns the row element.
		 */
		function FeatureRow({ title, description, checked, disabled, failed, hintKey, onChange, t, children }) {
			return h("div", { className: "pbp-row" },
				h("div", null,
					h("div", { className: "pbp-rowTitle" }, title),
					h("div", { className: "pbp-rowDescription" }, description),
					hintKey ? h("div", { className: "pbp-rowHint" }, t(hintKey)) : null,
					children ?? null,
					failed ? h("div", { className: "pbp-error", role: "alert" }, t("saveFailed")) : null),
				h(Switch, {
					checked,
					disabled,
					label: title,
					onChange: (next) => onChange(next),
				}));
		}

		/**
		 * The collection Settings page.
		 *
		 * Every row writes this package Host Config through `configForms`, exactly
		 * like DSH own preference rows, so a switch persists in the profile patch.
		 * Rows marked `restart` say so: see the note on the picker feature.
		 *
		 * @param props - injected config hook, field writer and translator.
		 * @returns the page element.
		 */
		function FeaturesSection({ useConfig, setField, t }) {
			const state = useConfig((snapshot) => snapshot);
			const value = state.status === "ready" ? state.value : undefined;
			const disabled = state.writable !== true;
			const [failedField, setFailedField] = useState(null);

			/** Write one field, surfacing a refusal as that row error. */
			const write = useCallback((field, next) => {
				setFailedField(null);
				let pending;
				try {
					pending = setField(field, next);
				} catch {
					setFailedField(field);
					return Promise.resolve(false);
				}
				return Promise.resolve(pending).then((accepted) => {
					if (accepted !== true) setFailedField(field);
					return accepted === true;
				}, () => {
					setFailedField(field);
					return false;
				});
			}, [setField]);

			return h("div", { className: "pbp-section" },
				h("h2", { className: "pbp-title" }, t("page.title")),
				h("p", { className: "pbp-intro" }, t("page.intro")),
				h("div", { className: "pbp-rows" },
					FEATURES.map((feature) => h(FeatureRow, {
						key: feature.id,
						title: t(feature.label),
						description: t(feature.description),
						hintKey: feature.restart === true ? "restartHint" : feature.hint ?? null,
						checked: value?.[feature.id] === undefined ? feature.defaultOn !== false : value[feature.id] !== false,
						disabled,
						failed: failedField === feature.id,
						onChange: (next) => write(feature.id, next),
						t,
					}))));
		}

		//#endregion

		//#region input recovery

		/**
		 * Read one Session unacknowledged recoveries.
		 * @param sessionId - the Session to ask about.
		 * @returns the recovered prompts, newest last.
		 */
		async function fetchRecovered(sessionId) {
			if (sessionId === undefined || sessionId === "") return [];
			const response = await fetch(RECOVERED_PATH + "?session=" + encodeURIComponent(sessionId), { method: "GET" });
			if (!response.ok) return [];
			const body = await response.json();
			return Array.isArray(body?.items) ? body.items : [];
		}

		/**
		 * Acknowledge (dismiss) recoveries so they stop being offered.
		 * @param sessionId - owning Session.
		 * @param ids - record ids to drop.
		 * @returns nothing; failures are silent because the next poll retries.
		 */
		async function ackRecovered(sessionId, ids) {
			if (ids.length === 0) return;
			try {
				await fetch(RECOVERED_ACK_PATH, {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ session: sessionId, ids }),
				});
			} catch {
				// Nothing to do: the row stays until the Host accepts the ack.
			}
		}

		/**
		 * The small undo glyph in the banner header.
		 *
		 * Drawn with `currentColor` so it follows the host theme, and hidden from
		 * assistive tech because the eyebrow beside it already names the banner.
		 *
		 * @returns the glyph element.
		 */
		function RecoveryGlyph() {
			return h("svg", {
				width: 15,
				height: 15,
				viewBox: "0 0 16 16",
				fill: "none",
				stroke: "currentColor",
				strokeWidth: 1.4,
				strokeLinecap: "round",
				strokeLinejoin: "round",
				"aria-hidden": true,
			},
			// Undo: an arrowhead pointing left, then the stroke curving away to the
			// right. A near-full arc reads as a loading spinner at this size, which
			// is the wrong promise for a banner that is already finished.
			h("path", { d: "M6 9.33 2.67 6 6 2.67" }),
			h("path", { d: "M2.67 6h7a3.67 3.67 0 0 1 0 7.33h-2.2" }));
		}

		/**
		 * Banner above the composer offering one recovered prompt back.
		 *
		 * It restores through the Session own input actions, so the text lands in
		 * the real draft (undo stack included) rather than in a private copy. When
		 * those actions are unavailable it falls back to the clipboard, so the text
		 * is never lost to a UI difference.
		 *
		 * @param props - Session identity, input actions and translator.
		 * @returns the banner, or null while nothing is pending.
		 */
		function RecoveryBanner({ sessionId, inputActions, enabled, t }) {
			const [items, setItems] = useState([]);
			const [copied, setCopied] = useState(null);
			const sessionRef = useRef(sessionId);
			sessionRef.current = sessionId;

			/** Poll the Host route; also re-reads on every Session switch. */
			useEffect(() => {
				if (!enabled || sessionId === undefined) {
					setItems([]);
					return undefined;
				}
				let active = true;
				const read = () => {
					void fetchRecovered(sessionId).then((next) => {
						if (active && sessionRef.current === sessionId) setItems(next);
					}, () => {});
				};
				read();
				const timer = setInterval(read, 5000);
				return () => {
					active = false;
					clearInterval(timer);
				};
			}, [sessionId, enabled]);

			/** Drop one record locally and tell the Host. */
			const drop = useCallback((id) => {
				setItems((current) => current.filter((entry) => entry.id !== id));
				void ackRecovered(sessionRef.current, [id]);
			}, []);

			/** Clipboard fallback. */
			const copy = useCallback(async (entry) => {
				try {
					await navigator.clipboard.writeText(entry.text);
					setCopied(entry.id);
				} catch {
					return;
				}
			}, []);

			/** Whether this seat can write the real draft; otherwise the banner only offers the clipboard. */
			const canRestore = typeof inputActions?.setDraft === "function";

			/** Put one recovered text back into the draft (or the clipboard when the draft is out of reach). */
			const restore = useCallback((entry) => {
				if (!canRestore) {
					void copy(entry);
					return;
				}
				inputActions.setDraft(entry.text);
				drop(entry.id);
			}, [canRestore, inputActions, drop, copy]);



			if (!enabled || items.length === 0) return null;

			return h(React.Fragment, null, items.map((entry) => h("div", { key: entry.id, className: "pbp-recovery" },
				h("div", { className: "pbp-recoveryHeader" },
					h("span", { className: "pbp-recoveryBadge", "aria-hidden": true }, h(RecoveryGlyph)),
					h("div", { className: "pbp-recoveryHeading" },
						h("div", { className: "pbp-recoveryEyebrow" }, t("recovery.eyebrow")),
						h("div", { className: "pbp-recoveryTitle" }, t("recovery.head"))),
					h("div", { className: "pbp-recoveryMeta" }, t("recovery.size", { count: entry.text.length }))),
				h("div", { className: "pbp-recoveryPreview" },
					h("div", { className: "pbp-recoveryText" }, entry.text)),
				h("div", { className: "pbp-recoveryFooter" },
					h("div", { className: "pbp-recoveryCause", title: t("recovery.reason", { reason: entry.reason }) },
						h("span", { className: "pbp-recoveryCauseLabel" }, t("recovery.reasonLabel")),
						h("code", { className: "pbp-recoveryCauseText" }, entry.reason)),
					h("div", { className: "pbp-recoveryActions" },
						canRestore
							? h(Button, { variant: "primary", size: "sm", onClick: () => restore(entry) }, t("recovery.restore"))
							: null,
						h(Button, { variant: "ghost", size: "sm", onClick: () => { void copy(entry); } },
							copied === entry.id ? t("recovery.copied") : t("recovery.copy")),
						h(Button, { variant: "ghost", size: "sm", onClick: () => drop(entry.id) }, t("recovery.dismiss")))))));
		}

		//#endregion

		//#endregion

		//#region plugin

		const inject = ["uiSession", "configForms", "slots", "locale"];

		/**
		 * Install the dictionaries, the Settings page and the feature surfaces.
		 *
		 * @param ctx - the Client root context.
		 */
		function apply(ctx) {
			insertStyles();
			ctx.effect(() => ctx.locale.register(NS, { zh, en }), "dsh-pocket-kit: dictionaries");
			const t = ctx.locale.bind(NS);
			const form = ctx.configForms.get(NS);

			/** Live feature switch: true unless the Config says false. */
			const featureOn = (id) => {
				try {
					return form.getSnapshot().value?.[id] !== false;
				} catch {
					return true;
				}
			};

			// The Settings page exists only while the Host serves this namespace, so
			// a deployment without the entry shows no trace of it.
			ctx.effect(() => ctx.configForms.whileServed([NS], () => ctx.slots.inject("settings.section", () => ctx.slots.register({
				name: "settings.section",
				id: NS,
				// 6 places the page just after Sounds (5) and before Models (10).
				order: 6,
				label: () => t("nav"),
				locale: NS,
				inject: () => ({
					hooks: { config: form },
					setField: (field, value) => form.set(field, value),
				}),
			}, FeaturesSection))), "dsh-pocket-kit: settings section");
			// The nav cell icon. Older shells without settings.section.icon simply
			// keep their default glyph; the section itself is unaffected.
			try {
				ctx.slots.inject("settings.section.icon", () => ctx.slots.register({
					name: "settings.section.icon",
					id: NS,
					order: 6,
					locale: NS,
				}, KitNavIcon));
			} catch {}

			// Feature surfaces. Each one is a Session-scoped slot occupant that
			// renders nothing while its switch is off, so turning a feature off
			// needs no unmounting of the whole plugin.
			try {
				ctx.slots.inject("conversation.input.dock", () => ctx.slots.register({
					name: "conversation.input.dock",
					id: NS + "/recovery",
					locale: NS,
				}, RecoveryDock));
			} catch {
				// A shell without this seat simply has no composer dock; the
				// Settings page still works, so this is not a load failure.
			}

			// The corner logo. `sidebar.brand.mark` is single-kind and the official
			// plugin fills it at priority 0; a single slot renders its lowest
			// priority, so -1 replaces the mark without touching the wordmark, the
			// New-Session behaviour, or the collapsed rail. A shell that predates
			// the slot keeps its own mark and loses nothing else.
			try {
				ctx.slots.inject("sidebar.brand.mark", () => ctx.slots.register({
					name: "sidebar.brand.mark",
					id: NS + "/logo",
					priority: -1,
					inject: () => ({ hooks: { config: form } }),
				}, CustomBrandMark));
			} catch {
				// No such seat: the rest of the page still works.
			}

			function RecoveryDock(props) {
				const sessionId = props?.session?.sessionId;
				return h(RecoveryBanner, {
					sessionId,
					inputActions: props?.inputActions,
					enabled: featureOn("inputRecovery"),
					t: props?.t ?? t,
				});
			}
		}

		//#endregion

		exports.apply = apply;
		exports.inject = inject;
		exports.FEATURES = FEATURES;
		exports.fetchRecovered = fetchRecovered;
		exports.ackRecovered = ackRecovered;
		// Components exported for the tests, which drive them with plain element
		// objects instead of mounting React.
		exports.__test = { FeaturesSection, FeatureRow, RecoveryBanner, KitNavIcon, CustomBrandMark, insertStyles };
		exports.RECOVERED_PATH = RECOVERED_PATH;
		exports.RECOVERED_ACK_PATH = RECOVERED_ACK_PATH;
		exports.LOGO_ROUTE = LOGO_ROUTE;
		return module.exports;
	},
});