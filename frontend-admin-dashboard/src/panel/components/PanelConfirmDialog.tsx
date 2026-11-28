/**
 * Large confirm dialog for destructive or session-ending actions (AlertDialog
 * primitive + MyButton, 10-foot sizes). Button order: [secondary Cancel] [primary Confirm].
 */
import type { ReactNode } from 'react';
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

export interface PanelConfirmDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    title: string;
    description?: ReactNode;
    confirmLabel: string;
    cancelLabel?: string;
    /** May be async; the confirm button shows a spinner and blocks double taps. */
    onConfirm: () => void | Promise<void>;
}

export function PanelConfirmDialog({
    open,
    onOpenChange,
    title,
    description,
    confirmLabel,
    cancelLabel,
    onConfirm,
}: PanelConfirmDialogProps) {
    const { t } = useTranslation('panel');
    return (
        <AlertDialog open={open} onOpenChange={onOpenChange}>
            <AlertDialogContent className="max-w-3xl p-8">
                <AlertDialogHeader className="space-y-4">
                    <AlertDialogTitle className="text-h2 font-semibold text-neutral-800">
                        {title}
                    </AlertDialogTitle>
                    {description && (
                        <AlertDialogDescription className="text-title text-neutral-600">
                            {description}
                        </AlertDialogDescription>
                    )}
                </AlertDialogHeader>
                <AlertDialogFooter className="pt-6 sm:space-x-4">
                    <AlertDialogCancel asChild>
                        <MyButton buttonType="secondary" scale="large" className="h-16 px-8">
                            {cancelLabel ?? t('common.cancel')}
                        </MyButton>
                    </AlertDialogCancel>
                    <MyButton
                        buttonType="primary"
                        scale="large"
                        className="h-16 px-8"
                        onAsyncClick={async () => {
                            await onConfirm();
                            onOpenChange(false);
                        }}
                    >
                        {confirmLabel}
                    </MyButton>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
}
