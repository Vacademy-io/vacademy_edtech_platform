import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Info, Plus, Trash } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { MyButton } from '@/components/design-system/button';
import { MyDialog } from '@/components/design-system/dialog';
import { MyInput } from '@/components/design-system/input';
import { reportApiError } from '@/lib/report-api-error';
import type { HolidayDTO } from '@/routes/erp/-shared/hr-types';
import { useBulkCreateHolidays } from '../-hooks/use-attendance';
import { monthOf } from './attendance-meta';

interface DraftRow {
    key: number;
    name: string;
    date: string;
}

const emptyRows = (): DraftRow[] => [
    { key: 1, name: '', date: '' },
    { key: 2, name: '', date: '' },
    { key: 3, name: '', date: '' },
];

interface BulkHolidaysDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** The year the list is showing — used to invalidate it after the import. */
    year: number;
}

/**
 * Type a year's holiday calendar in one pass.
 *
 * Institutes publish the whole year at once, and adding fifteen holidays through
 * the single-holiday dialog is fifteen round trips. Type is left at the backend's
 * default here on purpose — this is for getting the dates in; the few that need a
 * type or a description are edited afterwards.
 */
export const BulkHolidaysDialog = ({ open, onOpenChange, year }: BulkHolidaysDialogProps) => {
    const { t } = useTranslation('erpBulkHolidaysDialog');
    const mutation = useBulkCreateHolidays(year);
    const [rows, setRows] = useState<DraftRow[]>(emptyRows);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!open) return;
        setRows(emptyRows());
        setError(null);
    }, [open]);

    const updateRow = (key: number, patch: Partial<DraftRow>) =>
        setRows((prev) => prev.map((row) => (row.key === key ? { ...row, ...patch } : row)));

    const addRow = () =>
        setRows((prev) => [
            ...prev,
            { key: (prev[prev.length - 1]?.key ?? 0) + 1, name: '', date: '' },
        ]);

    const removeRow = (key: number) => setRows((prev) => prev.filter((row) => row.key !== key));

    const onSubmit = async () => {
        const filled = rows.filter((row) => row.name.trim() || row.date);
        const incomplete = filled.filter((row) => !row.name.trim() || !row.date);
        if (filled.length === 0) {
            setError(t('validation.atLeastOne'));
            return;
        }
        if (incomplete.length > 0) {
            setError(t('validation.incompleteRow'));
            return;
        }
        setError(null);

        const payload: HolidayDTO[] = filled.map((row) => ({
            name: row.name.trim(),
            date: row.date,
            year: monthOf(row.date).year,
        }));

        try {
            const message = await mutation.mutateAsync(payload);
            // The backend reports how many it skipped as already present — that count is
            // the whole answer to "did my import work", so it is shown, not replaced.
            toast.success(message || t('toast.imported', { count: payload.length }));
            onOpenChange(false);
        } catch (importError) {
            setError(
                reportApiError(importError, {
                    feature: 'erp-attendance',
                    tags: { action: 'bulk-create-holidays' },
                    fallbackMessage: t('errors.importFailed'),
                })
            );
        }
    };

    return (
        <MyDialog
            heading={t('heading')}
            open={open}
            onOpenChange={onOpenChange}
            dialogWidth="max-w-2xl"
            footer={
                <div className="flex justify-end gap-2">
                    <MyButton
                        type="button"
                        buttonType="secondary"
                        scale="medium"
                        onClick={() => onOpenChange(false)}
                    >
                        {t('actions.cancel')}
                    </MyButton>
                    <MyButton
                        type="button"
                        buttonType="primary"
                        scale="medium"
                        onAsyncClick={onSubmit}
                        loadingText={t('actions.importing')}
                    >
                        {t('actions.importHolidays')}
                    </MyButton>
                </div>
            }
        >
            <div className="flex flex-col gap-4">
                <div className="flex items-start gap-2 rounded-md bg-info-50 p-3 text-caption text-neutral-600">
                    <Info size={16} className="mt-0.5 shrink-0 text-info-600" />
                    <span>{t('skipNotice')}</span>
                </div>

                <div className="flex flex-col gap-3">
                    {rows.map((row, index) => (
                        <div key={row.key} className="flex items-end gap-2">
                            <div className="flex flex-1 flex-col gap-1.5">
                                {index === 0 && (
                                    <span className="text-caption text-muted-foreground">
                                        {t('fields.name')}
                                    </span>
                                )}
                                <MyInput
                                    inputType="text"
                                    input={row.name}
                                    onChangeFunction={(event) =>
                                        updateRow(row.key, { name: event.target.value })
                                    }
                                    inputPlaceholder={t('fields.namePlaceholder')}
                                    className="w-full sm:w-full"
                                />
                            </div>
                            <div className="flex w-44 flex-col gap-1.5">
                                {index === 0 && (
                                    <span className="text-caption text-muted-foreground">
                                        {t('fields.date')}
                                    </span>
                                )}
                                <MyInput
                                    inputType="date"
                                    input={row.date}
                                    onChangeFunction={(event) =>
                                        updateRow(row.key, { date: event.target.value })
                                    }
                                    inputPlaceholder=""
                                    className="w-full sm:w-full"
                                />
                            </div>
                            <MyButton
                                type="button"
                                buttonType="text"
                                scale="small"
                                layoutVariant="icon"
                                aria-label={t('actions.removeRow')}
                                disable={rows.length === 1}
                                onClick={() => removeRow(row.key)}
                            >
                                <Trash size={15} className="text-danger-600" />
                            </MyButton>
                        </div>
                    ))}
                </div>

                <div>
                    <MyButton type="button" buttonType="text" scale="small" onClick={addRow}>
                        <Plus size={15} /> {t('actions.addRow')}
                    </MyButton>
                </div>

                {error && <p className="text-caption text-danger-600">{error}</p>}
            </div>
        </MyDialog>
    );
};
