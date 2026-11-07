import { describe, expect, it } from 'vitest';
import type { CampaignUserTable } from '@/routes/audience-manager/list/-components/campaign-users/campaign-users-columns';
import {
    campaignRowToVM,
    mapCampaignRowToStudent,
    mapRecentLeadToStudent,
    recentLeadPhone,
    recentLeadToVM,
} from '../../lead-view-model';

// A repeat enquiry with the same email but a new phone joins the first enquiry's auth
// user, so the user's mobile is NOT this enquiry's number.
const user = {
    id: 'u1',
    full_name: 'Asha',
    email: 'asha@example.com',
    mobile_number: '9000000001',
};

describe('recentLeadPhone', () => {
    it("shows this enquiry's own number over the shared auth user's", () => {
        expect(recentLeadPhone({ parent_mobile: '919000000002', user })).toBe('919000000002');
        expect(
            recentLeadToVM({ response_id: 'r1', parent_mobile: '919000000002', user }).phone
        ).toBe('919000000002');
    });

    it("falls back to the auth user's number, then '-'", () => {
        expect(recentLeadPhone({ parent_mobile: '', user })).toBe('9000000001');
        expect(recentLeadPhone({ user })).toBe('9000000001');
        expect(recentLeadPhone({})).toBe('-');
    });

    it("keeps the side view's identity on the auth user (Edit Lead saves it there)", () => {
        const student = mapRecentLeadToStudent({ parent_mobile: '919000000002', user });
        expect(student.mobile_number).toBe('9000000001');
        expect(student.father_mobile_number).toBe('919000000002');
    });
});

describe('campaign Lead List row', () => {
    const row = (phone: string | null, u: typeof user | Record<string, never>) =>
        ({ id: 'r1', phone_number: phone, _user: u }) as unknown as CampaignUserTable;

    it("shows the row's phone_number (this enquiry's number)", () => {
        expect(campaignRowToVM(row('919000000002', user)).phone).toBe('919000000002');
    });

    it("seeds the side view / Edit Lead with the auth user's number, as before", () => {
        expect(mapCampaignRowToStudent(row('919000000002', user)).mobile_number).toBe('9000000001');
        expect(mapCampaignRowToStudent(row('919000000002', {})).mobile_number).toBe('919000000002');
        expect(mapCampaignRowToStudent(row(null, {})).mobile_number).toBe('');
    });
});
