// Bulk Content Uploading — sample/template zip generator.
//
// Generates a zip whose folders mirror the REAL existing course structure so
// faculty just drop files into the right folders and upload it back. Built
// client-side with zip.js ZipWriter (already a dependency via the parser).

import { BlobWriter, TextReader, ZipWriter } from '@zip.js/zip.js';
import type { CourseWithSessionsType } from '@/stores/study-library/use-study-library-store';
import { useStudyLibraryStore } from '@/stores/study-library/use-study-library-store';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import {
    DEFAULT_ENTITY_NAME,
    formatBytes,
    MAX_FILE_COUNT,
    MAX_SINGLE_FILE_BYTES,
    MAX_ZIP_BYTES,
    normalizeName,
} from './conventions';
import { buildExistingSnapshot, pooled } from './matching';
import type { BulkUploadContext, ExistingSnapshot } from './types';

export interface HierarchyTermLabels {
    course: string;
    subject: string;
    module: string;
    chapter: string;
    /** Institute's plural for chapter — naive +"s" breaks terms like "Class". */
    chapterPlural: string;
}

export interface MultiTemplateOptions {
    /** Restrict the template to these courses; omitted = every accessible course. */
    courseIds?: string[];
    /** Called as each course's real structure is fetched (drives the button label). */
    onProgress?: (done: number, total: number) => void;
}

const sanitizeFolderName = (name: string): string =>
    name.replace(/[/\\:*?"<>|]/g, '-').trim() || 'Untitled';

const numbered = (index: number, name: string): string =>
    `${String(index + 1).padStart(2, '0')} ${sanitizeFolderName(name)}`;

const isDefaultName = (name: string): boolean =>
    normalizeName(name) === normalizeName(DEFAULT_ENTITY_NAME);

const LINKS_EXAMPLE = [
    '# Rename this file to links.txt and remove the # from your own lines.',
    '# One link per line:  Title | URL',
    '# Lesson 1 video | https://www.youtube.com/watch?v=XXXXXXXXXXX',
    '# Reference site | https://example.com/extra-material',
].join('\n');

const readmeText = (terms: HierarchyTermLabels, multiCourse: boolean): string =>
    [
        'BULK CONTENT UPLOAD — HOW TO USE THIS TEMPLATE',
        '',
        '1. Drop your files into the folders below (PDF, Word, PowerPoint, images, videos).',
        '   A SCORM package goes in as its own .zip — leave it zipped, do not unzip it.',
        `2. A number prefix like "01 Introduction" controls the order and is removed from the name.`,
        `3. YouTube / external links: put a links.txt inside a ${terms.chapter.toLowerCase()} folder,`,
        '   one "Title | URL" per line (see links.example.txt — rename it to links.txt).',
        ...(multiCourse
            ? [
                  `4. Do NOT rename the top-level folders — they must match your ${terms.course.toLowerCase()} names`,
                  '   (including the batch in brackets, when present).',
                  '5. Zip this folder so the top-level folders sit at the root of the zip, then upload.',
              ]
            : ['4. Zip these folders (not a parent folder around them) and upload.']),
        '',
        `Limits: zip up to ${formatBytes(MAX_ZIP_BYTES)}, ${formatBytes(MAX_SINGLE_FILE_BYTES)} per file, ${MAX_FILE_COUNT} files per zip.`,
        `Folders that don't exist yet are created for you — just add a new folder and re-zip.`,
        `(Turn off "Create missing ${terms.chapterPlural.toLowerCase()}" in Options to upload only into folders that already exist.)`,
        'This README is ignored by the uploader — you can leave it in the zip.',
    ].join('\n');

/** Skeleton folders for a course that has no structure yet. */
const skeletonFolders = (courseDepth: number, terms: HierarchyTermLabels): string[] => {
    switch (courseDepth) {
        case 5:
            return [
                `01 ${terms.subject} A/01 ${terms.module} 1/01 ${terms.chapter} 1/`,
                `01 ${terms.subject} A/01 ${terms.module} 1/02 ${terms.chapter} 2/`,
            ];
        case 4:
            return [
                `01 ${terms.module} 1/01 ${terms.chapter} 1/`,
                `01 ${terms.module} 1/02 ${terms.chapter} 2/`,
            ];
        case 3:
            return [`01 ${terms.chapter} 1/`, `02 ${terms.chapter} 2/`];
        default:
            return []; // depth 2 — flat zip, files go at this level directly
    }
};

/** Real-structure folders (relative, with trailing slash) from a course snapshot. */
const snapshotFolders = (snapshot: ExistingSnapshot, courseDepth: number): string[] => {
    const folders: string[] = [];
    const sortedChapters = (chapters: ExistingSnapshot['subjects'][0]['modules'][0]['chapters']) =>
        [...chapters].sort((a, b) => a.chapterOrder - b.chapterOrder);

    if (courseDepth === 5) {
        snapshot.subjects
            .filter((s) => !isDefaultName(s.name))
            .forEach((subject, si) => {
                const subjectDir = `${numbered(si, subject.name)}/`;
                if (subject.modules.length === 0) folders.push(subjectDir);
                subject.modules.forEach((moduleEntity, mi) => {
                    const moduleDir = `${subjectDir}${numbered(mi, moduleEntity.name)}/`;
                    if (moduleEntity.chapters.length === 0) folders.push(moduleDir);
                    sortedChapters(moduleEntity.chapters).forEach((chapter, ci) => {
                        folders.push(`${moduleDir}${numbered(ci, chapter.name)}/`);
                    });
                });
            });
    } else if (courseDepth === 4) {
        const defaultSubject = snapshot.subjects.find((s) => s.id === snapshot.defaults.subjectId);
        (defaultSubject?.modules ?? [])
            .filter((m) => !isDefaultName(m.name))
            .forEach((moduleEntity, mi) => {
                const moduleDir = `${numbered(mi, moduleEntity.name)}/`;
                if (moduleEntity.chapters.length === 0) folders.push(moduleDir);
                sortedChapters(moduleEntity.chapters).forEach((chapter, ci) => {
                    folders.push(`${moduleDir}${numbered(ci, chapter.name)}/`);
                });
            });
    } else if (courseDepth === 3) {
        const defaultSubject = snapshot.subjects.find((s) => s.id === snapshot.defaults.subjectId);
        const defaultModule = (defaultSubject?.modules ?? []).find(
            (m) => m.id === snapshot.defaults.moduleId
        );
        sortedChapters(defaultModule?.chapters ?? [])
            .filter((c) => !isDefaultName(c.name))
            .forEach((chapter, ci) => {
                folders.push(`${numbered(ci, chapter.name)}/`);
            });
    }
    return folders;
};

const addCourseFolders = async (
    writer: ZipWriter<Blob>,
    prefix: string,
    folders: string[],
    addLinksExample: boolean
): Promise<void> => {
    if (folders.length === 0 && prefix) {
        await writer.add(prefix, undefined, { directory: true });
    }
    for (const folder of folders) {
        await writer.add(`${prefix}${folder}`, undefined, { directory: true });
    }
    if (addLinksExample) {
        const firstLeaf = folders[0] ?? '';
        await writer.add(`${prefix}${firstLeaf}links.example.txt`, new TextReader(LINKS_EXAMPLE));
    }
};

export const generateSingleCourseTemplate = async (
    context: BulkUploadContext,
    terms: HierarchyTermLabels
): Promise<Blob> => {
    const writer = new ZipWriter(new BlobWriter('application/zip'));
    await writer.add('README.txt', new TextReader(readmeText(terms, false)));

    let folders: string[] = [];
    try {
        const snapshot = await buildExistingSnapshot(context);
        folders = snapshotFolders(snapshot, context.courseDepth);
    } catch {
        folders = [];
    }
    if (folders.length === 0) folders = skeletonFolders(context.courseDepth, terms);
    await addCourseFolders(writer, '', folders, true);

    return writer.close();
};

interface TemplateTopFolder {
    name: string;
    context: BulkUploadContext | null; // null → skeleton only
    courseDepth: number;
}

export const generateMultiCourseTemplate = async (
    studyLibraryData: CourseWithSessionsType[],
    instituteId: string,
    terms: HierarchyTermLabels,
    options?: MultiTemplateOptions
): Promise<Blob> => {
    const topFolders: TemplateTopFolder[] = [];
    const wantedCourseIds = options?.courseIds?.length ? new Set(options.courseIds) : null;
    const includedData = wantedCourseIds
        ? studyLibraryData.filter((entry) => wantedCourseIds.has(entry.course.id))
        : studyLibraryData;

    for (const entry of includedData) {
        const pairs = entry.sessions.flatMap((session) =>
            session.level_with_details.map((level) => ({
                sessionId: session.session_dto.id,
                sessionName: session.session_dto.session_name,
                levelId: level.id,
                levelName: level.name,
            }))
        );
        const courseName = sanitizeFolderName(entry.course.package_name);
        const courseDepth = entry.course.course_depth ?? 5;
        const buildContext = (pair: (typeof pairs)[0]): BulkUploadContext | null => {
            const packageSessionId =
                useStudyLibraryStore.getState().getPackageSessionId({
                    courseId: entry.course.id,
                    sessionId: pair.sessionId,
                    levelId: pair.levelId,
                }) ||
                useInstituteDetailsStore.getState().getPackageSessionId({
                    courseId: entry.course.id,
                    sessionId: pair.sessionId,
                    levelId: pair.levelId,
                }) ||
                '';
            if (!packageSessionId) return null;
            return {
                courseId: entry.course.id,
                sessionId: pair.sessionId,
                levelId: pair.levelId,
                packageSessionId,
                courseDepth,
                instituteId,
            };
        };
        if (pairs.length <= 1) {
            topFolders.push({
                name: courseName,
                context: pairs[0] ? buildContext(pairs[0]) : null,
                courseDepth,
            });
        } else {
            // Multi-batch course: one bracketed folder per batch.
            for (const pair of pairs) {
                topFolders.push({
                    name: `${courseName} (${sanitizeFolderName(pair.sessionName)} - ${sanitizeFolderName(pair.levelName)})`,
                    context: buildContext(pair),
                    courseDepth,
                });
            }
        }
    }

    // Fetch real structures with a small pool; fall back to skeletons per course.
    // No course-count cap — large institutes (hundreds of courses) just take a
    // bit longer; onProgress keeps the button honest.
    let done = 0;
    options?.onProgress?.(0, topFolders.length);
    const folderTrees = await pooled(topFolders, 4, async (top) => {
        let folders: string[];
        if (!top.context) {
            folders = skeletonFolders(top.courseDepth, terms);
        } else {
            try {
                const snapshot = await buildExistingSnapshot(top.context);
                const real = snapshotFolders(snapshot, top.courseDepth);
                folders = real.length > 0 ? real : skeletonFolders(top.courseDepth, terms);
            } catch {
                folders = skeletonFolders(top.courseDepth, terms);
            }
        }
        done += 1;
        options?.onProgress?.(done, topFolders.length);
        return folders;
    });

    const writer = new ZipWriter(new BlobWriter('application/zip'));
    const readme = [
        readmeText(terms, true),
        '',
        `This template covers ${topFolders.length} ${terms.course.toLowerCase()} folder(s). Delete the ones you don't need — empty folders are simply skipped on upload.`,
    ].join('\n');
    await writer.add('README.txt', new TextReader(readme));

    for (let i = 0; i < topFolders.length; i++) {
        await addCourseFolders(writer, `${topFolders[i]!.name}/`, folderTrees[i]!, i === 0);
    }

    return writer.close();
};

export const downloadBlob = (blob: Blob, fileName: string): void => {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
};
