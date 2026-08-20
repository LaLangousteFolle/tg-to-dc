
import { dialog } from "electron";
import { readdir, readFile } from "fs/promises";
import { extname, join, relative } from "path";

const ALLOWED_EXT = new Set([".png", ".gif", ".jpg", ".jpeg", ".webp"]);

export interface StickerCategory {
    name: string;
    files: string[];
}

async function walk(dir: string, root: string, out: Map<string, string[]>): Promise<void> {
    let entries;
    try {
        entries = await readdir(dir, { withFileTypes: true });
    } catch (e) {
        console.error("[LocalStickers] Impossible de lire", dir, e);
        return;
    }

    for (const entry of entries) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
            await walk(full, root, out);
        } else if (entry.isFile() && ALLOWED_EXT.has(extname(entry.name).toLowerCase())) {
            const relDir = relative(root, dir) || "(racine)";
            const relFile = relative(root, full);
            if (!out.has(relDir)) out.set(relDir, []);
            out.get(relDir)!.push(relFile);
        }
    }
}

export async function pickFolder(): Promise<string | null> {
    const result = await dialog.showOpenDialog({
        properties: ["openDirectory"],
    });
    if (result.canceled || !result.filePaths.length) return null;
    return result.filePaths[0];
}

export async function listStickerCategories(_event: any, folderPath: string): Promise<StickerCategory[]> {
    if (!folderPath) return [];

    const map = new Map<string, string[]>();
    await walk(folderPath, folderPath, map);

    const categories: StickerCategory[] = Array.from(map.entries()).map(([name, files]) => ({
        name,
        files: files.sort((a, b) => a.localeCompare(b)),
    }));

    categories.sort((a, b) => a.name.localeCompare(b.name));
    return categories;
}

export async function readSticker(_event: any, folderPath: string, relativeFilePath: string): Promise<string> {
    const filePath = join(folderPath, relativeFilePath);
    const data = await readFile(filePath);
    return data.toString("base64");
}
