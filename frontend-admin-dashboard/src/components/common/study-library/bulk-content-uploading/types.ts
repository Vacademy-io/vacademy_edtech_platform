// Bulk Content Uploading — shared types.
//
// Terminology: a "node" is a folder mapped to a Subject / Module / Chapter,
// an "item" is a file (or link-manifest row) that becomes one slide.

export type BulkItemKind =
    | 'PDF'
    | 'DOC'
    | 'PPT'
    | 'IMAGE'
    | 'VIDEO_FILE'
    | 'SCORM'
    | 'YOUTUBE'
    | 'EXTERNAL_LINK';

export type UploadMode = 'single' | 'multi' | 'csv';

export type NodeKind = 'subject' | 'module' | 'chapter';

export type NodeAction = 'match' | 'create' | 'skip';

export type NodeStatus = 'pending' | 'creating' | 'done' | 'failed';

export type ItemStatus =
    | 'pending'
    | 'preparing'
    | 'uploading'
    | 'creating'
    | 'done'
    | 'failed'
    | 'skipped'
    | 'blocked';

export interface NodeMapping {
    action: NodeAction;
    targetId?: string;
    targetName?: string;
}

export interface BulkNode {
    id: string;
    kind: NodeKind;
    parentId: string | null;
    rawFolderName: string;
    displayName: string;
    orderHint: number | null;
    mapping: NodeMapping;
    /** Set when the entity exists on the server (matched or created). */
    resolvedId?: string;
    status: NodeStatus;
    error?: string;
    /** Multi-course mode: which CourseSection this node belongs to. Absent in single mode. */
    sectionId?: string;
    /** True for the synthetic depth-2 root chapter node (id-independent marker). */
    syntheticRoot?: true;
}

export interface BulkItem {
    id: string;
    /** Stable identity across re-parses of the same zip: chapterPath|title|kind */
    key: string;
    chapterNodeId: string;
    kind: BulkItemKind;
    /** Full path inside the zip (for display + extraction). Empty for link rows. */
    entryPath: string;
    fileName: string;
    title: string;
    orderHint: number | null;
    sizeBytes: number;
    /** For YOUTUBE / EXTERNAL_LINK items. */
    url?: string;
    warnings: string[];
    /** Idempotency caches — survive a retry run. */
    fileId?: string;
    slideId?: string;
    status: ItemStatus;
    error?: string;
    /** Multi-course mode: which CourseSection this item belongs to. Absent in single mode. */
    sectionId?: string;
    /**
     * CSV mode: where the new slide goes relative to the chapter's existing
     * slides — 'top' (before) or 'bottom' (after, default). Absent in folder
     * modes (they always append).
     */
    placement?: 'top' | 'bottom';
}

// ----- Multi-course mode -----

export type CourseSectionStatus =
    | 'unmatched' // no course resolved for this top folder
    | 'needs-batch' // course matched, but session/level still ambiguous
    | 'loading' // snapshot fetch + per-course parse in flight
    | 'ready' // parsed + matched; nodes/items loaded in store
    | 'blocked' // current role cannot edit this published course
    | 'error' // snapshot/parse failed (retryable)
    | 'skipped'; // user skipped this top folder

/** One top-level zip folder mapped (or not yet) to a course + batch. */
export interface CourseSection {
    id: string;
    topFolderRaw: string;
    topFolderDisplay: string;
    /** Batch hint from a trailing "(...)" on the folder name, if any. */
    batchHint: string | null;
    orderHint: number | null;
    courseId?: string;
    courseName?: string;
    courseDepth?: number;
    sessionId?: string;
    levelId?: string;
    packageSessionId?: string;
    status: CourseSectionStatus;
    error?: string;
    issues: BulkIssue[];
    fatalErrors: string[];
    fileCount: number;
    totalBytes: number;
}

export interface BulkIssue {
    level: 'error' | 'warning' | 'info';
    path: string;
    message: string;
}

export interface BulkUploadContext {
    courseId: string;
    sessionId: string;
    levelId: string;
    packageSessionId: string;
    /** package.course_depth — 5/4/3/2; controls how many folder levels the zip must have. */
    courseDepth: number;
    instituteId: string;
}

export interface BulkUploadOptions {
    publish: boolean;
    notify: boolean;
    skipDuplicateTitles: boolean;
    /** Create subjects/modules/chapters the zip references but the course lacks. */
    createMissing: boolean;
}

export interface ParseResult {
    nodes: Record<string, BulkNode>;
    items: Record<string, BulkItem>;
    issues: BulkIssue[];
    /** Errors that block the whole upload (file count / zip size over hard caps). */
    fatalErrors: string[];
    zipFileName: string;
    zipTotalBytes: number;
    /** name+size+lastModified — keys the resume manifest. */
    fingerprint: string;
}

// ----- Existing-course snapshot used by the matcher -----

export interface ExistingSlideRef {
    id: string;
    title: string;
    slideOrder: number;
}

export interface ExistingChapter {
    id: string;
    name: string;
    chapterOrder: number;
    slides: ExistingSlideRef[];
}

export interface ExistingModule {
    id: string;
    name: string;
    chapters: ExistingChapter[];
}

export interface ExistingSubject {
    id: string;
    name: string;
    modules: ExistingModule[];
}

export interface ExistingSnapshot {
    subjects: ExistingSubject[];
    /**
     * Resolved DEFAULT chain for course_depth < 5 (the hidden levels).
     * Missing pieces are created during commit preflight.
     */
    defaults: {
        subjectId?: string;
        moduleId?: string;
        chapterId?: string;
    };
    /** Slides directly under the DEFAULT chapter — used for depth-2 collision checks. */
    directSlides: ExistingSlideRef[];
}

// ----- CSV-manifest mode -----

/** A chapter resolved from a manifest row: everything the CSV commit loop needs. */
export interface CsvChapterResolution {
    chapterId: string;
    chapterName: string;
    subjectId: string;
    moduleId: string;
    /** Existing slides in the chapter — the append base for slide_order. */
    existingSlides: ExistingSlideRef[];
}

/** chapterId → resolution, built once per package session from its snapshot. */
export type CsvChapterIndex = Record<string, CsvChapterResolution>;
