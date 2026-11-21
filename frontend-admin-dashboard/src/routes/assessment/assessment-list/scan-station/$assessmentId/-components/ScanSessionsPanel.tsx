import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { formatDateTime } from '@/lib/formatters';
import { listScanSessions, SCAN_SESSIONS_KEY } from '../-services/scan-station-services';
import { retryUnlessNotFound } from '../-lib/api-error';
import { useOnScanNotFound } from '../-hooks/useScanActions';

/** This test's recent scan sessions (newest first), to pick one up again. */
export const ScanSessionsPanel = ({
    assessmentId,
    instituteId,
    onOpen,
}: {
    assessmentId: string;
    instituteId: string;
    onOpen: (sessionId: string) => void;
}) => {
    const { t } = useTranslation('scanStation');
    const onNotFound = useOnScanNotFound(instituteId);
    const { data: sessions = [], isLoading } = useQuery({
        queryKey: [SCAN_SESSIONS_KEY, assessmentId, instituteId],
        queryFn: async () => {
            try {
                return await listScanSessions(assessmentId, instituteId);
            } catch (e) {
                onNotFound(e);
                throw e;
            }
        },
        retry: retryUnlessNotFound,
    });

    return (
        <section className="flex flex-col gap-3 rounded-lg border border-neutral-200 bg-white p-4">
            <h2 className="text-subtitle font-semibold text-neutral-800">{t('sessions.title')}</h2>
            {isLoading ? (
                <p className="text-caption text-neutral-500">{t('loading')}</p>
            ) : sessions.length === 0 ? (
                <p className="text-caption text-neutral-500">{t('sessions.empty')}</p>
            ) : (
                <ul className="divide-y divide-neutral-100">
                    {sessions.map((s) => (
                        <li key={s.id} className="flex flex-wrap items-center gap-3 py-2">
                            <span className="flex min-w-0 flex-1 flex-col">
                                <span className="text-body font-medium text-neutral-800">
                                    {formatDateTime(s.created_at)}
                                </span>
                                <span className="text-caption text-neutral-500">
                                    {t(`status.${s.status}`)}
                                    {' · '}
                                    {t('sessions.summary', { loads: s.loads, copies: s.copies })}
                                </span>
                            </span>
                            <MyButton
                                type="button"
                                buttonType="secondary"
                                scale="small"
                                className="gap-1"
                                onClick={() => onOpen(s.id)}
                            >
                                {s.status === 'OPEN' ? t('sessions.resume') : t('sessions.open')}
                                <ArrowRight size={14} />
                            </MyButton>
                        </li>
                    ))}
                </ul>
            )}
        </section>
    );
};

export default ScanSessionsPanel;
