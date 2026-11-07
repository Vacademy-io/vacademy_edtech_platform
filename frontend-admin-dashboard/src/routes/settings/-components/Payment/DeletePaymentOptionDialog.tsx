import { useState, useEffect, useCallback } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { Card } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Warning, CircleNotch } from '@phosphor-icons/react';
import { PaymentPlan } from '@/types/payment';
import {
    getInvitesByPaymentOptionId,
    updateInvitePaymentOption,
    deletePaymentOption,
    UpdatePaymentOptionRequest,
} from '@/services/payment-options';
import { toast } from 'sonner';
import { InviteLinkDataInterface } from '@/schemas/study-library/invite-links-schema';
import { MyButton } from '@/components/design-system/button';
import { useTranslation } from 'react-i18next';

interface DeletePaymentOptionDialogProps {
    isOpen: boolean;
    onClose: () => void;
    paymentOption: PaymentPlan | null;
    allPaymentOptions: PaymentPlan[];
    onDeleted: () => void;
}

interface InvitePaymentUpdate {
    inviteId: string;
    selectedPaymentOptionId: string;
    packageSessionId: string;
    status: InviteLinkDataInterface['status'];
    error?: string;
}

export const DeletePaymentOptionDialog: React.FC<DeletePaymentOptionDialogProps> = ({
    isOpen,
    onClose,
    paymentOption,
    allPaymentOptions,
    onDeleted,
}) => {
    const { t } = useTranslation('settingsDeletePaymentOption');
    const [step, setStep] = useState<'loading' | 'select' | 'confirm'>('loading');
    const [linkedInvites, setLinkedInvites] = useState<InviteLinkDataInterface[]>([]);
    const [inviteUpdates, setInviteUpdates] = useState<InvitePaymentUpdate[]>([]);
    const [deleteConfirmText, setDeleteConfirmText] = useState('');
    const [isDeleting, setIsDeleting] = useState(false);
    const [isLoadingInvites, setIsLoadingInvites] = useState(false);

    const availablePaymentOptions = allPaymentOptions.filter((opt) => opt.id !== paymentOption?.id);

    // Load invites when dialog opens
    const loadLinkedInvites = useCallback(async () => {
        if (!paymentOption?.id) return;

        setIsLoadingInvites(true);
        try {
            const invites = await getInvitesByPaymentOptionId([paymentOption.id]);
            setLinkedInvites(invites);
            console.log('Linked invites:', invites[0]);

            // Initialize payment updates tracking
            const updates: InvitePaymentUpdate[] = invites.map((invite) => ({
                inviteId: invite.id,
                packageSessionId:
                    invite.package_session_to_payment_options[0]?.package_session_id || '',
                selectedPaymentOptionId: '',
                status: invite.status,
            }));
            setInviteUpdates(updates);

            setStep(invites.length > 0 ? 'select' : 'confirm');
        } catch (error) {
            console.error('Error loading invites:', error);
            toast.error(t('toasts.loadInvitesFailed'));
            setStep('confirm');
        } finally {
            setIsLoadingInvites(false);
        }
    }, [paymentOption?.id]);

    // Auto-load invites when dialog opens
    useEffect(() => {
        if (isOpen && paymentOption?.id) {
            loadLinkedInvites();
        }
    }, [isOpen, paymentOption?.id, loadLinkedInvites]);

    const handlePaymentOptionSelect = (inviteId: string, paymentOptionId: string) => {
        setInviteUpdates((prev) =>
            prev.map((update) =>
                update.inviteId === inviteId
                    ? { ...update, selectedPaymentOptionId: paymentOptionId, status: 'pending' }
                    : update
            )
        );
    };

    const handleUpdateInvite = async (inviteId: string) => {
        const update = inviteUpdates.find((u) => u.inviteId === inviteId);
        if (!update || !update.selectedPaymentOptionId) {
            toast.error(t('toasts.selectPaymentOption'));
            return;
        }

        setInviteUpdates((prev) =>
            prev.map((u) => (u.inviteId === inviteId ? { ...u, status: 'updating' } : u))
        );

        try {
            const selectedPaymentOption = allPaymentOptions.find(
                (opt) => opt.id === update.selectedPaymentOptionId
            );

            if (!selectedPaymentOption) {
                throw new Error(t('toasts.paymentOptionNotFound'));
            }

            const linkedInvite = linkedInvites.find((inv) => inv.id === inviteId);

            if (!linkedInvite) {
                throw new Error(t('toasts.inviteNotFound', { id: inviteId }));
            }

            // Build the update request based on the API structure
            const updateRequest: UpdatePaymentOptionRequest = {
                enroll_invite_id: inviteId,
                update_payment_options: [
                    {
                        old_package_session_payment_option_id: paymentOption?.id || '',
                        new_package_session_payment_option: {
                            package_session_id:
                                linkedInvite.package_session_to_payment_options[0]
                                    ?.package_session_id || '',
                            id: selectedPaymentOption.id,
                            payment_option: {
                                id: selectedPaymentOption.id,
                                name: selectedPaymentOption.name,
                                status: 'ACTIVE',
                                source: 'INSTITUTE',
                                source_id: '',
                                tag: selectedPaymentOption.tag,
                                type: selectedPaymentOption.type,
                                require_approval: selectedPaymentOption.requireApproval || false,
                                payment_plans: [],
                                payment_option_metadata_json: '',
                            },
                            enroll_invite_id: inviteId,
                            status: 'ACTIVE',
                        },
                    },
                ],
            };

            console.log('Sending update request:', JSON.stringify(updateRequest, null, 2));

            await updateInvitePaymentOption([updateRequest]);

            setInviteUpdates((prev) =>
                prev.map((u) =>
                    u.inviteId === inviteId
                        ? u.status === 'completed'
                            ? u
                            : { ...u, status: 'completed', error: undefined }
                        : u
                )
            );

            toast.success(t('toasts.updateSuccess'));
        } catch (error) {
            console.error('Error updating invite:', error);
            const errorMessage =
                error instanceof Error ? error.message : t('toasts.updateFailed');
            setInviteUpdates((prev) =>
                prev.map((u) =>
                    u.inviteId === inviteId
                        ? u.status === 'failed'
                            ? u
                            : { ...u, status: 'failed', error: errorMessage }
                        : u
                )
            );
            toast.error(errorMessage);
        }
    };

    const handleDelete = async () => {
        if (!paymentOption?.id) return;

        // Check if all invites are updated (if there are any)
        if (linkedInvites.length > 0) {
            const allUpdated = inviteUpdates.every((u) => u.status === 'completed');
            if (!allUpdated) {
                toast.error(t('toasts.updateAllRequired'));
                return;
            }
        }

        if (deleteConfirmText.toLowerCase() !== 'delete') {
            toast.error(t('toasts.confirmTextRequired'));
            return;
        }

        setIsDeleting(true);
        try {
            await deletePaymentOption([paymentOption.id]);
            toast.success(t('toasts.deleteSuccess'));
            onDeleted();
            handleClose();
        } catch (error) {
            console.error('Error deleting payment option:', error);
            toast.error(t('toasts.deleteFailed'));
        } finally {
            setIsDeleting(false);
        }
    };

    const handleClose = () => {
        setStep('loading');
        setLinkedInvites([]);
        setInviteUpdates([]);
        setDeleteConfirmText('');
        onClose();
    };

    const getPaymentOptionName = (id: string) => {
        return allPaymentOptions.find((opt) => opt.id === id)?.name || t('unknownPaymentOption');
    };

    const completedCount = inviteUpdates.filter((u) => u.status === 'completed').length;
    const totalInvites = inviteUpdates.length;

    if (!isOpen || !paymentOption) return null;

    return (
        <Dialog open={isOpen} onOpenChange={handleClose}>
            <DialogContent className=" min-w-fit space-y-0 overflow-y-auto ">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <Warning className="size-5 text-red-600" />
                        {t('dialog.title', { name: paymentOption.name })}
                    </DialogTitle>
                </DialogHeader>

                <div className="space-y-4 ">
                    {/* Loading State */}
                    {step === 'loading' && (
                        <div className="space-y-4 py-2">
                            <div className="flex flex-col items-center justify-center space-y-4">
                                <CircleNotch className="size-8 animate-spin text-primary-400" />
                                <p className="text-sm text-gray-600">{t('loading.checking')}</p>
                                <Button
                                    onClick={loadLinkedInvites}
                                    disabled={isLoadingInvites}
                                    className="mt-4"
                                >
                                    {isLoadingInvites
                                        ? t('loading.loadingButton')
                                        : t('loading.loadButton')}
                                </Button>
                            </div>
                        </div>
                    )}

                    {/* Select Payment Options Step */}
                    {step === 'select' && linkedInvites.length > 0 && (
                        <div className="space-y-4 py-2">
                            <Alert>
                                <Warning className="size-4" />
                                <AlertDescription>
                                    {t('select.alert', { count: linkedInvites.length })}
                                </AlertDescription>
                            </Alert>

                            <div className="text-sm font-medium text-gray-700">
                                {t('select.progress', {
                                    completed: completedCount,
                                    total: totalInvites,
                                })}
                            </div>

                            <div className="max-h-96 space-y-3 overflow-y-auto">
                                {linkedInvites.map((invite) => {
                                    const update = inviteUpdates.find(
                                        (u) => u.inviteId === invite.id
                                    );
                                    if (!update) return null;

                                    return (
                                        <Card
                                            key={invite.id}
                                            className="border border-gray-200 p-4"
                                        >
                                            <div className="space-y-3">
                                                <div className="flex items-center justify-between">
                                                    <span className="text-sm font-medium text-gray-700">
                                                        {invite.name}
                                                    </span>
                                                    <span
                                                        className={`rounded-full px-2 py-1 text-xs ${
                                                            update.status === 'completed'
                                                                ? 'bg-green-100 text-green-800'
                                                                : update.status === 'failed'
                                                                  ? 'bg-red-100 text-red-800'
                                                                  : update.status === 'updating'
                                                                    ? 'bg-blue-100 text-blue-800'
                                                                    : 'bg-gray-100 text-gray-800'
                                                        }`}
                                                    >
                                                        {update.status === 'completed'
                                                            ? t('select.status.updated')
                                                            : update.status === 'failed'
                                                              ? t('select.status.failed')
                                                              : update.status === 'updating'
                                                                ? t('select.status.updating')
                                                                : t('select.status.pending')}
                                                    </span>
                                                </div>

                                                {update.status !== 'completed' && (
                                                    <div className="space-y-2">
                                                        <Label className="text-sm">
                                                            {t('select.selectLabel')}
                                                        </Label>
                                                        <Select
                                                            value={update.selectedPaymentOptionId}
                                                            onValueChange={(value) =>
                                                                handlePaymentOptionSelect(
                                                                    invite.id,
                                                                    value
                                                                )
                                                            }
                                                            disabled={update.status === 'updating'}
                                                        >
                                                            <SelectTrigger>
                                                                <SelectValue
                                                                    placeholder={t(
                                                                        'select.selectPlaceholder'
                                                                    )}
                                                                />
                                                            </SelectTrigger>
                                                            <SelectContent>
                                                                {availablePaymentOptions.map(
                                                                    (option) => (
                                                                        <SelectItem
                                                                            key={option.id}
                                                                            value={option.id}
                                                                        >
                                                                            {option.name}
                                                                        </SelectItem>
                                                                    )
                                                                )}
                                                            </SelectContent>
                                                        </Select>

                                                        <MyButton
                                                            onClick={() =>
                                                                handleUpdateInvite(invite.id)
                                                            }
                                                            disabled={
                                                                !update.selectedPaymentOptionId ||
                                                                update.status === 'updating'
                                                            }
                                                            buttonType="secondary"
                                                            size="sm"
                                                            className="w-full"
                                                        >
                                                            {update.status === 'updating' ? (
                                                                <>
                                                                    <CircleNotch className="me-2 size-4 animate-spin" />
                                                                    {t('select.status.updating')}
                                                                </>
                                                            ) : (
                                                                t('select.updateButton')
                                                            )}
                                                        </MyButton>
                                                    </div>
                                                )}

                                                {update.status === 'completed' && (
                                                    <div className="text-sm text-green-700">
                                                        {t('select.updatedTo', {
                                                            name: getPaymentOptionName(
                                                                update.selectedPaymentOptionId
                                                            ),
                                                        })}
                                                    </div>
                                                )}

                                                {update.error && (
                                                    <div className="text-sm text-red-700">
                                                        {t('select.errorPrefix', {
                                                            error: update.error,
                                                        })}
                                                    </div>
                                                )}
                                            </div>
                                        </Card>
                                    );
                                })}
                            </div>

                            {completedCount === totalInvites && (
                                <MyButton onClick={() => setStep('confirm')} className="w-full ">
                                    {t('select.continueButton')}
                                </MyButton>
                            )}
                        </div>
                    )}

                    {/* Confirmation Step */}
                    {step === 'confirm' && (
                        <div className="space-y-4 py-2">
                            {linkedInvites.length === 0 && (
                                <Alert>
                                    <Warning className="size-4" />
                                    <AlertDescription>
                                        {t('confirm.noInvitesAlert')}
                                    </AlertDescription>
                                </Alert>
                            )}

                            <Alert className="border-red-200 bg-red-50">
                                <Warning className="size-4 text-red-600" />
                                <AlertDescription className="text-red-800">
                                    {t('confirm.warningAlert')}
                                </AlertDescription>
                            </Alert>

                            <div className="space-y-2">
                                <Label htmlFor="delete-confirm" className="text-sm">
                                    {t('confirm.inputLabel')}
                                </Label>
                                <Input
                                    id="delete-confirm"
                                    type="text"
                                    placeholder={t('confirm.inputPlaceholder')}
                                    value={deleteConfirmText}
                                    onChange={(e) => setDeleteConfirmText(e.target.value)}
                                    disabled={isDeleting}
                                    className="font-mono"
                                />
                            </div>
                        </div>
                    )}
                </div>

                {/* Dialog Actions */}
                <div className="flex justify-end gap-3 pt-4">
                    <Button
                        onClick={handleClose}
                        variant="outline"
                        disabled={isDeleting || isLoadingInvites}
                    >
                        {t('actions.cancel')}
                    </Button>
                    {step === 'confirm' && (
                        <MyButton
                            onClick={handleDelete}
                            disabled={
                                deleteConfirmText.toLowerCase() !== 'delete' ||
                                isDeleting ||
                                (linkedInvites.length > 0 && completedCount !== totalInvites)
                            }
                            className="bg-red-600 hover:bg-red-700 disabled:bg-red-300"
                        >
                            {isDeleting ? (
                                <>
                                    <CircleNotch className="me-2 size-4 animate-spin" />
                                    {t('actions.deletingButton')}
                                </>
                            ) : (
                                t('actions.deleteButton')
                            )}
                        </MyButton>
                    )}
                    {step === 'loading' && (
                        <Button disabled>{t('loading.loadingButton')}</Button>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    );
};
