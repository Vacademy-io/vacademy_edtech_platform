// Bulk Content Uploading — CSV-manifest mode parse / resolve / validate.
//
// A bulkcontent.csv inside the zip maps each flat file (or url) to a chapter in a
// package session. This module parses it, reverse-resolves each package session
// to a course (via the study-library store), fetches that course's snapshot,
// validates every row, and emits the BulkItems + display nodes/sections the
// store and CSV commit loop consume. No React, no folder-tree parsing.

import Papa from 'papaparse';
import type { CourseWithSessionsType } from '@/stores/study-library/use-study-library-store';
import {
    classifyUrl,
    detectKind,
    isJunkPath,
    normalizeName,
    stripExtension,
    type ZipEntryMeta,
} from './conventions';
import { buildExistingSnapshot, pooled } from './matching';
import type {
    BulkItem,
    BulkItemKind,
    BulkIssue,
    BulkNode,
    BulkUploadContext,
    CourseSection,
    CsvChapterIndex,
    ExistingSnapshot,
} from './types';
import {
    getTerminology,
    getTerminologyPlural,
} from '@/components/common/layout-container/sidebar/utils';
import { ContentTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';

// Canonical name is bulkcontent.csv; manifest.csv still accepted as a fallback.
export const MANIFEST_FILE_NAME = 'bulkcontent.csv';
const MANIFEST_NAMES = new Set([
    'bulkcontent.csv',
    'bulkcontent.txt',
    'manifest.csv',
    'manifest.txt',
]);

export const isManifestEntry = (path: string): boolean =>
    MANIFEST_NAMES.has((path.split('/').pop() ?? path).toLowerCase());

// ----- CSV parsing -----

interface RawRow {
    file_name: string;
    package_session_id: string;
    chapter_id: string;
    title: string;
    type: string;
    order: string;
    url: string;
}

const cleanCell = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

export const parseManifestCsv = (text: string): { rows: RawRow[]; parseErrors: string[] } => {
    const parseErrors: string[] = [];
    const result = Papa.parse<Record<string, unknown>>(text, {
        header: true,
        skipEmptyLines: 'greedy',
        transformHeader: (h) => h.trim().toLowerCase().replace(/\s+/g, '_'),
    });
    result.errors.forEach((e) => parseErrors.push(`Row ${(e.row ?? 0) + 1}: ${e.message}`));
    const rows: RawRow[] = (result.data ?? []).map((r) => ({
        file_name: cleanCell(r.file_name ?? r.filename ?? r.file),
        package_session_id: cleanCell(r.package_session_id ?? r.packagesessionid ?? r.ps_id),
        chapter_id: cleanCell(r.chapter_id ?? r.chapterid),
        title: cleanCell(r.title ?? r.slide_title),
        type: cleanCell(r.type ?? r.slide_type),
        order: cleanCell(r.order ?? r.slide_order),
        url: cleanCell(r.url ?? r.link),
    }));
    return { rows, parseErrors };
};

const KIND_BY_TYPE: Record<string, BulkItemKind> = {
    pdf: 'PDF',
    doc: 'DOC',
    docx: 'DOC',
    document: 'DOC',
    ppt: 'PPT',
    pptx: 'PPT',
    presentation: 'PPT',
    image: 'IMAGE',
    img: 'IMAGE',
    photo: 'IMAGE',
    video: 'VIDEO_FILE',
    mp4: 'VIDEO_FILE',
    scorm: 'SCORM',
    youtube: 'YOUTUBE',
    yt: 'YOUTUBE',
    link: 'EXTERNAL_LINK',
    url: 'EXTERNAL_LINK',
    external: 'EXTERNAL_LINK',
};

const kindFromTypeColumn = (type: string): BulkItemKind | undefined =>
    type ? KIND_BY_TYPE[type.toLowerCase()] : undefined;

const fileKindOnly = (kind: ReturnType<typeof detectKind>): BulkItemKind | null =>
    kind === 'LINKS_MANIFEST' || kind === 'URL_FILE' || kind === null ? null : kind;

const TOP_VALUES = new Set(['top', 't', 'first', 'start', 'begin', 'beginning']);
const BOTTOM_VALUES = new Set(['bottom', 'b', 'last', 'end', 'append', '']);

/** order column → 'top'|'bottom' placement. invalid = a value we didn't recognise. */
const parsePlacement = (order: string): { placement: 'top' | 'bottom'; invalid: boolean } => {
    const value = order.trim().toLowerCase();
    if (TOP_VALUES.has(value)) return { placement: 'top', invalid: false };
    if (BOTTOM_VALUES.has(value)) return { placement: 'bottom', invalid: false };
    return { placement: 'bottom', invalid: true }; // unknown → bottom + warn
};

/**
 * A bulkcontent.csv pre-filled with one row per selected file (file_name filled,
 * the rest blank). The teacher just adds package_session_id, chapter_id, etc.
 * Far smaller than the chapter reference when uploading only a handful of files.
 */
export const generatePrefilledManifestCsv = (files: File[]): Blob => {
    const csv = Papa.unparse({
        fields: ['file_name', 'package_session_id', 'chapter_id', 'title', 'order', 'url'],
        data: files.map((f) => ({
            file_name: f.name.split('/').pop() ?? f.name,
            package_session_id: '',
            chapter_id: '',
            title: '',
            order: '',
            url: '',
        })),
    });
    return new Blob([csv], { type: 'text/csv;charset=utf-8;' });
};

// ----- Package session → course reverse lookup -----

export const resolvePackageSession = (
    psId: string,
    studyLibraryData: CourseWithSessionsType[],
    instituteId: string
): { context: BulkUploadContext; courseName: string } | null => {
    for (const entry of studyLibraryData) {
        const ps = entry.package_sessions?.find((p) => p.id === psId);
        if (ps) {
            return {
                context: {
                    courseId: entry.course.id,
                    sessionId: ps.session.id,
                    levelId: ps.level.id,
                    packageSessionId: psId,
                    courseDepth: entry.course.course_depth ?? 5,
                    instituteId,
                },
                courseName: entry.course.package_name,
            };
        }
    }
    return null;
};

/** chapterId → resolution, with depth-2 DEFAULT-chapter slides sourced from directSlides. */
export const buildChapterIndex = (snapshot: ExistingSnapshot): CsvChapterIndex => {
    const index: CsvChapterIndex = {};
    for (const subject of snapshot.subjects) {
        for (const moduleEntity of subject.modules) {
            for (const chapter of moduleEntity.chapters) {
                let existingSlides = chapter.slides;
                if (existingSlides.length === 0 && chapter.id === snapshot.defaults.chapterId) {
                    existingSlides = snapshot.directSlides;
                }
                index[chapter.id] = {
                    chapterId: chapter.id,
                    chapterName: chapter.name,
                    subjectId: subject.id,
                    moduleId: moduleEntity.id,
                    existingSlides,
                };
            }
        }
    }
    return index;
};

// ----- Resolution / validation -----

export type CsvRowStatus = 'valid' | 'error';

export interface CsvRowResult {
    rowNumber: number;
    fileName: string;
    url?: string;
    packageSessionId: string;
    chapterId: string;
    courseName?: string;
    chapterName?: string;
    kind?: BulkItemKind;
    title: string;
    placement?: 'top' | 'bottom';
    status: CsvRowStatus;
    error?: string;
    warnings: string[];
    itemId?: string;
}

export interface CsvResolveResult {
    sections: CourseSection[];
    sectionContexts: Record<string, BulkUploadContext>;
    chapterIndexBySection: Record<string, CsvChapterIndex>;
    snapshots: Record<string, ExistingSnapshot>;
    nodes: Record<string, BulkNode>;
    items: Record<string, BulkItem>;
    rows: CsvRowResult[];
    issues: BulkIssue[];
}

export const csvChapterNodeId = (psId: string, chapterId: string): string =>
    `csvchap::${psId}::${chapterId}`;

interface ResolveArgs {
    csvText: string;
    zipEntries: ZipEntryMeta[];
    studyLibraryData: CourseWithSessionsType[];
    instituteId: string;
}

export const resolveManifest = async (args: ResolveArgs): Promise<CsvResolveResult> => {
    const { csvText, zipEntries, studyLibraryData, instituteId } = args;
    const issues: BulkIssue[] = [];

    const { rows: rawRows, parseErrors } = parseManifestCsv(csvText);
    parseErrors.forEach((message) =>
        issues.push({ level: 'warning', path: MANIFEST_FILE_NAME, message })
    );

    // Basename → zip paths (case-insensitive), tracking ambiguity + sizes.
    const fileEntries = zipEntries.filter(
        (e) => !e.isDirectory && !isJunkPath(e.path) && !isManifestEntry(e.path)
    );
    const byBasename = new Map<string, ZipEntryMeta[]>();
    for (const entry of fileEntries) {
        const base = (entry.path.split('/').pop() ?? entry.path).toLowerCase();
        const list = byBasename.get(base) ?? [];
        list.push(entry);
        byBasename.set(base, list);
    }

    // Resolve each unique package session once (pooled snapshot fetches).
    const uniquePsIds = [...new Set(rawRows.map((r) => r.package_session_id).filter(Boolean))];
    const sectionContexts: Record<string, BulkUploadContext> = {};
    const courseNames: Record<string, string> = {};
    const resolvable: string[] = [];
    for (const psId of uniquePsIds) {
        const resolved = resolvePackageSession(psId, studyLibraryData, instituteId);
        if (resolved) {
            sectionContexts[psId] = resolved.context;
            courseNames[psId] = resolved.courseName;
            resolvable.push(psId);
        }
    }

    const snapshots: Record<string, ExistingSnapshot> = {};
    const chapterIndexBySection: Record<string, CsvChapterIndex> = {};
    const snapshotList = await pooled(resolvable, 4, async (psId) => ({
        psId,
        snapshot: await buildExistingSnapshot(sectionContexts[psId]!).catch(() => null),
    }));
    for (const { psId, snapshot } of snapshotList) {
        if (snapshot) {
            snapshots[psId] = snapshot;
            chapterIndexBySection[psId] = buildChapterIndex(snapshot);
        }
    }

    const nodes: Record<string, BulkNode> = {};
    const items: Record<string, BulkItem> = {};
    const rows: CsvRowResult[] = [];
    const usedBasenames = new Set<string>();
    const sectionFileCount: Record<string, number> = {};
    const sectionBytes: Record<string, number> = {};

    const titleFromUrl = (url: string): string => {
        try {
            return new URL(url.startsWith('http') ? url : `https://${url}`).hostname;
        } catch {
            return 'Link';
        }
    };

    rawRows.forEach((raw, i) => {
        const rowNumber = i + 1;
        const psId = raw.package_session_id;
        const chapterId = raw.chapter_id;
        const hasUrl = !!raw.url;
        const base: CsvRowResult = {
            rowNumber,
            fileName: raw.file_name,
            url: hasUrl ? raw.url : undefined,
            packageSessionId: psId,
            chapterId,
            courseName: courseNames[psId],
            title: raw.title,
            status: 'error',
            warnings: [],
        };

        const fail = (error: string): void => {
            rows.push({ ...base, status: 'error', error });
        };

        if (!psId || !chapterId || (!raw.file_name && !hasUrl)) {
            return fail('Missing package_session_id, chapter_id, or file_name/url.');
        }
        if (!sectionContexts[psId]) {
            return fail(
                `This package session was not found among your ${getTerminologyPlural(ContentTerms.Course, SystemTerms.Course).toLocaleLowerCase()}.`
            );
        }
        const index = chapterIndexBySection[psId];
        if (!index) {
            return fail(
                `Could not read this ${getTerminology(ContentTerms.Course, SystemTerms.Course).toLocaleLowerCase()}’s structure.`
            );
        }
        const chapter = index[chapterId];
        if (!chapter) {
            return fail('This chapter_id does not belong to that package session.');
        }

        // Determine kind + source (file vs url).
        let kind: BulkItemKind | null;
        let entryPath = '';
        let sizeBytes = 0;
        if (hasUrl && !raw.file_name) {
            kind = kindFromTypeColumn(raw.type) ?? classifyUrl(raw.url);
            if (kind !== 'YOUTUBE' && kind !== 'EXTERNAL_LINK') kind = classifyUrl(raw.url);
        } else {
            const wantBase = (raw.file_name.split('/').pop() ?? raw.file_name).toLowerCase();
            const matches = byBasename.get(wantBase);
            if (!matches || matches.length === 0) {
                return fail(`File “${raw.file_name}” was not found in the zip.`);
            }
            if (matches.length > 1) {
                return fail(`File name “${raw.file_name}” is ambiguous (appears more than once).`);
            }
            entryPath = matches[0]!.path;
            sizeBytes = matches[0]!.uncompressedSize;
            usedBasenames.add(wantBase);
            kind = kindFromTypeColumn(raw.type) ?? fileKindOnly(detectKind(raw.file_name));
            if (kind === 'YOUTUBE' || kind === 'EXTERNAL_LINK') {
                return fail('A link type needs a url, not a file.');
            }
        }
        if (!kind) {
            return fail('Unsupported file type. Add a `type` column to override if needed.');
        }

        const title =
            raw.title ||
            (entryPath ? stripExtension(raw.file_name.split('/').pop() ?? raw.file_name) : '') ||
            (raw.url ? titleFromUrl(raw.url) : 'Slide');

        const nodeId = csvChapterNodeId(psId, chapterId);
        if (!nodes[nodeId]) {
            nodes[nodeId] = {
                id: nodeId,
                kind: 'chapter',
                parentId: null,
                rawFolderName: '',
                displayName: chapter.chapterName,
                orderHint: null,
                mapping: { action: 'match', targetId: chapterId, targetName: chapter.chapterName },
                resolvedId: chapterId,
                status: 'pending',
                sectionId: psId,
            };
        }

        const { placement, invalid: invalidOrder } = parsePlacement(raw.order);
        const warnings = invalidOrder
            ? [`order “${raw.order}” isn’t top or bottom — placed at the bottom.`]
            : [];

        const itemId = crypto.randomUUID();
        const key = `${psId}|${chapterId}|${entryPath || raw.url}|${normalizeName(title)}|${kind}`;
        items[itemId] = {
            id: itemId,
            key,
            chapterNodeId: nodeId,
            kind,
            entryPath,
            fileName: entryPath ? raw.file_name.split('/').pop() ?? raw.file_name : '',
            title,
            // Row order within a chapter is the CSV row order; top/bottom controls
            // placement relative to the chapter's existing slides.
            orderHint: rowNumber,
            placement,
            sizeBytes,
            url: hasUrl ? raw.url : undefined,
            warnings,
            status: 'pending',
            sectionId: psId,
        };
        sectionFileCount[psId] = (sectionFileCount[psId] ?? 0) + 1;
        sectionBytes[psId] = (sectionBytes[psId] ?? 0) + sizeBytes;

        rows.push({
            ...base,
            status: 'valid',
            chapterName: chapter.chapterName,
            kind,
            title,
            placement,
            warnings,
            itemId,
        });
    });

    // Build a section per package session referenced by the CSV.
    const sections: CourseSection[] = uniquePsIds.map((psId) => {
        const ctx = sectionContexts[psId];
        const resolvedOk = !!ctx && !!chapterIndexBySection[psId];
        return {
            id: psId,
            topFolderRaw: psId,
            topFolderDisplay: courseNames[psId] ?? psId,
            batchHint: null,
            orderHint: null,
            courseId: ctx?.courseId,
            courseName: courseNames[psId],
            courseDepth: ctx?.courseDepth,
            sessionId: ctx?.sessionId,
            levelId: ctx?.levelId,
            packageSessionId: psId,
            status: resolvedOk ? 'ready' : 'error',
            error: resolvedOk ? undefined : 'Package session not found / structure unreadable.',
            issues: [],
            fatalErrors: [],
            fileCount: sectionFileCount[psId] ?? 0,
            totalBytes: sectionBytes[psId] ?? 0,
        };
    });

    // Info: files in the zip referenced by no valid row.
    const unusedCount = [...byBasename.keys()].filter((b) => !usedBasenames.has(b)).length;
    if (unusedCount > 0) {
        issues.push({
            level: 'info',
            path: 'zip',
            message: `${unusedCount} file(s) in the zip are not referenced by the manifest and will be ignored.`,
        });
    }

    return {
        sections,
        sectionContexts,
        chapterIndexBySection,
        snapshots,
        nodes,
        items,
        rows,
        issues,
    };
};
