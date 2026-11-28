import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { MyButton } from '@/components/design-system/button';
import { MyDialog } from '@/components/design-system/dialog';
import { ChipToggleGroup } from '@/components/design-system/chips';
import { Checkbox } from '@/components/ui/checkbox';
import {
    PenStylePicker,
    normalizePenStyle,
} from '@/components/common/ai-copy-check/PenStylePicker';
import type { PenStyle } from '@/types/assessment-settings';
import {
    regenerateCheckedCopy,
    type RegenerateCopyResponse,
} from '@/routes/assessment/assessment-list/assessment-details/$assessmentId/$examType/$assesssmentType/$assessmentTab/-services/ai-evaluation-services';

type Layout = 'KEEP' | 'INSIDE' | 'OUTSIDE';

/** Server error text when it is a sentence for people (409/400 from the re-draw), else the generic one. */
const errorMessage = (error: unknown, fallback: string): string => {
    const data = (error as { response?: { data?: unknown } })?.response?.data;
    if (typeof data === 'string' && data.length < 240) return data;
    const message =
        (data as { ex?: string; message?: string } | undefined)?.ex ??
        (data as { message?: string } | undefined)?.message;
    return typeof message === 'string' && message.length < 240 ? message : fallback;
};

/**
 * Re-draw the AI checked copy with the teacher's corrections, optionally in
 * another pen or remarks layout. Defaults keep the copy as it was checked.
 */
export const RegenerateCopyDialog = ({
    open,
    onOpenChange,
    processId,
    defaultPen,
    onDone,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    processId: string;
    /** The institute's pen, preselected when the teacher chooses a pen. */
    defaultPen?: Partial<PenStyle> | null;
    onDone: (result: RegenerateCopyResponse) => void;
}) => {
    const { t } = useTranslation('copyCheckReview');
    const [keepPen, setKeepPen] = useState(true);
    const [pen, setPen] = useState<PenStyle>(() => normalizePenStyle(defaultPen));
    const [layout, setLayout] = useState<Layout>('KEEP');

    const mutation = useMutation({
        mutationFn: () =>
            regenerateCheckedCopy(processId, {
                ...(keepPen ? {} : { pen_style: pen }),
                ...(layout === 'KEEP' ? {} : { comment_placement: layout }),
            }),
        onSuccess: (result) => {
            toast.success(t('redraw.done'));
            onDone(result);
            onOpenChange(false);
        },
        onError: (error) => toast.error(errorMessage(error, t('redraw.failed'))),
    });

    return (
        <MyDialog
            open={open}
            onOpenChange={(next) => !mutation.isPending && onOpenChange(next)}
            heading={t('redraw.dialogTitle')}
            dialogWidth="max-w-lg"
            footer={
                <div className="flex w-full justify-end gap-2">
                    <MyButton
                        type="button"
                        buttonType="secondary"
                        scale="medium"
                        disabled={mutation.isPending}
                        onClick={() => onOpenChange(false)}
                    >
                        {t('redraw.cancel')}
                    </MyButton>
                    <MyButton
                        type="button"
                        buttonType="primary"
                        scale="medium"
                        disabled={mutation.isPending}
                        onClick={() => mutation.mutate()}
                    >
                        {mutation.isPending ? t('redraw.working') : t('redraw.submit')}
                    </MyButton>
                </div>
            }
        >
            <div className="flex flex-col gap-4">
                <p className="text-body text-neutral-600">{t('redraw.dialogHint')}</p>

                <div className="flex flex-col gap-1.5">
                    <p className="text-caption font-medium text-neutral-600">
                        {t('redraw.layout')}
                    </p>
                    <ChipToggleGroup
                        size="sm"
                        variant="outline"
                        ariaLabel={t('redraw.layout')}
                        value={layout}
                        onChange={(next) => setLayout(next)}
                        options={[
                            { value: 'KEEP', label: t('redraw.layoutKeep') },
                            { value: 'INSIDE', label: t('redraw.layoutInside') },
                            { value: 'OUTSIDE', label: t('redraw.layoutOutside') },
                        ]}
                    />
                </div>

                <label className="flex cursor-pointer items-center gap-2 text-body text-neutral-700">
                    <Checkbox
                        checked={keepPen}
                        onCheckedChange={(v) => setKeepPen(v === true)}
                        disabled={mutation.isPending}
                    />
                    {t('redraw.keepPen')}
                </label>

                {!keepPen && (
                    <PenStylePicker value={pen} onChange={setPen} disabled={mutation.isPending} />
                )}
            </div>
        </MyDialog>
    );
};

export default RegenerateCopyDialog;
