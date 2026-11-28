/**
 * The dialogs a Start can lead to. All at 10-foot sizes, and all unmount with the Today
 * strip, so a class name never outlives the teacher's session on screen.
 */
import type { ReactNode } from 'react';
import QRCode from 'react-qr-code';
import { useTranslation } from 'react-i18next';
import {
    AlertDialog,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { MyButton } from '@/components/design-system/button';
import type { TodayClass } from '@/classroom-shared/apiTypes';
import { useQrSize } from '../device/useQrSize';
import { useDeviceRecord } from '../device/store';
import { syncNow, useSyncSnapshot } from '../device/syncLoop';
import { buildDeviceStartUrl, deviceStartAddress } from './deviceLink';
import type { DeviceReason } from './startClass';

interface DialogFrameProps {
    open: boolean;
    onClose: () => void;
    title: string;
    description?: ReactNode;
    closeLabel: string;
    children?: ReactNode;
    actions?: ReactNode;
}

function DialogFrame({
    open,
    onClose,
    title,
    description,
    closeLabel,
    children,
    actions,
}: DialogFrameProps) {
    return (
        <AlertDialog
            open={open}
            onOpenChange={(next) => {
                if (!next) onClose();
            }}
        >
            <AlertDialogContent className="max-w-4xl p-8">
                <AlertDialogHeader className="space-y-2">
                    <AlertDialogTitle className="text-h2 font-semibold text-neutral-800">
                        {title}
                    </AlertDialogTitle>
                    {description && (
                        <AlertDialogDescription className="text-title text-neutral-600">
                            {description}
                        </AlertDialogDescription>
                    )}
                </AlertDialogHeader>
                {children}
                <AlertDialogFooter className="pt-4 sm:space-x-4">
                    <AlertDialogCancel asChild>
                        <MyButton buttonType="secondary" scale="large" className="h-16 px-8">
                            {closeLabel}
                        </MyButton>
                    </AlertDialogCancel>
                    {actions}
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
}

export interface DeviceDialogState {
    item: TodayClass;
    reason: DeviceReason;
}

const REASON_KEYS: Record<DeviceReason, string> = {
    unsupported: 'device.whyUnsupported',
    'no-browser': 'device.whyNoBrowser',
    'no-meeting-screen': 'device.whyNoMeetingScreen',
    chosen: 'device.whyChosen',
};

/** The QR holds the phone page's address, the schedule id and the institute id, nothing else. */
export function DeviceStartDialog({
    state,
    onClose,
}: {
    state: DeviceDialogState;
    onClose: () => void;
}) {
    const { t } = useTranslation('classes');
    const device = useDeviceRecord();
    const sync = useSyncSnapshot();
    const qrSize = useQrSize();
    const url = device
        ? buildDeviceStartUrl(device.approve_base_url, state.item.schedule_id, device.institute_id)
        : null;

    return (
        <DialogFrame
            open
            onClose={onClose}
            title={t('device.title')}
            description={t(REASON_KEYS[state.reason])}
            closeLabel={t('device.close')}
            actions={
                !url && (
                    <MyButton
                        buttonType="primary"
                        scale="large"
                        className="h-16 px-8"
                        onClick={() => syncNow()}
                    >
                        {t('today.retry')}
                    </MyButton>
                )
            }
        >
            {url ? (
                <div className="flex items-center pt-2">
                    <div className="shrink-0 rounded-lg bg-white p-4 shadow-sm">
                        <QRCode value={url} size={qrSize} level="M" />
                    </div>
                    <div className="min-w-0 space-y-2 pl-6">
                        <p className="truncate text-title font-semibold text-neutral-800">
                            {state.item.title || t('card.untitled')}
                        </p>
                        <p className="text-subtitle text-neutral-600">{t('device.scan')}</p>
                        <p className="break-all text-subtitle font-semibold text-neutral-800">
                            {deviceStartAddress(device?.approve_base_url)}
                        </p>
                        {sync.session?.phone_connected && (
                            <p className="text-subtitle text-success-600">
                                {t('device.phoneShows')}
                            </p>
                        )}
                    </div>
                </div>
            ) : (
                <p className="pt-2 text-title text-neutral-600">{t('device.noAddress')}</p>
            )}
        </DialogFrame>
    );
}

export function RecreateBlockedDialog({
    message,
    onClose,
}: {
    message: string | null;
    onClose: () => void;
}) {
    const { t } = useTranslation('classes');
    return (
        <DialogFrame
            open
            onClose={onClose}
            title={t('blocked.title')}
            description={message || t('blocked.body')}
            closeLabel={t('blocked.close')}
        />
    );
}

export function StartFailedDialog({
    noLink,
    onClose,
    onRetry,
    onUseDevice,
}: {
    noLink: boolean;
    onClose: () => void;
    onRetry: () => void;
    onUseDevice: () => void;
}) {
    const { t } = useTranslation('classes');
    return (
        <DialogFrame
            open
            onClose={onClose}
            title={t('failed.title')}
            description={noLink ? t('failed.noLink') : t('failed.body')}
            closeLabel={t('failed.close')}
            actions={
                <>
                    <MyButton
                        buttonType="secondary"
                        scale="large"
                        className="h-16 px-8"
                        onClick={onUseDevice}
                    >
                        {t('failed.useDevice')}
                    </MyButton>
                    <MyButton
                        buttonType="primary"
                        scale="large"
                        className="h-16 px-8"
                        onClick={onRetry}
                    >
                        {t('failed.retry')}
                    </MyButton>
                </>
            }
        />
    );
}
