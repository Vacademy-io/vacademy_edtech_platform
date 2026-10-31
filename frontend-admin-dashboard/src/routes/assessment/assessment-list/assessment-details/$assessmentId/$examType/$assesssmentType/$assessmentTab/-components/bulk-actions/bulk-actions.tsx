import { MyButton } from '@/components/design-system/button';
import { CaretUpDown, CircleNotch, XCircle } from '@phosphor-icons/react';
import { BulkActionsMenuAttempted } from './bulk-actions-menu-attempted';
import { SubmissionStudentData } from '@/types/assessments/assessment-overview';
import { BulkActionsMenuOngoing } from './bulk-actions-menu-ongoing';
import { BulkActionsMenuPending } from './bulk-actions-menu-pending';
import { useTranslation } from 'react-i18next';

interface BulkActionsProps {
    selectedCount: number;
    selectedStudentIds: string[];
    selectedStudents: SubmissionStudentData[]; // Add this prop
    onReset: () => void;
    selectedTab: string;
    // Rows matching the current list (all pages). With onSelectAll, offers "Select all N".
    totalCount?: number;
    onSelectAll?: () => void;
    isSelectingAll?: boolean;
    isAllSelected?: boolean;
    // Opens the report ZIP export dialog scoped to the checked rows
    // (Attempted tab only — other tabs have no reports to export).
    onExportReports?: () => void;
    // Queues the AI check for the checked rows' submitted copies (Attempted
    // tab, manual-evaluation assessments only).
    onCheckWithAi?: () => void;
}

export const BulkActions = ({
    selectedCount,
    selectedStudentIds,
    selectedStudents, // Add this
    onReset,
    selectedTab,
    totalCount = 0,
    onSelectAll,
    isSelectingAll = false,
    isAllSelected = false,
    onExportReports,
    onCheckWithAi,
}: BulkActionsProps) => {
    const { t } = useTranslation('assessmentBulkActions');

    if (selectedCount === 0) {
        return null;
    }

    return (
        <div className="flex items-center gap-5 text-neutral-600">
            <div className="flex items-center gap-1">
                <div>{t('selectedCount', { count: selectedCount })}</div>
                {onSelectAll && !isAllSelected && selectedCount < totalCount && (
                    <MyButton
                        type="button"
                        buttonType="text"
                        scale="small"
                        layoutVariant="default"
                        className="flex items-center gap-1 !text-primary-500 hover:underline"
                        disable={isSelectingAll}
                        onClick={onSelectAll}
                    >
                        {isSelectingAll && <CircleNotch className="animate-spin" />}
                        {isSelectingAll ? t('selectingAll') : t('selectAll', { count: totalCount })}
                    </MyButton>
                )}
            </div>

            <div className="flex items-center gap-20">
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
                {selectedTab === 'Attempted' && (
                    <BulkActionsMenuAttempted
                        selectedCount={selectedCount}
                        selectedStudentIds={selectedStudentIds}
                        selectedStudents={selectedStudents} // Pass the selected students
                        onExportReports={onExportReports}
                        onCheckWithAi={onCheckWithAi}
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
                )}
                {selectedTab === 'Ongoing' && (
                    <BulkActionsMenuOngoing
                        selectedCount={selectedCount}
                        selectedStudentIds={selectedStudentIds}
                        selectedStudents={selectedStudents} // Pass the selected students
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
                )}
                {selectedTab === 'Pending' && (
                    <BulkActionsMenuPending
                        selectedCount={selectedCount}
                        selectedStudentIds={selectedStudentIds}
                        selectedStudents={selectedStudents} // Pass the selected students
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
                )}
            </div>
        </div>
    );
};
