import { useTranslation } from 'react-i18next';
import { Lock } from '@phosphor-icons/react';
import { CommerceErrorState } from '@/routes/commerce/-components/CommerceStates';
import { OrderNotice } from '@/routes/commerce/orders/-components/order-ui';
import { readReportError } from '../-shared/report-errors';

/**
 * Error states of the report screens (ADMIN §13): a load error as an inline
 * alert with Retry, a 403 as "You do not have access to this at this
 * location" (no Retry: it would not help), a server sentence under ours when
 * it names the field.
 */
export function ReportErrorNotice({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
    const { t } = useTranslation('commerce');
    if (!error) return null;
    const read = readReportError(error);
    if (read.noAccess) {
        return (
            <OrderNotice tone="warning">
                <p className="flex items-center gap-2" data-testid="report-no-access">
                    <Lock size={16} />
                    {t('reports.errors.noAccess')}
                </p>
            </OrderNotice>
        );
    }
    const sentence = t(read.key);
    const message = read.showServerSentence ? `${sentence} ${read.message}` : sentence;
    return <CommerceErrorState message={message} onRetry={onRetry} />;
}
