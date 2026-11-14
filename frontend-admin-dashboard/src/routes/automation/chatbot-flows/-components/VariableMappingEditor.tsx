import { useCallback, useEffect, useState } from 'react';
import { Plus, Trash } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { VariableMapping, VariableMappingSource } from '@/types/chatbot-flow/chatbot-flow-types';
import { CustomFieldOption, fetchInstituteCustomFields } from '../-services/chatbot-flow-api';
import { getInstituteId } from '@/constants/helper';

/**
 * System (user) fields that can be mapped as placeholder values. The value is
 * the JSON key on the admin-core-service `UserDTO` snake_case serialization,
 * which is what the notification_service receives from `/internal/user/by-phone`.
 */
function buildSystemFieldOptions(t: TFunction): Array<{ key: string; label: string }> {
    return [
        { key: 'full_name', label: t('systemFields.fullName') },
        { key: 'email', label: t('systemFields.email') },
        { key: 'mobile_number', label: t('systemFields.mobileNumber') },
        { key: 'username', label: t('systemFields.username') },
        { key: 'id', label: t('systemFields.userId') },
        { key: 'date_of_birth', label: t('systemFields.dateOfBirth') },
        { key: 'gender', label: t('systemFields.gender') },
        { key: 'address_line', label: t('systemFields.address') },
        { key: 'city', label: t('systemFields.city') },
        { key: 'region', label: t('systemFields.region') },
        { key: 'pin_code', label: t('systemFields.pinCode') },
    ];
}

function buildSourceOptions(t: TFunction): Array<{ value: VariableMappingSource; label: string }> {
    return [
        { value: 'SYSTEM_FIELD', label: t('sources.systemField') },
        { value: 'CUSTOM_FIELD', label: t('sources.customField') },
        { value: 'SESSION', label: t('sources.session') },
        { value: 'CONTEXT', label: t('sources.context') },
        { value: 'FIXED', label: t('sources.fixed') },
    ];
}

// Cache shared across mounts so switching nodes doesn't re-fetch every time.
let customFieldCache: { instituteId: string; data: CustomFieldOption[] } | null = null;

interface VariableMappingEditorProps {
    variables: VariableMapping[];
    onChange: (next: VariableMapping[]) => void;
}

export function VariableMappingEditor({ variables, onChange }: VariableMappingEditorProps) {
    const { t } = useTranslation('automationVariableMappingEditor');
    const SYSTEM_FIELD_OPTIONS = buildSystemFieldOptions(t);
    const SOURCE_OPTIONS = buildSourceOptions(t);
    const instituteId = getInstituteId() || '';
    const [customFields, setCustomFields] = useState<CustomFieldOption[]>(
        customFieldCache?.instituteId === instituteId && customFieldCache.data.length > 0
            ? customFieldCache.data
            : []
    );
    const [loadingCustom, setLoadingCustom] = useState(false);
    const [loadError, setLoadError] = useState<string | null>(null);

    const needsCustomFields = variables.some((v) => v.source === 'CUSTOM_FIELD');

    const loadCustomFields = useCallback(async () => {
        if (!instituteId) {
            setLoadError(t('noInstituteId'));
            return;
        }
        // Only treat the cache as warm when it has actual data — empty/failed
        // results should NOT poison subsequent attempts.
        if (customFieldCache?.instituteId === instituteId && customFieldCache.data.length > 0) {
            setCustomFields(customFieldCache.data);
            return;
        }
        setLoadingCustom(true);
        setLoadError(null);
        try {
            const data = await fetchInstituteCustomFields(instituteId);
            // eslint-disable-next-line no-console
            console.debug('[VariableMappingEditor] Loaded custom fields:', data);
            if (data.length > 0) {
                customFieldCache = { instituteId, data };
            }
            setCustomFields(data);
        } catch (e) {
            // eslint-disable-next-line no-console
            console.error('[VariableMappingEditor] Failed to load custom fields:', e);
            setLoadError(e instanceof Error ? e.message : t('loadCustomFieldsFailed'));
            setCustomFields([]);
        } finally {
            setLoadingCustom(false);
        }
    }, [instituteId, t]);

    useEffect(() => {
        if (needsCustomFields) loadCustomFields();
    }, [needsCustomFields, loadCustomFields]);

    const updateRow = (idx: number, patch: Partial<VariableMapping>) => {
        const next = variables.map((v, i) => (i === idx ? { ...v, ...patch } : v));
        onChange(next);
    };

    const addRow = () => {
        onChange([...variables, { name: '', source: 'SYSTEM_FIELD', field: '', defaultValue: '' }]);
    };

    const removeRow = (idx: number) => {
        onChange(variables.filter((_, i) => i !== idx));
    };

    return (
        <div className="space-y-2">
            {variables.length === 0 && (
                <p className="text-xs italic text-gray-400">
                    {t('emptyState', { placeholder: '{{placeholder}}' })}
                </p>
            )}

            {variables.map((v, idx) => (
                <div key={idx} className="space-y-1 rounded border bg-white p-2">
                    <div className="flex items-center gap-1">
                        <span className="shrink-0 text-xs text-gray-400">{`{{`}</span>
                        <input
                            type="text"
                            value={v.name}
                            onChange={(e) => updateRow(idx, { name: e.target.value })}
                            placeholder={t('placeholderName')}
                            className="flex-1 rounded border px-1.5 py-1 font-mono text-xs"
                        />
                        <span className="shrink-0 text-xs text-gray-400">{`}}`}</span>
                        <button
                            onClick={() => removeRow(idx)}
                            className="p-1 text-red-500 hover:text-red-700"
                            title={t('remove')}
                        >
                            <Trash size={14} />
                        </button>
                    </div>

                    <select
                        value={v.source}
                        onChange={(e) =>
                            updateRow(idx, {
                                source: e.target.value as VariableMappingSource,
                                field: '',
                            })
                        }
                        className="w-full rounded border px-1.5 py-1 text-xs"
                    >
                        {SOURCE_OPTIONS.map((o) => (
                            <option key={o.value} value={o.value}>
                                {o.label}
                            </option>
                        ))}
                    </select>

                    {v.source === 'SYSTEM_FIELD' && (
                        <select
                            value={v.field}
                            onChange={(e) => updateRow(idx, { field: e.target.value })}
                            className="w-full rounded border px-1.5 py-1 text-xs"
                        >
                            <option value="">{t('selectSystemField')}</option>
                            {SYSTEM_FIELD_OPTIONS.map((o) => (
                                <option key={o.key} value={o.key}>
                                    {o.label}
                                </option>
                            ))}
                        </select>
                    )}

                    {v.source === 'CUSTOM_FIELD' && (
                        <>
                            <select
                                value={v.field}
                                onChange={(e) => updateRow(idx, { field: e.target.value })}
                                className="w-full rounded border px-1.5 py-1 text-xs"
                            >
                                <option value="">
                                    {loadingCustom ? t('loadingCustomFields') : t('selectCustomField')}
                                </option>
                                {customFields.map((cf) => (
                                    <option key={cf.id} value={cf.fieldName}>
                                        {t('customFieldOption', { name: cf.fieldName, type: cf.fieldType })}
                                    </option>
                                ))}
                            </select>
                            {!loadingCustom && customFields.length === 0 && (
                                <div className="space-y-1">
                                    <p className="text-[10px] text-gray-400">
                                        {loadError
                                            ? t('loadError', { message: loadError })
                                            : t('noCustomFieldsFound')}
                                    </p>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            customFieldCache = null;
                                            loadCustomFields();
                                        }}
                                        className="text-[10px] text-blue-600 hover:text-blue-800"
                                    >
                                        {t('retry')}
                                    </button>
                                </div>
                            )}
                        </>
                    )}

                    {(v.source === 'SESSION' || v.source === 'CONTEXT' || v.source === 'FIXED') && (
                        <input
                            type="text"
                            value={v.field}
                            onChange={(e) => updateRow(idx, { field: e.target.value })}
                            placeholder={
                                v.source === 'FIXED'
                                    ? t('fieldPlaceholder.fixed')
                                    : v.source === 'CONTEXT'
                                      ? t('fieldPlaceholder.context')
                                      : t('fieldPlaceholder.session')
                            }
                            className="w-full rounded border px-1.5 py-1 font-mono text-xs"
                        />
                    )}

                    <input
                        type="text"
                        value={v.defaultValue}
                        onChange={(e) => updateRow(idx, { defaultValue: e.target.value })}
                        placeholder={t('defaultValuePlaceholder')}
                        className="w-full rounded border px-1.5 py-1 text-xs"
                    />
                </div>
            ))}

            <button
                onClick={addRow}
                className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800"
            >
                <Plus size={12} /> {t('addVariable')}
            </button>
        </div>
    );
}
