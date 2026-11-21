import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { GoogleLogo, CheckCircle, WarningCircle } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { Skeleton } from '@/components/ui/skeleton';
import { getInstituteId } from '@/constants/helper';
import { reportApiError } from '@/lib/report-api-error';
import { useDisconnectMyGoogle, useMyGoogle } from '../-hooks/use-meetings';
import { initiateMyGoogle } from '../-services/meetings-services';
import { SideCard } from './meetings-page-parts';

/**
 * "Your Google calendar" side card on My Schedule. Each host connects THEIR OWN Google
 * account here — their meetings, Meet links and calendar events use it instead of the
 * institute-wide account from Live Session settings. The OAuth callback lands back on
 * this page with ?google_connected=1 or ?google_error=...
 */
export function MyGoogleCard() {
    const { t } = useTranslation('meetingsMyScheduleIndexLazy');
    const instituteId = getInstituteId();
    const { data, isLoading, error, refetch } = useMyGoogle(instituteId);
    const disconnect = useDisconnectMyGoogle();
    const [connecting, setConnecting] = useState(false);

    // Report the OAuth result once, then strip the params so a refresh doesn't repeat it.
    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        if (!params.has('google_connected') && !params.has('google_error')) return;
        if (params.has('google_connected')) {
            toast.success(t('googleCard.justConnected'));
            refetch();
        } else {
            toast.error(t('googleCard.connectFailed'));
        }
        params.delete('google_connected');
        params.delete('google_error');
        params.delete('google_reason');
        const query = params.toString();
        window.history.replaceState(
            null,
            '',
            window.location.pathname + (query ? `?${query}` : '') + window.location.hash
        );
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const connect = async () => {
        if (!instituteId) return;
        setConnecting(true);
        try {
            const { oauth_url } = await initiateMyGoogle(instituteId);
            window.location.href = oauth_url;
        } catch (e) {
            reportApiError(e, {
                feature: 'meetings',
                tags: { 'meetings.action': 'connect-google' },
                fallbackMessage: t('googleCard.connectError'),
            });
            setConnecting(false);
        }
    };

    const onDisconnect = () => {
        if (!instituteId) return;
        disconnect.mutate(instituteId, {
            onSuccess: () => toast.success(t('googleCard.disconnected')),
            onError: (e) =>
                reportApiError(e, {
                    feature: 'meetings',
                    tags: { 'meetings.action': 'disconnect-google' },
                    fallbackMessage: t('googleCard.disconnectError'),
                }),
        });
    };

    const connected = !!data?.connected;
    const needsReconnect = connected && data?.status === 'RECONNECT_NEEDED';

    let body: React.ReactNode;
    if (isLoading) {
        body = <Skeleton className="h-12 w-full" />;
    } else if (error) {
        body = (
            <p className="flex items-center gap-1.5 text-caption text-neutral-500">
                <WarningCircle size={14} className="shrink-0 text-danger-600" />
                {t('googleCard.connectError')}
            </p>
        );
    } else {
        body = (
            <div className="flex flex-col gap-2">
                <p className="text-caption text-neutral-500">
                    {connected
                        ? t('googleCard.connectedDescription')
                        : t('googleCard.disconnectedDescription')}
                </p>
                {connected && data?.email && (
                    <span className="flex items-center gap-1 truncate text-caption font-medium text-neutral-700">
                        {needsReconnect ? (
                            <WarningCircle size={14} className="shrink-0 text-warning-600" />
                        ) : (
                            <CheckCircle
                                size={14}
                                weight="fill"
                                className="shrink-0 text-success-600"
                            />
                        )}
                        <span className="truncate">{data.email}</span>
                    </span>
                )}
                <div className="flex flex-wrap gap-2">
                    {(!connected || needsReconnect) && (
                        <MyButton
                            type="button"
                            buttonType="primary"
                            scale="small"
                            className="sm:min-w-0"
                            onClick={connect}
                            disable={connecting}
                        >
                            {connecting
                                ? t('googleCard.redirecting')
                                : needsReconnect
                                  ? t('googleCard.reconnect_btn')
                                  : t('googleCard.connect')}
                        </MyButton>
                    )}
                    {connected && (
                        <MyButton
                            type="button"
                            buttonType="secondary"
                            scale="small"
                            className="sm:min-w-0"
                            onClick={onDisconnect}
                            disable={disconnect.isPending}
                        >
                            {t('googleCard.disconnect')}
                        </MyButton>
                    )}
                </div>
            </div>
        );
    }

    return (
        <SideCard
            icon={GoogleLogo}
            title={t('googleCard.title')}
            action={
                connected ? (
                    <span className="shrink-0 rounded-full bg-success-50 px-2.5 py-0.5 text-caption text-success-600">
                        {needsReconnect ? t('googleCard.reconnect') : t('googleCard.connected')}
                    </span>
                ) : undefined
            }
        >
            {body}
        </SideCard>
    );
}
