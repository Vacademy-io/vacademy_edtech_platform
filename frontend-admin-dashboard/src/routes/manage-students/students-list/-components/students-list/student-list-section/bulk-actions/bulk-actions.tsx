// components/bulk-actions.tsx
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { MyButton } from '@/components/design-system/button';
import { CaretUpDown, XCircle } from '@phosphor-icons/react';
import { BulkActionsMenu } from './bulk-actions-menu';
// import { useToast } from "@/hooks/use-toast";
import { StudentTable } from '@/types/student-table-types';

interface BulkActionsProps {
    selectedCount: number;
    selectedStudentIds: string[];
    selectedStudents: StudentTable[]; // Add this prop
    onReset: () => void;
    // Surfaces the bulk "Accept Request" action while the Approval Status filter is active.
    showApprovalActions?: boolean;
    /**
     * Rendered next to the count, on the left. Used for "Select all N" — it belongs beside the
     * count it is about, not stranded in a separate row.
     */
    leftSlot?: ReactNode;
}

export const BulkActions = ({
    selectedCount,
    selectedStudentIds,
    selectedStudents, // Add this
    onReset,
    showApprovalActions = false,
    leftSlot,
}: BulkActionsProps) => {
    //   const { toast } = useToast();
    const { t } = useTranslation('manageStudentsBulkActions');

    if (selectedCount === 0) {
        return null;
    }

    // Full width with the count pinned left and the actions right, so the bar reads the same way
    // wherever it sits.
    return (
        <div className="flex w-full flex-wrap items-center justify-between gap-3 text-neutral-600">
            <div className="flex flex-wrap items-center gap-3">
                <div className="flex gap-1">
                    <span className="font-semibold text-primary-500">{selectedCount}</span>{' '}
                    {t('selectedCount', { count: selectedCount })}
                </div>
                {leftSlot}
            </div>

            <div className="flex items-center gap-3">
                <MyButton
                    buttonType="secondary"
                    scale="medium"
                    layoutVariant="default"
                    className="flex items-center"
                    onClick={onReset}
                >
                    {t('reset')}
                    <XCircle />
                </MyButton>

                <BulkActionsMenu
                    selectedCount={selectedCount}
                    selectedStudentIds={selectedStudentIds}
                    selectedStudents={selectedStudents} // Pass the selected students
                    showApprovalActions={showApprovalActions}
                    trigger={
                        <MyButton
                            buttonType="primary"
                            scale="medium"
                            layoutVariant="default"
                            className="flex w-full cursor-pointer items-center justify-between"
                        >
                            <div>{t('bulkActions')}</div>
                            <CaretUpDown />
                        </MyButton>
                    }
                />
            </div>
        </div>
    );
};
