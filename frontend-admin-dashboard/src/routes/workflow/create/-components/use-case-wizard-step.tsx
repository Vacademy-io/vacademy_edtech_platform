/**
 * Step 4 in workflow creation: Choose a use-case template or build from scratch.
 * Shows cards for available templates based on the selected trigger event.
 * When a template is picked, shows a wizard with questions (batch dropdown, template dropdown, etc.)
 * and auto-generates the workflow nodes.
 */

import { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ArrowLeft, Wrench, Lightning, CheckCircle, ArrowRight, Sparkle } from '@phosphor-icons/react';
import type { TFunction } from 'i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { INIT_INSTITUTE, AUDIENCE_CAMPAIGNS_LIST, CREATE_MESSAGE_TEMPLATE, MESSAGE_TEMPLATE_EXISTS } from '@/constants/urls';
import { getMessageTemplates } from '@/services/message-template-service';
import { getTemplatesByTypeQuery, whatsappTemplateParamKeys, type TemplateItem } from '@/services/workflow-service';
import { useWorkflowBuilderStore } from '../-stores/workflow-builder-store';
import { declaredParamsKey, getTemplatesForTrigger, isQuestionApplicable, type UseCaseTemplate, type WizardQuestion } from './use-case-templates';
import { buildSampleTemplates } from './sample-email-templates';
import { getInstituteId } from '@/constants/helper';

// ─── Hooks for fetching dropdown options ───

function useBatchOptions(instituteId: string, t: TFunction) {
    return useQuery({
        queryKey: ['wizard-batches', instituteId],
        queryFn: async () => {
            const response = await authenticatedAxiosInstance.get(`${INIT_INSTITUTE}/${instituteId}`);
            const batches = response.data?.batches_for_sessions ?? [];
            if (!Array.isArray(batches)) return [];
            return batches.map((batch: Record<string, unknown>) => {
                const pkg = (batch.package_dto ?? {}) as Record<string, string>;
                const level = (batch.level ?? {}) as Record<string, string>;
                const session = (batch.session ?? {}) as Record<string, string>;
                return {
                    value: (batch.id as string) ?? '',
                    label: `${pkg.package_name ?? t('unknown')} - ${level.level_name ?? ''} / ${session.session_name ?? ''}`.replace(/ - \/ $/, '').replace(/ \/ $/, ''),
                };
            });
        },
        staleTime: 5 * 60 * 1000,
        enabled: !!instituteId,
    });
}

/**
 * Distinct courses (packages) for an institute, derived from the same
 * INIT_INSTITUTE response we already use for batches. Each batch carries its
 * parent package, so we dedupe on package_dto.id. No new backend endpoint needed.
 */
function usePackageOptions(instituteId: string, t: TFunction) {
    return useQuery({
        queryKey: ['wizard-packages', instituteId],
        queryFn: async () => {
            const response = await authenticatedAxiosInstance.get(`${INIT_INSTITUTE}/${instituteId}`);
            const batches = response.data?.batches_for_sessions ?? [];
            if (!Array.isArray(batches)) return [];
            const seen = new Set<string>();
            const packages: Array<{ value: string; label: string }> = [];
            for (const batch of batches as Array<Record<string, unknown>>) {
                const pkg = (batch.package_dto ?? {}) as Record<string, string>;
                const id = pkg.id;
                if (id && !seen.has(id)) {
                    seen.add(id);
                    packages.push({ value: id, label: pkg.package_name ?? t('unknownCourse') });
                }
            }
            return packages.sort((a, b) => a.label.localeCompare(b.label));
        },
        staleTime: 5 * 60 * 1000,
        enabled: !!instituteId,
    });
}

function useAudienceOptions(instituteId: string, t: TFunction) {
    return useQuery({
        queryKey: ['wizard-audiences', instituteId],
        queryFn: async () => {
            const response = await authenticatedAxiosInstance.post(AUDIENCE_CAMPAIGNS_LIST, {
                institute_id: instituteId,
                page: 0,
                size: 100,
            });
            const content = response.data?.content ?? response.data ?? [];
            if (!Array.isArray(content)) return [];
            return content.map((item: Record<string, string>) => ({
                value: item.campaign_id ?? item.id ?? '',
                label: item.campaign_name ?? item.name ?? t('unknown'),
            }));
        },
        staleTime: 5 * 60 * 1000,
        enabled: !!instituteId,
    });
}

function useEmailTemplateOptions(t: TFunction) {
    return useQuery({
        queryKey: ['wizard-email-templates'],
        queryFn: async () => {
            const result = await getMessageTemplates('EMAIL', 0, 100);
            return (result.templates ?? []).map((tmpl: { name?: string; id?: string }) => ({
                value: tmpl.name ?? tmpl.id ?? '',
                label: tmpl.name ?? t('untitled'),
            }));
        },
        staleTime: 5 * 60 * 1000,
    });
}

/**
 * Approved WhatsApp templates for this institute.
 *
 * WhatsApp templates live in notification-service (`whatsapp-templates/list`,
 * synced from Meta) — NOT in admin-core's `template` table that the paginated
 * message-template endpoint reads, which has no WHATSAPP rows and so returned
 * an always-empty list here. Reuse the same query the node-config panel uses so
 * the wizard and the visual builder offer the same names off one cache entry.
 */
function useWhatsappTemplateOptions(instituteId: string, t: TFunction) {
    const { data, isLoading } = useQuery(getTemplatesByTypeQuery(instituteId, 'WHATSAPP'));
    const options = useMemo(() => {
        const seen = new Set<string>();
        const list: Array<{ value: string; label: string; params: string[] }> = [];
        for (const tmpl of (data ?? []) as TemplateItem[]) {
            // SEND_WHATSAPP sends by template NAME, so that is the answer value.
            const value = tmpl.name ?? tmpl.id ?? '';
            if (!value || seen.has(value)) continue;
            seen.add(value);
            // Carry the declared body placeholders so the generator can trim
            // its templateVars to them — Meta rejects a mismatched count.
            list.push({ value, label: tmpl.name ?? t('untitled'), params: whatsappTemplateParamKeys(tmpl) });
        }
        return list;
    }, [data, t]);
    return { data: options, isLoading };
}

/**
 * Show the search box only once a list is long enough to need it — a filter
 * over four batches is noise, over four hundred it is the only way through.
 */
const SEARCHABLE_FROM = 8;

// ─── Question renderer ───

function QuestionField({
    question,
    value,
    onChange,
    instituteId,
    useCaseId,
}: {
    question: WizardQuestion;
    value: string | number | string[] | undefined;
    /**
     * `extras` lets a question record derived answers alongside its own value
     * — the WhatsApp picker uses it to stash the template's declared body
     * placeholders, which the generator needs and the name alone can't carry.
     */
    onChange: (val: string | number | string[], extras?: Record<string, string | number | string[]>) => void;
    instituteId: string;
    useCaseId?: string;
}) {
    const { t } = useTranslation('workflowUseCaseWizardStep');
    const { t: tSampleTemplate } = useTranslation('workflowSampleEmailTemplates');
    const sampleTemplates = useMemo(() => buildSampleTemplates(tSampleTemplate), [tSampleTemplate]);
    const { data: batchOptions = [], isLoading: batchLoading } = useBatchOptions(instituteId, t);
    const { data: packageOptions = [], isLoading: packageLoading } = usePackageOptions(instituteId, t);
    const { data: audienceOptions = [], isLoading: audienceLoading } = useAudienceOptions(instituteId, t);
    const { data: templateOptions = [], isLoading: templateLoading } = useEmailTemplateOptions(t);
    const { data: waTemplateOptions = [], isLoading: waTemplateLoading } = useWhatsappTemplateOptions(instituteId, t);
    const [creatingSample, setCreatingSample] = useState(false);
    // One box per question is enough — a question renders at most one list.
    const [search, setSearch] = useState('');
    const queryClient = useQueryClient();

    const renderDropdown = (
        options: Array<{ value: string; label: string }>,
        loading: boolean,
        placeholder: string,
        allowEmpty = false
    ) => (
        <select
            className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm shadow-sm focus:border-primary-500 focus:ring-1 focus:ring-primary-500"
            value={(value as string) ?? ''}
            onChange={(e) => onChange(e.target.value)}
        >
            <option value="">{allowEmpty ? t('dropdown.allNoRestriction') : placeholder}</option>
            {loading && <option disabled>{t('dropdown.loading')}</option>}
            {options.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
        </select>
    );

    // Multi-select checkbox list, mirrors the event-entity-picker visual style.
    // Empty selection = "all" (matches backend's CSV → empty fallback to institute-wide query).
    const renderMultiSelect = (
        options: Array<{ value: string; label: string }>,
        loading: boolean,
        emptyLabel: string,
    ) => {
        const selected: string[] = Array.isArray(value)
            ? (value as string[])
            : value
                ? [String(value)]
                : [];
        const toggle = (id: string) => {
            const next = selected.includes(id)
                ? selected.filter((s) => s !== id)
                : [...selected, id];
            onChange(next);
        };
        // Filter the list, never the selection: an institute with hundreds of
        // batches is unusable without search, but hiding an already-ticked row
        // must not untick it. `selected` stays whole, and the counter below
        // keeps reporting the true total while a search is active.
        const needle = search.trim().toLowerCase();
        const visible = needle
            ? options.filter((opt) => opt.label.toLowerCase().includes(needle))
            : options;
        return (
            <div className="space-y-2">
                {options.length > SEARCHABLE_FROM && (
                    <Input
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder={t('multiSelect.searchPlaceholder')}
                        className="h-8 text-sm"
                    />
                )}
                <div className="max-h-48 overflow-y-auto rounded-lg border border-gray-300 bg-white">
                    {loading && (
                        <div className="px-3 py-2 text-xs text-gray-400">{t('dropdown.loading')}</div>
                    )}
                    {!loading && options.length === 0 && (
                        <div className="px-3 py-2 text-xs text-gray-400">{t('dropdown.noOptions')}</div>
                    )}
                    {!loading && options.length > 0 && visible.length === 0 && (
                        <div className="px-3 py-2 text-xs text-gray-400">
                            {t('multiSelect.noMatches', { search: search.trim() })}
                        </div>
                    )}
                    {visible.map((opt) => {
                        const checked = selected.includes(opt.value);
                        return (
                            <label
                                key={opt.value}
                                className={`flex items-center gap-2.5 px-3 py-2 cursor-pointer border-b last:border-b-0 transition-colors ${
                                    checked ? 'bg-primary-50' : 'hover:bg-gray-50'
                                }`}
                            >
                                <input
                                    type="checkbox"
                                    checked={checked}
                                    onChange={() => toggle(opt.value)}
                                    className="rounded border-gray-300 text-primary-600 focus:ring-primary-500 h-4 w-4"
                                />
                                <span className="text-sm text-gray-800 truncate flex-1">{opt.label}</span>
                            </label>
                        );
                    })}
                </div>
                <p className="text-[10px] text-gray-400">
                    {selected.length === 0
                        ? emptyLabel
                        : t('multiSelect.selectedCount', { count: selected.length })}
                    {/* Say so when the filter is hiding ticked rows, so the
                        count above doesn't look wrong against what's visible. */}
                    {needle && selected.length > 0
                        && selected.some((id) => !visible.some((opt) => opt.value === id))
                        && ` — ${t('multiSelect.someHiddenBySearch')}`}
                </p>
            </div>
        );
    };

    return (
        <div className="space-y-1.5">
            <Label className="text-sm font-medium text-gray-700">
                {question.label}
                {question.required && <span className="text-red-400 ml-1">*</span>}
            </Label>
            {question.helpText && (
                <p className="text-xs text-gray-400">{question.helpText}</p>
            )}

            {question.type === 'batch_select' && renderDropdown(batchOptions, batchLoading, t('batch.selectPlaceholder'), !question.required)}
            {question.type === 'batch_multi_select' && renderMultiSelect(
                batchOptions,
                batchLoading,
                question.required
                    ? t('batch.emptyRequired')
                    : t('batch.emptyOptional')
            )}
            {question.type === 'audience_select' && renderMultiSelect(
                audienceOptions,
                audienceLoading,
                question.required
                    ? t('audience.emptyRequired')
                    : t('audience.emptyOptional')
            )}
            {question.type === 'template_select' && (() => {
                // Resolve which sample (if any) to offer for this specific
                // question. Per-question override (sampleTemplateKey) takes
                // precedence over the use-case-wide default — needed when one
                // use-case has multiple template_select questions that need
                // different samples (e.g. LIVE_SESSION_END recap: present vs absent).
                const sampleKey = question.sampleTemplateKey ?? useCaseId;
                const sample = sampleKey ? sampleTemplates[sampleKey] : undefined;
                return (
                <div className="space-y-2">
                    {renderDropdown(templateOptions, templateLoading, t('template.emailPlaceholder'))}
                    {/* Sample template option */}
                    {sample && (
                        <button
                            type="button"
                            disabled={creatingSample}
                            className="flex items-center gap-2 w-full rounded-lg border-2 border-dashed border-primary-200 bg-primary-50/50 px-3 py-2.5 text-left transition-all hover:border-primary-400 hover:bg-primary-50 disabled:opacity-50"
                            onClick={async () => {
                                if (!sample) return;
                                setCreatingSample(true);
                                try {
                                    const instId = getInstituteId();

                                    // Check if a template with this name already exists for this institute.
                                    // If yes, just use it — avoid hitting the unique-constraint 400.
                                    let alreadyExists = false;
                                    try {
                                        const existsResp = await authenticatedAxiosInstance.get(
                                            MESSAGE_TEMPLATE_EXISTS(instId ?? '', sample.name)
                                        );
                                        alreadyExists = existsResp.data?.exists === true;
                                    } catch {
                                        // If exists check fails, attempt create anyway
                                    }

                                    if (!alreadyExists) {
                                        // Convert ['fullName','username','password','instituteName']
                                        // → { fullName: 'Full Name', username: 'Username', ... }.
                                        // The workflow builder reads dynamicParameters off the
                                        // template entity to render the per-placeholder mapping
                                        // dropdowns; an empty map means "no variables to map" and
                                        // the Template Variables section won't show up at all.
                                        const dynamicParameters: Record<string, string> = {};
                                        for (const v of sample.variables ?? []) {
                                            // camelCase / snake_case → "Camel Case" / "Snake Case"
                                            const label = v
                                                .replace(/[_-]+/g, ' ')
                                                .replace(/([a-z])([A-Z])/g, '$1 $2')
                                                .replace(/\b\w/g, (c) => c.toUpperCase());
                                            dynamicParameters[v] = label;
                                        }

                                        await authenticatedAxiosInstance.post(
                                            CREATE_MESSAGE_TEMPLATE,
                                            {
                                                type: 'EMAIL',
                                                vendorId: 'default',
                                                instituteId: instId,
                                                name: sample.name,
                                                subject: sample.subject,
                                                content: sample.html,
                                                contentType: 'text/html',
                                                settingJson: {
                                                    variables: sample.variables,
                                                    isDefault: false,
                                                    templateType: 'utility',
                                                },
                                                dynamicParameters,
                                                canDelete: true,
                                                createdBy: 'current-user',
                                                updatedBy: 'current-user',
                                            }
                                        );
                                    }

                                    // Invalidate the templates list so the dropdown refreshes
                                    // and the newly-created sample appears immediately.
                                    await queryClient.invalidateQueries({
                                        queryKey: ['wizard-email-templates'],
                                    });
                                    onChange(sample.name);
                                } catch (err) {
                                    console.error('Failed to create sample template:', err);
                                    // Even if create failed (e.g. unique-key 400 from duplicate),
                                    // refresh the dropdown — the template likely already exists in DB.
                                    await queryClient.invalidateQueries({
                                        queryKey: ['wizard-email-templates'],
                                    });
                                    // Fallback: use the name anyway — it may already exist
                                    onChange(sample.name);
                                } finally {
                                    setCreatingSample(false);
                                }
                            }}
                        >
                            <Sparkle size={16} weight="fill" className="text-primary-500 shrink-0" />
                            <div className="flex-1">
                                <div className="text-xs font-semibold text-primary-700">
                                    {creatingSample ? t('template.creating') : t('template.useSample', { name: sample.name })}
                                </div>
                                <div className="text-[10px] text-primary-400 mt-0.5">
                                    {t('template.useSampleHint')}
                                </div>
                            </div>
                        </button>
                    )}
                </div>
                );
            })()}
            {question.type === 'whatsapp_template_select' && (() => {
                const selected = waTemplateOptions.find((opt) => opt.value === value);
                return (
                <div className="space-y-1">
                    {/* Not renderDropdown: picking a template also records the
                        body placeholders it declares, which the generator needs
                        to keep Meta's parameter count exact. */}
                    <select
                        className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm shadow-sm focus:border-primary-500 focus:ring-1 focus:ring-primary-500"
                        value={(value as string) ?? ''}
                        onChange={(e) => {
                            const opt = waTemplateOptions.find((o) => o.value === e.target.value);
                            onChange(e.target.value, {
                                [declaredParamsKey(question.id)]: opt?.params ?? [],
                            });
                        }}
                    >
                        <option value="">{t('template.whatsappPlaceholder')}</option>
                        {waTemplateLoading && <option disabled>{t('dropdown.loading')}</option>}
                        {waTemplateOptions.map((opt) => (
                            <option key={opt.value} value={opt.value}>{opt.label}</option>
                        ))}
                    </select>
                    {!waTemplateLoading && waTemplateOptions.length === 0 && (
                        <p className="text-caption text-gray-400">
                            {t('template.noWhatsappTemplates')}
                        </p>
                    )}
                    {selected && selected.params.length > 0 && (
                        // Meta needs a value for every declared placeholder and
                        // rejects the send if the count is off. The generator
                        // fills the ones it recognises by name; positional ones
                        // ({{1}}, {{2}}) it cannot guess without putting wrong
                        // text in front of a real person.
                        <p className="text-caption text-amber-600">
                            {t('template.whatsappVarsNeedMapping', {
                                vars: selected.params.map((p) => `{{${p}}}`).join(', '),
                            })}
                        </p>
                    )}
                </div>
                );
            })()}
            {question.type === 'live_session_select' && renderDropdown([], false, t('template.livesessionPlaceholder'), !question.required)}
            {question.type === 'invite_select' && renderDropdown([], false, t('template.invitePlaceholder'), !question.required)}

            {question.type === 'package_select' && renderDropdown(
                packageOptions,
                packageLoading,
                t('template.coursePlaceholder'),
                !question.required,
            )}

            {question.type === 'json_payload' && (() => {
                const raw = (value as string) ?? (question.defaultValue as string) ?? '';
                // Defer parse-error display until the user has stopped typing — but
                // since this is a controlled input, we validate live and show inline.
                let parseError: string | null = null;
                if (raw.trim()) {
                    try {
                        const parsed = JSON.parse(raw);
                        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
                            parseError = t('jsonPayload.invalidObject');
                        }
                    } catch (e) {
                        parseError = e instanceof Error ? e.message : 'Invalid JSON.';
                    }
                }
                return (
                    <div className="space-y-1">
                        {question.jsonPayloadHint && (
                            <p className="text-[11px] text-gray-500 leading-relaxed">{question.jsonPayloadHint}</p>
                        )}
                        <textarea
                            className={`w-full rounded-lg border bg-white px-3 py-2.5 text-xs font-mono shadow-sm focus:ring-1 ${
                                parseError
                                    ? 'border-red-300 focus:border-red-500 focus:ring-red-500'
                                    : 'border-gray-300 focus:border-primary-500 focus:ring-primary-500'
                            }`}
                            value={raw}
                            onChange={(e) => onChange(e.target.value)}
                            rows={12}
                            spellCheck={false}
                        />
                        {parseError ? (
                            <p className="text-[11px] text-red-500">{t('jsonPayload.errorPrefix', { error: parseError })}</p>
                        ) : raw.trim() ? (
                            <p className="text-[11px] text-emerald-600">{t('jsonPayload.valid')}</p>
                        ) : null}
                    </div>
                );
            })()}

            {question.type === 'select' && (
                <select
                    className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm shadow-sm"
                    value={(value as string) ?? (question.defaultValue as string) ?? ''}
                    onChange={(e) => onChange(e.target.value)}
                >
                    {(question.options ?? []).map((opt) => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                </select>
            )}

            {question.type === 'number' && (
                <Input
                    type="number"
                    value={value ?? question.defaultValue ?? ''}
                    onChange={(e) => onChange(parseInt(e.target.value) || 0)}
                    className="w-32"
                    min={0}
                />
            )}

            {question.type === 'text' && (
                <Input
                    value={(value as string) ?? ''}
                    onChange={(e) => onChange(e.target.value)}
                />
            )}
        </div>
    );
}

// ─── Main component ───

export function UseCaseWizardStep({
    onComplete,
    onAdvanced,
    onBack,
    instituteId,
}: {
    onComplete: () => void;
    onAdvanced: () => void;
    onBack: () => void;
    instituteId: string;
}) {
    const { t } = useTranslation('workflowUseCaseWizardStep');
    // Subscribing here is what makes the catalog below resolve: the template
    // titles come from the 'workflowUseCaseTemplates' namespace via the
    // i18next singleton, which only loads a namespace once something asks for
    // it. Without this the cards render their raw keys, and this re-render on
    // load is how they get replaced with real strings.
    useTranslation('workflowUseCaseTemplates');
    const { workflowType, triggerConfig, setNodes, setEdges, setWorkflowName, setWorkflowDescription, setEditingWorkflowId, setEditingWorkflowStatus } = useWorkflowBuilderStore();

    // Deliberately not memoised — a memo would capture the pre-load strings.
    const templates = getTemplatesForTrigger(triggerConfig.eventName || undefined, workflowType);

    const [selectedTemplate, setSelectedTemplate] = useState<UseCaseTemplate | null>(null);
    const [answers, setAnswers] = useState<Record<string, string | number | string[]>>({});

    // Reset answers when template changes
    useEffect(() => {
        if (selectedTemplate) {
            const defaults: Record<string, string | number | string[]> = {};
            selectedTemplate.questions.forEach((q) => {
                if (q.defaultValue !== undefined) {
                    defaults[q.id] = q.defaultValue;
                }
            });
            setAnswers(defaults);
        } else {
            setAnswers({});
        }
    }, [selectedTemplate]);

    const canGenerate = selectedTemplate
        ? selectedTemplate.questions
            // Skip required-but-hidden questions (showIf, or answered by the
            // trigger) — otherwise a hidden required question would permanently
            // block the Generate button.
            .filter((q) => q.required && isQuestionApplicable(q, answers, triggerConfig.eventName || undefined))
            .every((q) => {
                const val = answers[q.id];
                if (val === undefined) return false;
                if (Array.isArray(val)) return val.length > 0;
                // json_payload: must be non-empty AND valid JSON object.
                if (q.type === 'json_payload') {
                    if (typeof val !== 'string' || !val.trim()) return false;
                    try {
                        const parsed = JSON.parse(val);
                        return parsed && typeof parsed === 'object' && !Array.isArray(parsed);
                    } catch {
                        return false;
                    }
                }
                return val !== '' && val !== 0;
            })
        : false;

    const handleGenerate = () => {
        if (!selectedTemplate) return;
        const result = selectedTemplate.generateWorkflow(answers, triggerConfig.eventName || undefined);

        // Add routing config to connect nodes
        const nodeMap = new Map(result.nodes.map((n) => [n.id, n]));
        for (const edge of result.edges) {
            const sourceNode = nodeMap.get(edge.source);
            if (sourceNode) {
                const config = sourceNode.data.config as Record<string, unknown>;
                const routing = (config.routing as Array<Record<string, string>>) ?? [];
                routing.push({ label: '', type: 'goto', targetNodeId: edge.target });
                config.routing = routing;
            }
        }

        // Find end nodes (no outgoing edges)
        const sourcesSet = new Set(result.edges.map((e) => e.source));
        result.nodes.forEach((n) => {
            if (!sourcesSet.has(n.id)) {
                const config = n.data.config as Record<string, unknown>;
                const routing = (config.routing as Array<Record<string, string>>) ?? [];
                routing.push({ type: 'end' });
                config.routing = routing;
                n.data.isEndNode = true;
            }
        });

        // A generated draft is a NEW workflow. If the builder was opened in edit
        // mode, keeping editingWorkflowId would make Save PUT this draft over the
        // existing workflow's nodes — clear it so Save creates instead.
        setEditingWorkflowId(null);
        setEditingWorkflowStatus(null);

        setNodes(result.nodes);
        setEdges(result.edges);
        if (result.workflowName) setWorkflowName(result.workflowName);
        if (result.workflowDescription) setWorkflowDescription(result.workflowDescription);

        onComplete();
    };

    // ─── Template picker view ───
    if (!selectedTemplate) {
        return (
            <div className="space-y-6">
                <div>
                    <h2 className="text-xl font-semibold text-gray-800">{t('picker.heading')}</h2>
                    <p className="mt-1 text-sm text-gray-500">
                        {t('picker.subheading')}
                    </p>
                </div>

                {/* Template cards */}
                {templates.length > 0 && (
                    <div className="space-y-3">
                        <h3 className="text-sm font-semibold text-gray-600 uppercase tracking-wide">{t('picker.templatesForTrigger')}</h3>
                        <div className="grid grid-cols-1 gap-3">
                            {templates.map((tmpl) => (
                                <button
                                    key={tmpl.id}
                                    className="group rounded-xl border-2 border-gray-200 bg-white p-5 text-left transition-all hover:border-primary-400 hover:shadow-md"
                                    onClick={() => setSelectedTemplate(tmpl)}
                                >
                                    <div className="flex items-start gap-4">
                                        <span className="text-3xl">{tmpl.icon}</span>
                                        <div className="flex-1">
                                            <h4 className="text-base font-semibold text-gray-800 group-hover:text-primary-600 transition-colors">
                                                {tmpl.name}
                                            </h4>
                                            <p className="mt-1 text-sm text-gray-500">{tmpl.description}</p>
                                            <div className="mt-2 flex items-center gap-1.5 text-xs text-primary-500 font-medium opacity-0 group-hover:opacity-100 transition-opacity">
                                                {t('picker.useThisTemplate')} <ArrowRight size={12} />
                                            </div>
                                        </div>
                                    </div>
                                </button>
                            ))}
                        </div>
                    </div>
                )}

                {templates.length === 0 && (
                    <div className="rounded-xl border-2 border-dashed border-gray-200 bg-gray-50 p-8 text-center">
                        <p className="text-sm text-gray-500">{t('picker.noTemplates')}</p>
                        <p className="mt-1 text-xs text-gray-400">{t('picker.noTemplatesHint')}</p>
                    </div>
                )}

                {/* Divider */}
                <div className="relative">
                    <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-gray-200" /></div>
                    <div className="relative flex justify-center">
                        <span className="bg-gray-50 px-4 text-xs text-gray-400 uppercase tracking-wider">{t('picker.or')}</span>
                    </div>
                </div>

                {/* Advanced mode button */}
                <button
                    className="w-full rounded-xl border-2 border-gray-200 bg-white p-5 text-left transition-all hover:border-gray-400 hover:shadow-sm"
                    onClick={onAdvanced}
                >
                    <div className="flex items-center gap-4">
                        <div className="rounded-lg bg-gray-100 p-3">
                            <Wrench size={24} className="text-gray-500" />
                        </div>
                        <div>
                            <h4 className="text-base font-semibold text-gray-800">{t('picker.buildFromScratch')}</h4>
                            <p className="mt-0.5 text-sm text-gray-500">
                                {t('picker.buildFromScratchHint')}
                            </p>
                        </div>
                    </div>
                </button>

                <div className="flex justify-start">
                    <Button variant="outline" size="lg" onClick={onBack} className="gap-2">
                        <ArrowLeft size={16} /> {t('picker.back')}
                    </Button>
                </div>
            </div>
        );
    }

    // ─── Question wizard view ───
    const visibleQuestions = selectedTemplate.questions.filter((q) =>
        isQuestionApplicable(q, answers, triggerConfig.eventName || undefined)
    );

    return (
        <div className="space-y-6">
            <div>
                <button
                    className="flex items-center gap-1.5 text-sm text-primary-500 hover:text-primary-700 mb-3 transition-colors"
                    onClick={() => setSelectedTemplate(null)}
                >
                    <ArrowLeft size={14} /> {t('wizard.backToTemplates')}
                </button>
                <div className="flex items-center gap-3">
                    <span className="text-3xl">{selectedTemplate.icon}</span>
                    <div>
                        <h2 className="text-xl font-semibold text-gray-800">{selectedTemplate.name}</h2>
                        <p className="text-sm text-gray-500">{selectedTemplate.description}</p>
                    </div>
                </div>
            </div>

            <div className="rounded-xl border bg-white p-6 space-y-5">
                <h3 className="text-sm font-semibold text-gray-600 uppercase tracking-wide">{t('wizard.configureHeading')}</h3>

                {visibleQuestions.map((q) => (
                    <QuestionField
                        key={q.id}
                        question={q}
                        value={answers[q.id]}
                        onChange={(val, extras) => setAnswers((prev) => ({ ...prev, [q.id]: val, ...(extras ?? {}) }))}
                        instituteId={instituteId}
                        useCaseId={selectedTemplate.id}
                    />
                ))}
            </div>

            {/* Preview — auto-detect pipeline shape from template */}
            <div className="rounded-xl border border-primary-100 bg-primary-50/50 p-4">
                <h4 className="text-xs font-semibold text-primary-600 uppercase tracking-wide mb-2">{t('wizard.whatWillBeCreated')}</h4>
                <div className="flex flex-wrap items-center gap-1.5 text-sm text-primary-700">
                    {(() => {
                        // Run the generator against what the user has actually
                        // answered, falling back to defaults/placeholders only
                        // for questions still untouched. Building this purely
                        // from defaults made the preview permanently show the
                        // default channel's nodes (SEND_EMAIL) even after the
                        // user picked WhatsApp.
                        const previewAnswers: Record<string, string | number | string[]> = {};
                        selectedTemplate.questions.forEach((q) => {
                            const given = answers[q.id];
                            const hasGiven = Array.isArray(given)
                                ? given.length > 0
                                : given !== undefined && given !== '';
                            if (hasGiven) previewAnswers[q.id] = given!;
                            else if (q.defaultValue !== undefined) previewAnswers[q.id] = q.defaultValue;
                            else if (q.type === 'text') previewAnswers[q.id] = 'admin@example.com';
                            else if (q.type === 'number') previewAnswers[q.id] = 1;
                            else previewAnswers[q.id] = 'preview';
                        });
                        const preview = selectedTemplate.generateWorkflow(previewAnswers, triggerConfig.eventName || undefined);

                        const nodeColors: Record<string, string> = {
                            TRIGGER: 'bg-green-100 text-green-700',
                            QUERY: 'bg-cyan-100 text-cyan-700',
                            SEND_EMAIL: 'bg-purple-100 text-purple-700',
                            SEND_WHATSAPP: 'bg-emerald-100 text-emerald-700',
                            DELAY: 'bg-slate-100 text-slate-700',
                            CONDITION: 'bg-yellow-100 text-yellow-700',
                            FILTER: 'bg-teal-100 text-teal-700',
                        };

                        return preview.nodes.map((n, i) => (
                            <span key={n.id} className="flex items-center gap-1.5">
                                {i > 0 && <span className="text-gray-300">→</span>}
                                <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${nodeColors[n.data.nodeType as string] ?? 'bg-blue-100 text-blue-700'}`}>
                                    {(n.data.nodeType as string).replace(/_/g, ' ')}
                                </span>
                            </span>
                        ));
                    })()}
                </div>
            </div>

            <div className="flex justify-between">
                <Button variant="outline" size="lg" onClick={() => setSelectedTemplate(null)} className="gap-2">
                    <ArrowLeft size={16} /> {t('wizard.back')}
                </Button>
                <Button size="lg" onClick={handleGenerate} disabled={!canGenerate} className="gap-2 px-8">
                    <CheckCircle size={16} /> {t('wizard.generate')}
                </Button>
            </div>
        </div>
    );
}
