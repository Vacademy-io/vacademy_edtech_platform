// Bulk Content Uploading — zip layout conventions, guards and the pure tree builder.

import type { BulkIssue, BulkItem, BulkItemKind, BulkNode, NodeKind, ParseResult } from './types';

// ----- Guardrails (see plan stress-test) -----
export const MAX_ZIP_BYTES = 1 * 1024 * 1024 * 1024; // 1 GB hard cap
export const WARN_ZIP_BYTES = 500 * 1024 * 1024; // warn ≥ 500 MB
export const MAX_FILE_COUNT = 2000;
export const WARN_FILE_COUNT = 500;
export const MAX_SINGLE_FILE_BYTES = 800 * 1024 * 1024; // 800 MB
export const MAX_PPTX_BYTES = 20 * 1024 * 1024; // server-side conversion multipart limit
// admin_core_service spring.servlet.multipart.max-file-size on stage/prod. The
// SCORM package is posted whole, so anything larger is rejected server-side —
// catch it here instead of after a long upload. Raising this alone does nothing:
// the ingress proxy-body-size and media_service's own multipart limit cap it too.
export const MAX_SCORM_BYTES = 800 * 1024 * 1024;

export const DEFAULT_ENTITY_NAME = 'DEFAULT';

/** Empty folders named individually in the issues list before summarising. */
const MAX_LISTED_EMPTY_FOLDERS = 5;

const JUNK_SEGMENTS = new Set(['__macosx', '.ds_store', 'thumbs.db', 'desktop.ini']);

export const isJunkPath = (path: string): boolean =>
    path
        .split('/')
        .filter(Boolean)
        .some((seg) => {
            const lower = seg.toLowerCase();
            return (
                JUNK_SEGMENTS.has(lower) ||
                seg.startsWith('._') ||
                seg.startsWith('.') ||
                // Template instructions (from "Download sample zip") — never content.
                lower === 'readme.txt' ||
                lower === 'readme.md'
            );
        });

/** "01 Mechanics" → { orderHint: 1, displayName: "Mechanics" } */
export const parseOrderPrefix = (
    name: string
): { orderHint: number | null; displayName: string } => {
    const match = name.match(/^(\d{1,4})[\s._)-]*\s*(.+)$/);
    if (match && match[1] && match[2]?.trim()) {
        return { orderHint: parseInt(match[1], 10), displayName: match[2].trim() };
    }
    return { orderHint: null, displayName: name.trim() };
};

export const stripExtension = (fileName: string): string => fileName.replace(/\.[^/.]+$/, '');

export const normalizeName = (name: string): string =>
    name.trim().toLowerCase().replace(/\s+/g, ' ');

export const formatBytes = (bytes: number): string => {
    if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
    if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${bytes} B`;
};

type DetectedKind = BulkItemKind | 'LINKS_MANIFEST' | 'URL_FILE' | null;

/** Maps a file name to the slide kind it produces; null = unsupported (skip + report). */
export const detectKind = (fileName: string): DetectedKind => {
    const lower = fileName.toLowerCase();
    if (lower === 'links.txt' || lower === 'links.csv') return 'LINKS_MANIFEST';
    const ext = lower.split('.').pop() || '';
    if (ext === 'url') return 'URL_FILE';
    if (ext === 'pdf') return 'PDF';
    if (ext === 'doc' || ext === 'docx') return 'DOC';
    if (ext === 'ppt' || ext === 'pptx') return 'PPT';
    if (['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext)) return 'IMAGE';
    if (['mp4', 'mov', 'mkv', 'webm'].includes(ext)) return 'VIDEO_FILE';
    // A nested .zip means a SCORM package — that is the only zip-shaped content
    // the library supports. It is NOT validated here: peeking for imsmanifest.xml
    // would mean decompressing the whole package during preview (they run to
    // hundreds of MB). The SCORM service unzips and parses it on upload and
    // rejects non-SCORM zips, so a wrong zip fails that one item with a real
    // message instead of costing every preview a full extraction.
    if (ext === 'zip') return 'SCORM';
    return null;
};

const YOUTUBE_URL_REGEX =
    /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/;

export const classifyUrl = (url: string): 'YOUTUBE' | 'EXTERNAL_LINK' =>
    YOUTUBE_URL_REGEX.test(url) ? 'YOUTUBE' : 'EXTERNAL_LINK';

/** Title fallback for a bare URL row: YouTube video id or the hostname. */
const titleFromUrl = (url: string): string => {
    const yt = url.match(YOUTUBE_URL_REGEX);
    if (yt?.[1]) return `YouTube ${yt[1]}`;
    try {
        return new URL(url.startsWith('http') ? url : `https://${url}`).hostname;
    } catch {
        return 'Link';
    }
};

const looksLikeUrl = (value: string): boolean => /^(https?:\/\/|www\.)\S+$/i.test(value.trim());

/**
 * links.txt: `Title | URL` or bare URL per line.
 * links.csv: `Title , URL` per line (no quoting support — kept deliberately simple).
 */
export const parseLinksManifest = (
    text: string,
    isCsv: boolean
): { title: string; url: string }[] => {
    const rows: { title: string; url: string }[] = [];
    for (const rawLine of text.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith('#')) continue;
        const separator = isCsv ? ',' : '|';
        const sepIndex = line.indexOf(separator);
        if (sepIndex > 0 && !looksLikeUrl(line)) {
            const title = line.slice(0, sepIndex).trim();
            const url = line.slice(sepIndex + 1).trim();
            if (looksLikeUrl(url)) {
                rows.push({ title: title || titleFromUrl(url), url });
                continue;
            }
        }
        if (looksLikeUrl(line)) {
            rows.push({ title: titleFromUrl(line), url: line });
        }
    }
    return rows;
};

/** Windows `.url` shortcut — INI file with a `URL=` line. */
export const parseUrlFile = (text: string): string | null => {
    const match = text.match(/^URL=(.+)$/m);
    const url = match?.[1]?.trim();
    return url && looksLikeUrl(url) ? url : null;
};

/** How many folder levels the zip must have for this course depth. */
export const folderLevelsForDepth = (courseDepth: number): number => {
    switch (courseDepth) {
        case 5:
            return 3; // Subject / Module / Chapter
        case 4:
            return 2; // Module / Chapter
        case 3:
            return 1; // Chapter
        default:
            return 0; // depth 2 — flat zip
    }
};

/** Which entity each folder level maps to, outermost first. */
export const nodeKindsForDepth = (courseDepth: number): NodeKind[] => {
    switch (courseDepth) {
        case 5:
            return ['subject', 'module', 'chapter'];
        case 4:
            return ['module', 'chapter'];
        case 3:
            return ['chapter'];
        default:
            return [];
    }
};

export interface HierarchyTerms {
    subject: string;
    module: string;
    chapter: string;
}

/** terms come from the institute's naming settings (Subject/Module/Chapter by default). */
export const expectedLayoutHelp = (
    courseDepth: number,
    terms?: Partial<HierarchyTerms>
): string[] => {
    const subject = terms?.subject ?? 'Subject';
    const moduleTerm = terms?.module ?? 'Module';
    const chapter = terms?.chapter ?? 'Chapter';
    switch (courseDepth) {
        case 5:
            return [
                'my-content.zip',
                `└── 01 ${subject}/`,
                `    └── 01 ${moduleTerm}/`,
                `        └── 01 ${chapter}/`,
                '            ├── 01 notes.pdf',
                '            ├── 02 lecture.mp4',
                '            └── links.txt (YouTube / external links)',
            ];
        case 4:
            return [
                'my-content.zip',
                `└── 01 ${moduleTerm}/`,
                `    └── 01 ${chapter}/`,
                '        ├── 01 notes.pdf',
                '        └── links.txt (YouTube / external links)',
            ];
        case 3:
            return [
                'my-content.zip',
                `└── 01 ${chapter}/`,
                '    ├── 01 notes.pdf',
                '    ├── 02 lecture.mp4',
                '    └── links.txt (YouTube / external links)',
            ];
        default:
            return [
                'my-content.zip',
                '├── 01 notes.pdf',
                '├── 02 lecture.mp4',
                '└── links.txt (YouTube / external links)',
            ];
    }
};

export const expectedMultiCourseLayoutHelp = (
    courseTerm: string,
    terms?: Partial<HierarchyTerms>
): string[] => {
    const subject = terms?.subject ?? 'Subject';
    const chapter = terms?.chapter ?? 'Chapter';
    return [
        'weekly-content.zip',
        `├── ${courseTerm} A/                  ← must match a ${courseTerm.toLowerCase()} name`,
        `│   └── 01 ${subject}/…`,
        `├── ${courseTerm} B (Session - Level)/  ← batch in brackets when needed`,
        `│   └── 01 ${chapter}/…`,
        '└── …',
    ];
};

// ----- Tree builder -----

export interface ZipEntryMeta {
    /** Path inside the zip, '/'-separated, no trailing slash for files. */
    path: string;
    isDirectory: boolean;
    uncompressedSize: number;
    /** False when the zip did not flag the name as UTF-8 (possible garbled text). */
    utf8Name: boolean;
}

/** Synthetic chapter node used for depth-2 (flat) zips. */
export const ROOT_CHAPTER_NODE_ID = 'chapter::__root__';

export const isSyntheticRootNode = (node: BulkNode): boolean =>
    node.syntheticRoot === true || node.id === ROOT_CHAPTER_NODE_ID;

interface BuildTreeArgs {
    entries: ZipEntryMeta[];
    courseDepth: number;
    zipFileName: string;
    zipTotalBytes: number;
    fingerprint: string;
    /** Reads a small text entry (links manifests / .url files). */
    readText: (path: string) => Promise<string>;
    /**
     * Multi-course mode: the course folder prefix (e.g. "01 Physics/") to strip
     * for segmentation. Disables the auto root-unwrap — under a course folder a
     * single subject folder is intentional structure, not a wrapper.
     */
    basePrefix?: string;
    /** 'section' skips the zip-level size/count guards (run once at zip level). */
    guardScope?: 'zip' | 'section';
}

/**
 * Pure-ish (only touches the zip via readText) builder: zip entries → nodes + items + issues.
 * Matching against the existing course happens separately in matching.ts.
 */
export const buildTree = async ({
    entries,
    courseDepth,
    zipFileName,
    zipTotalBytes,
    fingerprint,
    readText,
    basePrefix,
    guardScope = 'zip',
}: BuildTreeArgs): Promise<ParseResult> => {
    const issues: BulkIssue[] = [];
    const fatalErrors: string[] = [];
    const nodes: Record<string, BulkNode> = {};
    const items: Record<string, BulkItem> = {};

    const folderLevels = folderLevelsForDepth(courseDepth);
    const kinds = nodeKindsForDepth(courseDepth);

    const usable = entries.filter(
        (e) =>
            !isJunkPath(e.path) && !e.isDirectory && (!basePrefix || e.path.startsWith(basePrefix))
    );

    // Directory entries, shallowest first. Nodes are only ever created from
    // files, so a folder holding nothing but junk (a lone .DS_Store) or nothing
    // at all never becomes a node — and would otherwise vanish from the preview
    // with no explanation. Reported at the end against the folders that did
    // yield files. Only detectable when the zip carries directory entries;
    // some tools omit them, and then an empty folder simply isn't in the zip.
    const usableDirs = entries
        .filter(
            (e) =>
                e.isDirectory &&
                !isJunkPath(e.path) &&
                (!basePrefix || e.path.startsWith(basePrefix))
        )
        .sort((a, b) => a.path.split('/').length - b.path.split('/').length);
    const foldersWithFiles = new Set<string>();

    // Non-UTF8 zips only matter when a name actually contains non-ASCII
    // characters — plain-English names decode identically under cp437.
    usable
        // eslint-disable-next-line no-control-regex
        .filter((e) => !e.utf8Name && /[^\x20-\x7e]/.test(e.path))
        .slice(0, 5)
        .forEach((e) =>
            issues.push({
                level: 'warning',
                path: e.path,
                message:
                    'File name may be garbled (non-UTF8 zip). Check the name in the preview and rename before confirming if needed.',
            })
        );

    // Root unwrap: zips usually wrap everything in one top folder. Skipped when
    // a basePrefix is given (multi-course — the course folder IS the wrapper).
    let stripPrefix = basePrefix ?? '';
    if (!basePrefix) {
        const firstSegments = new Set(usable.map((e) => e.path.split('/')[0] || ''));
        if (firstSegments.size === 1 && folderLevels > 0) {
            const only = [...firstSegments][0]!;
            const allNested = usable.every((e) => e.path.split('/').length > 1);
            if (allNested) stripPrefix = `${only}/`;
        }
    }

    if (guardScope === 'zip') {
        if (zipTotalBytes > MAX_ZIP_BYTES) {
            fatalErrors.push(
                `Zip is ${formatBytes(zipTotalBytes)} — larger than the ${formatBytes(MAX_ZIP_BYTES)} limit. Split it into smaller zips (e.g. one per subject).`
            );
        } else if (zipTotalBytes > WARN_ZIP_BYTES) {
            issues.push({
                level: 'warning',
                path: zipFileName,
                message: `Large zip (${formatBytes(zipTotalBytes)}). Keep this tab open until the upload finishes.`,
            });
        }

        if (usable.length > MAX_FILE_COUNT) {
            fatalErrors.push(
                `Zip contains ${usable.length} files — more than the ${MAX_FILE_COUNT} file limit. Split it into smaller zips.`
            );
        } else if (usable.length > WARN_FILE_COUNT) {
            issues.push({
                level: 'warning',
                path: zipFileName,
                message: `${usable.length} files — this upload will take a while. Keep this tab open.`,
            });
        }
    }

    // Node id = kind + normalized folder path → folders that normalize alike merge.
    const nodeIdFor = (kind: NodeKind, normalizedPathSegs: string[]) =>
        `${kind}::${normalizedPathSegs.join('/')}`;

    const ensureNodeChain = (folderSegs: string[]): BulkNode | null => {
        if (folderLevels === 0) {
            let root = nodes[ROOT_CHAPTER_NODE_ID];
            if (!root) {
                root = {
                    id: ROOT_CHAPTER_NODE_ID,
                    kind: 'chapter',
                    parentId: null,
                    rawFolderName: '',
                    displayName: DEFAULT_ENTITY_NAME,
                    orderHint: null,
                    mapping: { action: 'match' },
                    status: 'pending',
                    syntheticRoot: true,
                };
                nodes[ROOT_CHAPTER_NODE_ID] = root;
            }
            return root;
        }
        let parentId: string | null = null;
        let node: BulkNode | null = null;
        const normalizedSegs: string[] = [];
        for (let level = 0; level < folderLevels; level++) {
            const rawName = folderSegs[level]!;
            const { orderHint, displayName } = parseOrderPrefix(rawName);
            normalizedSegs.push(normalizeName(displayName));
            const kind = kinds[level]!;
            const id = nodeIdFor(kind, normalizedSegs);
            const existing = nodes[id];
            if (existing) {
                if (existing.rawFolderName !== rawName) {
                    const msg = `Folders "${existing.rawFolderName}" and "${rawName}" map to the same ${kind} "${existing.displayName}" — they were merged.`;
                    if (!issues.some((i) => i.message === msg)) {
                        issues.push({ level: 'warning', path: folderSegs.join('/'), message: msg });
                    }
                }
                node = existing;
            } else {
                node = {
                    id,
                    kind,
                    parentId,
                    rawFolderName: rawName,
                    displayName,
                    orderHint,
                    mapping: { action: 'create' },
                    status: 'pending',
                };
                nodes[id] = node;
            }
            parentId = id;
        }
        return node;
    };

    interface PendingFile {
        chapterNode: BulkNode;
        chapterPath: string;
        entry: ZipEntryMeta;
        fileName: string;
        titlePrefix: string;
        kind: ReturnType<typeof detectKind>;
    }

    const pendingByChapter = new Map<string, PendingFile[]>();

    for (const entry of usable) {
        const relativePath =
            stripPrefix && entry.path.startsWith(stripPrefix)
                ? entry.path.slice(stripPrefix.length)
                : entry.path;
        const segments = relativePath.split('/').filter(Boolean);
        if (segments.length === 0) continue;
        const fileName = segments[segments.length - 1]!;
        const folderSegs = segments.slice(0, -1);

        // Mark this folder and its ancestors as holding a file BEFORE the type
        // and depth guards below. A folder whose files are unsupported, or sit
        // at the wrong level, already gets a precise per-file message — adding
        // "no supported files (empty)" on top of that would contradict it. Only
        // folders with no non-junk file at all should reach the empty sweep.
        const contentSegs = folderSegs
            .slice(0, folderLevels)
            .map((seg) => normalizeName(parseOrderPrefix(seg).displayName));
        for (let level = 1; level <= contentSegs.length; level++) {
            foldersWithFiles.add(contentSegs.slice(0, level).join('/'));
        }

        const kind = detectKind(fileName);
        if (kind === null) {
            issues.push({
                level: 'info',
                path: relativePath,
                message: 'Unsupported file type — skipped.',
            });
            continue;
        }

        if (folderSegs.length < folderLevels) {
            issues.push({
                level: 'error',
                path: relativePath,
                message:
                    folderLevels === 3
                        ? 'Not inside a Subject/Module/Chapter folder — skipped.'
                        : folderLevels === 2
                          ? 'Not inside a Module/Chapter folder — skipped.'
                          : 'Not inside a Chapter folder — skipped.',
            });
            continue;
        }

        let titlePrefix = '';
        if (folderSegs.length > folderLevels) {
            const extra = folderSegs.slice(folderLevels);
            titlePrefix = `${extra.map((s) => parseOrderPrefix(s).displayName).join(' – ')} – `;
            issues.push({
                level: 'warning',
                path: relativePath,
                message: `Folder is nested deeper than expected — file placed in "${folderSegs[folderLevels - 1] ?? 'root'}" with its sub-folder name in the title.`,
            });
        }

        const chapterNode = ensureNodeChain(folderSegs.slice(0, folderLevels));
        if (!chapterNode) continue;

        const chapterPath = folderSegs.slice(0, folderLevels).join('/') || '(root)';
        const list = pendingByChapter.get(chapterNode.id) ?? [];
        list.push({ chapterNode, chapterPath, entry, fileName, titlePrefix, kind });
        pendingByChapter.set(chapterNode.id, list);
    }

    // Per chapter: sort files, expand link manifests, apply per-file guards.
    for (const [chapterNodeId, files] of pendingByChapter) {
        files.sort((a, b) => {
            const ao = parseOrderPrefix(a.fileName).orderHint;
            const bo = parseOrderPrefix(b.fileName).orderHint;
            if (ao !== null || bo !== null) {
                if (ao === null) return 1;
                if (bo === null) return -1;
                if (ao !== bo) return ao - bo;
            }
            return a.fileName.localeCompare(b.fileName);
        });

        const usedTitles = new Map<string, number>();
        const uniqueTitle = (title: string): string => {
            const normalized = normalizeName(title);
            const count = usedTitles.get(normalized) ?? 0;
            usedTitles.set(normalized, count + 1);
            return count === 0 ? title : `${title} (${count + 1})`;
        };

        const pushItem = (item: Omit<BulkItem, 'id' | 'key'>) => {
            const id = crypto.randomUUID();
            const key = `${item.entryPath || item.chapterNodeId}|${normalizeName(item.title)}|${item.kind}`;
            items[id] = { ...item, id, key };
        };

        for (const file of files) {
            const { orderHint, displayName } = parseOrderPrefix(file.fileName);
            const relativePath = file.entry.path;
            const kind = file.kind;
            if (kind === null) continue; // already filtered at collection time

            if (kind === 'LINKS_MANIFEST' || kind === 'URL_FILE') {
                let text = '';
                try {
                    text = await readText(relativePath);
                } catch {
                    issues.push({
                        level: 'error',
                        path: relativePath,
                        message: 'Could not read link file — skipped.',
                    });
                    continue;
                }
                const rows =
                    kind === 'URL_FILE'
                        ? (() => {
                              const url = parseUrlFile(text);
                              return url ? [{ title: stripExtension(displayName), url }] : [];
                          })()
                        : parseLinksManifest(text, file.fileName.toLowerCase().endsWith('.csv'));
                if (rows.length === 0) {
                    issues.push({
                        level: 'error',
                        path: relativePath,
                        message: 'No valid links found in this file — skipped.',
                    });
                    continue;
                }
                rows.forEach((row) => {
                    pushItem({
                        chapterNodeId,
                        kind: classifyUrl(row.url),
                        entryPath: '',
                        fileName: file.fileName,
                        title: uniqueTitle(`${file.titlePrefix}${row.title}`),
                        orderHint,
                        sizeBytes: 0,
                        url: row.url,
                        warnings: [],
                        status: 'pending',
                    });
                });
                continue;
            }

            if (file.entry.uncompressedSize > MAX_SINGLE_FILE_BYTES) {
                issues.push({
                    level: 'error',
                    path: relativePath,
                    message: `File is ${formatBytes(file.entry.uncompressedSize)} — larger than the ${formatBytes(MAX_SINGLE_FILE_BYTES)} per-file limit. Upload it via the chapter's video/file uploader or share it as a link.`,
                });
                continue;
            }
            const warnings: string[] = [];
            if (kind === 'PPT' && file.entry.uncompressedSize > MAX_PPTX_BYTES) {
                issues.push({
                    level: 'error',
                    path: relativePath,
                    message: `PowerPoint file is ${formatBytes(file.entry.uncompressedSize)} — the conversion service accepts up to ${formatBytes(MAX_PPTX_BYTES)}. Convert it to PDF and re-zip.`,
                });
                continue;
            }
            if (kind === 'SCORM' && file.entry.uncompressedSize > MAX_SCORM_BYTES) {
                issues.push({
                    level: 'error',
                    path: relativePath,
                    message: `SCORM package is ${formatBytes(file.entry.uncompressedSize)} — the upload accepts up to ${formatBytes(MAX_SCORM_BYTES)}. Add it from the chapter's Add SCORM option instead.`,
                });
                continue;
            }

            pushItem({
                chapterNodeId,
                kind,
                entryPath: relativePath,
                fileName: file.fileName,
                title: uniqueTitle(`${file.titlePrefix}${stripExtension(displayName)}`),
                orderHint,
                sizeBytes: file.entry.uncompressedSize,
                warnings,
                status: 'pending',
            });
        }
    }

    // Report folders that held no supported files. Without this they are absent
    // from the preview AND from the issues list, so a folder the user expected
    // to see just isn't mentioned anywhere.
    if (folderLevels > 0) {
        const reported: string[] = [];
        for (const dir of usableDirs) {
            // Directory paths arrive without their trailing slash, so compare
            // with one added — otherwise the unwrapped root folder never
            // matches stripPrefix and gets reported as an empty chapter itself.
            const dirPrefix = `${dir.path}/`;
            if (stripPrefix && dirPrefix === stripPrefix) continue;
            const relative =
                stripPrefix && dirPrefix.startsWith(stripPrefix)
                    ? dir.path.slice(stripPrefix.length)
                    : dir.path;
            const segments = relative.split('/').filter(Boolean);
            // Deeper-than-chapter folders are folded into slide titles, not
            // skipped, so they are not "empty" in any sense the user cares about.
            if (segments.length === 0 || segments.length > folderLevels) continue;
            const normalizedPath = segments
                .map((seg) => normalizeName(parseOrderPrefix(seg).displayName))
                .join('/');
            if (foldersWithFiles.has(normalizedPath)) continue;
            // An empty parent already explains every empty child beneath it.
            if (reported.some((ancestor) => normalizedPath.startsWith(`${ancestor}/`))) continue;
            reported.push(normalizedPath);
            // The downloadable template ships a folder per EXISTING chapter, so
            // a part-filled template legitimately leaves many empty. Name the
            // first few and count the rest, matching the non-UTF8 cap above.
            if (reported.length <= MAX_LISTED_EMPTY_FOLDERS) {
                issues.push({
                    level: 'info',
                    path: relative,
                    message: 'Folder has no supported files — skipped (empty).',
                });
            }
        }
        if (reported.length > MAX_LISTED_EMPTY_FOLDERS) {
            const rest = reported.length - MAX_LISTED_EMPTY_FOLDERS;
            issues.push({
                level: 'info',
                // Multi-course renders each section's issues inside that
                // section's card, so attribute the count to the course folder
                // it describes rather than to the whole zip.
                path: basePrefix ? basePrefix.replace(/\/$/, '') : zipFileName,
                message:
                    rest === 1
                        ? '1 more folder had no supported files and was skipped.'
                        : `${rest} more folders had no supported files and were skipped.`,
            });
        }
    }

    // Drop hierarchy branches that ended up with zero items.
    const chapterIdsWithItems = new Set(Object.values(items).map((i) => i.chapterNodeId));
    const keepIds = new Set<string>();
    for (const chapterId of chapterIdsWithItems) {
        let cursor: string | null = chapterId;
        while (cursor) {
            keepIds.add(cursor);
            cursor = nodes[cursor]?.parentId ?? null;
        }
    }
    for (const node of Object.values(nodes)) {
        if (!keepIds.has(node.id)) {
            if (node.kind === 'chapter') {
                issues.push({
                    level: 'info',
                    path: node.rawFolderName,
                    message: 'Folder has no supported files — skipped (empty).',
                });
            }
            delete nodes[node.id];
        }
    }

    if (Object.keys(items).length === 0) {
        fatalErrors.push('No supported files found in this zip. Check the expected folder layout.');
    }

    return {
        nodes,
        items,
        issues,
        fatalErrors,
        zipFileName,
        zipTotalBytes,
        fingerprint,
    };
};
