#!/usr/bin/env python3

import sys
import os
import io
import time
import subprocess
import tempfile

import requests
from PIL import Image

API_URL = "https://api.telegram.org/bot{token}/{method}"
FILE_URL = "https://api.telegram.org/file/bot{token}/{file_path}"

REQUEST_TIMEOUT = 30  
MAX_RETRIES = 5
RETRY_DELAY = 3  


def _request_with_retry(method, url, **kwargs):
    last_exc = None
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            resp = method(url, timeout=REQUEST_TIMEOUT, **kwargs)
            resp.raise_for_status()
            return resp
        except requests.exceptions.RequestException as e:
            last_exc = e
            if attempt < MAX_RETRIES:
                wait = RETRY_DELAY * attempt
                print(f"    (réseau : {e.__class__.__name__}, retry {attempt}/{MAX_RETRIES} dans {wait}s...)")
                time.sleep(wait)
            else:
                raise
    raise last_exc


def get_sticker_set(token, pack_name):
    url = API_URL.format(token=token, method="getStickerSet")
    resp = _request_with_retry(requests.get, url, params={"name": pack_name})
    data = resp.json()
    if not data.get("ok"):
        raise RuntimeError(f"Erreur API Telegram : {data}")
    return data["result"]


def get_file_path(token, file_id):
    url = API_URL.format(token=token, method="getFile")
    resp = _request_with_retry(requests.get, url, params={"file_id": file_id})
    data = resp.json()
    if not data.get("ok"):
        raise RuntimeError(f"Erreur getFile : {data}")
    return data["result"]["file_path"]


def download_file(token, file_path):
    url = FILE_URL.format(token=token, file_path=file_path)
    resp = _request_with_retry(requests.get, url)
    return resp.content


def save_static_png(raw_bytes, out_path):
    img = Image.open(io.BytesIO(raw_bytes)).convert("RGBA")
    img.save(out_path, "PNG")


def save_webm_as_gif(raw_bytes, out_path):
    with tempfile.NamedTemporaryFile(suffix=".webm", delete=False) as tmp_in:
        tmp_in.write(raw_bytes)
        tmp_in_path = tmp_in.name

    try:
        cmd = [
            "ffmpeg", "-y", "-i", tmp_in_path,
            "-vf", "fps=20,scale=320:-1:flags=lanczos",
            "-loop", "0",
            out_path,
        ]
        subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    finally:
        os.remove(tmp_in_path)


def save_tgs_as_gif(raw_bytes, out_path):
    from lottie.parsers.tgs import parse_tgs
    from lottie.exporters.gif import export_gif

    with tempfile.NamedTemporaryFile(suffix=".tgs", delete=False) as tmp_in:
        tmp_in.write(raw_bytes)
        tmp_in_path = tmp_in.name

    try:
        animation = parse_tgs(tmp_in_path)
        export_gif(animation, out_path)
    finally:
        os.remove(tmp_in_path)


def run_export(token, pack_name):
    out_dir = f"stickers_{pack_name}"
    os.makedirs(out_dir, exist_ok=True)

    print(f"Récupération du pack '{pack_name}'...")
    sticker_set = get_sticker_set(token, pack_name)
    stickers = sticker_set["stickers"]
    print(f"{len(stickers)} stickers trouvés.")

    failed = []

    for i, sticker in enumerate(stickers):
        file_id = sticker["file_id"]
        emoji = sticker.get("emoji", "")
        is_animated = sticker.get("is_animated", False)
        is_video = sticker.get("is_video", False)

        safe_emoji = (emoji or "sticker").replace("/", "_")
        ext = "gif" if (is_video or is_animated) else "png"
        out_name = f"{i:03d}_{safe_emoji}.{ext}"
        out_path = os.path.join(out_dir, out_name)

        if os.path.exists(out_path):
            print(f"  [{i+1}/{len(stickers)}] -> {out_name} (déjà fait, skip)")
            continue

        try:
            file_path = get_file_path(token, file_id)
            raw_bytes = download_file(token, file_path)

            if is_video:
                save_webm_as_gif(raw_bytes, out_path)
            elif is_animated:
                save_tgs_as_gif(raw_bytes, out_path)
            else:
                save_static_png(raw_bytes, out_path)

            print(f"  [{i+1}/{len(stickers)}] -> {out_name}")
        except Exception as e:
            print(f"  [{i+1}/{len(stickers)}] ECHEC ({emoji}) : {e}")
            failed.append((i, emoji, str(e)))

    print(f"\nTerminé. Fichiers dans le dossier : {out_dir}/")
    if failed:
        print(f"\n{len(failed)} stickers ont échoué :")
        for i, emoji, err in failed:
            print(f"  - #{i} {emoji} : {err}")

    return out_dir, failed


def main():
    if len(sys.argv) != 3:
        print("Usage: python main.py <BOT_TOKEN> <PACK_SHORT_NAME>")
        print("(ou utilise run.py / setup.sh pour la version interactive)")
        sys.exit(1)

    run_export(sys.argv[1], sys.argv[2])


if __name__ == "__main__":
    main()
