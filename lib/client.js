/**
 * Client half of `dsh-pocket-kit`.
 *
 * The package is a small collection of independent features, so this file has
 * two jobs:
 *
 *   1. one Settings page (`dsh-pocket-kit`) listing every feature with a
 *      switch, all on by default. The switches are ordinary Host Config fields,
 *      so they persist in the profile patch and apply live;
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
		const { Switch, Button } = primitives;
		const { createElement: h, useCallback, useEffect, useMemo, useRef, useState } = React;

		//#region shared contracts

		/** Settings namespace this package Host entry serves. */
		const NS = "dsh-pocket-kit";

		/** Route that lists a Session unacknowledged recoveries (Host half owns it). */
		const RECOVERED_PATH = "/dsh-pocket-kit/recovered-input";

		/** Route that acknowledges recoveries. */
		const RECOVERED_ACK_PATH = "/dsh-pocket-kit/recovered-input/ack";

		/** Every feature, in Settings display order: config key plus copy keys. */
		const FEATURES = [
			// The picker interaction is a Host backend + Client surface pair, and a
			// page only receives the surfaces that were Loader rows when its boot
			// graph was composed. Swapping mid-session would leave the open page
			// driving a capability the Host no longer serves, so this switch is
			// honest about needing a restart instead of half-applying.
			{ id: "pinBrowsePicker", label: "feature.pinBrowsePicker.label", description: "feature.pinBrowsePicker.description", restart: true },
			{ id: "inputRecovery", label: "feature.inputRecovery.label", description: "feature.inputRecovery.description" },
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
			".pbp-recovery{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-l2);border-radius:10px;flex-direction:column;gap:8px;margin-bottom:8px;padding:10px 12px;display:flex}",
			".pbp-recoveryHead{color:var(--dsw-alias-label-secondary);align-items:center;gap:8px;font-size:12px;line-height:18px;display:flex}",
			".pbp-recoveryText{color:var(--dsw-alias-label-primary);white-space:pre-wrap;word-break:break-word;max-height:132px;overflow:auto;font-size:13px;line-height:20px}",
			".pbp-recoveryActions{gap:8px;display:flex}",
		].join("");

		/** Install the stylesheet once per page. */
		function insertStyles() {
			if (typeof document === "undefined") return;
			if (document.getElementById(STYLE_TAG_ID) !== null) return;
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
			"recovery.head": "这一轮的输入没有发出去",
			"recovery.reason": "原因：{reason}",
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
			"recovery.head": "This prompt never went out",
			"recovery.reason": "Cause: {reason}",
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
		//#region settings page

		/**
		 * One switch row: label, description, and the switch itself.
		 *
		 * @param props - row copy, current value, writability and the write callback.
		 * @returns the row element.
		 */
		function FeatureRow({ title, description, checked, disabled, failed, restart, onChange, t }) {
			return h("div", { className: "pbp-row" },
				h("div", null,
					h("div", { className: "pbp-rowTitle" }, title),
					h("div", { className: "pbp-rowDescription" }, description),
					restart ? h("div", { className: "pbp-rowHint" }, t("restartHint")) : null,
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
						restart: feature.restart === true,
						checked: value?.[feature.id] !== false,
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
				h("div", { className: "pbp-recoveryHead" },
					h("span", null, t("recovery.head")),
					h("span", null, t("recovery.reason", { reason: entry.reason }))),
				h("div", { className: "pbp-recoveryText" }, entry.text),
				h("div", { className: "pbp-recoveryActions" },
					canRestore
						? h(Button, { variant: "outline", size: "sm", onClick: () => restore(entry) }, t("recovery.restore"))
						: null,
					h(Button, { variant: "outline", size: "sm", onClick: () => { void copy(entry); } },
						copied === entry.id ? t("recovery.copied") : t("recovery.copy")),
					h(Button, { variant: "outline", size: "sm", onClick: () => drop(entry.id) }, t("recovery.dismiss"))))));
		}

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
		exports.__test = { FeaturesSection, FeatureRow, RecoveryBanner, KitNavIcon };
		exports.RECOVERED_PATH = RECOVERED_PATH;
		exports.RECOVERED_ACK_PATH = RECOVERED_ACK_PATH;
		return module.exports;
	},
});
