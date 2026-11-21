import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { UnansweredTab } from './UnansweredTab';

/**
 * Unanswered → "Add as FAQ": the FAQ form opens with the visitor's question
 * filled in, and saving creates an FAQ for this site with the admin's answer.
 */

const api = vi.hoisted(() => ({
    fetchUnanswered: vi.fn(),
    createKnowledge: vi.fn(),
    updateKnowledge: vi.fn(),
}));
vi.mock('../-services/site-assistant-service', async (orig) => ({
    ...(await orig<Record<string, unknown>>()),
    fetchUnanswered: api.fetchUnanswered,
    createKnowledge: api.createKnowledge,
    updateKnowledge: api.updateKnowledge,
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const renderTab = () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
        <QueryClientProvider client={client}>
            <UnansweredTab siteTag="bv" siteLabel="bv" />
        </QueryClientProvider>
    );
};

beforeEach(() => {
    api.fetchUnanswered.mockReset();
    api.createKnowledge.mockReset();
    api.updateKnowledge.mockReset();
});

describe('UnansweredTab', () => {
    it('lists grouped questions, most asked first', async () => {
        api.fetchUnanswered.mockResolvedValue([
            { question: 'Is there EMI?', count: 9, lastAskedAt: null, examples: ['emi option?'] },
            { question: 'Hostel?', count: 1, lastAskedAt: null, examples: [] },
        ]);
        renderTab();
        expect(await screen.findByText('“Is there EMI?”')).toBeInTheDocument();
        expect(screen.getByText('Asked 9 times')).toBeInTheDocument();
        expect(screen.getByText('Asked once')).toBeInTheDocument();
        expect(screen.getByText(/Also asked as: emi option\?/)).toBeInTheDocument();
        expect(api.fetchUnanswered).toHaveBeenCalledWith('bv', 30);
    });

    it('"Add as FAQ" prefills the question and saves an FAQ for this site', async () => {
        api.fetchUnanswered.mockResolvedValue([
            { question: 'Is there EMI?', count: 9, lastAskedAt: null, examples: [] },
        ]);
        api.createKnowledge.mockResolvedValue({ id: 'k1' });
        renderTab();
        fireEvent.click(await screen.findByRole('button', { name: /Add as FAQ/ }));

        expect(await screen.findByText('Add an FAQ')).toBeInTheDocument();
        expect(screen.getByDisplayValue('Is there EMI?')).toBeInTheDocument();

        fireEvent.change(screen.getByPlaceholderText(/Write the answer/), {
            target: { value: 'Yes, 3 monthly payments on courses above ₹5,000.' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));

        await waitFor(() => expect(api.createKnowledge).toHaveBeenCalledTimes(1));
        expect(api.createKnowledge).toHaveBeenCalledWith('bv', {
            kind: 'FAQ',
            title: 'Is there EMI?',
            body: 'Yes, 3 monthly payments on courses above ₹5,000.',
            active: true,
            allSites: false,
            startDate: '',
            endDate: '',
        });
        await waitFor(() => expect(screen.queryByText('Add an FAQ')).not.toBeInTheDocument());
    });

    it('does not save an FAQ without an answer', async () => {
        api.fetchUnanswered.mockResolvedValue([
            { question: 'Is there EMI?', count: 2, lastAskedAt: null, examples: [] },
        ]);
        renderTab();
        fireEvent.click(await screen.findByRole('button', { name: /Add as FAQ/ }));
        fireEvent.click(await screen.findByRole('button', { name: 'Save' }));
        expect(await screen.findByRole('alert')).toHaveTextContent('Write the answer');
        expect(api.createKnowledge).not.toHaveBeenCalled();
    });

    it('says so when nothing went unanswered', async () => {
        api.fetchUnanswered.mockResolvedValueOnce([]);
        renderTab();
        expect(await screen.findByText('Nothing unanswered')).toBeInTheDocument();
    });

    it('shows an error with a retry when the list does not load', async () => {
        api.fetchUnanswered.mockRejectedValue(new Error('down'));
        renderTab();
        expect(await screen.findByText('Could not load unanswered questions.')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    });
});
