import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { BASE_URL, COPY_INTAKE_BASE_URL } from '@/constants/urls';
import type { CopyCheckConfig } from '@/types/assessment-settings';
import type {
    CriteriaJson,
    RubricJson,
} from '@/routes/assessment/create-assessment/$assessmentId/$examtype/-services/criteria-services';

/**
 * The evaluation criteria the AI copy check marks a paper by. A saved rubric is used
 * for every copy checked from then on; a question without one gets criteria written
 * by AI on its first check.
 */

const CRITERIA_URL = `${BASE_URL}/assessment-service/copy-check/criteria`;

export interface CopyCheckCriteriaQuestion {
    question_id: string;
    number: number;
    text: string;
    question_type: string;
    max_marks: number;
    /** What the AI marks this question by; null = written by AI on its first check. */
    rubric: RubricJson | null;
    /** The question's own criteria (question bank), offered as a starting point. */
    question_criteria: RubricJson | CriteriaJson | null;
}

export interface CopyCheckCriteriaView {
    questions: CopyCheckCriteriaQuestion[];
    rubric_version: number | null;
}

export const COPY_CHECK_CRITERIA_KEY = 'COPY_CHECK_CRITERIA';

export const getCopyCheckCriteria = async (
    assessmentId: string
): Promise<CopyCheckCriteriaView> => {
    const response = await authenticatedAxiosInstance({
        method: 'GET',
        url: `${CRITERIA_URL}/${assessmentId}`,
    });
    return {
        questions: response.data?.questions ?? [],
        rubric_version: response.data?.rubric_version ?? null,
    };
};

/** Save rubrics for some questions; the others are left as they are. Returns the new version. */
export const saveCopyCheckCriteria = async (
    assessmentId: string,
    rubrics: Record<string, RubricJson>,
    ifMatch?: number | null
): Promise<number> => {
    const response = await authenticatedAxiosInstance({
        method: 'PATCH',
        url: `${CRITERIA_URL}/${assessmentId}`,
        data: { rubrics, if_match: ifMatch ?? null },
    });
    return response.data?.rubric_version;
};

/** Store the AI checking settings on the assessment without sending copies. */
export const saveCopyCheckConfig = async (
    assessmentId: string,
    instituteId: string,
    config: CopyCheckConfig
): Promise<CopyCheckConfig> => {
    const response = await authenticatedAxiosInstance({
        method: 'PUT',
        url: `${COPY_INTAKE_BASE_URL}/copy-check-config`,
        params: { assessmentId, instituteId },
        data: config,
    });
    return response.data ?? {};
};

const isRubric = (value: unknown): value is RubricJson =>
    !!value && typeof value === 'object' && Array.isArray((value as RubricJson).rubric);

const isCriteria = (value: unknown): value is CriteriaJson =>
    !!value && typeof value === 'object' && Array.isArray((value as CriteriaJson).criteria);

/** Either stored shape, as the criteria editor's format. */
export const toEditableCriteria = (value: unknown, maxMarks: number): CriteriaJson | undefined => {
    if (isRubric(value)) {
        return {
            max_marks: maxMarks,
            criteria: value.rubric.map((r) => ({
                name: r.criteria_name,
                description: r.evaluation_guidelines ?? '',
                max_marks: Number(r.max_marks) || 0,
            })),
        };
    }
    if (isCriteria(value)) return { ...value, max_marks: maxMarks };
    return undefined;
};

/** Either stored shape, as the copy check's rubric. */
export const toRubric = (value: unknown, maxMarks: number): RubricJson | null => {
    if (isRubric(value)) return { ...value, max_marks: maxMarks };
    if (isCriteria(value)) return criteriaToCopyCheckRubric(value, maxMarks);
    return null;
};

/**
 * The editor's criteria as a copy-check rubric. Keywords and the marking instructions of
 * the rubric being replaced are kept (matched by criterion name): the editor has no field
 * for them, and dropping them would quietly change how the AI marks.
 */
export const criteriaToCopyCheckRubric = (
    criteria: CriteriaJson,
    maxMarks: number,
    previous?: RubricJson | null
): RubricJson => {
    const keywordsByName = new Map(
        (previous?.rubric ?? []).map((r) => [
            r.criteria_name.trim().toLowerCase(),
            r.keywords ?? [],
        ])
    );
    return {
        max_marks: maxMarks,
        partial_marking_enabled: previous?.partial_marking_enabled ?? true,
        evaluation_instructions: previous?.evaluation_instructions ?? '',
        rubric: criteria.criteria
            .filter((c) => c.name.trim() !== '')
            .map((c) => ({
                criteria_name: c.name.trim(),
                max_marks: Number(c.max_marks) || 0,
                keywords: keywordsByName.get(c.name.trim().toLowerCase()) ?? [],
                evaluation_guidelines: c.description ?? '',
            })),
    };
};

export type CriteriaStatus = 'SET' | 'FROM_QUESTION' | 'AI';

/** SET = the AI marks by saved criteria; FROM_QUESTION = the question has criteria not yet used; AI = written on first check. */
export const criteriaStatus = (q: CopyCheckCriteriaQuestion): CriteriaStatus => {
    if (q.rubric && isRubric(q.rubric) && q.rubric.rubric.length > 0) return 'SET';
    if (toRubric(q.question_criteria, q.max_marks)?.rubric.length) return 'FROM_QUESTION';
    return 'AI';
};
