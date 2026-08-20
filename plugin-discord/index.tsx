import { addChatBarButton, ChatBarButton, removeChatBarButton } from "@api/ChatButtons";
import { definePluginSettings } from "@api/Settings";
import { Devs } from "@utils/constants";
import { getCurrentChannel } from "@utils/discord";
import { ModalCloseButton, ModalContent, ModalHeader, ModalRoot, ModalSize, openModal } from "@utils/modal";
import definePlugin, { OptionType, PluginNative } from "@utils/types";
import { Button, DraftType, Forms, TextInput, UploadHandler, useEffect, useMemo, useState } from "@webpack/common";

const Native = VencordNative.pluginHelpers.LocalStickers as PluginNative<typeof import("./native")>;

const ALL_FILTER = "__ALL__";

interface StickerCategory {
    name: string;
    files: string[];
}

const EXT_MIME: Record<string, string> = {
    ".png": "image/png",
    ".gif": "image/gif",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
};

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

function loadImageFromFile(file: File): Promise<HTMLImageElement> {
    const url = URL.createObjectURL(file);
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            URL.revokeObjectURL(url);
            resolve(img);
        };
        img.onerror = e => reject(e);
        img.src = url;
    });
}

async function resizeToStickerSize(file: File, size: number): Promise<File> {
    const img = await loadImageFromFile(file);
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d")!;
    const scale = Math.min(size / img.width, size / img.height);
    const w = img.width * scale;
    const h = img.height * scale;
    ctx.clearRect(0, 0, size, size);
    ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
    return new Promise(resolve => {
        canvas.toBlob(blob => {
            resolve(new File([blob!], file.name.replace(/\.\w+$/, ".png"), { type: "image/png" }));
        }, "image/png");
    });
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
    const opts = { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true };
    editor.dispatchEvent(new KeyboardEvent("keydown", opts));
    editor.dispatchEvent(new KeyboardEvent("keyup", opts));
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
                    if (folder) settings.store.folderPath = folder;
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

interface StickerEntry {
    name: string;
    relPath: string;
    dataUrl: string;
    file: File;
}

function StickerPickerModal({ modalProps }: { modalProps: any; }) {
    const [categories, setCategories] = useState<StickerCategory[]>([]);
    const [cache, setCache] = useState<Record<string, StickerEntry[]>>({});
    const [loading, setLoading] = useState(true);
    const [filter, setFilter] = useState<string>(ALL_FILTER);
    const [search, setSearch] = useState("");

    const folder = settings.store.folderPath;

    useEffect(() => {
        (async () => {
            if (!folder) {
                setLoading(false);
                return;
            }
            const cats: StickerCategory[] = await Native.listStickerCategories(folder);
            setCategories(cats);

            const nextCache: Record<string, StickerEntry[]> = {};
            await Promise.all(
                cats.map(async cat => {
                    const entries: StickerEntry[] = [];
                    for (const relPath of cat.files) {
                        try {
                            const base64 = await Native.readSticker(folder, relPath);
                            const fileName = relPath.split(/[/\\]/).pop()!;
                            const mime = EXT_MIME[extOf(fileName)] ?? "application/octet-stream";
                            const bytes = base64ToBytes(base64);
                            const file = new File([bytes.buffer as ArrayBuffer], fileName, { type: mime });
                            entries.push({ name: fileName, relPath, dataUrl: `data:${mime};base64,${base64}`, file });
                        } catch (e) {
                            console.error("[LocalStickers] Impossible de lire", relPath, e);
                        }
                    }
                    nextCache[cat.name] = entries;
                })
            );
            setCache(nextCache);
            setLoading(false);
        })();
    }, [folder]);

    const groups = useMemo(() => {
        const relevant = filter === ALL_FILTER ? categories : categories.filter(c => c.name === filter);
        const lowerSearch = search.toLowerCase();
        return relevant
            .map(cat => ({
                category: cat,
                entries: (cache[cat.name] ?? []).filter(e => e.name.toLowerCase().includes(lowerSearch)),
            }))
            .filter(g => g.entries.length > 0 || !search);
    }, [categories, cache, filter, search]);

    async function send(entry: StickerEntry) {
        const channel = getCurrentChannel();
        if (!channel) return;

        const isGif = extOf(entry.name) === ".gif";
        const size = settings.store.stickerSize || 320;
        const finalFile = isGif ? entry.file : await resizeToStickerSize(entry.file, size);

        modalProps.onClose();

        setTimeout(() => {
            UploadHandler.promptToUpload([finalFile], channel, DraftType.ChannelMessage);

            if (settings.store.autoSend) {
                setTimeout(sendViaEnterKey, 300);
            }
        }, 10);
    }

    return (
        <ModalRoot {...modalProps} size={ModalSize.MEDIUM}>
            <ModalHeader>
                <Forms.FormTitle tag="h2" style={{ flexGrow: 1 }}>Mes stickers</Forms.FormTitle>
                <ModalCloseButton onClick={modalProps.onClose} />
            </ModalHeader>
            <ModalContent>
                {!folder && (
                    <Forms.FormText style={{ margin: "12px 0" }}>
                        Configure le dossier des stickers dans les paramètres du plugin (Vencord → Plugins → LocalStickers).
                    </Forms.FormText>
                )}
                {loading && folder && <Forms.FormText style={{ margin: "12px 0" }}>Chargement des stickers...</Forms.FormText>}
                {!loading && folder && categories.length === 0 && (
                    <Forms.FormText style={{ margin: "12px 0" }}>Aucun sticker trouvé dans ce dossier (ni ses sous-dossiers).</Forms.FormText>
                )}

                {!loading && categories.length > 0 && (
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
                                Tout
                            </Button>
                            {categories.map(cat => (
                                <Button
                                    key={cat.name}
                                    size={Button.Sizes.SMALL}
                                    look={filter === cat.name ? Button.Looks.FILLED : Button.Looks.OUTLINED}
                                    onClick={() => setFilter(cat.name)}
                                >
                                    {prettyCategoryName(cat.name)} ({cat.files.length})
                                </Button>
                            ))}
                        </div>

                        <TextInput
                            placeholder="Rechercher..."
                            value={search}
                            onChange={setSearch}
                            style={{ marginBottom: 12 }}
                        />

                        {groups.length === 0 && <Forms.FormText>Aucun sticker ne correspond.</Forms.FormText>}

                        <div style={{ maxHeight: 420, overflowY: "auto", paddingBottom: 12 }}>
                            {groups.map(({ category, entries }) => (
                                <div key={category.name} style={{ marginBottom: 20 }}>
                                    <div
                                        style={{
                                            marginBottom: 8,
                                            textTransform: "uppercase",
                                            fontWeight: 700,
                                            fontSize: 12,
                                            letterSpacing: "0.02em",
                                            color: "#f2f3f5",
                                        }}
                                    >
                                        {prettyCategoryName(category.name)}
                                    </div>
                                    <div
                                        style={{
                                            display: "grid",
                                            gridTemplateColumns: "repeat(auto-fill, minmax(80px, 1fr))",
                                            gap: 8,
                                        }}
                                    >
                                        {entries.map(entry => (
                                            <img
                                                key={entry.relPath}
                                                src={entry.dataUrl}
                                                title={entry.name}
                                                onClick={() => send(entry)}
                                                style={{
                                                    width: 80,
                                                    height: 80,
                                                    objectFit: "contain",
                                                    cursor: "pointer",
                                                    borderRadius: 8,
                                                    background: "var(--background-secondary)",
                                                }}
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
