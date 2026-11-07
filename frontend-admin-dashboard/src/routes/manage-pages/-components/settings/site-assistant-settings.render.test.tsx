import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { SiteAssistantSettingsCard } from './SiteAssistantSettingsCard';
import {
    cleanSuggestions,
    enableSiteAssistant,
    parseDailyAnswers,
    popularSearchesFromSite,
    siteTagFromPath,
} from './site-assistant-settings';
import type { SiteAssistantSettings } from '../../-types/editor-types';

/**
 * Global Settings → Site Assistant: reads globalSettings.siteAssistant and
 * writes back only what changed (missing keys = engine defaults, SPEC §1).
 */

let knowledgeBases: { id: string; name: string; status: string }[] = [];
let campaigns: { id: string; campaign_name: string }[] = [];
let streams: { slug: string; label: string; categories: [] }[] = [];

vi.mock('@/lib/auth/instituteUtils', () => ({ getCurrentInstituteId: () => 'inst-1' }));
vi.mock('@/stores/students/students-list/useInstituteDetailsStore', () => ({
    useInstituteDetailsStore: (pick: (s: unknown) => unknown) =>
        pick({ instituteDetails: { institute_name: 'Brahm Varchas' } }),
}));
vi.mock('@tanstack/react-query', async (orig) => ({
    ...(await orig<Record<string, unknown>>()),
    useQuery: ({ queryKey }: { queryKey: unknown[] }) =>
        queryKey[0] === 'SITE_ASSISTANT_KNOWLEDGE_BASES'
            ? { data: knowledgeBases, isLoading: false, isError: false }
            : queryKey[0] === 'campaignsList'
              ? { data: { content: campaigns }, isLoading: false, isError: false }
              : { data: undefined, isLoading: false, isError: false },
}));
vi.mock('@/routes/knowledge-base/-services/knowledge-base-service', () => ({
    listKnowledgeBases: vi.fn(),
}));
vi.mock('../CampaignPicker', () => ({
    CampaignPicker: ({
        value,
        onChange,
        label,
    }: {
        value: string;
        onChange: (id: string, name: string) => void;
        label: string;
    }) => (
        <label>
            {label}
            <select
                aria-label={label}
                value={value}
                onChange={(e) => onChange(e.target.value, e.target.value)}
            >
                <option value="">Default website leads list</option>
                <option value="camp-1">Counselling</option>
            </select>
        </label>
    ),
}));
vi.mock('../ImageUploadField', () => ({ ImageUploadField: () => null }));
vi.mock('../chrome/chrome-controls', () => ({ OptionalColorField: () => null }));
vi.mock('../catalog/use-catalog-streams', () => ({ useCatalogStreams: () => streams }));

const site = {
    pages: [
        {
            id: 'p1',
            route: '/',
            title: 'Home',
            components: [
                {
                    id: 'c1',
                    type: 'courseCatalog',
                    props: {
                        streams: { source: 'tags', items: [] },
                        hero: {
                            popular: [
                                { label: 'Garbh Sanskar' },
                                { label: { en: 'Vedic parenting', hi: 'वैदिक पेरेंटिंग' } },
                                { label: '' },
                            ],
                        },
                    },
                },
            ],
        },
        { id: 'p2', route: '/about', title: 'About us', components: [] },
    ],
};

beforeEach(() => {
    knowledgeBases = [];
    campaigns = [];
    streams = [];
});

const renderCard = (value: SiteAssistantSettings | undefined, onChange = vi.fn()) => {
    render(
        <SiteAssistantSettingsCard value={value} onChange={onChange} config={site} siteTag="bv" />
    );
    return onChange;
};

describe('SiteAssistantSettingsCard', () => {
    it('shows the defaults for a site with no settings yet', () => {
        renderCard(undefined);
        expect(screen.getByRole('switch', { name: 'Site Assistant' })).not.toBeChecked();
        expect((screen.getByLabelText('Tone of voice') as HTMLSelectElement).value).toBe('warm');
        expect((screen.getByLabelText('Pages') as HTMLSelectElement).value).toBe('all');
        expect((screen.getByLabelText('Button position') as HTMLSelectElement).value).toBe(
            'bottom-right'
        );
        expect(screen.getByRole('checkbox', { name: 'Courses' })).toBeChecked();
        expect(screen.getByRole('switch', { name: 'Allow on my own website' })).not.toBeChecked();
        // Suggestions default to the courses page's "Popular" searches.
        expect(screen.getByDisplayValue('Garbh Sanskar')).toBeInTheDocument();
        expect(screen.getByDisplayValue('Vedic parenting')).toBeInTheDocument();
        expect(screen.getByText(/Open Site Assistant/).closest('a')).toHaveAttribute(
            'href',
            '/manage-pages/site-assistant?site=bv'
        );
    });

    it('switching on seeds the name and the suggestions, keeping nothing else', () => {
        const onChange = renderCard(undefined);
        fireEvent.click(screen.getByRole('switch', { name: 'Site Assistant' }));
        expect(onChange).toHaveBeenCalledWith({
            enabled: true,
            name: 'Ask Brahm Varchas',
            suggestions: ['Garbh Sanskar', 'Vedic parenting'],
        });
    });

    it('reads stored values and writes nested changes without losing siblings', () => {
        const value: SiteAssistantSettings = {
            enabled: true,
            name: 'Ask BV',
            persona: 'formal',
            knowledge: { pages: true, linkedKbIds: ['kb-1'] },
            leads: { campaignId: 'camp-1', consentText: 'OK to call' },
            support: { email: 'help@bv.org' },
            limits: { dailyAnswers: 150 },
            embed: { enabled: true },
        };
        const onChange = renderCard(value);
        expect(screen.getByDisplayValue('Ask BV')).toBeInTheDocument();
        expect((screen.getByLabelText('Tone of voice') as HTMLSelectElement).value).toBe('formal');
        expect(screen.getByDisplayValue('help@bv.org')).toBeInTheDocument();
        expect(screen.getByDisplayValue('150')).toBeInTheDocument();
        expect(screen.getByRole('switch', { name: 'Allow on my own website' })).toBeChecked();

        fireEvent.click(screen.getByRole('checkbox', { name: 'Public live classes' }));
        expect(onChange).toHaveBeenLastCalledWith({
            ...value,
            knowledge: { pages: true, linkedKbIds: ['kb-1'], liveClasses: false },
        });

        fireEvent.change(screen.getByLabelText('Send enquiries to'), { target: { value: '' } });
        expect(onChange).toHaveBeenLastCalledWith({
            ...value,
            leads: { campaignId: null, consentText: 'OK to call' },
        });

        fireEvent.change(screen.getByLabelText('Support phone'), { target: { value: '+91 98' } });
        expect(onChange).toHaveBeenLastCalledWith({
            ...value,
            support: { email: 'help@bv.org', phone: '+91 98' },
        });
    });

    it('commits the daily limit on blur, clamped', () => {
        const onChange = renderCard({ enabled: true });
        const cap = screen.getByLabelText('Answers per day');
        fireEvent.change(cap, { target: { value: '999999' } });
        expect(onChange).not.toHaveBeenCalled();
        fireEvent.blur(cap);
        expect(onChange).toHaveBeenCalledWith({ enabled: true, limits: { dailyAnswers: 10000 } });
    });

    it('edits suggestions and picks pages for "only the pages I pick"', () => {
        const onChange = renderCard({
            suggestions: ['Any free class?'],
            placement: { mode: 'routes' },
        });
        fireEvent.change(screen.getByLabelText('New suggested question'), {
            target: { value: 'Is it in Hindi?' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Add suggested question' }));
        expect(onChange).toHaveBeenLastCalledWith({
            suggestions: ['Any free class?', 'Is it in Hindi?'],
            placement: { mode: 'routes' },
        });

        fireEvent.click(screen.getByRole('button', { name: 'Remove “Any free class?”' }));
        expect(onChange).toHaveBeenLastCalledWith({
            suggestions: [],
            placement: { mode: 'routes' },
        });

        expect(screen.getByText(/Pick at least one page/)).toBeInTheDocument();
        fireEvent.click(screen.getByText('About us'));
        expect(onChange).toHaveBeenLastCalledWith({
            suggestions: ['Any free class?'],
            placement: { mode: 'routes', routes: ['/about'] },
        });
    });

    it('links knowledge bases and routes a stream to its own list', () => {
        knowledgeBases = [
            { id: 'kb-1', name: 'Prospectus', status: 'ACTIVE' },
            { id: 'kb-2', name: 'Old notes', status: 'ARCHIVED' },
        ];
        campaigns = [{ id: 'camp-9', campaign_name: 'Parenting leads' }];
        streams = [{ slug: 'parenting', label: 'Parenting', categories: [] }];
        const onChange = renderCard({ enabled: true });
        expect(screen.queryByText('Old notes')).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole('checkbox', { name: 'Prospectus' }));
        expect(onChange).toHaveBeenLastCalledWith({
            enabled: true,
            knowledge: { linkedKbIds: ['kb-1'] },
        });
        fireEvent.change(screen.getByLabelText('Parenting'), { target: { value: 'camp-9' } });
        expect(onChange).toHaveBeenLastCalledWith({
            enabled: true,
            leads: { streamCampaigns: { parenting: 'camp-9' } },
        });
    });

    it('shows an empty state when the institute has no knowledge bases', () => {
        renderCard(undefined);
        expect(screen.getByText(/No knowledge bases yet/)).toBeInTheDocument();
    });
});

describe('site-assistant-settings helpers', () => {
    it('reads popular searches from nested courses sections', () => {
        expect(popularSearchesFromSite(site)).toEqual(['Garbh Sanskar', 'Vedic parenting']);
        expect(popularSearchesFromSite(null)).toEqual([]);
    });

    it('cleans suggestions: trims, de-duplicates, caps at 6', () => {
        expect(cleanSuggestions([' a ', 'A', '', 'b', 'c', 'd', 'e', 'f', 'g'])).toEqual([
            'a',
            'b',
            'c',
            'd',
            'e',
            'f',
        ]);
    });

    it('switching on keeps an existing name and suggestions', () => {
        expect(
            enableSiteAssistant(
                { name: 'Mine', suggestions: [] },
                { instituteName: 'X', popular: ['p'] }
            )
        ).toEqual({ enabled: true, name: 'Mine', suggestions: [] });
    });

    it('parses the daily limit and the site tag of the editor URL', () => {
        expect(parseDailyAnswers('')).toBeUndefined();
        expect(parseDailyAnswers('abc')).toBeUndefined();
        expect(parseDailyAnswers('0')).toBe(1);
        expect(parseDailyAnswers('250.4')).toBe(250);
        expect(siteTagFromPath('/manage-pages/editor/bv%20main')).toBe('bv main');
        expect(siteTagFromPath('/manage-pages')).toBeNull();
    });
});
