import type { TFunction } from 'i18next';

/**
 * Builds the prompt-mode copy (heading + placeholder/description) shown next to the
 * "sort/split by topic" textarea. Module-scope data needs the translation function
 * passed in explicitly, so this is a factory rather than a plain constant — call it
 * from a component with `t` from `useTranslation('aiCenterPromptDummyData')` (add the
 * namespace to a multi-namespace `useTranslation([...])` array if the component already
 * uses one).
 */
export const buildPromptDummyData = (t: TFunction) => ({
    topic: {
        heading: t('aiCenterPromptDummyData:topic.heading'),
        description: t('aiCenterPromptDummyData:topic.description'),
    },
    pages: {
        heading: t('aiCenterPromptDummyData:pages.heading'),
        description: t('aiCenterPromptDummyData:pages.description'),
    },
    questionNo: {
        heading: t('aiCenterPromptDummyData:questionNo.heading'),
        description: t('aiCenterPromptDummyData:questionNo.description'),
    },
});
