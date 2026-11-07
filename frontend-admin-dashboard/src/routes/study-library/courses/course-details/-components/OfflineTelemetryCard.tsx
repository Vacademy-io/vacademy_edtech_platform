import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { MyButton } from '@/components/design-system/button';
import { MyDialog } from '@/components/design-system/dialog';
import { StatusChips } from '@/components/design-system/chips';
import { CloudArrowDown } from '@phosphor-icons/react';
import { toast } from 'sonner';
import {
    getOfflineDiscrepancies,
    getOfflineLearnerDownloads,
    reviewOfflineDiscrepancy,
    revokeOfflineDevice,
} from '@/services/offline-access';
import type {
    OfflineLearnerDownloadDTO,
    OfflineSyncDiscrepancyDTO,
} from '@/types/offline-access';

interface OfflineTelemetryCardProps {
    packageSessionId: string;
}

/** Dates arrive as ISO strings (or null when a device has never checked in). */
const formatDate = (value: string | null | undefined, locale: string): string =>
    value ? new Date(value).toLocaleDateString(locale, { dateStyle: 'medium' }) : '—';

/**
 * Offline plan Part A4/A5: who is holding this batch offline.
 *
 * This used to show two counters ("N learners with downloads", "N active
 * devices"), which told an admin that something was downloaded but never who —
 * and revoking a learner's access meant hunting for them in the students list.
 * The table below is the same data at the row level, with revoke where the
 * admin already is.
 */
export const OfflineTelemetryCard: React.FC<OfflineTelemetryCardProps> = ({ packageSessionId }) => {
    const { t, i18n } = useTranslation('studyLibraryOfflineTelemetryCard');
    const [rows, setRows] = useState<OfflineLearnerDownloadDTO[]>([]);
    const [loading, setLoading] = useState(true);
    const [failed, setFailed] = useState(false);
    const [discrepancyDialogOpen, setDiscrepancyDialogOpen] = useState(false);
    const [pendingRevoke, setPendingRevoke] = useState<OfflineLearnerDownloadDTO | null>(null);
    const [revoking, setRevoking] = useState(false);

    const load = useCallback(() => {
        if (!packageSessionId) return;
        setLoading(true);
        setFailed(false);
        getOfflineLearnerDownloads(packageSessionId)
            .then(setRows)
            .catch(() => {
                setRows([]);
                setFailed(true);
            })
            .finally(() => setLoading(false));
    }, [packageSessionId]);

    useEffect(load, [load]);

    const handleRevoke = async () => {
        if (!pendingRevoke) return;
        setRevoking(true);
        try {
            await revokeOfflineDevice(pendingRevoke.device_id, t('revoke.reason'));
            toast.success(t('toast.revokeSuccess'));
            // The device keeps its row (it still holds content until it next
            // checks in and purges), so reflect the new status in place.
            setRows((prev) =>
                prev.map((row) =>
                    row.device_id === pendingRevoke.device_id
                        ? { ...row, device_status: 'REVOKED' as const }
                        : row
                )
            );
            setPendingRevoke(null);
        } catch {
            toast.error(t('toast.revokeFailed'));
        } finally {
            setRevoking(false);
        }
    };

    return (
        <Card>
            <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 space-y-0">
                <CardTitle className="flex items-center gap-2">
                    <CloudArrowDown className="size-5 text-primary-500" />
                    {t('header.title')}
                </CardTitle>
                <MyButton
                    buttonType="secondary"
                    scale="small"
                    onClick={() => setDiscrepancyDialogOpen(true)}
                >
                    {t('header.reviewDiscrepancies')}
                </MyButton>
            </CardHeader>
            <CardContent>
                {loading ? (
                    <div className="py-8 text-center text-body text-neutral-500">
                        {t('states.loading')}
                    </div>
                ) : failed ? (
                    <div className="flex flex-col items-center gap-3 py-8">
                        <p className="text-body text-neutral-500">{t('states.loadFailed')}</p>
                        <MyButton buttonType="secondary" scale="small" onClick={load}>
                            {t('actions.tryAgain')}
                        </MyButton>
                    </div>
                ) : rows.length === 0 ? (
                    <div className="py-8 text-center text-body text-neutral-500">
                        {t('states.noDownloads')}
                    </div>
                ) : (
                    <div className="overflow-x-auto rounded-lg border border-neutral-100">
                        <table className="w-full text-left text-body">
                            <thead className="bg-neutral-50 text-caption text-neutral-500">
                                <tr>
                                    <th className="p-3">{t('table.learner')}</th>
                                    <th className="p-3">{t('table.username')}</th>
                                    <th className="p-3">{t('table.email')}</th>
                                    <th className="p-3">{t('table.device')}</th>
                                    <th className="p-3">{t('table.downloaded')}</th>
                                    <th className="p-3">{t('table.validTill')}</th>
                                    <th className="p-3" />
                                </tr>
                            </thead>
                            <tbody>
                                {rows.map((row) => (
                                    <tr
                                        key={`${row.user_id}-${row.device_id}`}
                                        className="border-t border-neutral-100"
                                    >
                                        <td className="p-3">
                                            <div className="font-medium text-neutral-700">
                                                {row.full_name || '—'}
                                            </div>
                                            <div className="text-caption text-neutral-500">
                                                {t('table.itemCount', {
                                                    count: row.downloaded_slides,
                                                })}
                                            </div>
                                        </td>
                                        <td className="p-3 text-neutral-600">
                                            {row.username || '—'}
                                        </td>
                                        <td className="p-3 text-neutral-600">{row.email || '—'}</td>
                                        <td className="p-3">
                                            <div className="flex items-center gap-2">
                                                <StatusChips
                                                    status={
                                                        row.device_status === 'ACTIVE'
                                                            ? 'ACTIVE'
                                                            : 'INACTIVE'
                                                    }
                                                    showIcon={false}
                                                >
                                                    {row.device_status === 'ACTIVE'
                                                        ? t('status.active')
                                                        : t('status.revoked')}
                                                </StatusChips>
                                                <span className="text-caption text-neutral-500">
                                                    {row.device_name ||
                                                        row.platform ||
                                                        t('table.deviceFallback')}
                                                </span>
                                            </div>
                                        </td>
                                        <td className="p-3 text-neutral-600">
                                            {formatDate(row.last_downloaded_at, i18n.language)}
                                        </td>
                                        <td className="p-3 text-neutral-600">
                                            {formatDate(row.lease_expires_at, i18n.language)}
                                        </td>
                                        <td className="p-3 text-right">
                                            {row.device_status === 'ACTIVE' && (
                                                <MyButton
                                                    buttonType="secondary"
                                                    scale="small"
                                                    onClick={() => setPendingRevoke(row)}
                                                >
                                                    {t('actions.revokeAccess')}
                                                </MyButton>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </CardContent>

            <DiscrepancyReviewDialog
                open={discrepancyDialogOpen}
                onClose={() => setDiscrepancyDialogOpen(false)}
                packageSessionId={packageSessionId}
            />

            {/* Revoking wipes the learner's downloaded content on that device the
                next time it connects, so it confirms first. */}
            <MyDialog
                open={pendingRevoke !== null}
                onOpenChange={(open) => !open && setPendingRevoke(null)}
                heading={t('revoke.dialogHeading')}
                dialogWidth="max-w-lg"
            >
                <div className="space-y-4 p-1">
                    <p className="text-body text-neutral-600">
                        {t('revoke.confirmationText', {
                            learnerName: pendingRevoke?.full_name || t('revoke.thisLearner'),
                            deviceName: pendingRevoke?.device_name || t('revoke.thisDevice'),
                        })}
                    </p>
                    <div className="flex justify-end gap-3 border-t pt-4">
                        <MyButton
                            buttonType="secondary"
                            disabled={revoking}
                            onClick={() => setPendingRevoke(null)}
                        >
                            {t('actions.cancel')}
                        </MyButton>
                        <MyButton
                            buttonType="primary"
                            disabled={revoking}
                            onClick={() => void handleRevoke()}
                        >
                            {revoking ? t('actions.revoking') : t('actions.revokeAccess')}
                        </MyButton>
                    </div>
                </div>
            </MyDialog>
        </Card>
    );
};

interface DiscrepancyReviewDialogProps {
    open: boolean;
    onClose: () => void;
    packageSessionId: string;
}

function DiscrepancyReviewDialog({ open, onClose, packageSessionId }: DiscrepancyReviewDialogProps) {
    const { t, i18n } = useTranslation('studyLibraryOfflineTelemetryCard');
    const [rows, setRows] = useState<OfflineSyncDiscrepancyDTO[]>([]);
    const [loading, setLoading] = useState(false);

    const load = () => {
        setLoading(true);
        getOfflineDiscrepancies(packageSessionId, 'OPEN')
            .then((page) => setRows(page.content))
            .catch(() => toast.error(t('discrepancy.loadFailed')))
            .finally(() => setLoading(false));
    };

    useEffect(() => {
        if (open) load();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

    const handleReview = async (id: string) => {
        try {
            await reviewOfflineDiscrepancy(id);
            setRows((prev) => prev.filter((r) => r.id !== id));
            toast.success(t('discrepancy.markedReviewed'));
        } catch {
            toast.error(t('discrepancy.updateFailed'));
        }
    };

    return (
        <MyDialog
            open={open}
            onOpenChange={onClose}
            heading={t('discrepancy.dialogHeading')}
            dialogWidth="max-w-3xl"
        >
            <div className="space-y-4 p-1">
                <p className="text-caption text-neutral-500">{t('discrepancy.explainer')}</p>
                {loading ? (
                    <div className="py-8 text-center text-sm text-neutral-500">
                        {t('states.loading')}
                    </div>
                ) : rows.length === 0 ? (
                    <div className="py-8 text-center text-sm text-neutral-500">
                        {t('discrepancy.noOpenDiscrepancies')}
                    </div>
                ) : (
                    <div className="overflow-x-auto rounded-lg border border-neutral-100">
                        <table className="w-full text-left text-body">
                            <thead className="bg-neutral-50 text-caption text-neutral-500">
                                <tr>
                                    <th className="p-3">{t('discrepancy.table.field')}</th>
                                    <th className="p-3">{t('discrepancy.table.clientValue')}</th>
                                    <th className="p-3">{t('discrepancy.table.serverValue')}</th>
                                    <th className="p-3">{t('discrepancy.table.created')}</th>
                                    <th className="p-3" />
                                </tr>
                            </thead>
                            <tbody>
                                {rows.map((row) => (
                                    <tr key={row.id} className="border-t border-neutral-100">
                                        <td className="p-3">{row.field}</td>
                                        <td className="p-3 text-danger-600">{row.client_value}</td>
                                        <td className="p-3 text-success-600">{row.server_value}</td>
                                        <td className="p-3 text-caption text-neutral-500">
                                            {new Date(row.created_at).toLocaleString(
                                                i18n.language
                                            )}
                                        </td>
                                        <td className="p-3">
                                            <MyButton
                                                buttonType="secondary"
                                                scale="small"
                                                onClick={() => handleReview(row.id)}
                                            >
                                                {t('discrepancy.markReviewed')}
                                            </MyButton>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
                <div className="flex justify-end border-t pt-4">
                    <MyButton buttonType="secondary" onClick={onClose}>
                        {t('actions.close')}
                    </MyButton>
                </div>
            </div>
        </MyDialog>
    );
}
