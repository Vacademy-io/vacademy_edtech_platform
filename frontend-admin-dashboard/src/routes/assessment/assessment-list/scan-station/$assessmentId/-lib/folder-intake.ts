import type { DirectoryPickerHost, ScanDirectoryHandle } from './fs-access';

/**
 * Getting a scanner's output folder into the page, in every browser a clerk uses:
 * - Chrome / Edge: the folder picker (showDirectoryPicker);
 * - Safari / Firefox: an <input type=file webkitdirectory>, or a dropped folder
 *   read through webkitGetAsEntry.
 * Order is NOT decided here (see order-files.ts); hidden files are skipped.
 */

export type ScanFileClass = 'IMAGE' | 'PDF' | 'UNSUPPORTED';

const SKIPPED_NAMES = new Set(['.ds_store', 'thumbs.db', 'desktop.ini']);

/** Dotfiles and the folder litter macOS / Windows leave next to scans. */
export const isSkippedName = (name: string) =>
    name.startsWith('.') || SKIPPED_NAMES.has(name.toLowerCase());

/** JPEG / PNG / PDF by MIME type or extension; HEIC and TIFF are refused. */
export const classify = (file: { name: string; type?: string }): ScanFileClass => {
    const ext = /\.([^.]+)$/.exec(file.name)?.[1]?.toLowerCase() ?? '';
    const mime = (file.type ?? '').toLowerCase();
    if (['heic', 'heif', 'tif', 'tiff'].includes(ext) || /heic|heif|tiff/.test(mime)) {
        return 'UNSUPPORTED';
    }
    if (mime === 'application/pdf' || ext === 'pdf') return 'PDF';
    if (mime === 'image/jpeg' || mime === 'image/png' || ['jpg', 'jpeg', 'png'].includes(ext)) {
        return 'IMAGE';
    }
    return 'UNSUPPORTED';
};

const keep = (files: File[]) => files.filter((f) => !isSkippedName(f.name));

// ---- folder picker (Chromium) -------------------------------------------

export const supportsDirectoryPicker = (): boolean =>
    typeof window !== 'undefined' &&
    typeof (window as unknown as DirectoryPickerHost).showDirectoryPicker === 'function';

const walkHandle = async (dir: ScanDirectoryHandle, out: File[]): Promise<void> => {
    for await (const entry of dir.values()) {
        if (isSkippedName(entry.name)) continue;
        if (entry.kind === 'directory') await walkHandle(entry, out);
        else out.push(await entry.getFile());
    }
};

/** Every file under a directory handle, sub-folders included, litter skipped. */
export const walkDirectoryHandle = async (dir: ScanDirectoryHandle): Promise<File[]> => {
    const out: File[] = [];
    await walkHandle(dir, out);
    return out;
};

/**
 * Every file under a folder the clerk picks, sub-folders included.
 * Null when the clerk cancels the picker; throws when the browser has no picker.
 */
export const pickFolder = async (): Promise<File[] | null> => {
    const host = window as unknown as DirectoryPickerHost;
    if (!host.showDirectoryPicker) throw new Error('showDirectoryPicker is not supported');
    let dir: ScanDirectoryHandle;
    try {
        dir = await host.showDirectoryPicker({ id: 'scan-station', mode: 'read' });
    } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') return null;
        throw e;
    }
    return walkDirectoryHandle(dir);
};

// ---- <input webkitdirectory> ---------------------------------------------

/** React has no webkitdirectory prop; set it on the element itself. */
export const setWebkitDirectory = (el: HTMLInputElement | null, on = true) => {
    if (!el) return;
    if (on) {
        el.setAttribute('webkitdirectory', '');
        el.setAttribute('directory', '');
    } else {
        el.removeAttribute('webkitdirectory');
        el.removeAttribute('directory');
    }
};

export const filesFromInput = (input: HTMLInputElement): File[] =>
    keep(Array.from(input.files ?? []));

// ---- drag and drop --------------------------------------------------------

const readFile = (entry: FileSystemFileEntry) =>
    new Promise<File>((resolve, reject) => entry.file(resolve, reject));

/** readEntries hands back at most ~100 entries per call: keep calling until it returns none. */
const readAllEntries = async (dir: FileSystemDirectoryEntry): Promise<FileSystemEntry[]> => {
    const reader = dir.createReader();
    const all: FileSystemEntry[] = [];
    for (;;) {
        const batch = await new Promise<FileSystemEntry[]>((resolve, reject) =>
            reader.readEntries(resolve, reject)
        );
        if (batch.length === 0) return all;
        all.push(...batch);
    }
};

const walkEntry = async (entry: FileSystemEntry, out: File[]): Promise<void> => {
    if (isSkippedName(entry.name)) return;
    if (entry.isDirectory) {
        const children = await readAllEntries(entry as FileSystemDirectoryEntry);
        for (const child of children) await walkEntry(child, out);
    } else if (entry.isFile) {
        out.push(await readFile(entry as FileSystemFileEntry));
    }
};

/** Every file in what was dropped, folders walked; already-flat entries pass through. */
export const filesFromEntries = async (entries: FileSystemEntry[]): Promise<File[]> => {
    const out: File[] = [];
    for (const entry of entries) await walkEntry(entry, out);
    return out;
};

/**
 * Files from a drop. The entries must be taken synchronously, while the drop
 * event is still being handled (the DataTransfer is emptied afterwards), so call
 * this from the handler before any await.
 */
export const filesFromDrop = (dt: DataTransfer): Promise<File[]> => {
    const items = Array.from(dt.items ?? []);
    const entries: FileSystemEntry[] = [];
    for (const item of items) {
        if (item.kind !== 'file') continue;
        const entry = typeof item.webkitGetAsEntry === 'function' ? item.webkitGetAsEntry() : null;
        if (entry) entries.push(entry);
    }
    if (entries.length === 0) return Promise.resolve(keep(Array.from(dt.files ?? [])));
    return filesFromEntries(entries);
};
