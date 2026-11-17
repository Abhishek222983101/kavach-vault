#!/usr/bin/env bash
# Copies registration values to the clipboard so you never have to read or type them.
#   ./scripts/clip.sh key         the drill classical key (from .secrets/REGISTRATION-drill-ecdsa-key.txt)
#   ./scripts/clip.sh key0x       the same key with a 0x in front (only if the form rejects the plain one)
#   ./scripts/clip.sh contracts   the two contract addresses, one per line
#   ./scripts/clip.sh clear       empties the clipboard
cd "$(dirname "$0")/.."
copy() { if command -v wl-copy >/dev/null; then wl-copy; elif command -v xclip >/dev/null; then xclip -selection clipboard; elif command -v xsel >/dev/null; then xsel -ib; else echo "No clipboard tool found (install wl-clipboard)"; exit 1; fi; }
case "${1:-}" in
  key) tr -d '\n' < .secrets/REGISTRATION-drill-ecdsa-key.txt | copy; echo "Key copied. Paste it into the form with Ctrl+V.";;
  key0x) { printf 0x; tr -d '\n' < .secrets/REGISTRATION-drill-ecdsa-key.txt; } | copy; echo "Key copied WITH the 0x prefix. Paste it into the form with Ctrl+V.";;
  contracts) printf '%s\n%s' 0x10256EDD0877436FfCBA8A62b0598f4bAD01514B 0x3Fc71aF5bADd701FF7D718df932E0dDf8612149F | copy; echo "Both contract addresses copied. Paste them into the form with Ctrl+V.";;
  repo) printf %s https://github.com/Abhishek222983101/kavach-vault | copy; echo "GitHub link copied. Paste it into Public GitHub repository.";;
  desc) copy < docs-private/page/description.txt; echo "Description copied. Select all in the Description box (Ctrl+A), then paste (Ctrl+V).";;
  how) copy < docs-private/page/how.txt; echo "How it's made copied. Select all in that box (Ctrl+A), then paste (Ctrl+V).";;
  addrs) copy < docs-private/page/addresses.txt; echo "Testnet addresses copied. Paste them into Testnet addresses.";;
  clear) printf '' | copy; echo "Clipboard cleared.";;
  *) echo "usage: $0 repo|desc|how|addrs|clear"; exit 1;;
esac
