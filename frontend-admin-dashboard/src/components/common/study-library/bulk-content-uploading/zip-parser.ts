// Bulk Content Uploading — zip access via @zip.js/zip.js.
//
// zip.js reads the central directory with random-access file.slice() reads, so
// listing entries touches only KBs of metadata and extraction streams ONE entry
// at a time — memory stays O(largest file), never O(zip). (This is why we use
// zip.js and not JSZip, which buffers the whole archive.)

import {
    BlobReader,
    BlobWriter,
    TextWriter,
    ZipReader,
    type Entry,
    type FileEntry,
} from '@zip.js/zip.js';
import type { ZipEntryMeta } from './conventions';

export interface ZipHandle {
    entries: ZipEntryMeta[];
    readText: (path: string) => Promise<string>;
    /** Extracts one entry to a File (streams; safe for large entries). */
    extractFile: (path: string, fileName: string) => Promise<File>;
    close: () => Promise<void>;
}

const MIME_BY_EXT: Record<string, string> = {
    pdf: 'application/pdf',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ppt: 'application/vnd.ms-powerpoint',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    mp4: 'video/mp4',
    mov: 'video/quicktime',
    mkv: 'video/x-matroska',
    webm: 'video/webm',
    // Nested zip = SCORM package; the upload is multipart so the type matters.
    zip: 'application/zip',
};

export const mimeForFileName = (fileName: string): string => {
    const ext = fileName.toLowerCase().split('.').pop() || '';
    return MIME_BY_EXT[ext] || 'application/octet-stream';
};

export const openZipFile = async (file: File): Promise<ZipHandle> => {
    const reader = new ZipReader(new BlobReader(file));
    let rawEntries: Entry[];
    try {
        rawEntries = await reader.getEntries();
    } catch (error) {
        await reader.close().catch(() => undefined);
        throw new Error(
            'Could not read this zip file. It may be corrupt, encrypted, or not a zip archive.'
        );
    }

    if (rawEntries.some((e) => e.encrypted)) {
        await reader.close().catch(() => undefined);
        throw new Error('This zip is password-protected. Re-create it without encryption.');
    }

    const byPath = new Map<string, FileEntry>();
    const entries: ZipEntryMeta[] = rawEntries.map((entry) => {
        const path = entry.filename.replace(/\/+$/, '');
        if (!entry.directory) byPath.set(path, entry);
        return {
            path,
            isDirectory: entry.directory,
            uncompressedSize: entry.uncompressedSize,
            utf8Name: entry.filenameUTF8 !== false,
        };
    });

    const getEntry = (path: string): FileEntry => {
        const entry = byPath.get(path);
        if (!entry) {
            throw new Error(`Zip entry not found: ${path}`);
        }
        return entry;
    };

    return {
        entries,
        readText: async (path) => {
            const entry = getEntry(path);
            return entry.getData(new TextWriter());
        },
        extractFile: async (path, fileName) => {
            const entry = getEntry(path);
            const mime = mimeForFileName(fileName);
            const blob = await entry.getData(new BlobWriter(mime));
            return new File([blob], fileName, { type: mime });
        },
        close: () => reader.close().catch(() => undefined) as Promise<void>,
    };
};

// The selected zip's handle lives outside the store (it holds methods and a
// file reference — not serializable state). One upload runs at a time.
let currentHandle: ZipHandle | null = null;

export const setCurrentZipHandle = async (handle: ZipHandle | null) => {
    if (currentHandle && currentHandle !== handle) {
        await currentHandle.close().catch(() => undefined);
    }
    currentHandle = handle;
};

export const getCurrentZipHandle = (): ZipHandle | null => currentHandle;

export const zipFingerprint = (file: File): string =>
    `${file.name}|${file.size}|${file.lastModified}`;
