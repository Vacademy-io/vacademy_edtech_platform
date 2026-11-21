import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckCircle, WarningCircle } from '@phosphor-icons/react';

import { Input } from '@/components/ui/input';
import {
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectLabel,
    SelectSeparator,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';

import {
    isLeadVarComplete,
    leadVariablesFor,
    splitTemplateBody,
    type LeadVarChoice,
    type LeadVariableId,
    type LeadWorkflowKind,
} from './lead-template-variables';

const CUSTOM_TEXT_OPTION = 'text';

const encodeChoice = (choice: LeadVarChoice | undefined) => {
    if (!choice) return '';
    if (choice.source === 'text') return CUSTOM_TEXT_OPTION;
    return `${choice.source}:${choice.value}`;
};

const decodeChoice = (encoded: string): LeadVarChoice | undefined => {
    if (encoded === CUSTOM_TEXT_OPTION) return { source: 'text', value: '' };
    if (encoded.startsWith('lead:')) {
        return { source: 'lead', value: encoded.slice('lead:'.length) as LeadVariableId };
    }
    if (encoded.startsWith('form:'))
        return { source: 'form', value: encoded.slice('form:'.length) };
    return undefined;
};

interface LeadTemplateVariablesMapperProps {
    /** The template's placeholders and their labels, e.g. {"1": "Name"}. */
    paramSpec: Record<string, string>;
    /** Template body, for the live preview. No preview when absent. */
    templateBody?: string;
    choices: Record<string, LeadVarChoice | undefined>;
    onChoiceChange: (key: string, choice: LeadVarChoice | undefined) => void;
    kind: LeadWorkflowKind;
    /** The lead list's name, when the workflow belongs to exactly one. */
    audienceName?: string;
    /** The lead list's form fields (or the institute's, when the list is not known). */
    formFieldNames: string[];
    formFieldsLoading?: boolean;
    className?: string;
}

/**
 * One picker per WhatsApp template placeholder — a lead detail, a form field,
 * or fixed text — with a live preview of the message and whether it is ready.
 */
export function LeadTemplateVariablesMapper({
    paramSpec,
    templateBody,
    choices,
    onChoiceChange,
    kind,
    audienceName = '',
    formFieldNames,
    formFieldsLoading = false,
    className,
}: LeadTemplateVariablesMapperProps) {
    const { t } = useTranslation('leadTemplateVariables');
    // "Custom text" picked but nothing typed yet. A caller that stores only the
    // final value cannot hold an empty text choice, so the picker remembers it.
    const [pendingText, setPendingText] = useState<Record<string, boolean>>({});
    // A different template's {{1}} is a different variable: forget the old pick.
    const specSignature = JSON.stringify(paramSpec);
    useEffect(() => setPendingText({}), [specSignature]);

    const keys = Object.keys(paramSpec);
    const leadVariables = leadVariablesFor(kind, audienceName);
    const incomplete = keys.some((key) => !isLeadVarComplete(choices[key], kind, audienceName));

    const display = (key: string) => {
        const choice = choices[key];
        if (!choice || !isLeadVarComplete(choice, kind, audienceName)) return undefined;
        if (choice.source === 'lead') return t(`lead.${choice.value}`);
        return choice.value.trim();
    };

    const change = (key: string, choice: LeadVarChoice | undefined) => {
        setPendingText((prev) => ({ ...prev, [key]: choice?.source === 'text' }));
        onChoiceChange(key, choice);
    };

    if (keys.length === 0) return null;

    return (
        <div className={cn('space-y-3 rounded-lg border border-gray-200 p-3', className)}>
            <div className="space-y-0.5">
                <p className="text-sm font-medium text-gray-700">{t('title')}</p>
                <p className="text-2xs text-gray-400">{t('helper')}</p>
            </div>

            {templateBody && (
                <div className="space-y-1">
                    <p className="text-2xs font-medium uppercase tracking-wide text-gray-400">
                        {t('preview')}
                    </p>
                    <p
                        data-testid="whatsapp-message-preview"
                        className="whitespace-pre-wrap break-words rounded-lg bg-success-50 p-3 text-sm leading-relaxed text-gray-800"
                    >
                        {splitTemplateBody(templateBody).map((part, index) => {
                            if (part.key === undefined) return part.text;
                            const value = display(part.key);
                            return value ? (
                                <span
                                    key={index}
                                    className="rounded bg-primary-100 px-1 font-medium text-primary-600"
                                >
                                    {value}
                                </span>
                            ) : (
                                <span
                                    key={index}
                                    className="rounded bg-warning-100 px-1 font-mono text-warning-700"
                                >
                                    {part.text}
                                </span>
                            );
                        })}
                    </p>
                </div>
            )}

            <div className="divide-y divide-gray-100 rounded-md border border-gray-200">
                {keys.map((key) => {
                    const choice = choices[key];
                    const paramLabel = paramSpec[key];
                    // An actual pick always wins; the remembered "Custom text" only
                    // stands in while nothing is picked.
                    const textMode = choice ? choice.source === 'text' : !!pendingText[key];
                    return (
                        <div key={key} className="flex items-start gap-3 p-3">
                            <div className="w-24 shrink-0 space-y-1 pt-2">
                                <span className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-xs text-gray-700">
                                    {'{{'}
                                    {key}
                                    {'}}'}
                                </span>
                                {paramLabel && paramLabel !== key && (
                                    <p className="truncate text-2xs text-gray-500">{paramLabel}</p>
                                )}
                            </div>
                            <div className="min-w-0 flex-1 space-y-2">
                                <Select
                                    value={textMode ? CUSTOM_TEXT_OPTION : encodeChoice(choice)}
                                    onValueChange={(value) => change(key, decodeChoice(value))}
                                >
                                    <SelectTrigger aria-label={t('pickerLabel', { key })}>
                                        <SelectValue placeholder={t('placeholder')} />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectGroup>
                                            <SelectLabel className="text-xs text-gray-500">
                                                {t('groups.lead')}
                                            </SelectLabel>
                                            {leadVariables.map((variable) => (
                                                <SelectItem
                                                    key={variable.id}
                                                    value={`lead:${variable.id}`}
                                                >
                                                    {t(`lead.${variable.id}`)}
                                                </SelectItem>
                                            ))}
                                        </SelectGroup>
                                        <SelectSeparator />
                                        <SelectGroup>
                                            <SelectLabel className="text-xs text-gray-500">
                                                {t('groups.form')}
                                            </SelectLabel>
                                            {formFieldsLoading ? (
                                                <SelectItem value="form-loading" disabled>
                                                    {t('loadingFields')}
                                                </SelectItem>
                                            ) : formFieldNames.length === 0 ? (
                                                <SelectItem value="form-none" disabled>
                                                    {t('noFormFields')}
                                                </SelectItem>
                                            ) : (
                                                formFieldNames.map((fieldName) => (
                                                    <SelectItem
                                                        key={fieldName}
                                                        value={`form:${fieldName}`}
                                                    >
                                                        {fieldName}
                                                    </SelectItem>
                                                ))
                                            )}
                                        </SelectGroup>
                                        <SelectSeparator />
                                        <SelectItem value={CUSTOM_TEXT_OPTION}>
                                            {t('customText')}
                                        </SelectItem>
                                    </SelectContent>
                                </Select>
                                {textMode && (
                                    <Input
                                        value={choice?.source === 'text' ? choice.value : ''}
                                        onChange={(e) =>
                                            change(key, { source: 'text', value: e.target.value })
                                        }
                                        placeholder={t('customTextPlaceholder')}
                                    />
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>

            {incomplete ? (
                <p className="flex items-center gap-1.5 text-2xs text-warning-700">
                    <WarningCircle size={14} className="shrink-0" />
                    {t('incomplete')}
                </p>
            ) : (
                <p className="flex items-center gap-1.5 text-2xs text-success-700">
                    <CheckCircle size={14} weight="fill" className="shrink-0" />
                    {t('allMapped')}
                </p>
            )}
        </div>
    );
}
