import type { TFunction } from 'i18next';

export interface ToolInstructionsType {
    stepHeading: string;
    steps: string[];
    stepSubHeading?: string;
    stepFooter?: string;
}

export interface ToolDataType {
    key: string;
    heading: string;
    instructionsHeading: string;
    instructionsSubHeading?: string;
    instructions: ToolInstructionsType[];
}

export interface AIToolPageDataType {
    [key: string]: ToolDataType;
}

/**
 * Builds the AI tool page copy (headings + step-by-step instructions) shown on
 * each ai-center tool page. Module-scope data needs the translation function
 * passed in explicitly, so this is a factory rather than a plain constant —
 * call it from a component with `t` from `useTranslation('aiCenterAIToolPageData')`.
 */
export const buildAIToolPageData = (t: TFunction): AIToolPageDataType => ({
    assessment: {
        key: 'assessment',
        heading: t('aiCenterAIToolPageData:tools.assessment.heading'),
        instructionsHeading: t('aiCenterAIToolPageData:tools.assessment.instructionsHeading'),
        instructions: [
            {
                stepHeading: t('aiCenterAIToolPageData:tools.assessment.instructions.0.stepHeading'),
                steps: [
                    t('aiCenterAIToolPageData:tools.assessment.instructions.0.steps.0'),
                    t('aiCenterAIToolPageData:tools.assessment.instructions.0.steps.1'),
                ],
            },
            {
                stepHeading: t('aiCenterAIToolPageData:tools.assessment.instructions.1.stepHeading'),
                steps: [
                    t('aiCenterAIToolPageData:tools.assessment.instructions.1.steps.0'),
                    t('aiCenterAIToolPageData:tools.assessment.instructions.1.steps.1'),
                ],
            },
            {
                stepHeading: t('aiCenterAIToolPageData:tools.assessment.instructions.2.stepHeading'),
                stepSubHeading: t(
                    'aiCenterAIToolPageData:tools.assessment.instructions.2.stepSubHeading'
                ),
                steps: [t('aiCenterAIToolPageData:tools.assessment.instructions.2.steps.0')],
            },
            {
                stepHeading: t('aiCenterAIToolPageData:tools.assessment.instructions.3.stepHeading'),
                steps: [
                    t('aiCenterAIToolPageData:tools.assessment.instructions.3.steps.0'),
                    t('aiCenterAIToolPageData:tools.assessment.instructions.3.steps.1'),
                ],
            },
            {
                stepHeading: t('aiCenterAIToolPageData:tools.assessment.instructions.4.stepHeading'),
                steps: [
                    t('aiCenterAIToolPageData:tools.assessment.instructions.4.steps.0'),
                    t('aiCenterAIToolPageData:tools.assessment.instructions.4.steps.1'),
                ],
            },
            {
                stepHeading: t('aiCenterAIToolPageData:tools.assessment.instructions.5.stepHeading'),
                steps: [
                    t('aiCenterAIToolPageData:tools.assessment.instructions.5.steps.0'),
                    t('aiCenterAIToolPageData:tools.assessment.instructions.5.steps.1'),
                ],
            },
        ],
    },
    audio: {
        key: 'audio',
        heading: t('aiCenterAIToolPageData:tools.audio.heading'),
        instructionsHeading: t('aiCenterAIToolPageData:tools.audio.instructionsHeading'),
        instructions: [
            {
                stepHeading: t('aiCenterAIToolPageData:tools.audio.instructions.0.stepHeading'),
                steps: [
                    t('aiCenterAIToolPageData:tools.audio.instructions.0.steps.0'),
                    t('aiCenterAIToolPageData:tools.audio.instructions.0.steps.1'),
                ],
            },
            {
                stepHeading: t('aiCenterAIToolPageData:tools.audio.instructions.1.stepHeading'),
                stepSubHeading: t('aiCenterAIToolPageData:tools.audio.instructions.1.stepSubHeading'),
                steps: [
                    t('aiCenterAIToolPageData:tools.audio.instructions.1.steps.0'),
                    t('aiCenterAIToolPageData:tools.audio.instructions.1.steps.1'),
                    t('aiCenterAIToolPageData:tools.audio.instructions.1.steps.2'),
                    t('aiCenterAIToolPageData:tools.audio.instructions.1.steps.3'),
                    t('aiCenterAIToolPageData:tools.audio.instructions.1.steps.4'),
                ],
            },
            {
                stepHeading: t('aiCenterAIToolPageData:tools.audio.instructions.2.stepHeading'),
                steps: [
                    t('aiCenterAIToolPageData:tools.audio.instructions.2.steps.0'),
                    t('aiCenterAIToolPageData:tools.audio.instructions.2.steps.1'),
                ],
            },
            {
                stepHeading: t('aiCenterAIToolPageData:tools.audio.instructions.3.stepHeading'),
                steps: [
                    t('aiCenterAIToolPageData:tools.audio.instructions.3.steps.0'),
                    t('aiCenterAIToolPageData:tools.audio.instructions.3.steps.1'),
                ],
            },
            {
                stepHeading: t('aiCenterAIToolPageData:tools.audio.instructions.4.stepHeading'),
                steps: [
                    t('aiCenterAIToolPageData:tools.audio.instructions.4.steps.0'),
                    t('aiCenterAIToolPageData:tools.audio.instructions.4.steps.1'),
                ],
            },
        ],
    },
    text: {
        key: 'text',
        heading: t('aiCenterAIToolPageData:tools.text.heading'),
        instructionsHeading: t('aiCenterAIToolPageData:tools.text.instructionsHeading'),
        instructions: [
            {
                stepHeading: t('aiCenterAIToolPageData:tools.text.instructions.0.stepHeading'),
                steps: [t('aiCenterAIToolPageData:tools.text.instructions.0.steps.0')],
            },
            {
                stepHeading: t('aiCenterAIToolPageData:tools.text.instructions.1.stepHeading'),
                steps: [
                    t('aiCenterAIToolPageData:tools.text.instructions.1.steps.0'),
                    t('aiCenterAIToolPageData:tools.text.instructions.1.steps.1'),
                ],
            },
            {
                stepHeading: t('aiCenterAIToolPageData:tools.text.instructions.2.stepHeading'),
                stepSubHeading: t('aiCenterAIToolPageData:tools.text.instructions.2.stepSubHeading'),
                steps: [
                    t('aiCenterAIToolPageData:tools.text.instructions.2.steps.0'),
                    t('aiCenterAIToolPageData:tools.text.instructions.2.steps.1'),
                    t('aiCenterAIToolPageData:tools.text.instructions.2.steps.2'),
                    t('aiCenterAIToolPageData:tools.text.instructions.2.steps.3'),
                    t('aiCenterAIToolPageData:tools.text.instructions.2.steps.4'),
                ],
            },
            {
                stepHeading: t('aiCenterAIToolPageData:tools.text.instructions.3.stepHeading'),
                steps: [
                    t('aiCenterAIToolPageData:tools.text.instructions.3.steps.0'),
                    t('aiCenterAIToolPageData:tools.text.instructions.3.steps.1'),
                ],
            },
            {
                stepHeading: t('aiCenterAIToolPageData:tools.text.instructions.4.stepHeading'),
                steps: [
                    t('aiCenterAIToolPageData:tools.text.instructions.4.steps.0'),
                    t('aiCenterAIToolPageData:tools.text.instructions.4.steps.1'),
                ],
            },
            {
                stepHeading: t('aiCenterAIToolPageData:tools.text.instructions.5.stepHeading'),
                steps: [
                    t('aiCenterAIToolPageData:tools.text.instructions.5.steps.0'),
                    t('aiCenterAIToolPageData:tools.text.instructions.5.steps.1'),
                ],
            },
        ],
    },
    chat: {
        key: 'chat',
        heading: t('aiCenterAIToolPageData:tools.chat.heading'),
        instructionsHeading: t('aiCenterAIToolPageData:tools.chat.instructionsHeading'),
        instructionsSubHeading: t('aiCenterAIToolPageData:tools.chat.instructionsSubHeading'),
        instructions: [
            {
                stepHeading: t('aiCenterAIToolPageData:tools.chat.instructions.0.stepHeading'),
                steps: [
                    t('aiCenterAIToolPageData:tools.chat.instructions.0.steps.0'),
                    t('aiCenterAIToolPageData:tools.chat.instructions.0.steps.1'),
                ],
            },
            {
                stepHeading: t('aiCenterAIToolPageData:tools.chat.instructions.1.stepHeading'),
                steps: [t('aiCenterAIToolPageData:tools.chat.instructions.1.steps.0')],
            },
            {
                stepHeading: t('aiCenterAIToolPageData:tools.chat.instructions.2.stepHeading'),
                steps: [
                    t('aiCenterAIToolPageData:tools.chat.instructions.2.steps.0'),
                    t('aiCenterAIToolPageData:tools.chat.instructions.2.steps.1'),
                    t('aiCenterAIToolPageData:tools.chat.instructions.2.steps.2'),
                    t('aiCenterAIToolPageData:tools.chat.instructions.2.steps.3'),
                    t('aiCenterAIToolPageData:tools.chat.instructions.2.steps.4'),
                    t('aiCenterAIToolPageData:tools.chat.instructions.2.steps.5'),
                ],
                stepFooter: t('aiCenterAIToolPageData:tools.chat.instructions.2.stepFooter'),
            },
            {
                stepHeading: t('aiCenterAIToolPageData:tools.chat.instructions.3.stepHeading'),
                steps: [
                    t('aiCenterAIToolPageData:tools.chat.instructions.3.steps.0'),
                    t('aiCenterAIToolPageData:tools.chat.instructions.3.steps.1'),
                ],
            },
        ],
    },
    question: {
        key: 'question',
        heading: t('aiCenterAIToolPageData:tools.question.heading'),
        instructionsHeading: t('aiCenterAIToolPageData:tools.question.instructionsHeading'),
        instructionsSubHeading: t('aiCenterAIToolPageData:tools.question.instructionsSubHeading'),
        instructions: [
            {
                stepHeading: t('aiCenterAIToolPageData:tools.question.instructions.0.stepHeading'),
                steps: [
                    t('aiCenterAIToolPageData:tools.question.instructions.0.steps.0'),
                    t('aiCenterAIToolPageData:tools.question.instructions.0.steps.1'),
                ],
            },
            {
                stepHeading: t('aiCenterAIToolPageData:tools.question.instructions.1.stepHeading'),
                steps: [t('aiCenterAIToolPageData:tools.question.instructions.1.steps.0')],
            },
            {
                stepHeading: t('aiCenterAIToolPageData:tools.question.instructions.2.stepHeading'),
                steps: [
                    t('aiCenterAIToolPageData:tools.question.instructions.2.steps.0'),
                    t('aiCenterAIToolPageData:tools.question.instructions.2.steps.1'),
                ],
            },
            {
                stepHeading: t('aiCenterAIToolPageData:tools.question.instructions.3.stepHeading'),
                steps: [
                    t('aiCenterAIToolPageData:tools.question.instructions.3.steps.0'),
                    t('aiCenterAIToolPageData:tools.question.instructions.3.steps.1'),
                ],
            },
            {
                stepHeading: t('aiCenterAIToolPageData:tools.question.instructions.4.stepHeading'),
                steps: [
                    t('aiCenterAIToolPageData:tools.question.instructions.4.steps.0'),
                    t('aiCenterAIToolPageData:tools.question.instructions.4.steps.1'),
                ],
            },
        ],
    },
    image: {
        key: 'image',
        heading: t('aiCenterAIToolPageData:tools.image.heading'),
        instructionsHeading: t('aiCenterAIToolPageData:tools.image.instructionsHeading'),
        instructionsSubHeading: t('aiCenterAIToolPageData:tools.image.instructionsSubHeading'),
        instructions: [
            {
                stepHeading: t('aiCenterAIToolPageData:tools.image.instructions.0.stepHeading'),
                steps: [
                    t('aiCenterAIToolPageData:tools.image.instructions.0.steps.0'),
                    t('aiCenterAIToolPageData:tools.image.instructions.0.steps.1'),
                ],
            },
            {
                stepHeading: t('aiCenterAIToolPageData:tools.image.instructions.1.stepHeading'),
                steps: [t('aiCenterAIToolPageData:tools.image.instructions.1.steps.0')],
            },
            {
                stepHeading: t('aiCenterAIToolPageData:tools.image.instructions.2.stepHeading'),
                steps: [
                    t('aiCenterAIToolPageData:tools.image.instructions.2.steps.0'),
                    t('aiCenterAIToolPageData:tools.image.instructions.2.steps.1'),
                ],
            },
            {
                stepHeading: t('aiCenterAIToolPageData:tools.image.instructions.3.stepHeading'),
                steps: [
                    t('aiCenterAIToolPageData:tools.image.instructions.3.steps.0'),
                    t('aiCenterAIToolPageData:tools.image.instructions.3.steps.1'),
                ],
            },
            {
                stepHeading: t('aiCenterAIToolPageData:tools.image.instructions.4.stepHeading'),
                steps: [
                    t('aiCenterAIToolPageData:tools.image.instructions.4.steps.0'),
                    t('aiCenterAIToolPageData:tools.image.instructions.4.steps.1'),
                ],
            },
        ],
    },
    sortSplitPdf: {
        key: 'sortSplitPdf',
        heading: t('aiCenterAIToolPageData:tools.sortSplitPdf.heading'),
        instructionsHeading: t('aiCenterAIToolPageData:tools.sortSplitPdf.instructionsHeading'),
        instructionsSubHeading: t(
            'aiCenterAIToolPageData:tools.sortSplitPdf.instructionsSubHeading'
        ),
        instructions: [
            {
                stepHeading: t('aiCenterAIToolPageData:tools.sortSplitPdf.instructions.0.stepHeading'),
                steps: [
                    t('aiCenterAIToolPageData:tools.sortSplitPdf.instructions.0.steps.0'),
                    t('aiCenterAIToolPageData:tools.sortSplitPdf.instructions.0.steps.1'),
                ],
            },
            {
                stepHeading: t('aiCenterAIToolPageData:tools.sortSplitPdf.instructions.1.stepHeading'),
                steps: [t('aiCenterAIToolPageData:tools.sortSplitPdf.instructions.1.steps.0')],
            },
            {
                stepHeading: t('aiCenterAIToolPageData:tools.sortSplitPdf.instructions.2.stepHeading'),
                steps: [t('aiCenterAIToolPageData:tools.sortSplitPdf.instructions.2.steps.0')],
            },
            {
                stepHeading: t('aiCenterAIToolPageData:tools.sortSplitPdf.instructions.3.stepHeading'),
                steps: [
                    t('aiCenterAIToolPageData:tools.sortSplitPdf.instructions.3.steps.0'),
                    t('aiCenterAIToolPageData:tools.sortSplitPdf.instructions.3.steps.1'),
                ],
            },
            {
                stepHeading: t('aiCenterAIToolPageData:tools.sortSplitPdf.instructions.4.stepHeading'),
                steps: [
                    t('aiCenterAIToolPageData:tools.sortSplitPdf.instructions.4.steps.0'),
                    t('aiCenterAIToolPageData:tools.sortSplitPdf.instructions.4.steps.1'),
                ],
            },
        ],
    },
    sortTopicsPdf: {
        key: 'sortTopicsPdf',
        heading: t('aiCenterAIToolPageData:tools.sortTopicsPdf.heading'),
        instructionsHeading: t('aiCenterAIToolPageData:tools.sortTopicsPdf.instructionsHeading'),
        instructionsSubHeading: t(
            'aiCenterAIToolPageData:tools.sortTopicsPdf.instructionsSubHeading'
        ),
        instructions: [
            {
                stepHeading: t(
                    'aiCenterAIToolPageData:tools.sortTopicsPdf.instructions.0.stepHeading'
                ),
                steps: [
                    t('aiCenterAIToolPageData:tools.sortTopicsPdf.instructions.0.steps.0'),
                    t('aiCenterAIToolPageData:tools.sortTopicsPdf.instructions.0.steps.1'),
                ],
            },
            {
                stepHeading: t(
                    'aiCenterAIToolPageData:tools.sortTopicsPdf.instructions.1.stepHeading'
                ),
                steps: [t('aiCenterAIToolPageData:tools.sortTopicsPdf.instructions.1.steps.0')],
            },
            {
                stepHeading: t(
                    'aiCenterAIToolPageData:tools.sortTopicsPdf.instructions.2.stepHeading'
                ),
                steps: [
                    t('aiCenterAIToolPageData:tools.sortTopicsPdf.instructions.2.steps.0'),
                    t('aiCenterAIToolPageData:tools.sortTopicsPdf.instructions.2.steps.1'),
                ],
            },
            {
                stepHeading: t(
                    'aiCenterAIToolPageData:tools.sortTopicsPdf.instructions.3.stepHeading'
                ),
                steps: [
                    t('aiCenterAIToolPageData:tools.sortTopicsPdf.instructions.3.steps.0'),
                    t('aiCenterAIToolPageData:tools.sortTopicsPdf.instructions.3.steps.1'),
                ],
            },
            {
                stepHeading: t(
                    'aiCenterAIToolPageData:tools.sortTopicsPdf.instructions.4.stepHeading'
                ),
                steps: [
                    t('aiCenterAIToolPageData:tools.sortTopicsPdf.instructions.4.steps.0'),
                    t('aiCenterAIToolPageData:tools.sortTopicsPdf.instructions.4.steps.1'),
                ],
            },
        ],
    },
    planLecture: {
        key: 'planLecture',
        heading: t('aiCenterAIToolPageData:tools.planLecture.heading'),
        // NOTE: source copy says "How to Use Vsmart Sorter" (pre-existing content
        // bug — should read "Vsmart Lecturer"). Preserved verbatim; see catalog.
        instructionsHeading: t('aiCenterAIToolPageData:tools.planLecture.instructionsHeading'),
        instructionsSubHeading: t(
            'aiCenterAIToolPageData:tools.planLecture.instructionsSubHeading'
        ),
        instructions: [
            {
                stepHeading: t('aiCenterAIToolPageData:tools.planLecture.instructions.0.stepHeading'),
                steps: [
                    t('aiCenterAIToolPageData:tools.planLecture.instructions.0.steps.0'),
                    t('aiCenterAIToolPageData:tools.planLecture.instructions.0.steps.1'),
                    t('aiCenterAIToolPageData:tools.planLecture.instructions.0.steps.2'),
                    t('aiCenterAIToolPageData:tools.planLecture.instructions.0.steps.3'),
                    t('aiCenterAIToolPageData:tools.planLecture.instructions.0.steps.4'),
                    t('aiCenterAIToolPageData:tools.planLecture.instructions.0.steps.5'),
                    t('aiCenterAIToolPageData:tools.planLecture.instructions.0.steps.6'),
                ],
            },
            {
                stepHeading: t('aiCenterAIToolPageData:tools.planLecture.instructions.1.stepHeading'),
                steps: [t('aiCenterAIToolPageData:tools.planLecture.instructions.1.steps.0')],
            },
            {
                stepHeading: t('aiCenterAIToolPageData:tools.planLecture.instructions.2.stepHeading'),
                steps: [
                    t('aiCenterAIToolPageData:tools.planLecture.instructions.2.steps.0'),
                    t('aiCenterAIToolPageData:tools.planLecture.instructions.2.steps.1'),
                    t('aiCenterAIToolPageData:tools.planLecture.instructions.2.steps.2'),
                    t('aiCenterAIToolPageData:tools.planLecture.instructions.2.steps.3'),
                    t('aiCenterAIToolPageData:tools.planLecture.instructions.2.steps.4'),
                ],
            },
        ],
    },
    evaluateLecture: {
        key: 'evaluateLecture',
        heading: t('aiCenterAIToolPageData:tools.evaluateLecture.heading'),
        instructionsHeading: t('aiCenterAIToolPageData:tools.evaluateLecture.instructionsHeading'),
        instructionsSubHeading: t(
            'aiCenterAIToolPageData:tools.evaluateLecture.instructionsSubHeading'
        ),
        instructions: [
            {
                stepHeading: t(
                    'aiCenterAIToolPageData:tools.evaluateLecture.instructions.0.stepHeading'
                ),
                steps: [
                    t('aiCenterAIToolPageData:tools.evaluateLecture.instructions.0.steps.0'),
                    t('aiCenterAIToolPageData:tools.evaluateLecture.instructions.0.steps.1'),
                ],
            },
            {
                stepHeading: t(
                    'aiCenterAIToolPageData:tools.evaluateLecture.instructions.1.stepHeading'
                ),
                steps: [
                    t('aiCenterAIToolPageData:tools.evaluateLecture.instructions.1.steps.0'),
                    t('aiCenterAIToolPageData:tools.evaluateLecture.instructions.1.steps.1'),
                ],
            },
            {
                stepHeading: t(
                    'aiCenterAIToolPageData:tools.evaluateLecture.instructions.2.stepHeading'
                ),
                steps: [
                    t('aiCenterAIToolPageData:tools.evaluateLecture.instructions.2.steps.0'),
                    t('aiCenterAIToolPageData:tools.evaluateLecture.instructions.2.steps.1'),
                    t('aiCenterAIToolPageData:tools.evaluateLecture.instructions.2.steps.2'),
                    t('aiCenterAIToolPageData:tools.evaluateLecture.instructions.2.steps.3'),
                    t('aiCenterAIToolPageData:tools.evaluateLecture.instructions.2.steps.4'),
                    t('aiCenterAIToolPageData:tools.evaluateLecture.instructions.2.steps.5'),
                    t('aiCenterAIToolPageData:tools.evaluateLecture.instructions.2.steps.6'),
                    t('aiCenterAIToolPageData:tools.evaluateLecture.instructions.2.steps.7'),
                ],
            },
            {
                stepHeading: t(
                    'aiCenterAIToolPageData:tools.evaluateLecture.instructions.3.stepHeading'
                ),
                steps: [
                    t('aiCenterAIToolPageData:tools.evaluateLecture.instructions.3.steps.0'),
                    t('aiCenterAIToolPageData:tools.evaluateLecture.instructions.3.steps.1'),
                ],
            },
            {
                stepHeading: t(
                    'aiCenterAIToolPageData:tools.evaluateLecture.instructions.4.stepHeading'
                ),
                steps: [t('aiCenterAIToolPageData:tools.evaluateLecture.instructions.4.steps.0')],
            },
        ],
    },
});
