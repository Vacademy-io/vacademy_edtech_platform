import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, X } from '@phosphor-icons/react';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { cn } from '@/lib/utils';
import { getAssessmentSettings } from '@/services/assessment-settings';
import { normalizeCommentPlacement, type CommentPlacement } from '@/types/assessment-settings';

const OPTIONS: CommentPlacement[] = ['INSIDE', 'OUTSIDE'];

/** A line of the student's writing in the preview sheet. */
const Line = ({ className }: { className?: string }) => (
    <div className={cn('h-1 rounded-full bg-info-200', className)} />
);

/** A miniature checked copy, so the choice is made by looking, not by reading. */
const Preview = ({ placement }: { placement: CommentPlacement }) => {
    const { t } = useTranslation('assessmentCopyIntake');
    const sheet = (
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <div className="flex items-center gap-1">
                <Line className="flex-1" />
                <Check size={12} weight="bold" className="shrink-0 text-danger-500" />
            </div>
            <Line className="w-4/5" />
            <div className="flex items-center gap-1">
                <Line className="flex-1" />
                <X size={12} weight="bold" className="shrink-0 text-danger-500" />
            </div>
            {placement === 'INSIDE' && (
                <p className="truncate text-caption italic leading-none text-danger-500">
                    {t('placement.sampleRemark')}
                </p>
            )}
            <Line className="w-3/4" />
            <Line className="w-full" />
        </div>
    );
    return (
        <div className="flex h-28 gap-2 overflow-hidden rounded-sm border border-neutral-200 bg-white p-2">
            {sheet}
            {placement === 'OUTSIDE' && (
                <div className="flex w-2/5 shrink-0 flex-col gap-1 border-l border-neutral-200 pl-2">
                    <p className="truncate text-caption font-semibold uppercase leading-none text-danger-600">
                        {t('placement.panelHeading')}
                    </p>
                    <p className="truncate text-caption font-semibold leading-none text-danger-600">
                        {t('placement.sampleStatus')}
                    </p>
                    <div className="h-1 w-full rounded-full bg-neutral-200" />
                    <div className="h-1 w-4/5 rounded-full bg-neutral-200" />
                    <div className="h-1 w-3/5 rounded-full bg-neutral-200" />
                </div>
            )}
        </div>
    );
};

/**
 * Where the teacher's remarks go on the checked copy: written on the copy
 * (the default) or in a "Teacher comments" panel beside it.
 */
export const CommentPlacementPicker = ({
    value,
    onChange,
    disabled,
}: {
    value: CommentPlacement;
    onChange: (value: CommentPlacement) => void;
    disabled?: boolean;
}) => {
    const { t } = useTranslation('assessmentCopyIntake');
    return (
        <div className="flex flex-col gap-2">
            <p className="text-body font-medium text-neutral-800">{t('placement.label')}</p>
            <RadioGroup
                value={value}
                onValueChange={(v) => onChange(v as CommentPlacement)}
                disabled={disabled}
                className="grid grid-cols-1 gap-3 sm:grid-cols-2"
            >
                {OPTIONS.map((option) => {
                    const id = `comment-placement-${option}`;
                    return (
                        <label
                            key={option}
                            htmlFor={id}
                            className={cn(
                                'flex cursor-pointer flex-col gap-2 rounded-md border p-3 transition-colors',
                                value === option
                                    ? 'border-primary-500 bg-primary-50'
                                    : 'border-neutral-200 hover:border-neutral-300',
                                disabled && 'cursor-not-allowed opacity-60'
                            )}
                        >
                            <Preview placement={option} />
                            <span className="flex items-start gap-2">
                                <RadioGroupItem id={id} value={option} className="mt-0.5" />
                                <span className="flex flex-col">
                                    <span className="text-body font-medium text-neutral-800">
                                        {t(`placement.${option}.title`)}
                                    </span>
                                    <span className="text-caption text-neutral-500">
                                        {t(`placement.${option}.description`)}
                                    </span>
                                </span>
                            </span>
                        </label>
                    );
                })}
            </RadioGroup>
        </div>
    );
};

/**
 * The template for a batch, preselected from the institute's default
 * (Settings → Assessment → AI copy checking) each time the dialog opens. Until
 * that answers - or if it cannot - the usual copy (INSIDE) is selected; a
 * choice the teacher has already made in this dialog is never overwritten.
 */
export const useInstituteCommentPlacement = (
    open: boolean
): [CommentPlacement, (value: CommentPlacement) => void] => {
    const [value, setValue] = useState<CommentPlacement>('INSIDE');
    const touched = useRef(false);

    useEffect(() => {
        if (!open) return;
        touched.current = false;
        let cancelled = false;
        getAssessmentSettings(true)
            .then((settings) => {
                if (cancelled || touched.current) return;
                setValue(normalizeCommentPlacement(settings.aiCopyCheck?.commentPlacement));
            })
            .catch(() => undefined);
        return () => {
            cancelled = true;
        };
    }, [open]);

    const choose = (next: CommentPlacement) => {
        touched.current = true;
        setValue(next);
    };
    return [value, choose];
};

export default CommentPlacementPicker;
