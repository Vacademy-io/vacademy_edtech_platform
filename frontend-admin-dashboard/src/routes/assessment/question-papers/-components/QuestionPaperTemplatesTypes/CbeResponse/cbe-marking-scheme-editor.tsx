import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowsClockwise, CheckCircle, Plus, Trash, WarningCircle } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { Input } from '@/components/ui/input';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { newMarkingLineId, type CbeMarkingLine } from '@/components/cbe/types';
import { cbeSchemeTotal } from '../../../-utils/cbe-question';

type Props = {
    lines: CbeMarkingLine[];
    onChange: (lines: CbeMarkingLine[]) => void;
    /** The part's marks; the scheme total is checked against it. */
    partMarks: number;
    /** Re-reads the scheme from the solution sheet's "Marks" column; absent when there is no sheet. */
    onExtract?: () => void;
    disabled?: boolean;
};

/** A number cell that keeps what is typed ("1." , "") while the value stays numeric. */
function MarksCell({
    value,
    onChange,
    disabled,
    label,
}: {
    value: number;
    onChange: (next: number) => void;
    disabled?: boolean;
    label: string;
}) {
    const [draft, setDraft] = useState(String(value));
    useEffect(() => {
        if (Number(draft) !== value) setDraft(String(value));
        // Only an outside change of the value re-seeds the draft.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [value]);
    return (
        <Input
            type="number"
            inputMode="decimal"
            min={0}
            step="0.5"
            aria-label={label}
            disabled={disabled}
            value={draft}
            className="h-8 w-20 text-right text-body"
            onChange={(e) => {
                setDraft(e.target.value);
                const n = Number(e.target.value);
                onChange(e.target.value.trim() !== '' && Number.isFinite(n) && n >= 0 ? n : 0);
            }}
        />
    );
}

/** Editable marking scheme of one CBE part: one row per line (label, marks, expected, cell, guidance). */
export function CbeMarkingSchemeEditor({ lines, onChange, partMarks, onExtract, disabled }: Props) {
    const { t } = useTranslation('assessmentCbeQP');
    const total = cbeSchemeTotal(lines);
    const matches = Math.abs(total - partMarks) < 1e-9;

    const update = (index: number, patch: Partial<CbeMarkingLine>) =>
        onChange(lines.map((line, i) => (i === index ? { ...line, ...patch } : line)));
    const remove = (index: number) => onChange(lines.filter((_, i) => i !== index));
    const add = () =>
        onChange([...lines, { id: newMarkingLineId(lines.map((l) => l.id)), label: '', marks: 1 }]);

    const textCell = (
        index: number,
        key: 'label' | 'expected' | 'cellRef' | 'guidance',
        className: string
    ) => (
        <Input
            aria-label={t(`scheme.columns.${key}`)}
            disabled={disabled}
            value={lines[index]?.[key] ?? ''}
            placeholder={t(`scheme.placeholders.${key}`)}
            className={cn('h-8 text-body', className)}
            onChange={(e) => update(index, { [key]: e.target.value })}
        />
    );

    return (
        <div className="flex w-full flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-caption text-neutral-500">{t('scheme.hint')}</p>
                <div className="flex items-center gap-2">
                    {onExtract && (
                        <MyButton
                            type="button"
                            buttonType="secondary"
                            scale="small"
                            onClick={onExtract}
                            disable={disabled}
                        >
                            <ArrowsClockwise size={14} />
                            {t('scheme.extract')}
                        </MyButton>
                    )}
                    <MyButton
                        type="button"
                        buttonType="secondary"
                        scale="small"
                        onClick={add}
                        disable={disabled}
                    >
                        <Plus size={14} />
                        {t('scheme.addLine')}
                    </MyButton>
                </div>
            </div>

            {lines.length === 0 ? (
                <p className="rounded-md border border-dashed border-neutral-300 p-4 text-center text-body text-neutral-500">
                    {t('scheme.empty')}
                </p>
            ) : (
                <div className="w-full overflow-x-auto rounded-md border border-neutral-200">
                    <Table className="min-w-full">
                        <TableHeader>
                            <TableRow>
                                <TableHead className="min-w-40">
                                    {t('scheme.columns.label')}
                                </TableHead>
                                <TableHead className="w-24 text-right">
                                    {t('scheme.columns.marks')}
                                </TableHead>
                                <TableHead className="min-w-28">
                                    {t('scheme.columns.expected')}
                                </TableHead>
                                <TableHead className="min-w-36">
                                    {t('scheme.columns.cellRef')}
                                </TableHead>
                                <TableHead className="min-w-48">
                                    {t('scheme.columns.guidance')}
                                </TableHead>
                                <TableHead className="w-12">
                                    <span className="sr-only">{t('scheme.removeLine')}</span>
                                </TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {lines.map((line, index) => (
                                <TableRow key={line.id}>
                                    <TableCell className="p-2">
                                        {textCell(index, 'label', 'min-w-40')}
                                    </TableCell>
                                    <TableCell className="p-2 text-right">
                                        <MarksCell
                                            value={line.marks}
                                            disabled={disabled}
                                            label={t('scheme.columns.marks')}
                                            onChange={(marks) => update(index, { marks })}
                                        />
                                    </TableCell>
                                    <TableCell className="p-2">
                                        {textCell(index, 'expected', 'min-w-28')}
                                    </TableCell>
                                    <TableCell className="p-2">
                                        {textCell(index, 'cellRef', 'min-w-36')}
                                    </TableCell>
                                    <TableCell className="p-2">
                                        {textCell(index, 'guidance', 'min-w-48')}
                                    </TableCell>
                                    <TableCell className="p-2">
                                        <MyButton
                                            type="button"
                                            buttonType="text"
                                            scale="small"
                                            layoutVariant="icon"
                                            aria-label={t('scheme.removeLine')}
                                            onClick={() => remove(index)}
                                            disable={disabled}
                                        >
                                            <Trash size={16} className="text-danger-600" />
                                        </MyButton>
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </div>
            )}

            {lines.length > 0 && (
                <div
                    role="status"
                    className={cn(
                        'flex items-center gap-2 rounded-md px-3 py-2 text-body',
                        matches
                            ? 'bg-success-50 text-success-700'
                            : 'bg-warning-50 text-warning-700'
                    )}
                >
                    {matches ? (
                        <CheckCircle size={16} className="shrink-0" />
                    ) : (
                        <WarningCircle size={16} className="shrink-0" />
                    )}
                    {matches
                        ? t('scheme.sumMatches', { total })
                        : t('scheme.sumMismatch', { total, marks: partMarks })}
                </div>
            )}
        </div>
    );
}
