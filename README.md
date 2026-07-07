# ampcore-tauri

Tauri + React + TypeScript rewrite of the AmpCore amplifier control app.

## Recommended IDE Setup

- [VS Code](https://code.visualstudio.com/) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)

## macOS builds are unsigned

macOS releases are built in CI but are not code-signed or notarized (no Apple Developer account yet). Gatekeeper will
refuse to open the app with "cannot be opened because the developer cannot be verified." Workaround until signing is
added: right-click the app → **Open**, or strip the quarantine attribute with `xattr -cr /Applications/ampcore-tauri.app`.

macOS builds are also currently CI-verified only (compiles and produces installer artifacts) — they have not been
run on real Apple hardware, since no Mac is available to the maintainer.
