import { useTranslation } from 'react-i18next';
import { Lock } from '@phosphor-icons/react';
import { useAdminLanguage } from '@/routes/commerce/-components/CatalogueBits';
import { CommerceErrorState } from '@/routes/commerce/-components/CommerceStates';
import { OrderNotice } from '@/routes/commerce/orders/-components/order-ui';
import { readReportError } from '../-shared/report-errors';

/**
 * Error states of the report screens (ADMIN §13): a load error as an inline
 * alert, with Retry only when a second try can help (N5: not for a report
 * that is off, a refused filter or a file too large); a 403 as "You do not
 * have access to this at this location". The server's English sentence is
 * added only on an English screen and only when ours cannot say it (N7).
 */
export function ReportErrorNotice({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
    const { t } = useTranslation('commerce');
    const lang = useAdminLanguage();
    if (!error) return null;
    const read = readReportError(error);
    if (read.noAccess) {
        return (
            <OrderNotice tone="warning">
                <p className="flex items-center gap-2" data-testid="report-no-access">
                    <Lock size={16} aria-hidden="true" />
                    {t('reports.errors.noAccess')}
                </p>
            </OrderNotice>
        );
    }
    const sentence = t(read.key);
    const message = read.showServerSentence && lang === 'en' ? `${sentence} ${read.message}` : sentence;
    return <CommerceErrorState message={message} onRetry={read.retryable ? onRetry : undefined} />;
}
