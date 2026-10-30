import { createFileRoute } from '@tanstack/react-router';
import { normalizeInboxSearch, type InboxSearch } from './-utils/search';

/**
 * Route definition only; the component is lazy-loaded from index.lazy.tsx. All of the inbox's
 * state is in the URL, so a link from the daily report opens exactly the items behind a number:
 * /engagement-engines/inbox?filter=sent&engine=<id>&date=2026-10-30&channel=EMAIL&outcome=bounced
 *
 *   filter    needsAction | sent | failed | waited | handled | dryRun (the tab)
 *   engine    engine id
 *   channel   EMAIL | WHATSAPP | IN_APP | AI_CALL
 *   kind      TASK | REPLY | SEND | CRM (NO_OP opens the waited tab)
 *   date      yyyy-MM-dd, a day in the institute time zone
 *   template  template name, or an email subject
 *   outcome   delivered | opened | bounced ... (needs date)
 */
export const Route = createFileRoute('/engagement-engines/inbox/')({
    validateSearch: (search: Record<string, unknown>): InboxSearch => normalizeInboxSearch(search),
});
