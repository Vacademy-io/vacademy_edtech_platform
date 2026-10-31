import { useTranslation } from 'react-i18next';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import {
    flexRender,
    getCoreRowModel,
    useReactTable,
    RowSelectionState,
    OnChangeFn,
    ColumnDef,
} from '@tanstack/react-table';
import { ProvideReattemptDialog } from '@/routes/assessment/assessment-list/assessment-details/$assessmentId/$examType/$assesssmentType/$assessmentTab/-components/assessment-menu-options-attempted-bulk/provide-reattempt-dialog';
import { ProvideRevaluateAssessmentDialog } from '@/routes/assessment/assessment-list/assessment-details/$assessmentId/$examType/$assesssmentType/$assessmentTab/-components/assessment-menu-options-attempted-bulk/provide-revaluate-assessment-dialog';
import { ProvideReleaseResultDialog } from '@/routes/assessment/assessment-list/assessment-details/$assessmentId/$examType/$assesssmentType/$assessmentTab/-components/assessment-menu-options-attempted-bulk/provide-release-result';
import { ProvideRevaluateQuestionWiseDialog } from '@/routes/assessment/assessment-list/assessment-details/$assessmentId/$examType/$assesssmentType/$assessmentTab/-components/assessment-menu-options-attempted-bulk/provide-revaluate-questionwise-dialog';
import { ColumnWidthConfig } from '@/components/design-system/utils/constants/table-layout';
import { DashboardLoader } from '@/components/core/dashboard-loader';
import { useSubmissionsBulkActionsDialogStoreAttempted } from './bulk-actions-zustand-store/useSubmissionsBulkActionsDialogStoreAttempted';
import { useSubmissionsBulkActionsDialogStoreOngoing } from './bulk-actions-zustand-store/useSubmissionsBulkActionsDialogStoreOngoing';
import { IncreaseAssessmentTimeDialog } from './assessment-menu-options-ongoing-bulk/increase-assessment-time-component';
import { CloseSubmissionDialog } from './assessment-menu-options-ongoing-bulk/close-submission-component';
import { useSubmissionsBulkActionsDialogStorePending } from './bulk-actions-zustand-store/useSubmissionsBulkActionsDialogStorePending';
import { SendReminderDialog } from './assessment-menu-options-pending-bulk/send-reminder-component';
import { RemoveParticipantsDialog } from './assessment-menu-options-pending-bulk/remove-participants-component';

const headerTextCss = 'p-3 border-r border-neutral-300';
const cellCommonCss = 'p-3';

export interface TableData<T> {
    content: T[];
    total_pages: number;
    page_no: number;
    page_size: number;
    total_elements: number;
    last: boolean;
}

interface MyTableProps<T> {
    data: TableData<T> | undefined;
    columns: ColumnDef<T>[];
    isLoading: boolean;
    error: unknown;
    onSort?: (columnId: string, direction: string) => void;
    rowSelection?: RowSelectionState;
    onRowSelectionChange?: OnChangeFn<RowSelectionState>;
    currentPage: number;
    columnWidths?: ColumnWidthConfig;
}

export function AssessmentSubmissionsStudentTable<T>({
    data,
    columns,
    isLoading,
    error,
    onSort,
    columnWidths,
    rowSelection,
    onRowSelectionChange,
}: MyTableProps<T>) {
    const { t } = useTranslation('homeworkCreationAssessmentSubmissionsStudentTable');
    const table = useReactTable({
        data: data?.content || [],
        columns,
        getCoreRowModel: getCoreRowModel(),
        meta: { onSort },
        state: {
            rowSelection,
        },
        enableRowSelection: true,
        onRowSelectionChange: (updaterOrValue) => {
            if (typeof updaterOrValue === 'function') {
                if (rowSelection) {
                    const newSelection = updaterOrValue(rowSelection);
                    if (onRowSelectionChange) {
                        onRowSelectionChange(newSelection);
                    }
                }
            } else {
                if (onRowSelectionChange) {
                    onRowSelectionChange(updaterOrValue);
                }
            }
        },
        autoResetPageIndex: false,
    });

    const {
        isProvideReattemptOpen,
        isProvideRevaluateAssessment,
        isProvideRevaluateQuestionWise,
        isReleaseResult,
        closeAllDialogs,
    } = useSubmissionsBulkActionsDialogStoreAttempted();

    const {
        increaseAssessmentTime,
        closeSubmission,
        closeAllDialogs: closeAllDialogsOngoing,
    } = useSubmissionsBulkActionsDialogStoreOngoing();

    const {
        sendReminder,
        removeParticipants,
        closeAllDialogs: closeAllDialogsPending,
    } = useSubmissionsBulkActionsDialogStorePending();

    if (isLoading) return <div>{t('loading')}</div>;
    if (error) return <div>{t('errorLoadingData')}</div>;
    if (!data) return null;
    if (!table) return <DashboardLoader />;

    return (
        <div className="h-auto w-full overflow-visible rounded-lg border">
            <div className="max-w-full overflow-visible rounded-lg">
                <Table className="rounded-lg">
                    <TableHeader className="relative bg-primary-200">
                        {table &&
                            table?.getHeaderGroups()?.length > 0 &&
                            table?.getHeaderGroups()?.map((headerGroup) => (
                                <TableRow key={headerGroup.id} className="hover:bg-primary-200">
                                    {headerGroup.headers.map((header) => (
                                        <TableHead
                                            key={header.id}
                                            className={`${headerTextCss} overflow-visible bg-primary-100 text-subtitle font-semibold text-neutral-600 ${
                                                columnWidths?.[header.column.id] || ''
                                            }`}
                                        >
                                            {flexRender(
                                                header.column.columnDef.header,
                                                header.getContext()
                                            )}
                                        </TableHead>
                                    ))}
                                </TableRow>
                            ))}
                    </TableHeader>
                    <TableBody>
                        {table.getRowModel().rows.map((row) => (
                            <TableRow key={row.id} className="hover:bg-white">
                                {row.getVisibleCells().map((cell) => (
                                    <TableCell
                                        key={cell.id}
                                        className={`${cellCommonCss} z-10 bg-white text-body font-regular text-neutral-600 ${
                                            columnWidths?.[cell.column.id] || ''
                                        }`}
                                    >
                                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                                    </TableCell>
                                ))}
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </div>

            <ProvideReattemptDialog
                trigger={null}
                open={isProvideReattemptOpen}
                onOpenChange={(open) => {
                    if (!open) closeAllDialogs();
                }}
            />

            <ProvideRevaluateAssessmentDialog
                trigger={null}
                open={isProvideRevaluateAssessment}
                onOpenChange={(open) => {
                    if (!open) closeAllDialogs();
                }}
            />
            <ProvideRevaluateQuestionWiseDialog
                trigger={null}
                open={isProvideRevaluateQuestionWise}
                onOpenChange={(open) => {
                    if (!open) closeAllDialogs();
                }}
            />

            <ProvideReleaseResultDialog
                trigger={null}
                open={isReleaseResult}
                onOpenChange={(open) => {
                    if (!open) closeAllDialogs();
                }}
            />

            <IncreaseAssessmentTimeDialog
                trigger={null}
                open={increaseAssessmentTime}
                onOpenChange={(open) => {
                    if (!open) closeAllDialogsOngoing();
                }}
                durationDistribution="ASSESSMENT"
            />

            <CloseSubmissionDialog
                trigger={null}
                open={closeSubmission}
                onOpenChange={(open) => {
                    if (!open) closeAllDialogsOngoing();
                }}
            />

            <SendReminderDialog
                trigger={null}
                open={sendReminder}
                onOpenChange={(open) => {
                    if (!open) closeAllDialogsPending();
                }}
            />

            <RemoveParticipantsDialog
                trigger={null}
                open={removeParticipants}
                onOpenChange={(open) => {
                    if (!open) closeAllDialogsPending();
                }}
            />
        </div>
    );
}
