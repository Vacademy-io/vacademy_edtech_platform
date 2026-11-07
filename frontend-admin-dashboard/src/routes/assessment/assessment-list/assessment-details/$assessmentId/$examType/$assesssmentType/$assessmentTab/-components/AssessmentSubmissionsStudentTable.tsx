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
import { RemoveParticipantsDialog } from './assessment-menu-options-pending-bulk/remove-participants-component';

const headerTextCss = 'px-3 py-2.5';
const cellCommonCss = 'px-3 py-3';

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
    currentPage,
}: MyTableProps<T>) {
    const { t } = useTranslation('assessmentSubmissionsStudentTable');
    const table = useReactTable({
        data: data?.content || [],
        columns,
        getCoreRowModel: getCoreRowModel(),
        meta: { onSort, pageOffset: currentPage * (data?.page_size ?? 10) },
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

    const { removeParticipants, closeAllDialogs: closeAllDialogsPending } =
        useSubmissionsBulkActionsDialogStorePending();

    if (!data) return null;
    if (!table) return <DashboardLoader />;

    const rows = table.getRowModel().rows;
    const leafColumns = table.getAllLeafColumns();
    const skeletonRowCount = data.page_size || 10;

    // Loading, error and empty all render INSIDE the table body rather than in place of
    // the whole table. Returning a bare <div>Loading...</div> tore the column headers off
    // the screen and back on again on every page change, filter and sub-tab switch — and
    // an empty result set previously rendered a header row over nothing at all, with no
    // indication that the filters simply matched no one.
    const bodyState = () => {
        if (error) {
            return (
                <TableRow className="hover:bg-white">
                    <TableCell colSpan={leafColumns.length} className="p-8 text-center">
                        <p className="text-subtitle font-semibold text-danger-600">
                            {t('states.error')}
                        </p>
                        <p className="text-body text-neutral-500">{t('states.errorHint')}</p>
                    </TableCell>
                </TableRow>
            );
        }
        if (isLoading) {
            return Array.from({ length: skeletonRowCount }).map((_, rowIndex) => (
                <TableRow key={`skeleton-${rowIndex}`} className="hover:bg-white">
                    {leafColumns.map((column) => (
                        <TableCell key={column.id} className={cellCommonCss}>
                            <div className="h-4 w-full animate-pulse rounded bg-neutral-100" />
                        </TableCell>
                    ))}
                </TableRow>
            ));
        }
        return (
            <TableRow className="hover:bg-white">
                <TableCell colSpan={leafColumns.length} className="p-8 text-center">
                    <p className="text-subtitle font-semibold text-neutral-600">
                        {t('states.emptyTitle')}
                    </p>
                    <p className="text-body text-neutral-500">{t('states.emptyHint')}</p>
                </TableCell>
            </TableRow>
        );
    };

    return (
        <div className="h-auto w-full overflow-visible rounded-xl border border-neutral-200">
            <div className="max-w-full overflow-visible rounded-xl">
                <Table className="rounded-xl">
                    <TableHeader className="relative bg-neutral-50">
                        {table &&
                            table?.getHeaderGroups()?.length > 0 &&
                            table?.getHeaderGroups()?.map((headerGroup) => (
                                <TableRow
                                    key={headerGroup.id}
                                    className="border-b border-neutral-200 hover:bg-neutral-50"
                                >
                                    {headerGroup.headers.map((header) => (
                                        <TableHead
                                            key={header.id}
                                            className={`${headerTextCss} overflow-visible whitespace-nowrap bg-neutral-50 text-caption font-semibold text-neutral-500 ${
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
                        {rows.length > 0 && !isLoading && !error
                            ? rows.map((row) => (
                                  <TableRow
                                      key={row.id}
                                      className="group border-b border-neutral-100"
                                  >
                                      {row.getVisibleCells().map((cell) => (
                                          <TableCell
                                              key={cell.id}
                                              className={`${cellCommonCss} z-10 bg-white text-body font-regular text-neutral-600 transition-colors group-hover:bg-neutral-50 ${
                                                  columnWidths?.[cell.column.id] || ''
                                              }`}
                                          >
                                              {flexRender(
                                                  cell.column.columnDef.cell,
                                                  cell.getContext()
                                              )}
                                          </TableCell>
                                      ))}
                                  </TableRow>
                              ))
                            : bodyState()}
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
