import { BASE_URL, ENGAGEMENT_ENGINES_BASE, ENGAGEMENT_TASKS_BASE } from '@/constants/urls';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { listTasks } from './index';
import type { EngagementAction, TaskListFilters } from '../-types';
import type { CrmActionSetting, LeadAutomation, UpcomingCalls } from '../-types/actions';

const ENGAGEMENT_LEADS_BASE = `${BASE_URL}/admin-core-service/v1/engagement/leads`;

/** Most rows the inbox serves per page. */
const MAX_TASK_PAGE = 200;

/** Every CRM action waiting for approval under these filters, across all pages of the inbox. */
export const listApprovableTaskIds = async (
    instituteId: string,
    filters: TaskListFilters
): Promise<string[]> => {
    const ids: string[] = [];
    let page = 0;
    let totalPages = 1;
    while (page < totalPages) {
        const res = await listTasks(instituteId, 'OPEN,ACKED', page, MAX_TASK_PAGE, {
            ...filters,
            kind: 'CRM',
        });
        ids.push(...res.content.map((task) => task.id));
        totalPages = res.totalPages;
        page += 1;
    }
    return ids;
};

/** Run a CRM action the engine drafted (or hold an AI call until the time asked for). */
export const approveCrmTask = async (taskId: string, instituteId: string): Promise<EngagementAction> => {
    const res = await authenticatedAxiosInstance.post(`${ENGAGEMENT_TASKS_BASE}/${taskId}/approve`, null, {
        params: { instituteId },
    });
    return res.data;
};

/** Reverse a done CRM action, or drop an approved AI call still waiting for its time. */
export const undoCrmTask = async (taskId: string, instituteId: string): Promise<EngagementAction> => {
    const res = await authenticatedAxiosInstance.post(`${ENGAGEMENT_TASKS_BASE}/${taskId}/undo`, null, {
        params: { instituteId },
    });
    return res.data;
};

export const getEngineActions = async (engineId: string, instituteId: string): Promise<CrmActionSetting[]> => {
    const res = await authenticatedAxiosInstance.get(`${ENGAGEMENT_ENGINES_BASE}/${engineId}/actions`, {
        params: { instituteId },
    });
    return res.data;
};

export const saveEngineActions = async (
    engineId: string,
    instituteId: string,
    actions: CrmActionSetting[]
): Promise<CrmActionSetting[]> => {
    const res = await authenticatedAxiosInstance.put(
        `${ENGAGEMENT_ENGINES_BASE}/${engineId}/actions`,
        { actions },
        { params: { instituteId } }
    );
    return res.data;
};

export const getLeadAutomation = async (leadId: string, instituteId: string): Promise<LeadAutomation> => {
    const res = await authenticatedAxiosInstance.get(`${ENGAGEMENT_LEADS_BASE}/${leadId}/automation`, {
        params: { instituteId },
    });
    return res.data;
};

export const setLeadAutomation = async (
    leadId: string,
    instituteId: string,
    doNotAutomate: boolean
): Promise<LeadAutomation> => {
    const res = await authenticatedAxiosInstance.put(
        `${ENGAGEMENT_LEADS_BASE}/${leadId}/automation`,
        { doNotAutomate },
        { params: { instituteId } }
    );
    return res.data;
};

/** The engine's AI calls still to happen, the ones placed in the last day, and the first calls coming. */
export const getUpcomingCalls = async (engineId: string, instituteId: string): Promise<UpcomingCalls> => {
    const res = await authenticatedAxiosInstance.get(
        `${ENGAGEMENT_ENGINES_BASE}/${engineId}/upcoming-calls`,
        { params: { instituteId } }
    );
    return res.data;
};
