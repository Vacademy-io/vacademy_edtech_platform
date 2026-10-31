import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { CourseFinderEditor } from './CourseFinderEditor';
import type { CourseFinderSettings, MappingRow } from '../-types/product-page-types';

/**
 * The panel that authors the learner-facing "choose your class" screen.
 * A settings panel that throws takes the whole editor tab down with it, and
 * `tsc` cannot see a hook order or a missing-prop crash.
 */

const course = (packageSessionId: string, packageName: string): MappingRow => ({
    rowId: `row-${packageSessionId}`,
    inviteId: `inv-${packageSessionId}`,
    inviteName: `Invite ${packageSessionId}`,
    psInvitePaymentOptionId: `bridge-${packageSessionId}`,
    packageSessionId,
    paymentPlanId: 'plan-1',
    paymentPlanName: 'Default Plan',
    paymentPlanPrice: 0,
    currency: 'INR',
    preselected: false,
    displayOrder: 0,
    levelName: 'Scholarship Test',
    packageName,
});

const COURSES = [
    course('ps-6', 'UnlockX Scholarship Test - Class 6'),
    course('ps-7', 'UnlockX Scholarship Test - Class 7'),
    course('ps-8', 'UnlockX Scholarship Test - Class 8'),
];

const EMPTY: CourseFinderSettings = { enabled: true, groups: [] };

describe('CourseFinderEditor', () => {
    it('renders with no buttons configured yet', () => {
        render(<CourseFinderEditor value={EMPTY} courses={COURSES} onChange={vi.fn()} />);
        expect(screen.getByText('Buttons')).toBeInTheDocument();
    });

    it('renders when the page has no courses at all', () => {
        // The Courses tab may not have been filled in yet — the panel must not
        // assume it has anything to group.
        render(<CourseFinderEditor value={EMPTY} courses={[]} onChange={vi.fn()} />);
        expect(screen.getByText('Buttons')).toBeInTheDocument();
        expect(screen.queryByText('One button per course')).not.toBeInTheDocument();
    });

    it('auto-fills one button per course, labelled by what differs', () => {
        const onChange = vi.fn();
        render(<CourseFinderEditor value={EMPTY} courses={COURSES} onChange={onChange} />);

        fireEvent.click(screen.getByText('One button per course'));

        const next = onChange.mock.calls[0]?.[0] as CourseFinderSettings;
        expect(next.groups.map((g) => g.label)).toEqual(['Class 6', 'Class 7', 'Class 8']);
        expect(next.groups.map((g) => g.packageSessionIds)).toEqual([
            ['ps-6'],
            ['ps-7'],
            ['ps-8'],
        ]);
        // Ids must be distinct — the learner stores the picked one.
        expect(new Set(next.groups.map((g) => g.id)).size).toBe(3);
    });

    it('asks before replacing hand-authored buttons', () => {
        const onChange = vi.fn();
        const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
        const value: CourseFinderSettings = {
            enabled: true,
            groups: [{ id: 'g1', label: 'Class 11 JEE + NEET', packageSessionIds: ['ps-6', 'ps-7'] }],
        };
        render(<CourseFinderEditor value={value} courses={COURSES} onChange={onChange} />);

        fireEvent.click(screen.getByText('Rebuild: one per course'));

        expect(confirmSpy).toHaveBeenCalled();
        // Declining must leave the grouping untouched.
        expect(onChange).not.toHaveBeenCalled();
        confirmSpy.mockRestore();
    });

    it('does not ask when there is nothing to lose', () => {
        const onChange = vi.fn();
        const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
        render(<CourseFinderEditor value={EMPTY} courses={COURSES} onChange={onChange} />);

        fireEvent.click(screen.getByText('One button per course'));

        expect(confirmSpy).not.toHaveBeenCalled();
        expect(onChange).toHaveBeenCalled();
        confirmSpy.mockRestore();
    });

    it('warns about a button with no courses behind it', () => {
        const value: CourseFinderSettings = {
            enabled: true,
            groups: [{ id: 'g1', label: 'Class 6', packageSessionIds: [] }],
        };
        render(<CourseFinderEditor value={value} courses={COURSES} onChange={vi.fn()} />);
        expect(
            screen.getByText(/this button will be hidden from learners/i)
        ).toBeInTheDocument();
    });

    it('warns about courses no button can reach', () => {
        const value: CourseFinderSettings = {
            enabled: true,
            groups: [{ id: 'g1', label: 'Class 6', packageSessionIds: ['ps-6'] }],
        };
        render(<CourseFinderEditor value={value} courses={COURSES} onChange={vi.fn()} />);
        expect(screen.getByText(/2 courses on no button/i)).toBeInTheDocument();
    });

    it('adds a course to a button', () => {
        const onChange = vi.fn();
        const value: CourseFinderSettings = {
            enabled: true,
            groups: [{ id: 'g1', label: 'Class 6', packageSessionIds: [] }],
        };
        render(<CourseFinderEditor value={value} courses={COURSES} onChange={onChange} />);

        fireEvent.click(screen.getByText(/0 courses ·/));
        // The label wraps the level name too, so its accessible name is the
        // course and level together — match on the course part.
        fireEvent.click(screen.getByLabelText(/UnlockX Scholarship Test - Class 6/));

        const next = onChange.mock.calls[0]?.[0] as CourseFinderSettings;
        expect(next.groups[0]?.packageSessionIds).toEqual(['ps-6']);
    });
});
