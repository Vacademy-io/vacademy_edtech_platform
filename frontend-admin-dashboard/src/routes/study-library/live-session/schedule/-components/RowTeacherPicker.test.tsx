import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

// Keys + params instead of copy, so the assertions also pin what reaches t().
vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string, opts?: Record<string, unknown>) =>
            opts ? `${key} ${JSON.stringify(opts)}` : key,
    }),
}));

import { RowTeacherPicker, type TeacherDirectory } from './RowTeacherPicker';
import { buildTeacherIndex } from '../-utils/teacherDirectory';

const users = [
    { id: 'u1', full_name: 'Asha Rao', email: 'asha@school.org', username: 'asha01' },
    { id: 'u2', full_name: 'Ravi Kumar', email: 'ravi@school.org', username: 'ravik' },
];
const ready: TeacherDirectory = {
    status: 'ready',
    users,
    index: buildTeacherIndex(users),
    truncated: false,
};

const setup = (value: string[], directory: TeacherDirectory = ready) => {
    const onChange = vi.fn();
    const onApplyToAll = vi.fn();
    render(
        <RowTeacherPicker
            value={value}
            onChange={onChange}
            directory={directory}
            onApplyToAll={onApplyToAll}
        />
    );
    return { onChange, onApplyToAll };
};

const openPicker = () => fireEvent.click(screen.getAllByRole('button')[0]!);

describe('RowTeacherPicker', () => {
    it('shows the scheduler fallback when no teacher is set', () => {
        setup([]);
        expect(screen.getByRole('button').textContent).toContain('rowTeacherPicker.defaultYou');
    });

    it('shows CSV emails as the people they matched and flags the rest', () => {
        setup(['ASHA@school.org', 'typo@school.org']);
        expect(screen.getAllByRole('button')[0]!.textContent).toContain(
            'rowTeacherPicker.nameAndMore {"name":"Asha Rao","more":1}'
        );
        expect(screen.getByText('rowTeacherPicker.problemCount {"count":1}')).toBeTruthy();

        openPicker();
        expect(screen.getByText('rowTeacherPicker.notFound')).toBeTruthy();
    });

    it('searches staff by username and adds the picked user id', () => {
        const { onChange } = setup(['asha@school.org']);
        openPicker();
        fireEvent.change(screen.getByPlaceholderText('rowTeacherPicker.searchPlaceholder'), {
            target: { value: 'RAVIK' },
        });
        // Asha stays as a chip (she is selected) but drops out of the list.
        expect(screen.getAllByRole('checkbox')).toHaveLength(1);
        expect(screen.getByText('ravi@school.org')).toBeTruthy();
        fireEvent.click(screen.getByRole('checkbox'));
        expect(onChange).toHaveBeenCalledWith(['asha@school.org', 'u2']);
    });

    it('unticking someone removes the CSV email that pointed at them', () => {
        const { onChange } = setup(['asha@school.org', 'u2']);
        openPicker();
        const [ashaBox] = screen.getAllByRole('checkbox');
        expect(ashaBox!.getAttribute('data-state')).toBe('checked');
        fireEvent.click(ashaBox!);
        expect(onChange).toHaveBeenCalledWith(['u2']);
    });

    it('applies the row to every row', () => {
        const { onApplyToAll } = setup(['u1']);
        openPicker();
        fireEvent.click(screen.getByText('rowTeacherPicker.applyToAll'));
        expect(onApplyToAll).toHaveBeenCalledWith(['u1']);
    });

    it('keeps CSV entries as typed, unflagged, while the directory loads', () => {
        setup(['asha@school.org'], { status: 'loading', users: [], index: null, truncated: false });
        expect(screen.getByRole('button').textContent).toContain('asha@school.org');
        expect(screen.queryByText(/rowTeacherPicker.problemCount/)).toBeNull();
        openPicker();
        expect(screen.getByText('rowTeacherPicker.loading')).toBeTruthy();
    });
});
