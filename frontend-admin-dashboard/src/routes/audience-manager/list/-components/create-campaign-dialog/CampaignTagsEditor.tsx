import React, { useId, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, X } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { MyInput } from '@/components/design-system/input';
import { Skeleton } from '@/components/ui/skeleton';
import type { CampaignTagSummary } from '../../-services/campaign-tags';
import {
    MAX_CAMPAIGN_TAGS,
    MAX_TAG_KEY_LENGTH,
    MAX_TAG_VALUE_LENGTH,
    isSuggestedTagKey,
    newTagRowId,
    normalizeTagKey,
    type TagRow,
} from '../../-utils/campaign-tags';

interface CampaignTagsEditorProps {
    rows: TagRow[];
    onChange: (rows: TagRow[]) => void;
    /** Keys and values already used on this institute's lists, for autocomplete. */
    suggestions?: CampaignTagSummary[];
    /** The list's saved tags are still loading (edit mode). */
    isLoading?: boolean;
    /** The list's saved tags could not be loaded: editing is off and the save leaves them as they are. */
    loadFailed?: boolean;
    error?: string;
}

/**
 * Key -> value tags on a lead list (State, Course, Channel + custom keys), so CRM reports can
 * group its leads by a tag. One value per key; a blank value removes the tag on save.
 */
const CampaignTagsEditor: React.FC<CampaignTagsEditorProps> = ({
    rows,
    onChange,
    suggestions,
    isLoading,
    loadFailed,
    error,
}) => {
    const { t } = useTranslation('audienceManagerCreateCampaignForm');
    const idPrefix = useId();
    const disabled = Boolean(isLoading || loadFailed);

    const valuesByKey = useMemo(() => {
        const map = new Map<string, string[]>();
        for (const summary of suggestions ?? []) {
            map.set(summary.key, summary.values.map((v) => v.value));
        }
        return map;
    }, [suggestions]);

    // Custom keys other lists already use, offered when naming a new tag.
    const customKeySuggestions = useMemo(
        () =>
            (suggestions ?? [])
                .map((summary) => summary.key)
                .filter((key) => !isSuggestedTagKey(key)),
        [suggestions]
    );

    const filledCount = rows.filter((row) => row.value.trim() !== '').length;
    const customRowCount = rows.filter((row) => !row.suggested).length;
    const canAdd = !disabled && filledCount < MAX_CAMPAIGN_TAGS && customRowCount < MAX_CAMPAIGN_TAGS;

    const updateRow = (id: string, patch: Partial<Pick<TagRow, 'key' | 'value'>>) =>
        onChange(rows.map((row) => (row.id === id ? { ...row, ...patch } : row)));

    const removeRow = (row: TagRow) =>
        onChange(
            row.suggested
                ? rows.map((r) => (r.id === row.id ? { ...r, value: '' } : r))
                : rows.filter((r) => r.id !== row.id)
        );

    const addRow = () =>
        onChange([...rows, { id: newTagRowId(), key: '', value: '', suggested: false }]);

    const keyLabel = (key: string) =>
        isSuggestedTagKey(key) ? t(`tags.keys.${key}`) : key;

    return (
        <div className="space-y-3 rounded-lg border border-neutral-200 p-4">
            <div>
                <p className="text-sm font-semibold text-neutral-700">{t('tags.title')}</p>
                <p className="mt-1 text-xs text-neutral-500">{t('tags.description')}</p>
            </div>

            {isLoading ? (
                <div className="space-y-2">
                    {[0, 1, 2].map((i) => (
                        <Skeleton key={i} className="h-9 w-full" />
                    ))}
                </div>
            ) : (
                <div className="space-y-2">
                    {loadFailed && (
                        <p className="text-xs text-warning-700">{t('tags.loadError')}</p>
                    )}
                    {rows.map((row) => {
                        const valueListId = `${idPrefix}-values-${row.id}`;
                        const valueOptions = valuesByKey.get(normalizeTagKey(row.key)) ?? [];
                        const label = row.suggested ? keyLabel(row.key) : row.key || t('tags.newTag');
                        return (
                            <div
                                key={row.id}
                                className="flex flex-col gap-2 sm:flex-row sm:items-center"
                            >
                                <div className="shrink-0 sm:w-40">
                                    {row.suggested ? (
                                        <span className="text-sm font-medium text-neutral-700">
                                            {keyLabel(row.key)}
                                        </span>
                                    ) : (
                                        <MyInput
                                            inputType="text"
                                            size="medium"
                                            className="sm:w-full"
                                            inputPlaceholder={t('tags.keyPlaceholder')}
                                            aria-label={t('tags.keyPlaceholder')}
                                            input={row.key}
                                            maxLength={MAX_TAG_KEY_LENGTH}
                                            disabled={disabled}
                                            list={
                                                customKeySuggestions.length > 0
                                                    ? `${idPrefix}-keys`
                                                    : undefined
                                            }
                                            onChangeFunction={(e) =>
                                                updateRow(row.id, { key: e.target.value })
                                            }
                                        />
                                    )}
                                </div>
                                <div className="flex min-w-0 items-center gap-2">
                                    <div className="min-w-0 flex-1">
                                        <MyInput
                                            inputType="text"
                                            size="medium"
                                            className="sm:w-full"
                                            inputPlaceholder={t('tags.valuePlaceholder')}
                                            aria-label={t('tags.valueAriaLabel', { label })}
                                            input={row.value}
                                            maxLength={MAX_TAG_VALUE_LENGTH}
                                            disabled={disabled}
                                            list={valueOptions.length > 0 ? valueListId : undefined}
                                            onChangeFunction={(e) =>
                                                updateRow(row.id, { value: e.target.value })
                                            }
                                        />
                                        {valueOptions.length > 0 && (
                                            <datalist id={valueListId}>
                                                {valueOptions.map((value) => (
                                                    <option key={value} value={value} />
                                                ))}
                                            </datalist>
                                        )}
                                    </div>
                                    <MyButton
                                        type="button"
                                        buttonType="secondary"
                                        scale="medium"
                                        layoutVariant="icon"
                                        className="shrink-0"
                                        disabled={disabled || (row.suggested && !row.value)}
                                        title={t('tags.remove', { label })}
                                        aria-label={t('tags.remove', { label })}
                                        onClick={() => removeRow(row)}
                                    >
                                        <X className="size-4" />
                                    </MyButton>
                                </div>
                            </div>
                        );
                    })}
                    {customKeySuggestions.length > 0 && (
                        <datalist id={`${idPrefix}-keys`}>
                            {customKeySuggestions.map((key) => (
                                <option key={key} value={key} />
                            ))}
                        </datalist>
                    )}
                </div>
            )}

            {error && <p className="text-sm text-danger-600">{error}</p>}

            <MyButton
                type="button"
                buttonType="secondary"
                scale="small"
                disabled={!canAdd}
                onClick={addRow}
                className="gap-1"
            >
                <Plus className="size-3.5" />
                {t('tags.add')}
            </MyButton>
        </div>
    );
};

export default CampaignTagsEditor;
