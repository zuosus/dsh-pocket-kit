/**
 * Feature: input-recovery.
 *
 * ## The failure this exists for
 *
 * A user prompt is durably recorded twice on its way into a turn:
 *
 *   1. an `agent/inbox/spliced` on target `next-turn` inserts the message into
 *      the Agent inbox the moment the browser sends it, before any model work;
 *   2. a later `agent/inbox/spliced` with `removedCount > 0` CLAIMS it for the
 *      turn that is about to run.
 *
 * The bubble the user sees in the transcript is a THIRD event: `user/message`,
 * which the AgentLoop logs only after turn processing starts. When a turn dies
 * before that point - a Host plugin throwing during tool wiring, a provider
 * exploding on the first step, the process exiting mid-turn - the log holds the
 * claim and the failure and no `user/message`. Chat then renders the turn-error
 * row and nothing else: the prompt is gone from the UI even though it is sitting
 * in the session log, intact.
 *
 * ## What this feature does
 *
 * It watches the live `session/event` feed. Per Session it remembers which human
 * messages the inbox inserted and which ones a turn claimed; when a turn ends in
 * failure without ever logging a claimed message, it records a recovery entry
 * (text, turn, reason) and keeps it, so the Client half can put the text back in
 * front of the user.
 *
 * Records are served over two same-origin routes, fenced with the composition
 * `connection.requestRejection` exactly like the open-in-app routes:
 *
 *   GET  /pin-browse-picker/recovered-input?session=<id>
 *   POST /pin-browse-picker/recovered-input/ack   { session, ids }
 *
 * @module pin-browse-picker/features/input-recovery
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/** Route that lists a Session unacknowledged recoveries. */
export const RECOVERED_PATH = "/pin-browse-picker/recovered-input";

/** Route that acknowledges (dismisses) recoveries. */
export const RECOVERED_ACK_PATH = "/pin-browse-picker/recovered-input/ack";

/** Turn endings that can leave a claimed prompt unlogged. */
const FAILURE_KINDS = new Set(["error", "interrupted", "aborted"]);

/** Per-Session cap, so a pathological log cannot grow the store without limit. */
const MAX_RECORDS_PER_SESSION = 20;

/** Request-body cap for the ack route. */
const MAX_BODY_BYTES = 64 * 1024;

/** Where recoveries persist, so a Host restart does not lose a pending one. */
const STORE_PATH = join(homedir(), ".dsh", "pin-browse-picker", "recovered-input.json");

/**
 * Reconstruct the user text from one inbox `UserMessage` payload.
 * @param {unknown} message - one `inserted` member of an inbox splice.
 * @returns {string} the joined text blocks, trimmed.
 */
function textOf(message) {
	if (message === null || typeof message !== "object") return "";
	const content = message.content;
	if (!Array.isArray(content)) return "";
	const parts = [];
	for (const part of content) {
		if (part !== null && typeof part === "object" && part.type === "text" && typeof part.text === "string") {
			parts.push(part.text);
		}
	}
	return parts.join("\n").trim();
}

/**
 * Read the message identity out of one inbox payload.
 * @param {unknown} message - one inbox message payload.
 * @returns {string | undefined} its id.
 */
function idOf(message) {
	if (message === null || typeof message !== "object") return undefined;
	return typeof message.id === "string" && message.id !== "" ? message.id : undefined;
}

/**
 * Whether one inbox message came from the human at the keyboard.
 * @param {unknown} message - one inbox message payload.
 * @returns {boolean} true for `source.kind === "user"`.
 */
function isHuman(message) {
	if (message === null || typeof message !== "object") return false;
	const source = message.source;
	return source !== null && typeof source === "object" && source.kind === "user";
}

/**
 * Render a turn end reason as one readable line.
 * @param {unknown} reason - the `turn/end` reason payload.
 * @returns {string} a user-facing failure sentence.
 */
function reasonOf(reason) {
	if (reason === null || typeof reason !== "object") return "the turn failed before it started";
	if (reason.kind === "interrupted") return "the DSH process exited before this turn finished";
	if (reason.kind !== "error") return "the turn was cancelled before it started";
	const error = reason.error;
	if (error !== null && typeof error === "object" && typeof error.message === "string" && error.message !== "") {
		return error.message;
	}
	return "the turn failed before it started";
}

/**
 * Load the persisted recovery store.
 * @returns {Map<string, object[]>} session id to records; empty when unreadable.
 */
function loadStore() {
	const store = new Map();
	let parsed;
	try {
		parsed = JSON.parse(readFileSync(STORE_PATH, "utf8"));
	} catch {
		return store;
	}
	if (parsed === null || typeof parsed !== "object") return store;
	for (const [sessionId, records] of Object.entries(parsed)) {
		if (!Array.isArray(records)) continue;
		const valid = records.filter((record) => record !== null && typeof record === "object"
			&& typeof record.id === "string" && typeof record.text === "string");
		if (valid.length > 0) store.set(sessionId, valid);
	}
	return store;
}

/**
 * Read a bounded request body as UTF-8 text.
 * @param {any} req - the incoming request.
 * @returns {Promise<string>} the body, or an empty string when it exceeds the cap.
 */
function readBody(req) {
	return new Promise((resolve) => {
		let size = 0;
		const chunks = [];
		req.on("data", (chunk) => {
			size += chunk.length;
			if (size > MAX_BODY_BYTES) {
				resolve("");
				return;
			}
			chunks.push(chunk);
		});
		req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
		req.on("error", () => resolve(""));
	});
}

/**
 * Install the input-recovery feature.
 *
 * @param {any} ctx - the Host plugin context.
 * @param {() => boolean} enabled - live switch reader; the watcher stops recording while off.
 */
export function applyInputRecovery(ctx, enabled) {
	const store = loadStore();
	const states = new Map();

	/** Persist the whole store; failures stay contained because recovery is best-effort. */
	const persist = () => {
		try {
			mkdirSync(dirname(STORE_PATH), { recursive: true });
			writeFileSync(STORE_PATH, JSON.stringify(Object.fromEntries(store)), "utf8");
		} catch {
			// A recovery that cannot be persisted is still served from memory.
		}
	};

	/** Read (or create) one Session detection state. */
	const stateOf = (sessionId) => {
		let state = states.get(sessionId);
		if (state === undefined) {
			state = { pending: [], claimed: [], turn: undefined, logged: new Set() };
			states.set(sessionId, state);
		}
		return state;
	};

	/** Record one swallowed prompt, deduplicated by its stable identity. */
	const record = (sessionId, turn, message, reason) => {
		const id = sessionId + ":" + turn + ":" + message.id;
		const existing = store.get(sessionId) ?? [];
		if (existing.some((entry) => entry.id === id)) return;
		const text = message.text !== "" ? message.text : "(this prompt carried no text)";
		const next = existing.concat([{ id, sessionId, turn, text, reason, at: Date.now() }]);
		store.set(sessionId, next.slice(-MAX_RECORDS_PER_SESSION));
		persist();
	};

	/** Fold one inbox splice into a Session state. */
	const acceptSplice = (state, data) => {
		if (data === null || typeof data !== "object") return;
		if (data.target !== "next-turn" && data.target !== "next-step") return;
		const inserted = Array.isArray(data.inserted) ? data.inserted : [];
		const removedCount = typeof data.removedCount === "number" ? data.removedCount : 0;
		const start = typeof data.start === "number" ? data.start : state.pending.length;
		if (removedCount > 0 && data.outcome !== "canceled") {
			// A claim: the messages at [start, start + removedCount) leave the pending
			// list and become the running turn input. Their content lives only in the
			// earlier insert splice, so it is read from the pending list, not from here.
			const removed = state.pending.splice(start, removedCount);
			if (removed.length > 0) state.claimed = removed;
			return;
		}
		const added = [];
		for (const message of inserted) {
			if (!isHuman(message)) continue;
			const id = idOf(message);
			if (id !== undefined) added.push({ id, text: textOf(message) });
		}
		state.pending.splice(start, removedCount, ...added);
	};

	ctx.effect(() => {
		ctx.on("session/event", (session, event) => {
			if (!enabled()) return;
			const sessionId = session !== null && typeof session === "object" && typeof session.id === "string"
				? session.id
				: undefined;
			if (sessionId === undefined || event === null || typeof event !== "object") return;
			const data = event.data;
			switch (event.type) {
				case "agent/inbox/spliced": {
					acceptSplice(stateOf(sessionId), data);
					return;
				}
				case "turn/start": {
					const state = stateOf(sessionId);
					state.turn = typeof data.turn === "number" ? data.turn : undefined;
					state.logged = new Set();
					return;
				}
				case "user/message": {
					const id = idOf(data);
					if (id !== undefined) stateOf(sessionId).logged.add(id);
					return;
				}
				case "turn/end": {
					const state = stateOf(sessionId);
					const reason = data.reason;
					const kind = reason !== null && typeof reason === "object" ? reason.kind : undefined;
					const turn = typeof data.turn === "number" ? data.turn : (state.turn ?? 0);
					if (typeof kind === "string" && FAILURE_KINDS.has(kind)) {
						for (const message of state.claimed) {
							if (!state.logged.has(message.id)) record(sessionId, turn, message, reasonOf(reason));
						}
					}
					state.claimed = [];
					state.logged = new Set();
					state.turn = undefined;
					return;
				}
				default:
					return;
			}
		});
		return () => {
			states.clear();
		};
	}, "pin-browse-picker: input-recovery watcher");

	ctx.inject(["webServer", "connection"], (child) => {
		child.effect(() => child.webServer.register({
			kind: "exact",
			path: RECOVERED_PATH,
			handler: async (req, res) => {
				const rejection = child.connection.requestRejection(req);
				if (rejection !== undefined) {
					res.statusCode = rejection;
					res.end();
					return;
				}
				if (req.method !== "GET") {
					res.statusCode = 405;
					res.setHeader("allow", "GET");
					res.end();
					return;
				}
				const url = new URL(req.url ?? RECOVERED_PATH, "http://localhost");
				const sessionId = url.searchParams.get("session") ?? "";
				const items = sessionId === "" || !enabled() ? [] : (store.get(sessionId) ?? []);
				res.statusCode = 200;
				res.setHeader("content-type", "application/json; charset=utf-8");
				res.setHeader("cache-control", "no-store");
				res.end(JSON.stringify({ items }));
			},
		}), "pin-browse-picker: recovered-input route");

		child.effect(() => child.webServer.register({
			kind: "exact",
			path: RECOVERED_ACK_PATH,
			handler: async (req, res) => {
				const rejection = child.connection.requestRejection(req);
				if (rejection !== undefined) {
					res.statusCode = rejection;
					res.end();
					return;
				}
				if (req.method !== "POST") {
					res.statusCode = 405;
					res.setHeader("allow", "POST");
					res.end();
					return;
				}
				let parsed;
				try {
					parsed = JSON.parse(await readBody(req));
				} catch {
					res.statusCode = 400;
					res.end();
					return;
				}
				const sessionId = typeof parsed?.session === "string" ? parsed.session : "";
				const ids = Array.isArray(parsed?.ids)
					? parsed.ids.filter((id) => typeof id === "string")
					: [];
				if (sessionId !== "") {
					const remaining = (store.get(sessionId) ?? []).filter((entry) => !ids.includes(entry.id));
					if (remaining.length === 0) store.delete(sessionId);
					else store.set(sessionId, remaining);
					persist();
				}
				res.statusCode = 200;
				res.setHeader("content-type", "application/json; charset=utf-8");
				res.end(JSON.stringify({ ok: true }));
			},
		}), "pin-browse-picker: recovered-input ack route");
	});
}
