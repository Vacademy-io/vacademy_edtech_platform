import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { format } from 'date-fns';
import { AddressBook } from '@phosphor-icons/react';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { GET_LEAD_ENQUIRY_CONTACTS } from '@/constants/urls';
import { ProfileSectionCard, ProfileFieldRow } from '../profile-ui';

/** One phone / email the person behind a lead enquired with (backend LeadEnquiryContactsDTO.Contact). */
interface LeadEnquiryContact {
    value: string;
    response_id: string;
    source_type: string | null;
    campaign_name: string | null;
    created_at: string | null;
}

interface LeadEnquiryContacts {
    phones?: LeadEnquiryContact[];
    emails?: LeadEnquiryContact[];
}

const last10 = (phone: string | null | undefined) => {
    const digits = (phone || '').replace(/\D/g, '');
    return digits.length >= 10 ? digits.slice(-10) : digits;
};

const normalizeEmail = (email: string | null | undefined) => (email || '').trim().toLowerCase();

/** "15 Oct 2026", or '' for a missing / unparseable date (format() throws on Invalid Date). */
const formatDay = (value: string | null | undefined) => {
    if (!value) return '';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '' : format(date, 'd MMM yyyy');
};

/**
 * "Other contact details" on a lead's Overview: the phones and emails this person enquired
 * with besides the ones on their profile, e.g. a repeat that came in with a new number or a
 * new email. Renders nothing while loading, on error, or when there is nothing extra, so the
 * rest of the Overview is never affected.
 */
export const OverviewOtherContacts = ({
    responseId,
    mainPhone,
    mainEmail,
    copiedField,
    onCopy,
}: {
    responseId: string;
    mainPhone: string | null | undefined;
    mainEmail: string | null | undefined;
    copiedField: string;
    onCopy: (text: string, label: string, fieldKey: string) => void;
}) => {
    const { t } = useTranslation('manageStudentsOverview');

    const { data } = useQuery<LeadEnquiryContacts>({
        queryKey: ['lead-enquiry-contacts', responseId],
        queryFn: async () => {
            const res = await authenticatedAxiosInstance.get(GET_LEAD_ENQUIRY_CONTACTS(responseId));
            return res.data && typeof res.data === 'object' ? res.data : {};
        },
        enabled: !!responseId,
        staleTime: 60 * 1000,
    });

    const phone = last10(mainPhone);
    const email = normalizeEmail(mainEmail);
    const rows = [
        ...(data?.phones || [])
            .filter((c) => c.value && last10(c.value) !== phone)
            .map((c) => ({ ...c, kind: 'phone' as const })),
        ...(data?.emails || [])
            .filter((c) => c.value && normalizeEmail(c.value) !== email)
            .map((c) => ({ ...c, kind: 'email' as const })),
    ];
    if (rows.length === 0) return null;

    return (
        <ProfileSectionCard icon={AddressBook} heading={t('otherContacts.heading')}>
            <p className="pb-1 text-2xs text-muted-foreground">{t('otherContacts.hint')}</p>
            <dl>
                {rows.map((c) => {
                    const kindLabel = t(c.kind === 'phone' ? 'otherContacts.phone' : 'otherContacts.email');
                    const where = c.campaign_name || c.source_type || t('fallback.notAvailable');
                    const when = formatDay(c.created_at);
                    const label = [kindLabel, where, when].filter(Boolean).join(' · ');
                    const fieldKey = `other-${c.kind}-${c.response_id}`;
                    return (
                        <ProfileFieldRow
                            key={fieldKey}
                            label={label}
                            value={c.value}
                            copied={copiedField === fieldKey}
                            onCopy={() => onCopy(c.value, kindLabel, fieldKey)}
                        />
                    );
                })}
            </dl>
        </ProfileSectionCard>
    );
};
