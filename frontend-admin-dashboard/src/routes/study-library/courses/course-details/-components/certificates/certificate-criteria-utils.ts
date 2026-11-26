import type {
    CertificateCriteria,
    CertificateCriteriaMode,
    CertificatePassRule,
    CertificateTestOption,
    CertificateTestScope,
    CertificateTestType,
} from '../../-services/course-certificates';

export const DEFAULT_PASS_PERCENT = 60;
export const ALL_TEST_TYPES: CertificateTestType[] = ['QUIZ', 'ASSESSMENT'];

/** Slide statuses learners can open; drafts never count towards a certificate. */
const LIVE_STATUSES = new Set(['PUBLISHED', 'UNSYNC']);

/** The settings dialog's working copy of the rule, with every default filled in. */
export interface CriteriaDraft {
    mode: CertificateCriteriaMode;
    testScope: CertificateTestScope;
    moduleIds: string[];
    chapterIds: string[];
    slideIds: string[];
    testTypes: CertificateTestType[];
    passRule: CertificatePassRule;
    minTestsToPass: number;
    passPercent: number;
    useOwnPassPercent: boolean;
}

const MODES: CertificateCriteriaMode[] = ['PROGRESS', 'SCORE', 'PROGRESS_AND_SCORE'];
const RULES: CertificatePassRule[] = ['ALL', 'AT_LEAST', 'AVERAGE'];

const ids = (values: string[] | null | undefined): string[] =>
    (values ?? []).filter((v): v is string => typeof v === 'string' && v.length > 0);

export const criteriaDraftFrom = (criteria?: CertificateCriteria | null): CriteriaDraft => {
    const types = (criteria?.testTypes ?? []).filter((t): t is CertificateTestType =>
        ALL_TEST_TYPES.includes(t as CertificateTestType)
    );
    return {
        mode: MODES.includes(criteria?.mode as CertificateCriteriaMode)
            ? (criteria?.mode as CertificateCriteriaMode)
            : 'PROGRESS',
        testScope: criteria?.testScope === 'CUSTOM' ? 'CUSTOM' : 'ALL',
        moduleIds: ids(criteria?.moduleIds),
        chapterIds: ids(criteria?.chapterIds),
        slideIds: ids(criteria?.slideIds),
        testTypes: types.length > 0 ? types : [...ALL_TEST_TYPES],
        passRule: RULES.includes(criteria?.passRule as CertificatePassRule)
            ? (criteria?.passRule as CertificatePassRule)
            : 'ALL',
        minTestsToPass: Math.max(1, criteria?.minTestsToPass ?? 1),
        passPercent: Math.max(0, Math.min(100, criteria?.passPercent ?? DEFAULT_PASS_PERCENT)),
        useOwnPassPercent: criteria?.useOwnPassPercent !== false,
    };
};

/**
 * What gets saved. Progress-only saves null, so a course that never used a score
 * rule keeps exactly the stored shape it had before.
 */
export const criteriaPayloadFrom = (draft: CriteriaDraft): CertificateCriteria | null => {
    if (draft.mode === 'PROGRESS') return null;
    const custom = draft.testScope === 'CUSTOM';
    return {
        mode: draft.mode,
        testScope: draft.testScope,
        moduleIds: custom ? draft.moduleIds : [],
        chapterIds: custom ? draft.chapterIds : [],
        slideIds: custom ? draft.slideIds : [],
        testTypes: draft.testTypes,
        passRule: draft.passRule,
        minTestsToPass: draft.passRule === 'AT_LEAST' ? draft.minTestsToPass : null,
        passPercent: draft.passPercent,
        useOwnPassPercent: draft.useOwnPassPercent,
    };
};

/** Why the draft cannot be saved yet, or null when it can. */
export const criteriaDraftError = (draft: CriteriaDraft): 'pickTests' | 'pickType' | null => {
    if (draft.mode === 'PROGRESS') return null;
    // No type is only meaningful when nothing expands by type - i.e. only individual
    // tests are picked. A whole course, module or chapter with no type would save a
    // rule the server reads as "both types" while the picker shows nothing ticked.
    const expandsByType =
        draft.testScope !== 'CUSTOM' || draft.moduleIds.length > 0 || draft.chapterIds.length > 0;
    if (draft.testTypes.length === 0 && expandsByType) {
        return 'pickType';
    }
    if (
        draft.testScope === 'CUSTOM' &&
        draft.moduleIds.length === 0 &&
        draft.chapterIds.length === 0 &&
        draft.slideIds.length === 0
    ) {
        return 'pickTests';
    }
    return null;
};

/**
 * The live tests the rule counts - the same selection the server makes
 * (CertificateCriteriaEvaluator.testsInRule): a picked test always counts, a
 * course/module/chapter expands to the chosen types, drafts never count.
 */
export const testsCountedByRule = (
    draft: CriteriaDraft,
    tests: CertificateTestOption[]
): CertificateTestOption[] => {
    const types = new Set<string>(draft.testTypes.length > 0 ? draft.testTypes : ALL_TEST_TYPES);
    const modules = new Set(draft.moduleIds);
    const chapters = new Set(draft.chapterIds);
    const slides = new Set(draft.slideIds);
    return tests.filter((test) => {
        if (!test.status || !LIVE_STATUSES.has(test.status)) return false;
        // An Assessment slide that launches no assessment can never be taken.
        if (test.type === 'ASSESSMENT' && !test.assessment_id) return false;
        if (draft.testScope !== 'CUSTOM') return types.has(test.type);
        if (slides.has(test.slide_id)) return true;
        return (
            types.has(test.type) &&
            ((test.module_id !== null && modules.has(test.module_id)) ||
                (test.chapter_id !== null && chapters.has(test.chapter_id)))
        );
    });
};

export interface ChapterGroup {
    key: string;
    chapterId: string | null;
    chapterName: string | null;
    tests: CertificateTestOption[];
}

export interface ModuleGroup {
    key: string;
    moduleId: string | null;
    moduleName: string | null;
    subjectName: string | null;
    chapters: ChapterGroup[];
}

/** Course order is kept: the API already returns tests subject → module → chapter → slide. */
export const groupTestsByModule = (tests: CertificateTestOption[]): ModuleGroup[] => {
    const modules: ModuleGroup[] = [];
    const moduleIndex = new Map<string, ModuleGroup>();
    for (const test of tests) {
        const moduleKey = test.module_id ?? 'no-module';
        let group = moduleIndex.get(moduleKey);
        if (!group) {
            group = {
                key: moduleKey,
                moduleId: test.module_id,
                moduleName: test.module_name,
                subjectName: test.subject_name,
                chapters: [],
            };
            moduleIndex.set(moduleKey, group);
            modules.push(group);
        }
        const chapterKey = test.chapter_id ?? 'no-chapter';
        let chapter = group.chapters.find((c) => c.key === chapterKey);
        if (!chapter) {
            chapter = {
                key: chapterKey,
                chapterId: test.chapter_id,
                chapterName: test.chapter_name,
                tests: [],
            };
            group.chapters.push(chapter);
        }
        chapter.tests.push(test);
    }
    return modules;
};

/** Toggle a value in a list without mutating it. */
export const toggleId = (list: string[], id: string, on: boolean): string[] =>
    on ? (list.includes(id) ? list : [...list, id]) : list.filter((v) => v !== id);
