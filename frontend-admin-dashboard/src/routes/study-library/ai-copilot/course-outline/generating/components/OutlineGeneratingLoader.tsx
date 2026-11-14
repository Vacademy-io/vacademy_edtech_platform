import { BrainCircuit, FileText, Layers, Sparkles, CheckCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { AiGeneratingLoader } from '@/components/common/slides/AiGeneratingLoader';
import { getTerminologyPlural } from '@/components/common/layout-container/sidebar/utils';
import { ContentTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';
import { getAiProductName } from '@/config/branding';

const buildOutlineSteps = (t: TFunction) => [
    { text: t('steps.analyzingTopic'), icon: BrainCircuit },
    { text: t('steps.structuringOutline'), icon: FileText },
    {
        text: t('steps.organizing', {
            terms: getTerminologyPlural(ContentTerms.Chapters, SystemTerms.Chapters).toLowerCase(),
        }),
        icon: Layers,
    },
    { text: t('steps.creatingObjectives'), icon: Sparkles },
    { text: t('steps.finalizingOutline'), icon: CheckCircle },
];

interface OutlineGeneratingLoaderProps {
    estimatedTimeRemaining?: number;
}

export const OutlineGeneratingLoader = ({ estimatedTimeRemaining }: OutlineGeneratingLoaderProps) => {
    const { t } = useTranslation('studyLibraryOutlineGeneratingLoader');
    const aiName = getAiProductName();
    const hasTimeLeft = estimatedTimeRemaining != null && estimatedTimeRemaining > 0;
    const minutes = hasTimeLeft ? Math.floor(estimatedTimeRemaining! / 60) : 0;
    const seconds = hasTimeLeft ? estimatedTimeRemaining! % 60 : 0;

    const getDescription = () => {
        if (hasTimeLeft) {
            return minutes > 0
                ? t('description.estimatedTimeMinutes', { minutes, seconds })
                : t('description.estimatedTimeSeconds', { seconds });
        }
        if (estimatedTimeRemaining != null && estimatedTimeRemaining <= 0) {
            return t('description.stillWorking');
        }
        return t('description.craftingStructure', { aiName });
    };

    return (
        <div className="min-h-screen bg-gradient-to-b from-indigo-50 via-white to-purple-50">
            <div className="mx-auto max-w-2xl px-4 py-12 sm:px-6 lg:px-8">
                <AiGeneratingLoader
                    title={t('title.generatingOutline', { aiName })}
                    description={getDescription()}
                    steps={buildOutlineSteps(t)}
                />
            </div>
        </div>
    );
};
