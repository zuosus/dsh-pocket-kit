# Pocket Kit — a small-feature collection

`dsh-pocket-kit` (口袋工具箱) is a **collection of independent small features** for DeepSeek
Harness, not a single-purpose plugin. Each feature has its own switch on the
plugin's Settings page (`口袋工具箱` / `Pocket Kit`), and every switch is on
by default.

Two parts ship together:

| Part | Where | What it is |
|---|---|---|
| Directory-picker pin | `cordis.patch.yml` + `lib/features/pin-browse-picker.js` | Patches the boot composition to the in-app **browse** backend by default; the feature module makes the switch actually swap rows at runtime. |
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
built-in file manager. With the switch **on** (the default), the patch pins
`browse` by disabling the auto row and composing the backend + its client
surface directly. Turning it **off** removes those rows and mounts the stock
auto selector, restoring exactly the behaviour you would get without this
plugin. The swap uses `ctx.loader.create` / `loader.remove` on the in-memory
root tree, the same mechanism the stock auto picker uses — no config file is
rewritten, and the change takes effect without a restart.

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
