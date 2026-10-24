import type { TFunction } from 'i18next';

export interface AIToolFeatureType {
    key: string;
    heading: string;
    subheading: string;
    tags: string[];
    route: string | null;
}

export interface AIToolCardDataType {
    title: string;
    description?: string;
    features: AIToolFeatureType[];
}

export const buildAIToolCardData = (t: TFunction): AIToolCardDataType[] => [
    {
        title: t('cards.newPaper.title'),
        description: t('cards.newPaper.description'),
        features: [
            {
                key: 'assessment',
                heading: t('cards.newPaper.features.assessment.heading'),
                subheading: t('cards.newPaper.features.assessment.subheading'),
                tags: t('cards.newPaper.features.assessment.tags', {
                    returnObjects: true,
                }) as string[],
                route: '/ai-center/ai-tools/vsmart-upload',
            },
        ],
    },
    {
        title: t('cards.existingPaper.title'),
        description: t('cards.existingPaper.description'),
        features: [
            {
                key: 'question',
                heading: t('cards.existingPaper.features.question.heading'),
                subheading: t('cards.existingPaper.features.question.subheading'),
                tags: t('cards.existingPaper.features.question.tags', {
                    returnObjects: true,
                }) as string[],
                route: '/ai-center/ai-tools/vsmart-extract',
            },
        ],
    },
    {
        title: t('cards.questionBank.title'),
        description: t('cards.questionBank.description'),
        features: [
            {
                key: 'sortSplitPdf',
                heading: t('cards.questionBank.features.sortSplitPdf.heading'),
                subheading: t('cards.questionBank.features.sortSplitPdf.subheading'),
                tags: t('cards.questionBank.features.sortSplitPdf.tags', {
                    returnObjects: true,
                }) as string[],
                route: '/ai-center/ai-tools/vsmart-organizer',
            },
        ],
    },
    {
        title: t('cards.lecturePlanning.title'),
        description: t('cards.lecturePlanning.description'),
        features: [
            {
                key: 'planLecture',
                heading: t('cards.lecturePlanning.features.planLecture.heading'),
                subheading: t('cards.lecturePlanning.features.planLecture.subheading'),
                tags: t('cards.lecturePlanning.features.planLecture.tags', {
                    returnObjects: true,
                }) as string[],
                route: '/ai-center/ai-tools/vsmart-lecture',
            },
            {
                key: 'evaluateLecture',
                heading: t('cards.lecturePlanning.features.evaluateLecture.heading'),
                subheading: t('cards.lecturePlanning.features.evaluateLecture.subheading'),
                tags: t('cards.lecturePlanning.features.evaluateLecture.tags', {
                    returnObjects: true,
                }) as string[],
                route: '/ai-center/ai-tools/vsmart-feedback',
            },
        ],
    },
];
