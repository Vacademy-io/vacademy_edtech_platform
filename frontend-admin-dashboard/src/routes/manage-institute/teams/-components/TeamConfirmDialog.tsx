import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
    CheckCircle,
    Info,
    PaperPlaneTilt,
    Prohibit,
    Trash,
    Warning,
    XCircle,
    type Icon,
} from '@phosphor-icons/react';
import {
    AlertDialog,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { MyButton } from '@/components/design-system/button';
import { cn } from '@/lib/utils';

export type TeamConfirmKind = 'disable' | 'enable' | 'delete' | 'resend' | 'cancel' | 'discard';

const KIND_STYLE: Record<TeamConfirmKind, { icon: Icon; tile: string; destructive: boolean }> = {
    disable: { icon: Prohibit, tile: 'bg-warning-50 text-warning-700', destructive: true },
    enable: { icon: CheckCircle, tile: 'bg-success-50 text-success-700', destructive: false },
    delete: { icon: Trash, tile: 'bg-danger-100 text-danger-700', destructive: true },
    resend: { icon: PaperPlaneTilt, tile: 'bg-info-50 text-info-600', destructive: false },
    cancel: { icon: XCircle, tile: 'bg-danger-100 text-danger-700', destructive: true },
    discard: { icon: Warning, tile: 'bg-warning-50 text-warning-700', destructive: true },
};

interface TeamConfirmDialogProps {
    kind: TeamConfirmKind | null;
    /** Person the action is about. */
    name: string;
    email?: string;
    busy?: boolean;
    onConfirm: () => void;
    onClose: () => void;
    /** Delete only: offer "Disable instead" for an active member. */
    onDisableInstead?: () => void;
}

/** One confirm dialog for every Teams action that changes access or can't be undone. */
export function TeamConfirmDialog({
    kind,
    name,
    email,
    busy = false,
    onConfirm,
    onClose,
    onDisableInstead,
}: TeamConfirmDialogProps) {
    const { t } = useTranslation('manageInstituteTeamsIndexLazy');
    if (!kind) return null;
    const style = KIND_STYLE[kind];
    const KindIcon = style.icon;
    const firstName = name.trim().split(/\s+/)[0] || name;
    const bold = (text: string): ReactNode => (
        <span className="font-semibold text-neutral-900">{text}</span>
    );

    const body: Record<TeamConfirmKind, ReactNode> = {
        disable: (
            <>
                {bold(firstName)} {t('confirm.disable.body')}
            </>
        ),
        enable: (
            <>
                {bold(firstName)} {t('confirm.enable.body')}
            </>
        ),
        delete: (
            <>
                {bold(firstName)} {t('confirm.delete.body')}
            </>
        ),
        resend: (
            <>
                {t('confirm.resend.body')} {bold(email ?? '')}
            </>
        ),
        cancel: (
            <>
                {bold(firstName)} {t('confirm.cancel.body')}
            </>
        ),
        discard: t('confirm.discard.body', { name: firstName }),
    };

    return (
        <AlertDialog open onOpenChange={(open) => !open && !busy && onClose()}>
            <AlertDialogContent className="max-w-md gap-0 overflow-hidden p-0">
                <div className="flex gap-4 p-6">
                    <span
                        className={cn(
                            'flex size-11 shrink-0 items-center justify-center rounded-full',
                            style.tile
                        )}
                    >
                        <KindIcon size={22} />
                    </span>
                    <div className="min-w-0 flex-1">
                        <AlertDialogTitle className="text-title font-semibold text-neutral-900">
                            {t(`confirm.${kind}.title`, { name })}
                        </AlertDialogTitle>
                        <AlertDialogDescription asChild>
                            <p className="mt-1.5 text-body text-neutral-600">{body[kind]}</p>
                        </AlertDialogDescription>
                        {kind === 'delete' && (
                            <div className="mt-4 flex items-start gap-2.5 rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2.5 text-caption text-neutral-600">
                                <Info size={16} className="mt-0.5 shrink-0" />
                                <span>
                                    {t('confirm.delete.note')}{' '}
                                    {onDisableInstead && (
                                        <button
                                            type="button"
                                            className="font-semibold text-primary-500 hover:underline"
                                            onClick={onDisableInstead}
                                        >
                                            {t('confirm.delete.disableInstead')}
                                        </button>
                                    )}
                                </span>
                            </div>
                        )}
                    </div>
                </div>
                <div className="flex justify-end gap-3 border-t border-neutral-100 bg-neutral-50 px-6 py-4">
                    <MyButton buttonType="secondary" disable={busy} onClick={onClose}>
                        {t(`confirm.${kind}.keep`, { defaultValue: t('common.cancel') })}
                    </MyButton>
                    <MyButton
                        buttonType="primary"
                        disable={busy}
                        onClick={onConfirm}
                        className={cn(
                            style.destructive &&
                                'bg-danger-600 hover:bg-danger-700 active:bg-danger-700'
                        )}
                    >
                        {t(`confirm.${kind}.action`)}
                    </MyButton>
                </div>
            </AlertDialogContent>
        </AlertDialog>
    );
}
