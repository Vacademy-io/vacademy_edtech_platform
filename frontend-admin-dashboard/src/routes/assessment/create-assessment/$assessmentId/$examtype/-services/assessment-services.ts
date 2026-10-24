import { DEFAULT_PROCTORING_FORM, proctoringWireFromForm } from '@/types/assessments/proctoring';
import {
    GET_ASSESSMENT_DETAILS,
    PUBLISH_ASSESSMENT_URL,
    STEP1_ASSESSMENT_URL,
    STEP2_ASSESSMENT_URL,
    STEP2_QUESTIONS_URL,
    STEP3_ASSESSMENT_URL,
    STEP4_ASSESSMENT_URL,
    STEP2_QUESTIONS_FULL_URL,
    STEP2_EDIT_QUESTIONS_URL,
} from '@/constants/urls';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import type { QuestionResponse } from '@/types/assessments/question-paper-template';
import {
    ConvertedCustomField,
    CustomFields,
    Steps,
} from '@/types/assessments/assessment-data-type';
import { z } from 'zod';
import { BasicInfoFormSchema } from '../-utils/basic-info-form-schema';
import sectionDetailsSchema from '../-utils/section-details-schema';
import {
    calculateTotalTime,
    classifySections,
    convertDataToStep3,
    convertStep2Data,
    convertToUTC,
} from '../-utils/helper';
import testAccessSchema from '../-utils/add-participants-schema';
import { AccessControlFormSchema } from '../-utils/access-control-form-schema';
import { TestAccessFormType } from '@/types/assessments/assessment-steps';
import { AssessmentPreviewSectionsInterface } from '@/routes/assessment/assessment-list/assessment-details/$assessmentId/$examType/$assesssmentType/$assessmentTab/-utils/assessment-details-interface';

export const getAssessmentDetailsData = async ({
    assessmentId,
    instituteId,
    type,
}: {
    assessmentId: string | null | undefined;
    instituteId: string | undefined;
    type: string | undefined;
}): Promise<Steps> => {
    const response = await authenticatedAxiosInstance({
        method: 'GET',
        url: GET_ASSESSMENT_DETAILS,
        params: {
            assessmentId,
            instituteId,
            type,
        },
    });
    return response?.data as Steps;
};
export const getAssessmentDetails = ({
    assessmentId,
    instituteId,
    type,
}: {
    assessmentId: string | null | undefined;
    instituteId: string | undefined;
    type: string | undefined;
}) => {
    return {
        queryKey: ['GET_ASSESSMENT_DETAILS', assessmentId, instituteId, type],
        queryFn: () => getAssessmentDetailsData({ assessmentId, instituteId, type }),
        staleTime: 60 * 60 * 1000,
        enabled: !!assessmentId,
    };
};

/**
 * The assessment's questions as full question-paper style DTOs (text, options,
 * answer key, explanation) - what the question editor understands - keyed by
 * section id. The preview shape from getQuestionsDataForStep2 drops the
 * explanation and the key, so it cannot round-trip an edit.
 */
export const getFullQuestionsOfSections = async ({
    assessmentId,
    sectionIds,
}: {
    assessmentId: string;
    sectionIds: string | undefined;
}): Promise<Record<string, QuestionResponse[]>> => {
    const response = await authenticatedAxiosInstance({
        method: 'GET',
        url: STEP2_QUESTIONS_FULL_URL,
        params: { assessmentId, sectionIds },
    });
    return response?.data ?? {};
};

/** Rewrite questions of this assessment in place (same ids, so every section keeps them). */
export const editAssessmentQuestions = async ({
    assessmentId,
    instituteId,
    updatedQuestions,
}: {
    assessmentId: string;
    instituteId: string | undefined;
    updatedQuestions: unknown[];
}): Promise<boolean> => {
    const response = await authenticatedAxiosInstance({
        method: 'PATCH',
        url: STEP2_EDIT_QUESTIONS_URL,
        params: { assessmentId, instituteId },
        data: { updated_questions: updatedQuestions, added_questions: [], deleted_questions: [] },
    });
    return Boolean(response?.data);
};

export const getQuestionsDataForStep2 = async ({
    assessmentId,
    sectionIds,
}: {
    assessmentId: string;
    sectionIds: string | undefined;
}) => {
    const response = await authenticatedAxiosInstance({
        method: 'GET',
        url: STEP2_QUESTIONS_URL,
        params: {
            assessmentId,
            sectionIds,
        },
    });
    return response?.data;
};

export const getQuestionDataForSection = ({
    assessmentId,
    sectionIds,
}: {
    assessmentId: string;
    sectionIds: string | undefined;
}) => {
    return {
        queryKey: ['GET_QUESTIONS_DATA_FOR_SECTIONS', assessmentId, sectionIds],
        queryFn: async () => {
            const data = await getQuestionsDataForStep2({ assessmentId, sectionIds });
            return data;
        },
        staleTime: 60 * 60 * 1000,
    };
};

export function getTestBoundation(
    testType: string | undefined,
    liveDateRange: { startDate?: string; endDate?: string }
) {
    switch (testType) {
        case 'LIVE':
            return {
                start_date: convertToUTC(liveDateRange.startDate || ''),
                end_date: convertToUTC(liveDateRange.endDate || ''),
            };
        case 'SURVEY':
            // A survey's live window is optional. Left blank it behaves like a
            // mock or practice test — open from now until the 9999 sentinel.
            // It must NOT be sent blank: the learner assessment list filters on
            // `CURRENT_TIMESTAMP BETWEEN bound_start_time AND bound_end_time`,
            // and NULL bounds make that NULL rather than true, so the survey
            // would never appear in anyone's Live list.
            return {
                start_date: convertToUTC(liveDateRange.startDate || '') || new Date().toISOString(),
                end_date:
                    convertToUTC(liveDateRange.endDate || '') ||
                    new Date('9999-12-31T23:59:59.999Z').toISOString(),
            };
        case 'PRACTICE':
            return {
                start_date: new Date().toISOString(),
                end_date: new Date('9999-12-31T23:59:59.999Z').toISOString(),
            };
        case 'MOCK':
            return {
                start_date: new Date().toISOString(),
                end_date: new Date('9999-12-31T23:59:59.999Z').toISOString(),
            };
        default:
            return {
                start_date: convertToUTC(liveDateRange.startDate || ''),
                end_date: convertToUTC(liveDateRange.endDate || ''),
            };
    }
}

export const handlePostStep1Data = async (
    data: z.infer<typeof BasicInfoFormSchema>,
    assessmentId: string | null | undefined,
    instituteId: string | undefined,
    type: string | undefined
) => {
    const transformedData = {
        status: data.status,
        assessment_type: 'ASSESSMENT',
        test_creation: {
            assessment_name: data.testCreation.assessmentName,
            subject_id: data.testCreation.subject,
            assessment_instructions_html: data.testCreation.assessmentInstructions,
        },
        test_boundation: getTestBoundation(type, data.testCreation.liveDateRange),
        assessment_preview_time: data.assessmentPreview.checked
            ? parseInt(data.assessmentPreview.previewTimeLimit)
            : 0,
        default_reattempt_count:
            type === 'MOCK' || type === 'PRACTICE' ? 100000 : data.reattemptCount,
        switch_sections: data.switchSections,
        // NO_AUTO_RELEASE = auto-graded but held until admin releases — still AUTO evaluation.
        evaluation_type: data.resultType === 'MANUAL' ? 'MANUAL' : 'AUTO',
        submission_type: data.submissionType,
        result_type: data.resultType,
        raise_reattempt_request: data.raiseReattemptRequest,
        raise_time_increase_request: data.raiseTimeIncreaseRequest,
        // Queue an AI evaluation when a learner submits. Metered per graded
        // question, so it is only ever sent as an explicit true/false.
        ai_evaluation_enabled: data.aiEvaluationEnabled ?? false,
        // OMR sheet (pen & paper) mode: answered on a printed bubble sheet, read by OMRChecker.
        has_omr_mode: data.omrMode ?? false,
        // Always sent as a full object: tier NONE clears the stored config, so a
        // save from this build can never leave a stale tier behind.
        proctoring_config: proctoringWireFromForm(data.proctoring ?? DEFAULT_PROCTORING_FORM),
    };
    const response = await authenticatedAxiosInstance({
        method: 'POST',
        url: STEP1_ASSESSMENT_URL,
        data: transformedData,
        params: {
            assessmentId,
            instituteId,
            type,
        },
    });
    return response?.data;
};

export const handlePostStep2Data = async (
    oldData: z.infer<typeof sectionDetailsSchema>,
    data: z.infer<typeof sectionDetailsSchema>,
    assessmentId: string | null,
    instituteId: string | undefined,
    type: string | undefined
) => {
    const convertedOldData = convertStep2Data(oldData);
    const convertedNewData = convertStep2Data(data);
    const classifiedSections = classifySections(convertedOldData, convertedNewData);
    const convertedData = {
        test_duration: {
            entire_test_duration: data.testDuration.entireTestDuration.checked
                ? parseInt(data?.testDuration?.entireTestDuration?.testDuration?.hrs || '0') * 60 +
                  parseInt(data?.testDuration?.entireTestDuration?.testDuration?.min || '0')
                : calculateTotalTime(data),
            distribution_duration: data.testDuration.sectionWiseDuration
                ? 'SECTION'
                : data.testDuration.entireTestDuration.checked
                  ? 'ASSESSMENT'
                  : 'QUESTION',
        },
        added_sections: classifiedSections.added_sections,
        updated_sections: classifiedSections.updated_sections,
        deleted_sections: classifiedSections.deleted_sections,
    };
    const response = await authenticatedAxiosInstance({
        method: 'POST',
        url: STEP2_ASSESSMENT_URL,
        data: convertedData,
        params: {
            assessmentId,
            instituteId,
            type,
        },
    });
    return response?.data;
};

export const handlePostAssessmentPreview = async (
    data: AssessmentPreviewSectionsInterface,
    assessmentId: string | null,
    instituteId: string | undefined,
    type: string | undefined
) => {
    const convertedData = {
        test_duration: data.test_duration,
        added_sections: data.added_sections,
        updated_sections: data.updated_sections,
        deleted_sections: data.deleted_sections,
    };
    const response = await authenticatedAxiosInstance({
        method: 'POST',
        url: STEP2_ASSESSMENT_URL,
        data: convertedData,
        params: {
            assessmentId,
            instituteId,
            type,
        },
    });
    return response?.data;
};

// Type definition for each converted custom field

// Function that converts customFields to the desired structure
export const convertCustomFields = (customFields: CustomFields): ConvertedCustomField[] => {
    const convertedFields = customFields.map((field) => {
        return {
            id: field.id,
            name: field.name,
            type: field.type,
            default_value: '', // Provide a default value, if necessary
            description: '', // Provide a description, if necessary
            // Help text and the other per-field settings. This is the create-assessment path;
            // dropping it here meant help text saved on edit but never on first creation.
            config: field.config ?? '',
            is_mandatory: field.isRequired,
            key: field.key ?? '', // Use the ID as the key
            comma_separated_options: field.options
                ? field.options.map((opt) => opt.value).join(',')
                : '', // Join options for dropdowns
            order_field: field.order,
        };
    });
    return convertedFields;
};

// Helper function to get open test details
const getOpenTestDetails = (openTestData: any) => {
    if (!openTestData.checked) return {};

    return {
        registration_start_date: convertToUTC(openTestData.start_date) || '',
        registration_end_date: convertToUTC(openTestData.end_date) || '',
        instructions_html: openTestData.instructions || '',
        registration_form_details: {
            added_custom_added_fields: convertCustomFields(openTestData.custom_fields),
            removed_custom_added_fields: [],
        },
    };
};

// Helper function to get batch details
const getBatchDetails = (selectBatchData: any) => {
    return selectBatchData.batch_details
        ? Object.values(selectBatchData.batch_details).flat()
        : [];
};

// Helper function to get student details
const getStudentDetails = (selectIndividuallyData: any) => {
    return selectIndividuallyData.student_details || [];
};

// Helper function to get notification settings for students
const getStudentNotificationSettings = (notifyStudentData: any, showLeaderboard: boolean) => {
    return {
        when_assessment_created: notifyStudentData.when_assessment_created || false,
        show_leaderboard: showLeaderboard || false,
        before_assessment_goes_live: notifyStudentData.before_assessment_goes_live.checked
            ? parseInt(notifyStudentData.before_assessment_goes_live.value)
            : 0,
        when_assessment_live: notifyStudentData.when_assessment_live || false,
        when_assessment_report_generated: notifyStudentData.when_assessment_report_generated || false,
    };
};

// Helper function to get notification settings for parents
const getParentNotificationSettings = (notifyParentData: any, showLeaderboard: boolean) => {
    return {
        when_assessment_created: notifyParentData.when_assessment_created || false,
        before_assessment_goes_live: notifyParentData.before_assessment_goes_live.checked
            ? parseInt(notifyParentData.before_assessment_goes_live.value)
            : 0,
        show_leaderboard: showLeaderboard || false,
        when_assessment_live: notifyParentData.when_assessment_live || false,
        when_student_appears: notifyParentData.when_student_appears || false,
        when_student_finishes_test: notifyParentData.when_student_finishes_test || false,
        when_assessment_report_generated: notifyParentData.when_assessment_report_generated || false,
    };
};

// Helper function to build create data payload
const buildCreateDataPayload = (newData: z.infer<typeof testAccessSchema>) => {
    return {
        closed_test: newData.closed_test,
        open_test_details: getOpenTestDetails(newData.open_test),
        added_pre_register_batches_details: getBatchDetails(newData.select_batch),
        deleted_pre_register_batches_details: [],
        added_pre_register_students_details: getStudentDetails(newData.select_individually),
        deleted_pre_register_students_details: [],
        updated_join_link: newData.join_link || '',
        notify_student: getStudentNotificationSettings(newData.notify_student, newData.show_leaderboard),
        notify_parent: getParentNotificationSettings(newData.notify_parent, newData.show_leaderboard),
    };
};

export const handlePostStep3Data = async (
    oldFormData: TestAccessFormType | null,
    newData: z.infer<typeof testAccessSchema>,
    assessmentId: string | null,
    instituteId: string | undefined,
    type: string | undefined,
    actionType: string
) => {
    const convertedData1 = buildCreateDataPayload(newData);
    const convertedData2 = convertDataToStep3(oldFormData, newData);

    const response = await authenticatedAxiosInstance({
        method: 'POST',
        url: STEP3_ASSESSMENT_URL,
        data: actionType === 'create' ? convertedData1 : convertedData2,
        params: {
            assessmentId,
            instituteId,
            type,
        },
    });

    return response?.data;
};

export const handlePostStep4Data = async (
    data: z.infer<typeof AccessControlFormSchema>,
    assessmentId: string | null,
    instituteId: string | undefined,
    type: string | undefined
) => {
    //Currently implementated only for evaluation setting
    const assess_setting = {
        institute_id: instituteId,
        assessment_id: assessmentId,
        type: 'manual',
        users: data.evaluation_process.map((user) => {
            return {
                user_id: user.userId,
                name: user.name,
                email: user.email,
                role: user.roles[0]?.roleName,
            };
        }),
    };

    const addedData = {
        assessment_creation_access: {
            batch_ids: [],
            roles: [],
            user_ids: data.assessment_creation_access.map((user) => user.userId),
        },
        live_assessment_notification_access: {
            batch_ids: [],
            roles: [],
            user_ids: data.live_assessment_notification.map((user) => user.userId),
        },
        assessment_submission_and_report_access: {
            batch_ids: [],
            roles: [],
            user_ids: data.assessment_submission_and_report_access.map((user) => user.userId),
        },
        evaluation_process_access: {
            batch_ids: [],
            roles: [],
            user_ids: data.evaluation_process.map((user) => user.userId),
            assess_setting: JSON.stringify(assess_setting),
        },
    };
    const response = await authenticatedAxiosInstance({
        method: 'POST',
        url: STEP4_ASSESSMENT_URL,
        data: { current_accesses: addedData },
        params: {
            assessmentId,
            instituteId,
            type,
        },
    });
    return response?.data;
};

export const publishAssessment = async ({
    assessmentId,
    instituteId,
    type,
}: {
    assessmentId: string | null;
    instituteId: string | undefined;
    type: string | undefined;
}) => {
    const response = await authenticatedAxiosInstance({
        method: 'POST',
        url: PUBLISH_ASSESSMENT_URL,
        params: {
            assessmentId,
            instituteId,
            type,
        },
        data: {},
    });
    return response?.data;
};
