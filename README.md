# dsh-pocket-kit

Pocket Kit (口袋工具箱) — a small collection of independent [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) features, each with its own switch on the plugin's Settings page (all on by default).

![Pocket Kit icon](icon.svg)

## Features

| Feature | Setting key | What it does |
|---|---|---|
| Pin directory picker to in-app browse | `pinBrowsePicker` | Keeps *Add workspace* on the built-in directory browser instead of the macOS system file panel (which the stock auto selector picks, and which can flip between launches with proxy/bind changes). Changing this switch requires a DSH restart; turning it off restores the system default on the next start. |
| Recover swallowed input | `inputRecovery` | When a turn fails (error / interrupted / aborted) after you typed a prompt that was swallowed with it, the text is saved and offered back in the conversation as a restore-to-draft banner. |
| Replace the corner logo | `customLogo` | Swaps the sidebar's top-left whale mark for the whale-girl artwork bundled in `lib/assets/`. The image ships with the package and is deliberately not configurable — DSH does not require SVG, because the mark is a slot that accepts any element, not a file. |

Details, HTTP surface and the "how it works" notes live in [docs/DETAIL.md](docs/DETAIL.md).

## Install

The plugin is a local npm package linked into your profile (no npm publish needed):

```jsonc
// ~/.dsh/profiles/<profile>/package.json
{
  "dependencies": {
    "dsh-pocket-kit": "link:/path/to/dsh-pocket-kit"
  },
  "dsh": { "profile": { "bundles": [ "dsh-pocket-kit", /* ... */ ] } }
}
```

Then `npm install` in the profile directory (or point a symlink in the profile's
`node_modules/` at the checkout) and restart DSH. The bundled
`cordis.patch.yml` pins the browse picker at boot. Most feature switches react to
volatile config changes without a restart, but `pinBrowsePicker` is the
exception: because the picker is a Host-backend + Client-surface pair mounted at
boot, toggling it only takes effect after you restart DSH (the Settings row says
so too).

## Develop

```sh
npm test   # nine suites: host, config, client, render, banner, pin-switch, logo, logo-client, resolve
```

Add a feature: register it in `lib/features/index.js`, declare its config key in
`lib/index.js` (`z.boolean().default(true).volatile()`), and add its copy keys to
the client's dictionaries. See [docs/DETAIL.md](docs/DETAIL.md#adding-a-feature).

## License

MIT