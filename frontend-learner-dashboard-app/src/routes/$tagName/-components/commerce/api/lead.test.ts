// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { LeadNotSavedError, submitPhoneOnlyLead } from './lead';

const lead = { instituteId: 'inst-1', audienceId: 'aud-1', fullName: 'Asha', mobileNumber: '9876543210', sourceType: 'WEBSITE_FORM', sourceId: 'shop:contact' };

describe('submitPhoneOnlyLead', () => {
    it('posts name and phone to the campaign route, with no e-mail and no other answers', async () => {
        const fetcher = vi.fn(async () => new Response('resp-1', { status: 200 }));
        const captured = vi.fn();
        window.addEventListener('vacademy:lead-captured', captured);
        await submitPhoneOnlyLead(lead, fetcher as unknown as typeof fetch);
        window.removeEventListener('vacademy:lead-captured', captured);
        const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
        expect(url).toMatch(/\/admin-core-service\/open\/v1\/audience\/lead\/submit$/);
        expect(JSON.parse(init.body as string)).toEqual({
            audience_id: 'aud-1',
            source_type: 'WEBSITE_FORM',
            source_id: 'shop:contact',
            user_dto: { full_name: 'Asha', mobile_number: '9876543210', email: '' },
        });
        expect(captured).toHaveBeenCalledTimes(1);
    });

    it('a repeat is a success; an error line or a refused request is not', async () => {
        await expect(submitPhoneOnlyLead(lead, (async () => new Response('You have already submitted your response for this campaign')) as unknown as typeof fetch)).resolves.toBeUndefined();
        await expect(submitPhoneOnlyLead(lead, (async () => new Response('Error in submitting the response: x')) as unknown as typeof fetch)).rejects.toBeInstanceOf(LeadNotSavedError);
        await expect(submitPhoneOnlyLead(lead, (async () => new Response('Too many', { status: 429 })) as unknown as typeof fetch)).rejects.toBeInstanceOf(LeadNotSavedError);
    });
});
