/**
 * The Lessons screen's position, carried in the #/lessons query string:
 * courseId, psId (package session = batch), subjectId, moduleId, chapterId and
 * `direct=1` (course_depth 2: slides hang off the batch). The player adds
 * view=player&slideId=… on top of the same keys, so Back returns to the list.
 */
import type { SlideScope } from './lessonApi';

export type PickerLevel = 'course' | 'batch' | 'subject' | 'module' | 'chapter' | 'slide';

/** Route params that identify a position in the picker (no `noskip`, no player keys). */
export interface LessonPath {
    courseId?: string;
    psId?: string;
    subjectId?: string;
    moduleId?: string;
    chapterId?: string;
    direct?: string;
}

const PATH_KEYS: (keyof LessonPath)[] = [
    'courseId',
    'psId',
    'subjectId',
    'moduleId',
    'chapterId',
    'direct',
];

export function lessonPathFrom(params: Record<string, string>): LessonPath {
    const path: LessonPath = {};
    PATH_KEYS.forEach((key) => {
        const value = params[key];
        if (value) path[key] = value;
    });
    return path;
}

export function toParams(path: LessonPath, extra?: Record<string, string>): Record<string, string> {
    const params: Record<string, string> = {};
    PATH_KEYS.forEach((key) => {
        const value = path[key];
        if (value) params[key] = value;
    });
    return { ...params, ...(extra || {}) };
}

export function levelOf(path: LessonPath): PickerLevel {
    if (!path.courseId) return 'course';
    if (!path.psId) return 'batch';
    if (path.direct) return 'slide';
    if (!path.subjectId) return 'subject';
    if (!path.moduleId) return 'module';
    if (!path.chapterId) return 'chapter';
    return 'slide';
}

/** The slide list scope for a path (chapter, or the whole batch for course_depth 2). */
export function slideScopeOf(path: LessonPath): SlideScope | null {
    if (path.direct && path.psId) return { packageSessionId: path.psId };
    if (path.chapterId) return { chapterId: path.chapterId };
    return null;
}

/** Hidden from the picker (soft-deleted or switched off). */
export function isListed(status: string | null | undefined): boolean {
    const upper = (status || '').toUpperCase();
    return upper !== 'DELETED' && upper !== 'INACTIVE';
}
