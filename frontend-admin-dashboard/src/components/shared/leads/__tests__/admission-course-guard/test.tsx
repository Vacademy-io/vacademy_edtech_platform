import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';

const { check } = vi.hoisted(() => ({ check: vi.fn() }));

vi.mock('@/lib/auth/instituteUtils', () => ({ getCurrentInstituteId: () => 'inst-1' }));
vi.mock('@/components/shared/leads/services/admission-check', async (importOriginal) => ({
    ...(await importOriginal<
        typeof import('@/components/shared/leads/services/admission-check')
    >()),
    checkAdmission: check,
}));

import { useAdmissionCourseGuard } from '@/components/shared/leads/admission-course-guard';

const CONVERTED = { status_key: 'CONVERTED', label: 'Admission Taken' };

let confirm: ReturnType<typeof useAdmissionCourseGuard>['confirmAdmission'];

function Host() {
    const guard = useAdmissionCourseGuard();
    confirm = guard.confirmAdmission;
    return guard.admissionDialog;
}

const answer = (mode: string, without: string[]) =>
    check.mockResolvedValue({
        mode,
        status_key: 'CONVERTED',
        checked: 1,
        without_course_count: without.length,
        without_course: without,
    });

describe('useAdmissionCourseGuard', () => {
    beforeEach(() => {
        check.mockReset();
        render(<Host />);
    });

    it('asks nothing for another status', async () => {
        await expect(
            confirm(['r1'], { status_key: 'INTERESTED', label: 'Interested' })
        ).resolves.toBe(true);
        expect(check).not.toHaveBeenCalled();
    });

    it('asks nothing when the rule is off or everyone has a course', async () => {
        answer('OFF', []);
        await expect(confirm(['r1'], CONVERTED)).resolves.toBe(true);
        answer('WARN', []);
        await expect(confirm(['r1'], CONVERTED)).resolves.toBe(true);
        expect(check).toHaveBeenCalledWith('inst-1', ['r1']);
    });

    it('warns and lets the user go ahead', async () => {
        answer('WARN', ['r1']);
        let result: Promise<boolean> | undefined;
        await act(async () => {
            result = confirm(['r1'], CONVERTED);
        });
        expect(await screen.findByText(/This person has no course or fee plan yet/)).toBeTruthy();
        fireEvent.click(screen.getByText('Go ahead anyway'));
        await expect(result).resolves.toBe(true);
    });

    it('warns and cancels', async () => {
        answer('WARN', ['r1']);
        let result: Promise<boolean> | undefined;
        await act(async () => {
            result = confirm(['r1'], CONVERTED);
        });
        fireEvent.click(await screen.findByText('Cancel'));
        await expect(result).resolves.toBe(false);
    });

    it('under block says to add the course first and does not go ahead', async () => {
        answer('BLOCK', ['r1']);
        let result: Promise<boolean> | undefined;
        await act(async () => {
            result = confirm(['r1'], CONVERTED);
        });
        expect(await screen.findByText('Add a course or fee plan first')).toBeTruthy();
        expect(screen.getByText(/before a lead is moved to Admission Taken/)).toBeTruthy();
        fireEvent.click(screen.getByText('OK'));
        await expect(result).resolves.toBe(false);
    });

    it('under block offers to move the others in a bulk change', async () => {
        answer('BLOCK', ['r2']);
        let result: Promise<boolean> | undefined;
        await act(async () => {
            result = confirm(['r1', 'r2', 'r3'], CONVERTED);
        });
        fireEvent.click(await screen.findByText('Move the other 2'));
        await expect(result).resolves.toBe(true);
    });

    it('goes ahead when the check itself fails (the server still applies the rule)', async () => {
        check.mockRejectedValue(new Error('network'));
        await expect(confirm(['r1'], CONVERTED)).resolves.toBe(true);
    });
});
