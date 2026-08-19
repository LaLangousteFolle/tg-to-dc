#!/usr/bin/env python3

import sys
import shutil
import platform

import requests

from main import get_sticker_set, get_file_path, download_file, run_export


def check_ffmpeg():
    if shutil.which("ffmpeg"):
        return True

    print()
    print("!! ffmpeg n'est pas trouvé sur ta machine.")
    print("   Nécessaire seulement pour convertir les stickers vidéo (.webm) en GIF.")
    system = platform.system()
    if system == "Linux":
        print("   Installe-le avec : sudo apt install ffmpeg   (ou dnf/pacman/nix selon ta distro)")
    elif system == "Darwin":
        print("   Installe-le avec : brew install ffmpeg")
    else:
        print("   Télécharge-le ici : https://ffmpeg.org/download.html")
        print("   (sur Windows : décompresse l'archive puis ajoute le dossier bin/ à ton PATH)")
    print()

    choice = input("Continuer quand même (les stickers vidéo échoueront) ? [o/N] ").strip().lower()
    return choice in ("o", "y")


def validate_token(token):
    try:
        r = requests.get(f"https://api.telegram.org/bot{token}/getMe", timeout=10)
        data = r.json()
        if data.get("ok"):
            return True, data["result"].get("username", "bot")
        return False, data.get("description", "token invalide")
    except Exception as e:
        return False, str(e)


def ask_token():
    while True:
        token = input("Token du bot Telegram (@BotFather) : ").strip()
        if not token:
            print("Token vide, réessaie.")
            continue

        print("-> Validation du token...")
        ok, info = validate_token(token)
        if ok:
            print(f"Token valide (bot : @{info})")
            return token
        print(f"Token invalide ({info}). Réessaie.")


def ask_pack_name():
    while True:
        name = input("Nom du sticker pack (short name, ex: PentaButt) : ").strip()
        if name:
            return name
        print("Nom de pack vide, réessaie.")


def main():
    print("=== tg-to-dc : récupérateur de stickers Telegram -> PNG/GIF ===")
    check_ffmpeg()
    token = ask_token()
    pack_name = ask_pack_name()

    print()
    print(f"=== Récupération du pack '{pack_name}' ===")
    run_export(token, pack_name)

    input("\nAppuie sur Entrée pour quitter...")


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\nInterrompu.")
        sys.exit(1)
