import { createRef } from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import Papa from 'papaparse';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import type { LiveSessionReport } from '../-services/utils';
import {
    adminMarkAttendance,
    getSessionCustomFieldValues,
    getSessionLearnerFields,
} from '../-services/utils';
import { AttendanceMarkingTable } from './AttendanceMarkingTable';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('papaparse', () => ({ default: { unparse: vi.fn(() => 'csv') } }));
vi.mock('../-services/utils', () => ({
    adminMarkAttendance: vi.fn(async () => ({ updated: 1, created: 0 })),
    getSessionCustomFieldValues: vi.fn(async () => ({})),
    getSessionLearnerFields: vi.fn(async () => ({ custom_fields: {}, system_fields: {} })),
}));

const learner = (over: Partial<LiveSessionReport> = {}): LiveSessionReport => ({
    fullName: 'Asha Learner',
    attendanceDetails: null,
    attendanceTimestamp: null,
    attendanceStatus: null,
    dateOfBirth: null,
    mobileNumber: '9000000001',
    email: 'asha@example.com',
    enrollmentStatus: 'ACTIVE',
    gender: 'FEMALE',
    studentId: 'u1',
    instituteEnrollmentNumber: 'EN-1',
    statusType: 'ONLINE',
    engagementData: null,
    providerTotalDurationMinutes: 30,
    feedbackDetails: null,
    sourceType: 'USER',
    batchName: 'Batch A',
    registeredAt: null,
    ...over,
});

const guest = learner({
    fullName: 'Gopal Guest',
    email: 'gopal@example.com',
    mobileNumber: '9000000002',
    studentId: 'g1',
    enrollmentStatus: null as unknown as string,
    sourceType: 'EXTERNAL_USER',
    batchName: null,
    providerTotalDurationMinutes: null,
    attendanceStatus: 'PRESENT',
});

const guestField = (
    guestId: string,
    fieldKey: string,
    fieldName: string,
    value: string | null
) => ({
    guestId,
    fieldKey,
    fieldName,
    fieldType: 'TEXT',
    customFieldValue: value,
    id: `${guestId}-${fieldKey}`,
});

function renderTable(data: LiveSessionReport[] = [learner(), guest], extra = {}) {
    return render(
        <TooltipProvider>
            <AttendanceMarkingTable
                data={data}
                sessionId="s1"
                scheduleId="sch1"
                accessType="public"
                packageSessionDetails={[{ package_session_id: 'p1', package_name: 'Physics' }]}
                {...extra}
            />
        </TooltipProvider>
    );
}

const headers = () => screen.getAllByRole('columnheader').map((th) => th.textContent?.trim() ?? '');

/** Rows handed to Papa.unparse by the last CSV export. */
const lastCsvRows = () => {
    const calls = vi.mocked(Papa.unparse).mock.calls;
    return calls[calls.length - 1]![0] as Record<string, unknown>[];
};

const exportCsv = () => fireEvent.click(screen.getByRole('button', { name: /exportCsv/ }));

const openManageColumns = () =>
    fireEvent.click(screen.getByRole('button', { name: 'Manage Column' }));

beforeEach(() => {
    localStorage.clear();
    vi.mocked(Papa.unparse).mockClear();
    vi.mocked(adminMarkAttendance).mockClear();
    vi.mocked(getSessionCustomFieldValues).mockResolvedValue({
        g1: [guestField('g1', 'school', 'School', 'Guest School')],
    });
    vi.mocked(getSessionLearnerFields).mockResolvedValue({
        custom_fields: { u1: [guestField('', 'roll_no', 'Roll No', '42')] },
        system_fields: { u1: { CITY: 'Pune', USERNAME: 'asha01' } },
    });
    URL.createObjectURL = vi.fn(() => 'blob:x');
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
});

describe('AttendanceMarkingTable — existing behaviour', () => {
    it('shows the same default columns as before (plus custom fields), new ones hidden', async () => {
        renderTable();
        await screen.findByText('Guest School');
        const h = headers();
        expect(h).toEqual(
            expect.arrayContaining([
                '#',
                'columns.name',
                expect.stringContaining('columns.status'),
                'columns.email',
                'School',
                'Roll No',
                expect.stringContaining('columns.duration'),
                expect.stringContaining('columns.activePoints'),
                'columns.mode',
            ])
        );
        expect(h).not.toContain('columns.phone');
        expect(h).not.toContain('columns.city');
        expect(h).not.toContain('columns.course');
    });

    it('marks P / A, highlights the row and saves with the right source type', async () => {
        renderTable();
        await screen.findByText('Guest School');
        const asha = screen.getByText('Asha Learner').closest('tr')!;
        fireEvent.click(within(asha).getByRole('button', { name: /P/ }));
        expect(asha.className).toContain('bg-yellow-50');

        const gopal = screen.getByText('Gopal Guest').closest('tr')!;
        fireEvent.click(within(gopal).getByRole('button', { name: /A/ }));

        fireEvent.click(screen.getByRole('button', { name: 'saveAttendance' }));
        await waitFor(() => expect(adminMarkAttendance).toHaveBeenCalledTimes(1));
        expect(vi.mocked(adminMarkAttendance).mock.calls[0]![0]).toEqual({
            sessionId: 's1',
            scheduleId: 'sch1',
            entries: expect.arrayContaining([
                { userSourceId: 'u1', userSourceType: 'USER', status: 'PRESENT' },
                { userSourceId: 'g1', userSourceType: 'EXTERNAL_USER', status: 'ABSENT' },
            ]),
        });
    });

    it('clicking the same mark again clears it (no save needed)', async () => {
        renderTable();
        await screen.findByText('Guest School');
        const asha = screen.getByText('Asha Learner').closest('tr')!;
        fireEvent.click(within(asha).getByRole('button', { name: /P/ }));
        fireEvent.click(within(asha).getByRole('button', { name: /P/ }));
        expect(screen.queryByRole('button', { name: 'saveAttendance' })).toBeNull();
    });

    it('sorts by status and expands a row with engagement details', async () => {
        renderTable();
        await screen.findByText('Guest School');
        fireEvent.click(screen.getByRole('button', { name: /columns.status/ }));
        const names = screen
            .getAllByRole('row')
            .slice(1)
            .map((r) => r.textContent ?? '');
        expect(names[0]).toContain('Gopal Guest'); // PRESENT sorts first (desc)

        const asha = screen.getByText('Asha Learner').closest('tr')!;
        const cells = within(asha).getAllByRole('button');
        fireEvent.click(cells[cells.length - 1]!);
        expect(screen.getByText('detail.duration')).toBeInTheDocument();
    });

    it('shows the empty state when nobody is linked to the class', () => {
        renderTable([]);
        expect(screen.getByText('emptyTitle')).toBeInTheDocument();
    });
});

describe('AttendanceMarkingTable — Manage Column + CSV', () => {
    it('default CSV keeps the old headers and "-" for missing custom answers', async () => {
        renderTable();
        await screen.findByText('Guest School');
        exportCsv();
        const rows = lastCsvRows();
        expect(Object.keys(rows[0]!)).toEqual([
            'csv.number',
            'csv.name',
            'csv.status',
            'csv.email',
            'School',
            'Roll No',
            'csv.durationMin',
            'csv.activePoints',
            'csv.mode',
        ]);
        const asha = rows.find((r) => r['csv.name'] === 'Asha Learner')!;
        expect(asha['School']).toBe('-');
        expect(asha['Roll No']).toBe('42');
        const gopal = rows.find((r) => r['csv.name'] === 'Gopal Guest')!;
        expect(gopal['School']).toBe('Guest School');
        expect(gopal['Roll No']).toBe('-');
        expect(gopal['csv.status']).toBe('status.present');
    });

    it('lists System fields and Custom fields; ticking a column adds it to table and CSV', async () => {
        renderTable();
        await screen.findByText('Guest School');
        openManageColumns();
        expect(await screen.findByText('columnGroups.system')).toBeInTheDocument();
        expect(screen.getByText('columnGroups.custom')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('checkbox', { name: 'columns.phone' }));
        fireEvent.click(screen.getByRole('checkbox', { name: 'columns.city' }));
        fireEvent.click(screen.getByRole('checkbox', { name: 'School' }));

        expect(headers()).toContain('columns.phone');
        expect(headers()).toContain('columns.city');
        expect(headers()).not.toContain('School');

        exportCsv();
        const rows = lastCsvRows();
        expect(Object.keys(rows[0]!)).toContain('columns.phone');
        expect(Object.keys(rows[0]!)).not.toContain('School');
        const asha = rows.find((r) => r['csv.name'] === 'Asha Learner')!;
        expect(asha['columns.phone']).toBe('9000000001');
        expect(asha['columns.city']).toBe('Pune');
    });

    it('Name and Status cannot be switched off', async () => {
        renderTable();
        await screen.findByText('Guest School');
        openManageColumns();
        expect(await screen.findByRole('checkbox', { name: 'columns.name' })).toBeDisabled();
        expect(screen.getByRole('checkbox', { name: 'columns.status' })).toBeDisabled();
    });

    it('finds a guest by form email, trying every registration with that email', async () => {
        vi.mocked(getSessionCustomFieldValues).mockResolvedValue({
            other1: [
                guestField('other1', 'email', 'Email', 'gopal@example.com'),
                guestField('other1', 'school', 'School', null),
            ],
            other2: [
                guestField('other2', 'email', 'Email', 'gopal@example.com'),
                guestField('other2', 'school', 'School', 'Second Reg School'),
            ],
        });
        renderTable([guest]);
        expect(await screen.findByText('Second Reg School')).toBeInTheDocument();
    });

    it('hands its CSV export to exportCsvRef (the dialog CSV button)', async () => {
        const ref = createRef<(() => void) | null>() as { current: (() => void) | null };
        renderTable(undefined, { exportCsvRef: ref });
        await screen.findByText('Guest School');
        expect(typeof ref.current).toBe('function');
        ref.current!();
        expect(Papa.unparse).toHaveBeenCalledTimes(1);
    });

    it('asks for learner fields only for non-guests', async () => {
        renderTable();
        await screen.findByText('Guest School');
        expect(getSessionLearnerFields).toHaveBeenCalledWith('s1', ['u1']);
    });
});
