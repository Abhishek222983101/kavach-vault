#!/usr/bin/env bash
# Makes the repository public after drill registration has closed (18 Nov 05:29 IST = 00:00 UTC + 23:59 on 17 Nov).
set -euo pipefail
REPO="Abhishek222983101/kavach-vault"
cur=$(gh repo view "$REPO" --json visibility --jq .visibility)
if [ "$cur" = "PUBLIC" ]; then echo "already public"; exit 0; fi
now=$(date -u +%s); open_at=$(date -u -d "2026-11-18 00:00:00" +%s)
if [ "$now" -lt "$open_at" ]; then echo "too early: registration is still open"; exit 1; fi
gh repo edit "$REPO" --visibility public --accept-visibility-change-consequences
echo "public at $(date -u +%FT%TZ)"
