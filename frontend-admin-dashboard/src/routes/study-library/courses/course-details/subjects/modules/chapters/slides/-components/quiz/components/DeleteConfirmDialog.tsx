import React from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { CircleNotch, Warning } from '@phosphor-icons/react';

interface DeleteConfirmDialogProps {
    isOpen: boolean;
    onOpenChange: (open: boolean) => void;
    onConfirm: () => void;
    onCancel: () => void;
    /** Blocks re-submits and dismissal while the delete request is in flight. */
    isDeleting?: boolean;
}

const DeleteConfirmDialog: React.FC<DeleteConfirmDialogProps> = ({
    isOpen,
    onOpenChange,
    onConfirm,
    onCancel,
    isDeleting = false,
}) => {
    const { t } = useTranslation('studyLibraryDeleteConfirmDialog');
    return (
        <Dialog open={isOpen} onOpenChange={(open) => !isDeleting && onOpenChange(open)}>
            <DialogContent className="max-w-md">
                <div className="flex items-center gap-3">
                    <div className="flex size-10 items-center justify-center rounded-full bg-red-100">
                        <Warning size={20} className="text-red-600" />
                    </div>
                    <div>
                        <h3 className="text-lg font-semibold text-slate-900">
                            {t('title')}
                        </h3>
                        <p className="text-sm text-slate-600">{t('description')}</p>
                    </div>
                </div>
                <div className="flex justify-end gap-3 pt-4">
                    <Button
                        type="button"
                        variant="outline"
                        onClick={onCancel}
                        disabled={isDeleting}
                    >
                        {t('cancel')}
                    </Button>
                    <Button
                        type="button"
                        variant="destructive"
                        onClick={onConfirm}
                        disabled={isDeleting}
                    >
                        {isDeleting ? (
                            <span className="flex items-center justify-center gap-2">
                                <CircleNotch className="size-4 animate-spin" />
                                {t('deleting')}
                            </span>
                        ) : (
                            t('delete')
                        )}
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
};

export default DeleteConfirmDialog;
