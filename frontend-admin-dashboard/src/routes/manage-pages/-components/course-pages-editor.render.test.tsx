import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { CoursePagesEditor } from './CoursePagesEditor';
import type { CoursePageSetting, CourseViewMode } from './CoursePagesEditor';

/**
 * The rows are plain objects keyed by course id, and the ways to corrupt one
 * are invisible to `tsc`: re-keying a row can silently merge it into another
 * (losing a course's setting), a course no longer in the institute has no
 * option to render so editing a different row would drop it, and the page
 * picker must appear for exactly one of the three modes.
 */

const COURSE_A = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
const COURSE_B = 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb';

vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (k: string) => k }),
}));
vi.mock('@/stores/students/students-list/useInstituteDetailsStore', () => ({
    useInstituteDetailsStore: () => ({
        getCourseFromPackage: () => [
            { id: COURSE_A, name: 'Pregnancy Guide' },
            { id: COURSE_B, name: 'Toddler Tantrum Reset' },
        ],
    }),
}));

const PAGES = [
    { id: 'home', route: '', title: 'Home' },
    { id: 'p-toddler', route: 'toddler', title: 'Toddler Reset' },
    { id: 'p-preg', route: 'pregnancy', title: 'Your Pregnancy Journey' },
    { id: 'p-draft', route: 'draft', title: 'Draft', published: false },
];

// Reuse the component's own type rather than a looser local shape — that is
// what let an invalid mode into this file unnoticed.
type Row = CoursePageSetting;

// MyDropdown portals its menu into #portal-root, which only the real app
// shell renders — without it Radix gets container={null} and the menu never
// mounts, so the mode options would be untestable.
const setup = (courses: Record<string, Row> = {}) => {
    if (!document.getElementById('portal-root')) {
        const root = document.createElement('div');
        root.id = 'portal-root';
        document.body.appendChild(root);
    }
    const onChange = vi.fn();
    render(<CoursePagesEditor courses={courses} pages={PAGES} onChange={onChange} />);
    return onChange;
};

/** SearchableSelect and MyDropdown are popovers, not <select>: open the
 *  trigger, then click the option by its label. */
const pick = (triggerIndex: number, optionLabel: string | RegExp) => {
    fireEvent.click(screen.getAllByRole('combobox')[triggerIndex]!);
    fireEvent.click(screen.getByRole('option', { name: optionLabel }));
};

describe('CoursePagesEditor', () => {
    it('starts empty, so every course keeps the standard details page', () => {
        setup();
        expect(screen.getByText('global.coursePages.empty')).toBeInTheDocument();
    });

    it('adds a row for the first course with no setting, defaulting to DETAILS', () => {
        const onChange = setup({});
        fireEvent.click(screen.getByRole('button', { name: /coursePages.add/ }));
        expect(onChange).toHaveBeenCalledWith({ [COURSE_A]: { mode: 'DETAILS' } });
    });

    it('skips courses that already have a row when adding', () => {
        const onChange = setup({ [COURSE_A]: { mode: 'OUTLINE' } });
        fireEvent.click(screen.getByRole('button', { name: /coursePages.add/ }));
        expect(onChange).toHaveBeenCalledWith({
            [COURSE_A]: { mode: 'OUTLINE' },
            [COURSE_B]: { mode: 'DETAILS' },
        });
    });

    it('offers all three modes and stores the chosen one', () => {
        const onChange = setup({ [COURSE_A]: { mode: 'DETAILS' } });
        // Radix DropdownMenu opens on pointerdown, not click.
        fireEvent.pointerDown(
            screen.getByText('global.coursePages.mode.DETAILS', { selector: 'div' }),
            { button: 0, ctrlKey: false, pointerType: 'mouse' }
        );
        const items = screen.getAllByRole('menuitem').map((el) => el.textContent);
        expect(items).toEqual([
            'global.coursePages.mode.DETAILS',
            'global.coursePages.mode.PAGE',
            'global.coursePages.mode.OUTLINE',
            'global.coursePages.mode.TILES',
        ]);
        fireEvent.click(screen.getByRole('menuitem', { name: 'global.coursePages.mode.OUTLINE' }));
        expect(onChange).toHaveBeenCalledWith({ [COURSE_A]: { mode: 'OUTLINE' } });
    });

    it('shows the page picker for PAGE only', () => {
        const { unmount } = render(
            <CoursePagesEditor
                courses={{ [COURSE_A]: { mode: 'PAGE', route: 'toddler' } }}
                pages={PAGES}
                onChange={vi.fn()}
            />
        );
        // course picker + page picker = 2 comboboxes for PAGE
        expect(screen.getAllByRole('combobox')).toHaveLength(2);
        unmount();

        for (const mode of ['DETAILS', 'OUTLINE', 'TILES'] as CourseViewMode[]) {
            const r = render(
                <CoursePagesEditor
                    courses={{ [COURSE_A]: { mode } }}
                    pages={PAGES}
                    onChange={vi.fn()}
                />
            );
            expect(screen.getAllByRole('combobox')).toHaveLength(1);
            r.unmount();
        }
    });

    it('offers only published pages that have a route (never the home page)', () => {
        setup({ [COURSE_A]: { mode: 'PAGE' } });
        fireEvent.click(screen.getAllByRole('combobox')[1]!);
        const list = screen.getByRole('listbox');
        expect(within(list).getByText('Toddler Reset')).toBeInTheDocument();
        expect(within(list).queryByText('Home')).not.toBeInTheDocument();
        expect(within(list).queryByText('Draft')).not.toBeInTheDocument();
    });

    it('stores the page ROUTE, which the learner URL is built from', () => {
        const onChange = setup({ [COURSE_A]: { mode: 'PAGE' } });
        pick(1, 'Toddler Reset');
        expect(onChange).toHaveBeenCalledWith({ [COURSE_A]: { mode: 'PAGE', route: 'toddler' } });
    });

    it('re-keys a row onto another course without merging two rows', () => {
        const onChange = setup({ [COURSE_A]: { mode: 'OUTLINE' } });
        pick(0, 'Toddler Tantrum Reset');
        expect(onChange).toHaveBeenCalledWith({ [COURSE_B]: { mode: 'OUTLINE' } });
    });

    it('never offers a course that already has its own row', () => {
        setup({ [COURSE_A]: { mode: 'OUTLINE' }, [COURSE_B]: { mode: 'DETAILS' } });
        fireEvent.click(screen.getAllByRole('combobox')[0]!);
        const list = screen.getByRole('listbox');
        expect(within(list).getByText('Pregnancy Guide')).toBeInTheDocument();
        expect(within(list).queryByText('Toddler Tantrum Reset')).not.toBeInTheDocument();
    });

    it('keeps a row whose course is gone from the institute', () => {
        const onChange = setup({ 'deleted-course': { mode: 'OUTLINE' }, [COURSE_A]: { mode: 'DETAILS' } });
        // Editing the surviving row must not drop the orphan row.
        fireEvent.click(screen.getAllByRole('button', { name: /coursePages.remove/ })[1]!);
        expect(onChange).toHaveBeenCalledWith({ 'deleted-course': { mode: 'OUTLINE' } });
    });

    it('removes a row', () => {
        const onChange = setup({ [COURSE_A]: { mode: 'OUTLINE' }, [COURSE_B]: { mode: 'DETAILS' } });
        fireEvent.click(screen.getAllByRole('button', { name: /coursePages.remove/ })[0]!);
        expect(onChange).toHaveBeenCalledWith({ [COURSE_B]: { mode: 'DETAILS' } });
    });

    it('stops offering Add once every course has a row', () => {
        setup({ [COURSE_A]: { mode: 'OUTLINE' }, [COURSE_B]: { mode: 'DETAILS' } });
        expect(screen.getByRole('button', { name: /coursePages.add/ })).toBeDisabled();
        expect(screen.getByText('global.coursePages.allMapped')).toBeInTheDocument();
    });
});
