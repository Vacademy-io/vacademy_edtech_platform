/**
 * react-query hooks for the Lead Agent screens. Every mutation toasts its own
 * success / failure and refreshes the queries it can change.
 */
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type {
    AgentPayload,
    AgentStatus,
    CandidateStatusFilter,
    DecisionAction,
    SuggestRequest,
} from '../-types';
import {
    apiErrorMessage,
    bulkDecideCandidates,
    createAgent,
    decideCandidate,
    getAgent,
    getAgentStats,
    getCandidate,
    listAgents,
    listCandidates,
    listWorkers,
    pairWorker,
    revokeWorker,
    runAgentNow,
    setAgentStatus,
    statusParam,
    suggestBrief,
    updateAgent,
} from '../-services/lead-agent-api';

export const LEAD_AGENT_KEY = 'LEAD_AGENT';
export const leadAgentKeys = {
    agents: () => [LEAD_AGENT_KEY, 'agents'] as const,
    agent: (id: string) => [LEAD_AGENT_KEY, 'agent', id] as const,
    candidates: (id: string, status: CandidateStatusFilter, page: number, size: number) =>
        [LEAD_AGENT_KEY, 'candidates', id, statusParam(status), page, size] as const,
    candidatesOf: (id: string) => [LEAD_AGENT_KEY, 'candidates', id] as const,
    candidate: (id: string) => [LEAD_AGENT_KEY, 'candidate', id] as const,
    stats: (id: string, days: number) => [LEAD_AGENT_KEY, 'stats', id, days] as const,
    workers: () => [LEAD_AGENT_KEY, 'workers'] as const,
};

const STATUS_DONE: Record<AgentStatus, string> = {
    ACTIVE: 'Agent turned on',
    PAUSED: 'Agent paused',
    ARCHIVED: 'Agent archived',
};

export const useLeadAgents = () =>
    useQuery({
        queryKey: leadAgentKeys.agents(),
        queryFn: listAgents,
        staleTime: 30_000,
        refetchInterval: 60_000,
    });

export const useLeadAgent = (agentId: string) =>
    useQuery({
        queryKey: leadAgentKeys.agent(agentId),
        queryFn: () => getAgent(agentId),
        enabled: !!agentId,
        staleTime: 30_000,
    });

export const useCandidates = (
    agentId: string,
    status: CandidateStatusFilter,
    page: number,
    size: number,
    enabled = true
) =>
    useQuery({
        queryKey: leadAgentKeys.candidates(agentId, status, page, size),
        queryFn: () => listCandidates(agentId, { status, page, size }),
        enabled: enabled && !!agentId,
        placeholderData: keepPreviousData,
        staleTime: 15_000,
    });

export const useCandidate = (candidateId: string, enabled: boolean) =>
    useQuery({
        queryKey: leadAgentKeys.candidate(candidateId),
        queryFn: () => getCandidate(candidateId),
        enabled: enabled && !!candidateId,
        staleTime: 60_000,
    });

export const useAgentStats = (agentId: string, days = 14) =>
    useQuery({
        queryKey: leadAgentKeys.stats(agentId, days),
        queryFn: () => getAgentStats(agentId, days),
        enabled: !!agentId,
        staleTime: 60_000,
    });

export const useWorkers = () =>
    useQuery({
        queryKey: leadAgentKeys.workers(),
        queryFn: listWorkers,
        staleTime: 15_000,
        refetchInterval: 30_000,
    });

export function useCreateAgent() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (payload: AgentPayload) => createAgent(payload),
        onSuccess: () => {
            toast.success('Lead Agent created. It is paused until you turn it on.');
            void qc.invalidateQueries({ queryKey: leadAgentKeys.agents() });
        },
        onError: (e) => toast.error(apiErrorMessage(e, 'Could not create the agent.')),
    });
}

export function useUpdateAgent(agentId: string) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (payload: Partial<AgentPayload>) => updateAgent(agentId, payload),
        onSuccess: (agent) => {
            toast.success('Settings saved');
            qc.setQueryData(leadAgentKeys.agent(agentId), agent);
            void qc.invalidateQueries({ queryKey: leadAgentKeys.agents() });
        },
        onError: (e) => toast.error(apiErrorMessage(e, 'Could not save the settings.')),
    });
}

export function useSetAgentStatus() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: ({ agentId, status }: { agentId: string; status: AgentStatus }) =>
            setAgentStatus(agentId, status),
        onSuccess: (agent, { agentId, status }) => {
            toast.success(STATUS_DONE[status]);
            if (agent.id) qc.setQueryData(leadAgentKeys.agent(agentId), agent);
            void qc.invalidateQueries({ queryKey: leadAgentKeys.agents() });
            void qc.invalidateQueries({ queryKey: leadAgentKeys.agent(agentId) });
        },
        onError: (e) => toast.error(apiErrorMessage(e, 'Could not change the agent’s status.')),
    });
}

export function useRunNow() {
    return useMutation({
        mutationFn: (agentId: string) => runAgentNow(agentId),
        onSuccess: () => toast.success('Run queued. Delivery still waits for the delivery window.'),
        onError: (e) => toast.error(apiErrorMessage(e, 'Could not start a run.')),
    });
}

export function useDecideCandidate(agentId: string) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: ({
            candidateId,
            action,
            reason,
        }: {
            candidateId: string;
            action: DecisionAction;
            reason?: string;
        }) => decideCandidate(candidateId, action, reason),
        onSuccess: (_c, { action }) => {
            toast.success(action === 'APPROVE' ? 'Approved. It will be delivered.' : 'Rejected');
            void qc.invalidateQueries({ queryKey: leadAgentKeys.candidatesOf(agentId) });
            void qc.invalidateQueries({ queryKey: leadAgentKeys.agents() });
        },
        onError: (e) => toast.error(apiErrorMessage(e, 'Could not save the decision.')),
    });
}

export function useBulkDecide(agentId: string) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: ({
            ids,
            action,
            reason,
        }: {
            ids: string[];
            action: DecisionAction;
            reason?: string;
        }) => bulkDecideCandidates(ids, action, reason),
        onSuccess: ({ updated }, { action }) => {
            toast.success(
                `${updated} ${updated === 1 ? 'lead' : 'leads'} ${action === 'APPROVE' ? 'approved' : 'rejected'}`
            );
            void qc.invalidateQueries({ queryKey: leadAgentKeys.candidatesOf(agentId) });
            void qc.invalidateQueries({ queryKey: leadAgentKeys.agents() });
        },
        onError: (e) => toast.error(apiErrorMessage(e, 'Could not save the decisions.')),
    });
}

export function useSuggestBrief() {
    return useMutation({
        mutationFn: (body: SuggestRequest) => suggestBrief(body),
        onError: (e) =>
            toast.error(
                apiErrorMessage(e, 'Could not get suggestions. Try again, or fill them in.')
            ),
    });
}

export function usePairWorker() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (label?: string) => pairWorker(label),
        onSuccess: () => void qc.invalidateQueries({ queryKey: leadAgentKeys.workers() }),
        onError: (e) => toast.error(apiErrorMessage(e, 'Could not create a pairing code.')),
    });
}

export function useRevokeWorker() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (workerId: string) => revokeWorker(workerId),
        onSuccess: () => {
            toast.success('Computer disconnected');
            void qc.invalidateQueries({ queryKey: leadAgentKeys.workers() });
        },
        onError: (e) => toast.error(apiErrorMessage(e, 'Could not disconnect the computer.')),
    });
}
