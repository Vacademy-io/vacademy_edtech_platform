import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

// The card is driven entirely by this service, so mocking it lets us assert the
// two behaviours that matter: silent when the learner arrived untagged, and a
// readable campaign block when they did not.
const fetchMock = vi.fn();
vi.mock('@/services/utm-attribution', () => ({
    utmAttributionQueryKey: (u: string, i: string) => ['utm-attribution', u, i],
    fetchUtmAttributionForUser: (...args: unknown[]) => fetchMock(...args),
}));

vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string, opts?: { defaultValue?: string }) => opts?.defaultValue ?? key,
    }),
}));

import { StudentAttribution } from '../../student-attribution';

const wrapper = ({ children }: { children: ReactNode }) => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
};

const touch = (over: Record<string, unknown> = {}) => ({
    id: 'row-1',
    user_id: 'user-1',
    source_type: 'ENROLL_INVITE',
    utm_source: 'meta',
    utm_medium: 'meta',
    utm_campaign: 'ganesh-2026',
    utm_content: null,
    utm_term: null,
    referrer_host: null,
    created_at: '2026-09-09T04:00:00Z',
    ...over,
});

describe('the Overview campaign card', () => {
    beforeEach(() => fetchMock.mockReset());

    it('renders NOTHING when the learner arrived untagged', async () => {
        fetchMock.mockResolvedValue([]);
        const { container } = render(
            <StudentAttribution userId="user-1" instituteId="inst-1" />,
            { wrapper }
        );
        // Nothing at all — not an empty card, not a heading.
        await new Promise((r) => setTimeout(r, 0));
        expect(container.textContent).toBe('');
    });

    it('shows the utm source, medium and campaign when the data exists', async () => {
        fetchMock.mockResolvedValue([touch()]);
        render(<StudentAttribution userId="user-1" instituteId="inst-1" />, { wrapper });

        // utm_source AND utm_medium are both "meta" in the real link this was
        // reported against, so both rows carry the same text.
        expect((await screen.findAllByText('meta')).length).toBe(2);
        expect(await screen.findByText('ganesh-2026')).toBeInTheDocument();
    });

    it('separates first touch from latest when there is more than one', async () => {
        fetchMock.mockResolvedValue([
            touch({ id: 'a', utm_campaign: 'diwali-2026' }),
            touch({ id: 'b', utm_campaign: 'ganesh-2026', utm_source: 'whatsapp' }),
        ]);
        render(<StudentAttribution userId="user-1" instituteId="inst-1" />, { wrapper });

        // First touch keeps the credit; latest is what a counsellor references today.
        expect(await screen.findByText('diwali-2026')).toBeInTheDocument();
        expect(await screen.findByText('ganesh-2026')).toBeInTheDocument();
        expect(await screen.findByText('whatsapp')).toBeInTheDocument();
    });

    it('queries on contact details even when the learner has no user id', async () => {
        fetchMock.mockResolvedValue([touch({ user_id: null })]);
        render(
            <StudentAttribution
                userId={undefined}
                instituteId="inst-1"
                email="learner@example.com"
                mobileNumber="+919876543210"
            />,
            { wrapper }
        );
        expect(await screen.findByText('ganesh-2026')).toBeInTheDocument();
        expect(fetchMock).toHaveBeenCalledWith('', 'inst-1', 'learner@example.com', '+919876543210');
    });
});
