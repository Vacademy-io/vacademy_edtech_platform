import { useWatch, type UseFormReturn } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { FileText, GridFour } from '@phosphor-icons/react';
import { sanitizeRichHtml } from '@/lib/sanitize-html';
import { htmlToPlainText, parseCbeConfig } from '@/components/cbe/types';
import { cbeQuestionMark } from '../../../-utils/cbe-question';

type Props = {
    // Shared by several form schemas; only reads the question at `basePath`.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    form: UseFormReturn<any>;
    basePath: string;
    className?: string;
};

/** Compact read-only summary of a CBE question (thumbnail / PPT view). */
export function CbeQuestionSummary({ form, basePath, className }: Props) {
    const { t } = useTranslation('assessmentCbeQP');
    const raw = useWatch({ control: form.control, name: `${basePath}.cbeConfig` });
    const questionHtml = useWatch({ control: form.control, name: `${basePath}.questionName` }) as
        | string
        | undefined;
    const scenarioHtml = useWatch({
        control: form.control,
        name: `${basePath}.parentRichTextContent`,
    }) as string | undefined | null;
    const config = parseCbeConfig(raw);
    const parts = config?.data.parts ?? [];
    const scenario = htmlToPlainText(scenarioHtml);

    return (
        <div className={className}>
            <div className="flex w-full flex-col gap-3">
                {scenario && (
                    <p className="line-clamp-2 text-caption text-neutral-500">
                        {t('summary.scenario', { text: scenario })}
                    </p>
                )}
                <div
                    className="prose max-w-none rounded-md border bg-white p-3 text-body"
                    dangerouslySetInnerHTML={{
                        __html:
                            sanitizeRichHtml(questionHtml) ||
                            `<i>${t('summary.noRequirements')}</i>`,
                    }}
                />
                <div className="flex flex-wrap gap-2 text-caption">
                    {parts.map((part) => (
                        <span
                            key={part.id}
                            className="flex items-center gap-1 rounded-md bg-neutral-100 px-2 py-1 text-neutral-700"
                        >
                            {part.kind === 'SPREADSHEET' ? (
                                <GridFour size={14} className="text-success-600" />
                            ) : (
                                <FileText size={14} className="text-info-600" />
                            )}
                            {t('summary.part', {
                                label: part.label,
                                kind: t(`part.kind.${part.kind}`),
                                count: part.marks,
                            })}
                            {(part.markingScheme?.length ?? 0) > 0 &&
                                ` · ${t('summary.schemeLines', { count: part.markingScheme?.length ?? 0 })}`}
                        </span>
                    ))}
                    <span className="rounded-md bg-primary-50 px-2 py-1 font-semibold text-primary-500">
                        {t('summary.total', { count: Number(cbeQuestionMark(config)) })}
                    </span>
                </div>
            </div>
        </div>
    );
}
