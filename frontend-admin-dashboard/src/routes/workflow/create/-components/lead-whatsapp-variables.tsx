import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';

import { LeadTemplateVariablesMapper } from '@/components/shared/leads/lead-template-variables-mapper';
import {
    decodeStoredLeadVar,
    leadVarStoredValue,
    whatsappTemplateParamSpec,
    type LeadVarChoice,
    type LeadWorkflowKind,
} from '@/components/shared/leads/lead-template-variables';
import { getCampaignById } from '@/routes/audience-manager/list/-services/get-campaign-by-id';
import { fetchCustomFieldSetup } from '@/routes/audience-manager/list/-services/get-custom-field-setup';
import { parseCustomFieldsFromJson } from '@/routes/audience-manager/list/-utils/lead-bulk-import-utils';
import type { TemplateItem } from '@/services/workflow-service';

interface LeadWhatsappVariablesProps {
    config: Record<string, unknown>;
    onConfigChange: (config: Record<string, unknown>) => void;
    kind: LeadWorkflowKind;
    /** The one lead list this node messages, when the workflow is scoped to exactly one. */
    audienceId?: string;
    instituteId: string;
    templates: TemplateItem[];
}

/**
 * The builder's variable mapping for a SEND_WHATSAPP node that messages leads —
 * the same pickers the lead list's "Configure workflow" dialog shows. Also
 * covers nodes saved without `_templateParams` (made by that dialog before it
 * wrote them, or by hand): the placeholders come from the template itself.
 *
 * Form fields come from the lead list when the workflow is scoped to one, else
 * from the institute's custom fields, which every list's form draws on.
 */
export function LeadWhatsappVariables({
    config,
    onConfigChange,
    kind,
    audienceId,
    instituteId,
    templates,
}: LeadWhatsappVariablesProps) {
    const templateName = (config.templateName as string | undefined) ?? '';
    const template = templates.find((tpl) => tpl.name === templateName);
    const storedSpec = config._templateParams;
    const paramSpec = useMemo(
        () =>
            storedSpec && typeof storedSpec === 'object' && Object.keys(storedSpec).length > 0
                ? (storedSpec as Record<string, string>)
                : whatsappTemplateParamSpec(template),
        [storedSpec, template]
    );

    const campaignQuery = useQuery({
        queryKey: ['workflow-lead-variables-campaign', instituteId, audienceId],
        queryFn: () => getCampaignById(instituteId, audienceId!),
        enabled: !!instituteId && !!audienceId,
        staleTime: 5 * 60 * 1000,
    });
    const instituteFieldsQuery = useQuery({
        queryKey: ['workflow-lead-variables-institute-fields', instituteId],
        queryFn: () => fetchCustomFieldSetup(instituteId),
        enabled: !!instituteId && !audienceId,
        staleTime: 5 * 60 * 1000,
    });

    const formFieldNames = useMemo(() => {
        const names = audienceId
            ? parseCustomFieldsFromJson(
                  campaignQuery.data?.institute_custom_fields
                      ? JSON.stringify(campaignQuery.data.institute_custom_fields)
                      : undefined
              ).map((field) => field.fieldName)
            : (instituteFieldsQuery.data ?? []).map((field) => field.field_name);
        return Array.from(new Set(names.map((name) => name?.trim()).filter(Boolean))) as string[];
    }, [audienceId, campaignQuery.data, instituteFieldsQuery.data]);
    const audienceName = campaignQuery.data?.campaign_name ?? '';

    const storedVars = (config.templateVars as Record<string, string> | undefined) ?? {};
    const choices = Object.fromEntries(
        Object.keys(paramSpec).map((key) => [
            key,
            decodeStoredLeadVar(storedVars[key], kind, formFieldNames, audienceName),
        ])
    );

    const handleChoiceChange = (key: string, choice: LeadVarChoice | undefined) => {
        onConfigChange({
            ...config,
            templateVars: {
                ...storedVars,
                [key]: choice ? leadVarStoredValue(choice, kind, audienceName) : '',
            },
            // Record the placeholders on the node, as the template picker does, so
            // the send handler skips a lead whose value comes out empty instead of
            // sending what Meta rejects.
            _templateParams: paramSpec,
        });
    };

    return (
        <LeadTemplateVariablesMapper
            className="mt-2"
            paramSpec={paramSpec}
            templateBody={template?.content}
            choices={choices}
            onChoiceChange={handleChoiceChange}
            kind={kind}
            audienceName={audienceName}
            formFieldNames={formFieldNames}
            formFieldsLoading={
                audienceId ? campaignQuery.isLoading : instituteFieldsQuery.isLoading
            }
        />
    );
}
