import { SubmissionStudentData } from '@/types/assessments/assessment-overview';
import {
    assessmentStatusStudentAttemptedColumnsExternal,
    assessmentStatusStudentAttemptedColumnsInternal,
    assessmentSubmissionFileColumn,
    assessmentStatusStudentOngoingColumnsExternal,
    assessmentStatusStudentOngoingColumnsInternal,
    assessmentStatusStudentPendingColumnsExternal,
    assessmentStatusStudentPendingColumnsInternal,
    studentExternalQuestionWise,
    studentInternalOrCloseQuestionWise,
} from './student-columns';
import { AdaptiveMarking } from '@/routes/assessment/create-assessment/$assessmentId/$examtype/-hooks/getQuestionsDataForSection';
import { Section } from '@/types/assessments/assessment-steps';
import {
    AssessmentSection,
    AssessmentSectionQuestionInterface,
    calculateAverageMarksQuestionInterface,
    PreBatchRegistration,
    QuestionInsightDTO,
    SectionInfoWithAddedQuestions,
    SectionInfoWithAddedQuestionsCntOrNull,
    StudentLeaderboardEntry,
    transformSectionsAndQuestionsDataQuestionsData,
} from './assessment-details-interface';
import { sectionsEditQuestionFormType } from '../-components/AssessmentPreview';
import { MyQuestion } from '@/types/assessments/question-paper-form';
import { BatchDetailsInterface, StudentLeaderboard } from '@/types/assessment-overview';
import {
    ASSESSMENT_STATUS_STUDENT_ATTEMPTED_COLUMNS_EXTERNAL_WIDTH,
    ASSESSMENT_STATUS_STUDENT_ATTEMPTED_COLUMNS_INTERNAL_WIDTH,
    ASSESSMENT_STATUS_STUDENT_ONGOING_COLUMNS_EXTERNAL_WIDTH,
    ASSESSMENT_STATUS_STUDENT_ONGOING_COLUMNS_INTERNAL_WIDTH,
    ASSESSMENT_STATUS_STUDENT_PENDING_COLUMNS_EXTERNAL_WIDTH,
    ASSESSMENT_STATUS_STUDENT_PENDING_COLUMNS_INTERNAL_WIDTH,
    QUESTION_WISE_COLUMNS_EXTERNAL_WIDTH,
    QUESTION_WISE_COLUMNS_INTERNAL_OR_CLOSE_WIDTH,
} from '@/components/design-system/utils/constants/table-layout';
import { convertToLocalDateTime, extractDateTime } from '@/constants/helper';
import {
    Step3ParticipantsListIndiviudalStudentInterface,
    Step3ParticipantsListInterface,
    StudentResponseQuestionwiseInterface,
} from '@/types/assessments/student-questionwise-status';

export const convertMarksRankData = (leaderboard: StudentLeaderboardEntry[]) => {
    const rankMap = new Map();

    leaderboard.forEach(({ rank, scoredMarks, percentile }) => {
        if (!rankMap.has(rank)) {
            rankMap.set(rank, {
                rank: parseInt(rank),
                marks: scoredMarks,
                percentile: parseFloat(percentile),
                noOfParticipants: 0,
            });
        }
        rankMap.get(rank).noOfParticipants += 1;
    });

    return Array.from(rankMap.values());
};

export const getAssessmentSubmissionsFilteredDataStudentData = (
    studentsListData: SubmissionStudentData[],
    type: string,
    selectedTab: string,
    batches_for_sessions: BatchDetailsInterface[],
    totalMarks: number
) => {
    switch (type) {
        case 'PUBLIC': {
            return studentsListData.map((student) => {
                if (selectedTab === 'Attempted') {
                    return {
                        id: student.user_id,
                        registration_id: student.registration_id,
                        attempt_id: student.attempt_id,
                        full_name: student.student_name,
                        package_session_id: getBatchNameById(
                            batches_for_sessions,
                            student.batch_id
                        ),
                        // Real ids so Portal Access can resolve the learner's package
                        // for portal redirect / reset password. (package_session_id
                        // above is a display NAME, not a UUID.) package_id is the
                        // course/package id; all_package_session_ids the ps UUID(s).
                        package_id: getPackageIdByBatchId(batches_for_sessions, student.batch_id),
                        all_package_session_ids: student.batch_id ? [student.batch_id] : [],
                        attempt_date: extractDateTime(convertToLocalDateTime(student.attempt_date))
                            .date,
                        start_time: extractDateTime(convertToLocalDateTime(student.attempt_date))
                            .time,
                        end_time: extractDateTime(convertToLocalDateTime(student.end_time || ''))
                            .time,
                        duration: (student.duration / 60).toFixed(2) + ' min',
                        score: `${student.score ? student.score.toFixed(2) : 0} / ${totalMarks}`,
                        evaluation_status: student.evaluation_status,
                        result_status: student.report_release_result_status,
                        // Same contact columns the results CSV already carries, so the
                        // table can answer "how do I reach this learner" on its own.
                        email: student.user_email ?? '',
                        mobile_number: student.phone_number ?? '',
                        username: student.username ?? '',
                    };
                } else if (selectedTab === 'Ongoing') {
                    return {
                        id: student.user_id,
                        registration_id: student.registration_id,
                        attempt_id: student.attempt_id,
                        full_name: student.student_name,
                        start_time: extractDateTime(convertToLocalDateTime(student.attempt_date))
                            .time,
                        email: student.user_email ?? '',
                        mobile_number: student.phone_number ?? '',
                        username: student.username ?? '',
                    };
                } else if (selectedTab === 'Pending') {
                    return {
                        id: student.user_id,
                        registration_id: student.registration_id,
                        attempt_id: student.attempt_id,
                        full_name: student.student_name,
                        package_session_id: getBatchNameById(
                            batches_for_sessions,
                            student.batch_id
                        ),
                        // The point of this tab is chasing people who haven't sat the
                        // test, so carry the same contact columns its CSV export does.
                        email: student.user_email ?? '',
                        mobile_number: student.phone_number ?? '',
                        username: student.username ?? '',
                    };
                }
                return {};
            });
        }

        case 'PRIVATE': {
            return studentsListData.map((student) => {
                if (selectedTab === 'Attempted') {
                    return {
                        id: student.user_id,
                        // Needed by Provide Reattempt (single and bulk), which resolves
                        // the participant by registration id. PUBLIC always mapped this;
                        // PRIVATE dropped it, so reattempt failed with "Could not resolve
                        // this participant's registration" on every private assessment.
                        registration_id: student.registration_id,
                        attempt_id: student.attempt_id,
                        full_name: student.student_name,
                        package_session_id: getBatchNameById(
                            batches_for_sessions,
                            student.batch_id
                        ),
                        // Real ids so Portal Access can resolve the learner's package
                        // for portal redirect / reset password. (package_session_id
                        // above is a display NAME, not a UUID.) package_id is the
                        // course/package id; all_package_session_ids the ps UUID(s).
                        package_id: getPackageIdByBatchId(batches_for_sessions, student.batch_id),
                        all_package_session_ids: student.batch_id ? [student.batch_id] : [],
                        attempt_date: extractDateTime(convertToLocalDateTime(student.attempt_date))
                            .date,
                        start_time: extractDateTime(convertToLocalDateTime(student.attempt_date))
                            .time,
                        end_time: extractDateTime(convertToLocalDateTime(student.end_time || ''))
                            .time,
                        duration: (student.duration / 60).toFixed(2) + ' min',
                        score: `${student.score ? student.score.toFixed(2) : 0} / ${totalMarks}`,
                        evaluation_status: student.evaluation_status,
                        result_status: student.report_release_result_status,
                        // Same contact columns the results CSV already carries, so the
                        // table can answer "how do I reach this learner" on its own.
                        email: student.user_email ?? '',
                        mobile_number: student.phone_number ?? '',
                        username: student.username ?? '',
                    };
                } else if (selectedTab === 'Ongoing') {
                    return {
                        id: student.user_id,
                        // See the Attempted branch above — reattempt resolves by
                        // registration id, so it must survive the mapping here too.
                        registration_id: student.registration_id,
                        attempt_id: student.attempt_id,
                        full_name: student.student_name,
                        start_time: extractDateTime(convertToLocalDateTime(student.attempt_date))
                            .time,
                        email: student.user_email ?? '',
                        mobile_number: student.phone_number ?? '',
                        username: student.username ?? '',
                    };
                } else if (selectedTab === 'Pending') {
                    return {
                        id: student.user_id,
                        // See the Attempted branch above — reattempt resolves by
                        // registration id, so it must survive the mapping here too.
                        registration_id: student.registration_id,
                        attempt_id: student.attempt_id,
                        full_name: student.student_name,
                        // PRIVATE dropped every column but the name, so this tab showed a
                        // bare list of names with no way to tell which batch a learner was
                        // in or how to reach them — the two things it exists for.
                        package_session_id: getBatchNameById(
                            batches_for_sessions,
                            student.batch_id
                        ),
                        email: student.user_email ?? '',
                        mobile_number: student.phone_number ?? '',
                        username: student.username ?? '',
                    };
                }
                return {};
            });
        }

        default:
            return [];
    }
};

export const getQuestionWiseFilteredDataStudentData = (
    studentsListData: StudentResponseQuestionwiseInterface[],
    assesssmentType: string,
    selectedTab: string,
    batches_for_sessions: BatchDetailsInterface[]
) => {
    switch (assesssmentType) {
        case 'PUBLIC': {
            return studentsListData.map((student) => {
                if (selectedTab === 'internal') {
                    return {
                        id: student.user_id,
                        full_name: student.participant_name,
                        package_session_id: getBatchNameById(
                            batches_for_sessions,
                            student.source_id
                        ),
                        registration_id: student.registration_id,
                        response_time_in_seconds: student.response_time_in_seconds + ' sec',
                    };
                }
                return {
                    id: student.user_id,
                    full_name: student.participant_name,
                    response_time_in_seconds: student.response_time_in_seconds + ' sec',
                };
            });
        }

        case 'PRIVATE': {
            return studentsListData.map((student) => {
                return {
                    id: student.user_id,
                    full_name: student.participant_name,
                    package_session_id: getBatchNameById(batches_for_sessions, student.source_id),
                    registration_id: student.registration_id,
                    response_time_in_seconds: student.response_time_in_seconds + ' sec',
                };
            });
        }

        default:
            return [];
    }
};

export const getAssessmentStep3ParticipantsListWithBatchName = (
    studentsListData: Step3ParticipantsListInterface[],
    batches_for_sessions: BatchDetailsInterface[]
) => {
    return studentsListData.map((student) => {
        return {
            id: student.user_id,
            full_name: student.full_name,
            package_session_id: getBatchNameById(batches_for_sessions, student.package_session_id),
            institute_enrollment_id: student.institute_enrollment_id,
            gender: student.gender,
            mobile_number: student.mobile_number,
            email: student.email,
            city: student.city,
            state: student.region,
        };
    });
};

export const getAssessmentStep3ParticipantsListIndividualStudents = (
    studentsListData: Step3ParticipantsListIndiviudalStudentInterface[]
) => {
    return studentsListData?.map((student) => {
        return {
            id: student.userId,
            full_name: student.participantName,
            mobile_number: student.phoneNumber,
            email: student.userEmail,
        };
    });
};

// For MANUAL evaluation assessments, splice the "Submission" file badge column
// into the Attempted columns, right before the evaluation/result status column.
const withSubmissionFileColumn = (columns: typeof assessmentStatusStudentAttemptedColumnsInternal) => {
    const statusIndex = columns.findIndex(
        (col) =>
            'accessorKey' in col &&
            (col.accessorKey === 'evaluation_status' || col.accessorKey === 'result_status')
    );
    const insertAt = statusIndex === -1 ? columns.length - 1 : statusIndex;
    return [
        ...columns.slice(0, insertAt),
        assessmentSubmissionFileColumn,
        ...columns.slice(insertAt),
    ];
};

export const getAllColumnsForTable = (
    type: string,
    selectedParticipantsTab: string,
    isManualEvaluation = false
) => {
    if (type === 'PUBLIC') {
        if (selectedParticipantsTab === 'internal')
            return {
                Attempted: isManualEvaluation
                    ? withSubmissionFileColumn(assessmentStatusStudentAttemptedColumnsInternal)
                    : assessmentStatusStudentAttemptedColumnsInternal,
                Pending: assessmentStatusStudentPendingColumnsInternal,
                Ongoing: assessmentStatusStudentOngoingColumnsInternal,
            };
        return {
            Attempted: isManualEvaluation
                ? withSubmissionFileColumn(assessmentStatusStudentAttemptedColumnsExternal)
                : assessmentStatusStudentAttemptedColumnsExternal,
            Pending: assessmentStatusStudentPendingColumnsExternal,
            Ongoing: assessmentStatusStudentOngoingColumnsExternal,
        };
    }
    if (selectedParticipantsTab === 'internal')
        return {
            Attempted: isManualEvaluation
                ? withSubmissionFileColumn(assessmentStatusStudentAttemptedColumnsInternal)
                : assessmentStatusStudentAttemptedColumnsInternal,
            Pending: assessmentStatusStudentPendingColumnsInternal,
            Ongoing: assessmentStatusStudentOngoingColumnsInternal,
        };
    return {
        Attempted: isManualEvaluation
            ? withSubmissionFileColumn(assessmentStatusStudentAttemptedColumnsExternal)
            : assessmentStatusStudentAttemptedColumnsExternal,
        Pending: assessmentStatusStudentPendingColumnsExternal,
        Ongoing: assessmentStatusStudentOngoingColumnsExternal,
    };
};

// Width for the manual-evaluation "Submission" column ("Not Submitted" chip + Upload button).
const SUBMISSION_FILE_COLUMN_WIDTH = { submission_file: 'min-w-[240px]' };

export const getAllColumnsForTableWidth = (
    type: string,
    selectedParticipantsTab: string,
    isManualEvaluation = false
) => {
    const submissionWidth = isManualEvaluation ? SUBMISSION_FILE_COLUMN_WIDTH : {};
    if (type === 'PUBLIC') {
        if (selectedParticipantsTab === 'internal')
            return {
                Attempted: {
                    ...ASSESSMENT_STATUS_STUDENT_ATTEMPTED_COLUMNS_INTERNAL_WIDTH,
                    ...submissionWidth,
                },
                Ongoing: ASSESSMENT_STATUS_STUDENT_ONGOING_COLUMNS_INTERNAL_WIDTH,
                Pending: ASSESSMENT_STATUS_STUDENT_PENDING_COLUMNS_INTERNAL_WIDTH,
            };
        return {
            Attempted: {
                ...ASSESSMENT_STATUS_STUDENT_ATTEMPTED_COLUMNS_EXTERNAL_WIDTH,
                ...submissionWidth,
            },
            Ongoing: ASSESSMENT_STATUS_STUDENT_ONGOING_COLUMNS_EXTERNAL_WIDTH,
            Pending: ASSESSMENT_STATUS_STUDENT_PENDING_COLUMNS_EXTERNAL_WIDTH,
        };
    }
    if (selectedParticipantsTab === 'internal')
        return {
            Attempted: {
                ...ASSESSMENT_STATUS_STUDENT_ATTEMPTED_COLUMNS_INTERNAL_WIDTH,
                ...submissionWidth,
            },
            Ongoing: ASSESSMENT_STATUS_STUDENT_ONGOING_COLUMNS_INTERNAL_WIDTH,
            Pending: ASSESSMENT_STATUS_STUDENT_PENDING_COLUMNS_INTERNAL_WIDTH,
        };
    return {
        Attempted: {
            ...ASSESSMENT_STATUS_STUDENT_ATTEMPTED_COLUMNS_EXTERNAL_WIDTH,
            ...submissionWidth,
        },
        Ongoing: ASSESSMENT_STATUS_STUDENT_ONGOING_COLUMNS_EXTERNAL_WIDTH,
        Pending: ASSESSMENT_STATUS_STUDENT_PENDING_COLUMNS_EXTERNAL_WIDTH,
    };
};

export const getAllColumnsForTableQuestionWise = (
    assesssmentType: string,
    selectedParticipantsTab: string
) => {
    if (assesssmentType === 'PUBLIC') {
        if (selectedParticipantsTab === 'internal')
            return {
                studentInternalOrCloseQuestionWise,
            };
        return {
            studentExternalQuestionWise,
        };
    }
    return {
        studentInternalOrCloseQuestionWise,
    };
};

export const getAllColumnsForTableWidthQuestionWise = (
    assesssmentType: string,
    selectedParticipantsTab: string
) => {
    if (assesssmentType === 'PUBLIC') {
        if (selectedParticipantsTab === 'internal')
            return {
                QUESTION_WISE_COLUMNS_INTERNAL_OR_CLOSE_WIDTH,
            };
        return {
            QUESTION_WISE_COLUMNS_EXTERNAL_WIDTH,
        };
    }
    return {
        QUESTION_WISE_COLUMNS_INTERNAL_OR_CLOSE_WIDTH,
    };
};

export function getBatchDetails(
    batchData: Record<string, { name: string; id: string }[]>,
    batchList: PreBatchRegistration[] | undefined
) {
    const result: {
        id: string;
        name: string | undefined;
    }[] = [];

    // Flatten batchData into a single array of objects
    const allBatches = Object.values(batchData).flat();

    // Create a lookup map for quick access
    const batchMap = new Map(allBatches.map((batch) => [batch.id, batch.name]));

    // Filter and map the batchList based on batchId
    batchList?.forEach(({ batchId }) => {
        if (batchMap.has(batchId)) {
            result.push({ id: batchId, name: batchMap.get(batchId) });
        }
    });

    return result;
}

export function calculateAverageMarks(questions: calculateAverageMarksQuestionInterface[]): number {
    if (questions.length === 0) return 0;

    const totalMarks = questions.reduce(
        (sum, question) => sum + parseFloat(question.questionMark),
        0
    );
    return parseFloat((totalMarks / questions.length).toFixed(2));
}

export function calculateAveragePenalty(questions: AdaptiveMarking[]): number {
    if (questions.length === 0) return 0;

    const totalPenalty = questions.reduce(
        (sum, question) => sum + parseFloat(question.questionPenalty),
        0
    );
    return parseFloat((totalPenalty / questions.length).toFixed(2));
}

export function parseHtmlToString(html: string) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    return doc.body.textContent || doc.body.innerText || '';
}

export function transformSectionsAndQuestionsData(
    sectionsData: Section[],
    questionsData: transformSectionsAndQuestionsDataQuestionsData
) {
    if (!sectionsData) return [];
    return sectionsData.map((section) => ({
        sectionId: section.id,
        sectionName: section.name,
        questions: (questionsData[section.id] || []).map((question) => {
            const markingJson = question.marking_json
                ? JSON.parse(question.marking_json)
                : { type: 'MCQS', data: {} };

            const evaluationJson = question.evaluation_json
                ? JSON.parse(question.evaluation_json)
                : { type: 'MCQM', data: { correctOptionIds: [] } };

            const correctOptionIds = evaluationJson.data.correctOptionIds || [];

            const validAnswers = JSON.parse(question.evaluation_json)?.data?.validAnswers || [];
            let decimals;
            let numericType;
            let subjectiveAnswerText;
            if (question.options_json) {
                decimals = JSON.parse(question.options_json)?.decimals || 0;
                numericType = JSON.parse(question.options_json)?.numeric_type || '';
            }
            if (question.evaluation_json) {
                if (question.question_type === 'ONE_WORD') {
                    subjectiveAnswerText = JSON.parse(question.evaluation_json)?.data?.answer;
                } else if (question.question_type === 'LONG_ANSWER') {
                    subjectiveAnswerText = JSON.parse(question.evaluation_json)?.data?.answer
                        ?.content;
                }
            }

            const baseQuestion = {
                id: question.question_id,
                questionId: question.question_id,
                questionName: question.question.content,
                explanation: '',
                questionType: markingJson.type || 'MCQS',
                questionMark: markingJson.data.totalMark,
                questionPenalty: markingJson.data.negativeMark,
                questionDuration: {
                    hrs: String(Math.floor(question.question_duration / 60)),
                    min: String(question.question_duration % 60),
                },
                singleChoiceOptions: Array(4).fill({
                    id: '',
                    name: '',
                    isSelected: false,
                }),
                multipleChoiceOptions: Array(4).fill({
                    id: '',
                    name: '',
                    isSelected: false,
                }),
                csingleChoiceOptions: Array(4).fill({
                    id: '',
                    name: '',
                    isSelected: false,
                }),
                cmultipleChoiceOptions: Array(4).fill({
                    id: '',
                    name: '',
                    isSelected: false,
                }),
                trueFalseOptions: Array(2).fill({
                    id: '',
                    name: '',
                    isSelected: false,
                }),
                validAnswers: [],
                decimals,
                numericType,
                parentRichTextContent: question.parent_rich_text?.content || null,
                subjectiveAnswerText,
            };
            if (markingJson.type === 'MCQS') {
                baseQuestion.singleChoiceOptions = question.options_with_explanation.map(
                    (option) => ({
                        id: option.id ? option.id : '',
                        name: option.text?.content || '',
                        isSelected: correctOptionIds.includes(option.id || option.preview_id),
                    })
                );
            } else if (markingJson.type === 'MCQM') {
                baseQuestion.multipleChoiceOptions = question.options_with_explanation.map(
                    (option) => ({
                        id: option.id ? option.id : '',
                        name: option.text?.content || '',
                        isSelected: correctOptionIds.includes(option.id || option.preview_id),
                    })
                );
            } else if (markingJson.type === 'CMCQS') {
                baseQuestion.csingleChoiceOptions = question.options_with_explanation.map(
                    (option) => ({
                        id: option.id ? option.id : '',
                        name: option.text?.content || '',
                        isSelected: correctOptionIds.includes(option.id || option.preview_id),
                    })
                );
            } else if (markingJson.type === 'CMCQM') {
                baseQuestion.cmultipleChoiceOptions = question.options_with_explanation.map(
                    (option) => ({
                        id: option.id ? option.id : '',
                        name: option.text?.content || '',
                        isSelected: correctOptionIds.includes(option.id || option.preview_id),
                    })
                );
            } else if (markingJson.type === 'TRUE_FALSE') {
                baseQuestion.trueFalseOptions = question.options_with_explanation.map((option) => ({
                    id: option.id ? option.id : '',
                    name: option.text?.content || '',
                    isSelected: correctOptionIds.includes(option.id || option.preview_id),
                }));
            } else if (markingJson.type === 'NUMERIC') {
                baseQuestion.validAnswers = validAnswers;
            }
            return baseQuestion;
        }),
    }));
}

export function transformSectionQuestions(questions: AssessmentSectionQuestionInterface[]) {
    return {
        questions: questions?.map((question) => {
            const options =
                question.questionType === 'MCQS'
                    ? question?.singleChoiceOptions?.map((opt, idx) => ({
                          id: null, // Assuming no direct mapping for option ID
                          preview_id: idx, // Using index as preview_id
                          question_id: null,
                          text: {
                              id: null, // Assuming no direct mapping for option text ID
                              type: 'HTML', // Assuming option content is HTML
                              content: opt?.name,
                          },
                          media_id: String(opt?.image?.imageName), // Assuming no direct mapping for option media ID
                          option_order: null,
                          created_on: null,
                          updated_on: null,
                          explanation_text: {
                              id: null, // Assuming no direct mapping for explanation text ID
                              type: 'HTML', // Assuming explanation for options is in HTML
                              content: question.explanation, // Assuming no explanation provided for options
                          },
                      }))
                    : question?.multipleChoiceOptions?.map((opt, idx) => ({
                          id: null, // Assuming no direct mapping for option ID
                          preview_id: idx, // Using index as preview_id
                          question_id: null,
                          text: {
                              id: null, // Assuming no direct mapping for option text ID
                              type: 'HTML', // Assuming option content is HTML
                              content: opt?.name,
                          },
                          media_id: String(opt?.image?.imageName), // Assuming no direct mapping for option media ID
                          option_order: null,
                          created_on: null,
                          updated_on: null,
                          explanation_text: {
                              id: null, // Assuming no direct mapping for explanation text ID
                              type: 'HTML', // Assuming explanation for options is in HTML
                              content: question.explanation, // Assuming no explanation provided for options
                          },
                      }));

            const correctOptionIds = (
                question.questionType === 'MCQS'
                    ? question.singleChoiceOptions ?? [] // Default to empty array if undefined
                    : question.multipleChoiceOptions ?? []
            )
                .map((opt, idx) => (opt.isSelected ? idx.toString() : null))
                .filter((idx) => idx !== null); // Remove null values

            const auto_evaluation_json = JSON.stringify({
                type: question.questionType === 'MCQS' ? 'MCQS' : 'MCQM',
                data: {
                    correctOptionIds,
                },
            });

            return {
                id: null,
                preview_id: question.questionId, // Assuming no direct mapping for preview_id
                text: {
                    id: null, // Assuming no direct mapping for text ID
                    type: 'HTML', // Assuming the content is HTML
                    content: question?.questionName,
                },
                media_id: String(question?.imageDetails?.map((img) => img.imageName).join(',')), // Assuming no direct mapping for media_id
                created_at: null,
                updated_at: null,
                question_response_type: null, // Assuming no direct mapping for response type
                question_type: question.questionType,
                access_level: null, // Assuming no direct mapping for access level
                auto_evaluation_json, // Add auto_evaluation_json
                evaluation_type: null, // Assuming no direct mapping for evaluation type
                explanation_text: {
                    id: null, // Assuming no direct mapping for explanation text ID
                    type: 'HTML', // Assuming explanation is in HTML
                    content: question.explanation,
                },
                default_question_time_mins:
                    Number(question.questionDuration.hrs || 0) * 60 +
                    Number(question.questionDuration.min || 0),
                options, // Use the mapped options
                errors: [], // Assuming no errors are provided
                warnings: [], // Assuming no warnings are provided
            };
        }),
    };
}

export function extractEmptyIdQuestions(sections: sectionsEditQuestionFormType) {
    return sections.sections.flatMap((section) =>
        section.questions.filter((question) => question.questionId === '')
    );
}

export function getSectionsWithEmptyQuestionIds(sections: sectionsEditQuestionFormType) {
    return sections.sections
        .map((section) => {
            // Filter questions where questionId is an empty string
            const filteredQuestions = section.questions.filter(
                (question) => question.questionId === ''
            );

            // Return the section only if it has questions with empty questionIds
            return filteredQuestions.length > 0
                ? { ...section, questions: filteredQuestions.length }
                : null;
        })
        .filter((section) => section !== null); // Remove null values
}

export function handleAddedQuestionsToSections(
    sections: SectionInfoWithAddedQuestionsCntOrNull[],
    questionsData: MyQuestion[]
) {
    let questionIndex = 0;

    return sections.map((section) => {
        const questionsCount = section?.questions ?? 0;
        const assignedQuestions = questionsData.slice(
            questionIndex,
            questionIndex + questionsCount
        );
        questionIndex += questionsCount;

        return {
            ...section,
            assignedQuestions,
        };
    });
}

export function addQuestionIdToSections(
    previousSections: sectionsEditQuestionFormType['sections'],
    newSections: SectionInfoWithAddedQuestions[]
) {
    // Iterate over each section in newSections
    newSections.forEach((newSection) => {
        // Find the corresponding section in previousSections by matching sectionId
        const prevSection = previousSections.find(
            (section) => section.sectionId === newSection.sectionId
        );

        if (prevSection) {
            // Update the sectionName if it exists in newSections
            prevSection.sectionName = newSection.sectionName;

            // Remove questions without questionId from previousSection
            prevSection.questions = prevSection.questions.filter((question) => question.questionId);

            // Add all assignedQuestions from newSection to previousSection
            newSection.assignedQuestions.forEach((question) => {
                // Add an 'id' field in each question, matching the questionId
                question.id = question.questionId || '';
            });

            // Append the updated questions to the previous section
            prevSection.questions.push(...newSection.assignedQuestions);
        }
    });

    return previousSections;
}

export function transformPreviewDataToSections(sections: Section[] | undefined) {
    return {
        updated_sections: sections?.map((section) => ({
            section_description_html: section.description || '',
            section_name: section.name,
            section_id: section.id,
            section_duration: section.duration || 0,
            section_order: section.section_order,
            total_marks: section.total_marks,
            cutoff_marks: section.cutoff_marks,
            problem_randomization: section.problem_randomization !== null ? true : false,
            question_and_marking: [],
        })),
    };
}

export function mergeSectionData(
    sourceData: sectionsEditQuestionFormType['sections'],
    targetData: AssessmentSection[] | undefined
) {
    // Create a map of sections from source data for easier lookup
    const sectionQuestionsMap = new Map(
        sourceData.map((section) => [
            section.sectionId,
            section.questions.map((question, index) => {
                // Transform question format to match target structure
                const correctOptionIdsCnt = question.multipleChoiceOptions?.filter(
                    (option) => option.isSelected
                ).length;
                return {
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
                                partialMarking: correctOptionIdsCnt ? 1 / correctOptionIdsCnt : 0,
                                partialMarkingPercentage: correctOptionIdsCnt
                                    ? (1 / correctOptionIdsCnt) * 100
                                    : 0,
                            }),
                        },
                    }),
                    question_duration_in_min:
                        parseInt(question.questionDuration.hrs) * 60 +
                            parseInt(question.questionDuration.min) || 0,
                    question_order: index + 1,
                    is_added: true,
                    is_deleted: false,
                    is_updated: false,
                };
            }),
        ])
    );

    // Update target data with questions from source
    return targetData?.map((section) => {
        const questions = sectionQuestionsMap.get(section.section_id) || [];
        return {
            ...section,
            question_and_marking: questions,
        };
    });
}

export function compareAndUpdateSections(
    oldSections: sectionsEditQuestionFormType['sections'] | undefined,
    newSections: AssessmentSection[] | undefined
) {
    // Create maps to track questions by section
    const oldSectionQuestionMap = new Map();

    // Process old sections to build question map for each section
    oldSections?.forEach((oldSection) => {
        const sectionQuestions = new Map();
        oldSection.questions.forEach((question) => {
            sectionQuestions.set(question.questionId, question);
        });
        oldSectionQuestionMap.set(oldSection.sectionId, sectionQuestions);
    });

    // Process new sections and update status flags
    const processedSections = newSections?.map((newSection) => {
        const oldSectionQuestions = oldSectionQuestionMap.get(newSection.section_id) || new Map();

        // Process existing and new questions
        const processedQuestionAndMarking = newSection.question_and_marking.map((newQuestion) => {
            let status = {
                is_added: true,
                is_updated: false,
                is_deleted: false,
            };

            // Check if question exists in this specific section
            if (oldSectionQuestions.has(newQuestion.question_id)) {
                status = {
                    is_added: false,
                    is_updated: true,
                    is_deleted: false,
                };
                // Remove from map to track deleted questions
                oldSectionQuestions.delete(newQuestion.question_id);
            }

            return {
                ...newQuestion,
                ...status,
            };
        });

        return {
            ...newSection,
            question_and_marking: [...processedQuestionAndMarking],
        };
    });

    return processedSections;
}

// Resolve the real package (course) id for a batch/package-session id from the
// same batches_for_sessions list used to render batch names. Used to give
// submission rows a valid package_id for Portal Access (portal redirect /
// reset password), instead of relying on the institute store being hydrated.
export function getPackageIdByBatchId(data: BatchDetailsInterface[] | undefined, id: string) {
    return data?.find((obj) => obj.id === id)?.package_dto?.id || '';
}

export function getBatchNameById(data: BatchDetailsInterface[] | undefined, id: string) {
    const item = data?.find((obj) => obj.id === id);
    if (item && item.level && item.package_dto) {
        if (item.level.id === 'DEFAULT') {
            return item.package_dto.package_name.replace(/^default\s+/i, '').trim();
        }
        const levelName = item.level.level_name.replace(/^default\s+/i, '');
        const packageName = item.package_dto.package_name.replace(/^default\s+/i, '');
        return `${levelName} ${packageName}`.trim();
    }
    return '';
}

export function getBatchNamesByIds(
    data: BatchDetailsInterface[] | undefined,
    ids: string[]
): string[] {
    if (!data || !ids) return [];

    return ids
        .map((id) => {
            const item = data.find((obj) => obj.id === id);
            if (item && item.level && item.package_dto) {
                if (item.level.id === 'DEFAULT') {
                    return item.package_dto.package_name.replace(/^default\s+/i, '').trim();
                }
                const levelName = item.level.level_name.replace(/^default\s+/i, '');
                const packageName = item.package_dto.package_name.replace(/^default\s+/i, '');
                return `${levelName} ${packageName}`.trim();
            }
            return null;
        })
        .filter((name): name is string => name !== null);
}

export function calculatePercentiles(students: StudentLeaderboard[]) {
    const totalStudents = students.length;

    return students.map((student) => {
        const percentile = ((totalStudents - student.rank) / (totalStudents - 1)) * 100;
        return { ...student, percentile: percentile.toFixed(2) }; // Keeping two decimal places
    });
}

export function calculateIndividualPercentile(studentData: StudentLeaderboard[], user_id: string) {
    // Find the student with the given user_id
    const student = studentData.find((s) => s.user_id === user_id);

    // Return the percentile if found, otherwise return null or a default value
    return student ? student.percentile : '';
}

export const transformQuestionInsightsQuestionsData = (data: QuestionInsightDTO[]) => {
    return data.map((item) => {
        const correctOptionIds =
            JSON.parse(item.assessment_question_preview_dto.evaluation_json)?.data
                ?.correctOptionIds || [];
        const totalMark =
            JSON.parse(item.assessment_question_preview_dto.marking_json)?.data?.totalMark || '';

        const validAnswers =
            JSON.parse(item.assessment_question_preview_dto.evaluation_json)?.data?.validAnswers ||
            [];
        let decimals;
        let numericType;
        let subjectiveAnswerText;
        if (item.assessment_question_preview_dto.options_json) {
            decimals = JSON.parse(item.assessment_question_preview_dto.options_json)?.decimals || 0;
            numericType =
                JSON.parse(item.assessment_question_preview_dto.options_json)?.numeric_type || '';
        }
        if (item.assessment_question_preview_dto.evaluation_json) {
            if (item.assessment_question_preview_dto.question_type === 'ONE_WORD') {
                subjectiveAnswerText = JSON.parse(
                    item.assessment_question_preview_dto.evaluation_json
                )?.data?.answer;
            } else if (item.assessment_question_preview_dto.question_type === 'LONG_ANSWER') {
                subjectiveAnswerText = JSON.parse(
                    item.assessment_question_preview_dto.evaluation_json
                )?.data?.answer?.content;
            }
        }
        const baseQuestion: MyQuestion = {
            id: item.assessment_question_preview_dto.question_id || '',
            questionId: item.assessment_question_preview_dto.question_id || undefined,
            questionName: item.assessment_question_preview_dto.question?.content || '',
            explanation: '',
            questionType: item.assessment_question_preview_dto.question_type || '',
            questionPenalty: '',
            questionDuration: {
                hrs: String(
                    Math.floor((item.assessment_question_preview_dto.question_duration ?? 0) / 60)
                ),
                min: String((item.assessment_question_preview_dto.question_duration ?? 0) % 60),
            },
            questionMark: totalMark,
            singleChoiceOptions: Array(4).fill({
                id: '',
                name: '',
                isSelected: false,
            }),
            multipleChoiceOptions: Array(4).fill({
                id: '',
                name: '',
                isSelected: false,
            }),
            csingleChoiceOptions: Array(4).fill({
                id: '',
                name: '',
                isSelected: false,
            }),
            cmultipleChoiceOptions: Array(4).fill({
                id: '',
                name: '',
                isSelected: false,
            }),
            trueFalseOptions: Array(2).fill({
                id: '',
                name: '',
                isSelected: false,
            }),
            validAnswers: [],
            decimals,
            numericType,
            parentRichTextContent:
                item.assessment_question_preview_dto.parent_rich_text?.content || null,
            subjectiveAnswerText,
        };

        if (item.assessment_question_preview_dto.question_type === 'MCQS') {
            baseQuestion.singleChoiceOptions =
                item.assessment_question_preview_dto.options_with_explanation.map((option) => ({
                    name: option.text?.content || '',
                    isSelected: correctOptionIds.includes(option.id || option.preview_id),
                    image: {},
                }));
        } else if (item.assessment_question_preview_dto.question_type === 'MCQM') {
            baseQuestion.multipleChoiceOptions =
                item.assessment_question_preview_dto.options_with_explanation.map((option) => ({
                    name: option.text?.content || '',
                    isSelected: correctOptionIds.includes(option.id || option.preview_id),
                    image: {},
                }));
        } else if (item.assessment_question_preview_dto.question_type === 'CMCQS') {
            baseQuestion.csingleChoiceOptions =
                item.assessment_question_preview_dto.options_with_explanation.map((option) => ({
                    id: option.id ? option.id : '',
                    name: option.text?.content || '',
                    isSelected: correctOptionIds.includes(option.id || option.preview_id),
                }));
        } else if (item.assessment_question_preview_dto.question_type === 'CMCQM') {
            baseQuestion.cmultipleChoiceOptions =
                item.assessment_question_preview_dto.options_with_explanation.map((option) => ({
                    id: option.id ? option.id : '',
                    name: option.text?.content || '',
                    isSelected: correctOptionIds.includes(option.id || option.preview_id),
                }));
        } else if (item.assessment_question_preview_dto.question_type === 'TRUE_FALSE') {
            baseQuestion.trueFalseOptions =
                item.assessment_question_preview_dto.options_with_explanation.map((option) => ({
                    id: option.id ? option.id : '',
                    name: option.text?.content || '',
                    isSelected: correctOptionIds.includes(option.id || option.preview_id),
                }));
        } else if (item.assessment_question_preview_dto.question_type === 'NUMERIC') {
            baseQuestion.validAnswers = validAnswers;
        }
        return {
            assessment_question_preview_dto: baseQuestion,
            question_status: item.question_status,
            skipped: item.skipped,
            top3_correct_response_dto: item.top3_correct_response_dto,
            total_attempts: item.total_attempts,
        };
    });
};

export function getCorrectOptionsForQuestion(question: MyQuestion) {
    if (question.questionType === 'MCQS') {
        return question.singleChoiceOptions
            .filter((option) => option.isSelected)
            .map((option, index) => ({
                optionType: String.fromCharCode(97 + index),
                optionName: option.name,
            }));
    } else if (question.questionType === 'MCQM') {
        return question.multipleChoiceOptions
            .filter((option) => option.isSelected)
            .map((option, index) => ({
                optionType: String.fromCharCode(97 + index),
                optionName: option.name,
            }));
    } else if (question.questionType === 'LONG_ANSWER' || question.questionType === 'ONE_WORD') {
        return [
            {
                optionType: '',
                optionName: question.subjectiveAnswerText,
            },
        ];
    } else if (question.questionType === 'TRUE_FALSE') {
        return question.trueFalseOptions
            .filter((option) => option.isSelected)
            .map((option) => ({
                optionType: '',
                optionName: option.name,
            }));
    } else if (question.questionType === 'NUMERIC') {
        return question.validAnswers?.map((ans: number) => ({
            optionType: '',
            optionName: ans,
        }));
    }
    return [];
}

export function transformQuestionsDataToRevaluateAPI(data: { [sectionId: string]: string[] }) {
    return Object.entries(data).map(([section_id, question_ids]) => ({
        section_id,
        question_ids,
    }));
}
