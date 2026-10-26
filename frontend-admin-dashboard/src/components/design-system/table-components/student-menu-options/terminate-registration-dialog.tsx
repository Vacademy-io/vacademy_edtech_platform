import { MyDialog } from '../../dialog';
import { ReactNode, useEffect, useMemo, useState } from 'react';
import { useDialogStore } from '../../../../routes/manage-students/students-list/-hooks/useDialogStore';
import { MyButton } from '../../button';
import { useDeactivateStudentMutation } from '@/routes/manage-students/students-list/-services/useStudentOperations';
import { useBulkDeactivateStudentsMutation } from '@/routes/manage-students/students-list/-services/useBulkOperations';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import { removeDefaultPrefix } from '@/utils/helpers/removeDefaultPrefix';
import { getTerminology } from '@/components/common/layout-container/sidebar/utils';
import { ContentTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';

interface TerminateRegistrationDialogProps {
    trigger: ReactNode;
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

const TerminateRegistrationDialogContent = () => {
    const { selectedStudent, bulkActionInfo, isBulkAction, closeAllDialogs } = useDialogStore();
    const { getDetailsFromPackageSessionId } = useInstituteDetailsStore();
    const batchTerm = getTerminology(ContentTerms.Batch, SystemTerms.Batch);
    const displayText = isBulkAction ? bulkActionInfo?.displayText : selectedStudent?.full_name;

    const { mutate: terminateSingle, isPending: isSinglePending } = useDeactivateStudentMutation();
    const { mutate: terminateBulk, isPending: isBulkPending } = useBulkDeactivateStudentsMutation();

    // Every package session the (single) selected learner is enrolled in. Falls back
    // to the row's current package_session_id when the fan-out list isn't present.
    const enrolledPsIds = useMemo(() => {
        if (isBulkAction || !selectedStudent) return [];
        const all = selectedStudent.all_package_session_ids;
        if (all && all.length > 0) return all;
        return selectedStudent.package_session_id ? [selectedStudent.package_session_id] : [];
    }, [isBulkAction, selectedStudent]);

    const psOptions = useMemo(() => {
        return enrolledPsIds.map((psId) => {
            const details = getDetailsFromPackageSessionId({ packageSessionId: psId });
            const packageName = removeDefaultPrefix(details?.package_dto?.package_name || '');
            const levelName = details?.level?.level_name;
            const cleanedLevel =
                levelName && levelName !== 'DEFAULT' ? removeDefaultPrefix(levelName) : '';
            const composed = cleanedLevel
                ? `${packageName} - ${cleanedLevel}`.trim()
                : packageName || psId;
            return { id: psId, label: composed || psId };
        });
    }, [enrolledPsIds, getDetailsFromPackageSessionId]);

    // Default the row's current package session selected (preserves prior behavior),
    // and let the admin add/remove others when the learner has multiple enrollments.
    const [selectedPsIds, setSelectedPsIds] = useState<string[]>([]);
    useEffect(() => {
        if (isBulkAction || !selectedStudent) return;
        const fallback = selectedStudent.package_session_id;
        setSelectedPsIds(fallback ? [fallback] : enrolledPsIds.slice(0, 1));
    }, [isBulkAction, selectedStudent, enrolledPsIds]);

    const showPicker = !isBulkAction && psOptions.length > 1;

    const togglePs = (psId: string, checked: boolean) => {
        setSelectedPsIds((prev) =>
            checked ? [...new Set([...prev, psId])] : prev.filter((id) => id !== psId)
        );
    };

    const handleSubmit = () => {
        if (isBulkAction && bulkActionInfo?.selectedStudents) {
            const validStudents = bulkActionInfo.selectedStudents.filter(
                (student) => student && student.user_id && student.package_session_id
            );

            if (validStudents.length === 0) {
                console.error('No valid students found for bulk action');
                return;
            }

            terminateBulk(
                {
                    students: validStudents.map((student) => ({
                        userId: student.user_id,
                        currentPackageSessionId: student.package_session_id || '',
                    })),
                },
                {
                    onSuccess: closeAllDialogs,
                }
            );
        } else if (selectedStudent?.user_id && selectedPsIds.length > 0) {
            terminateSingle(
                {
                    students: [
                        {
                            userId: selectedStudent.user_id,
                            packageSessionIds: selectedPsIds,
                        },
                    ],
                },
                {
                    onSuccess: closeAllDialogs,
                }
            );
        }
    };

    const isLoading = isSinglePending || isBulkPending;
    const submitDisabled = isLoading || (!isBulkAction && selectedPsIds.length === 0);

    return (
        <div className="flex flex-col gap-6 p-6 text-neutral-600">
            {/*
              * This action sends operation=MAKE_INACTIVE, which writes status INACTIVE — NOT
              * TERMINATED, despite the menu item having historically been called "Terminate
              * Registration". Naming the resulting status here is what lets an admin predict
              * what they are about to write. (The TERMINATE operation, which writes TERMINATED,
              * is not reachable from this menu at all — see delete-student-dialog.tsx.)
              */}
            <div>
                <span className="text-primary-500">{displayText}</span> will be marked{' '}
                <span className="font-semibold">Inactive</span>
                {showPicker
                    ? ` in the selected ${getTerminology(
                          ContentTerms.Batch,
                          SystemTerms.Batch
                      ).toLowerCase()}(es)`
                    : ''}
                . They stay on the roster and can be made active again later.
            </div>

            {showPicker && (
                <div className="flex flex-col gap-3">
                    <Label className="text-xs text-neutral-500">Select {batchTerm}(es)</Label>
                    <div className="flex flex-col gap-2">
                        {psOptions.map((option) => (
                            <label
                                key={option.id}
                                className="flex cursor-pointer items-center gap-2 text-sm"
                            >
                                <Checkbox
                                    checked={selectedPsIds.includes(option.id)}
                                    onCheckedChange={(checked) =>
                                        togglePs(option.id, checked === true)
                                    }
                                />
                                <span>{option.label}</span>
                            </label>
                        ))}
                    </div>
                </div>
            )}

            <MyButton
                buttonType="primary"
                scale="large"
                layoutVariant="default"
                disable={submitDisabled}
                onClick={handleSubmit}
            >
                {isLoading ? 'Marking Inactive...' : 'Make Inactive'}
            </MyButton>
        </div>
    );
};

export const TerminateRegistrationDialog = ({
    trigger,
    open,
    onOpenChange,
}: TerminateRegistrationDialogProps) => {
    return (
        <MyDialog
            trigger={trigger}
            heading="Make Inactive"
            dialogWidth="w-[400px] max-w-[400px]"
            content={<TerminateRegistrationDialogContent />}
            open={open}
            onOpenChange={onOpenChange}
        />
    );
};
