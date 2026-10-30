import {
    ENGAGEMENT_DATA_POINTS,
    ENGAGEMENT_ENGINES_BASE,
    ENGAGEMENT_TASKS_BASE,
    ENGAGEMENT_TEMPLATES_BASE,
} from '@/constants/urls';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import type {
    ChannelReadinessMap,
    CreateEngineRequest,
    DataPointSpec,
    EngagementAction,
    EngagementEngine,
    EngagementTemplateProposal,
    EngineDetail,
    EngineStatus,
    EnrollmentResult,
    PageResponse,
    TaskPerson,
    TemplateEditRequest,
} from '../-types';

// ---- Engines ----
export const listEngines = async (instituteId: string): Promise<EngagementEngine[]> => {
    const res = await authenticatedAxiosInstance.get(ENGAGEMENT_ENGINES_BASE, { params: { instituteId } });
    return res.data;
};

export const getEngine = async (engineId: string, instituteId: string): Promise<EngineDetail> => {
    const res = await authenticatedAxiosInstance.get(`${ENGAGEMENT_ENGINES_BASE}/${engineId}`, {
        params: { instituteId },
    });
    return res.data;
};

export const createEngine = async (
    instituteId: string,
    payload: CreateEngineRequest
): Promise<EngagementEngine> => {
    const res = await authenticatedAxiosInstance.post(ENGAGEMENT_ENGINES_BASE, payload, {
        params: { instituteId },
    });
    return res.data;
};

export const enrollEngine = async (
    engineId: string,
    instituteId: string
): Promise<EnrollmentResult> => {
    const res = await authenticatedAxiosInstance.post(
        `${ENGAGEMENT_ENGINES_BASE}/${engineId}/enroll`,
        null,
        { params: { instituteId } }
    );
    return res.data;
};

export const transitionEngine = async (
    engineId: string,
    instituteId: string,
    toStatus: EngineStatus
): Promise<EngagementEngine> => {
    const res = await authenticatedAxiosInstance.put(
        `${ENGAGEMENT_ENGINES_BASE}/${engineId}/status`,
        null,
        { params: { instituteId, toStatus } }
    );
    return res.data;
};

export const editPrompt = async (
    engineId: string,
    instituteId: string,
    deltaText: string
): Promise<unknown> => {
    const res = await authenticatedAxiosInstance.post(
        `${ENGAGEMENT_ENGINES_BASE}/${engineId}/prompt`,
        { deltaText },
        { params: { instituteId } }
    );
    return res.data;
};

export const setAutonomy = async (
    engineId: string,
    instituteId: string,
    killed: boolean
): Promise<EngagementEngine> => {
    const res = await authenticatedAxiosInstance.put(
        `${ENGAGEMENT_ENGINES_BASE}/${engineId}/autonomy`,
        null,
        { params: { instituteId, killed } }
    );
    return res.data;
};

export const archiveEngine = async (engineId: string, instituteId: string): Promise<void> => {
    await authenticatedAxiosInstance.delete(`${ENGAGEMENT_ENGINES_BASE}/${engineId}`, {
        params: { instituteId },
    });
};

export const getChannelReadiness = async (
    instituteId: string,
    emailType?: string
): Promise<ChannelReadinessMap> => {
    const res = await authenticatedAxiosInstance.get(`${ENGAGEMENT_ENGINES_BASE}/channel-readiness`, {
        params: { instituteId, ...(emailType ? { emailType } : {}) },
    });
    return res.data;
};

export const getDataPointCatalog = async (): Promise<DataPointSpec[]> => {
    const res = await authenticatedAxiosInstance.get(ENGAGEMENT_DATA_POINTS);
    return res.data;
};

// ---- Task inbox ----
export const listTasks = async (
    instituteId: string,
    statuses: string,
    page: number,
    size: number,
    engineId?: string,
    channel?: string,
    kind?: string
): Promise<PageResponse<EngagementAction>> => {
    const res = await authenticatedAxiosInstance.get(ENGAGEMENT_TASKS_BASE, {
        params: { instituteId, statuses, page, size, engineId, channel, kind },
    });
    return res.data;
};

const taskAction = async (taskId: string, instituteId: string, verb: string): Promise<void> => {
    await authenticatedAxiosInstance.post(`${ENGAGEMENT_TASKS_BASE}/${taskId}/${verb}`, null, {
        params: { instituteId },
    });
};

export const ackTask = (taskId: string, instituteId: string) => taskAction(taskId, instituteId, 'ack');
export const doneTask = (taskId: string, instituteId: string) => taskAction(taskId, instituteId, 'done');
export const dismissTask = (taskId: string, instituteId: string) =>
    taskAction(taskId, instituteId, 'dismiss');
export const reopenTask = (taskId: string, instituteId: string) =>
    taskAction(taskId, instituteId, 'reopen');
/** Undo Done / Dismiss: the task goes back to Needs action. */
export const restoreTask = (taskId: string, instituteId: string) =>
    taskAction(taskId, instituteId, 'restore');

/** Name / phone / email of the people behind a page of tasks, keyed by member id. */
export const getTaskPeople = async (
    instituteId: string,
    memberIds: string[]
): Promise<TaskPerson[]> => {
    if (!memberIds.length) return [];
    const res = await authenticatedAxiosInstance.get(`${ENGAGEMENT_TASKS_BASE}/people`, {
        params: { instituteId, memberIds: memberIds.join(',') },
    });
    return Array.isArray(res.data) ? res.data : [];
};

export const sendTask = async (
    taskId: string,
    instituteId: string,
    editedBody?: string
): Promise<EngagementAction> => {
    const res = await authenticatedAxiosInstance.post(
        `${ENGAGEMENT_TASKS_BASE}/${taskId}/send`,
        editedBody != null ? { editedBody } : {},
        { params: { instituteId } }
    );
    return res.data;
};

// ---- Template negotiation ----
export const recommendTemplates = async (
    engineId: string,
    instituteId: string,
    count?: number
): Promise<EngagementTemplateProposal[]> => {
    const res = await authenticatedAxiosInstance.post(`${ENGAGEMENT_TEMPLATES_BASE}/recommend`, null, {
        params: { instituteId, engineId, count },
    });
    return res.data;
};

export const requestAlternatives = async (
    engineId: string,
    instituteId: string,
    feedback?: string,
    count?: number
): Promise<EngagementTemplateProposal[]> => {
    const res = await authenticatedAxiosInstance.post(
        `${ENGAGEMENT_TEMPLATES_BASE}/request-alternatives`,
        { feedback, count },
        { params: { instituteId, engineId } }
    );
    return res.data;
};

export const listTemplates = async (
    engineId: string,
    instituteId: string
): Promise<EngagementTemplateProposal[]> => {
    const res = await authenticatedAxiosInstance.get(ENGAGEMENT_TEMPLATES_BASE, {
        params: { instituteId, engineId },
    });
    return res.data;
};

export const editTemplate = async (
    id: string,
    instituteId: string,
    payload: TemplateEditRequest
): Promise<EngagementTemplateProposal> => {
    const res = await authenticatedAxiosInstance.put(`${ENGAGEMENT_TEMPLATES_BASE}/${id}`, payload, {
        params: { instituteId },
    });
    return res.data;
};

const templateAction = async (
    id: string,
    instituteId: string,
    verb: string
): Promise<EngagementTemplateProposal> => {
    const res = await authenticatedAxiosInstance.post(
        `${ENGAGEMENT_TEMPLATES_BASE}/${id}/${verb}`,
        null,
        { params: { instituteId } }
    );
    return res.data;
};

export const approveTemplate = (id: string, instituteId: string) =>
    templateAction(id, instituteId, 'approve');
export const submitTemplate = (id: string, instituteId: string) =>
    templateAction(id, instituteId, 'submit');
export const withdrawTemplate = (id: string, instituteId: string) =>
    templateAction(id, instituteId, 'withdraw');

export const syncTemplates = async (
    instituteId: string
): Promise<{ changed: number }> => {
    const res = await authenticatedAxiosInstance.post(`${ENGAGEMENT_TEMPLATES_BASE}/sync`, null, {
        params: { instituteId },
    });
    return res.data;
};
