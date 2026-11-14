import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Trans, useTranslation } from 'react-i18next';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { MyButton } from '@/components/design-system/button';
import { StatusChips } from '@/components/design-system/chips';
import { MyDialog } from '@/components/design-system/dialog';
import { CloudArrowDown, DeviceMobile, Desktop } from '@phosphor-icons/react';
import { toast } from 'sonner';
import { getOfflineDevicesForUser, revokeOfflineDevice } from '@/services/offline-access';
import type { OfflineDeviceDTO } from '@/types/offline-access';

/**
 * Admin view of a learner's registered offline devices (offline plan Part A3),
 * inside Portal Access ("who has access?"). Revoking a device makes the
 * learner app purge ALL its downloaded content and lose offline access at its
 * next online check-in — it does not change any course permissions.
 */
export const OfflineDevicesCard = ({ userId }: { userId: string }) => {
    const { t } = useTranslation('manageStudentsOfflineDevicesCard');
    const queryClient = useQueryClient();
    const [confirmDevice, setConfirmDevice] = useState<OfflineDeviceDTO | null>(null);

    const { data: devices, isLoading } = useQuery({
        queryKey: ['offline-devices', userId],
        queryFn: () => getOfflineDevicesForUser(userId),
        enabled: !!userId,
    });

    const { mutate: revoke, isPending: revoking } = useMutation({
        mutationFn: (deviceId: string) => revokeOfflineDevice(deviceId, 'Revoked by admin'),
        onSuccess: () => {
            toast.success(t('toast.revokeSuccess'));
            queryClient.invalidateQueries({ queryKey: ['offline-devices', userId] });
            setConfirmDevice(null);
        },
        onError: () => toast.error(t('toast.revokeFailed')),
    });

    if (!userId) return null;

    const formatDate = (value?: string) =>
        value ? new Date(value).toLocaleDateString() : '—';

    return (
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2 text-body font-semibold">
                    <CloudArrowDown className="size-5 text-primary-500" />
                    {t('heading')}
                </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
                {isLoading ? (
                    <p className="text-caption text-neutral-500">{t('loading')}</p>
                ) : !devices?.length ? (
                    <p className="text-caption text-neutral-500">{t('emptyState')}</p>
                ) : (
                    devices.map((device) => (
                        <div
                            key={device.id}
                            className="flex items-center justify-between gap-3 rounded-md border border-neutral-200 p-3"
                        >
                            <div className="flex items-center gap-3">
                                {device.platform === 'DESKTOP' ? (
                                    <Desktop className="size-5 text-neutral-500" />
                                ) : (
                                    <DeviceMobile className="size-5 text-neutral-500" />
                                )}
                                <div>
                                    <p className="text-body font-medium">
                                        {device.device_name || device.platform || t('device.fallbackName')}
                                    </p>
                                    <p className="text-caption text-neutral-500">
                                        {t('device.checkinInfo', {
                                            checkinDate: formatDate(device.last_checkin_at),
                                            leaseDate: formatDate(device.lease_expires_at),
                                        })}
                                    </p>
                                </div>
                            </div>
                            <div className="flex items-center gap-2">
                                <StatusChips
                                    status={device.status === 'ACTIVE' ? 'ACTIVE' : 'TERMINATED'}
                                    showIcon={false}
                                >
                                    {device.status === 'ACTIVE' ? t('status.active') : t('status.revoked')}
                                </StatusChips>
                                {device.status === 'ACTIVE' && (
                                    <MyButton
                                        buttonType="secondary"
                                        scale="small"
                                        onClick={() => setConfirmDevice(device)}
                                    >
                                        {t('actions.revoke')}
                                    </MyButton>
                                )}
                            </div>
                        </div>
                    ))
                )}
            </CardContent>

            <MyDialog
                heading={t('confirmDialog.heading')}
                open={!!confirmDevice}
                onOpenChange={(open) => !open && setConfirmDevice(null)}
                footer={
                    <div className="flex w-full justify-end gap-2">
                        <MyButton
                            buttonType="secondary"
                            scale="small"
                            onClick={() => setConfirmDevice(null)}
                            disabled={revoking}
                        >
                            {t('actions.cancel')}
                        </MyButton>
                        <MyButton
                            buttonType="primary"
                            scale="small"
                            className="bg-danger-500 hover:bg-danger-600"
                            onClick={() => confirmDevice && revoke(confirmDevice.id)}
                            disabled={revoking}
                        >
                            {revoking ? t('actions.revoking') : t('actions.revokeDevice')}
                        </MyButton>
                    </div>
                }
            >
                <p className="p-1 text-body text-neutral-600">
                    <Trans
                        t={t}
                        i18nKey="confirmDialog.body"
                        values={{
                            deviceName:
                                confirmDevice?.device_name || t('confirmDialog.fallbackDeviceName'),
                        }}
                        components={{ strong: <span className="font-medium" /> }}
                    />
                </p>
            </MyDialog>
        </Card>
    );
};
