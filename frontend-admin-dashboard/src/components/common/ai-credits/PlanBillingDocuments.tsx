/**
 * Tax invoices and credit notes for AI plans (and, where the facade returns
 * them, credit packs), each with a PDF download.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DownloadSimple, FileText, Receipt } from '@phosphor-icons/react';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { formatDate } from '@/lib/formatters';
import { usePlatformBrand } from '@/lib/platform-brand';
import { formatMinor } from '@/services/ai-plans/format';
import {
    downloadBillingDocumentPdf,
    useBillingDocumentsQuery,
    type BillingDocument,
} from '@/services/ai-plans/storefront';

/** Newest first; undated rows last. */
export function sortDocuments(docs: BillingDocument[]): BillingDocument[] {
    return [...docs].sort((a, b) => {
        const ta = a.issued_at ? Date.parse(a.issued_at) : 0;
        const tb = b.issued_at ? Date.parse(b.issued_at) : 0;
        return tb - ta;
    });
}

export function BillingDocumentRow({
    instituteId,
    doc,
    compact = false,
}: {
    instituteId: string;
    doc: BillingDocument;
    compact?: boolean;
}) {
    const { t } = useTranslation('aiPlans');
    const brand = usePlatformBrand(instituteId);
    const [busy, setBusy] = useState(false);
    const [failed, setFailed] = useState(false);
    const isCreditNote = doc.doc_type === 'CREDIT_NOTE';
    const period =
        doc.service_start && doc.service_end
            ? t('invoices.period', {
                  start: formatDate(doc.service_start, { year: undefined }),
                  end: formatDate(doc.service_end),
              })
            : null;
    const description =
        brand.scrub(doc.description) ??
        (isCreditNote ? t('invoices.creditNote') : t('invoices.invoice'));

    const download = async () => {
        setBusy(true);
        setFailed(false);
        try {
            await downloadBillingDocumentPdf(instituteId, doc);
        } catch {
            setFailed(true);
        } finally {
            setBusy(false);
        }
    };

    return (
        <li
            className={cn(
                'flex items-center gap-2.5 rounded-lg border bg-white',
                compact ? 'px-2.5 py-2' : 'px-3 py-2.5'
            )}
        >
            <div
                className={cn('rounded-lg p-1.5', isCreditNote ? 'bg-warning-50' : 'bg-primary-50')}
            >
                {isCreditNote ? (
                    <Receipt className="size-3.5 text-warning-700" weight="bold" />
                ) : (
                    <FileText className="size-3.5 text-primary-600" weight="bold" />
                )}
            </div>
            <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                    <span className="truncate text-xs font-medium text-neutral-800">
                        {description}
                    </span>
                    {isCreditNote && (
                        <span className="shrink-0 rounded bg-warning-50 px-1 py-0.5 text-2xs font-semibold text-warning-700">
                            {t('invoices.creditNoteBadge')}
                        </span>
                    )}
                </div>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-2xs text-neutral-500">
                    <span className="font-mono">{doc.number}</span>
                    {doc.issued_at && <span>{formatDate(doc.issued_at)}</span>}
                    {period && <span>{period}</span>}
                </div>
                {failed && (
                    <p className="mt-0.5 text-2xs text-danger-600">
                        {t('invoices.downloadFailed')}
                    </p>
                )}
            </div>
            <div className="text-end">
                <div className="text-xs font-bold tabular-nums text-neutral-800">
                    {isCreditNote ? '−' : ''}
                    {formatMinor(doc.total_minor, doc.currency)}
                </div>
                {doc.tax_minor !== null && doc.tax_minor > 0 && (
                    <div className="text-2xs text-neutral-500">
                        {t('invoices.inclGst', { tax: formatMinor(doc.tax_minor, doc.currency) })}
                    </div>
                )}
            </div>
            <button
                type="button"
                onClick={download}
                disabled={busy}
                aria-label={t('invoices.downloadAria', { number: doc.number })}
                title={t('invoices.downloadAria', { number: doc.number })}
                className="ms-1 rounded-md border border-neutral-200 p-1.5 text-neutral-500 transition-colors hover:border-primary-200 hover:bg-primary-50 hover:text-primary-600 disabled:opacity-50"
            >
                <DownloadSimple className={cn('size-3.5', busy && 'animate-pulse')} weight="bold" />
            </button>
        </li>
    );
}

export function PlanBillingDocuments({ instituteId }: { instituteId: string }) {
    const { t } = useTranslation('aiPlans');
    const { data, isLoading, isError } = useBillingDocumentsQuery(instituteId);

    return (
        <section className="space-y-2">
            <h4 className="text-subtitle font-semibold text-neutral-800">{t('invoices.title')}</h4>
            {isLoading && (
                <div className="space-y-2">
                    {[0, 1].map((i) => (
                        <Skeleton key={i} className="h-12 w-full rounded-lg" />
                    ))}
                </div>
            )}
            {isError && <p className="text-caption text-danger-600">{t('invoices.loadFailed')}</p>}
            {data && data.length === 0 && (
                <p className="text-caption text-neutral-500">{t('invoices.empty')}</p>
            )}
            {data && data.length > 0 && (
                <ul className="space-y-1.5">
                    {sortDocuments(data).map((d) => (
                        <BillingDocumentRow
                            key={`${d.doc_type}-${d.id}`}
                            instituteId={instituteId}
                            doc={d}
                        />
                    ))}
                </ul>
            )}
        </section>
    );
}
