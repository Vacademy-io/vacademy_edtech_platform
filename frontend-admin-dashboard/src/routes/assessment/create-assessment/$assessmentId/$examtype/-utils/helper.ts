import {
    ConvertedCustomField,
    CustomFieldStep3,
    NotificationStep3,
    RegistrationFormField,
    Step3StudentDetailInterface,
    Steps,
} from '@/types/assessments/assessment-data-type';
import { useBasicInfoStore } from './zustand-global-states/step1-basic-info';
import { AdaptiveMarkingQuestion } from '@/types/assessments/basic-details-type';
import { useSectionDetailsStore } from './zustand-global-states/step2-add-questions';
import { UseFormReturn } from 'react-hook-form';
import { useTestAccessStore } from './zustand-global-states/step3-adding-participants';
import { useAccessControlStore } from './zustand-global-states/step4-access-control';
import {
    AccessControlFormValues,
    BasicSectionFormType,
    SectionFormType,
    TestAccessFormType,
} from '@/types/assessments/assessment-steps';
import { z } from 'zod';
import sectionDetailsSchema from './section-details-schema';
import { convertCustomFields } from '../-services/assessment-services';
import testAccessSchema from './add-participants-schema';
import { withMissingBuiltInFieldsOnTop } from './step3-registration-fields';
import { CourseWithSessionsType } from '@/stores/study-library/use-study-library-store';
import { BatchData } from '@/types/assessments/batch-details';
import { BASE_URL_LEARNER_DASHBOARD } from '@/constants/urls';

export const getAssessmentJoinLink = (
    learnerPortalBaseUrl: string | undefined | null,
    code: string | undefined | null
) => {
    const learnerBaseUrl = learnerPortalBaseUrl
        ? learnerPortalBaseUrl.startsWith('http')
            ? learnerPortalBaseUrl
            : `https://${learnerPortalBaseUrl}`
        : BASE_URL_LEARNER_DASHBOARD;
    return `${learnerBaseUrl}/register?code=${code ?? ''}`;
};

interface Role {
    roleId: string;
    roleName: string;
    isSelected: boolean;
}

export const getUsersStep4 = (users: string[]) => {
    return (
        users?.map((user, index) => ({
            userId: index.toString(),
            email: user,
        })) || []
    );
};

export const getSelectedRoles = (roles: Role[], selectedRoles: string[]) => {
    const rolesData =
        roles?.map((role) => ({
            roleId: role.roleId,
            roleName: role.roleName,
            isSelected: selectedRoles.includes(role.roleName),
        })) || [];
    return rolesData;
};

export function getStepKey({
    assessmentDetails,
    currentStep,
    key,
}: {
    assessmentDetails: Steps;
    currentStep: number;
    key: string;
}) {
    // Get the step_keys for the current step
    const stepKeys = assessmentDetails[currentStep]?.step_keys;

    if (!stepKeys) {
        return undefined; // Return undefined if step_keys does not exist
    }

    // Find the value for the key in step_keys
    for (const keyValuePair of stepKeys) {
        if (keyValuePair[key]) {
            return keyValuePair[key]; // Return "REQUIRED" or "OPTIONAL"
        }
    }

    return undefined; // Return undefined if the key is not found
}

export const getFieldOptions = ({
    assessmentDetails,
    currentStep,
    key,
    value,
}: {
    assessmentDetails: Steps;
    currentStep: number;
    key: string;
    value: string;
}): boolean => {
    // Safely access the nested array using optional chaining
    return (
        assessmentDetails[currentStep]?.field_options?.[key]?.some(
            (item) => item.value === value
        ) || false
    );
};

export const parseHTMLIntoString = (htmlString: string) => {
    const parser = new DOMParser();
    const doc = parser.parseFromString(htmlString, 'text/html');
    return doc;
};

export const getQuestionTypeCounts = (questions: AdaptiveMarkingQuestion[]) => {
    if (questions?.length === 0) return { MCQM: 0, MCQS: 0, totalQuestions: 0 };

    let mcqmCount = 0;
    let mcqsCount = 0;

    questions?.forEach((question) => {
        if (question.questionType === 'MCQM') {
            mcqmCount++;
        } else if (question.questionType === 'MCQS') {
            mcqsCount++;
        }
    });

    const totalQuestions = questions?.length;

    return {
        MCQM: mcqmCount,
        MCQS: mcqsCount,
        totalQuestions,
    };
};

export const handleDownloadQRCode = (elementName: string) => {
    const svg = document.getElementById(elementName);
    if (!svg) {
        alert('QR code not found!');
        return;
    }

    const svgData = new XMLSerializer().serializeToString(svg);
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const img = new Image();

    img.onload = () => {
        canvas.width = img.width;
        canvas.height = img.height;
        ctx?.drawImage(img, 0, 0);
        const pngFile = canvas.toDataURL('image/png');

        // Create a temporary link element to download the image
        const downloadLink = document.createElement('a');
        downloadLink.href = pngFile;
        downloadLink.download = 'qr-code.png';
        downloadLink.click();
    };

    img.src = 'data:image/svg+xml;base64,' + btoa(svgData);
};

export const copyToClipboard = async (text: string) => {
    try {
        await navigator.clipboard.writeText(text);
    } catch (err) {
        // Handle clipboard copy error silently
    }
};

export function transformBatchData(data: BatchData[], sessionId: string) {
    const batchDetails: Record<string, { name: string; id: string }[]> = {};

    data.forEach((item) => {
        // Extract level name, package name, and ID
        const levelName = item.level.level_name;
        const packageName = item.package_dto.package_name;
        const packageId = item.id;
        const selectedSessionId = item.session.id;
        if (selectedSessionId !== sessionId) return;

        // Create the batch key
        const batchKey = `${packageName}`;

        // Initialize the batch key if not present
        if (!batchDetails[batchKey]) {
            batchDetails[batchKey] = [];
        }

        // Add the package details (name and id) to the batch key
        batchDetails[batchKey]!.push({
            name: `${levelName}`,
            id: packageId || '',
        });
    });

    return batchDetails;
}

export function transformAllBatchData(data: BatchData[]) {
    const batchDetails: Record<string, { name: string; id: string }[]> = {};

    data.forEach((item) => {
        // Extract level name, package name, and ID
        const levelName = item.level.level_name;
        const packageName = item.package_dto.package_name;
        const packageId = item.id;

        // Create the batch key
        const batchKey = `${packageName}`;

        // Initialize the batch key if not present
        if (!batchDetails[batchKey]) {
            batchDetails[batchKey] = [];
        }

        // Add the package details (name and id) to the batch key
        batchDetails[batchKey]!.push({
            name: `${levelName}`,
            id: packageId || '',
        });
    });

    return batchDetails;
}

export function transformBatchDataEdit(data: BatchData[]) {
    const batchDetails: Record<string, { name: string; id: string }[]> = {};

    data.forEach((item) => {
        // Extract level name, package name, and ID
        const levelName = item.level.level_name;
        const packageName = item.package_dto.package_name;
        const packageId = item.id;

        // Create the batch key
        const batchKey = `${packageName}`;

        // Initialize the batch key if not present
        if (!batchDetails[batchKey]) {
            batchDetails[batchKey] = [];
        }

        // Add the package details (name and id) to the batch key
        batchDetails[batchKey]!.push({
            name: `${packageName} - ${levelName}`,
            id: packageId || '',
        });
    });

    return batchDetails;
}

export function filterLevelDetailsByIds(
    data: CourseWithSessionsType[],
    allowedIds: string[] | undefined
) {
    return data.map((courseBlock) => ({
        ...courseBlock,
        sessions: courseBlock.sessions.map((session) => ({
            ...session,
            level_with_details: session.level_with_details.filter((level) =>
                allowedIds?.includes(level.id)
            ),
        })),
    }));
}

export function getAllSessions(data: BatchData[]): { id: string; name: string }[] {
    const sessionMap = new Map<string, string>();

    data.forEach((item) => {
        const sessionId = item.session.id;
        const sessionName = item.session.session_name;

        if (!sessionMap.has(sessionId)) {
            sessionMap.set(sessionId, sessionName);
        }
    });

    return Array.from(sessionMap.entries()).map(([id, name]) => ({ id, name }));
}

export const convertToUTC = (dateString: string | undefined | null) => {
    if (!dateString) return '';
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return '';
    return date.toISOString();
};

export const formatDateTimeLocal = (dateString: string | undefined) => {
    if (!dateString) return ''; // Handle empty or undefined values
    const date = new Date(dateString);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${year}-${month}-${day}T${hours}:${minutes}`;
};

export const getTimeLimitString = (time: number, timeLimit: string[]) => {
    const timeStr = timeLimit.find((limit) => limit.startsWith(time.toString()));
    return timeStr || ''; // Returns the matching string or an empty string if no match is found
};

export function calculateTotalMarks(questions: AdaptiveMarkingQuestion[]) {
    let totalMarks = 0;

    questions.forEach((question) => {
        const questionMark = parseFloat(question.questionMark);

        if (!isNaN(questionMark)) {
            totalMarks += questionMark;
        }
    });

    return String(totalMarks);
}

/**
 * What "result / evaluation type" a brand-new assessment starts with.
 *
 * Only a Manual Upload Exam is checked by a teacher; every other type carries
 * objective questions and must grade itself. This used to fall through to a
 * silent schema default of MANUAL when the admin never touched the radio, which
 * turned a Mock with ten MCQs into "Upload Answer" for every learner.
 */
export const defaultResultTypeFor = (examType: string | undefined) =>
    examType === 'MANUAL_UPLOAD_EXAM' ? 'MANUAL' : 'AUTO_AFTER_SUBMISSION';

/** Always-available types: their live window runs to 9999, so they never "end". */
export const isOpenEndedExamType = (examType: string | undefined) =>
    examType === 'MOCK' || examType === 'PRACTICE';

/**
 * A stored result type made sense of for this assessment type. "Auto after
 * assessment end" on a mock/practice test meant results never released (the
 * end never comes); the backend now treats it as after-submission, and the
 * form shows the same so the radio is never blank on edit.
 */
export const normalizeResultTypeFor = (examType: string | undefined, resultType: string) =>
    isOpenEndedExamType(examType) && resultType === 'AUTO_AFTER_ASSESSMENT_END'
        ? 'AUTO_AFTER_SUBMISSION'
        : resultType;

/**
 * Whether Step 1 shows the "Result / evaluation type" settings at all.
 *
 * A survey has no marks and no result to release, so asking an admin to choose
 * a release policy for one is noise — and picking MANUAL there would flip
 * evaluation_type to MANUAL, which puts the learner player into PDF-upload mode
 * (see defaultResultTypeFor). Surveys keep the AUTO_AFTER_SUBMISSION default and
 * the section is hidden.
 *
 * Deliberately keyed off the type rather than the `result_type` step key: MOCK
 * and PRACTICE do not declare that key either, yet they DO need a result type —
 * that omission is what once turned a Mock full of MCQs into "Upload Answer".
 */
export const showsResultReleaseSettings = (examType: string | undefined) => examType !== 'SURVEY';

/**
 * The result type to load into Step 1 when editing an existing assessment.
 *
 * When the result section is hidden for this type there is no radio to correct,
 * so an inherited value becomes permanent. That matters on surveys: 147 of them
 * carry `result_type = MANUAL` (an old accidental default), and Step 1 maps
 * `resultType === 'MANUAL'` to `evaluation_type = MANUAL` on save — which flips
 * the learner player into PDF-upload mode. Editing anything else on such a
 * survey would silently have broken it. A hidden section always resolves to the
 * type's own default instead of whatever happens to be stored.
 */
export const resultTypeForEdit = (
    examType: string | undefined,
    storedResultType: string | undefined
) =>
    showsResultReleaseSettings(examType)
        ? normalizeResultTypeFor(examType, storedResultType || defaultResultTypeFor(examType))
        : defaultResultTypeFor(examType);

/** The submission a Manual Upload Exam collects; nothing for self-grading types. */
export const defaultSubmissionTypeFor = (examType: string | undefined) =>
    examType === 'MANUAL_UPLOAD_EXAM' ? 'PDF' : '';

export const syncStep1DataWithStore = (form: UseFormReturn<BasicSectionFormType>) => {
    const setBasicInfo = useBasicInfoStore.getState().setBasicInfo;
    const { getValues } = form;
    const basicInfoData = {
        status: getValues('status'),
        testCreation: getValues('testCreation'),
        assessmentPreview: getValues('assessmentPreview'),
        submissionType: getValues('submissionType'),
        reattemptCount: getValues('reattemptCount'),
        durationDistribution: getValues('durationDistribution'),
        evaluationType: getValues('evaluationType'),
        resultType: getValues('resultType'),
        aiEvaluationEnabled: getValues('aiEvaluationEnabled'),
        omrMode: getValues('omrMode'),
        proctoring: getValues('proctoring'),
        switchSections: getValues('switchSections'),
        raiseReattemptRequest: getValues('raiseReattemptRequest'),
        raiseTimeIncreaseRequest: getValues('raiseTimeIncreaseRequest'),
    };
    setBasicInfo(basicInfoData);
};

export const syncStep2DataWithStore = (form: UseFormReturn<SectionFormType>) => {
    const setSectionDetails = useSectionDetailsStore.getState().setSectionDetails;
    const { getValues } = form;

    const sectionDetailsData = {
        testDuration: getValues('testDuration'),
        status: getValues('status'),
        section: getValues('section'),
    };

    // Update Zustand Store
    setSectionDetails(sectionDetailsData);
};

export const syncStep3DataWithStore = (form: UseFormReturn<TestAccessFormType>) => {
    const setTestAccessInfo = useTestAccessStore.getState().setTestAccessInfo;
    const { getValues } = form;
    const testDetailsData = {
        closed_test: getValues('closed_test'),
        open_test: getValues('open_test'),
        select_batch: getValues('select_batch'),
        select_individually: getValues('select_individually'),
        join_link: getValues('join_link'),
        show_leaderboard: getValues('show_leaderboard'),
        notify_student: {
            when_assessment_created: getValues('notify_student.when_assessment_created'),
            before_assessment_goes_live: {
                checked: getValues('notify_student.before_assessment_goes_live.checked'),
                value: getValues('notify_student.before_assessment_goes_live.value'),
            },
            when_assessment_live: getValues('notify_student.when_assessment_live'),
            when_assessment_report_generated: getValues(
                'notify_student.when_assessment_report_generated'
            ),
        },
        notify_parent: {
            when_assessment_created: getValues('notify_parent.when_assessment_created'),
            before_assessment_goes_live: {
                checked: getValues('notify_parent.before_assessment_goes_live.checked'),
                value: getValues('notify_parent.before_assessment_goes_live.value'),
            },
            when_assessment_live: getValues('notify_parent.when_assessment_live'),
            when_student_appears: getValues('notify_parent.when_student_appears'),
            when_student_finishes_test: getValues('notify_parent.when_student_finishes_test'),
            when_assessment_report_generated: getValues(
                'notify_parent.when_assessment_report_generated'
            ),
        },
    };
    setTestAccessInfo(testDetailsData);
};

export const syncStep4DataWithStore = (form: UseFormReturn<AccessControlFormValues>) => {
    const setAccessControlData = useAccessControlStore.getState().setAccessControlData;
    const { getValues } = form;
    const testAccessData = {
        assessment_creation_access: getValues('assessment_creation_access'),
        live_assessment_notification: getValues('live_assessment_notification'),
        assessment_submission_and_report_access: getValues(
            'assessment_submission_and_report_access'
        ),
        evaluation_process: getValues('evaluation_process'),
    };
    setAccessControlData(testAccessData);
};

/**
 * {hrs, min} -> total minutes.
 *
 * Both fields are seeded as '' by createDefaultSection, and `parseInt('')` is NaN —
 * which propagates through the addition and then serialises to `null`, so a section the
 * admin gave a duration to could still be sent with no duration at all. Treating a blank
 * or unparseable part as 0 is what the neighbouring total_marks / cutoff_marks fields
 * already do.
 */
const toMinutes = (duration: { hrs?: string; min?: string } | undefined): number => {
    const hrs = parseInt(duration?.hrs ?? '', 10);
    const min = parseInt(duration?.min ?? '', 10);
    return (Number.isNaN(hrs) ? 0 : hrs) * 60 + (Number.isNaN(min) ? 0 : min);
};

export const convertStep2Data = (data: z.infer<typeof sectionDetailsSchema>) => {
    return data.section.map((section, index) => ({
        section_description_html: section.section_description || '',
        section_name: section.sectionName,
        section_id: section.sectionId || '',
        section_duration: toMinutes(section.section_duration),
        section_order: index + 1,
        total_marks: parseFloat(section.total_marks) || 0,
        cutoff_marks: section.cutoff_marks.checked
            ? parseFloat(section.cutoff_marks.value) || 0
            : 0,
        problem_randomization: section.problem_randomization,
        question_and_marking: section.adaptive_marking_for_each_question.map(
            (question, qIndex) => ({
                question_id: question.questionId,
                marking_json: JSON.stringify({
                    type: question.questionType,
                    data: {
                        totalMark: question.questionMark || '',
                        negativeMark: question.questionPenalty || '',
                        negativeMarkingPercentage:
                            question.questionMark && question.questionPenalty
                                ? (Number(question.questionPenalty) /
                                      Number(question.questionMark)) *
                                  100
                                : '',
                        ...(question.questionType === 'MCQM' && {
                            partialMarking: question.correctOptionIdsCnt
                                ? 1 / question.correctOptionIdsCnt
                                : 0,
                            partialMarkingPercentage: question.correctOptionIdsCnt
                                ? (1 / question.correctOptionIdsCnt) * 100
                                : 0,
                        }),
                    },
                }),
                // Same NaN trap as section_duration above: the trailing `|| 0` caught the
                // NaN but turned "30 minutes with the hours box left blank" into 0.
                question_duration_in_min: toMinutes(section.question_duration),
                question_order: qIndex + 1,
                // Add evaluation criteria fields - send null if not applied
                evaluation_criteria_json: (question as any).evaluation_criteria_json || null,
                criteria_template_id: (question as any).criteria_template_id || null,
                is_added: true,
                is_deleted: false,
                is_updated: false,
            })
        ),
    }));
};

interface QuestionAndMarking {
    question_id?: string | undefined;
    marking_json?: string | undefined;
    question_duration_in_min?: number | undefined;
    question_order?: number | undefined;
    evaluation_criteria_json?: string | null;
    criteria_template_id?: string | null;
    is_added: boolean;
    is_deleted: boolean;
    is_updated: boolean;
}

interface Section {
    section_description_html: string;
    section_name: string;
    section_id: string;
    section_duration: number;
    section_order: number;
    total_marks: number;
    cutoff_marks: number;
    problem_randomization: boolean;
    question_and_marking: QuestionAndMarking[];
}

export function classifySections(oldSectionData: Section[], newSectionData: Section[]) {
    const added_sections: Section[] = [];
    const updated_sections: Section[] = [];
    const deleted_sections: Section[] = [];

    // Step 1: Create a map for easy lookup by sectionId
    const oldSectionMap = oldSectionData.reduce(
        (acc, section) => {
            acc[section.section_id] = section;
            return acc;
        },
        {} as { [key: string]: Section }
    );

    const newSectionMap = new Set(newSectionData.map((section) => section.section_id));

    // Step 2: Process new sections
    newSectionData.forEach((newSection, index) => {
        const oldSection = oldSectionMap[newSection.section_id];

        if (!newSection.section_id || !oldSection) {
            // Case 1: New section (either section_id is empty or doesn't exist in old data)
            added_sections.push({
                ...newSection,
                section_order: index + 1,
                total_marks: newSection.total_marks || 0,
                question_and_marking: newSection.question_and_marking?.map((item) => ({
                    ...item,
                    is_added: true,
                    is_deleted: false,
                    is_updated: false,
                })),
            });
        } else {
            // Case 2: Section exists in both old and new data - check for updates
            const hasChanged =
                oldSection?.section_description_html !== newSection.section_description_html ||
                oldSection?.section_name !== newSection.section_name ||
                oldSection?.section_duration !== newSection.section_duration ||
                oldSection?.total_marks !== newSection.total_marks ||
                oldSection?.cutoff_marks !== newSection.cutoff_marks ||
                oldSection?.problem_randomization !== newSection.problem_randomization;

            // Create maps for quick lookup
            const oldQuestionsMap = new Map(
                oldSection?.question_and_marking?.map((q) => [q.question_id, q])
            );
            const newQuestionsMap = new Map(
                newSection?.question_and_marking?.map((q) => [q.question_id, q])
            );

            const updatedQuestionAndMarking: QuestionAndMarking[] = [];

            // 1️⃣ Check for updated and deleted questions
            oldQuestionsMap.forEach((oldQuestion, questionId) => {
                if (newQuestionsMap.has(questionId)) {
                    const newQuestion = newQuestionsMap.get(questionId);
                    const isChanged = JSON.stringify(oldQuestion) !== JSON.stringify(newQuestion);
                    if (isChanged) {
                        updatedQuestionAndMarking.push({
                            ...newQuestion,
                            is_added: false,
                            is_updated: true,
                            is_deleted: false,
                        });
                    }
                } else {
                    // Question exists in oldData but not in newData (deleted)
                    updatedQuestionAndMarking.push({
                        ...oldQuestion,
                        is_added: false,
                        is_updated: false,
                        is_deleted: true,
                    });
                }
            });

            // 2️⃣ Check for newly added questions
            newQuestionsMap.forEach((newQuestion, questionId) => {
                if (!oldQuestionsMap.has(questionId)) {
                    updatedQuestionAndMarking.push({
                        ...newQuestion,
                        is_added: true,
                        is_updated: false,
                        is_deleted: false,
                    });
                }
            });

            // If there are any updates or section-level changes, add to updated_sections
            if (hasChanged || updatedQuestionAndMarking.length > 0) {
                updated_sections.push({
                    ...newSection,
                    section_order: index + 1,
                    question_and_marking: updatedQuestionAndMarking,
                });
            }
        }
    });

    // Step 3: Identify deleted sections
    oldSectionData.forEach((oldSection) => {
        if (!newSectionMap.has(oldSection.section_id)) {
            deleted_sections.push({
                ...oldSection,
                question_and_marking: oldSection.question_and_marking?.map((item) => ({
                    ...item,
                    is_added: false,
                    is_deleted: true,
                    is_updated: false,
                })),
            });
        }
    });

    return { added_sections, updated_sections, deleted_sections };
}

export function calculateTotalTime(testData: z.infer<typeof sectionDetailsSchema>) {
    if (testData.testDuration.sectionWiseDuration) {
        // Iterate through each section and sum up section durations
        const totalMinutes = testData.section.reduce((sum, section) => {
            const hrs = parseInt(section.section_duration.hrs, 10) || 0;
            const min = parseInt(section.section_duration.min, 10) || 0;
            return sum + hrs * 60 + min;
        }, 0);
        return totalMinutes;
    } else if (testData.testDuration.questionWiseDuration) {
        // Iterate through each question in each section and sum up question durations
        const totalMinutes = testData.section.reduce((sum, section) => {
            const questionMinutes = section.adaptive_marking_for_each_question.reduce(
                (qSum, question) => {
                    const hrs = parseInt(question.questionDuration.hrs, 10) || 0;
                    const min = parseInt(question.questionDuration.min, 10) || 0;
                    return qSum + hrs * 60 + min;
                },
                0
            );
            return sum + questionMinutes;
        }, 0);
        return totalMinutes;
    }
    return (
        Number(testData?.testDuration?.entireTestDuration?.testDuration?.hrs) * 60 +
        Number(testData?.testDuration?.entireTestDuration?.testDuration?.min)
    );
}

export function convertToCustomFieldsData(data: RegistrationFormField[] | undefined) {
    if (!data) return [];
    // field_order is the form order — the learner page sorts by it. The API serializes these
    // from an unordered set, so without sorting here the builder lists them in an arbitrary
    // order, and dragging a row would then save that arbitrary order over the real one.
    return [...data]
        .sort((a, b) => (a.field_order ?? 0) - (b.field_order ?? 0))
        .map((field) => ({
            id: field.id,
            type: field.field_type,
            name: field.field_name,
            oldKey:
                field.field_key === 'full_name' ||
                field.field_key === 'phone_number' ||
                field.field_key === 'email'
                    ? true
                    : false,
            isRequired: field.is_mandatory,
            key: field.field_key,
            // Carries help text and the other per-field settings back into the builder, so the
            // edit dialog opens showing what was saved.
            ...(field.config ? { config: field.config } : {}),
            ...(field.field_type === 'dropdown' && {
                options: field.comma_separated_options.split(',').map((value, index) => ({
                    id: String(index),
                    value: value.trim(),
                    disabled: false,
                })),
            }),
            order: field.field_order,
        }));
}

export function getCustomFieldsWhileEditStep3(assessmentDetails: Steps) {
    const registrationFields = assessmentDetails[2]?.saved_data?.registration_form_fields ?? [];
    return withMissingBuiltInFieldsOnTop(convertToCustomFieldsData(registrationFields));
}

export const convertToCustomFieldSchema = (field: CustomFieldStep3): ConvertedCustomField => {
    // Help text and the other per-field settings live in `config`, already a JSON string.
    // `default_value` / `description` stay empty: duplicating the same values into those
    // legacy top-level fields would only drift.
    return {
        id: field.id,
        name: field.name,
        type: field.type,
        default_value: '', // Provide a default value, if necessary
        description: '', // Provide a description, if necessary
        // Always sent (as '' when there are no settings) so clearing help text actually clears it.
        config: field.config ?? '',
        is_mandatory: field.isRequired,
        key: field.key, // Use the ID as the key
        comma_separated_options: field.options
            ? field.options.map((opt) => opt.value).join(',')
            : '', // Join options for dropdowns
        // Only send a real position. Sending 0 for a legacy row whose order is
        // unset would stamp field_order=0 and jump it to the top of the form.
        ...(typeof field.order === 'number' ? { order_field: field.order } : {}),
    };
};

export const convertDataToStep3 = (
    oldData: TestAccessFormType | null,
    newData: z.infer<typeof testAccessSchema>
) => {
    const convertedData: {
        closed_test: boolean;
        open_test_details: {
            registration_start_date: string;
            registration_end_date: string;
            instructions_html: string;
            registration_form_details: {
                added_custom_added_fields: ConvertedCustomField[];
                updated_custom_added_fields: ConvertedCustomField[];
                removed_custom_added_fields: ConvertedCustomField[];
            };
        };
        added_pre_register_batches_details: string[];
        deleted_pre_register_batches_details: string[];
        added_pre_register_students_details: Step3StudentDetailInterface[];
        deleted_pre_register_students_details: Step3StudentDetailInterface[];
        updated_join_link: string;
        notify_student: Record<string, boolean | number>;
        notify_parent: Record<string, boolean | number>;
    } = {
        closed_test: false,
        open_test_details: {
            registration_start_date: '',
            registration_end_date: '',
            instructions_html: '',
            registration_form_details: {
                added_custom_added_fields: [],
                removed_custom_added_fields: [],
                updated_custom_added_fields: [],
            },
        },
        added_pre_register_batches_details: [],
        deleted_pre_register_batches_details: [],
        added_pre_register_students_details: [],
        deleted_pre_register_students_details: [],
        updated_join_link: '',
        notify_student: {},
        notify_parent: {},
    };

    if (oldData === null) return convertedData;

    // Compare closed_test
    if (newData?.closed_test !== oldData.closed_test) {
        convertedData.closed_test = newData?.closed_test ?? false;
    }

    // Compare open_test
    if (
        newData?.open_test.checked !== oldData.open_test.checked ||
        newData?.open_test.start_date !== oldData.open_test.start_date ||
        newData?.open_test.end_date !== oldData.open_test.end_date ||
        newData?.open_test.instructions !== oldData.open_test.instructions
    ) {
        convertedData.open_test_details = {
            registration_start_date: convertToUTC(newData?.open_test.start_date),
            registration_end_date: convertToUTC(newData?.open_test.end_date),
            instructions_html: newData?.open_test.instructions || '',
            registration_form_details: {
                added_custom_added_fields: [],
                removed_custom_added_fields: [],
                updated_custom_added_fields: [],
            },
        };
    }

    //Adding disabled false if type of field is dropdown
    newData.open_test.custom_fields =
        newData?.open_test.custom_fields.map((field) => {
            if (field.type === 'dropdown' && Array.isArray(field.options)) {
                return {
                    ...field,
                    options: field.options.map((option) => ({
                        ...option,
                        disabled: false,
                    })),
                };
            }
            return field;
        }) || [];

    // Compare custom_fields
    const oldCustomFields = oldData.open_test.custom_fields.reduce<
        Record<string, (typeof oldData.open_test.custom_fields)[number]>
    >((acc, field) => {
        acc[field.id] = field;
        return acc;
    }, {});

    newData.open_test.custom_fields.forEach((field: CustomFieldStep3) => {
        if (!oldCustomFields[field.id]) {
            convertedData.open_test_details.registration_form_details.added_custom_added_fields.push(
                convertToCustomFieldSchema(field)
            );
        } else {
            const oldField = oldCustomFields[field.id];
            if (JSON.stringify(field) !== JSON.stringify(oldField)) {
                convertedData.open_test_details.registration_form_details.updated_custom_added_fields.push(
                    convertToCustomFieldSchema(field)
                );
            }
            delete oldCustomFields[field.id];
        }
    });

    convertedData.open_test_details.registration_form_details.removed_custom_added_fields =
        Object.values(oldCustomFields).length > 0
            ? convertCustomFields(Object.values(oldCustomFields))
            : [];

    // Compare batch details
    const oldBatches = Object.values(oldData.select_batch.batch_details).flat();
    const newBatches = Object.values(newData.select_batch.batch_details).flat();

    convertedData.deleted_pre_register_batches_details = oldBatches.filter(
        (id) => !newBatches.includes(id)
    );

    convertedData.added_pre_register_batches_details = newBatches.filter(
        (id) => !oldBatches.includes(id)
    );

    // Compare student details
    const oldUserIds = new Set(
        oldData.select_individually.student_details.map((student) => student.user_id)
    );
    const newUserIds = new Set(
        newData?.select_individually.student_details.map((student) => student.user_id)
    );

    // Students present in newData but not in oldData (Added)
    convertedData.added_pre_register_students_details =
        newData?.select_individually.student_details.filter(
            (student) => !oldUserIds.has(student.user_id)
        );

    // Students present in oldData but not in newData (Deleted)
    convertedData.deleted_pre_register_students_details =
        oldData.select_individually.student_details.filter(
            (student) => !newUserIds.has(student.user_id)
        );

    // Compare join_link
    if (newData?.join_link !== oldData.join_link) {
        convertedData.updated_join_link = newData?.join_link ?? '';
    }

    // Compare notification settings
    const compareNotification = (newNotif: NotificationStep3) => {
        return {
            when_assessment_created: newNotif.when_assessment_created,
            show_leaderboard: newData?.show_leaderboard,
            before_assessment_goes_live: newNotif.before_assessment_goes_live.value
                ? parseInt(newNotif.before_assessment_goes_live.value)
                : 0,
            when_assessment_live: newNotif.when_assessment_live,
            when_assessment_report_generated: newNotif.when_assessment_report_generated,
        };
    };

    const studentNotifications = compareNotification(newData?.notify_student);
    const parentNotifications = compareNotification(newData?.notify_parent);

    convertedData.notify_student = studentNotifications;

    convertedData.notify_parent = parentNotifications;
    return convertedData;
};

/** react-hook-form nests errors like the form values; list every leaf with its path. */
export function flattenFormErrors(
    errors: unknown,
    prefix = ''
): { path: string; message: string }[] {
    if (!errors || typeof errors !== 'object') return [];
    const out: { path: string; message: string }[] = [];
    for (const [key, value] of Object.entries(errors as Record<string, unknown>)) {
        if (!value || typeof value !== 'object') continue;
        const path = prefix ? `${prefix}.${key}` : key;
        const message = (value as { message?: unknown }).message;
        if (typeof message === 'string' && message) {
            out.push({ path, message });
        } else if (!('ref' in (value as object))) {
            out.push(...flattenFormErrors(value, path));
        }
    }
    return out;
}

/** Years at or past this mean "never closes", not a schedule. */
const NO_EXPIRY_YEAR = 9000;

export function convertDateFormat(dateStr: string) {
    if (dateStr === '') return '';

    // Backend sends timestamps as UTC but sometimes omits the trailing 'Z'.
    // `new Date("2026-07-11T12:37:00")` without a zone marker is parsed as
    // *local* time by browsers, silently shifting the instant. Force UTC
    // interpretation when no zone marker is present.
    const hasTimezone = /Z$|[+-]\d{2}:?\d{2}$/i.test(dateStr);
    const normalized = hasTimezone ? dateStr : `${dateStr.replace(' ', 'T')}Z`;
    const date = new Date(normalized);
    if (isNaN(date.getTime())) return '';
    // Mock/practice tests are stored as "open until 9999-12-31 UTC". East of
    // Greenwich that instant is the year 10000, which no datetime-local input
    // can hold - the value parsed as Invalid Date and the hidden end-date rule
    // silently blocked every Update of a mock or practice test in India.
    if (date.getFullYear() >= NO_EXPIRY_YEAR) return '';

    // Emit LOCAL wall-clock components for the datetime-local input, which
    // interprets its value as local time. Using toISOString() here would leak
    // UTC digits into the form, shifting the shown time by the TZ offset and
    // corrupting the stored instant on re-save.
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * Whether Step 1's "Next" may be enabled.
 *
 * Kept out of the component so the rule can be tested: it is hand-rolled rather
 * than derived from the zod schema (which treats the live-window dates as
 * optional), and it once demanded a field that the same step never rendered.
 * `AssessmentBasicDetail.getStepsForSurvey` declares both boundation dates
 * OPTIONAL — a survey may carry a live window but does not need one — so the
 * requirement is keyed off "REQUIRED", not off the field merely being rendered.
 * Keying it off presence left "Next" permanently disabled on a new survey.
 *
 * Rule of thumb for anything added here: only require what Step 1 actually
 * renders for that assessment type.
 */
export const isBasicInfoStepComplete = ({
    examType,
    isNewAssessment,
    requiresLiveDateRange,
    assessmentName,
    liveDateRangeStartDate,
    liveDateRangeEndDate,
    reattemptCount,
    errorCount,
}: {
    examType: string | undefined;
    isNewAssessment: boolean;
    requiresLiveDateRange: boolean;
    assessmentName: string | undefined;
    liveDateRangeStartDate: string | undefined;
    liveDateRangeEndDate: string | undefined;
    reattemptCount: string | number | undefined;
    errorCount: number;
}): boolean => {
    if (!assessmentName || errorCount > 0) return false;

    const needsFullSchedule = (examType === 'EXAM' || examType === 'SURVEY') && isNewAssessment;
    if (!needsFullSchedule) return true;

    if (requiresLiveDateRange && !(liveDateRangeStartDate && liveDateRangeEndDate)) {
        return false;
    }

    return !!Number(reattemptCount);
};
