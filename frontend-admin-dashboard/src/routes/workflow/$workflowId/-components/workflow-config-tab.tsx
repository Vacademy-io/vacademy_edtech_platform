import { useEffect, useMemo, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
    getWhatsAppTemplatesForPreviewQuery,
    getWorkflowRawQuery,
    syncWhatsAppTemplatesFromMeta,
    updateNodeTemplate,
    WorkflowRawNode,
} from '@/services/workflow-service';
import { useInstituteQuery } from '@/services/student-list-section/getInstituteDetails';
import type { TFunction } from 'i18next';
import { WORKFLOW_NODE_TYPES } from '@/types/workflow/workflow-types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { MyDropdown } from '@/components/design-system/dropdown';
import {
    FloppyDisk,
    ArrowCounterClockwise,
    CaretDown,
    CaretRight,
    CheckCircle,
    Warning,
    BracketsCurly,
    Info,
    Plus,
    Trash,
} from '@phosphor-icons/react';

/** Pretty-print a JSON string; returns the original text if it can't be parsed. */
function formatJson(raw: string | null | undefined): string {
    if (!raw || !raw.trim()) return '';
    try {
        return JSON.stringify(JSON.parse(raw), null, 2);
    } catch {
        return raw;
    }
}

/** Validate a JSON string is a JSON object. Empty is allowed (treated as "no value"). */
function jsonObjectError(
    text: string,
    { allowEmpty }: { allowEmpty: boolean },
    t: TFunction
): string | null {
    const trimmed = text.trim();
    if (!trimmed) return allowEmpty ? null : t('workflowConfigTab:errors.cannotBeEmpty');
    let parsed: unknown;
    try {
        parsed = JSON.parse(trimmed);
    } catch (e) {
        return e instanceof Error ? e.message : t('workflowConfigTab:errors.invalidJson');
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        return t('workflowConfigTab:errors.mustBeJsonObject');
    }
    return null;
}

const STATUS_OPTIONS = ['ACTIVE', 'INACTIVE', 'DRAFT'];

type OutputDataPoint = {
    fieldName?: string;
    value?: unknown;
    compute?: string;
    [key: string]: unknown;
};

/** "meetingLink" → "Meeting Link": admin-readable labels for setting names. */
function humanizeFieldName(name: string): string {
    return name
        .replace(/[_-]/g, ' ')
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Editable query params in the simple view: plain scalars, never '#' refs or SpEL. */
function isEditableQueryParam(value: unknown): boolean {
    if (typeof value === 'number' || typeof value === 'boolean') return true;
    if (typeof value !== 'string') return false;
    const trimmed = value.trim();
    return trimmed.length > 0 && !trimmed.startsWith('#') && !trimmed.startsWith("'") && !trimmed.startsWith('T(');
}

/**
 * What the simple (non-developer) view can edit on a node: plain-text settings
 * rows, literal message variables and/or scalar query knobs.
 */
function normalEditableSections(configText: string): {
    settings: boolean;
    message: boolean;
    queryParams: boolean;
} {
    try {
        const p: unknown = JSON.parse(configText);
        if (!p || typeof p !== 'object' || Array.isArray(p)) {
            return { settings: false, message: false, queryParams: false };
        }
        const cfg = p as Record<string, unknown>;
        const points = Array.isArray(cfg.outputDataPoints)
            ? (cfg.outputDataPoints as OutputDataPoint[])
            : [];
        const settings = points.some(
            (row) =>
                row.compute === undefined &&
                (typeof row.value === 'string' ||
                    isFlatStringMap(row.value) ||
                    isNestedStringMap(row.value) ||
                    isFlatObjectList(row.value))
        );
        const vars =
            cfg.templateVars && typeof cfg.templateVars === 'object' && !Array.isArray(cfg.templateVars)
                ? (cfg.templateVars as Record<string, string>)
                : null;
        // A send node counts as configurable when the admin can edit wording, and
        // as worth showing when it at least names a template (they get to read
        // what goes out, even if every value is auto-filled).
        const message =
            (!!vars && Object.values(vars).some((v) => !isAutoFilledVar(v))) ||
            typeof cfg.templateName === 'string';
        const params =
            cfg.prebuiltKey && cfg.params && typeof cfg.params === 'object' && !Array.isArray(cfg.params)
                ? (cfg.params as Record<string, unknown>)
                : null;
        const queryParams = !!params && Object.values(params).some(isEditableQueryParam);
        return { settings, message, queryParams };
    } catch {
        return { settings: false, message: false, queryParams: false };
    }
}

/**
 * Simple-view editor for a QUERY node's plain scalar knobs (e.g. how many days
 * before a charge to notify). Internal references ('#ctx…') never appear.
 */
function QueryParamsEditor({
    configText,
    onChange,
    devMode,
}: {
    configText: string;
    onChange: (next: string) => void;
    devMode: boolean;
}) {
    const { t } = useTranslation('workflowConfigTab');
    let parsed: Record<string, unknown> | null = null;
    try {
        const p: unknown = JSON.parse(configText);
        if (p && typeof p === 'object' && !Array.isArray(p)) {
            parsed = p as Record<string, unknown>;
        }
    } catch {
        // invalid JSON — raw editor shows the error
    }
    const params =
        parsed && parsed.prebuiltKey && parsed.params && typeof parsed.params === 'object' && !Array.isArray(parsed.params)
            ? (parsed.params as Record<string, unknown>)
            : null;
    if (!parsed || !params) return null;
    const cfg = parsed;
    const editable = Object.entries(params).filter(([, v]) => isEditableQueryParam(v));
    if (editable.length === 0) return null;

    const writeParam = (key: string, raw: string) => {
        const previous = params[key];
        let next: unknown = raw;
        if (typeof previous === 'number') {
            const parsedNumber = Number(raw);
            next = Number.isNaN(parsedNumber) ? raw : parsedNumber;
        } else if (typeof previous === 'boolean') {
            next = raw.trim().toLowerCase() === 'true';
        }
        onChange(
            JSON.stringify({ ...cfg, params: { ...params, [key]: next } }, null, 2)
        );
    };

    return (
        <div className="rounded-md border border-neutral-200 bg-neutral-50 p-3">
            <Label className="mb-2 block text-xs text-neutral-600">
                {t('workflowConfigTab:queryParamsEditor.label')}
                <span className="ml-1.5 text-caption text-neutral-400">
                    {t('workflowConfigTab:queryParamsEditor.hint')}
                </span>
            </Label>
            <div className="space-y-2">
                {editable.map(([key, value]) => (
                    <div key={key} className="flex items-center gap-2">
                        <span className="w-44 shrink-0 truncate text-right text-xs text-neutral-500">
                            {devMode ? key : humanizeFieldName(key)}
                        </span>
                        <Input
                            value={String(value)}
                            onChange={(e) => writeParam(key, e.target.value)}
                            spellCheck={false}
                            className="h-8 max-w-48 text-xs"
                        />
                    </div>
                ))}
            </div>
        </div>
    );
}

/**
 * True for a repeatable list of flat records — e.g. learner-screen buttons,
 * each carrying text, url and colour fields.
 */
function isFlatObjectList(value: unknown): boolean {
    if (!Array.isArray(value) || value.length === 0) return false;
    return value.every(
        (entry) =>
            entry &&
            typeof entry === 'object' &&
            !Array.isArray(entry) &&
            Object.values(entry as Record<string, unknown>).every(
                (v) => typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean'
            )
    );
}

/**
 * Repeatable-rows editor for a list of flat records (buttons, links, …). The
 * admin can edit every field, add as many rows as they like, and remove any —
 * no JSON, no developer view needed.
 */
function ObjectListEditor({
    label,
    items,
    onChange,
}: {
    label: string;
    items: Array<Record<string, string | number | boolean>>;
    onChange: (next: Array<Record<string, string | number | boolean>>) => void;
}) {
    const { t } = useTranslation('workflowConfigTab');
    const fields = Object.keys(items[0] ?? {});
    const blankRow = () =>
        fields.reduce<Record<string, string | number | boolean>>((acc, f) => {
            const sample = items[0]?.[f];
            acc[f] = typeof sample === 'boolean' ? true : typeof sample === 'number' ? 0 : '';
            return acc;
        }, {});

    return (
        <div className="rounded-md border border-neutral-200 bg-white p-2">
            <div className="mb-1 flex items-center justify-between">
                <p className="text-xs font-medium text-neutral-600">
                    {label}
                    <span className="ml-1.5 text-caption font-normal text-neutral-400">
                        {t('workflowConfigTab:objectListEditor.hint')}
                    </span>
                </p>
                <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 gap-1 text-caption text-neutral-500"
                    onClick={() => onChange([...items, blankRow()])}
                >
                    <Plus size={12} /> {t('workflowConfigTab:objectListEditor.add')}
                </Button>
            </div>
            <div className="space-y-2">
                {items.map((item, index) => (
                    <div
                        key={index}
                        className="flex flex-wrap items-center gap-2 rounded border border-neutral-100 p-2"
                    >
                        {fields.map((field) => (
                            <label key={field} className="flex items-center gap-1">
                                <span className="text-caption text-neutral-500">
                                    {humanizeFieldName(field)}
                                </span>
                                <Input
                                    value={String(item[field] ?? '')}
                                    onChange={(e) =>
                                        onChange(
                                            items.map((row, i) =>
                                                i === index
                                                    ? {
                                                          ...row,
                                                          [field]:
                                                              typeof row[field] === 'boolean'
                                                                  ? e.target.value.trim().toLowerCase() === 'true'
                                                                  : typeof row[field] === 'number'
                                                                    ? Number(e.target.value) || 0
                                                                    : e.target.value,
                                                      }
                                                    : row
                                            )
                                        )
                                    }
                                    spellCheck={false}
                                    className="h-8 w-44 text-xs"
                                />
                            </label>
                        ))}
                        <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 shrink-0 px-2 text-neutral-400 hover:text-red-600"
                            onClick={() => onChange(items.filter((_, i) => i !== index))}
                            title={t('workflowConfigTab:objectListEditor.remove')}
                        >
                            <Trash size={14} />
                        </Button>
                    </div>
                ))}
            </div>
        </div>
    );
}

/** True for a two-level map of strings: { day1: { "05:30": "url", ... }, ... } */
function isNestedStringMap(value: unknown): boolean {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const outer = Object.values(value as Record<string, unknown>);
    if (outer.length === 0) return false;
    return outer.every(
        (inner) =>
            inner &&
            typeof inner === 'object' &&
            !Array.isArray(inner) &&
            Object.values(inner as Record<string, unknown>).every((v) => typeof v === 'string')
    );
}

/** True for a one-level map of strings: { "1": "https://…", "2": "https://…" } */
function isFlatStringMap(value: unknown): boolean {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const entries = Object.values(value as Record<string, unknown>);
    if (entries.length === 0) return false;
    return entries.every((v) => typeof v === 'string');
}

/**
 * Key order for the map editors. Weekday maps (weekdayLinks, weekdayTitles) must
 * read Monday→Sunday: sorted alphabetically they come out FRI, MON, SAT, SUN, THU,
 * TUE, WED, which is meaningless to an admin filling in a week. Any non-weekday key
 * set keeps the previous natural/numeric ordering.
 */
const WEEKDAY_ORDER = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
const weekdayRank = (key: string) =>
    WEEKDAY_ORDER.indexOf(key.trim().toUpperCase().slice(0, 3));
function compareConfigKeys(a: string, b: string) {
    const ra = weekdayRank(a);
    const rb = weekdayRank(b);
    if (ra !== -1 && rb !== -1) return ra - rb;
    return a.localeCompare(b, undefined, { numeric: true });
}

/**
 * Editor for a one-level string map — a value per key, e.g. one class link per
 * trial day. Blank values are kept as keys so the row still reads as "this day
 * has no link of its own", which the workflow resolves to the fallback.
 */
function FlatMapEditor({
    label,
    map,
    onChange,
}: {
    label: string;
    map: Record<string, string>;
    onChange: (next: Record<string, string>) => void;
}) {
    const { t } = useTranslation('workflowConfigTab');
    const entries = Object.entries(map).sort(([a], [b]) => compareConfigKeys(a, b));
    const writeValue = (key: string, value: string) => onChange({ ...map, [key]: value });
    const removeKey = (key: string) => {
        const next = { ...map };
        delete next[key];
        onChange(next);
    };
    const addKey = () => {
        // Continue the numbering when keys are numeric (day 1, 2, 3…), otherwise
        // add a blank key for the admin to name.
        const numeric = entries.map(([k]) => Number(k)).filter((n) => Number.isFinite(n));
        const nextKey =
            numeric.length === entries.length && numeric.length > 0
                ? String(Math.max(...numeric) + 1)
                : '';
        if (nextKey in map) return;
        onChange({ ...map, [nextKey]: '' });
    };

    return (
        <div className="rounded-md border border-neutral-200 bg-white p-2">
            <div className="mb-1 flex items-center justify-between">
                <p className="text-xs font-medium text-neutral-600">{label}</p>
                <Button variant="outline" size="sm" className="h-7 gap-1 text-xs" onClick={addKey}>
                    <Plus size={12} />
                    {t('workflowConfigTab:flatMapEditor.add')}
                </Button>
            </div>
            <div className="space-y-1.5">
                {entries.map(([key, value]) => (
                    <div key={key} className="flex items-center gap-2">
                        <span className="w-16 shrink-0 truncate text-right text-xs text-neutral-500">
                            {key}
                        </span>
                        <Input
                            value={value}
                            onChange={(e) => writeValue(key, e.target.value)}
                            spellCheck={false}
                            className="h-8 flex-1 text-xs"
                        />
                        <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 w-8 shrink-0 p-0 text-neutral-400 hover:text-danger-500"
                            onClick={() => removeKey(key)}
                            title={t('workflowConfigTab:flatMapEditor.removeKey', { key })}
                        >
                            <Trash size={14} />
                        </Button>
                    </div>
                ))}
            </div>
        </div>
    );
}

/**
 * Grid editor for a two-level string map (e.g. the session-link schedule:
 * day 1–14 sections, each with slot → link inputs). Empty cells mean
 * "use the default link" — the workflow falls back server-side.
 */
function NestedMapGridEditor({
    label,
    grid,
    onChange,
}: {
    label: string;
    grid: Record<string, Record<string, string>>;
    onChange: (next: Record<string, Record<string, string>>) => void;
}) {
    const { t } = useTranslation('workflowConfigTab');
    const outerKeys = Object.keys(grid).sort(compareConfigKeys);
    return (
        <div className="rounded-md border border-neutral-200 bg-white p-2">
            <p className="mb-1 text-xs font-medium text-neutral-600">
                {label}
                <span className="ml-1.5 text-caption font-normal text-neutral-400">
                    {t('workflowConfigTab:nestedMapGridEditor.hint')}
                </span>
            </p>
            <div className="space-y-1">
                {outerKeys.map((outerKey) => {
                    const inner = grid[outerKey] ?? {};
                    const filled = Object.values(inner).filter(
                        (v) => v && v.trim().length > 0
                    ).length;
                    return (
                        <details key={outerKey} className="rounded border border-neutral-100">
                            <summary className="cursor-pointer px-2 py-1 text-xs text-neutral-600">
                                {outerKey}
                                <span className="ml-2 text-caption text-neutral-400">
                                    {filled > 0
                                        ? t('workflowConfigTab:nestedMapGridEditor.linksSet', { count: filled })
                                        : t('workflowConfigTab:nestedMapGridEditor.usingDefault')}
                                </span>
                            </summary>
                            <div className="space-y-1 p-2">
                                {Object.keys(inner).map((slot) => (
                                    <div key={slot} className="flex items-center gap-2">
                                        <span className="w-14 shrink-0 text-right font-mono text-xs text-neutral-500">
                                            {slot}
                                        </span>
                                        <Input
                                            value={inner[slot] ?? ''}
                                            onChange={(e) =>
                                                onChange({
                                                    ...grid,
                                                    [outerKey]: {
                                                        ...inner,
                                                        [slot]: e.target.value,
                                                    },
                                                })
                                            }
                                            placeholder={t('workflowConfigTab:nestedMapGridEditor.defaultLinkPlaceholder')}
                                            spellCheck={false}
                                            className="h-8 flex-1 text-xs"
                                        />
                                    </div>
                                ))}
                            </div>
                        </details>
                    );
                })}
            </div>
        </div>
    );
}

/**
 * Friendly editor for a node's `outputDataPoints` (the workflow's "settings" —
 * template text, links, audience lists). Reads and writes the SAME config text
 * the raw JSON editor below shows, so both stay in sync and the normal
 * validate/save flow applies. Rows with `value` are plain text; rows with
 * `compute` are SpEL expressions (marked, still editable).
 */
function OutputDataPointsEditor({
    configText,
    onChange,
    devMode,
}: {
    configText: string;
    onChange: (next: string) => void;
    devMode: boolean;
}) {
    const { t } = useTranslation('workflowConfigTab');
    let parsed: Record<string, unknown> | null = null;
    try {
        const p: unknown = JSON.parse(configText);
        if (p && typeof p === 'object' && !Array.isArray(p)) {
            parsed = p as Record<string, unknown>;
        }
    } catch {
        // Invalid JSON — the raw editor is already showing the error; hide this panel.
    }
    const points = parsed && Array.isArray(parsed.outputDataPoints)
        ? (parsed.outputDataPoints as OutputDataPoint[])
        : null;
    if (!parsed || !points) return null;

    const write = (next: OutputDataPoint[]) =>
        onChange(JSON.stringify({ ...parsed, outputDataPoints: next }, null, 2));
    const updateRow = (index: number, patch: Partial<OutputDataPoint>) =>
        write(points.map((p, i) => (i === index ? { ...p, ...patch } : p)));
    const removeRow = (index: number) => write(points.filter((_, i) => i !== index));
    const toggleMode = (index: number) => {
        const row = points[index];
        if (!row) return;
        const { value, compute, ...rest } = row;
        write(
            points.map((p, i) =>
                i === index
                    ? compute !== undefined
                        ? { ...rest, value: compute }
                        : { ...rest, compute: typeof value === 'string' ? value : '' }
                    : p
            )
        );
    };

    const renderRow = (point: OutputDataPoint, index: number) => {
        const isCompute = point.compute !== undefined;
        // Two-level string maps (e.g. a day → slot → link schedule) get a grid
        // editor; other structured values point to the raw JSON editor.
        if (!isCompute && isFlatObjectList(point.value)) {
            return (
                <ObjectListEditor
                    key={index}
                    label={
                        devMode
                            ? (point.fieldName ?? t('workflowConfigTab:outputDataPointsEditor.defaultLabelItems'))
                            : humanizeFieldName(
                                  point.fieldName ?? t('workflowConfigTab:outputDataPointsEditor.defaultLabelItems')
                              )
                    }
                    items={point.value as Array<Record<string, string | number | boolean>>}
                    onChange={(next) => updateRow(index, { value: next })}
                />
            );
        }
        if (!isCompute && isFlatStringMap(point.value)) {
            return (
                <FlatMapEditor
                    key={index}
                    label={
                        devMode
                            ? (point.fieldName ?? t('workflowConfigTab:outputDataPointsEditor.defaultLabelValues'))
                            : humanizeFieldName(
                                  point.fieldName ?? t('workflowConfigTab:outputDataPointsEditor.defaultLabelValues')
                              )
                    }
                    map={point.value as Record<string, string>}
                    onChange={(next) => updateRow(index, { value: next })}
                />
            );
        }
        if (!isCompute && isNestedStringMap(point.value)) {
            return (
                <NestedMapGridEditor
                    key={index}
                    label={
                        devMode
                            ? (point.fieldName ?? t('workflowConfigTab:outputDataPointsEditor.defaultLabelSchedule'))
                            : humanizeFieldName(
                                  point.fieldName ?? t('workflowConfigTab:outputDataPointsEditor.defaultLabelSchedule')
                              )
                    }
                    grid={point.value as Record<string, Record<string, string>>}
                    onChange={(next) => updateRow(index, { value: next })}
                />
            );
        }
        if (!isCompute && point.value !== undefined && typeof point.value !== 'string') {
            // Other structured values: dev-only pointer to the raw editor.
            if (!devMode) return null;
            return (
                <div key={index} className="flex items-center gap-2">
                    <Input
                        value={point.fieldName ?? ''}
                        readOnly
                        className="h-8 w-44 shrink-0 bg-neutral-100 font-mono text-xs"
                    />
                    <span className="text-caption text-neutral-400">
                        {t('workflowConfigTab:outputDataPointsEditor.structuredValueHint')}
                    </span>
                </div>
            );
        }
        const text = isCompute ? (point.compute ?? '') : ((point.value as string | undefined) ?? '');
        return (
            <div key={index} className="flex items-start gap-2">
                {devMode ? (
                    <Input
                        value={point.fieldName ?? ''}
                        onChange={(e) => updateRow(index, { fieldName: e.target.value })}
                        placeholder={t('workflowConfigTab:outputDataPointsEditor.fieldNamePlaceholder')}
                        spellCheck={false}
                        className="h-8 w-44 shrink-0 font-mono text-xs"
                    />
                ) : (
                    <span className="mt-2 w-44 shrink-0 truncate text-right text-xs text-neutral-500">
                        {humanizeFieldName(point.fieldName ?? '')}
                    </span>
                )}
                <Textarea
                    value={text}
                    onChange={(e) =>
                        updateRow(
                            index,
                            isCompute ? { compute: e.target.value } : { value: e.target.value }
                        )
                    }
                    spellCheck={false}
                    rows={Math.min(6, Math.max(1, Math.ceil(text.length / 80)))}
                    className={`min-h-8 flex-1 text-xs ${devMode ? 'font-mono' : ''}`}
                />
                {devMode && (
                    <Button
                        variant="outline"
                        size="sm"
                        className="h-8 shrink-0 px-2 text-caption"
                        onClick={() => toggleMode(index)}
                        title={
                            isCompute
                                ? t('workflowConfigTab:outputDataPointsEditor.modeSpelTitle')
                                : t('workflowConfigTab:outputDataPointsEditor.modeTextTitle')
                        }
                    >
                        {isCompute
                            ? t('workflowConfigTab:outputDataPointsEditor.modeSpel')
                            : t('workflowConfigTab:outputDataPointsEditor.modeText')}
                    </Button>
                )}
                {devMode && (
                    <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 shrink-0 px-2 text-neutral-400 hover:text-red-600"
                        onClick={() => removeRow(index)}
                        title={t('workflowConfigTab:outputDataPointsEditor.removeSetting')}
                    >
                        <Trash size={14} />
                    </Button>
                )}
            </div>
        );
    };

    // Editable text rows front and center; formula (SpEL) rows folded away so
    // non-technical admins only see what's safe to change.
    const textEntries = points
        .map((p, i) => ({ p, i }))
        .filter(({ p }) => p.compute === undefined);
    const formulaEntries = points
        .map((p, i) => ({ p, i }))
        .filter(({ p }) => p.compute !== undefined);

    // In the simple view, hide the panel entirely when there is nothing a
    // non-technical admin can safely change here.
    const normalEditable = textEntries.filter(
        ({ p }) =>
            typeof p.value === 'string' ||
            isNestedStringMap(p.value) ||
            isFlatObjectList(p.value)
    );
    if (!devMode && normalEditable.length === 0) return null;

    return (
        <div className="rounded-md border border-neutral-200 bg-neutral-50 p-3">
            <div className="mb-2 flex items-center justify-between">
                <Label className="text-xs text-neutral-600">
                    {t('workflowConfigTab:outputDataPointsEditor.title')}
                    <span className="ml-1.5 text-caption text-neutral-400">
                        {t('workflowConfigTab:outputDataPointsEditor.hint')}
                    </span>
                </Label>
                {devMode && (
                    <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 gap-1 text-caption text-neutral-500"
                        onClick={() => write([...points, { fieldName: '', value: '' }])}
                    >
                        <Plus size={12} /> {t('workflowConfigTab:outputDataPointsEditor.addSetting')}
                    </Button>
                )}
            </div>
            <div className="space-y-2">
                {devMode && textEntries.length === 0 && (
                    <p className="text-caption text-neutral-400">
                        {t('workflowConfigTab:outputDataPointsEditor.noEditableSettings')}
                    </p>
                )}
                {textEntries.map(({ p, i }) => renderRow(p, i))}
            </div>
            {devMode && formulaEntries.length > 0 && (
                <details className="mt-2">
                    <summary className="cursor-pointer text-caption text-neutral-400">
                        {t('workflowConfigTab:outputDataPointsEditor.advancedFormulas', {
                            count: formulaEntries.length,
                        })}
                    </summary>
                    <div className="mt-2 space-y-2">
                        {formulaEntries.map(({ p, i }) => renderRow(p, i))}
                    </div>
                </details>
            )}
        </div>
    );
}

/**
 * Friendly editor for a send node's message: template name + per-variable rows
 * ({{1}}, {{2}}, ...). Plain-text variables (a day's message line) are editable
 * up front; values starting with '#' are SpEL formulas and live in the advanced
 * fold. Writes into the same config text as the raw JSON editor.
 */
/**
 * True when a template variable is filled in by the system rather than typed by
 * the admin. Two forms mean "not message text":
 *   • a formula — starts with '#' (SpEL);
 *   • a bare field name like "name" or "chargeDate" — the send handler looks
 *     these up on the learner record before falling back to a literal.
 * Anything with a space or punctuation is real message text and stays editable.
 */
function isAutoFilledVar(value: unknown): boolean {
    const trimmed = String(value ?? '').trim();
    if (trimmed.startsWith('#')) return true;
    return /^[A-Za-z_][A-Za-z0-9_]*$/.test(trimmed);
}

/** Minimal shape of a WhatsApp template as served by the templates API. */
type WhatsAppTemplateInfo = {
    name: string;
    content?: string;
    status?: string;
    dynamic_parameters?: string;
};

/**
 * Renders the template body with the variables substituted in place: editable
 * values highlighted, formula-driven ones shown as labeled chips. Live-updates
 * as the admin types in the variable boxes below.
 */
function TemplateBodyPreview({
    template,
    vars,
}: {
    template: WhatsAppTemplateInfo | undefined;
    vars: Record<string, string>;
}) {
    const { t } = useTranslation('workflowConfigTab');
    if (!template?.content) return null;
    let labels: Record<string, string> = {};
    try {
        labels = template.dynamic_parameters ? JSON.parse(template.dynamic_parameters) : {};
    } catch {
        // labels stay empty — chips fall back to the variable number
    }
    const segments = template.content.split(/(\{\{\s*[^}]+?\s*\}\})/g);
    return (
        <div className="mb-2 whitespace-pre-wrap rounded-md border border-neutral-200 bg-white p-3 text-xs leading-relaxed text-neutral-700">
            {segments.map((segment, i) => {
                const match = segment.match(/^\{\{\s*([^}]+?)\s*\}\}$/);
                if (!match) return <span key={i}>{segment}</span>;
                const key = match[1] ?? '';
                const value = vars[key];
                const isFormula = isAutoFilledVar(value);
                if (value != null && !isFormula && String(value).length > 0) {
                    return (
                        <span key={i} className="rounded bg-primary-50 px-1 font-medium text-primary-600">
                            {value}
                        </span>
                    );
                }
                return (
                    <span key={i} className="rounded bg-neutral-100 px-1 text-caption italic text-neutral-500">
                        {'⟨'}{labels[key] ?? t('workflowConfigTab:templateVarsEditor.varFallbackLabel', { key })}{'⟩'}
                    </span>
                );
            })}
        </div>
    );
}

function TemplateVarsEditor({
    configText,
    onChange,
    devMode,
    templates,
    onSyncTemplates,
    syncing,
}: {
    configText: string;
    onChange: (next: string) => void;
    devMode: boolean;
    templates: WhatsAppTemplateInfo[];
    onSyncTemplates?: () => void;
    syncing?: boolean;
}) {
    const { t } = useTranslation('workflowConfigTab');
    let parsed: Record<string, unknown> | null = null;
    try {
        const p: unknown = JSON.parse(configText);
        if (p && typeof p === 'object' && !Array.isArray(p)) {
            parsed = p as Record<string, unknown>;
        }
    } catch {
        // Invalid JSON — the raw editor is already showing the error; hide this panel.
    }
    const vars =
        parsed &&
        parsed.templateVars &&
        typeof parsed.templateVars === 'object' &&
        !Array.isArray(parsed.templateVars)
            ? (parsed.templateVars as Record<string, string>)
            : null;
    if (!parsed || !vars) return null;

    const cfg = parsed;
    const template = templates.find((tpl) => tpl.name === cfg.templateName);
    // Which variables does the approved template actually use? Read from its own
    // body — never a hardcoded list — so editing the template in WhatsApp (adding
    // a {{7}}, dropping a {{4}}) is reflected here as soon as it is synced.
    const templateKeys = template?.content
        ? Array.from(template.content.matchAll(/\{\{\s*([^}]+?)\s*\}\}/g))
              .map((m) => m[1] ?? '')
              .filter((k, i, all) => all.indexOf(k) === i)
        : [];
    // A variable the template needs but this step does not supply. The send would
    // fail at run time ("Missing required template variable"), so surface it here.
    const missingKeys = templateKeys.filter((k) => !(k in vars));
    // Only approved templates can actually be sent on, so those are the choices —
    // plus whatever this step already points at, so the value is never lost.
    const approvedNames = templates
        .filter((tpl) => (tpl.status ?? '').toUpperCase() === 'APPROVED')
        .map((tpl) => tpl.name)
        .sort((a, b) => a.localeCompare(b));
    const templateChoices =
        typeof cfg.templateName === 'string' &&
        cfg.templateName &&
        !approvedNames.includes(cfg.templateName)
            ? [cfg.templateName, ...approvedNames]
            : approvedNames;
    const unusedKeys =
        templateKeys.length > 0 ? Object.keys(vars).filter((k) => !templateKeys.includes(k)) : [];

    const writeVar = (key: string, value: string) =>
        onChange(
            JSON.stringify({ ...cfg, templateVars: { ...vars, [key]: value } }, null, 2)
        );
    const addMissingVars = () =>
        onChange(
            JSON.stringify(
                {
                    ...cfg,
                    templateVars: {
                        ...vars,
                        ...Object.fromEntries(missingKeys.map((k) => [k, ''])),
                    },
                },
                null,
                2
            )
        );
    const writeField = (field: string, value: string) =>
        onChange(JSON.stringify({ ...cfg, [field]: value }, null, 2));

    const entries = Object.entries(vars).sort(([a], [b]) =>
        a.localeCompare(b, undefined, { numeric: true })
    );
    const textVars = entries.filter(([, v]) => !isAutoFilledVar(v));
    const formulaVars = entries.filter(([, v]) => isAutoFilledVar(v));

    if (!devMode && textVars.length === 0 && typeof cfg.templateName !== 'string') return null;

    const renderVar = ([key, value]: [string, string]) => (
        <div key={key} className="flex items-start gap-2">
            <span className="mt-1.5 w-12 shrink-0 text-right font-mono text-xs text-neutral-500">
                {'{{'}
                {key}
                {'}}'}
            </span>
            <Textarea
                value={value ?? ''}
                onChange={(e) => writeVar(key, e.target.value)}
                spellCheck={false}
                rows={Math.min(6, Math.max(1, Math.ceil(String(value ?? '').length / 80)))}
                className="min-h-8 flex-1 text-xs"
            />
        </div>
    );

    return (
        <div className="rounded-md border border-neutral-200 bg-neutral-50 p-3">
            <Label className="mb-2 block text-xs text-neutral-600">
                {t('workflowConfigTab:templateVarsEditor.title')}
                <span className="ml-1.5 text-caption text-neutral-400">
                    {t('workflowConfigTab:templateVarsEditor.hint')}
                </span>
            </Label>
            {typeof cfg.templateName === 'string' && (
                <div className="mb-2 flex items-center gap-2">
                    <span className="w-12 shrink-0 text-right text-caption text-neutral-500">
                        {t('workflowConfigTab:templateVarsEditor.template')}
                    </span>
                    {devMode ? (
                        <Input
                            value={cfg.templateName}
                            onChange={(e) => writeField('templateName', e.target.value)}
                            spellCheck={false}
                            className="h-8 flex-1 font-mono text-xs"
                        />
                    ) : (
                        // Simple view: pick from the institute's approved templates. The
                        // list is whatever WhatsApp has approved — never a fixed set — and
                        // the current value stays selectable even if it is not in the list
                        // (e.g. not synced yet), so opening this screen can't blank it.
                        <MyDropdown
                            currentValue={cfg.templateName}
                            dropdownList={templateChoices}
                            handleChange={(value) => writeField('templateName', value)}
                            placeholder={t('workflowConfigTab:templateVarsEditor.templatePlaceholder')}
                            className="h-8 flex-1 text-xs"
                            contentClassName="max-h-72 overflow-y-auto"
                        />
                    )}
                </div>
            )}
            {/* Full message preview: the template body with this node's variable
                values substituted live. When the body is unknown here, say so —
                showing bare {{1}} boxes with no explanation reads as a bug. */}
            {(() => {
                if (template?.content) {
                    return <TemplateBodyPreview template={template} vars={vars} />;
                }
                if (typeof cfg.templateName !== 'string' || !cfg.templateName) return null;
                return (
                    <div className="mb-2 flex items-start gap-2 rounded-md border border-warning-200 bg-warning-50 p-3">
                        <Warning size={14} weight="fill" className="mt-0.5 shrink-0 text-warning-500" />
                        <div className="flex-1 text-xs text-warning-700">
                            <p className="font-medium">
                                {t('workflowConfigTab:templateVarsEditor.previewUnavailableTitle')}
                            </p>
                            <p className="mt-0.5 text-warning-600">
                                {template
                                    ? t('workflowConfigTab:templateVarsEditor.previewUnavailableNoBody')
                                    : t('workflowConfigTab:templateVarsEditor.previewUnavailableNotImported')}{' '}
                                {t('workflowConfigTab:templateVarsEditor.previewUnavailableSuffix')}
                            </p>
                            {onSyncTemplates && (
                                <Button
                                    variant="outline"
                                    size="sm"
                                    className="mt-2 h-7 gap-1.5 text-xs"
                                    disabled={syncing}
                                    onClick={onSyncTemplates}
                                >
                                    <ArrowCounterClockwise size={12} />
                                    {syncing
                                        ? t('workflowConfigTab:templateVarsEditor.importing')
                                        : t('workflowConfigTab:templateVarsEditor.importTemplates')}
                                </Button>
                            )}
                        </div>
                    </div>
                );
            })()}
            {/* The template changed under this step: it now uses variables this step
                does not fill in. Sends would fail, so make it fixable in one click. */}
            {missingKeys.length > 0 && (
                <div className="mb-2 flex items-start gap-2 rounded-md border border-danger-200 bg-danger-50 p-3">
                    <Warning size={14} weight="fill" className="mt-0.5 shrink-0 text-danger-500" />
                    <div className="flex-1 text-xs text-danger-700">
                        <p className="font-medium">
                            {t('workflowConfigTab:templateVarsEditor.missingValuesTitle', {
                                count: missingKeys.length,
                            })}
                        </p>
                        <p className="mt-0.5 text-danger-600">
                            {t('workflowConfigTab:templateVarsEditor.missingValuesBody', {
                                count: missingKeys.length,
                                list: missingKeys.map((k) => `{{${k}}}`).join(', '),
                            })}
                        </p>
                        <Button
                            variant="outline"
                            size="sm"
                            className="mt-2 h-7 gap-1.5 text-xs"
                            onClick={addMissingVars}
                        >
                            <Plus size={12} />
                            {t('workflowConfigTab:templateVarsEditor.addMissing', {
                                count: missingKeys.length,
                            })}
                        </Button>
                    </div>
                </div>
            )}
            {unusedKeys.length > 0 && (
                <p className="mb-2 text-caption text-neutral-400">
                    {t('workflowConfigTab:templateVarsEditor.unusedKeys', {
                        list: unusedKeys.map((k) => `{{${k}}}`).join(', '),
                    })}
                </p>
            )}
            <div className="space-y-2">{textVars.map(renderVar)}</div>
            {!devMode && textVars.length === 0 && (
                <p className="text-caption text-neutral-500">
                    {t('workflowConfigTab:templateVarsEditor.fixedWording')}
                </p>
            )}
            {!devMode && formulaVars.length > 0 && (
                <p className="mt-2 text-caption text-neutral-400">
                    {t('workflowConfigTab:templateVarsEditor.filledAutomatically', {
                        list: formulaVars.map(([key]) => `{{${key}}}`).join(', '),
                    })}
                </p>
            )}
            {devMode && formulaVars.length > 0 && (
                <details className="mt-2">
                    <summary className="cursor-pointer text-caption text-neutral-400">
                        {t('workflowConfigTab:templateVarsEditor.autoFilledVariables', {
                            count: formulaVars.length,
                        })}
                    </summary>
                    <div className="mt-2 space-y-2">{formulaVars.map(renderVar)}</div>
                </details>
            )}
        </div>
    );
}

function NodeConfigEditorCard({
    workflowId,
    node,
    devMode,
    templates,
    collapsed,
    onToggleCollapsed,
    onSyncTemplates,
    syncingTemplates,
}: {
    workflowId: string;
    node: WorkflowRawNode;
    devMode: boolean;
    templates: WhatsAppTemplateInfo[];
    collapsed: boolean;
    onToggleCollapsed: () => void;
    onSyncTemplates: () => void;
    syncingTemplates: boolean;
}) {
    const { t } = useTranslation('workflowConfigTab');
    const queryClient = useQueryClient();

    // Snapshot string of the server-side node — when it changes (e.g. after a save refetch),
    // we re-sync local edit state to match.
    const snapshot = useMemo(
        () =>
            JSON.stringify([
                node.config_json,
                node.node_name,
                node.node_type,
                node.status,
                node.retry_config,
                node.is_start_node,
                node.is_end_node,
            ]),
        [node]
    );

    const [configText, setConfigText] = useState(() => formatJson(node.config_json));
    const [retryText, setRetryText] = useState(() => formatJson(node.retry_config));
    const [nodeName, setNodeName] = useState(node.node_name ?? '');
    const [nodeType, setNodeType] = useState(node.node_type ?? '');
    const [status, setStatus] = useState(node.status ?? 'ACTIVE');
    const [isStart, setIsStart] = useState(Boolean(node.is_start_node));
    const [isEnd, setIsEnd] = useState(Boolean(node.is_end_node));
    const [savedOk, setSavedOk] = useState(false);

    // Re-sync local state whenever the server node changes.
    useEffect(() => {
        setConfigText(formatJson(node.config_json));
        setRetryText(formatJson(node.retry_config));
        setNodeName(node.node_name ?? '');
        setNodeType(node.node_type ?? '');
        setStatus(node.status ?? 'ACTIVE');
        setIsStart(Boolean(node.is_start_node));
        setIsEnd(Boolean(node.is_end_node));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [snapshot]);

    const configError = jsonObjectError(configText, { allowEmpty: false }, t);
    const retryError = jsonObjectError(retryText, { allowEmpty: true }, t);

    const originalConfig = formatJson(node.config_json);
    const originalRetry = formatJson(node.retry_config);
    const isDirty =
        configText !== originalConfig ||
        retryText !== originalRetry ||
        nodeName !== (node.node_name ?? '') ||
        nodeType !== (node.node_type ?? '') ||
        status !== (node.status ?? 'ACTIVE') ||
        isStart !== Boolean(node.is_start_node) ||
        isEnd !== Boolean(node.is_end_node);

    const mutation = useMutation({
        mutationFn: () =>
            updateNodeTemplate(workflowId, node.node_template_id, {
                config_json: configText,
                node_name: nodeName,
                node_type: nodeType,
                status,
                retry_config: retryText.trim() === '' ? '' : retryText,
                is_start_node: isStart,
                is_end_node: isEnd,
            }),
        onSuccess: async () => {
            setSavedOk(true);
            setTimeout(() => setSavedOk(false), 2500);
            await Promise.all([
                queryClient.invalidateQueries({ queryKey: ['WORKFLOW_RAW', workflowId] }),
                queryClient.invalidateQueries({ queryKey: ['GET_WORKFLOW_DIAGRAM', workflowId] }),
            ]);
        },
    });

    const saveDisabled = !isDirty || !!configError || !!retryError || mutation.isPending;

    const revert = () => {
        setConfigText(originalConfig);
        setRetryText(originalRetry);
        setNodeName(node.node_name ?? '');
        setNodeType(node.node_type ?? '');
        setStatus(node.status ?? 'ACTIVE');
        setIsStart(Boolean(node.is_start_node));
        setIsEnd(Boolean(node.is_end_node));
        mutation.reset();
    };

    const nodeMeta = WORKFLOW_NODE_TYPES.find((t) => t.type === node.node_type);

    // Simple view: every node stays visible (the admin should see the whole
    // pipeline) — nodes without safe settings just say so.
    const editable = normalEditableSections(configText);
    const hasSimpleSettings = editable.settings || editable.message || editable.queryParams;

    return (
        <div className="rounded-lg border border-neutral-200 bg-white">
            {/* Card header — click anywhere to collapse/expand */}
            <div
                role="button"
                tabIndex={0}
                onClick={onToggleCollapsed}
                onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        onToggleCollapsed();
                    }
                }}
                className={`flex cursor-pointer select-none flex-wrap items-center gap-2 px-4 py-3 ${
                    collapsed ? '' : 'border-b border-neutral-100'
                }`}
            >
                {collapsed ? (
                    <CaretRight size={14} className="shrink-0 text-neutral-400" />
                ) : (
                    <CaretDown size={14} className="shrink-0 text-neutral-400" />
                )}
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-neutral-100 text-xs font-semibold text-neutral-500">
                    {node.node_order}
                </span>
                <span className="text-lg">{nodeMeta?.icon ?? '⚙️'}</span>
                <span className="font-medium text-neutral-800">{node.node_name}</span>
                {collapsed && isDirty && (
                    <span className="rounded-full bg-warning-50 px-2 py-0.5 text-caption text-warning-600">
                        {t('workflowConfigTab:nodeCard.unsaved')}
                    </span>
                )}
                {devMode && (
                    <Badge variant="outline" className="text-[10px] font-medium text-neutral-600">
                        {nodeMeta?.label ?? node.node_type}
                    </Badge>
                )}
                {devMode && isStart && (
                    <Badge className="bg-green-100 text-[10px] text-green-700 hover:bg-green-100">
                        {t('workflowConfigTab:nodeCard.startBadge')}
                    </Badge>
                )}
                {devMode && isEnd && (
                    <Badge className="bg-neutral-100 text-[10px] text-neutral-600 hover:bg-neutral-100">
                        {t('workflowConfigTab:nodeCard.endBadge')}
                    </Badge>
                )}
                {devMode && (
                    <code className="ml-auto hidden text-[10px] text-neutral-400 sm:block">
                        {node.node_template_id}
                    </code>
                )}
            </div>

            {/* Card body — hidden while collapsed (state and unsaved edits survive) */}
            <div className={collapsed ? 'hidden' : 'space-y-4 p-4'}>
                {/* Node metadata row */}
                <div className={devMode ? 'grid grid-cols-1 gap-3 sm:grid-cols-3' : 'hidden'}>
                    <div>
                        <Label className="text-xs text-neutral-600">{t('workflowConfigTab:nodeCard.nodeName')}</Label>
                        <Input
                            value={nodeName}
                            onChange={(e) => setNodeName(e.target.value)}
                            className="mt-1"
                            placeholder={t('workflowConfigTab:nodeCard.nodeNamePlaceholder')}
                        />
                    </div>
                    <div>
                        <Label className="text-xs text-neutral-600">{t('workflowConfigTab:nodeCard.nodeType')}</Label>
                        <select
                            className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                            value={nodeType}
                            onChange={(e) => setNodeType(e.target.value)}
                        >
                            {WORKFLOW_NODE_TYPES.map((nt) => (
                                <option key={nt.type} value={nt.type}>
                                    {nt.label} ({nt.type})
                                </option>
                            ))}
                            {/* Keep an unknown stored type selectable rather than silently dropping it */}
                            {!WORKFLOW_NODE_TYPES.some((nt) => nt.type === nodeType) && nodeType && (
                                <option value={nodeType}>{nodeType}</option>
                            )}
                        </select>
                    </div>
                    <div>
                        <Label className="text-xs text-neutral-600">{t('workflowConfigTab:nodeCard.status')}</Label>
                        <select
                            className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                            value={status}
                            onChange={(e) => setStatus(e.target.value)}
                        >
                            {STATUS_OPTIONS.map((s) => (
                                <option key={s} value={s}>
                                    {s}
                                </option>
                            ))}
                            {!STATUS_OPTIONS.includes(status) && status && (
                                <option value={status}>{status}</option>
                            )}
                        </select>
                    </div>
                </div>

                {/* Start / end toggles */}
                <div className={devMode ? 'flex flex-wrap items-center gap-6' : 'hidden'}>
                    <label className="flex cursor-pointer items-center gap-2">
                        <Switch checked={isStart} onCheckedChange={setIsStart} />
                        <span className="text-xs text-neutral-600">{t('workflowConfigTab:nodeCard.startNode')}</span>
                    </label>
                    <label className="flex cursor-pointer items-center gap-2">
                        <Switch checked={isEnd} onCheckedChange={setIsEnd} />
                        <span className="text-xs text-neutral-600">{t('workflowConfigTab:nodeCard.endNode')}</span>
                    </label>
                </div>

                {/* Friendly settings editors — each shows only when the config has its section */}
                <OutputDataPointsEditor configText={configText} onChange={setConfigText} devMode={devMode} />
                <TemplateVarsEditor
                    configText={configText}
                    onChange={setConfigText}
                    devMode={devMode}
                    templates={templates}
                    onSyncTemplates={onSyncTemplates}
                    syncing={syncingTemplates}
                />
                <QueryParamsEditor configText={configText} onChange={setConfigText} devMode={devMode} />
                {!devMode && !hasSimpleSettings && (
                    <p className="text-xs text-neutral-400">
                        {t('workflowConfigTab:nodeCard.automaticStep')}
                    </p>
                )}

                {/* config_json editor */}
                <div className={devMode ? '' : 'hidden'}>
                    <div className="mb-1 flex items-center justify-between">
                        <Label className="text-xs text-neutral-600">
                            {t('workflowConfigTab:nodeCard.configJsonLabel')}
                            <span className="ml-1.5 text-[10px] text-neutral-400">
                                {t('workflowConfigTab:nodeCard.configJsonHint')}
                            </span>
                        </Label>
                        <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 gap-1 text-[11px] text-neutral-500"
                            disabled={!!configError}
                            onClick={() => setConfigText(formatJson(configText))}
                            title={t('workflowConfigTab:nodeCard.formatTitle')}
                        >
                            <BracketsCurly size={12} /> {t('workflowConfigTab:nodeCard.format')}
                        </Button>
                    </div>
                    <Textarea
                        value={configText}
                        onChange={(e) => setConfigText(e.target.value)}
                        spellCheck={false}
                        className={`min-h-[180px] font-mono text-xs ${
                            configError ? 'border-red-300 focus-visible:ring-red-200' : ''
                        }`}
                    />
                    {configError && (
                        <p className="mt-1 flex items-center gap-1 text-[11px] text-red-600">
                            <Warning size={12} weight="fill" /> {configError}
                        </p>
                    )}
                </div>

                {/* retry_config editor (optional) */}
                <div className={devMode ? '' : 'hidden'}>
                    <Label className="text-xs text-neutral-600">
                        {t('workflowConfigTab:nodeCard.retryConfigLabel')}
                        <span className="ml-1.5 text-[10px] text-neutral-400">
                            {t('workflowConfigTab:nodeCard.retryConfigHint', {
                                example: '{"maxRetries":3,"backoffMs":1000}',
                            })}
                        </span>
                    </Label>
                    <Textarea
                        value={retryText}
                        onChange={(e) => setRetryText(e.target.value)}
                        spellCheck={false}
                        placeholder={t('workflowConfigTab:nodeCard.retryConfigNonePlaceholder')}
                        className={`mt-1 min-h-[64px] font-mono text-xs ${
                            retryError ? 'border-red-300 focus-visible:ring-red-200' : ''
                        }`}
                    />
                    {retryError && (
                        <p className="mt-1 flex items-center gap-1 text-[11px] text-red-600">
                            <Warning size={12} weight="fill" /> {retryError}
                        </p>
                    )}
                </div>

                {/* Save error */}
                {mutation.isError && (
                    <p className="flex items-center gap-1 text-xs text-red-600">
                        <Warning size={14} weight="fill" />
                        {mutation.error instanceof Error
                            ? mutation.error.message
                            : t('workflowConfigTab:errors.failedToSave')}
                    </p>
                )}

                {/* Actions */}
                <div
                    className={
                        devMode || hasSimpleSettings
                            ? 'flex items-center justify-end gap-2 border-t border-neutral-100 pt-3'
                            : 'hidden'
                    }
                >
                    {savedOk && (
                        <span className="mr-auto flex items-center gap-1 text-xs text-green-600">
                            <CheckCircle size={14} weight="fill" /> {t('workflowConfigTab:nodeCard.saved')}
                        </span>
                    )}
                    {isDirty && !savedOk && (
                        <span className="mr-auto text-xs text-neutral-400">
                            {t('workflowConfigTab:nodeCard.unsavedChanges')}
                        </span>
                    )}
                    <Button
                        variant="outline"
                        size="sm"
                        className="gap-1.5"
                        disabled={!isDirty || mutation.isPending}
                        onClick={revert}
                    >
                        <ArrowCounterClockwise size={14} /> {t('workflowConfigTab:nodeCard.revert')}
                    </Button>
                    <Button
                        size="sm"
                        className="gap-1.5"
                        disabled={saveDisabled}
                        onClick={() => mutation.mutate()}
                    >
                        <FloppyDisk size={14} />
                        {mutation.isPending
                            ? t('workflowConfigTab:nodeCard.saving')
                            : t('workflowConfigTab:nodeCard.saveNode')}
                    </Button>
                </div>
            </div>
        </div>
    );
}

export function WorkflowConfigTab({ workflowId }: { workflowId: string }) {
    const { t } = useTranslation('workflowConfigTab');
    const { data, isLoading, error } = useQuery(getWorkflowRawQuery(workflowId));
    // Approved WhatsApp templates — used to render full message previews in the
    // Message content panels (body text with variables substituted).
    const { data: instituteDetails } = useQuery(useInstituteQuery());
    const instituteId = instituteDetails?.id ?? '';
    const { data: whatsappTemplates } = useQuery({
        ...getWhatsAppTemplatesForPreviewQuery(instituteId),
        enabled: !!instituteId,
    });
    const templates: WhatsAppTemplateInfo[] = (whatsappTemplates ?? []) as WhatsAppTemplateInfo[];
    const queryClient = useQueryClient();
    // Templates authored directly in Meta are unknown here until synced, which
    // is why a message can show its variables but no body.
    const syncTemplates = useMutation({
        mutationFn: () => syncWhatsAppTemplatesFromMeta(instituteId),
        onSuccess: () =>
            queryClient.invalidateQueries({ queryKey: ['WHATSAPP_TEMPLATES_PREVIEW', instituteId] }),
    });
    // Simple view by default; the developer toggle persists across visits.
    const [devMode, setDevMode] = useState(
        () => localStorage.getItem('workflow-config-dev-mode') === 'true'
    );
    const toggleDevMode = () => {
        const next = !devMode;
        setDevMode(next);
        localStorage.setItem('workflow-config-dev-mode', String(next));
    };
    // Collapsed cards, by node id. Long workflows (a node per day) start folded
    // so the page reads as an index; short ones stay open.
    const [collapsedIds, setCollapsedIds] = useState<Set<string> | null>(null);
    const nodeIds = useMemo(
        () => (data?.nodes ?? []).map((n) => n.node_template_id),
        [data]
    );
    const effectiveCollapsed = useMemo(() => {
        if (collapsedIds) return collapsedIds;
        return nodeIds.length > 5 ? new Set(nodeIds) : new Set<string>();
    }, [collapsedIds, nodeIds]);
    const toggleCollapsed = (id: string) =>
        setCollapsedIds(() => {
            const next = new Set(effectiveCollapsed);
            if (next.has(id)) {
                next.delete(id);
            } else {
                next.add(id);
            }
            return next;
        });
    const allCollapsed = nodeIds.length > 0 && nodeIds.every((id) => effectiveCollapsed.has(id));

    if (isLoading) {
        return (
            <div className="flex items-center justify-center py-12 text-sm text-neutral-400">
                {t('workflowConfigTab:page.loading')}
            </div>
        );
    }

    if (error) {
        return (
            <div className="flex flex-col items-center justify-center gap-2 py-12">
                <p className="text-sm text-red-500">{t('workflowConfigTab:page.failedToLoad')}</p>
                <p className="text-xs text-neutral-400">
                    {error instanceof Error ? error.message : t('workflowConfigTab:errors.unknownError')}
                </p>
            </div>
        );
    }

    if (!data || data.nodes.length === 0) {
        return (
            <div className="flex items-center justify-center py-12 text-sm text-neutral-400">
                {t('workflowConfigTab:page.noNodes')}
            </div>
        );
    }

    return (
        <div className="space-y-4">
            {/* Intro / guidance + view toggle */}
            <div className="flex items-start gap-2 rounded-lg border border-primary-100 bg-primary-50 px-4 py-3">
                <Info size={16} weight="fill" className="mt-0.5 shrink-0 text-primary-500" />
                <div className="flex-1 text-xs text-primary-600">
                    {devMode ? (
                        <>
                            <p className="font-medium">{t('workflowConfigTab:page.devTitle')}</p>
                            <p className="mt-0.5 text-primary-500">
                                <Trans i18nKey="workflowConfigTab:page.devDescription">
                                    Edit each node&apos;s raw <code>config_json</code> (including its{' '}
                                    <code>routing</code>) in place. Changes are validated and saved
                                    directly to the node template — the running workflow picks them up on
                                    its next execution.
                                </Trans>
                            </p>
                        </>
                    ) : (
                        <>
                            <p className="font-medium">{t('workflowConfigTab:page.simpleTitle')}</p>
                            <p className="mt-0.5 text-primary-500">
                                {t('workflowConfigTab:page.simpleDescription')}
                            </p>
                        </>
                    )}
                </div>
                <Button
                    variant="outline"
                    size="sm"
                    className="shrink-0 gap-1.5"
                    onClick={() => setCollapsedIds(allCollapsed ? new Set<string>() : new Set(nodeIds))}
                    title={
                        allCollapsed
                            ? t('workflowConfigTab:page.expandAllTitle')
                            : t('workflowConfigTab:page.collapseAllTitle')
                    }
                >
                    {allCollapsed ? <CaretDown size={14} /> : <CaretRight size={14} />}
                    {allCollapsed ? t('workflowConfigTab:page.expandAll') : t('workflowConfigTab:page.collapseAll')}
                </Button>
                <Button
                    variant="outline"
                    size="sm"
                    className="shrink-0 gap-1.5"
                    onClick={toggleDevMode}
                >
                    <BracketsCurly size={14} />
                    {devMode ? t('workflowConfigTab:page.simpleView') : t('workflowConfigTab:page.developerView')}
                </Button>
            </div>

            {data.nodes.map((node) => (
                <NodeConfigEditorCard
                    key={node.node_template_id}
                    workflowId={workflowId}
                    node={node}
                    devMode={devMode}
                    templates={templates}
                    collapsed={effectiveCollapsed.has(node.node_template_id)}
                    onToggleCollapsed={() => toggleCollapsed(node.node_template_id)}
                    onSyncTemplates={() => syncTemplates.mutate()}
                    syncingTemplates={syncTemplates.isPending}
                />
            ))}
        </div>
    );
}
