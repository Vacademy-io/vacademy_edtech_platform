import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { MyButton } from '@/components/design-system/button';
import { MyDialog } from '@/components/design-system/dialog';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
    fixOmrSheetAnswers,
    omrErrorMessage,
    type OmrFlag,
    type OmrSheet,
} from '../../-services/omr-services';

/** Radix radios cannot carry an empty value; "not attempted" travels as this. */
const NOT_ATTEMPTED = '__NONE__';
const DEFAULT_OPTION_COUNT = 4;

const toRadio = (letter: string | undefined) =>
    letter === undefined ? undefined : letter === '' ? NOT_ATTEMPTED : letter;
const fromRadio = (value: string) => (value === NOT_ATTEMPTED ? '' : value);

/**
 * Correct only the questions the reader was unsure of (two bubbles filled or a
 * faint mark). Every other answer was read with confidence and stays as read.
 * Only the questions the admin actually changed are sent; the sheet is re-graded.
 */
export const OmrFixAnswersDialog = ({
    sheet,
    instituteId,
    optionCountByNo,
    onClose,
    onFixed,
}: {
    sheet: OmrSheet;
    instituteId: string;
    /** Question number -> options printed for it (from the set's paper). */
    optionCountByNo: Record<string, number>;
    onClose: () => void;
    onFixed: () => void;
}) => {
    const { t } = useTranslation('assessmentOmr');
    const flagged = useMemo(() => {
        const flags: Record<string, OmrFlag> = sheet.flags ?? {};
        return Object.entries(flags).sort(([a], [b]) => Number(a) - Number(b));
    }, [sheet.flags]);

    // Starting value per question: the admin's earlier fix, else a single letter read.
    const initial = useMemo(() => {
        const out: Record<string, string | undefined> = {};
        for (const [no] of flagged) {
            const fix = sheet.fixes?.[no];
            const read = sheet.answers?.[no] ?? '';
            out[no] = fix !== undefined ? fix : read.length === 1 ? read : undefined;
        }
        return out;
    }, [flagged, sheet.fixes, sheet.answers]);
    const [values, setValues] = useState<Record<string, string | undefined>>(initial);

    const changed = useMemo(() => {
        const out: Record<string, string> = {};
        for (const [no] of flagged) {
            const v = values[no];
            if (v !== undefined && v !== initial[no]) out[no] = v;
        }
        return out;
    }, [flagged, values, initial]);

    const fix = useMutation({
        mutationFn: () => fixOmrSheetAnswers(sheet.id, instituteId, changed),
        onSuccess: () => {
            toast.success(t('toasts.fixed'));
            onFixed();
        },
        onError: (e) => toast.error(omrErrorMessage(e, t('errors.actionFailed'))),
    });

    const lettersFor = (no: string) => {
        const read = sheet.answers?.[no] ?? '';
        const highestRead = read
            .split('')
            .reduce((max, ch) => Math.max(max, ch.charCodeAt(0) - 64), 0);
        const count = optionCountByNo[no] ?? Math.max(DEFAULT_OPTION_COUNT, highestRead);
        return Array.from({ length: count }, (_, i) => String.fromCharCode(65 + i));
    };

    return (
        <MyDialog
            heading={t('fix.title')}
            open
            onOpenChange={(o) => !o && !fix.isPending && onClose()}
            dialogWidth="max-w-xl"
            footer={
                <div className="flex justify-end gap-2">
                    <MyButton
                        type="button"
                        buttonType="secondary"
                        scale="medium"
                        disabled={fix.isPending}
                        onClick={onClose}
                    >
                        {t('common.cancel')}
                    </MyButton>
                    <MyButton
                        type="button"
                        buttonType="primary"
                        scale="medium"
                        disabled={Object.keys(changed).length === 0 || fix.isPending}
                        onClick={() => fix.mutate()}
                    >
                        {fix.isPending
                            ? t('fix.saving')
                            : t('fix.save', { count: Object.keys(changed).length })}
                    </MyButton>
                </div>
            }
        >
            <div className="flex flex-col gap-3 p-4">
                <p className="text-sm text-neutral-600">{t('fix.intro')}</p>
                <ul className="flex flex-col divide-y divide-neutral-100 rounded-md border border-neutral-200">
                    {flagged.map(([no, flag]) => {
                        const read = sheet.answers?.[no] ?? '';
                        return (
                            <li key={no} className="flex flex-col gap-2 p-3">
                                <div className="flex flex-wrap items-center gap-2 text-sm">
                                    <span className="font-semibold text-neutral-800">
                                        {t('fix.question', { no })}
                                    </span>
                                    <span className="text-neutral-600">
                                        {t('fix.read', { value: read || t('fix.blank') })}
                                    </span>
                                    <span className="rounded bg-warning-50 px-1.5 py-0.5 text-caption text-warning-700">
                                        {t(`flag.${flag}`, { defaultValue: flag })}
                                    </span>
                                </div>
                                <RadioGroup
                                    value={toRadio(values[no]) ?? ''}
                                    onValueChange={(v) =>
                                        setValues((prev) => ({ ...prev, [no]: fromRadio(v) }))
                                    }
                                    className="flex flex-wrap gap-4"
                                    disabled={fix.isPending}
                                >
                                    {lettersFor(no).map((letter) => (
                                        <label
                                            key={letter}
                                            className="flex cursor-pointer items-center gap-1.5 text-sm"
                                        >
                                            <RadioGroupItem value={letter} />
                                            {letter}
                                        </label>
                                    ))}
                                    <label className="flex cursor-pointer items-center gap-1.5 text-sm">
                                        <RadioGroupItem value={NOT_ATTEMPTED} />
                                        {t('fix.notAttempted')}
                                    </label>
                                </RadioGroup>
                            </li>
                        );
                    })}
                </ul>
            </div>
        </MyDialog>
    );
};

export default OmrFixAnswersDialog;
