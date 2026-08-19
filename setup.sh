#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV_DIR="$SCRIPT_DIR/venv"
NEW_VENV=0

echo "Hewooooo, just loading sum thingies :3"
echo "=== Setup du récupérateur de stickers Telegram ==="

if ! command -v python3 >/dev/null 2>&1; then
  echo "unable to find python3 TwT"
  exit 1
fi

if [ ! -d "$VENV_DIR" ]; then
  echo "-> Creating venv..."
  python3 -m venv "$VENV_DIR"
  NEW_VENV=1
fi

source "$VENV_DIR/bin/activate"

if [ "$NEW_VENV" -eq 1 ] || [ "$1" = "--reinstall" ]; then
  echo "-> Installing python dependecies..."
  pip install --quiet --upgrade pip
  pip install --quiet -r "$SCRIPT_DIR/requirements.txt"
fi

if ! command -v ffmpeg >/dev/null 2>&1; then
  echo
  echo "!! ffmpeg isnt installed in here !!"
  echo "I need it to convert animated stickers (.webm) to GIF."
  case "$(uname -s)" in
  Linux*) echo "   Install it with ur app manager : sudo apt install ffmpeg" ;;
  Darwin*) echo "   Install it with : brew install ffmpeg" ;;
  *) echo "   Checkout : https://ffmpeg.org/download.html" ;;
  esac
  echo
  read -rp "Continue without insatlling it (I won't be able to download animated stickers then) [y/N] " choice
  case "$choice" in
  o | O | y | Y) ;;
  *)
    echo "Setup canceled"
    exit 1
    ;;
  esac
fi

BOT_TOKEN=""
BOT_NAME=""
while true; do
  read -rp "Token du bot Telegram (@BotFather) : " BOT_TOKEN
  if [ -z "$BOT_TOKEN" ]; then
    echo "Empty Token, pwease retry"
    continue
  fi

  echo "-> Validating BOT_TOKENen..."
  RESULT=$(
    python3 - "$BOT_TOKEN" <<'PYEOF'
import sys
import requests

token = sys.argv[1]
try:
    r = requests.get(f"https://api.telegram.org/bot{token}/getMe", timeout=10)
    data = r.json()
    if data.get("ok"):
        print("OK:" + data["result"].get("username", "bot"))
    else:
        print("FAIL:" + str(data.get("description", "token invalide")))
except Exception as e:
    print("FAIL:" + str(e))
PYEOF
  )

  if [[ "$RESULT" == OK:* ]]; then
    BOT_NAME="${RESULT#OK:}"
    echo "Valid token (bot : @$BOT_NAME)"
    break
  else
    echo "Invalid token (${RESULT#FAIL:}). Retry :)"
  fi
done

read -rp "Name of the sticker pack (short name) : " PACK_NAME
if [ -z "$PACK_NAME" ]; then
  echo "Are u kidding, disturbing me for nothing?? Byyye."
  exit 1
fi

echo
echo "=== Cooking up the sticker pack : '$PACK_NAME' ==="
python3 "$SCRIPT_DIR/main.py" "$BOT_TOKEN" "$PACK_NAME"
