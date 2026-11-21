import { StatusChip } from '@/components/design-system/status-chips';
import type { LeadStatus } from '../-services/site-assistant-service';

/** SALES = a new enquiry for the sales team; SUPPORT = an existing learner asking for help. */
export const LeadBadge = ({ lead }: { lead: LeadStatus }) =>
    lead === 'SALES' ? (
        <StatusChip text="Sales enquiry" status="SUCCESS" textSize="text-caption" />
    ) : (
        <StatusChip text="Support request" status="INFO" textSize="text-caption" />
    );
