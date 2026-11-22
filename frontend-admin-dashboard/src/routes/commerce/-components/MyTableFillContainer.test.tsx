/**
 * MyTable `fillContainer`: by default the table is exactly as wide as the sum of
 * its column sizes, so in a wide container the header row stopped short of the
 * right edge. With the prop the table fills the container and the column sizes
 * become minimums (a narrow container still scrolls sideways).
 */
import { render } from '@testing-library/react';
import type { ColumnDef } from '@tanstack/react-table';
import { describe, expect, it, vi } from 'vitest';

// The table mounts the student-list dialogs; none of them matters here.
vi.mock('@/components/design-system/table-components/student-menu-options/change-batch-dialog', () => ({ ChangeBatchDialog: () => null }));
vi.mock('@/components/design-system/table-components/student-menu-options/extend-session-dialog', () => ({ ExtendSessionDialog: () => null }));
vi.mock('@/routes/manage-students/students-list/-components/students-list/bulk-extend-access-dialog', () => ({
    BulkExtendAccessDialog: () => null,
}));
vi.mock('@/components/design-system/table-components/student-menu-options/re-register-dialog', () => ({ ReRegisterDialog: () => null }));
vi.mock('@/components/design-system/table-components/student-menu-options/terminate-registration-dialog', () => ({
    TerminateRegistrationDialog: () => null,
}));
vi.mock('@/components/design-system/table-components/student-menu-options/delete-student-dialog', () => ({ DeleteStudentDialog: () => null }));
vi.mock('@/routes/manage-students/students-list/-hooks/useDialogStore', () => ({
    useDialogStore: () => ({ closeAllDialogs: () => undefined }),
}));
vi.mock('@/components/core/dashboard-loader', () => ({ DashboardLoader: () => null }));

import { MyTable } from '@/components/design-system/table';

type Row = { name: string };
const columns: ColumnDef<Row>[] = [
    { id: 'name', header: 'Name', size: 200, cell: ({ row }) => row.original.name },
    { id: 'actions', header: '', size: 300, cell: () => 'act' },
];
const data = { content: [{ name: 'a' }], page_no: 0, page_size: 1, total_elements: 1, total_pages: 1, last: true };

const tableOf = (container: HTMLElement) => container.querySelector('table') as HTMLTableElement;

describe('MyTable fillContainer', () => {
    it('default: the table is as wide as its columns (unchanged for every other table)', () => {
        const { container } = render(
            <MyTable<Row> data={data} columns={columns} isLoading={false} error={null} currentPage={0} />
        );
        expect(tableOf(container).style.width).toBe('500px');
    });

    it('fills the container, with the column total as the floor', () => {
        const { container } = render(
            <MyTable<Row> data={data} columns={columns} isLoading={false} error={null} currentPage={0} fillContainer />
        );
        expect(tableOf(container).style.width).toBe('100%');
        expect(tableOf(container).style.minWidth).toBe('500px');
    });

    it('enableColumnResizing={false} draws no resize handles', () => {
        const { container } = render(
            <MyTable<Row>
                data={data}
                columns={columns}
                isLoading={false}
                error={null}
                currentPage={0}
                fillContainer
                enableColumnResizing={false}
            />
        );
        expect(container.querySelector('.cursor-col-resize')).toBeNull();
    });
});
