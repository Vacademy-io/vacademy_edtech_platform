import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { WarningCircle } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { MyDialog } from '@/components/design-system/dialog';
import type { PenStyle } from '@/types/assessment-settings';
import { getPenPreview } from '@/routes/assessment/assessment-list/assessment-details/$assessmentId/$examType/$assesssmentType/$assessmentTab/-services/ai-evaluation-services';
import { PenStylePicker } from './PenStylePicker';

const DEBOUNCE_MS = 350;

/**
 * A whole sample page marked with the pen being chosen, from the same renderer as a
 * real checked copy. Changing the pen here redraws the page and changes the pen
 * outside: it is the same choice, saved the same way.
 */
export const PenPreviewDialog = ({
    value,
    saveHint = false,
    onChange,
    onClose,
}: {
    value: PenStyle;
    saveHint?: boolean;
    onChange: (value: PenStyle) => void;
    onClose: () => void;
}) => {
    const { t } = useTranslation('copyCheckReview');
    // Dragging the darkness slider must not ask for a page per step.
    const [pen, setPen] = useState(value);
    useEffect(() => {
        const timer = setTimeout(() => setPen(value), DEBOUNCE_MS);
        return () => clearTimeout(timer);
    }, [value]);

    const preview = useQuery({
        queryKey: ['COPY_CHECK_PEN_PREVIEW', pen],
        queryFn: ({ signal }) => getPenPreview(pen, signal),
        staleTime: Infinity,
        gcTime: 5 * 60 * 1000,
        retry: false,
        placeholderData: keepPreviousData,
    });

    const [imageUrl, setImageUrl] = useState<string | null>(null);
    useEffect(() => {
        if (!preview.data) return;
        const url = URL.createObjectURL(preview.data);
        setImageUrl(url);
        return () => URL.revokeObjectURL(url);
    }, [preview.data]);

    return (
        <MyDialog
            heading={t('penStyle.previewTitle')}
            open
            onOpenChange={(next) => !next && onClose()}
            dialogWidth="max-w-4xl"
        >
            <div className="flex flex-col gap-4 p-4 sm:p-6 md:flex-row">
                <div className="flex shrink-0 flex-col gap-3 md:w-72">
                    <PenStylePicker
                        value={value}
                        onChange={onChange}
                        showHeading={false}
                        showPreview={false}
                    />
                    <p className="text-caption text-neutral-500">{t('penStyle.previewNote')}</p>
                    {saveHint && (
                        <p className="text-caption font-medium text-neutral-700">
                            {t('penStyle.saveHint')}
                        </p>
                    )}
                </div>
                <div className="min-w-0 flex-1">
                    {preview.isError && !imageUrl ? (
                        <div className="flex flex-col items-center gap-3 rounded-md bg-danger-50 p-6 text-center text-sm text-danger-700">
                            <WarningCircle size={24} />
                            <p>{t('penStyle.previewError')}</p>
                            <MyButton
                                type="button"
                                scale="small"
                                buttonType="secondary"
                                onClick={() => preview.refetch()}
                            >
                                {t('penStyle.previewRetry')}
                            </MyButton>
                        </div>
                    ) : imageUrl ? (
                        <img
                            src={imageUrl}
                            alt={t('penStyle.previewAlt')}
                            className={`w-full rounded-md border border-neutral-200 transition-opacity ${
                                preview.isFetching ? 'opacity-60' : ''
                            }`}
                        />
                    ) : (
                        <div className="flex h-96 animate-pulse items-center justify-center rounded-md bg-neutral-100 text-sm text-neutral-500">
                            {t('penStyle.previewLoading')}
                        </div>
                    )}
                </div>
            </div>
        </MyDialog>
    );
};

export default PenPreviewDialog;
