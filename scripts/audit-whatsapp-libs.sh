#!/usr/bin/env bash
# SPEC §1 / §9.1: fail if any unofficial WhatsApp automation library is anywhere in the dependency tree.
set -euo pipefail
cd "$(dirname "$0")/.."
BANNED='whatsapp-web\.js|@whiskeysockets/baileys|baileys|@adiwajshing|venom-bot|wppconnect|open-wa|@open-wa|wa-automate|whatsapp-node-api|puppeteer'
if grep -Eiq "\"node_modules/[^\"]*(${BANNED})" package-lock.json; then
  echo "FORBIDDEN dependency found in package-lock.json:"
  grep -Eio "\"node_modules/[^\"]*(${BANNED})[^\"]*\"" package-lock.json | sort -u
  exit 1
fi
echo "lockfile audit clean: no unofficial WhatsApp libraries"
