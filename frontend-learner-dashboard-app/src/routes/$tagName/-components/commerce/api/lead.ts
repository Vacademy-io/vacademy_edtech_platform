/**
 * A shop lead that has a phone and no e-mail (most shoppers leave only a number). The site's
 * lead pipeline (submitWebsiteLead, submit-catalogue) needs an e-mail, so such a lead goes to
 * the campaign form route instead (POST /open/v1/audience/lead/submit), which takes a lead with
 * a phone only when the form names an active campaign of the institute. The route keeps no
 * e-mail on the lead and sends nothing to it.
 *
 * Only the name and the phone are sent: the form's other answers are keyed by label, and the
 * campaign route expects the campaign's own fields, so they go only with an e-mail lead.
 */
import { SUBMIT_AUDIENCE_LEAD } from '@/constants/urls';
import { trackUtmAttribution } from '@/lib/utm-attribution';
import { emitLeadCaptured } from '../../../-utils/catalogue-tracking';

export interface PhoneOnlyLead {
    instituteId: string;
    /** An active campaign of the institute; the route needs one. */
    audienceId: string;
    fullName: string;
    /** Ten digits. */
    mobileNumber: string;
    sourceType: string;
    sourceId: string;
}

export class LeadNotSavedError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'LeadNotSavedError';
    }
}

export const submitPhoneOnlyLead = async (lead: PhoneOnlyLead, fetcher: typeof fetch = fetch): Promise<void> => {
    const response = await fetcher(SUBMIT_AUDIENCE_LEAD, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            audience_id: lead.audienceId,
            source_type: lead.sourceType,
            source_id: lead.sourceId,
            user_dto: { full_name: lead.fullName, mobile_number: lead.mobileNumber, email: '' },
        }),
    });
    if (!response.ok) throw new LeadNotSavedError(`status ${response.status}`);
    // 200 carries the lead's id, "already submitted" (a success to the visitor), or an error line.
    const text = await response.text().catch(() => '');
    if (/^\s*error\b/i.test(text)) throw new LeadNotSavedError('not saved');
    emitLeadCaptured({ audienceId: lead.audienceId, sourceType: lead.sourceType, sourceId: lead.sourceId });
    trackUtmAttribution({
        instituteId: lead.instituteId,
        mobileNumber: lead.mobileNumber,
        sourceType: 'CATALOGUE',
        sourceId: lead.sourceId,
    });
};
