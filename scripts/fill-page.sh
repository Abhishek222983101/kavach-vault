#!/usr/bin/env bash
# Walks you through the project page: puts each value on the clipboard, you paste it, press Enter, and the next one is ready.
cd "$(dirname "$0")/.."
step() { "./scripts/clip.sh" "$1" >/dev/null; printf '\n%s\n  Copied. In that box press Ctrl+A, then Ctrl+V. Press Enter here when done. ' "$2"; read -r; }
echo "Open build.qorechain.io/p/kavach-vault and click Edit project first."
step desc  "1/4  Description box"
step how   "2/4  How it's made box"
step repo  "3/4  Public GitHub repository box"
step addrs "4/4  Testnet addresses box"
./scripts/clip.sh clear >/dev/null
printf '\nDone. Now click Save changes at the bottom of the page, and send Claude a screenshot.\n'
