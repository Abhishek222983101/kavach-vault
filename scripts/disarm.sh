#!/usr/bin/env bash
# Stops and disables the drill-day automation (after the drill, or to cancel).
for t in kavach-watchtower kavach-heartbeat kavach-heartbeat-retry kavach-heartbeat-extra kavach-go-public; do systemctl --user disable --now "$t.timer" 2>/dev/null || true; done
systemctl --user disable --now kavach-awake.service 2>/dev/null || true
systemctl --user stop kavach-watchtower.service kavach-heartbeat.service 2>/dev/null || true
systemctl --user list-timers 'kavach-*' --no-pager
