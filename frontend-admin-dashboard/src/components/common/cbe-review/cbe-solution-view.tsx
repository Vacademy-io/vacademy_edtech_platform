import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CaretDown, CaretRight } from '@phosphor-icons/react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import { DocumentView, SheetView, cbePartTabLabel } from '@/components/cbe';
import type { CbeConfig, CbeMarkingLine } from '@/components/cbe/types';
import { cn } from '@/lib/utils';

/** Marking-scheme lines of one part, read-only. */
export function CbeSchemeTable({ lines }: { lines: CbeMarkingLine[] }) {
    const { t } = useTranslation('cbeReview');
    if (lines.length === 0) {
        return <p className="text-body italic text-neutral-500">{t('solution.noScheme')}</p>;
    }
    return (
        <div className="w-full overflow-x-auto rounded-md border border-neutral-200">
            <Table>
                <TableHeader>
                    <TableRow>
                        <TableHead>{t('scheme.line')}</TableHead>
                        <TableHead className="text-right">{t('scheme.marks')}</TableHead>
                        <TableHead>{t('scheme.expected')}</TableHead>
                        <TableHead>{t('scheme.cell')}</TableHead>
                        <TableHead>{t('scheme.guidance')}</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {lines.map((line) => (
                        <TableRow key={line.id}>
                            <TableCell className="font-medium">{line.label}</TableCell>
                            <TableCell className="text-right">{line.marks}</TableCell>
                            <TableCell>{line.expected ?? '—'}</TableCell>
                            <TableCell className="whitespace-nowrap">
                                {line.cellRef ?? '—'}
                            </TableCell>
                            <TableCell className="text-neutral-600">
                                {line.guidance ?? '—'}
                            </TableCell>
                        </TableRow>
                    ))}
                </TableBody>
            </Table>
        </div>
    );
}

type Props = {
    /** The FULL config (staff view). A redacted one shows "not available" per part. */
    config: CbeConfig | null | undefined;
    defaultOpen?: boolean;
    className?: string;
};

/** Collapsible model solution + marking scheme + grading notes of a CBE question. */
export function CbeSolutionView({ config, defaultOpen = false, className }: Props) {
    const { t } = useTranslation('cbeReview');
    const [open, setOpen] = useState(defaultOpen);
    const parts = config?.data?.parts ?? [];
    if (parts.length === 0) return null;
    const notes = config?.data?.gradingNotes?.trim();

    return (
        <Collapsible open={open} onOpenChange={setOpen} className={cn('w-full', className)}>
            <CollapsibleTrigger className="flex items-center gap-1 text-xs font-semibold uppercase text-neutral-500 hover:text-neutral-700">
                {open ? <CaretDown size={14} /> : <CaretRight size={14} />}
                {t('solution.heading')}
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-3 flex flex-col gap-5">
                {parts.map((part) => {
                    const scheme = part.markingScheme ?? [];
                    const sol = part.solution;
                    return (
                        <section key={part.id} className="flex min-w-0 flex-col gap-2">
                            <h5 className="text-body font-semibold text-neutral-700">
                                {cbePartTabLabel(part)}
                            </h5>
                            {!sol ? (
                                <p className="text-body italic text-neutral-500">
                                    {t('solution.none')}
                                </p>
                            ) : 'sheet' in sol ? (
                                <SheetView
                                    sheet={sol.sheet}
                                    highlight={scheme
                                        .map((line) => line.cellRef)
                                        .filter((ref): ref is string => !!ref)}
                                    className="max-w-full overflow-x-auto"
                                />
                            ) : (
                                <DocumentView
                                    html={sol.html}
                                    className="rounded-md border border-neutral-200 bg-white p-3"
                                />
                            )}
                            <CbeSchemeTable lines={scheme} />
                        </section>
                    );
                })}
                {notes && (
                    <div className="rounded-md bg-neutral-50 p-3 text-body text-neutral-700">
                        <span className="font-semibold">{t('solution.gradingNotes')}</span> {notes}
                    </div>
                )}
            </CollapsibleContent>
        </Collapsible>
    );
}
