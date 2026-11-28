import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PageTabs } from './PageTabs';
import { RevisionHistoryDialog } from './RevisionHistoryDialog';
import { useEditorStore } from '../-stores/editor-store';
import * as service from '../-services/catalogue-service';

/**
 * Two small "which one is it?" fixes: page tabs that share a title, and which
 * version in the history is the one learners see now.
 */

vi.mock('react-i18next', async () => {
    const en = (await import('../../../../public/locales/en/managePagesCatalogueEditor.json'))
        .default;
    const t = (key: string, opts?: Record<string, unknown>) => {
        const value = key
            .split('.')
            .reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], en);
        return typeof value === 'string'
            ? value.replace(/{{(\w+)}}/g, (_, name: string) => String(opts?.[name] ?? ''))
            : key;
    };
    return { useTranslation: () => ({ t, i18n: { language: 'en' } }) };
});
vi.mock('./AiPageWizard', () => ({ AiPageWizard: () => null }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('../-services/catalogue-service', () => ({
    getRevisionHistory: vi.fn(),
    getRevision: vi.fn(),
}));

const page = (id: string, route: string, title?: string) => ({ id, route, title, components: [] });

describe('PageTabs', () => {
    beforeEach(() => {
        useEditorStore.setState({ config: null });
    });

    it('adds the route under pages that share a title', () => {
        useEditorStore.setState({
            config: {
                globalSettings: {},
                pages: [
                    page('home', 'home', 'Courses'),
                    page('courses', 'courses', 'Courses'),
                    page('lp', 'paths', 'Learning Paths'),
                ],
            } as never,
        });
        render(<PageTabs />);
        expect(screen.getByText('/home')).toBeInTheDocument();
        expect(screen.getByText('/courses')).toBeInTheDocument();
        expect(screen.getAllByText('Courses')).toHaveLength(2);
        // A unique title stays as it was.
        expect(screen.getByText('Learning Paths')).toBeInTheDocument();
        expect(screen.queryByText('/paths')).not.toBeInTheDocument();
    });

    it('shows nothing extra when titles are unique', () => {
        useEditorStore.setState({
            config: {
                globalSettings: {},
                pages: [page('home', 'home', 'Home'), page('c', 'courses')],
            } as never,
        });
        render(<PageTabs />);
        expect(screen.getByText('Home')).toBeInTheDocument();
        expect(screen.getByText('courses')).toBeInTheDocument();
        expect(screen.queryByText('/courses')).not.toBeInTheDocument();
    });
});

describe('RevisionHistoryDialog', () => {
    it('marks the version that is live now and shows when the draft was started', async () => {
        vi.mocked(service.getRevisionHistory).mockResolvedValue([
            {
                id: 'r5',
                revision_no: 5,
                status: 'PUBLISHED',
                source: 'LEGACY_UPDATE',
                updated_at: '2026-10-09T18:30:00Z',
            },
            {
                id: 'r4',
                revision_no: 4,
                status: 'PUBLISHED',
                source: 'LEGACY_UPDATE',
                updated_at: '2026-10-09T17:00:00Z',
            },
            {
                id: 'r1',
                revision_no: 1,
                status: 'DRAFT',
                source: 'MANUAL',
                created_at: '2026-10-09T15:00:28Z',
                updated_at: '2026-10-09T15:00:28Z',
            },
        ]);
        const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        render(
            <QueryClientProvider client={client}>
                <RevisionHistoryDialog
                    open
                    onOpenChange={() => {}}
                    catalogueId="cat-1"
                    onRestore={() => {}}
                />
            </QueryClientProvider>
        );
        const liveBadge = await screen.findByText('Live now');
        expect(screen.getAllByText('Live now')).toHaveLength(1);
        const liveRow = liveBadge.closest('.rounded.border') as HTMLElement;
        expect(within(liveRow).getByText(/v5/)).toBeInTheDocument();
        expect(screen.getByText(/^Started /)).toBeInTheDocument();
    });
});
