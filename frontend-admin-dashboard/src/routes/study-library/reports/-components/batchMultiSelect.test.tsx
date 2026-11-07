import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import type {
    BatchForSessionType,
    InstituteDetailsType,
} from '@/schemas/student/student-list/institute-schema';
import { matchesSearch } from '@/components/design-system/multi-select';
import BatchMultiSelect, { toBatchOption } from './batchMultiSelect';

vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string, opts?: Record<string, unknown>) =>
            opts?.count !== undefined ? `${key}:${opts.count}` : key,
    }),
}));
vi.mock('@/components/common/layout-container/sidebar/utils', () => ({
    getTerminology: () => 'Batch',
    getTerminologyPlural: () => 'Batches',
}));

const batch = (
    id: string,
    course: string,
    level: string,
    session: string,
    name: string | null = null
) =>
    ({
        id,
        name,
        status: 'ACTIVE',
        start_time: null,
        package_dto: { id: `c-${course}`, package_name: course },
        level: { id: level === 'DEFAULT' ? 'DEFAULT' : `l-${level}`, level_name: level },
        session: {
            id: session === 'DEFAULT' ? 'DEFAULT' : `s-${session}`,
            session_name: session,
        },
    }) as unknown as BatchForSessionType;

const seedStore = () =>
    useInstituteDetailsStore.setState({
        instituteDetails: {
            batches_for_sessions: [
                batch('ps-2', 'JEE FOUNDATION', 'Grade 10', '2026-27'),
                batch('ps-1', 'JEE FOUNDATION', 'Grade 9', '2026-27'),
                batch('ps-3', 'YOGA BASICS', 'DEFAULT', 'DEFAULT'),
                batch('ps-4', 'YOGA BASICS', 'DEFAULT', 'DEFAULT', 'Evening cohort'),
            ],
        } as unknown as InstituteDetailsType,
    });

describe('toBatchOption', () => {
    it('labels "Course · Level · Session" verbatim and skips DEFAULT placeholders', () => {
        expect(toBatchOption(batch('x', 'JEE FOUNDATION', 'Grade 9', '2026-27')).label).toBe(
            'JEE FOUNDATION · Grade 9 · 2026-27'
        );
        const plain = toBatchOption(batch('y', 'YOGA BASICS', 'DEFAULT', 'DEFAULT'));
        expect(plain.label).toBe('YOGA BASICS');
        expect(plain.batchLabel).toBe('');
        expect(plain.sessionName).toBe('');
        expect(plain.levelName).toBe('');
        // A child batch's display name is appended so siblings stay distinct.
        expect(
            toBatchOption(batch('z', 'YOGA BASICS', 'DEFAULT', 'DEFAULT', 'Evening cohort')).label
        ).toBe('YOGA BASICS · Evening cohort');
    });
});

describe('matchesSearch', () => {
    it('needs every typed word to start a word of the label', () => {
        expect(matchesSearch('6th June Demo', 'class 6')).toBe(false);
        expect(matchesSearch('6th June Demo', '6')).toBe(true);
        expect(matchesSearch('Class 6A · 2026-27', 'CLASS 6')).toBe(true);
        expect(matchesSearch('Class 7 · 2026-27', '26')).toBe(false);
        expect(matchesSearch('Class 7 · 2026-27', '2026-27')).toBe(true);
        expect(matchesSearch('Hindi Grammar', 'gram')).toBe(true);
        expect(matchesSearch('Hindi Grammar', 'ammar')).toBe(false);
        expect(matchesSearch('हिंदी व्याकरण', 'हिंदी')).toBe(true);
        expect(matchesSearch('Anything', '   ')).toBe(true);
    });
});

describe('BatchMultiSelect', () => {
    it('lists every batch of the institute and reports toggles as package_session_ids', () => {
        seedStore();
        const onChange = vi.fn();
        render(<BatchMultiSelect selected={[]} onChange={onChange} />);

        expect(screen.getByText('label')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('combobox'));

        // Sorted by label; the two Yoga batches remain distinguishable.
        const items = screen.getAllByRole('option').map((el) => el.textContent?.trim());
        expect(items).toEqual([
            'JEE FOUNDATION · Grade 10 · 2026-27',
            'JEE FOUNDATION · Grade 9 · 2026-27',
            'YOGA BASICS',
            'YOGA BASICS · Evening cohort',
        ]);

        fireEvent.click(screen.getByText('JEE FOUNDATION · Grade 9 · 2026-27'));
        expect(onChange).toHaveBeenCalledWith(['ps-1']);
    });

    it('search keeps only batches holding every typed word, never fuzzy near-misses', () => {
        useInstituteDetailsStore.setState({
            instituteDetails: {
                batches_for_sessions: [
                    batch('ps-7', 'Class 7 | DAV', 'Class 7', '2026-27'),
                    batch('ps-8', 'Hindi Grammar | Class 8', 'Class 8', '2026-27'),
                    batch('ps-9', 'Class 9 - Demo', 'DEFAULT', 'DEFAULT'),
                ],
            } as unknown as InstituteDetailsType,
        });
        render(<BatchMultiSelect selected={[]} onChange={vi.fn()} />);
        fireEvent.click(screen.getByRole('combobox'));
        const search = screen.getByPlaceholderText('Search options...');
        const visible = () => screen.queryAllByRole('option').map((el) => el.textContent?.trim());

        // "6" sits only in the year (and ids) — fuzzy matching used to list all three.
        fireEvent.change(search, { target: { value: 'class 6' } });
        expect(visible()).toEqual([]);
        expect(screen.getByText('No options found.')).toBeInTheDocument();

        fireEvent.change(search, { target: { value: 'hindi 8' } });
        expect(visible()).toEqual(['Hindi Grammar | Class 8 · Class 8 · 2026-27']);

        // Ids are not searchable: "ps-7" must not surface the Class 7 batch.
        fireEvent.change(search, { target: { value: 'ps-7' } });
        expect(visible()).toEqual([]);
    });

    it('shows the selection count, an error, and clears on demand', () => {
        seedStore();
        const onChange = vi.fn();
        const { rerender } = render(
            <BatchMultiSelect selected={['ps-1', 'ps-2']} onChange={onChange} />
        );
        expect(screen.getByText('selectedCount:2')).toBeInTheDocument();
        fireEvent.click(screen.getByText('clear'));
        expect(onChange).toHaveBeenCalledWith([]);

        rerender(<BatchMultiSelect selected={[]} onChange={onChange} error="Pick one" />);
        expect(screen.getByText('Pick one')).toBeInTheDocument();
        expect(screen.queryByText('clear')).not.toBeInTheDocument();
    });
});
