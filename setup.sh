#!/usr/bin/env bash
# Setup + lancement de tg-to-dc (Linux / macOS).
# Gère : venv Python, installation des deps, puis lance la version
# interactive (run.py) qui check ffmpeg, demande et valide le token,
# demande le nom du sticker pack.
#
# Usage :
#   ./setup.sh              -> setup normal (réutilise le venv s'il existe déjà)
#   ./setup.sh --reinstall  -> force la réinstallation des deps dans le venv

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV_DIR="$SCRIPT_DIR/venv"
NEW_VENV=0

echo "=== Setup de tg-to-dc ==="

# python3 dispo ?
if ! command -v python3 >/dev/null 2>&1; then
    echo "python3 introuvable. Installe-le d'abord puis relance ce script."
    exit 1
fi

# venv : création si absent
if [ ! -d "$VENV_DIR" ]; then
    echo "-> Création de l'environnement virtuel..."
    python3 -m venv "$VENV_DIR"
    NEW_VENV=1
fi

# shellcheck disable=SC1091
source "$VENV_DIR/bin/activate"

# install des deps (seulement si venv neuf ou --reinstall demandé)
if [ "$NEW_VENV" -eq 1 ] || [ "$1" = "--reinstall" ]; then
    echo "-> Installation des dépendances Python..."
    pip install --quiet --upgrade pip
    pip install --quiet -r "$SCRIPT_DIR/requirements.txt"
fi

# lance la version interactive (check ffmpeg + prompts + export)
cd "$SCRIPT_DIR"
python3 run.py
