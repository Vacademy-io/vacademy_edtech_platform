import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import copy from '../../../../public/locales/en/settingsIntegration.json';
import { formatDateTime } from '@/lib/formatters';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { GoogleSetupDialog } from './IntegrationSettings';
import type { CampaignRoutes, ConnectorListItem } from '../-services/ad-platform-service';

vi.mock('@/lib/auth/axiosInstance', () => ({
    default: { get: vi.fn(), put: vi.fn(), post: vi.fn(), delete: vi.fn() },
}));
vi.mock('@/lib/auth/instituteUtils', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/lib/auth/instituteUtils')>()),
    getCurrentInstituteId: () => 'inst-1',
}));

const api = authenticatedAxiosInstance as unknown as {
    get: ReturnType<typeof vi.fn>;
    put: ReturnType<typeof vi.fn>;
};
const routes = copy.google.routes;

const i18n = createInstance();
void i18n.init({
    lng: 'en',
    resources: { en: { settingsIntegration: copy } },
    interpolation: { escapeValue: false },
});

const KEY = 'Zk3vQp9LmN2xR7tY4wB8cD1eF6gH0jKs';

function connector(overrides: Partial<ConnectorListItem> = {}): ConnectorListItem {
    return {
        id: 'conn-1',
        vendor: 'GOOGLE_LEAD_ADS',
        vendorId: KEY,
        audienceId: 'aud-main',
        platformPageId: null,
        platformFormId: KEY,
        platformFormName: null,
        connectionStatus: 'ACTIVE',
        statusDetail: null,
        lastCheckedAt: null,
        producesSourceType: 'GOOGLE_ADS',
        createdAt: null,
        tokenExpiresAt: null,
        defaultValuesJson: null,
        ...overrides,
    };
}

const LISTS = [
    { id: 'aud-main', name: 'GoogleAds Leads form', status: 'ACTIVE' },
    { id: 'aud-pune', name: 'Pune MBBS 2027', status: 'ACTIVE' },
    { id: 'aud-old', name: 'Closed list', status: 'INACTIVE' },
];

const ROUTES: CampaignRoutes = {
    main_audience_id: 'aud-main',
    auto_create_lists: false,
    routes: [
        {
            campaign_id: '22173284076',
            audience_id: null,
            campaign_name: null,
            lead_count: 4,
            first_lead_at: '2026-10-09T15:52:05',
            last_lead_at: '2026-10-10T06:11:44',
            added_manually: false,
        },
        {
            campaign_id: '22180441198',
            audience_id: 'aud-pune',
            campaign_name: 'Maharashtra-ADCT',
            lead_count: 3,
            first_lead_at: '2026-10-09T11:50:45',
            last_lead_at: '2026-10-09T16:58:50',
            added_manually: false,
        },
    ],
};

function mount(
    c: ConnectorListItem | null,
    audiences: Parameters<typeof GoogleSetupDialog>[0]['audiences'] = LISTS
) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    return render(
        <I18nextProvider i18n={i18n}>
            <QueryClientProvider client={client}>
                <GoogleSetupDialog
                    connector={c}
                    audienceName="GoogleAds Leads form"
                    audiences={audiences}
                    open
                    onOpenChange={() => {}}
                />
            </QueryClientProvider>
        </I18nextProvider>
    );
}

const listSelects = () =>
    screen.getAllByRole('combobox', { name: copy.google.routes.listLabel }) as HTMLSelectElement[];

beforeEach(() => {
    api.get.mockReset();
    api.put.mockReset();
    api.get.mockImplementation((url: string) =>
        Promise.resolve({ data: url.includes('/campaign-routes') ? ROUTES : {} })
    );
    api.put.mockResolvedValue({
        data: {
            route: { ...ROUTES.routes[0], audience_id: 'aud-pune' },
            created_audience_id: null,
            moved_leads: 4,
            skipped_leads: 0,
        },
    });
});

describe('GoogleSetupDialog', () => {
    it('shows the URL, the key, the steps and a waiting status before Google has called', () => {
        mount(connector());
        expect(screen.getByText(new RegExp(`/webhook/google/${KEY}$`))).toBeTruthy();
        expect(screen.getByText(KEY)).toBeTruthy();
        expect(screen.getByText(/Click "Send test data"/)).toBeTruthy();
        expect(screen.getByText(/Nothing received from Google yet/)).toBeTruthy();
        expect(screen.getByText(/"Unauthorized" \(401\)/)).toBeTruthy();
    });

    it('confirms delivery in local time, reading the server timestamp as UTC', () => {
        mount(connector({ lastCheckedAt: '2026-10-08T14:05:03.123' }));
        const local = formatDateTime(new Date('2026-10-08T14:05:03.123Z'), { second: '2-digit' });
        expect(
            screen.getByText(`Google reached this connector on ${local}. The setup works.`)
        ).toBeTruthy();
    });

    it('shows why the last delivery failed', () => {
        mount(
            connector({
                lastCheckedAt: '2026-10-08T14:05:03',
                connectionStatus: 'ACTION_REQUIRED',
                statusDetail: 'Campaign 22173284076 is routed to a list that was deleted.',
            })
        );
        expect(screen.getByText(/routed to a list that was deleted/)).toBeTruthy();
    });

    it('waits for the list refetch when the connector was just created', () => {
        mount(null);
        expect(screen.getByText(copy.activeConnectors.loading)).toBeTruthy();
    });

    it('lists each campaign with its lead count and the list it feeds', async () => {
        mount(connector());
        expect(await screen.findByText('22173284076')).toBeTruthy();
        expect(screen.getByText(/Leads: 4/)).toBeTruthy();
        expect(screen.getByText(copy.google.routes.notMapped)).toBeTruthy();
        const [unmapped, mapped] = listSelects();
        // Selected option by text: happy-dom reads an empty option value as its label.
        expect(unmapped!.options[unmapped!.selectedIndex]!.textContent).toBe(
            'Not mapped (goes to GoogleAds Leads form)'
        );
        expect(mapped!.value).toBe('aud-pune');
        // An inactive list is never offered as a target.
        expect(screen.queryByRole('option', { name: 'Closed list' })).toBeNull();
    });

    it("offers only lists of the main list's type, plus a list a campaign already feeds", async () => {
        mount(connector(), [
            {
                id: 'aud-main',
                name: 'GoogleAds Leads form',
                status: 'ACTIVE',
                campaignType: 'GoogleAds Leads form',
            },
            {
                id: 'aud-mp',
                name: 'MP-CG-PGDCC',
                status: 'ACTIVE',
                campaignType: 'GOOGLEADS LEADS FORM',
            },
            { id: 'aud-web', name: 'Gujrat-ADCT', status: 'ACTIVE', campaignType: 'WEBSITE' },
            {
                id: 'aud-fb',
                name: 'ADCT Mumbai 21 Feb',
                status: 'ACTIVE',
                campaignType: 'Facebook',
            },
            { id: 'aud-pune', name: 'Pune MBBS 2027', status: 'ACTIVE', campaignType: 'WEBSITE' },
        ]);
        await screen.findByText('22173284076');
        const names = Array.from(listSelects()[0]!.options).map((o) => o.textContent);
        expect(names).toContain('MP-CG-PGDCC');
        // Already routed there, so it stays even though it is a website list.
        expect(names).toContain('Pune MBBS 2027');
        expect(names).not.toContain('Gujrat-ADCT');
        expect(names).not.toContain('ADCT Mumbai 21 Feb');
    });

    it('routes a campaign to an existing list and moves its existing leads', async () => {
        mount(connector());
        await screen.findByText('22173284076');
        fireEvent.change(listSelects()[0]!, { target: { value: 'aud-pune' } });
        expect(screen.getByText(/Also move this campaign's existing leads \(4\)/)).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: copy.google.routes.save }));

        await waitFor(() => expect(api.put).toHaveBeenCalledTimes(1));
        expect(api.put).toHaveBeenCalledWith(
            expect.stringContaining('/connectors/conn-1/campaign-routes/22173284076'),
            { audience_id: 'aud-pune', move_existing_leads: true }
        );
    });

    it('creates a new list for a campaign from the same place', async () => {
        mount(connector());
        await screen.findByText('22173284076');
        fireEvent.change(listSelects()[0]!, { target: { value: '__create_list__' } });
        const save = screen.getByRole('button', { name: copy.google.routes.save });
        expect((save as HTMLButtonElement).disabled).toBe(true);

        fireEvent.change(screen.getByPlaceholderText(copy.google.routes.newListNamePlaceholder), {
            target: { value: '  Pune NEET Crash  ' },
        });
        fireEvent.click(save);

        await waitFor(() => expect(api.put).toHaveBeenCalledTimes(1));
        expect(api.put).toHaveBeenCalledWith(
            expect.stringContaining('/campaign-routes/22173284076'),
            {
                new_list: { name: 'Pune NEET Crash', campaign_type: undefined },
                move_existing_leads: true,
            }
        );
    });

    it('routes a campaign before its first lead, by its Google Ads id', async () => {
        mount(connector());
        await screen.findByText('22173284076');
        fireEvent.change(screen.getByPlaceholderText(copy.google.routes.campaignIdPlaceholder), {
            target: { value: ' 2220-6499349x ' },
        });
        const selects = listSelects();
        fireEvent.change(selects[selects.length - 1]!, { target: { value: 'aud-pune' } });
        fireEvent.click(screen.getByRole('button', { name: copy.google.routes.add }));

        await waitFor(() => expect(api.put).toHaveBeenCalledTimes(1));
        expect(api.put).toHaveBeenCalledWith(
            expect.stringContaining('/campaign-routes/22206499349'),
            { audience_id: 'aud-pune', move_existing_leads: false }
        );
    });

    it('turns automatic lists per campaign on for the connector', async () => {
        api.put.mockResolvedValueOnce({ data: { ...ROUTES, auto_create_lists: true } });
        mount(connector());
        const toggle = await screen.findByRole('switch', { name: routes.autoListsLabel });
        expect(toggle.getAttribute('aria-checked')).toBe('false');
        fireEvent.click(toggle);

        await waitFor(() => expect(api.put).toHaveBeenCalledTimes(1));
        expect(api.put).toHaveBeenCalledWith(
            expect.stringContaining('/connectors/conn-1/campaign-auto-lists'),
            { enabled: true }
        );
        await waitFor(() => expect(toggle.getAttribute('aria-checked')).toBe('true'));
    });

    it('shows and edits a campaign name without changing its list', async () => {
        mount(connector());
        expect(await screen.findByText('Maharashtra-ADCT')).toBeTruthy();
        expect(screen.getByText(routes.unnamed)).toBeTruthy();

        fireEvent.click(screen.getAllByRole('button', { name: routes.editName })[0]!);
        // The row being named renders before the add-a-campaign row.
        const input = screen.getAllByPlaceholderText(routes.campaignNamePlaceholder)[0]!;
        fireEvent.change(input, { target: { value: ' Gujarat-ADCT ' } });
        fireEvent.keyDown(input, { key: 'Enter' });

        await waitFor(() => expect(api.put).toHaveBeenCalledTimes(1));
        expect(api.put).toHaveBeenCalledWith(
            expect.stringContaining('/campaign-routes/22173284076'),
            {
                campaign_name: 'Gujarat-ADCT',
            }
        );
    });

    it('names a campaign before its first lead, with no list yet', async () => {
        mount(connector());
        await screen.findByText('22173284076');
        fireEvent.change(screen.getByPlaceholderText(routes.campaignIdPlaceholder), {
            target: { value: '22806287191' },
        });
        // An id alone is not enough: it needs a list or a name.
        expect(screen.queryByRole('button', { name: routes.add })).toBeNull();
        fireEvent.change(screen.getAllByPlaceholderText(routes.campaignNamePlaceholder).at(-1)!, {
            target: { value: 'Mumbai-Cosmetology' },
        });
        fireEvent.click(screen.getByRole('button', { name: routes.add }));

        await waitFor(() => expect(api.put).toHaveBeenCalledTimes(1));
        expect(api.put).toHaveBeenCalledWith(
            expect.stringContaining('/campaign-routes/22806287191'),
            {
                move_existing_leads: false,
                campaign_name: 'Mumbai-Cosmetology',
            }
        );
    });
});
