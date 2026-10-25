import { useMemo } from 'react';
import { getCurrentInstituteId } from '@/lib/auth/instituteUtils';
import { useCampaignsList } from '@/routes/audience-manager/list/-hooks/useCampaignsList';
import type { LeadAgent } from '../-types';
import type { LeadListOption } from '../-components/AgentFormSections';

/**
 * The institute's lead lists (the existing campaigns-list service), minus lists that
 * already have a live agent (one agent per list). `keepId` stays even if taken: it is
 * the list of the agent being edited.
 */
export function useLeadListOptions(agents: LeadAgent[] | undefined, keepId?: string) {
    const instituteId = getCurrentInstituteId() ?? '';
    const query = useCampaignsList({ institute_id: instituteId, page: 0, size: 200 });
    const options = useMemo<LeadListOption[]>(() => {
        const taken = new Set(
            (agents ?? []).filter((a) => a.status !== 'ARCHIVED').map((a) => a.audience_id)
        );
        return (query.data?.content ?? [])
            .map((c) => ({
                id: c.id || c.campaign_id || c.audience_id || '',
                name: c.campaign_name || 'Untitled list',
            }))
            .filter((l) => l.id && (l.id === keepId || !taken.has(l.id)));
    }, [query.data, agents, keepId]);
    return { options, isLoading: query.isLoading, isError: query.isError };
}
