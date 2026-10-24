import { useEffect, useMemo } from 'react';
import { ArrowClockwise, ArrowSquareOut, Link, WhatsappLogo } from '@phosphor-icons/react';
import { useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { MyButton } from '@/components/design-system/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectLabel,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import {
    TemplateSearchableSelect,
    toTemplateOptions,
} from '@/components/templates/TemplateSearchableSelect';
import type { WhatsAppTemplateDTO } from '@/routes/communication/whatsapp-templates/-services/template-api';
import { WHATSAPP_VALUE_GROUPS, WHATSAPP_VALUE_SOURCES } from '../../-utils/constants';
import { whatsAppHeaderKind, whatsAppVariableNames } from '../../-utils/validation';
import { EmptyState, FieldError, FieldHint, LoadFailure } from '../primitives';
import type { FieldErrors, WhatsAppConfig, WhatsAppValueSource } from '../../-types';

interface WhatsAppChannelCardProps {
    config: WhatsAppConfig;
    onChange: (patch: Partial<WhatsAppConfig>) => void;
    templates: WhatsAppTemplateDTO[];
    selectedTemplate: WhatsAppTemplateDTO | null;
    loading: boolean;
    error: string | null;
    syncing: boolean;
    /** Initial fetch — no-ops once the list has loaded. */
    onLoad: () => void;
    onReload: () => void;
    onSync: () => void;
    errors: FieldErrors;
    showErrors: boolean;
}

/**
 * Best guess at what a template variable wants, from its name. Meta templates are often authored
 * with positional names ({{1}}, {{2}}), so anything unrecognised falls back to custom text.
 */
function guessSource(name: string): WhatsAppValueSource {
    const key = name.toLowerCase();
    if (/^(full_?name)$/.test(key)) return 'RECIPIENT_FULL_NAME';
    if (/(^|_)(email)($|_)/.test(key)) return 'RECIPIENT_EMAIL';
    if (/(phone|mobile|whatsapp_?number)/.test(key)) return 'RECIPIENT_PHONE';
    if (/username/.test(key)) return 'RECIPIENT_USERNAME';
    if (/name/.test(key)) return 'RECIPIENT_NAME';
    if (/title|subject/.test(key)) return 'ANNOUNCEMENT_TITLE';
    if (/content|message|body|detail/.test(key)) return 'ANNOUNCEMENT_CONTENT';
    if (/sender|from|created/.test(key)) return 'SENDER_NAME';
    if (/date/.test(key)) return 'CURRENT_DATE';
    if (/time/.test(key)) return 'CURRENT_TIME';
    return 'CUSTOM';
}

/** Renders the template body with its `{{variables}}` picked out, so the shape is obvious. */
function TemplateBody({ text }: { text: string }) {
    const parts = text.split(/(\{\{\w+\}\})/g);
    return (
        <p className="whitespace-pre-wrap text-body text-foreground">
            {parts.map((part, index) =>
                /^\{\{\w+\}\}$/.test(part) ? (
                    <span
                        key={index}
                        className="rounded-sm bg-primary-100 px-1 font-semibold text-primary-600"
                    >
                        {part}
                    </span>
                ) : (
                    <span key={index}>{part}</span>
                )
            )}
        </p>
    );
}

export function WhatsAppChannelCard({
    config,
    onChange,
    templates,
    selectedTemplate,
    loading,
    error,
    syncing,
    onLoad,
    onReload,
    onSync,
    errors,
    showErrors,
}: WhatsAppChannelCardProps) {
    const { t } = useTranslation('announcementWhatsappChannelCard');
    const navigate = useNavigate();
    const variableNames = useMemo(
        () => whatsAppVariableNames(selectedTemplate),
        [selectedTemplate]
    );
    const headerKind = whatsAppHeaderKind(selectedTemplate);
    const err = (key: string) => (showErrors ? errors[key] : undefined);

    // This card only mounts once WhatsApp is selected, so fetching here means the list is loaded
    // however the channel got selected — toggle, preset, or a restored draft.
    useEffect(() => {
        onLoad();
    }, [onLoad]);

    // Give every variable a sensible default binding the moment a template is chosen, so the
    // common case needs no configuration at all.
    useEffect(() => {
        if (!selectedTemplate) return;
        const missing = variableNames.filter((name) => !config.variables[name]);
        if (missing.length === 0) return;
        const additions: WhatsAppConfig['variables'] = {};
        missing.forEach((name) => {
            additions[name] = { source: guessSource(name), customValue: '' };
        });
        onChange({ variables: { ...config.variables, ...additions } });
    }, [selectedTemplate, variableNames, config.variables, onChange]);

    if (loading) {
        return (
            <div className="space-y-2">
                <Skeleton className="h-9 w-full rounded-md" />
                <Skeleton className="h-24 w-full rounded-md" />
            </div>
        );
    }

    if (error) {
        return <LoadFailure message={error} onRetry={onReload} />;
    }

    if (templates.length === 0) {
        return (
            <EmptyState
                Icon={WhatsappLogo}
                title={t('empty.title')}
                description={t('empty.description')}
                action={
                    <div className="flex flex-wrap justify-center gap-2">
                        <MyButton
                            buttonType="secondary"
                            scale="small"
                            onClick={onSync}
                            disable={syncing}
                        >
                            <ArrowClockwise
                                className={cn('mr-1 size-4', syncing && 'animate-spin')}
                            />
                            {syncing ? t('action.syncing') : t('action.syncFromMeta')}
                        </MyButton>
                        <MyButton
                            buttonType="text"
                            scale="small"
                            onClick={() => navigate({ to: '/communication/whatsapp-templates' })}
                        >
                            {t('action.manageTemplates')}
                            <ArrowSquareOut className="ml-1 size-4" />
                        </MyButton>
                    </div>
                }
            />
        );
    }

    return (
        <div className="space-y-4">
            <div className="space-y-1">
                <div className="flex flex-wrap items-end justify-between gap-2">
                    <Label className="text-caption font-semibold">{t('template.label')}</Label>
                    <MyButton buttonType="text" scale="small" onClick={onSync} disable={syncing}>
                        <ArrowClockwise className={cn('mr-1 size-4', syncing && 'animate-spin')} />
                        {syncing ? t('action.syncing') : t('action.syncFromMeta')}
                    </MyButton>
                </div>
                <TemplateSearchableSelect
                    options={toTemplateOptions(templates, 'name')}
                    value={config.templateName || undefined}
                    onChange={(name) => {
                        const picked = templates.find((t) => t.name === name);
                        onChange({
                            templateName: name,
                            languageCode: picked?.language || 'en',
                            // Pre-fill with the media approved alongside the template.
                            headerUrl: picked?.headerSampleUrl ?? '',
                            variables: {},
                        });
                    }}
                    placeholder={t('template.searchPlaceholder')}
                    className={cn(err('whatsapp.template') && 'border-danger-400')}
                />
                <FieldError message={err('whatsapp.template')} />
                <FieldHint>
                    {t('template.approvedOnlyHint')}{' '}
                    {t('template.availableCount', { count: templates.length })}
                </FieldHint>
            </div>

            {selectedTemplate && (
                <div className="rounded-md border bg-muted/30 p-3">
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                        <WhatsappLogo className="size-4 text-success-600" weight="fill" />
                        <span className="text-caption font-semibold">{selectedTemplate.name}</span>
                        <span className="rounded-sm bg-primary-50 px-1.5 py-0.5 text-caption text-primary-600">
                            {selectedTemplate.category}
                        </span>
                        <span className="text-caption text-muted-foreground">
                            {selectedTemplate.language}
                        </span>
                    </div>
                    <div className="max-w-md rounded-md border border-success-400 bg-card p-3 shadow-sm">
                        {selectedTemplate.headerText && (
                            <p className="mb-1 text-body font-semibold">
                                {selectedTemplate.headerText}
                            </p>
                        )}
                        {headerKind && (
                            <p className="mb-2 rounded-sm bg-muted px-2 py-3 text-center text-caption uppercase text-muted-foreground">
                                {t('headerKind.badge', {
                                    kind: t(`headerKind.type.${headerKind}`),
                                })}
                            </p>
                        )}
                        <TemplateBody text={selectedTemplate.bodyText ?? ''} />
                        {selectedTemplate.footerText && (
                            <p className="mt-2 text-caption text-muted-foreground">
                                {selectedTemplate.footerText}
                            </p>
                        )}
                        {(selectedTemplate.buttons ?? []).length > 0 && (
                            <div className="mt-2 space-y-1 border-t pt-2">
                                {(selectedTemplate.buttons ?? []).map((button) => (
                                    <p
                                        key={button.text}
                                        className="text-center text-body text-info-600"
                                    >
                                        {button.text}
                                    </p>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            )}

            {headerKind && (
                <div className="space-y-1">
                    <Label className="text-caption font-semibold">
                        {t('headerUrl.label', { kind: t(`headerKind.type.${headerKind}`) })}
                    </Label>
                    <div className="relative">
                        <Link className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                        <Input
                            value={config.headerUrl}
                            onChange={(e) => onChange({ headerUrl: e.target.value })}
                            placeholder={t('headerUrl.placeholder', { kind: headerKind })}
                            className={cn('pl-9', err('whatsapp.headerUrl') && 'border-danger-400')}
                        />
                    </div>
                    <FieldError message={err('whatsapp.headerUrl')} />
                    <FieldHint>{t('headerUrl.requiredHint')}</FieldHint>
                </div>
            )}

            {selectedTemplate && variableNames.length > 0 && (
                <div className="space-y-2">
                    <Label className="text-caption font-semibold">
                        {t('variables.label')}
                    </Label>
                    <FieldHint>{t('variables.hint')}</FieldHint>
                    <div className="space-y-2">
                        {variableNames.map((name) => {
                            const binding = config.variables[name] ?? {
                                source: 'CUSTOM' as WhatsAppValueSource,
                                customValue: '',
                            };
                            return (
                                <div
                                    key={name}
                                    className="grid gap-2 rounded-md border bg-muted/30 p-3 sm:grid-cols-[8rem_1fr] sm:items-center"
                                >
                                    <span className="truncate rounded-sm bg-primary-100 px-1.5 py-0.5 text-caption font-semibold text-primary-600 sm:justify-self-start">
                                        {`{{${name}}}`}
                                    </span>
                                    <div className="space-y-2">
                                        <Select
                                            value={binding.source}
                                            onValueChange={(value) =>
                                                onChange({
                                                    variables: {
                                                        ...config.variables,
                                                        [name]: {
                                                            ...binding,
                                                            source: value as WhatsAppValueSource,
                                                        },
                                                    },
                                                })
                                            }
                                        >
                                            <SelectTrigger>
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {WHATSAPP_VALUE_GROUPS.map((group) => (
                                                    <SelectGroup key={group}>
                                                        <SelectLabel>{group}</SelectLabel>
                                                        {WHATSAPP_VALUE_SOURCES.filter(
                                                            (source) => source.group === group
                                                        ).map((source) => (
                                                            <SelectItem
                                                                key={source.value}
                                                                value={source.value}
                                                            >
                                                                {source.label}
                                                            </SelectItem>
                                                        ))}
                                                    </SelectGroup>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                        {binding.source === 'CUSTOM' && (
                                            <Input
                                                value={binding.customValue}
                                                onChange={(e) =>
                                                    onChange({
                                                        variables: {
                                                            ...config.variables,
                                                            [name]: {
                                                                ...binding,
                                                                customValue: e.target.value,
                                                            },
                                                        },
                                                    })
                                                }
                                                placeholder={t('variables.customValuePlaceholder', {
                                                    name,
                                                })}
                                                className={cn(
                                                    err(`whatsapp.var.${name}`) &&
                                                        'border-danger-400'
                                                )}
                                            />
                                        )}
                                        <FieldError message={err(`whatsapp.var.${name}`)} />
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}
        </div>
    );
}
