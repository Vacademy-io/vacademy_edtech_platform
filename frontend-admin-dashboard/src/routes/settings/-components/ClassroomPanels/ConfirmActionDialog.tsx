import { useEffect, useState, type MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { panelErrorMessage } from './api';

/**
 * Confirm for an action that cannot be undone from here. It stays open while the call runs and
 * shows a failure inline, so the admin can retry without finding the row again.
 */
export function ConfirmActionDialog({
    open,
    title,
    body,
    confirmLabel,
    onCancel,
    onConfirm,
    errorText,
}: {
    open: boolean;
    title: string;
    body: string;
    confirmLabel: string;
    onCancel: () => void;
    /** Resolves when done. A rejection keeps the dialog open with the error shown. */
    onConfirm: () => Promise<void>;
    /** Overrides the default wording for a failure. */
    errorText?: (error: unknown) => string | null;
}) {
    const { t } = useTranslation('settingsClassroomPanels');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (open) {
            setBusy(false);
            setError(null);
        }
    }, [open]);

    const confirm = async (event: MouseEvent) => {
        event.preventDefault();
        if (busy) return;
        setBusy(true);
        setError(null);
        try {
            await onConfirm();
        } catch (failure) {
            setError(errorText?.(failure) ?? panelErrorMessage(t, failure));
        } finally {
            setBusy(false);
        }
    };

    return (
        <AlertDialog
            open={open}
            onOpenChange={(next) => {
                if (!next && !busy) onCancel();
            }}
        >
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>{title}</AlertDialogTitle>
                    <AlertDialogDescription>{body}</AlertDialogDescription>
                </AlertDialogHeader>
                {error && (
                    <Alert variant="destructive" role="alert">
                        <AlertDescription>{error}</AlertDescription>
                    </Alert>
                )}
                <AlertDialogFooter>
                    <AlertDialogCancel disabled={busy}>{t('common.cancel')}</AlertDialogCancel>
                    <AlertDialogAction
                        onClick={confirm}
                        disabled={busy}
                        className="bg-danger-600 text-white hover:bg-danger-500"
                    >
                        {busy ? t('common.working') : confirmLabel}
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
}
