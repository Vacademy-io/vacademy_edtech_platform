import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { getInstituteId } from '@/constants/helper';
import type { CreateEngineRequest, EngineStatus, TemplateEditRequest } from '../-types';
import {
    ackTask,
    approveTemplate,
    archiveEngine,
    createEngine,
    dismissTask,
    doneTask,
    editPrompt,
    editTemplate,
    enrollEngine,
    getDataPointCatalog,
    getEngine,
    listEngines,
    listTasks,
    listTemplates,
    recommendTemplates,
    reopenTask,
    requestAlternatives,
    sendTask,
    setAutonomy,
    submitTemplate,
    syncTemplates,
    transitionEngine,
    withdrawTemplate,
} from '../-services';

const errMsg = (e: unknown, fallback: string): string => {
    // A VacademyException body carries its text in `ex`; reading only `message` showed axios's own
    // "Request failed with status code 510" instead of the server's reason.
    const anyErr = e as {
        response?: { data?: { ex?: string; message?: string } };
        message?: string;
    };
    return (
        anyErr?.response?.data?.ex || anyErr?.response?.data?.message || anyErr?.message || fallback
    );
};

// ---- Engines ----
export const useEngines = () => {
    const instituteId = getInstituteId() || '';
    return useQuery({
        queryKey: ['engagementEngines', instituteId],
        queryFn: () => listEngines(instituteId),
        enabled: !!instituteId,
        staleTime: 30 * 1000,
    });
};

export const useEngine = (engineId: string | undefined) => {
    const instituteId = getInstituteId() || '';
    return useQuery({
        queryKey: ['engagementEngine', instituteId, engineId],
        queryFn: () => getEngine(engineId as string, instituteId),
        enabled: !!instituteId && !!engineId,
        staleTime: 15 * 1000,
    });
};

export const useDataPointCatalog = () =>
    useQuery({
        queryKey: ['engagementDataPoints'],
        queryFn: getDataPointCatalog,
        staleTime: 5 * 60 * 1000,
    });

export const useCreateEngine = () => {
    const { t } = useTranslation('engagementEnginesHooks');
    const qc = useQueryClient();
    const instituteId = getInstituteId() || '';
    return useMutation({
        mutationFn: (payload: CreateEngineRequest) => createEngine(instituteId, payload),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ['engagementEngines'] });
            toast.success(t('toast.engineCreated'));
        },
        onError: (e) => toast.error(errMsg(e, t('toast.createEngineFailed'))),
    });
};

export const useTransitionEngine = () => {
    const { t } = useTranslation('engagementEnginesHooks');
    const qc = useQueryClient();
    const instituteId = getInstituteId() || '';
    return useMutation({
        mutationFn: ({ engineId, toStatus }: { engineId: string; toStatus: EngineStatus }) =>
            transitionEngine(engineId, instituteId, toStatus),
        onSuccess: (_data, vars) => {
            qc.invalidateQueries({ queryKey: ['engagementEngines'] });
            qc.invalidateQueries({ queryKey: ['engagementEngine', instituteId, vars.engineId] });
            toast.success(t('toast.engineUpdated'));
        },
        onError: (e) => toast.error(errMsg(e, t('toast.changeStatusFailed'))),
    });
};

export const useSetAutonomy = () => {
    const { t } = useTranslation('engagementEnginesHooks');
    const qc = useQueryClient();
    const instituteId = getInstituteId() || '';
    return useMutation({
        mutationFn: ({ engineId, killed }: { engineId: string; killed: boolean }) =>
            setAutonomy(engineId, instituteId, killed),
        onSuccess: (_d, vars) => {
            qc.invalidateQueries({ queryKey: ['engagementEngine', instituteId, vars.engineId] });
            qc.invalidateQueries({ queryKey: ['engagementEngines'] });
            toast.success(vars.killed ? t('toast.autonomyOff') : t('toast.autonomyOn'));
        },
        onError: (e) => toast.error(errMsg(e, t('toast.autonomyFailed'))),
    });
};

export const useEnrollEngine = () => {
    const { t } = useTranslation('engagementEnginesHooks');
    const qc = useQueryClient();
    const instituteId = getInstituteId() || '';
    return useMutation({
        mutationFn: (engineId: string) => enrollEngine(engineId, instituteId),
        onSuccess: (data, engineId) => {
            qc.invalidateQueries({ queryKey: ['engagementEngine', instituteId, engineId] });
            toast.success(
                t('toast.enrollResult', {
                    added: data.newlyEnrolled,
                    exited: data.exited,
                    total: data.audienceSize,
                })
            );
        },
        onError: (e) => toast.error(errMsg(e, t('toast.enrollFailed'))),
    });
};

export const useEditPrompt = () => {
    const { t } = useTranslation('engagementEnginesHooks');
    const qc = useQueryClient();
    const instituteId = getInstituteId() || '';
    return useMutation({
        mutationFn: ({ engineId, deltaText }: { engineId: string; deltaText: string }) =>
            editPrompt(engineId, instituteId, deltaText),
        onSuccess: (_d, vars) => {
            qc.invalidateQueries({ queryKey: ['engagementEngine', instituteId, vars.engineId] });
            toast.success(t('toast.promptUpdated'));
        },
        onError: (e) => toast.error(errMsg(e, t('toast.promptUpdateFailed'))),
    });
};

export const useArchiveEngine = () => {
    const { t } = useTranslation('engagementEnginesHooks');
    const qc = useQueryClient();
    const instituteId = getInstituteId() || '';
    return useMutation({
        mutationFn: (engineId: string) => archiveEngine(engineId, instituteId),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ['engagementEngines'] });
            toast.success(t('toast.engineArchived'));
        },
        onError: (e) => toast.error(errMsg(e, t('toast.archiveFailed'))),
    });
};

// ---- Tasks ----
export const useTasks = (statuses: string, page: number, size: number) => {
    const instituteId = getInstituteId() || '';
    return useQuery({
        queryKey: ['engagementTasks', instituteId, statuses, page, size],
        queryFn: () => listTasks(instituteId, statuses, page, size),
        enabled: !!instituteId,
        staleTime: 10 * 1000,
    });
};

export const useTaskAction = () => {
    const { t } = useTranslation('engagementEnginesHooks');
    const qc = useQueryClient();
    const instituteId = getInstituteId() || '';
    return useMutation({
        mutationFn: async ({
            taskId,
            verb,
            editedBody,
        }: {
            taskId: string;
            verb: 'ack' | 'done' | 'dismiss' | 'reopen' | 'send';
            editedBody?: string;
        }) => {
            switch (verb) {
                case 'ack':
                    return ackTask(taskId, instituteId);
                case 'done':
                    return doneTask(taskId, instituteId);
                case 'dismiss':
                    return dismissTask(taskId, instituteId);
                case 'reopen':
                    return reopenTask(taskId, instituteId);
                case 'send':
                    return sendTask(taskId, instituteId, editedBody);
            }
        },
        onSuccess: (data, vars) => {
            qc.invalidateQueries({ queryKey: ['engagementTasks'] });
            if (vars.verb === 'send') {
                // The graduation count on the engine page moves with every approved send.
                qc.invalidateQueries({ queryKey: ['engagementEngine'] });
                // An unknown-outcome send comes back 200 with status FAILED: it must not read "Sent".
                const status = (data as { status?: string } | undefined)?.status;
                if (status && status !== 'SENT') {
                    toast.error(t('taskAction.sendNotConfirmed'));
                    return;
                }
            }
            const msg: Record<string, string> = {
                ack: t('taskAction.ack'),
                done: t('taskAction.done'),
                dismiss: t('taskAction.dismiss'),
                reopen: t('taskAction.reopen'),
                send: t('taskAction.send'),
            };
            toast.success(msg[vars.verb] ?? t('taskAction.default'));
        },
        onError: (e) => {
            // Refresh either way: a task another admin already handled should leave the list.
            qc.invalidateQueries({ queryKey: ['engagementTasks'] });
            toast.error(errMsg(e, t('toast.taskActionFailed')));
        },
    });
};

// ---- Templates ----
export const useTemplates = (engineId: string | undefined) => {
    const instituteId = getInstituteId() || '';
    return useQuery({
        queryKey: ['engagementTemplates', instituteId, engineId],
        queryFn: () => listTemplates(engineId as string, instituteId),
        enabled: !!instituteId && !!engineId,
        staleTime: 10 * 1000,
    });
};

export const useTemplateMutation = () => {
    const { t } = useTranslation('engagementEnginesHooks');
    const qc = useQueryClient();
    const instituteId = getInstituteId() || '';
    const invalidate = (engineId?: string) => {
        qc.invalidateQueries({ queryKey: ['engagementTemplates', instituteId, engineId] });
        if (engineId) qc.invalidateQueries({ queryKey: ['engagementEngine', instituteId, engineId] });
    };
    return {
        recommend: useMutation({
            mutationFn: ({ engineId, count }: { engineId: string; count?: number }) =>
                recommendTemplates(engineId, instituteId, count),
            onSuccess: (_d, v) => {
                invalidate(v.engineId);
                toast.success(t('toast.templatesProposed'));
            },
            onError: (e) => toast.error(errMsg(e, t('toast.proposeTemplatesFailed'))),
        }),
        alternatives: useMutation({
            mutationFn: ({ engineId, feedback }: { engineId: string; feedback?: string }) =>
                requestAlternatives(engineId, instituteId, feedback),
            onSuccess: (_d, v) => {
                invalidate(v.engineId);
                toast.success(t('toast.alternativesProposed'));
            },
            onError: (e) => toast.error(errMsg(e, t('toast.alternativesFailed'))),
        }),
        edit: useMutation({
            mutationFn: ({
                id,
                payload,
            }: {
                id: string;
                engineId: string;
                payload: TemplateEditRequest;
            }) => editTemplate(id, instituteId, payload),
            onSuccess: (_d, v) => {
                invalidate(v.engineId);
                toast.success(t('toast.templateUpdated'));
            },
            onError: (e) => toast.error(errMsg(e, t('toast.templateSaveFailed'))),
        }),
        approve: useMutation({
            mutationFn: ({ id }: { id: string; engineId: string }) => approveTemplate(id, instituteId),
            onSuccess: (_d, v) => {
                invalidate(v.engineId);
                toast.success(t('toast.templateApproved'));
            },
            onError: (e) => toast.error(errMsg(e, t('toast.approveFailed'))),
        }),
        submit: useMutation({
            mutationFn: ({ id }: { id: string; engineId: string }) => submitTemplate(id, instituteId),
            onSuccess: (_d, v) => {
                invalidate(v.engineId);
                toast.success(t('toast.submittedToMeta'));
            },
            onError: (e) => toast.error(errMsg(e, t('toast.submitFailed'))),
        }),
        withdraw: useMutation({
            mutationFn: ({ id }: { id: string; engineId: string }) => withdrawTemplate(id, instituteId),
            onSuccess: (_d, v) => {
                invalidate(v.engineId);
                toast.success(t('toast.templateWithdrawn'));
            },
            onError: (e) => toast.error(errMsg(e, t('toast.withdrawFailed'))),
        }),
        sync: useMutation({
            mutationFn: ({ engineId }: { engineId: string }) => syncTemplates(instituteId).then((r) => ({ ...r, engineId })),
            onSuccess: (r) => {
                invalidate(r.engineId);
                toast.success(
                    r.changed > 0
                        ? t('toast.templatesUpdated', { count: r.changed })
                        : t('toast.noChangesFromMeta')
                );
            },
            onError: (e) => toast.error(errMsg(e, t('toast.syncFailed'))),
        }),
    };
};
