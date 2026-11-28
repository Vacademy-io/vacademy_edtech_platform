import { Progress } from '@/components/ui/progress';
import { useEffect, useState } from 'react';
import { CircleNotch as Loader2 } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';

export const LoadingOverlay = ({
    pageNumber,
    numPages,
}: {
    pageNumber: number;
    numPages: number;
}) => {
    const { t } = useTranslation('evaluationOverlay');
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-[0.5px]">
            <div className="w-full max-w-md rounded-lg border bg-card p-6 shadow-lg">
                <div className="flex flex-col items-center space-y-4">
                    <h1 className="text-lg font-medium">{t('generatingPdf')}</h1>
                    <p className="text-gray-500">{t('mayTakeAMoment')}</p>
                    <Progress value={(pageNumber / numPages) * 100} className="h-2" />
                    <h3 className="text-lg font-medium">
                        {t('donePages', { current: pageNumber, total: numPages })}
                    </h3>
                </div>
            </div>
        </div>
    );
};

export function UploadingOverlay({ progress }: { progress: number }) {
    const { t } = useTranslation('evaluationOverlay');
    const [progressValue, setProgressValue] = useState(0);

    useEffect(() => {
        // Animate the progress value for a smoother transition
        const timeout = setTimeout(() => {
            setProgressValue(progress);
        }, 100);

        return () => clearTimeout(timeout);
    }, [progress]);

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-[0.5px]">
            <div className="w-full max-w-md rounded-lg border bg-card p-6 shadow-lg">
                <div className="flex flex-col items-center space-y-4">
                    <div className="flex items-center justify-center">
                        <Loader2 className="mr-2 size-6 animate-spin text-primary-300" />
                        <h3 className="text-lg font-medium">{t('savingFile')}</h3>
                    </div>

                    <div className="w-full space-y-2">
                        <Progress value={progressValue} className="h-2 w-full" />
                        <p className="text-center text-sm text-muted-foreground">
                            {t('percentComplete', { percent: Math.round(progressValue) })}
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
}
