import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { VideoCamera, Info, LinkSimple, CircleNotch } from '@phosphor-icons/react';
import { toast } from 'sonner';
import { Trans, useTranslation } from 'react-i18next';

import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { listGoogleAccounts, initiateGoogleOAuth } from '@/services/google-accounts';
import { GoogleAccountList } from './GoogleAccountList';

/**
 * Self-contained card for the Live Session Settings page that lets an institute admin connect a
 * Google Workspace account (per-tenant OAuth) so admins can create Google Meet sessions from the
 * live-class wizard. Data loads independently of the surrounding LiveSessionSettings form
 * (accounts persist via their own REST endpoints, not the institute_setting JSON blob).
 */
export function GoogleMeetIntegrationCard() {
    const { t } = useTranslation('settingsGoogleMeetIntegrationCard');
    // Shared with the Google Meet defaults card and the live-class wizard, so an auto-record
    // change made in one place shows everywhere.
    const {
        data: accounts,
        isLoading: loading,
        isError,
        refetch,
    } = useQuery({
        queryKey: ['google-accounts'],
        queryFn: listGoogleAccounts,
        // Show a load error straight away, as before (no silent retries).
        retry: false,
    });
    const error = isError ? t('errors.loadAccounts') : null;
    const [connecting, setConnecting] = useState(false);

    const refresh = async () => {
        await refetch();
    };

    // Handle the "Connect Google Workspace" OAuth return (server bounced the browser back here).
    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        if (params.get('google_connected')) {
            toast.success(t('toasts.connected'));
            void refresh();
        } else if (params.get('google_error')) {
            const errorCode = params.get('google_error');
            const reason = params.get('google_reason');
            toast.error(
                reason
                    ? t('errors.connectionFailedWithReason', { errorCode, reason })
                    : t('errors.connectionFailed', { errorCode })
            );
        }
        if (params.has('google_connected') || params.has('google_error')) {
            params.delete('google_connected');
            params.delete('google_error');
            params.delete('google_reason');
            const qs = params.toString();
            window.history.replaceState({}, '', window.location.pathname + (qs ? `?${qs}` : ''));
        }
    }, []);

    const handleConnect = async () => {
        setConnecting(true);
        try {
            const { oauth_url } = await initiateGoogleOAuth();
            window.location.href = oauth_url; // leave the SPA for Google's consent screen
        } catch (e) {
            console.error(e);
            toast.error(t('errors.connectionStartFailed'));
            setConnecting(false);
        }
    };

    return (
        <Card className="border-neutral-200 shadow-none">
            <CardHeader className="flex-row items-start gap-3 space-y-0 p-5 pb-4">
                <div className="flex size-9 items-center justify-center rounded-md bg-primary-50 text-primary-500">
                    <VideoCamera size={18} />
                </div>
                <div className="flex-1">
                    <CardTitle className="text-base">{t('title')}</CardTitle>
                    <CardDescription>{t('description')}</CardDescription>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                    <Button
                        size="sm"
                        onClick={handleConnect}
                        disabled={loading || connecting}
                        className="bg-primary-500 hover:bg-primary-600"
                    >
                        {connecting ? (
                            <CircleNotch className="mr-1 size-3.5 animate-spin" />
                        ) : (
                            <LinkSimple size={14} className="mr-1" />
                        )}
                        {t('connectButton')}
                    </Button>
                </div>
            </CardHeader>

            <CardContent className="border-t border-neutral-100 p-5">
                {loading ? (
                    <div className="flex h-16 items-center justify-center text-neutral-400">
                        <CircleNotch className="size-5 animate-spin" />
                    </div>
                ) : error ? (
                    <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                        {error}{' '}
                        <button
                            type="button"
                            className="ml-1 underline"
                            onClick={() => {
                                void refresh();
                            }}
                        >
                            {t('retry')}
                        </button>
                    </div>
                ) : (
                    <>
                        <GoogleAccountList accounts={accounts ?? []} onChanged={refresh} />
                        <RecordingNotice />
                    </>
                )}
            </CardContent>
        </Card>
    );
}

function RecordingNotice() {
    return (
        <div className="mt-4 flex items-start gap-2 rounded-md border border-blue-200 bg-blue-50/60 p-3 text-xs text-blue-800">
            <Info size={14} className="mt-0.5 shrink-0" />
            <div className="leading-relaxed">
                <Trans
                    i18nKey="settingsGoogleMeetIntegrationCard:recordingNotice.text"
                    components={{ strong: <strong /> }}
                />
            </div>
        </div>
    );
}
