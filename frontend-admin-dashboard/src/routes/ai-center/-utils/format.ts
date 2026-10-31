import type { TFunction } from 'i18next';
import { AITaskIndividualListInterface } from '@/types/ai/generate-assessment/generate-complete-assessment';

export type FileFamily = 'pdf' | 'audio' | 'image' | 'doc' | 'none';

export const stripExtension = (name: string): string => {
    const i = name.lastIndexOf('.');
    return i > 0 ? name.slice(0, i) : name;
};

export const classifyFile = (mime: string | undefined): FileFamily => {
    if (!mime) return 'none';
    const m = mime.toLowerCase();
    if (m.includes('pdf')) return 'pdf';
    if (
        m.startsWith('audio') ||
        m.includes('mp3') ||
        m.includes('wav') ||
        m.includes('flac') ||
        m.includes('aac') ||
        m.includes('m4a') ||
        m.includes('mpeg')
    )
        return 'audio';
    if (m.startsWith('image')) return 'image';
    if (
        m.includes('word') ||
        m.includes('document') ||
        m.includes('presentation') ||
        m.includes('ppt')
    )
        return 'doc';
    return 'doc';
};

// Namespace: aiCenterFormat. Called `buildXxx(t)` (rather than a fixed
// Record) since the labels must be resolved against the caller's active
// language — see the `buildStatusFilters`/`buildSourceFilters` precedent in
// AITasksList.tsx / RecentWorkDialog.tsx.
export const buildSourceLabel = (t: TFunction): Record<FileFamily, string> => ({
    pdf: t('source.pdf'),
    audio: t('source.audio'),
    image: t('source.image'),
    doc: t('source.doc'),
    none: t('source.none'),
});

export const routeForFamily: Record<FileFamily, string> = {
    pdf: '/ai-center/ai-tools/vsmart-upload',
    audio: '/ai-center/ai-tools/vsmart-audio',
    image: '/ai-center/ai-tools/vsmart-image',
    doc: '/ai-center/ai-tools/vsmart-upload',
    none: '/ai-center/ai-tools/vsmart-prompt',
};

// The server stores the human title inside the generated `result_json` payload
// (e.g. "Respiration in Organisms - Class 10"), not on the task row itself. Prefer
// it over the auto-generated `Task_<timestamp>` name when present.
const titleFromResultJson = (raw: unknown): string | null => {
    if (typeof raw !== 'string' || !raw) return null;
    try {
        const parsed = JSON.parse(raw) as { title?: unknown };
        if (typeof parsed.title === 'string') {
            const trimmed = parsed.title.trim();
            if (trimmed) return trimmed;
        }
    } catch {
        // result_json may be empty, partial, or non-JSON for in-progress/failed tasks
    }
    return null;
};

// `fallback`, when provided by the caller, wins over the translated default
// (callers pass their own contextual fallback, e.g. a source label or a
// tool-specific placeholder — see RecentWorkDialog.tsx / RecentFilesPanel.tsx).
export const taskDisplayName = (
    task: AITaskIndividualListInterface,
    t: TFunction,
    fallback?: string
): string => {
    const generatedTitle = titleFromResultJson(task.result_json);
    if (generatedTitle) return generatedTitle;
    if (task.file_detail?.file_name) return stripExtension(task.file_detail.file_name);
    if (task.task_name && !/^Task_\d/.test(task.task_name)) return task.task_name;
    return fallback ?? t('taskDisplayName.untitledDraft');
};

export const relativeTime = (iso: string, t: TFunction): string => {
    const time = new Date(iso).getTime();
    if (Number.isNaN(time)) return '';
    const diff = Math.round((Date.now() - time) / 1000);
    if (diff < 60) return t('relativeTime.justNow');
    if (diff < 3600) return t('relativeTime.minutesAgo', { count: Math.floor(diff / 60) });
    if (diff < 86400) return t('relativeTime.hoursAgo', { count: Math.floor(diff / 3600) });
    if (diff < 7 * 86400) return t('relativeTime.daysAgo', { count: Math.floor(diff / 86400) });
    return new Date(iso).toLocaleDateString();
};

export const statusStyles = (status: string): string => {
    if (status === 'COMPLETED') return 'bg-green-50 text-green-700 ring-green-600/20';
    if (status === 'FAILED') return 'bg-red-50 text-red-700 ring-red-600/20';
    return 'bg-blue-50 text-blue-700 ring-blue-600/20';
};

// The default branch reformats whatever raw enum value the backend sent
// (e.g. a status this catalog doesn't know about yet) rather than translating
// it, since there's no fixed key to look up.
export const statusLabel = (status: string, t: TFunction): string => {
    if (status === 'COMPLETED') return t('status.completed');
    if (status === 'FAILED') return t('status.failed');
    if (status === 'PROGRESS') return t('status.inProgress');
    return status.charAt(0) + status.slice(1).toLowerCase();
};

const FRIENDLY_HEADING_KEYS: Record<string, string> = {
    'Vsmart Upload': 'friendlyHeading.vsmartUpload',
    'Vsmart Extract': 'friendlyHeading.vsmartExtract',
    'Vsmart Image': 'friendlyHeading.vsmartImage',
    'Vsmart Audio': 'friendlyHeading.vsmartAudio',
    'Vsmart Topics': 'friendlyHeading.vsmartTopics',
    'Vsmart Chat': 'friendlyHeading.vsmartChat',
    'Vsmart Organizer': 'friendlyHeading.vsmartOrganizer',
    'Vsmart Sorter': 'friendlyHeading.vsmartSorter',
    'Vsmart Lecturer': 'friendlyHeading.vsmartLecturer',
    'Vsmart Feedback': 'friendlyHeading.vsmartFeedback',
};

// rawHeading is the (untranslated, enum-like) tool heading used elsewhere for
// routing/equality checks — see QUESTION_HEADING_BY_TYPE below and the
// `heading === 'Vsmart Feedback'` style checks in AITasksList.tsx. Falls back
// to the raw value unchanged for any heading this catalog doesn't recognize.
export const friendlyHeading = (rawHeading: string, t: TFunction): string => {
    const key = FRIENDLY_HEADING_KEYS[rawHeading];
    return key ? t(key) : rawHeading;
};

// The task's AiTaskType. `input_type` is NOT it — that field only ever holds
// PROMPT_ID/PDF_ID/IMAGE_ID/AUDIO_ID, which a topic-question task and a lecture
// plan share — so anything keyed off the tool must read `type`.
export const taskType = (task: AITaskIndividualListInterface): string => task.type ?? '';

// Task types that produce questions viewable via AIQuestionsPreview.
// Chat, lecture-plan, and lecture-review tasks use their own preview components.
export const QUESTION_TASK_TYPES = new Set<string>([
    'PDF_TO_QUESTIONS',
    'PDF_TO_QUESTIONS_WITH_TOPIC',
    'IMAGE_TO_QUESTIONS',
    'AUDIO_TO_QUESTIONS',
    'TEXT_TO_QUESTIONS',
]);

export const isQuestionTask = (task: AITaskIndividualListInterface): boolean =>
    QUESTION_TASK_TYPES.has(taskType(task));

// Task types worth surfacing in the aggregated history. The task table also
// carries background rows (translation, KB ingestion, per-turn chat) that are
// not a piece of work the user can reopen from here.
const HISTORY_TASK_TYPES = new Set<string>([
    ...QUESTION_TASK_TYPES,
    'SORT_QUESTIONS_TOPIC_WISE',
    'LECTURE_PLANNER',
    'LECTURE_FEEDBACK',
    'KB_PAPER_GENERATE',
]);

// Rows from before ai_service started sending `type` have no type at all; they
// stay listed (they were listed before) rather than silently vanishing.
export const isHistoryTask = (task: AITaskIndividualListInterface): boolean =>
    !task.type || HISTORY_TASK_TYPES.has(task.type);

// Map task type → display heading for AIQuestionsPreview's export filename.
const QUESTION_HEADING_BY_TYPE: Record<string, string> = {
    PDF_TO_QUESTIONS: 'Vsmart Upload',
    PDF_TO_QUESTIONS_WITH_TOPIC: 'Vsmart Organizer',
    IMAGE_TO_QUESTIONS: 'Vsmart Image',
    AUDIO_TO_QUESTIONS: 'Vsmart Audio',
    TEXT_TO_QUESTIONS: 'Vsmart Topics',
};

export const headingForQuestionTask = (task: AITaskIndividualListInterface): string =>
    QUESTION_HEADING_BY_TYPE[taskType(task)] ?? 'Vsmart';

// Where a task that can't be previewed inline should send the user. Keyed by
// task type first (the tool that made it); the file family is only a fallback
// for rows with no type.
const ROUTE_BY_TASK_TYPE: Record<string, string> = {
    TEXT_TO_QUESTIONS: '/ai-center/ai-tools/vsmart-prompt',
    PDF_TO_QUESTIONS: '/ai-center/ai-tools/vsmart-upload',
    PDF_TO_QUESTIONS_WITH_TOPIC: '/ai-center/ai-tools/vsmart-organizer',
    IMAGE_TO_QUESTIONS: '/ai-center/ai-tools/vsmart-image',
    AUDIO_TO_QUESTIONS: '/ai-center/ai-tools/vsmart-audio',
    SORT_QUESTIONS_TOPIC_WISE: '/ai-center/ai-tools/vsmart-sorter',
    LECTURE_PLANNER: '/ai-center/ai-tools/vsmart-lecture',
    LECTURE_FEEDBACK: '/ai-center/ai-tools/vsmart-feedback',
    CHAT_WITH_PDF: '/ai-center/ai-tools/vsmart-chat',
};

export const routeForTask = (task: AITaskIndividualListInterface): string =>
    ROUTE_BY_TASK_TYPE[taskType(task)] ?? routeForFamily[classifyFile(task.file_detail?.file_type)];
