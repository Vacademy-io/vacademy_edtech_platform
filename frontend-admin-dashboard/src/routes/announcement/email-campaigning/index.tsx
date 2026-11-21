import { createFileRoute } from '@tanstack/react-router';

type EmailCampaigningSearch = {
    id?: string;
    /** Start a new campaign prefilled from this one (see DuplicateCampaignDialog). */
    duplicateFrom?: string;
    /** Comma-separated parts to copy when duplicating: recipients, content, settings. */
    keep?: string;
};

export const Route = createFileRoute('/announcement/email-campaigning/')({
    validateSearch: (search: Record<string, unknown>): EmailCampaigningSearch => ({
        id: typeof search.id === 'string' ? search.id : undefined,
        duplicateFrom: typeof search.duplicateFrom === 'string' ? search.duplicateFrom : undefined,
        keep: typeof search.keep === 'string' ? search.keep : undefined,
    }),
});
