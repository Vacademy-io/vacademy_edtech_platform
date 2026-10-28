import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { getInstituteId } from '@/constants/helper';
import {
    approveEmailTemplate,
    archiveEmailTemplate,
    editEmailTemplate,
    generateEmailTemplates,
    generateWhatsAppTemplates,
    getBriefCheck,
    listEmailTemplates,
    previewEmailTemplate,
    requestWhatsAppAlternatives,
} from '../-services/templates';
import type {
    EmailTemplateEditRequest,
    EmailTemplateGenerateRequest,
    GenerateMode,
    GenerateOptions,
} from '../-types/templates';

/** A VacademyException body carries its text in `ex`. */
const errMsg = (e: unknown, fallback: string): string => {
    const anyErr = e as { response?: { data?: { ex?: string; message?: string } }; message?: string };
    return anyErr?.response?.data?.ex || anyErr?.response?.data?.message || anyErr?.message || fallback;
};

// ---- WhatsApp generate (options + regenerate / more like this) ----
export const useWhatsAppGenerate = () => {
    const { t } = useTranslation('engagementEnginesTemplates');
    const qc = useQueryClient();
    const instituteId = getInstituteId() || '';
    const invalidate = (engineId: string) => {
        qc.invalidateQueries({ queryKey: ['engagementTemplates', instituteId, engineId] });
        qc.invalidateQueries({ queryKey: ['engagementEngine', instituteId, engineId] });
    };
    return {
        generate: useMutation({
            mutationFn: ({ engineId, options }: { engineId: string; options: GenerateOptions }) =>
                generateWhatsAppTemplates(engineId, instituteId, options),
            onSuccess: (_d, v) => {
                invalidate(v.engineId);
                toast.success(t('toast.generated'));
            },
            onError: (e) => toast.error(errMsg(e, t('toast.generateFailed'))),
        }),
        alternatives: useMutation({
            mutationFn: ({
                engineId,
                mode,
                options,
            }: {
                engineId: string;
                mode: GenerateMode;
                options: GenerateOptions & { basedOnId?: string };
            }) => requestWhatsAppAlternatives(engineId, instituteId, mode, options),
            onSuccess: (_d, v) => {
                invalidate(v.engineId);
                toast.success(v.mode === 'REGENERATE' ? t('toast.regenerated') : t('toast.generated'));
            },
            onError: (e) => toast.error(errMsg(e, t('toast.generateFailed'))),
        }),
    };
};

/** W1 brief check; refreshed whenever the brief changes (amendments invalidate the engine). */
export const useBriefCheck = (engineId: string | undefined, enabled = true) => {
    const instituteId = getInstituteId() || '';
    return useQuery({
        queryKey: ['engagementBriefCheck', instituteId, engineId],
        queryFn: () => getBriefCheck(engineId as string, instituteId),
        enabled: enabled && !!engineId && !!instituteId,
        staleTime: 60 * 1000,
    });
};

// ---- Email templates ----
export const useEmailTemplates = (engineId: string | undefined) => {
    const instituteId = getInstituteId() || '';
    return useQuery({
        queryKey: ['engagementEmailTemplates', instituteId, engineId],
        queryFn: () => listEmailTemplates(engineId as string, instituteId),
        enabled: !!engineId && !!instituteId,
    });
};

export const useEmailTemplatePreview = (id: string | undefined) => {
    const instituteId = getInstituteId() || '';
    return useQuery({
        queryKey: ['engagementEmailTemplatePreview', instituteId, id],
        queryFn: () => previewEmailTemplate(id as string, instituteId),
        enabled: !!id && !!instituteId,
    });
};

export const useEmailTemplateMutation = () => {
    const { t } = useTranslation('engagementEnginesTemplates');
    const qc = useQueryClient();
    const instituteId = getInstituteId() || '';
    const invalidate = (engineId: string) => {
        qc.invalidateQueries({ queryKey: ['engagementEmailTemplates', instituteId, engineId] });
        qc.invalidateQueries({ queryKey: ['engagementEmailTemplatePreview', instituteId] });
    };
    return {
        generate: useMutation({
            mutationFn: ({ engineId, payload }: { engineId: string; payload: EmailTemplateGenerateRequest }) =>
                generateEmailTemplates(engineId, instituteId, payload),
            onSuccess: (_d, v) => {
                invalidate(v.engineId);
                toast.success(v.payload.mode === 'REGENERATE' ? t('toast.regenerated') : t('toast.generated'));
            },
            onError: (e) => toast.error(errMsg(e, t('toast.generateFailed'))),
        }),
        edit: useMutation({
            mutationFn: ({ id, payload }: { id: string; engineId: string; payload: EmailTemplateEditRequest }) =>
                editEmailTemplate(id, instituteId, payload),
            onSuccess: (_d, v) => {
                invalidate(v.engineId);
                toast.success(t('toast.saved'));
            },
            onError: (e) => toast.error(errMsg(e, t('toast.saveFailed'))),
        }),
        approve: useMutation({
            mutationFn: ({ id }: { id: string; engineId: string }) => approveEmailTemplate(id, instituteId),
            onSuccess: (_d, v) => {
                invalidate(v.engineId);
                toast.success(t('toast.approved'));
            },
            onError: (e) => toast.error(errMsg(e, t('toast.approveFailed'))),
        }),
        archive: useMutation({
            mutationFn: ({ id }: { id: string; engineId: string }) => archiveEmailTemplate(id, instituteId),
            onSuccess: (_d, v) => {
                invalidate(v.engineId);
                toast.success(t('toast.archived'));
            },
            onError: (e) => toast.error(errMsg(e, t('toast.archiveFailed'))),
        }),
    };
};
