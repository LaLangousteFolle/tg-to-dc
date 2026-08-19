# tg-to-dc

Récupère tous les stickers d'un pack Telegram et les exporte en **PNG** (stickers statiques) ou **GIF** (stickers animés `.tgs` et vidéo `.webm`), prêts à être envoyés/uploadés sur un serveur Discord.

## Fonctionnalités

- Récupère un sticker pack Telegram en entier via l'API Bot officielle
- Stickers statiques → PNG
- Stickers animés (Lottie `.tgs`) → GIF
- Stickers vidéo (`.webm`) → GIF
- Reprise automatique : relance le script après un crash/coupure réseau, il skip ce qui est déjà téléchargé
- Retry automatique avec backoff sur les erreurs réseau
- Version interactive : demande et valide ton token de bot avant de commencer

## Prérequis

- Python 3.9+
- [ffmpeg](https://ffmpeg.org/download.html) installé et dans le PATH (nécessaire seulement pour les stickers vidéo `.webm`)
- Un token de bot Telegram : parle à [@BotFather](https://t.me/BotFather) sur Telegram, `/newbot`, et récupère le token. Pas besoin de publier le bot, il sert juste à interroger l'API.

## Installation

### Linux / macOS

```bash
git clone https://github.com/LaLangousteFolle/tg-to-dc.git
cd tg-to-dc
chmod +x setup.sh
./setup.sh
```

`setup.sh` crée un venv, installe les dépendances, puis lance directement la version interactive.

Pour forcer une réinstallation des dépendances (venv déjà existant) :

```bash
./setup.sh --reinstall
```

### Windows

**Option 1 — l'exe préconstruit (le plus simple) :**

1. Va dans l'onglet [Releases](https://github.com/LaLangousteFolle/tg-to-dc/releases) et télécharge `tg-to-dc.exe`
2. Installe [ffmpeg pour Windows](https://ffmpeg.org/download.html) et ajoute son dossier `bin/` au PATH (nécessaire seulement si tu veux exporter des stickers vidéo)
3. Double-clique sur `tg-to-dc.exe`, ou lance-le depuis un terminal (recommandé, pour voir la progression)

**Option 2 — depuis les sources :**

```powershell
git clone https://github.com/LaLangousteFolle/tg-to-dc.git
cd tg-to-dc
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
python run.py
```

## Utilisation

Une fois lancé (`./setup.sh`, `run.py`, ou `tg-to-dc.exe`), le programme te demande :

1. **Le token de ton bot** — il est validé direct via l'API Telegram (`getMe`), le script reboucle si le token est invalide
2. **Le nom du sticker pack** (le "short name") — trouvable dans le lien de partage du pack : ouvre le pack dans Telegram, clique sur "Ajouter", le lien ressemble à `t.me/addstickers/NomDuPack` → le short name c'est `NomDuPack`

Les fichiers sont exportés dans un dossier `stickers_<NomDuPack>/` à côté du script.

Utilisation en CLI direct, sans les prompts (pratique pour scripter) :

```bash
python main.py <BOT_TOKEN> <PACK_SHORT_NAME>
```

## Structure du projet

| Fichier | Rôle |
|---|---|
| `main.py` | Logique de récupération/conversion des stickers, utilisable en CLI direct |
| `run.py` | Version interactive (prompts, validation du token, check ffmpeg) — c'est ce qui est packagé dans l'exe Windows |
| `setup.sh` | Setup + lancement automatisé pour Linux/macOS (venv + deps + `run.py`) |
| `requirements.txt` | Dépendances Python pour l'usage normal |
| `requirements-build.txt` | Dépendances pour builder l'exe (`requirements.txt` + PyInstaller) |
| `.github/workflows/build-windows.yml` | Build automatique de `tg-to-dc.exe` sur un runner Windows à chaque tag `v*` |

## Builder l'exe Windows soi-même

L'exe est buildé automatiquement par GitHub Actions à chaque tag de version (`git tag v1.0.0 && git push --tags`), et attaché à la release. Tu peux aussi déclencher le build manuellement depuis l'onglet **Actions** du repo (`workflow_dispatch`).

Pour le builder en local sur une machine Windows :

```powershell
pip install -r requirements-build.txt
pyinstaller --onefile --console --name tg-to-dc run.py
```

L'exe se retrouve dans `dist/tg-to-dc.exe`.

## Limitations connues

- ffmpeg n'est pas embarqué dans l'exe — il doit être installé séparément et présent dans le PATH pour convertir les stickers vidéo
- Les packs avec beaucoup de stickers animés peuvent prendre du temps à convertir (rendu Lottie image par image)

## Licence

Pas encore définie — fais-en bon usage en attendant :3
