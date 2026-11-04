import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';

const setSelectedStudent = vi.fn();

vi.mock('@/routes/manage-students/students-list/-context/selected-student-sidebar-context', () => ({
    useStudentSidebar: () => ({ setSelectedStudent }),
}));

// The real sheet pulls in the whole learner profile; only its mounting matters here.
vi.mock(
    '@/routes/manage-students/students-list/-components/students-list/student-side-view/student-side-view',
    () => ({ StudentSidebar: () => <div data-testid="student-sidebar" /> })
);

// Buttons stand in for the provider's own open/close paths (Cmd/Ctrl+B, the sheet's X).
vi.mock('@/components/ui/sidebar', () => ({
    SidebarProvider: ({
        children,
        onOpenChange,
    }: {
        children: ReactNode;
        onOpenChange: (open: boolean) => void;
    }) => (
        <div>
            <button type="button" onClick={() => onOpenChange(true)}>
                provider-open
            </button>
            <button type="button" onClick={() => onOpenChange(false)}>
                provider-close
            </button>
            {children}
        </div>
    ),
}));

import { ReportLeadName } from '../report-lead-name';
import { ReportLeadSheetProvider } from '../report-lead-sheet';

describe('ReportLeadName', () => {
    beforeEach(() => setSelectedStudent.mockClear());

    it('is plain text outside the Reports page sheet', () => {
        render(<ReportLeadName lead={{ userId: 'u1', name: 'Riya' }} contact="9000000000" />);
        expect(screen.queryByRole('button')).toBeNull();
        expect(screen.getByText('Riya')).toBeTruthy();
        expect(screen.getByText('9000000000')).toBeTruthy();
    });

    it('opens the lead side sheet seeded from the row, without mounting it before', () => {
        render(
            <ReportLeadSheetProvider>
                <ReportLeadName
                    lead={{ userId: 'u1', name: 'Riya', phone: '9000000000', email: null }}
                    contact="9000000000"
                />
            </ReportLeadSheetProvider>
        );
        // Closed: the sheet (and its requests) is not mounted yet.
        expect(screen.queryByTestId('student-sidebar')).toBeNull();

        fireEvent.click(screen.getByRole('button', { name: 'Riya' }));

        expect(setSelectedStudent).toHaveBeenCalledTimes(1);
        const [student, opts] = setSelectedStudent.mock.calls[0]!;
        expect(student).toMatchObject({
            id: 'u1',
            user_id: 'u1',
            full_name: 'Riya',
            mobile_number: '9000000000',
            email: '',
        });
        // No response id key: the Lead Profile tab loads the student's own enquiries.
        expect('_response_id' in student).toBe(false);
        // No status: the header would show it as a chip ("Inactive" on a converted student).
        expect('status' in student).toBe(false);
        expect(opts).toEqual({ openOverlay: false });
        expect(screen.getByTestId('student-sidebar')).toBeTruthy();
    });

    it('does not open from the provider shortcut, and closes from it', () => {
        render(
            <ReportLeadSheetProvider>
                <ReportLeadName lead={{ userId: 'u1', name: 'Riya' }} />
            </ReportLeadSheetProvider>
        );
        // Cmd/Ctrl+B would open the sheet on a student another page selected.
        fireEvent.click(screen.getByText('provider-open'));
        expect(screen.queryByTestId('student-sidebar')).toBeNull();
        expect(setSelectedStudent).not.toHaveBeenCalled();

        fireEvent.click(screen.getByRole('button', { name: 'Riya' }));
        expect(screen.getByTestId('student-sidebar')).toBeTruthy();
        fireEvent.click(screen.getByText('provider-close'));
        expect(screen.queryByTestId('student-sidebar')).toBeNull();
    });
});
