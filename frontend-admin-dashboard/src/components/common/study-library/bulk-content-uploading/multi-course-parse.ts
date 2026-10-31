// Bulk Content Uploading — multi-course parse pipeline.
//
// Top-level zip folders are matched to courses (match-only, never created).
// Each matched section's subtree is then parsed with THAT course's own
// course_depth and matched against THAT course's structure, reusing the v1
// buildTree/applyMatching pipeline unchanged (run pre-namespacing).

import {
    useStudyLibraryStore,
    type CourseWithSessionsType,
} from '@/stores/study-library/use-study-library-store';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import type { DisplaySettingsData } from '@/types/display-settings';
import {
    buildTree,
    formatBytes,
    isJunkPath,
    MAX_FILE_COUNT,
    MAX_ZIP_BYTES,
    normalizeName,
    parseOrderPrefix,
    WARN_FILE_COUNT,
    WARN_ZIP_BYTES,
    type ZipEntryMeta,
} from './conventions';
import { annotateSlideCollisions, applyMatching, buildExistingSnapshot } from './matching';
import { getCurrentZipHandle } from './zip-parser';
import { useBulkContentUploadingStore } from './use-bulk-content-uploading-store';
import { canBulkUploadToCourse } from './course-edit-gate';
import type {
    BulkIssue,
    BulkUploadContext,
    CourseSection,
    ExistingSnapshot,
    ParseResult,
} from './types';
import { getTerminology } from '@/components/common/layout-container/sidebar/utils';
import { ContentTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';

export const MAX_COURSE_SECTIONS = 25;

/** "Physics Foundation (Jan 2026 - Class 11)" → base + batch hint. */
export const splitBatchHint = (name: string): { base: string; hint: string | null } => {
    const match = name.match(/^(.*?)\s*\(([^()]+)\)\s*$/);
    if (match && match[1]?.trim()) {
        return { base: match[1].trim(), hint: match[2]!.trim() };
    }
    return { base: name.trim(), hint: null };
};

export interface TopFolderSplit {
    /** Zip path prefix of this section WITHOUT trailing slash (may be nested after unwrap). */
    rawPath: string;
    display: string;
    orderHint: number | null;
    batchHint: string | null;
    fileCount: number;
    totalBytes: number;
}

const splitAtPrefix = (
    entries: ZipEntryMeta[],
    prefix: string
): { folders: TopFolderSplit[]; rootIssues: BulkIssue[] } => {
    const folders = new Map<string, { fileCount: number; totalBytes: number }>();
    const rootIssues: BulkIssue[] = [];
    for (const entry of entries) {
        if (entry.isDirectory || isJunkPath(entry.path)) continue;
        if (prefix && !entry.path.startsWith(prefix)) continue;
        const relative = entry.path.slice(prefix.length);
        const segments = relative.split('/').filter(Boolean);
        if (segments.length <= 1) {
            rootIssues.push({
                level: 'error',
                path: entry.path,
                message: `Not inside a ${getTerminology(ContentTerms.Course, SystemTerms.Course).toLocaleLowerCase()} folder — skipped.`,
            });
            continue;
        }
        const top = segments[0]!;
        const existing = folders.get(top) ?? { fileCount: 0, totalBytes: 0 };
        existing.fileCount += 1;
        existing.totalBytes += entry.uncompressedSize;
        folders.set(top, existing);
    }
    return {
        folders: [...folders.entries()].map(([raw, stats]) => {
            const { orderHint, displayName } = parseOrderPrefix(raw);
            const { base, hint } = splitBatchHint(displayName);
            return {
                rawPath: prefix + raw,
                display: base,
                orderHint,
                batchHint: hint,
                fileCount: stats.fileCount,
                totalBytes: stats.totalBytes,
            };
        }),
        rootIssues,
    };
};

const courseByFolderName = (
    folder: TopFolderSplit,
    studyLibraryData: CourseWithSessionsType[]
): CourseWithSessionsType | undefined => {
    const lastSegment = folder.rawPath.split('/').pop() ?? folder.rawPath;
    const candidates = [
        normalizeName(folder.display),
        normalizeName(splitBatchHint(parseOrderPrefix(lastSegment).displayName).base),
        normalizeName(lastSegment),
    ];
    return studyLibraryData.find((entry) =>
        candidates.includes(normalizeName(entry.course.package_name))
    );
};

interface BatchPair {
    sessionId: string;
    sessionName: string;
    levelId: string;
    levelName: string;
}

const batchPairsForCourse = (entry: CourseWithSessionsType): BatchPair[] =>
    entry.sessions.flatMap((session) =>
        session.level_with_details.map((level) => ({
            sessionId: session.session_dto.id,
            sessionName: session.session_dto.session_name,
            levelId: level.id,
            levelName: level.name,
        }))
    );

const resolvePackageSessionId = (courseId: string, sessionId: string, levelId: string): string => {
    return (
        useStudyLibraryStore.getState().getPackageSessionId({ courseId, sessionId, levelId }) ||
        useInstituteDetailsStore.getState().getPackageSessionId({ courseId, sessionId, levelId }) ||
        ''
    );
};

/** Matches the bracket hint against "session - level" combos and child-batch names. */
const matchBatchHint = (
    hint: string,
    entry: CourseWithSessionsType
): { pair?: BatchPair; packageSessionId?: string } | null => {
    const normalizedHint = normalizeName(hint);
    const pairs = batchPairsForCourse(entry);
    const pairMatches = pairs.filter((pair) =>
        [
            normalizeName(`${pair.sessionName} - ${pair.levelName}`),
            normalizeName(`${pair.sessionName} ${pair.levelName}`),
            normalizeName(pair.levelName),
            normalizeName(pair.sessionName),
        ].includes(normalizedHint)
    );
    if (pairMatches.length === 1) return { pair: pairMatches[0]! };

    const psMatches = (entry.package_sessions ?? []).filter(
        (ps) => ps.name && normalizeName(ps.name) === normalizedHint
    );
    if (psMatches.length === 1) return { packageSessionId: psMatches[0]!.id };

    return null;
};

interface DeriveSectionsArgs {
    entries: ZipEntryMeta[];
    studyLibraryData: CourseWithSessionsType[];
    roleDisplay: DisplaySettingsData | null;
    courseTerm: string;
    zipFileName: string;
    zipTotalBytes: number;
}

export interface DeriveSectionsResult {
    sections: CourseSection[];
    zipIssues: BulkIssue[];
    zipFatals: string[];
}

/**
 * Split → (maybe unwrap a single non-matching wrapper folder) → match courses,
 * resolve batches, apply the edit gate, detect duplicate course+batch.
 */
export const deriveCourseSections = ({
    entries,
    studyLibraryData,
    roleDisplay,
    courseTerm,
    zipFileName,
    zipTotalBytes,
}: DeriveSectionsArgs): DeriveSectionsResult => {
    const zipIssues: BulkIssue[] = [];
    const zipFatals: string[] = [];

    // Zip-level guards run here once — per-section buildTree skips them.
    const usableCount = entries.filter((e) => !e.isDirectory && !isJunkPath(e.path)).length;
    if (zipTotalBytes > MAX_ZIP_BYTES) {
        zipFatals.push(
            `Zip is ${formatBytes(zipTotalBytes)} — larger than the ${formatBytes(MAX_ZIP_BYTES)} limit. Split it into smaller zips (e.g. one per ${courseTerm.toLowerCase()}).`
        );
    } else if (zipTotalBytes > WARN_ZIP_BYTES) {
        zipIssues.push({
            level: 'warning',
            path: zipFileName,
            message: `Large zip (${formatBytes(zipTotalBytes)}). Keep this tab open until the upload finishes.`,
        });
    }
    if (usableCount > MAX_FILE_COUNT) {
        zipFatals.push(
            `Zip contains ${usableCount} files — more than the ${MAX_FILE_COUNT} file limit. Split it into smaller zips.`
        );
    } else if (usableCount > WARN_FILE_COUNT) {
        zipIssues.push({
            level: 'warning',
            path: zipFileName,
            message: `${usableCount} files — this upload will take a while. Keep this tab open.`,
        });
    }

    let { folders, rootIssues } = splitAtPrefix(entries, '');
    if (folders.length === 1 && !courseByFolderName(folders[0]!, studyLibraryData)) {
        const wrapper = folders[0]!;
        const unwrapped = splitAtPrefix(entries, `${wrapper.rawPath}/`);
        if (unwrapped.folders.length > 0) {
            zipIssues.push({
                level: 'info',
                path: wrapper.rawPath,
                message: `"${wrapper.display}" doesn't match any ${courseTerm.toLowerCase()} — treated as a wrapper folder and unwrapped.`,
            });
            folders = unwrapped.folders;
            rootIssues = [...rootIssues, ...unwrapped.rootIssues];
        }
    }
    zipIssues.push(...rootIssues);

    if (folders.length === 0) {
        zipFatals.push(
            `No ${courseTerm.toLowerCase()} folders found. Top-level folders must be named after your ${courseTerm.toLowerCase()}s.`
        );
    }
    if (folders.length > MAX_COURSE_SECTIONS) {
        zipFatals.push(
            `Zip contains ${folders.length} top-level folders — more than the ${MAX_COURSE_SECTIONS} limit. Split it into multiple zips.`
        );
    }

    const claimed = new Set<string>(); // `${courseId}|${packageSessionId}`
    const sections: CourseSection[] = folders.map((folder) => {
        const section: CourseSection = {
            id: `section::${normalizeName(folder.rawPath)}`,
            topFolderRaw: folder.rawPath,
            topFolderDisplay: folder.display,
            batchHint: folder.batchHint,
            orderHint: folder.orderHint,
            status: 'unmatched',
            issues: [],
            fatalErrors: [],
            fileCount: folder.fileCount,
            totalBytes: folder.totalBytes,
        };

        const entry = courseByFolderName(folder, studyLibraryData);
        if (!entry) return section;

        return resolveSectionForCourse(section, entry, roleDisplay, courseTerm, claimed);
    });

    return { sections, zipIssues, zipFatals };
};

/**
 * Fills course/batch fields on a section for a chosen course (initial match or
 * user remap). Returns a NEW section object; does not touch the store.
 */
export const resolveSectionForCourse = (
    base: CourseSection,
    entry: CourseWithSessionsType,
    roleDisplay: DisplaySettingsData | null,
    courseTerm: string,
    claimed?: Set<string>
): CourseSection => {
    const section: CourseSection = {
        ...base,
        courseId: entry.course.id,
        courseName: entry.course.package_name,
        courseDepth: entry.course.course_depth ?? 5,
        sessionId: undefined,
        levelId: undefined,
        packageSessionId: undefined,
        status: 'needs-batch',
        error: undefined,
    };

    const gate = canBulkUploadToCourse(entry.course, roleDisplay, courseTerm);
    if (!gate.allowed) {
        return { ...section, status: 'blocked', error: gate.reason };
    }

    const pairs = batchPairsForCourse(entry);
    let pair: BatchPair | undefined;
    let directPsId: string | undefined;

    if (pairs.length === 1) {
        pair = pairs[0];
    } else if (section.batchHint) {
        const hinted = matchBatchHint(section.batchHint, entry);
        if (hinted?.pair) pair = hinted.pair;
        else if (hinted?.packageSessionId) directPsId = hinted.packageSessionId;
        else {
            section.issues = [
                ...section.issues,
                {
                    level: 'warning',
                    path: section.topFolderRaw,
                    message: `Batch hint “(${section.batchHint})” didn't match a batch of “${entry.course.package_name}” — pick one below.`,
                },
            ];
        }
    }

    if (pair) {
        section.sessionId = pair.sessionId;
        section.levelId = pair.levelId;
        section.packageSessionId =
            resolvePackageSessionId(entry.course.id, pair.sessionId, pair.levelId) || undefined;
    } else if (directPsId) {
        section.packageSessionId = directPsId;
        const ps = (entry.package_sessions ?? []).find((p) => p.id === directPsId);
        section.sessionId = ps?.session.id;
        section.levelId = ps?.level.id;
    }

    if (section.packageSessionId) {
        const key = `${section.courseId}|${section.packageSessionId}`;
        if (claimed?.has(key)) {
            return {
                ...section,
                status: 'error',
                error: `Another folder in this zip already targets the same ${getTerminology(ContentTerms.Course, SystemTerms.Course).toLocaleLowerCase()} and batch.`,
            };
        }
        claimed?.add(key);
        section.status = 'loading'; // prepareSection takes it from here
    }

    return section;
};

// ----- Per-section parse orchestration -----

const raceTokens = new Map<string, number>();
const snapshotCache = new Map<string, ExistingSnapshot>();

export const clearMultiParseCaches = () => {
    raceTokens.clear();
    snapshotCache.clear();
};

const namespaceParseResult = (result: ParseResult, sectionId: string): ParseResult => {
    const mapId = (id: string) => `${sectionId}::${id}`;
    const nodes = Object.fromEntries(
        Object.values(result.nodes).map((node) => [
            mapId(node.id),
            {
                ...node,
                id: mapId(node.id),
                parentId: node.parentId ? mapId(node.parentId) : null,
                sectionId,
            },
        ])
    );
    const items = Object.fromEntries(
        Object.values(result.items).map((item) => [
            mapId(item.id),
            {
                ...item,
                id: mapId(item.id),
                chapterNodeId: mapId(item.chapterNodeId),
                sectionId,
            },
        ])
    );
    return { ...result, nodes, items };
};

/**
 * Fetches the section's course snapshot, parses its subtree with the course's
 * own depth, matches it, and loads the namespaced result into the store.
 * Safe to call repeatedly (remap / batch change) — stale completions are dropped.
 */
export const prepareSection = async (sectionId: string, instituteId: string): Promise<void> => {
    const store = useBulkContentUploadingStore;
    const state = () => store.getState();

    const section = state().courseSections[sectionId];
    const zip = getCurrentZipHandle();
    if (!section || !zip) return;
    if (!section.courseId || !section.packageSessionId || !section.sessionId || !section.levelId) {
        return;
    }

    const token = (raceTokens.get(sectionId) ?? 0) + 1;
    raceTokens.set(sectionId, token);
    state().updateSection(sectionId, { status: 'loading', error: undefined });
    state().clearSectionParse(sectionId);

    const context: BulkUploadContext = {
        courseId: section.courseId,
        sessionId: section.sessionId,
        levelId: section.levelId,
        packageSessionId: section.packageSessionId,
        courseDepth: section.courseDepth ?? 5,
        instituteId,
    };

    try {
        const cacheKey = `${context.courseId}|${context.packageSessionId}`;
        let snapshot = snapshotCache.get(cacheKey);
        if (!snapshot) {
            snapshot = await buildExistingSnapshot(context);
            snapshotCache.set(cacheKey, snapshot);
        }

        const result = await buildTree({
            entries: zip.entries,
            courseDepth: context.courseDepth,
            zipFileName: state().zipFileName,
            zipTotalBytes: section.totalBytes,
            fingerprint: state().fingerprint,
            readText: zip.readText,
            basePrefix: `${section.topFolderRaw}/`,
            guardScope: 'section',
        });

        // v1 order, pre-namespacing — depth-2 root lookups inside still work.
        applyMatching(result.nodes, snapshot, context.courseDepth);
        annotateSlideCollisions(result.items, result.nodes, snapshot, context.courseDepth);

        if (raceTokens.get(sectionId) !== token) return; // superseded by a newer call
        state().loadSectionParse(sectionId, namespaceParseResult(result, sectionId), snapshot);
    } catch (error) {
        if (raceTokens.get(sectionId) !== token) return;
        const message =
            error instanceof Error
                ? error.message
                : `Could not read this ${getTerminology(ContentTerms.Course, SystemTerms.Course).toLocaleLowerCase()} structure`;
        state().updateSection(sectionId, { status: 'error', error: message });
    }
};
