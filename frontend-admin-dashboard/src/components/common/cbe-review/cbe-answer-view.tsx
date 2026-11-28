import { useTranslation } from 'react-i18next';
import { FileText, GridFour } from '@phosphor-icons/react';
import { DocumentView, SheetView, cbePartTabLabel } from '@/components/cbe';
import type { CbeAnswer, CbeConfig, CbePartAnswer, CbePartKind } from '@/components/cbe/types';
import { cn } from '@/lib/utils';

type Props = {
    answer: CbeAnswer | null | undefined;
    /** For part labels, marks and order; the answer is shown without it too. */
    config?: CbeConfig | null;
    className?: string;
};

type Row = { id: string; title: string; kind: CbePartKind; answer: CbePartAnswer | undefined };

/** The learner sends the response JSON as-is: only well-formed part answers are rendered. */
const asPartAnswer = (value: unknown): CbePartAnswer | undefined =>
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    ((value as { kind?: unknown }).kind === 'SPREADSHEET' ||
        (value as { kind?: unknown }).kind === 'DOCUMENT')
        ? (value as CbePartAnswer)
        : undefined;

/** A learner's Spreadsheet & Written Response answer, read-only, one block per part. */
export function CbeAnswerView({ answer, config, className }: Props) {
    const { t } = useTranslation('cbeReview');
    const answers: Record<string, unknown> =
        answer?.parts && typeof answer.parts === 'object' ? answer.parts : {};
    // A config that shares no part with the answer belongs to another question: ignore it.
    const configParts =
        Object.keys(answers).length > 0 && !(config?.data?.parts ?? []).some((p) => p.id in answers)
            ? []
            : config?.data?.parts ?? [];
    const rows: Row[] = configParts.map((part) => ({
        id: part.id,
        title: cbePartTabLabel(part),
        kind: part.kind,
        answer: asPartAnswer(answers[part.id]),
    }));
    // Parts the config no longer has (edited after the attempt) are still shown.
    Object.entries(answers).forEach(([id, rawAnswer]) => {
        if (configParts.some((p) => p.id === id)) return;
        const partAnswer = asPartAnswer(rawAnswer);
        if (!partAnswer) return;
        rows.push({
            id,
            title: t('answer.unknownPart', { number: rows.length + 1 }),
            kind: partAnswer.kind,
            answer: partAnswer,
        });
    });

    if (rows.length === 0) {
        return (
            <p className={cn('text-body italic text-neutral-500', className)}>
                {t('answer.empty')}
            </p>
        );
    }

    return (
        <div className={cn('flex w-full flex-col gap-4', className)}>
            {rows.map((row) => (
                <section key={row.id} className="flex w-full min-w-0 flex-col gap-2">
                    <h5 className="flex items-center gap-2 text-body font-semibold text-neutral-700">
                        {row.kind === 'SPREADSHEET' ? (
                            <GridFour size={16} className="text-success-600" />
                        ) : (
                            <FileText size={16} className="text-info-600" />
                        )}
                        {row.title}
                    </h5>
                    {row.kind === 'SPREADSHEET' ? (
                        <SheetView
                            sheet={row.answer?.kind === 'SPREADSHEET' ? row.answer.sheet : null}
                            emptyText={t('answer.noSheet')}
                            className="max-w-full overflow-x-auto"
                        />
                    ) : (
                        <DocumentView
                            html={row.answer?.kind === 'DOCUMENT' ? row.answer.html : ''}
                            emptyText={t('answer.noText')}
                            className="rounded-md border border-neutral-200 bg-white p-3"
                        />
                    )}
                </section>
            ))}
        </div>
    );
}
