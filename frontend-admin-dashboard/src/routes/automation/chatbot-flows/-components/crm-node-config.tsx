import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { CheckCircle, Circle, ListBullets } from '@phosphor-icons/react';
import { useChatbotFlowStore } from '../-stores/chatbot-flow-store';
import {
    AskFieldOption,
    AskFieldSystemField,
    CRM_LEAD_CHECK_BRANCHES,
} from '@/types/chatbot-flow/chatbot-flow-types';
import { AskableCustomField, fetchAskableCustomFields } from '../-services/chatbot-flow-api';
import { CUSTOM_FIELD_TYPES } from '@/services/custom-field-settings';
import { useLeadStatuses } from '@/hooks/use-lead-statuses';
import { getInstituteId } from '@/constants/helper';

/*
 * Config panels for the CRM lead-capture nodes (CRM_LEAD_CHECK, ASK_FIELD, SAVE_TO_CRM).
 * Rendered by NodeConfigPanel; kept in their own file so the panel stays navigable. Styling
 * mirrors the other node panels in node-config-panel.tsx.
 */

type OnConfigChange = (keyOrBatch: string | Record<string, unknown>, value?: unknown) => void;

interface CrmConfigProps {
    config: Record<string, unknown>;
    onChange: OnConfigChange;
    nodeId: string;
}

const INPUT_CLASS = 'w-full px-2 py-1.5 text-sm border rounded';

function SectionLabel({ children }: { children: React.ReactNode }) {
    return (
        <label className="block text-xs font-semibold uppercase tracking-wider text-gray-500">
            {children}
        </label>
    );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
    return <label className="mt-2 block text-xs font-medium text-gray-600">{children}</label>;
}

function Hint({ children }: { children: React.ReactNode }) {
    return <p className="mt-1 text-xs text-gray-400">{children}</p>;
}

// ==================== CRM_LEAD_CHECK ====================

export function CrmLeadCheckConfig({ config, onChange, nodeId }: CrmConfigProps) {
    const { t } = useTranslation('automationNodeConfigPanel');
    const edges = useChatbotFlowStore((s) => s.edges);

    const branchLabels: Record<string, string> = {
        NEW: t('crmLeadCheck.branchNew'),
        EXISTING: t('crmLeadCheck.branchExisting'),
    };
    const outputs = CRM_LEAD_CHECK_BRANCHES.map((b) => ({
        id: b.id,
        label: branchLabels[b.id] ?? b.label,
        connected: edges.some((e) => e.source === nodeId && e.sourceHandle === b.id),
    }));
    const allConnected = outputs.every((o) => o.connected);

    return (
        <>
            <SectionLabel>{t('crmLeadCheck.sectionLabel')}</SectionLabel>
            <p className="text-xs text-gray-400">{t('crmLeadCheck.hint')}</p>

            <FieldLabel>{t('crmLeadCheck.outputsLabel')}</FieldLabel>
            <div className="divide-y rounded border bg-white">
                {outputs.map((o) => (
                    <div
                        key={o.id}
                        className="flex items-center justify-between px-2 py-1.5 text-xs"
                    >
                        <span className="font-medium text-gray-700">{o.label}</span>
                        {o.connected ? (
                            <span className="inline-flex items-center gap-1 text-success-600">
                                <CheckCircle size={12} weight="fill" />{' '}
                                {t('crmLeadCheck.connected')}
                            </span>
                        ) : (
                            <span className="inline-flex items-center gap-1 text-gray-400">
                                <Circle size={12} /> {t('crmLeadCheck.notConnected')}
                            </span>
                        )}
                    </div>
                ))}
            </div>
            {!allConnected && (
                <div className="mt-1 rounded border border-warning-200 bg-warning-50 p-2 text-xs text-warning-700">
                    {t('crmLeadCheck.connectBothNotice')}
                </div>
            )}

            <SectionLabel>{t('crmLeadCheck.existingSectionLabel')}</SectionLabel>
            <FieldLabel>{t('crmLeadCheck.existingMessageLabel')}</FieldLabel>
            <textarea
                value={(config.existingMessage as string) || ''}
                onChange={(e) => onChange('existingMessage', e.target.value)}
                className={`${INPUT_CLASS} h-20 resize-y`}
                placeholder={t('crmLeadCheck.existingMessagePlaceholder')}
            />
            <Hint>{t('crmLeadCheck.blankSendsNothing')}</Hint>

            <label className="mt-2 flex cursor-pointer items-center gap-2">
                <input
                    type="checkbox"
                    checked={config.notifyTeam !== false}
                    onChange={(e) => onChange('notifyTeam', e.target.checked)}
                    className="rounded"
                />
                <span className="text-sm">{t('crmLeadCheck.notifyTeamLabel')}</span>
            </label>
            <Hint>{t('crmLeadCheck.notifyTeamHint')}</Hint>
        </>
    );
}

// ==================== ASK_FIELD ====================

/** Lead fields that are not custom fields. fieldType is what the engine validates against. */
function buildSystemFields(
    t: TFunction
): Array<{ key: AskFieldSystemField; label: string; fieldType: string }> {
    return [
        { key: 'full_name', label: t('askField.systemFields.fullName'), fieldType: 'text' },
        { key: 'email', label: t('askField.systemFields.email'), fieldType: 'email' },
    ];
}

// Custom fields that duplicate the system entries above — the lead's own name / email.
const SYSTEM_FIELD_KEYS = new Set(['full_name', 'email']);

/** WhatsApp caps reply-button titles at 20 characters and list-row titles at 24. */
const BUTTON_TITLE_MAX = 20;
const LIST_ROW_TITLE_MAX = 24;
const LIST_ROW_DESCRIPTION_MAX = 72;

/*
 * Text AskFieldNodeExecutor itself puts into the WhatsApp message. The engine sends these in
 * English whatever the admin's UI language, so the preview shows them as-is, untranslated.
 */
const ENGINE_SKIP_LABEL = 'Skip';
const ENGINE_LIST_BUTTON_DEFAULT = 'Choose';
const ENGINE_SKIP_HINT = 'Reply SKIP to skip this question.';
const ENGINE_PICK_ONE_HINT = 'Reply with the number of your choice.';
const ENGINE_PICK_MANY_HINT =
    'You can choose more than one — reply with the numbers separated by commas, e.g. 1, 3.';

type AskMode = 'text' | 'buttons' | 'list' | 'numbered';

/**
 * How AskFieldNodeExecutor sends the question. No choices: a typed reply. Multi-select: always a
 * numbered list (several numbers can be replied). Otherwise, counting Skip as a choice: ≤3 → reply
 * buttons, ≤10 → a list, more → a numbered list.
 */
function askModeFor(optionCount: number, allowSkip: boolean, multiSelect: boolean): AskMode {
    if (optionCount === 0) return 'text';
    if (multiSelect) return 'numbered';
    const choiceCount = optionCount + (allowSkip ? 1 : 0);
    if (choiceCount <= 3) return 'buttons';
    if (choiceCount <= 10) return 'list';
    return 'numbered';
}

/** Same cut the engine makes on over-long button / row titles. */
function truncateLikeEngine(value: string, max: number): string {
    return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

// Cache shared across mounts so switching between nodes doesn't re-fetch the field list.
let askableFieldCache: { instituteId: string; data: AskableCustomField[] } | null = null;

function sameOptions(a: AskFieldOption[], b: AskFieldOption[]): boolean {
    return (
        a.length === b.length &&
        a.every((o, i) => o.value === b[i]?.value && o.label === b[i]?.label)
    );
}

export function AskFieldConfig({ config, onChange }: CrmConfigProps) {
    const { t } = useTranslation('automationNodeConfigPanel');
    const nodes = useChatbotFlowStore((s) => s.nodes);
    const instituteId = getInstituteId() || '';
    const systemFields = buildSystemFields(t);

    const [customFields, setCustomFields] = useState<AskableCustomField[]>(
        askableFieldCache?.instituteId === instituteId ? askableFieldCache.data : []
    );
    const [loading, setLoading] = useState(false);
    const [loadFailed, setLoadFailed] = useState(false);
    const [loaded, setLoaded] = useState(askableFieldCache?.instituteId === instituteId);

    const loadFields = useCallback(
        async (force = false) => {
            if (!instituteId) return;
            if (!force && askableFieldCache?.instituteId === instituteId) return;
            setLoading(true);
            setLoadFailed(false);
            try {
                const data = await fetchAskableCustomFields(instituteId);
                askableFieldCache = { instituteId, data };
                setCustomFields(data);
                setLoaded(true);
            } catch {
                setLoadFailed(true);
            } finally {
                setLoading(false);
            }
        },
        [instituteId]
    );

    useEffect(() => {
        loadFields();
    }, [loadFields]);

    const fieldSource = (config.fieldSource as string) || 'CUSTOM_FIELD';
    const systemField = config.systemField as string | undefined;
    const customFieldId = config.customFieldId as string | undefined;
    const fieldName = (config.fieldName as string) || '';
    const fieldType = (config.fieldType as string) || 'text';
    const options = (config.options as AskFieldOption[]) || [];
    const question = (config.question as string) || '';
    const allowSkip = (config.allowSkip as boolean) || false;
    const listButtonText = (config.listButtonText as string) ?? '';
    const maxRetries = typeof config.maxRetries === 'number' ? config.maxRetries : 2;

    const selectedValue =
        fieldSource === 'SYSTEM_FIELD' && systemField
            ? `SYSTEM_FIELD:${systemField}`
            : customFieldId
              ? `CUSTOM_FIELD:${customFieldId}`
              : '';
    const selectedCustomField =
        fieldSource === 'CUSTOM_FIELD' && customFieldId
            ? customFields.find((f) => f.id === customFieldId)
            : undefined;
    // The name/email custom fields are covered by the system entries — unless one is already picked.
    const pickableCustomFields = customFields.filter(
        (f) => !SYSTEM_FIELD_KEYS.has(f.fieldKey) || f.id === customFieldId
    );
    // A picked field not in the list: still loading, or deleted since (then warn once loaded).
    const selectedNotListed =
        fieldSource === 'CUSTOM_FIELD' && !!customFieldId && !selectedCustomField;
    const isMissingField = loaded && selectedNotListed;
    const optionsOutdated =
        !!selectedCustomField && !sameOptions(selectedCustomField.options, options);

    const defaultQuestion = (name: string) => t('askField.defaultQuestion', { field: name });

    const handlePick = (value: string) => {
        const splitAt = value.indexOf(':');
        const source = value.slice(0, splitAt);
        const key = value.slice(splitAt + 1);

        let next: Record<string, unknown> | null = null;
        if (source === 'SYSTEM_FIELD') {
            const sf = systemFields.find((f) => f.key === key);
            if (sf) {
                next = {
                    fieldSource: 'SYSTEM_FIELD',
                    systemField: sf.key,
                    customFieldId: undefined,
                    fieldName: sf.label,
                    fieldType: sf.fieldType,
                    options: [],
                };
            }
        } else if (source === 'CUSTOM_FIELD') {
            const cf = customFields.find((f) => f.id === key);
            if (cf) {
                next = {
                    fieldSource: 'CUSTOM_FIELD',
                    customFieldId: cf.id,
                    systemField: undefined,
                    fieldName: cf.fieldName,
                    fieldType: cf.fieldType,
                    options: cf.options,
                };
            }
        }
        if (!next) return;

        // Keep a question the admin wrote; replace one we generated for the previous field.
        const wasGenerated =
            !question.trim() || (!!fieldName && question === defaultQuestion(fieldName));
        onChange({
            ...next,
            question: wasGenerated ? defaultQuestion(next.fieldName as string) : question,
        });
    };

    const typeLabel = CUSTOM_FIELD_TYPES.find((ft) => ft.value === fieldType)?.label ?? fieldType;
    const optionLabels = options.map((o) => o.label);
    const isMultiSelect = fieldType === 'multi_select';
    const mode = askModeFor(optionLabels.length, allowSkip, isMultiSelect);
    // Buttons cut long titles outright; list rows carry the full text as a description.
    const hasLongChoice =
        mode === 'buttons' && optionLabels.some((c) => c.length > BUTTON_TITLE_MAX);
    const isOptionField = ['dropdown', 'radio', 'multi_select'].includes(fieldType);
    const flowHasSaveStep = nodes.some((n) => n.data?.nodeType === 'SAVE_TO_CRM');

    return (
        <>
            <SectionLabel>{t('askField.sectionLabel')}</SectionLabel>
            <p className="text-xs text-gray-400">{t('askField.hint')}</p>

            <FieldLabel>{t('askField.fieldLabel')}</FieldLabel>
            <select
                value={selectedValue}
                onChange={(e) => handlePick(e.target.value)}
                className={INPUT_CLASS}
            >
                <option value="" disabled>
                    {t('askField.fieldPlaceholder')}
                </option>
                <optgroup label={t('askField.leadDetailsGroup')}>
                    {systemFields.map((f) => (
                        <option key={f.key} value={`SYSTEM_FIELD:${f.key}`}>
                            {f.label}
                        </option>
                    ))}
                </optgroup>
                <optgroup label={t('askField.customFieldsGroup')}>
                    {pickableCustomFields.map((f) => (
                        <option key={f.id} value={`CUSTOM_FIELD:${f.id}`}>
                            {f.fieldName}
                        </option>
                    ))}
                    {/* Keep the picked field visible while loading / after it vanished, instead of blanking. */}
                    {selectedNotListed && (
                        <option value={selectedValue} disabled>
                            {isMissingField
                                ? t('askField.missingFieldOption', {
                                      field: fieldName || customFieldId,
                                  })
                                : fieldName || customFieldId}
                        </option>
                    )}
                </optgroup>
            </select>
            {loading && <Hint>{t('askField.loadingFields')}</Hint>}
            {loadFailed && (
                <p className="mt-1 text-xs text-danger-600">
                    {t('askField.loadFieldsFailed')}{' '}
                    <button type="button" onClick={() => loadFields(true)} className="underline">
                        {t('askField.retry')}
                    </button>
                </p>
            )}
            {loaded && !loadFailed && pickableCustomFields.length === 0 && (
                <Hint>{t('askField.noCustomFields')}</Hint>
            )}
            {isMissingField && (
                <div className="mt-1 rounded border border-warning-200 bg-warning-50 p-2 text-xs text-warning-700">
                    {t('askField.missingFieldNotice')}
                </div>
            )}
            {selectedValue && !isMissingField && (
                <Hint>
                    {isOptionField || fieldType === 'checkbox'
                        ? t('askField.typeWithChoices', { type: typeLabel, total: options.length })
                        : t('askField.typeOnly', { type: typeLabel })}
                </Hint>
            )}
            {isOptionField && selectedValue && options.length === 0 && !isMissingField && (
                <div className="mt-1 rounded border border-warning-200 bg-warning-50 p-2 text-xs text-warning-700">
                    {t('askField.noChoicesNotice')}
                </div>
            )}
            {optionsOutdated && (
                <div className="mt-1 rounded border border-info-200 bg-info-50 p-2 text-xs text-info-700">
                    {t('askField.choicesChangedNotice')}{' '}
                    <button
                        type="button"
                        onClick={() => onChange('options', selectedCustomField?.options ?? [])}
                        className="font-medium underline"
                    >
                        {t('askField.refreshChoices')}
                    </button>
                </div>
            )}

            <FieldLabel>{t('askField.questionLabel')}</FieldLabel>
            <textarea
                value={question}
                onChange={(e) => onChange('question', e.target.value)}
                className={`${INPUT_CLASS} h-20 resize-y`}
                placeholder={t('askField.questionPlaceholder')}
            />

            <FieldLabel>{t('askField.retryMessageLabel')}</FieldLabel>
            <input
                type="text"
                value={(config.retryMessage as string) || ''}
                onChange={(e) => onChange('retryMessage', e.target.value)}
                className={INPUT_CLASS}
                placeholder={t('askField.retryMessagePlaceholder')}
            />
            <Hint>{t('askField.retryMessageHint')}</Hint>

            <FieldLabel>{t('askField.maxRetriesLabel')}</FieldLabel>
            <input
                type="number"
                value={maxRetries}
                onChange={(e) => {
                    const n = parseInt(e.target.value, 10);
                    onChange('maxRetries', Number.isNaN(n) ? 0 : Math.min(5, Math.max(0, n)));
                }}
                className={INPUT_CLASS}
                min={0}
                max={5}
            />

            <label className="mt-2 flex cursor-pointer items-center gap-2">
                <input
                    type="checkbox"
                    checked={allowSkip}
                    onChange={(e) => onChange('allowSkip', e.target.checked)}
                    className="rounded"
                />
                <span className="text-sm">{t('askField.allowSkipLabel')}</span>
            </label>

            {mode === 'list' && (
                <>
                    <FieldLabel>{t('askField.listButtonLabel')}</FieldLabel>
                    <input
                        type="text"
                        value={listButtonText}
                        onChange={(e) => onChange('listButtonText', e.target.value)}
                        className={INPUT_CLASS}
                        maxLength={BUTTON_TITLE_MAX}
                        placeholder={ENGINE_LIST_BUTTON_DEFAULT}
                    />
                </>
            )}

            <SectionLabel>{t('askField.preview.sectionLabel')}</SectionLabel>
            <AskFieldPreview
                question={question}
                optionLabels={optionLabels}
                allowSkip={allowSkip}
                multiSelect={isMultiSelect}
                mode={mode}
                listButtonText={listButtonText.trim() || ENGINE_LIST_BUTTON_DEFAULT}
            />
            {hasLongChoice && (
                <div className="mt-1 rounded border border-warning-200 bg-warning-50 p-2 text-xs text-warning-700">
                    {t('askField.preview.longChoiceNotice', { max: BUTTON_TITLE_MAX })}
                </div>
            )}

            {!flowHasSaveStep && (
                <div className="mt-2 rounded border border-info-200 bg-info-50 p-2 text-xs text-info-700">
                    {t('askField.noSaveStepNotice')}
                </div>
            )}
        </>
    );
}

/** Read-only sketch of the WhatsApp message AskFieldNodeExecutor sends for this question. */
function AskFieldPreview({
    question,
    optionLabels,
    allowSkip,
    multiSelect,
    mode,
    listButtonText,
}: {
    question: string;
    optionLabels: string[];
    allowSkip: boolean;
    multiSelect: boolean;
    mode: AskMode;
    listButtonText: string;
}) {
    const { t } = useTranslation('automationNodeConfigPanel');
    const modeHint =
        mode === 'text'
            ? t('askField.preview.modeText')
            : mode === 'buttons'
              ? t('askField.preview.modeButtons')
              : mode === 'list'
                ? t('askField.preview.modeList')
                : multiSelect
                  ? t('askField.preview.modeMultiSelect')
                  : t('askField.preview.modeNumbered');

    return (
        <div className="rounded border bg-gray-100 p-2">
            <div className="whitespace-pre-wrap rounded-md border bg-white p-2 text-xs text-gray-700">
                {question || (
                    <span className="italic text-gray-400">{t('askField.preview.noQuestion')}</span>
                )}
                {mode === 'numbered' && (
                    <>
                        <ol className="mt-2 list-decimal ps-4">
                            {optionLabels.map((c, i) => (
                                <li key={i}>{c}</li>
                            ))}
                        </ol>
                        <p className="mt-2">
                            {multiSelect ? ENGINE_PICK_MANY_HINT : ENGINE_PICK_ONE_HINT}
                        </p>
                    </>
                )}
                {(mode === 'text' || mode === 'numbered') && allowSkip && (
                    <p className="mt-1">{ENGINE_SKIP_HINT}</p>
                )}
            </div>

            {mode === 'buttons' && (
                <div className="mt-1 flex flex-col gap-1">
                    {[...optionLabels, ...(allowSkip ? [ENGINE_SKIP_LABEL] : [])].map((c, i) => (
                        <div
                            key={i}
                            className="rounded-md border bg-white px-2 py-1 text-center text-xs font-medium text-primary-500"
                        >
                            {truncateLikeEngine(c, BUTTON_TITLE_MAX)}
                        </div>
                    ))}
                </div>
            )}

            {mode === 'list' && (
                <>
                    <div className="mt-1 flex items-center justify-center gap-1 rounded-md border bg-white py-1 text-xs font-medium text-primary-500">
                        <ListBullets size={12} />{' '}
                        {truncateLikeEngine(listButtonText, BUTTON_TITLE_MAX)}
                    </div>
                    <ul className="mt-1 divide-y rounded-md border bg-white text-xs text-gray-700">
                        {optionLabels.map((c, i) => (
                            <li key={i} className="px-2 py-1">
                                {truncateLikeEngine(c, LIST_ROW_TITLE_MAX)}
                                {c.length > LIST_ROW_TITLE_MAX && (
                                    <span className="block text-gray-400">
                                        {truncateLikeEngine(c, LIST_ROW_DESCRIPTION_MAX)}
                                    </span>
                                )}
                            </li>
                        ))}
                        {allowSkip && <li className="px-2 py-1">{ENGINE_SKIP_LABEL}</li>}
                    </ul>
                </>
            )}

            <p className="mt-1 text-xs text-gray-500">{modeHint}</p>
        </div>
    );
}

// ==================== SAVE_TO_CRM ====================

export function SaveToCrmConfig({ config, onChange }: CrmConfigProps) {
    const { t } = useTranslation('automationNodeConfigPanel');
    const { statuses, isLoading } = useLeadStatuses();

    const statusKey = (config.statusKey as string | null) || '';
    const activeStatuses = statuses
        .filter((s) => s.is_active !== false)
        .sort((a, b) => a.display_order - b.display_order);
    const isMissingStatus =
        !!statusKey && !isLoading && !activeStatuses.some((s) => s.status_key === statusKey);

    return (
        <>
            <SectionLabel>{t('saveToCrm.sectionLabel')}</SectionLabel>
            <p className="text-xs text-gray-400">{t('saveToCrm.hint')}</p>

            <FieldLabel>{t('saveToCrm.statusLabel')}</FieldLabel>
            <select
                value={statusKey}
                onChange={(e) => onChange('statusKey', e.target.value || null)}
                className={INPUT_CLASS}
                disabled={isLoading}
            >
                <option value="">
                    {isLoading ? t('saveToCrm.loadingStatuses') : t('saveToCrm.dontChange')}
                </option>
                {activeStatuses.map((s) => (
                    <option key={s.id} value={s.status_key}>
                        {s.label}
                    </option>
                ))}
                {isMissingStatus && (
                    <option value={statusKey} disabled>
                        {t('saveToCrm.missingStatusOption', { status: statusKey })}
                    </option>
                )}
            </select>
            {isMissingStatus && (
                <div className="mt-1 rounded border border-warning-200 bg-warning-50 p-2 text-xs text-warning-700">
                    {t('saveToCrm.missingStatusNotice')}
                </div>
            )}

            <FieldLabel>{t('saveToCrm.successMessageLabel')}</FieldLabel>
            <textarea
                value={(config.successMessage as string) || ''}
                onChange={(e) => onChange('successMessage', e.target.value)}
                className={`${INPUT_CLASS} h-20 resize-y`}
                placeholder={t('saveToCrm.successMessagePlaceholder')}
            />
            <Hint>{t('saveToCrm.blankSendsNothing')}</Hint>

            <label className="mt-2 flex cursor-pointer items-center gap-2">
                <input
                    type="checkbox"
                    checked={config.fireWorkflows !== false}
                    onChange={(e) => onChange('fireWorkflows', e.target.checked)}
                    className="rounded"
                />
                <span className="text-sm">{t('saveToCrm.fireWorkflowsLabel')}</span>
            </label>
            <Hint>{t('saveToCrm.fireWorkflowsHint')}</Hint>
        </>
    );
}
