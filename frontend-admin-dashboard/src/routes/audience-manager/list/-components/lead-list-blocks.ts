import type { CrmBlockId } from '@/routes/dashboard/-services/crm-dashboard';

/**
 * Every CRM block the Lead Lists page reads (header + list cards). One array for both,
 * so the page sends a single crm-dashboard request and the cards reuse it.
 */
export const LEAD_LIST_BLOCKS: CrmBlockId[] = [
    'summary',
    'followups',
    'views',
    'lists',
    'list_stats',
];
