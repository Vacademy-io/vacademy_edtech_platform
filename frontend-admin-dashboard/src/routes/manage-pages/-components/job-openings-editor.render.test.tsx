import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { PropertyPanel } from './PropertyPanel';
import { renderComponentPreview } from './ComponentPreviews';
import { useEditorStore } from '../-stores/editor-store';
import { buildComponentTemplates } from '../-utils/component-templates';
import { componentDescription, componentLabel } from '../-utils/component-labels';
import { JOB_TEMPLATES, liveJobSlugs } from './jobs/job-templates';

/**
 * `jobOpenings` — careers cards, each job on its own page. These pin the admin
 * wiring: the template ships generic defaults with the learner's contract, the
 * canvas preview paints the jobs (not the unknown-type fallback), and the
 * property panel picks a template and edits a job.
 */

vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (k: string) => k }),
    Trans: ({ i18nKey }: { i18nKey: string }) => <span>{i18nKey}</span>,
}));
vi.mock('@/stores/students/students-list/useInstituteDetailsStore', () => ({
    useInstituteDetailsStore: () => ({
        getAllLevels: () => [],
        getCourseFromPackage: () => [],
        instituteDetails: null,
    }),
}));
vi.mock('@/lib/auth/instituteUtils', () => ({ getCurrentInstituteId: () => 'inst-1' }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/hooks/use-file-upload', () => ({ useFileUpload: () => ({ uploadFile: vi.fn() }) }));
vi.mock('@tanstack/react-query', async (orig) => ({
    ...(await orig<Record<string, unknown>>()),
    useQuery: () => ({ data: [], isLoading: false, isError: false }),
    useMutation: () => ({ mutate: vi.fn(), isPending: false }),
    useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

const t = ((k: string) => k) as never;

const section = (props: Record<string, unknown>) => ({
    id: 'jobs-1',
    type: 'jobOpenings',
    enabled: true,
    props,
});

const currentProps = () =>
    useEditorStore.getState().config!.pages[0]!.components[0]!.props as Record<string, any>;

describe('jobOpenings → template + labels', () => {
    it('ships generic defaults: classic, 2 columns, two jobs without a form link', () => {
        const tpl = buildComponentTemplates(t).jobOpenings!;
        expect(tpl.type).toBe('jobOpenings');
        expect(tpl.props).toMatchObject({ template: 'classic', columns: 2 });
        expect(tpl.props.jobs).toHaveLength(2);
        expect(tpl.props.jobs[0]).toMatchObject({ applyUrl: '', enabled: true, slug: '' });
        expect(componentLabel('jobOpenings')).toBe('Job Openings');
        expect(componentDescription('jobOpenings')).toMatch(/Apply/);
    });

    it('computes the live slugs the learner will use', () => {
        expect(
            liveJobSlugs([
                { title: 'Teacher' },
                { title: 'Teacher' },
                { title: 'Off', enabled: false },
                { title: '' },
            ])
        ).toEqual(['teacher', 'teacher-2', null, null]);
    });
});

describe('jobOpenings → canvas preview', () => {
    it.each(JOB_TEMPLATES)('%s paints the jobs', (template) => {
        render(
            <>
                {renderComponentPreview(
                    section({
                        template,
                        headerText: 'Current openings',
                        jobs: [
                            { title: 'Teacher', summary: 'Teach', location: 'Jaipur' },
                            { title: 'Hidden', enabled: false },
                        ],
                    })
                )}
            </>
        );
        expect(screen.getByText('Current openings')).toBeInTheDocument();
        expect(screen.getByText('Teacher')).toBeInTheDocument();
        expect(screen.queryByText('Hidden')).not.toBeInTheDocument();
        expect(screen.queryByText(/dispatcher.unknownComponent/)).not.toBeInTheDocument();
    });
});

describe('jobOpenings → property panel', () => {
    beforeEach(() => {
        useEditorStore.getState().setConfig({
            pages: [
                {
                    id: 'p-careers',
                    route: 'careers',
                    title: 'Careers',
                    components: [
                        section({
                            template: 'classic',
                            jobs: [
                                {
                                    id: 'j1',
                                    title: 'Educator Vacancy',
                                    applyUrl: '',
                                    enabled: true,
                                },
                            ],
                        }),
                    ],
                },
            ],
            globalSettings: {},
        } as never);
        useEditorStore.getState().selectPage('p-careers');
        useEditorStore.getState().selectComponent('jobs-1');
    });

    it('picks a template from the gallery', () => {
        render(<PropertyPanel />);
        const radios = screen.getAllByRole('radio');
        expect(radios).toHaveLength(JOB_TEMPLATES.length);
        fireEvent.click(screen.getByText('jobOpenings.templates.poster.name'));
        expect(currentProps().template).toBe('poster');
    });

    it('shows the job address and edits the apply link', () => {
        render(<PropertyPanel />);
        expect(screen.getByText('jobOpenings.address')).toBeInTheDocument();
        const apply = screen.getByPlaceholderText('https://');
        fireEvent.change(apply, { target: { value: 'http://forms.gle/x' } });
        expect(currentProps().jobs[0].applyUrl).toBe('http://forms.gle/x');
        expect(screen.getByText('jobOpenings.applyUrlInvalid')).toBeInTheDocument();
        fireEvent.change(apply, { target: { value: 'https://forms.gle/x' } });
        expect(currentProps().jobs[0].applyUrl).toBe('https://forms.gle/x');
    });

    it('adds a job', () => {
        render(<PropertyPanel />);
        fireEvent.click(screen.getByText('jobOpenings.addJob'));
        expect(currentProps().jobs).toHaveLength(2);
        expect(currentProps().jobs[1].title).toBe('jobOpenings.defaults.newJob');
    });
});
