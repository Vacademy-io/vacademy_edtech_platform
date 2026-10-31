import { useState, useEffect } from 'react';
import { MyDialog } from '@/components/design-system/dialog';
import { MyButton } from '@/components/design-system/button';
import { MyRadioButton } from '@/components/design-system/radio';
import { Checkbox } from '@/components/ui/checkbox';
import { deleteLiveSession } from '../schedule/-services/utils';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';

interface DeleteSessionDialogProps {
    open: boolean;
    onOpenChange: (val: boolean) => void;
    sessionId: string;
    scheduleId?: string;
    isRecurring?: boolean;
    onSuccess?: () => void;
}

export default function DeleteSessionDialog({
    open,
    onOpenChange,
    sessionId,
    scheduleId,
    isRecurring = false,
    onSuccess,
}: DeleteSessionDialogProps) {
    const { t } = useTranslation('studyLibraryDeleteSessionDialog');
    const [isDeleting, setIsDeleting] = useState(false);
    const [selectedOption, setSelectedOption] = useState<'session' | 'schedule'>('schedule');
    const [notifyStudents, setNotifyStudents] = useState(false);
    const queryClient = useQueryClient();

    // Reset state when dialog opens
    useEffect(() => {
        if (open) {
            setSelectedOption('schedule');
            setIsDeleting(false);
            setNotifyStudents(false);
        }
    }, [open]);

    const handleDelete = async () => {
        setIsDeleting(true);
        try {
            let ids: string[];

            if (selectedOption === 'session') {
                // Delete the entire session (all schedules)
                ids = [sessionId];
            } else {
                // Delete only this specific schedule
                ids = [scheduleId || sessionId];
            }

            await deleteLiveSession(ids, selectedOption, notifyStudents);

            // Invalidate relevant queries
            await queryClient.invalidateQueries({ queryKey: ['liveSessions'] });
            await queryClient.invalidateQueries({ queryKey: ['upcomingSessions'] });
            await queryClient.invalidateQueries({ queryKey: ['pastSessions'] });
            await queryClient.invalidateQueries({ queryKey: ['draftSessions'] });
            await queryClient.invalidateQueries({ queryKey: ['sessionSearch'] });

            toast.success(
                selectedOption === 'session'
                    ? t('toast.sessionDeleted')
                    : t('toast.scheduleDeleted')
            );

            onOpenChange(false);
            if (onSuccess) onSuccess();
        } catch (error) {
            console.error('Error deleting:', error);
            toast.error(t('toast.deleteFailed'));
        } finally {
            setIsDeleting(false);
        }
    };

    const handleCancel = () => {
        if (!isDeleting) {
            onOpenChange(false);
        }
    };

    return (
        <MyDialog
            open={open}
            onOpenChange={onOpenChange}
            heading={t('heading')}
            className="w-fit max-w-md"
        >
            <div className="flex flex-col gap-4 p-4">
                {isRecurring ? (
                    <div className="text-lg">
                        {t('confirm.recurring')}
                    </div>
                ) : (
                    <div className="text-lg">{t('confirm.single')}</div>
                )}
                {isRecurring && (
                    <MyRadioButton
                        name="delete-option"
                        value={selectedOption}
                        onChange={(val) => setSelectedOption(val as 'session' | 'schedule')}
                        options={[
                            { label: t('options.scheduleOnly'), value: 'schedule' },
                            {
                                label: t('options.entireSession'),
                                value: 'session',
                            },
                        ]}
                        className="flex flex-col gap-3"
                        disabled={isDeleting}
                    />
                )}
                <label className="flex items-start gap-2 rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm">
                    <Checkbox
                        checked={notifyStudents}
                        onCheckedChange={(v) => setNotifyStudents(!!v)}
                        disabled={isDeleting}
                        className={`mt-0.5 size-4 rounded-sm border-2 shadow-none ${
                            notifyStudents ? 'border-none bg-primary-500 text-white' : ''
                        }`}
                    />
                    <span>
                        <span className="font-medium text-neutral-800">
                            {t('notify.label')}
                        </span>
                        <span className="block text-xs text-neutral-500">
                            {t('notify.description')}
                        </span>
                    </span>
                </label>
                <div className="flex justify-end gap-4 border-t pt-4">
                    <MyButton
                        type="button"
                        buttonType="secondary"
                        onClick={handleCancel}
                        disabled={isDeleting}
                    >
                        {t('actions.cancel')}
                    </MyButton>
                    <MyButton
                        type="button"
                        buttonType="primary"
                        onClick={handleDelete}
                        disabled={isDeleting}
                    >
                        {isDeleting ? t('actions.deleting') : t('actions.delete')}
                    </MyButton>
                </div>
            </div>
        </MyDialog>
    );
}
