# Pocket Kit — a small-feature collection

`dsh-pocket-kit` (口袋工具箱) is a **collection of independent small features** for DeepSeek
Harness, not a single-purpose plugin. Each feature has its own switch on the
plugin's Settings page (`口袋工具箱` / `Pocket Kit`), and every switch is on
by default except `forceSystemModelPicker`, which is opt-in.

Two parts ship together:

| Part | Where | What it is |
|---|---|---|
| Directory-picker pin | `cordis.patch.yml` + `lib/features/pin-browse-picker.js` | Disables the stock auto row and mounts one interaction pair during Host boot: the in-app **browse** backend by default, or the stock auto selector when the switch is off. |
| Feature collection | `lib/index.js`, `lib/features/*`, `lib/client.js` | A normal Host + Client plugin row. The Host installs the enabled features; the Client contributes the Settings page and the feature surfaces. |

## Features

### `inputRecovery` — recover a swallowed prompt

A prompt is durably recorded twice on its way into a turn:

1. an `agent/inbox/spliced` on target `next-turn` inserts the message into the
   Agent inbox the moment the browser sends it, before any model work;
2. a later `agent/inbox/spliced` with `removedCount > 0` **claims** it for the
   turn that is about to run.

The bubble you see in the transcript is a *third* event — `user/message` — which
the AgentLoop logs only after turn processing starts. When a turn dies before
that point (a Host plugin throws during tool wiring, a provider explodes on the
first step, the process exits mid-turn), the log holds the claim and the failure
and **no** `user/message`. Chat then renders the turn-error row and nothing else:
your prompt is gone from the UI even though it is sitting in the session log,
intact.

With this feature on:

- the Host watches the live `session/event` feed, remembers which human messages
  the inbox inserted and which ones a turn claimed, and when a turn ends in
  `error` / `interrupted` / `aborted` without ever logging a claimed message, it
  records the text plus the failure reason;
- records persist under `~/.dsh/dsh-pocket-kit/recovered-input.json`, so a
  Host restart does not lose a pending one;
- the page polls a same-origin route and shows the recovered text above the
  composer, with **Put it back** (restores the real draft through the Session's
  own input actions, undo stack included), **Copy** (clipboard fallback) and
  **Dismiss**.

The two routes are fenced with the composition's `connection.requestRejection`,
the same Host/Origin plus login-cookie check the open-in-app routes rely on:

```
GET  /dsh-pocket-kit/recovered-input?session=<id>
POST /dsh-pocket-kit/recovered-input/ack   { session, ids }
```

### `customLogo` — replace the sidebar's corner logo

The mark in the sidebar's top-left corner is not a bundled asset: the sidebar
shell declares `sidebar.brand.mark` as a **single-kind slot**, and
`@deepseek-ai/dsh-client-ui-brand-official` fills it with `<FishLogo/>` at the
default priority 0. A single slot renders its **lowest-priority** registration,
so this plugin registers at priority `-1` and wins the corner while the shell
keeps everything around it — the wordmark (`sidebar.brand.name`), the
New-Session behaviour, and the collapsed rail are untouched.

**DSH does not require SVG.** The slot owner receives a React node, not a file
path, so a raster PNG works exactly like an SVG: the mark is an `<img>` over a
Host-served URL. Converting the image to SVG would have thrown away quality for
no reason.

**The artwork ships with the package.** `lib/assets/whale-girl.png` is part of
the plugin, not a preference: the feature exists to put one fixed, reviewed
piece of artwork in the corner, so there is no path field and nothing to point
at the wrong file. Swapping the picture means replacing that file in the
package.

The bytes cannot come from the page — a browser cannot read a path inside an
installed package — so the Host serves them on one same-origin route, fenced
with `connection.requestRejection` like the open-in-app routes:

```
GET /dsh-pocket-kit/logo
```

| Concern | Behaviour |
|---|---|
| Image | `lib/assets/whale-girl.png`, 256×256 RGBA, shipped in `files` via `lib` |
| Format | Content type from the file extension (PNG, SVG, JPEG, WebP, GIF, AVIF) |
| Staleness | Read per request, with an ETag and `no-cache`, so replacing the asset changes the picture instead of being pinned by the browser |
| Switch off | Route answers 404 and the mark renders DSH's own `<FishLogo/>` |
| Unreadable file | Route answers 404 and the mark falls back to DSH's own icon, so the corner is never blank |
| Fencing | `requestRejection` refuses cross-origin/unauthenticated reads with 401/403 |

The switch is a live `volatile` Config field: turning it off restores the native
mark immediately, with no restart.

### `pinBrowsePicker` — pinned directory picker

DSH's "Add workspace" button hands the flow to whichever directory-picker backend
occupies the workspace `directoryFlow` slot. The shipped composition mounts
`@deepseek-ai/dsh-host-directory-picker-auto`, which samples the host **once per
boot** and picks a backend:

| Condition | Backend |
|---|---|
| `trustedHosts` admits a non-loopback authority | `browse` |
| the webserver bind address is not loopback | `browse` |
| `SSH_CONNECTION` or `SSH_TTY` is present | `browse` |
| darwin or win32 | `native` |
| linux with a display and zenity/kdialog on `PATH` | `native` |
| anything else | `browse` |

Because the sample is taken at boot, any change to those inputs between loads — a
proxy rewriting the bind/authority facts, a Clash fake-ip, a different SSH launch —
flips the interaction, and "Add workspace" suddenly opens Finder instead of the
built-in file manager. The patch therefore disables the stock auto row, and this
feature mounts exactly one interaction during Host boot, the same way the auto
selector mounts its own pair:

| `pinBrowsePicker` | Mounted rows |
|---|---|
| on (default) | `@deepseek-ai/dsh-host-directory-picker-browse` + `@deepseek-ai/dsh-client-ui-directory-picker-browse` |
| off | `@deepseek-ai/dsh-host-directory-picker-auto`, which resolves and mounts its own pair — exactly the behaviour without this plugin |

**Changing the switch needs a DSH restart.** A picker interaction is a pair: a
Host backend that registers `ctx.directoryPicker`, and a Client surface that
fills ui-workspace's directory-flow slot. A page only receives the client
bundles that were Loader rows when its boot graph was composed, so a surface
added after the page loaded can never appear in that page — and swapping only
the Host half would leave the open page driving a capability the Host no longer
serves. The switch saves immediately (it lands in the profile patch, as
`pinBrowsePicker: false`) and the Settings row states that a restart applies it.
The module deliberately keeps no runtime swap: half-applying would break the
picker for the rest of the session.

### `forceSystemModelPicker` — force the system model picker

The composer's model control is the `conversation.input.model` seat. DSH ships
its own picker there, but a third-party replacement can shadow it by registering
the same seat at a more negative priority — `dsh-model-flatmap` does exactly
that, and the shipped picker underneath only returns when the replacement hands
the seat back.

A replacement decides that by reading one origin-scoped `localStorage` key,
`dshmf:mode`: `flat` keeps its own panel, `native` disposes its registration so
the shipped picker is elected. That key is the *shared contract* this feature
uses, which keeps it independent of any single replacement's internals.

With the switch **on**, the Client writes `native` so the next page load shows
DSH's own picker. With it **off** (the default) the key is left completely
untouched — a replacement's own choice, and yours, survive unchanged.

| Concern | Behaviour |
|---|---|
| Default | Off: installing the plugin changes nothing about the picker |
| On | Writes `dshmf:mode = native`; the replacement steps aside at next activation |
| Off | Never writes, never clears: your own mode choice is preserved |
| When it applies | Next page load; the Settings row says so, because the key is read at activation |
| Storage unavailable | Guarded read/write; the feature degrades silently, the page never breaks |
| Host half | Deliberately inert — there is no server-side capability to install |

Because the key is read when a replacement activates, toggling the switch cannot
re-compose a picker that is already mounted. The row is therefore reload-scoped
like `pinBrowsePicker` is restart-scoped, and it says so instead of
half-applying.

## Adding a feature

1. Add `lib/features/<id>.js` exporting `apply(ctx, enabled)`.
2. Add one row to `FEATURES` in `lib/features/index.js` (Host) and one row to
   `FEATURES` in `lib/client.js` (Settings copy).
3. Add the boolean to `Config` in `lib/index.js`:

   ```js
   export const Config = z.object({
     inputRecovery: z.boolean().default(true).volatile(),
     yourFeature: z.boolean().default(true).volatile(),
   })
   ```


The Settings page picks the new switch up from the Config schema, so nothing in
the page needs editing.

## Install

The package is already linked into the `desktop` profile as
`link:/Users/chi/.dsh/workspace/dsh-pocket-kit`. Host-side changes need a DSH
restart; Client-side changes are served from the same bundle on reload.