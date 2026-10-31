import { ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MyDialog } from '@/components/design-system/dialog';
import { MyButton } from '@/components/design-system/button';
import { useSubmissionsBulkActionsDialogStoreAttempted } from '../bulk-actions-zustand-store/useSubmissionsBulkActionsDialogStoreAttempted';
import { useMutation } from '@tanstack/react-query';
import { provideReattemptToParticipants } from '../../-services/assessment-details-services';
import { toast } from 'sonner';
import { Route } from '../..';
import { getInstituteId } from '@/constants/helper';
import { MyInput } from '@/components/design-system/input';

interface ProvideDialogDialogProps {
    trigger: ReactNode;
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

const ProvideReattemptDialogContent = () => {
    const { t } = useTranslation('assessmentProvideReattemptDialog');
    const { selectedStudent, bulkActionInfo, isBulkAction, closeAllDialogs } =
        useSubmissionsBulkActionsDialogStoreAttempted();
    const { assessmentId } = Route.useParams();
    const instituteId = getInstituteId();
    const displayText = isBulkAction ? bulkActionInfo?.displayText : selectedStudent?.student_name;

    // How many extra attempts to grant. The endpoint has always accepted a count;
    // the dialog hard-coded 1, so an admin re-opening it four times was the only
    // way to give a learner four tries.
    const [reattemptCount, setReattemptCount] = useState('1');
    const parsedCount = Number.parseInt(reattemptCount, 10);
    const isCountValid = Number.isFinite(parsedCount) && parsedCount >= 1 && parsedCount <= 20;

    const provideReattemptMutation = useMutation({
        mutationFn: ({ registrationIds }: { registrationIds: string[] }) =>
            provideReattemptToParticipants(assessmentId, instituteId, registrationIds, parsedCount),
        onSuccess: () => {
            toast.success(t('toastSuccess', { count: parsedCount }), {
                className: 'success-toast',
                duration: 4000,
            });
            closeAllDialogs();
        },
        onError: (error: unknown) => {
            throw error;
        },
    });

    const handleSubmit = () => {
        if (!isCountValid) return;
        if (isBulkAction && bulkActionInfo?.selectedStudents) {
            // Drop rows with no registration id instead of posting undefined. The backend
            // resolves participants by registration id and rejects the whole call when it
            // matches nothing, so one unmapped row used to fail the entire batch with a
            // generic error and no indication of which learner was at fault.
            const registrationIds = bulkActionInfo.selectedStudents
                .map((student) => student.registration_id)
                .filter((id): id is string => Boolean(id));
            if (registrationIds.length === 0) {
                toast.error(t('toastErrorBulk'));
                return;
            }
            provideReattemptMutation.mutate({ registrationIds });
        } else if (selectedStudent) {
            if (!selectedStudent.registration_id) {
                toast.error(t('toastErrorSingle'));
                return;
            }
            provideReattemptMutation.mutate({
                registrationIds: [selectedStudent.registration_id],
            });
        } else {
            closeAllDialogs();
        }
    };

    return (
        <div className="flex flex-col gap-6 px-4 pb-2 text-neutral-600">
            <h1>
                {t('confirmTitlePrefix')}&nbsp;
                <span className="text-primary-500">{displayText}</span>
                {t('confirmTitleSuffix')}
            </h1>
            <MyInput
                inputType="number"
                inputPlaceholder={t('inputPlaceholder')}
                input={reattemptCount}
                onChangeFunction={(e) => setReattemptCount(e.target.value)}
                label={t('inputLabel')}
                required={true}
                error={isCountValid ? undefined : t('inputError')}
                size="large"
                className="w-full"
            />
            <MyButton
                buttonType="primary"
                scale="large"
                layoutVariant="default"
                onClick={handleSubmit}
                disable={provideReattemptMutation.isPending || !isCountValid}
            >
                {t('doneButton')}
            </MyButton>
        </div>
    );
};

export const ProvideReattemptDialog = ({
    trigger,
    open,
    onOpenChange,
}: ProvideDialogDialogProps) => {
    const { t } = useTranslation('assessmentProvideReattemptDialog');
    return (
        <MyDialog
            trigger={trigger}
            heading={t('dialogHeading')}
            dialogWidth="w-full max-w-sm"
            content={<ProvideReattemptDialogContent />}
            open={open}
            onOpenChange={onOpenChange}
        />
    );
};
