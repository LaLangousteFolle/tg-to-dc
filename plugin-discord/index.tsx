import { addChatBarButton, ChatBarButton, removeChatBarButton } from "@api/ChatButtons";

import { definePluginSettings } from "@api/Settings";

import { Devs } from "@utils/constants";

import { getCurrentChannel } from "@utils/discord";
import { ModalCloseButton, ModalContent, ModalHeader, ModalRoot, ModalSize, openModal } from "@utils/modal";

import definePlugin, { OptionType, PluginNative } from "@utils/types";

import { Button, DraftType, Forms, TextInput, UploadHandler, useEffect, useMemo, useRef, useState } from "@webpack/common";

const Native = VencordNative.pluginHelpers.LocalStickers as PluginNative<typeof import("./native")>;

const ALL_FILTER = "__ALL__";
const FAVORITES_FILTER = "__FAVORITES__";
const FAVORITES_KEY = "LocalStickers.favorites";
const MAX_CACHE_SIZE = 80;
const MAX_STICKER_SIZE = 1024;

interface StickerCategory {
    name: string;
    files: string[];
}

interface StickerEntry {
    name: string;
    relPath: string;
}

interface LoadedSticker {
    dataUrl: string;
    file: File;
}

const EXT_MIME: Record<string, string> = {
    ".png": "image/png",
    ".gif": "image/gif",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
};

const stickerCache = new Map<string, LoadedSticker>();

function extOf(name: string): string {
    const i = name.lastIndexOf(".");
    return i === -1 ? "" : name.slice(i).toLowerCase();
}

function prettyCategoryName(name: string): string {
    if (name === "(racine)") return "Divers";

    const last = name.split(/[/\\]/).pop() ?? name;

    return last.replace(/^stickers[_-]?/i, "").replace(/_/g, " ") || last;
}

function base64ToBytes(base64: string): Uint8Array {
    const chars = atob(base64);
    const bytes = new Uint8Array(chars.length);

    for (let i = 0; i < chars.length; i++) bytes[i] = chars.charCodeAt(i);

    return bytes;
}

function getCacheKey(folder: string, relPath: string): string {
    return `${folder}\0${relPath}`;
}

function getFavorites(): string[] {
    try {
        const value = JSON.parse(localStorage.getItem(FAVORITES_KEY) ?? "[]");
        return Array.isArray(value) ? value.filter(value => typeof value === "string") : [];
    } catch {
        return [];
    }
}

function setFavorites(favorites: string[]): void {
    localStorage.setItem(FAVORITES_KEY, JSON.stringify(favorites));
}

function toggleFavorite(relPath: string): boolean {
    const favorites = getFavorites();
    const index = favorites.indexOf(relPath);

    if (index === -1) {
        favorites.push(relPath);
        setFavorites(favorites);
        return true;
    }

    favorites.splice(index, 1);
    setFavorites(favorites);
    return false;
}

function getChatInputEditor(): HTMLElement | null {
    const candidates = Array.from(document.querySelectorAll('[data-slate-editor="true"]')) as HTMLElement[];
    const visible = candidates.filter(el => el.offsetParent !== null);

    if (!visible.length) return null;

    visible.sort((a, b) => b.getBoundingClientRect().bottom - a.getBoundingClientRect().bottom);

    return visible[0];
}

function sendViaEnterKey() {
    const editor = getChatInputEditor();

    if (!editor) return;

    editor.focus();

    const opts = {
        key: "Enter",
        code: "Enter",
        keyCode: 13,
        which: 13,
        bubbles: true,
        cancelable: true,
    };

    editor.dispatchEvent(new KeyboardEvent("keydown", opts));
    editor.dispatchEvent(new KeyboardEvent("keyup", opts));
}

async function loadImageFromFile(file: File): Promise<HTMLImageElement> {
    const url = URL.createObjectURL(file);

    try {
        return await new Promise((resolve, reject) => {
            const img = new Image();

            img.onload = () => resolve(img);
            img.onerror = reject;
            img.src = url;
        });
    } finally {
        URL.revokeObjectURL(url);
    }
}

async function resizeToStickerSize(file: File, requestedSize: number): Promise<File> {
    const size = Math.max(32, Math.min(MAX_STICKER_SIZE, Math.round(requestedSize)));
    const img = await loadImageFromFile(file);

    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;

    const ctx = canvas.getContext("2d");

    if (!ctx) throw new Error("Impossible de créer le contexte canvas");

    const scale = Math.min(size / img.width, size / img.height);
    const width = img.width * scale;
    const height = img.height * scale;

    ctx.clearRect(0, 0, size, size);
    ctx.drawImage(img, (size - width) / 2, (size - height) / 2, width, height);

    const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(result => {
            if (result) resolve(result);
            else reject(new Error("Impossible de convertir le sticker"));
        }, "image/png");
    });

    return new File([blob], file.name.replace(/\.\w+$/, ".png"), { type: "image/png" });
}

async function loadSticker(folder: string, entry: StickerEntry): Promise<LoadedSticker> {
    const key = getCacheKey(folder, entry.relPath);
    const cached = stickerCache.get(key);

    if (cached) {
        stickerCache.delete(key);
        stickerCache.set(key, cached);
        return cached;
    }

    const base64 = await Native.readSticker(folder, entry.relPath);
    const mime = EXT_MIME[extOf(entry.name)] ?? "application/octet-stream";
    const bytes = base64ToBytes(base64);
    const file = new File([bytes.buffer as ArrayBuffer], entry.name, { type: mime });
    const loaded = {
        dataUrl: `data:${mime};base64,${base64}`,
        file,
    };

    stickerCache.set(key, loaded);

    while (stickerCache.size > MAX_CACHE_SIZE) {
        const oldest = stickerCache.keys().next().value;

        if (oldest === undefined) break;

        stickerCache.delete(oldest);
    }

    return loaded;
}

function clearFolderCache(folder: string): void {
    for (const key of stickerCache.keys()) {
        if (key.startsWith(`${folder}\0`)) stickerCache.delete(key);
    }
}

function StickerImage({
    folder,
    entry,
    onClick,
    onToggleFavorite,
    favorite,
}: {
    folder: string;
    entry: StickerEntry;
    onClick: () => void;
    onToggleFavorite: () => void;
    favorite: boolean;
}) {
    const containerRef = useRef<HTMLDivElement>(null);
    const [src, setSrc] = useState<string>();
    const [error, setError] = useState(false);

    useEffect(() => {
        const element = containerRef.current;

        if (!element) return;

        let cancelled = false;

        const load = async () => {
            try {
                const loaded = await loadSticker(folder, entry);

                if (!cancelled) setSrc(loaded.dataUrl);
            } catch (e) {
                if (!cancelled) {
                    console.error("[LocalStickers] Impossible de charger", entry.relPath, e);
                    setError(true);
                }
            }
        };

        if (!("IntersectionObserver" in window)) {
            load();
            return () => {
                cancelled = true;
            };
        }

        const observer = new IntersectionObserver(entries => {
            if (!entries.some(entry => entry.isIntersecting)) return;

            observer.disconnect();
            load();
        }, { rootMargin: "240px" });

        observer.observe(element);

        return () => {
            cancelled = true;
            observer.disconnect();
        };
    }, [folder, entry.relPath]);

    return (
        <div
            ref={containerRef}
            style={{
                position: "relative",
                width: 80,
                height: 80,
                borderRadius: 8,
                background: "var(--background-secondary)",
                overflow: "hidden",
            }}
        >
            {src ? (
                <img
                    src={src}
                    alt={entry.name}
                    title={entry.name}
                    onClick={onClick}
                    draggable={false}
                    style={{
                        width: "100%",
                        height: "100%",
                        objectFit: "contain",
                        cursor: "pointer",
                    }}
                />
            ) : (
                <div
                    style={{
                        width: "100%",
                        height: "100%",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        color: error ? "var(--text-danger)" : "var(--text-muted)",
                        fontSize: 20,
                    }}
                >
                    {error ? "!" : "…"}
                </div>
            )}

            {src && (
                <button
                    type="button"
                    title={favorite ? "Retirer des favoris" : "Ajouter aux favoris"}
                    onClick={event => {
                        event.stopPropagation();
                        onToggleFavorite();
                    }}
                    style={{
                        position: "absolute",
                        top: 3,
                        right: 3,
                        width: 24,
                        height: 24,
                        padding: 0,
                        border: 0,
                        borderRadius: 6,
                        cursor: "pointer",
                        background: "var(--background-floating)",
                        color: favorite ? "var(--text-warning)" : "var(--text-muted)",
                        opacity: 0.9,
                        fontSize: 15,
                    }}
                >
                    {favorite ? "★" : "☆"}
                </button>
            )}
        </div>
    );
}

const settings = definePluginSettings({
    folderPath: {
        type: OptionType.STRING,
        description: "Dossier racine contenant tes packs de stickers (un sous-dossier par pack)",
        default: "",
    },
    pickFolder: {
        type: OptionType.COMPONENT,
        description: "",
        component: () => (
            <Button
                onClick={async () => {
                    const folder = await Native.pickFolder();

                    if (folder) {
                        settings.store.folderPath = folder;
                    }
                }}
            >
                Choisir un dossier...
            </Button>
        ),
    },
    stickerSize: {
        type: OptionType.NUMBER,
        description: "Taille en pixels des stickers envoyés (Discord utilise 320)",
        default: 320,
    },
    autoSend: {
        type: OptionType.BOOLEAN,
        description: "Envoyer directement le sticker au clic, sans validation manuelle",
        default: false,
    },
});

function StickerPickerModal({ modalProps }: { modalProps: any }) {
    const [categories, setCategories] = useState<StickerCategory[]>([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [filter, setFilter] = useState(ALL_FILTER);
    const [search, setSearch] = useState("");
    const [favorites, setFavoritesState] = useState<string[]>(getFavorites);

    const folder = settings.store.folderPath;

    const refresh = async () => {
        if (!folder) {
            setCategories([]);
            setLoading(false);
            return;
        }

        setRefreshing(true);

        try {
            clearFolderCache(folder);
            const cats = await Native.listStickerCategories(folder);
            setCategories(cats);

            if (filter !== ALL_FILTER && filter !== FAVORITES_FILTER && !cats.some(cat => cat.name === filter)) {
                setFilter(ALL_FILTER);
            }
        } catch (e) {
            console.error("[LocalStickers] Impossible de scanner le dossier", e);
            setCategories([]);
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    };

    useEffect(() => {
        refresh();
    }, [folder]);

    const favoriteSet = useMemo(() => new Set(favorites), [favorites]);

    const allEntries = useMemo(() => {
        return categories.flatMap(category =>
            category.files.map(relPath => ({
                name: relPath.split(/[/\\]/).pop() ?? relPath,
                relPath,
                category: category.name,
            })),
        );
    }, [categories]);

    const groups = useMemo(() => {
        const lowerSearch = search.trim().toLocaleLowerCase();

        let relevant = categories;

        if (filter === FAVORITES_FILTER) {
            const favoriteEntries = allEntries
                .filter(entry => favoriteSet.has(entry.relPath))
                .filter(entry => !lowerSearch || entry.name.toLocaleLowerCase().includes(lowerSearch));

            return favoriteEntries.length
                ? [{
                    category: { name: FAVORITES_FILTER, files: favoriteEntries.map(entry => entry.relPath) },
                    entries: favoriteEntries.map(entry => ({
                        name: entry.name,
                        relPath: entry.relPath,
                    })),
                }]
                : [];
        }

        if (filter !== ALL_FILTER) {
            relevant = categories.filter(category => category.name === filter);
        }

        return relevant
            .map(category => ({
                category,
                entries: category.files
                    .map(relPath => ({
                        name: relPath.split(/[/\\]/).pop() ?? relPath,
                        relPath,
                    }))
                    .filter(entry => !lowerSearch || entry.name.toLocaleLowerCase().includes(lowerSearch)),
            }))
            .filter(group => group.entries.length > 0 || !search.trim());
    }, [categories, allEntries, favoriteSet, filter, search]);

    const toggleFavorite = (relPath: string) => {
        const next = getFavorites();
        const index = next.indexOf(relPath);

        if (index === -1) next.push(relPath);
        else next.splice(index, 1);

        setFavorites(next);
        setFavoritesState(next);
    };

    async function send(entry: StickerEntry) {
        const channel = getCurrentChannel();

        if (!channel) return;

        try {
            const loaded = await loadSticker(folder, entry);
            const isGif = extOf(entry.name) === ".gif";
            const size = settings.store.stickerSize || 320;
            const finalFile = isGif ? loaded.file : await resizeToStickerSize(loaded.file, size);

            modalProps.onClose();

            setTimeout(() => {
                UploadHandler.promptToUpload([finalFile], channel, DraftType.ChannelMessage);

                if (settings.store.autoSend) {
                    setTimeout(sendViaEnterKey, 300);
                }
            }, 10);
        } catch (e) {
            console.error("[LocalStickers] Impossible d'envoyer", entry.relPath, e);
        }
    }

    return (
        <ModalRoot {...modalProps} size={ModalSize.MEDIUM}>
            <ModalHeader>
                <Forms.FormTitle tag="h2" style={{ flexGrow: 1 }}>Mes stickers</Forms.FormTitle>

                <Button
                    size={Button.Sizes.SMALL}
                    look={Button.Looks.OUTLINED}
                    disabled={refreshing}
                    onClick={refresh}
                    style={{ marginRight: 8 }}
                >
                    {refreshing ? "..." : "Actualiser"}
                </Button>

                <ModalCloseButton onClick={modalProps.onClose} />
            </ModalHeader>

            <ModalContent>
                {!folder && (
                    <Forms.FormText style={{ margin: "12px 0" }}>
                        Configure le dossier des stickers dans les paramètres du plugin (Vencord → Plugins → LocalStickers).
                    </Forms.FormText>
                )}

                {loading && folder && (
                    <Forms.FormText style={{ margin: "12px 0" }}>
                        Analyse du dossier...
                    </Forms.FormText>
                )}

                {!loading && folder && categories.length === 0 && (
                    <Forms.FormText style={{ margin: "12px 0" }}>
                        Aucun sticker trouvé dans ce dossier (ni ses sous-dossiers).
                    </Forms.FormText>
                )}

                {!loading && folder && categories.length > 0 && (
                    <>
                        <div
                            style={{
                                display: "flex",
                                gap: 6,
                                flexWrap: "wrap",
                                margin: "12px 0",
                                paddingBottom: 8,
                                borderBottom: "1px solid var(--background-modifier-accent)",
                            }}
                        >
                            <Button
                                size={Button.Sizes.SMALL}
                                look={filter === ALL_FILTER ? Button.Looks.FILLED : Button.Looks.OUTLINED}
                                onClick={() => setFilter(ALL_FILTER)}
                            >
                                Tout ({allEntries.length})
                            </Button>

                            <Button
                                size={Button.Sizes.SMALL}
                                look={filter === FAVORITES_FILTER ? Button.Looks.FILLED : Button.Looks.OUTLINED}
                                onClick={() => setFilter(FAVORITES_FILTER)}
                            >
                                ★ Favoris ({favorites.length})
                            </Button>

                            {categories.map(category => (
                                <Button
                                    key={category.name}
                                    size={Button.Sizes.SMALL}
                                    look={filter === category.name ? Button.Looks.FILLED : Button.Looks.OUTLINED}
                                    onClick={() => setFilter(category.name)}
                                >
                                    {prettyCategoryName(category.name)} ({category.files.length})
                                </Button>
                            ))}
                        </div>

                        <TextInput
                            placeholder="Rechercher..."
                            value={search}
                            onChange={setSearch}
                            style={{ marginBottom: 12 }}
                        />

                        {groups.length === 0 && (
                            <Forms.FormText>Aucun sticker ne correspond.</Forms.FormText>
                        )}

                        <div style={{ maxHeight: 420, overflowY: "auto", paddingBottom: 12 }}>
                            {groups.map(({ category, entries }) => (
                                <div key={category.name} style={{ marginBottom: 20 }}>
                                    {category.name !== FAVORITES_FILTER && (
                                        <div
                                            style={{
                                                marginBottom: 8,
                                                textTransform: "uppercase",
                                                fontWeight: 700,
                                                fontSize: 12,
                                                letterSpacing: "0.02em",
                                                color: "var(--text-normal)",
                                            }}
                                        >
                                            {prettyCategoryName(category.name)}
                                        </div>
                                    )}

                                    <div
                                        style={{
                                            display: "grid",
                                            gridTemplateColumns: "repeat(auto-fill, minmax(80px, 1fr))",
                                            gap: 8,
                                        }}
                                    >
                                        {entries.map(entry => (
                                            <StickerImage
                                                key={entry.relPath}
                                                folder={folder}
                                                entry={entry}
                                                favorite={favoriteSet.has(entry.relPath)}
                                                onClick={() => send(entry)}
                                                onToggleFavorite={() => toggleFavorite(entry.relPath)}
                                            />
                                        ))}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </>
                )}
            </ModalContent>
        </ModalRoot>
    );
}

function openStickerPicker() {
    openModal(modalProps => <StickerPickerModal modalProps={modalProps} />);
}

const StickerChatBarIcon: ChatBarButton = ({ isMainChat }: any) => {
    if (!isMainChat) return null;

    return (
        <ChatBarButton tooltip="Stickers locaux" onClick={openStickerPicker}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 5a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3zm4 0a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3zm-4 6h4a2 2 0 0 1-4 0z" />
            </svg>
        </ChatBarButton>
    );
};

export default definePlugin({
    name: "LocalStickers",
    description: "Envoie tes propres images comme des stickers depuis un dossier local organisé en packs, redimensionnées au format sticker Discord",
    authors: [{ name: "Nono", id: 0n }],
    dependencies: ["ChatInputButtonAPI"],
    settings,
    start() {
        addChatBarButton("LocalStickers", StickerChatBarIcon);
    },
    stop() {
        removeChatBarButton("LocalStickers");
    },
});
