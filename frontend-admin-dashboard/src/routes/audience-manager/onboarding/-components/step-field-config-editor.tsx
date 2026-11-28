/**
 * StepFieldConfigEditor — the per-step FORM field picker: attach an existing
 * institute custom field OR create a new one inline (mirrors
 * CampaignCustomFieldsCard's UX, adapted to the onboarding step's
 * `fields: OnboardingStepFieldConfig[]` shape), reorder, and set
 * order/mandatory/hidden + per-field ADMIN/STUDENT/PARENT role access.
 */
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Sortable, SortableDragHandle, SortableItem } from '@/components/ui/sortable';
import { MyButton } from '@/components/design-system/button';
import { Switch } from '@/components/ui/switch';
import { DotsSixVertical, Plus, TrashSimple, CaretDown, CaretUp } from '@phosphor-icons/react';
import { MultiSelect } from '@/components/design-system/multi-select';
import {
    AddCustomFieldDialog,
    type DropdownOption,
    type CustomFieldConfig,
} from '@/components/common/custom-fields/AddCustomFieldDialog';
import { buildConfigJson, type CustomFieldType } from '@/services/custom-field-settings';
import { RoleAccessGrid } from './role-access-grid';
import {
    defaultRoleAccess,
    type InstituteCustomFieldDTO,
    type OnboardingAssignableRole,
    type OnboardingStepFieldConfig,
} from '../-services/onboarding-service';

// Local editing row — carries an id (either the existing config id, or a
// generated key for a brand-new one) so Sortable/React keys stay stable.
export interface FieldRow extends OnboardingStepFieldConfig {
    _rowId: string;
    _displayName: string;
}

let nextTempId = 1;

export function newFieldRowFromCatalog(field: InstituteCustomFieldDTO, t: TFunction): FieldRow {
    return {
        _rowId: `catalog-${field.id}`,
        _displayName: field.custom_field?.fieldName ?? t('untitledField'),
        institute_custom_field_id: field.id,
        is_mandatory: false,
        is_hidden: false,
        // No role_access here (deliberately) -- see addNewField's comment.
    };
}

interface StepFieldConfigEditorProps {
    instituteId: string;
    catalog: InstituteCustomFieldDTO[];
    /**
     * Institute roles the per-field "Access" panel may grant to, beyond the built-in
     * ADMIN/STUDENT/PARENT — so one field of a step can be singled out for a COUNSELLOR even
     * when the step as a whole isn't.
     */
    assignableRoles?: OnboardingAssignableRole[];
    value: FieldRow[];
    onChange: (rows: FieldRow[]) => void;
    /**
     * Reports whether the picker has field(s) selected but not yet attached
     * (the "Attach" button hasn't been clicked). The parent step dialog uses
     * this to warn before saving, since a selection sitting in the picker is
     * otherwise silently lost on save.
     */
    onPendingSelectionChange?: (hasPending: boolean) => void;
}

export function StepFieldConfigEditor({
    catalog,
    assignableRoles = [],
    value,
    onChange,
    onPendingSelectionChange,
}: StepFieldConfigEditorProps) {
    const { t } = useTranslation('audienceManagerStepFieldConfigEditor');
    const [expandedRowId, setExpandedRowId] = useState<string | null>(null);
    const [pickerValues, setPickerValues] = useState<string[]>([]);

    useEffect(() => {
        onPendingSelectionChange?.(pickerValues.length > 0);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [pickerValues]);

    const attachedCatalogIds = useMemo(
        () => new Set(value.map((r) => r.institute_custom_field_id).filter(Boolean)),
        [value]
    );
    const availableCatalogFields = useMemo(
        () => catalog.filter((f) => !attachedCatalogIds.has(f.id)),
        [catalog, attachedCatalogIds]
    );
    const availableCatalogOptions = useMemo(
        () =>
            availableCatalogFields.map((f) => ({
                label: f.custom_field?.fieldName ?? t('untitledField'),
                value: f.id,
            })),
        [availableCatalogFields, t]
    );

    const move = (activeIndex: number, overIndex: number) => {
        const next = [...value];
        const [moved] = next.splice(activeIndex, 1);
        if (!moved) return;
        next.splice(overIndex, 0, moved);
        onChange(next);
    };

    const updateRow = (rowId: string, patch: Partial<FieldRow>) => {
        onChange(value.map((r) => (r._rowId === rowId ? { ...r, ...patch } : r)));
    };

    const removeRow = (rowId: string) => {
        onChange(value.filter((r) => r._rowId !== rowId));
    };

    const attachExisting = () => {
        if (pickerValues.length === 0) return;
        const newRows = pickerValues
            .map((id) => catalog.find((f) => f.id === id))
            .filter((f): f is InstituteCustomFieldDTO => !!f)
            .map((f) => newFieldRowFromCatalog(f, t));
        onChange([...value, ...newRows]);
        setPickerValues([]);
    };

    const addNewField = (
        type: string,
        name: string,
        _oldKey: boolean,
        options?: DropdownOption[],
        config?: CustomFieldConfig
    ) => {
        // AddCustomFieldDialog reports 'text' as the legacy 'textfield' string
        // (a CampaignCustomFieldsCard-era quirk) — normalize back to the
        // backend's CustomFieldType before building the payload.
        const normalizedType: CustomFieldType = (type === 'textfield' ? 'text' : type) as CustomFieldType;
        const configJson = buildConfigJson(
            options?.map((o) => o.value),
            config?.defaultValue,
            config
        );
        const rowId = `new-${nextTempId++}`;
        const row: FieldRow = {
            _rowId: rowId,
            _displayName: name,
            new_field: {
                field_name: name,
                field_type: normalizedType,
                default_value: config?.defaultValue,
                config: configJson,
            },
            is_mandatory: false,
            is_hidden: false,
            // Deliberately no role_access: the backend treats a field with NO role_access
            // entry for a role as "inherit the step-level default" (OnboardingRoleAccessResolutionService
            // .resolveFieldAccess falls back to resolveStepAccess). Stamping defaultRoleAccess()
            // here unconditionally -- which this used to do -- silently attached an explicit
            // STUDENT/PARENT can_edit=false override to EVERY field the moment it's attached,
            // even if the admin never opened this field's own "Access" panel. That override then
            // took precedence over whatever the admin set in the step's own Step Access grid,
            // so a step explicitly marked "Student: View + Edit" still blocked the student on
            // every field within it. role_access should only be set here once the admin actually
            // opens "Access" and touches a checkbox (RoleAccessGrid's onChange below).
        };
        onChange([...value, row]);
    };

    return (
        <div className="flex flex-col gap-3">
            <Sortable
                value={value.map((r) => ({ id: r._rowId }))}
                onMove={({ activeIndex, overIndex }) => move(activeIndex, overIndex)}
            >
                <div className="flex flex-col gap-2">
                    {value.map((row) => {
                        const expanded = expandedRowId === row._rowId;
                        return (
                            <SortableItem key={row._rowId} value={row._rowId} asChild>
                                <div className="rounded-lg border border-neutral-200 bg-neutral-50">
                                    <div className="flex items-center gap-3 px-3 py-2">
                                        <SortableDragHandle
                                            variant="ghost"
                                            size="icon"
                                            className="cursor-grab"
                                        >
                                            <DotsSixVertical size={18} />
                                        </SortableDragHandle>
                                        <span className="flex-1 truncate text-body font-medium text-neutral-800">
                                            {row._displayName}
                                            {row.new_field && (
                                                <span className="ms-2 text-caption text-neutral-400">
                                                    {t('newFieldBadge')}
                                                </span>
                                            )}
                                        </span>
                                        <label className="flex items-center gap-1.5 text-caption text-neutral-600">
                                            <Switch
                                                checked={row.is_mandatory}
                                                onCheckedChange={(v) => updateRow(row._rowId, { is_mandatory: v })}
                                            />
                                            {t('mandatoryLabel')}
                                        </label>
                                        <label className="flex items-center gap-1.5 text-caption text-neutral-600">
                                            <Switch
                                                checked={row.is_hidden}
                                                onCheckedChange={(v) => updateRow(row._rowId, { is_hidden: v })}
                                            />
                                            {t('hiddenLabel')}
                                        </label>
                                        <button
                                            type="button"
                                            className="flex items-center gap-1 text-caption font-medium text-primary-600"
                                            onClick={() => setExpandedRowId(expanded ? null : row._rowId)}
                                        >
                                            {t('accessButton')} {expanded ? <CaretUp size={14} /> : <CaretDown size={14} />}
                                        </button>
                                        <MyButton
                                            type="button"
                                            scale="small"
                                            buttonType="secondary"
                                            className="min-w-6 !rounded-sm !p-0"
                                            onClick={() => removeRow(row._rowId)}
                                        >
                                            <TrashSimple className="!size-4 text-danger-500" />
                                        </MyButton>
                                    </div>
                                    {expanded && (
                                        <div className="border-t border-neutral-200 px-3 py-2.5">
                                            <RoleAccessGrid
                                                compact
                                                assignableRoles={assignableRoles}
                                                value={row.role_access ?? defaultRoleAccess()}
                                                onChange={(next) => updateRow(row._rowId, { role_access: next })}
                                            />
                                        </div>
                                    )}
                                </div>
                            </SortableItem>
                        );
                    })}
                    {value.length === 0 && (
                        <div className="rounded-lg border border-dashed border-neutral-300 p-4 text-center text-caption text-neutral-500">
                            {t('emptyState')}
                        </div>
                    )}
                </div>
            </Sortable>

            <div className="flex flex-wrap items-center gap-2">
                <MultiSelect
                    className="w-64"
                    options={availableCatalogOptions}
                    selected={pickerValues}
                    onChange={setPickerValues}
                    placeholder={
                        availableCatalogFields.length === 0
                            ? t('pickerPlaceholderEmpty')
                            : t('pickerPlaceholderDefault')
                    }
                    disabled={availableCatalogFields.length === 0}
                />
                <MyButton
                    type="button"
                    scale="small"
                    buttonType="secondary"
                    onClick={attachExisting}
                    disable={pickerValues.length === 0}
                >
                    {pickerValues.length > 1
                        ? t('attachButtonWithCount', { count: pickerValues.length })
                        : t('attachButton')}
                </MyButton>
                <AddCustomFieldDialog
                    trigger={
                        <MyButton type="button" scale="small" buttonType="secondary">
                            <Plus size={16} /> {t('createNewFieldButton')}
                        </MyButton>
                    }
                    onAddField={addNewField}
                    existingFieldNames={value.map((r) => r._displayName)}
                />
            </div>
        </div>
    );
}
