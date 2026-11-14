import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { UserCheck } from '@phosphor-icons/react';
import type { PanelDeviceRow } from '@/classroom-shared/apiTypes';
import { MyButton } from '@/components/design-system/button';
import { MyDialog } from '@/components/design-system/dialog';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { panelErrorMessage } from '../api';
import { pendingSummary } from './api';

/** "Set up by {installer} and waiting for your approval: 2", above the Panels list. */
export function PendingApprovalBanner({ rows }: { rows: PanelDeviceRow[] }) {
    const { t } = useTranslation('settingsClassroomPanels');
    const { count, installer } = pendingSummary(rows);
    if (count === 0) return null;
    return (
        <Alert role="status" className="border-warning-400 bg-warning-50">
            <AlertDescription className="flex items-start gap-2 text-neutral-700">
                <UserCheck size={18} className="mt-0.5 shrink-0 text-warning-600" />
                <span className="flex flex-col gap-0.5">
                    <span className="font-medium">
                        {installer
                            ? t('installers.approval.banner', { name: installer, count })
                            : t('installers.approval.bannerMixed', { count })}
                    </span>
                    <span className="text-caption text-neutral-600">
                        {t('installers.approval.bannerHelp')}
                    </span>
                </span>
            </AlertDescription>
        </Alert>
    );
}

/**
 * Approving is not destructive, so it is a plain dialog with the primary action rather than the
 * red confirm. It stays open while the call runs and shows a refusal inline.
 */
export function ApproveDialog({
    device,
    onCancel,
    onConfirm,
}: {
    device: PanelDeviceRow | null;
    onCancel: () => void;
    onConfirm: (device: PanelDeviceRow) => Promise<void>;
}) {
    const { t } = useTranslation('settingsClassroomPanels');
    const [busy, setBusy] = useState(false);
    const [failure, setFailure] = useState<string | null>(null);
    const room = device?.room.name ?? '';

    useEffect(() => {
        if (device) {
            setBusy(false);
            setFailure(null);
        }
    }, [device]);

    const approve = async () => {
        if (!device || busy) return;
        setBusy(true);
        setFailure(null);
        try {
            await onConfirm(device);
        } catch (error) {
            setFailure(panelErrorMessage(t, error));
        } finally {
            setBusy(false);
        }
    };

    return (
        <MyDialog
            open={!!device}
            onOpenChange={(next) => {
                if (!next && !busy) onCancel();
            }}
            heading={t('installers.approval.approveTitle', { room })}
            dialogWidth="max-w-md"
        >
            <div className="flex flex-col gap-4">
                <p className="text-body text-neutral-600">
                    {t('installers.approval.approveBody', { room })}
                </p>
                {device?.installed_by && (
                    <p className="text-caption text-neutral-500">
                        {t('installers.approval.installedBy', { name: device.installed_by })}
                    </p>
                )}
                {failure && (
                    <Alert variant="destructive" role="alert">
                        <AlertDescription>{failure}</AlertDescription>
                    </Alert>
                )}
                <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                    <MyButton
                        type="button"
                        buttonType="secondary"
                        disable={busy}
                        onClick={onCancel}
                    >
                        {t('common.cancel')}
                    </MyButton>
                    <MyButton type="button" disable={busy} onClick={() => void approve()}>
                        {busy ? t('common.working') : t('installers.approval.approveConfirm')}
                    </MyButton>
                </div>
            </div>
        </MyDialog>
    );
}
