import { useEffect, useState } from 'react';
import { VideoCamera, Plus, Info, LinkSimple, CircleNotch } from '@phosphor-icons/react';
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
import { listZoomAccounts, initiateZoomOAuth, type ZoomAccountSummary } from '@/services/zoom-accounts';
import { AddZoomAccountDialog } from './AddZoomAccountDialog';
import { ZoomAccountList } from './ZoomAccountList';

/**
 * Self-contained card for the Live Session Settings page that lets an institute
 * admin manage Zoom integration accounts. Data is loaded independently of the
 * surrounding LiveSessionSettings form (Zoom accounts persist via their own
 * REST endpoints, not the institute_setting JSON blob).
 */
export function ZoomIntegrationCard() {
    const { t } = useTranslation('settingsZoomIntegrationCard');
    const [accounts, setAccounts] = useState<ZoomAccountSummary[] | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const [dialogOpen, setDialogOpen] = useState(false);
    const [editTarget, setEditTarget] = useState<ZoomAccountSummary | null>(null);
    const [connecting, setConnecting] = useState(false);

    const refresh = async () => {
        setError(null);
        try {
            const fresh = await listZoomAccounts();
            setAccounts(fresh);
        } catch (e) {
            console.error(e);
            setError(t('errors.loadAccounts'));
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        void refresh();
    }, []);

    // Handle the "Connect with Zoom" OAuth return (server bounced the browser back here).
    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        if (params.get('zoom_connected')) {
            toast.success(t('toasts.connected'));
            void refresh();
        } else if (params.get('zoom_error')) {
            toast.error(t('errors.connectionFailed', { reason: params.get('zoom_error') }));
        }
        if (params.has('zoom_connected') || params.has('zoom_error')) {
            params.delete('zoom_connected');
            params.delete('zoom_error');
            const qs = params.toString();
            window.history.replaceState({}, '', window.location.pathname + (qs ? `?${qs}` : ''));
        }
    }, []);

    const handleConnectZoom = async () => {
        setConnecting(true);
        try {
            const { oauth_url } = await initiateZoomOAuth();
            window.location.href = oauth_url; // leave the SPA for Zoom's consent screen
        } catch (e) {
            console.error(e);
            toast.error(t('errors.connectionStartFailed'));
            setConnecting(false);
        }
    };

    const openCreate = () => {
        setEditTarget(null);
        setDialogOpen(true);
    };

    const openEdit = (a: ZoomAccountSummary) => {
        setEditTarget(a);
        setDialogOpen(true);
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
                        onClick={handleConnectZoom}
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
                    <Button
                        size="sm"
                        variant="outline"
                        onClick={openCreate}
                        disabled={loading}
                    >
                        <Plus size={14} className="mr-1" />
                        {t('addManuallyButton')}
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
                                setLoading(true);
                                void refresh();
                            }}
                        >
                            {t('retry')}
                        </button>
                    </div>
                ) : (
                    <>
                        <ZoomAccountList
                            accounts={accounts ?? []}
                            onChanged={refresh}
                            onEdit={openEdit}
                        />

                        <RetentionNotice />
                    </>
                )}
            </CardContent>

            <AddZoomAccountDialog
                open={dialogOpen}
                onOpenChange={setDialogOpen}
                mode={editTarget ? 'edit' : 'create'}
                account={editTarget}
                onSaved={refresh}
            />
        </Card>
    );
}

function RetentionNotice() {
    return (
        <div className="mt-4 flex items-start gap-2 rounded-md border border-blue-200 bg-blue-50/60 p-3 text-xs text-blue-800">
            <Info size={14} className="mt-0.5 shrink-0" />
            <div className="leading-relaxed">
                <Trans
                    i18nKey="settingsZoomIntegrationCard:retentionNotice.text"
                    components={{ strong: <strong /> }}
                />
            </div>
        </div>
    );
}
