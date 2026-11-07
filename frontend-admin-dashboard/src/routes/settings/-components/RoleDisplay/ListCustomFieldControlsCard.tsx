import { useMemo, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { getCurrentInstituteId } from '@/lib/auth/instituteUtils';
import { useCustomFieldSetup } from '@/routes/audience-manager/list/-hooks/useCustomFieldSetup';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import type {
    ListCustomFieldControls,
    ListCustomFieldSurface,
    ListCustomFieldSurfaceControls,
    ListUtmFilterControls,
    ListUtmFilterDimension,
    ListBuiltInFilter,
    ListBuiltInFilterControls,
} from '@/types/display-settings';
import { useUtmBuilderEnabled } from '@/hooks/use-utm-builder-enabled';
import { Link } from '@tanstack/react-router';
import { Funnel, Megaphone } from '@phosphor-icons/react';
import { UTM_FILTER_DIMENSIONS, CORE_UTM_FILTER_DIMENSIONS } from '@/services/utm-list-filters';
import { LIST_BUILT_IN_FILTERS } from '@/types/display-settings';
import { useLeadTerminology } from '@/hooks/use-lead-terminology';

interface ListCustomFieldControlsCardProps {
    /** The unified per-surface controls from the display-settings blob. */
    value: ListCustomFieldControls | undefined;
    /** Legacy leads filter ids (leadsFilterCustomFields) — pre-unified config
     *  that seeds the LEADS surface until it is explicitly saved here. */
    legacyLeadsFields: string[];
    /** Bubbles the next controls up to the parent display-settings state so
     *  the shared unsaved-changes bar persists it. */
    onChange: (next: ListCustomFieldControls) => void;
    /** Which surface tab to open on. Defaults to LEADS (the full-settings
     *  behaviour); the focused "Manage filters" popup passes the current list's
     *  surface so it lands on the right tab. */
    initialSurface?: ListCustomFieldSurface;
    /** Suppress the card's own title/description when a host (e.g. the
     *  "Manage filters" dialog) already provides a heading. */
    hideHeading?: boolean;
    /** Campaign (UTM) filter controls for the same surfaces. Optional so the
     *  card keeps working for hosts that only edit custom fields; when both
     *  props are given a "Campaign (UTM) filters" section renders above the
     *  custom-field rows of the selected surface. */
    utmValue?: ListUtmFilterControls | undefined;
    onUtmChange?: (next: ListUtmFilterControls) => void;
    /** The surface's built-in filters (counsellor / campaign type / audience).
     *  Optional for the same reason as the UTM pair above. */
    builtInValue?: ListBuiltInFilterControls | undefined;
    onBuiltInChange?: (next: ListBuiltInFilterControls) => void;
}

const buildSurfaces = (
    t: TFunction
): Array<{ id: ListCustomFieldSurface; label: string; pages: string }> => [
    { id: 'LEADS', label: t('surfaces.leads.label'), pages: t('surfaces.leads.pages') },
    { id: 'CONTACTS', label: t('surfaces.contacts.label'), pages: t('surfaces.contacts.pages') },
    { id: 'STUDENTS', label: t('surfaces.students.label'), pages: t('surfaces.students.pages') },
];

/**
 * Institute-wide (applies to all roles): which custom fields are exposed as
 * filters — and, where supported, sortable columns — on each admin list
 * surface. Controlled card; toggling bubbles via onChange into the
 * display-settings blob and persists through the panel's floating save bar.
 *
 * Unconfigured surfaces show their effective legacy behavior so saving without
 * touching a surface never changes what admins see today: LEADS seeds from the
 * legacy leadsFilterCustomFields key, STUDENTS from its historical
 * auto-expose (every text + dropdown field), CONTACTS from none.
 */
export const ListCustomFieldControlsCard = ({
    value,
    legacyLeadsFields,
    onChange,
    initialSurface,
    hideHeading = false,
    utmValue,
    onUtmChange,
    builtInValue,
    onBuiltInChange,
}: ListCustomFieldControlsCardProps) => {
    const { t } = useTranslation('settingsListCustomFieldControlsCard');
    const { t: tUtm } = useTranslation('utmListFilters');
    const utm = useUtmBuilderEnabled();
    const terminology = useLeadTerminology();
    const instituteId = getCurrentInstituteId();
    const { data: fields, isLoading } = useCustomFieldSetup(instituteId ?? undefined);
    const [surface, setSurface] = useState<ListCustomFieldSurface>(initialSurface ?? 'LEADS');
    const surfaces = useMemo(() => buildSurfaces(t), [t]);

    const sortedFields = useMemo(
        () => [...(fields ?? [])].sort((a, b) => (a.form_order ?? 0) - (b.form_order ?? 0)),
        [fields]
    );

    // Effective controls for a surface: saved entry, else its legacy default.
    const effectiveFor = (s: ListCustomFieldSurface): ListCustomFieldSurfaceControls => {
        const saved = value?.[s];
        if (saved) {
            return {
                filterFields: saved.filterFields ?? [],
                sortableFields: saved.sortableFields ?? [],
            };
        }
        if (s === 'LEADS') return { filterFields: legacyLeadsFields, sortableFields: [] };
        if (s === 'STUDENTS') {
            return {
                filterFields: sortedFields
                    .filter((f) => {
                        const type = (f.field_type ?? '').toUpperCase();
                        return type === 'TEXT' || type === 'DROPDOWN';
                    })
                    .map((f) => f.custom_field_id),
                sortableFields: [],
            };
        }
        return { filterFields: [], sortableFields: [] };
    };

    const current = effectiveFor(surface);
    const filterSet = useMemo(() => new Set(current.filterFields), [current.filterFields]);
    const sortSet = useMemo(() => new Set(current.sortableFields), [current.sortableFields]);

    const toggle = (kind: 'filterFields' | 'sortableFields', fieldId: string, on: boolean) => {
        const next = new Set(current[kind]);
        if (on) next.add(fieldId);
        else next.delete(fieldId);
        onChange({
            ...(value ?? {}),
            [surface]: { ...current, [kind]: Array.from(next) },
        });
    };

    const surfaceMeta = surfaces.find((s) => s.id === surface);

    // ── Campaign (UTM) filters for this surface ────────────────────────
    // Absent entry = follow the institute UTM setting; absent dimensions =
    // automatic (core three + whatever the data holds). The switches below
    // show the EFFECTIVE state so an unsaved surface reads truthfully.
    const utmSurface = utmValue?.[surface];
    const utmEnabledEffective = utm.enabled && utmSurface?.enabled !== false;
    const utmDimensionsEffective: ListUtmFilterDimension[] = utmSurface?.dimensions ?? [
        ...UTM_FILTER_DIMENSIONS,
    ];
    const utmDimensionLabel = (d: ListUtmFilterDimension) =>
        tUtm(`dimensions.${d === 'source_type' ? 'sourceType' : d}`);
    const setUtmSurface = (patch: Partial<NonNullable<typeof utmSurface>>) => {
        if (!onUtmChange) return;
        onUtmChange({
            ...(utmValue ?? {}),
            [surface]: { ...(utmSurface ?? {}), ...patch },
        });
    };
    const toggleUtmDimension = (d: ListUtmFilterDimension, on: boolean) => {
        const next = new Set(utmDimensionsEffective);
        if (on) next.add(d);
        else next.delete(d);
        // Keep the canonical order so the bar renders dimensions consistently.
        setUtmSurface({ dimensions: UTM_FILTER_DIMENSIONS.filter((x) => next.has(x)) });
    };

    // ── Built-in filters for this surface ─────────────────────────────
    // Named from Lead Settings, so an institute that calls the campaign type
    // "Source" sees "Source" here and on the filter bar alike.
    const builtInHidden = builtInValue?.[surface]?.hidden ?? [];
    const builtInLabel = (f: ListBuiltInFilter) =>
        f === 'campaignType'
            ? terminology.campaignType
            : f === 'audience'
              ? terminology.leadSource
              : t('builtIn.counsellor');
    const toggleBuiltIn = (f: ListBuiltInFilter, on: boolean) => {
        if (!onBuiltInChange) return;
        const next = new Set(builtInHidden);
        if (on) next.delete(f);
        else next.add(f);
        onBuiltInChange({
            ...(builtInValue ?? {}),
            [surface]: { hidden: LIST_BUILT_IN_FILTERS.filter((x) => next.has(x)) },
        });
    };

    return (
        <Card>
            {!hideHeading && (
                <CardHeader>
                    <CardTitle>{t('header.title')}</CardTitle>
                    <CardDescription>{t('header.description')}</CardDescription>
                </CardHeader>
            )}
            <CardContent>
                <Tabs
                    value={surface}
                    onValueChange={(v) => setSurface(v as ListCustomFieldSurface)}
                >
                    <TabsList>
                        {surfaces.map((s) => (
                            <TabsTrigger key={s.id} value={s.id}>
                                {s.label}
                            </TabsTrigger>
                        ))}
                    </TabsList>
                </Tabs>
                {surfaceMeta && (
                    <p className="mt-2 text-xs text-muted-foreground">
                        {t('appliesTo', { pages: surfaceMeta.pages })}
                    </p>
                )}
                {onBuiltInChange && (
                    <div className="mt-4 rounded-lg border border-border bg-neutral-50/60 p-4">
                        <div className="flex min-w-0 flex-col gap-1">
                            <div className="flex items-center gap-2">
                                <Funnel className="size-4 text-neutral-500" />
                                <span className="text-sm font-semibold text-neutral-800">
                                    {t('builtIn.title')}
                                </span>
                            </div>
                            <p className="text-xs text-muted-foreground">
                                {t('builtIn.description')}
                            </p>
                        </div>
                        <div className="mt-3 flex flex-col gap-2">
                            {LIST_BUILT_IN_FILTERS.map((f) => (
                                <div key={f} className="flex items-center justify-between gap-4">
                                    <Label
                                        htmlFor={`list-built-in-${surface}-${f}`}
                                        className="cursor-pointer text-sm text-neutral-700"
                                    >
                                        {builtInLabel(f)}
                                    </Label>
                                    <Switch
                                        id={`list-built-in-${surface}-${f}`}
                                        checked={!builtInHidden.includes(f)}
                                        onCheckedChange={(on) => toggleBuiltIn(f, on)}
                                    />
                                </div>
                            ))}
                        </div>
                    </div>
                )}
                {onUtmChange && (
                    <div className="mt-4 rounded-lg border border-border bg-neutral-50/60 p-4">
                        <div className="flex items-start justify-between gap-4">
                            <div className="flex min-w-0 flex-col gap-1">
                                <div className="flex items-center gap-2">
                                    <Megaphone className="size-4 text-neutral-500" />
                                    <Label
                                        htmlFor={`list-utm-enabled-${surface}`}
                                        className="cursor-pointer text-sm font-semibold text-neutral-800"
                                    >
                                        {t('utm.title')}
                                    </Label>
                                </div>
                                <p className="text-xs text-muted-foreground">
                                    {utm.enabled ? (
                                        t('utm.description')
                                    ) : (
                                        <>
                                            {t('utm.disabledHint')}{' '}
                                            <Link
                                                to="/settings"
                                                search={{ selectedTab: 'utmSettings' }}
                                                className="font-medium text-primary-500 hover:underline"
                                            >
                                                {t('utm.openSettings')}
                                            </Link>
                                        </>
                                    )}
                                </p>
                            </div>
                            <Switch
                                id={`list-utm-enabled-${surface}`}
                                checked={utmEnabledEffective}
                                disabled={!utm.enabled}
                                onCheckedChange={(v) => setUtmSurface({ enabled: v })}
                            />
                        </div>
                        {utmEnabledEffective && (
                            <div className="mt-3 grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
                                {UTM_FILTER_DIMENSIONS.map((d) => (
                                    <div
                                        key={d}
                                        className="flex items-center justify-between gap-3 py-1"
                                    >
                                        <Label
                                            htmlFor={`list-utm-dim-${surface}-${d}`}
                                            className="cursor-pointer text-sm text-neutral-700"
                                        >
                                            {utmDimensionLabel(d)}
                                            {!utmSurface?.dimensions &&
                                                !CORE_UTM_FILTER_DIMENSIONS.includes(d) && (
                                                    <span className="ml-1.5 text-xs text-neutral-400">
                                                        {t('utm.autoHint')}
                                                    </span>
                                                )}
                                        </Label>
                                        <Switch
                                            id={`list-utm-dim-${surface}-${d}`}
                                            checked={utmDimensionsEffective.includes(d)}
                                            onCheckedChange={(v) => toggleUtmDimension(d, v)}
                                        />
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}
                {isLoading ? (
                    <p className="mt-3 text-sm text-muted-foreground">{t('loading')}</p>
                ) : sortedFields.length === 0 ? (
                    <p className="mt-3 text-sm text-muted-foreground">{t('emptyState')}</p>
                ) : (
                    <div className="mt-2 flex flex-col">
                        <div className="flex items-center justify-end gap-8 border-b border-border py-2 pr-1 text-xs font-medium text-muted-foreground">
                            <span>{t('columns.filter')}</span>
                            <span>{t('columns.sort')}</span>
                        </div>
                        {sortedFields.map((field) => (
                            <div
                                key={field.custom_field_id}
                                className="flex items-center justify-between gap-4 border-b border-border py-3.5 last:border-b-0"
                            >
                                <Label
                                    htmlFor={`list-cf-filter-${surface}-${field.custom_field_id}`}
                                    className="cursor-pointer text-sm font-medium text-neutral-800"
                                >
                                    {field.field_name}
                                </Label>
                                <div className="flex items-center gap-8 pr-1">
                                    <Switch
                                        id={`list-cf-filter-${surface}-${field.custom_field_id}`}
                                        checked={filterSet.has(field.custom_field_id)}
                                        onCheckedChange={(v) =>
                                            toggle('filterFields', field.custom_field_id, v)
                                        }
                                    />
                                    <Switch
                                        id={`list-cf-sort-${surface}-${field.custom_field_id}`}
                                        checked={sortSet.has(field.custom_field_id)}
                                        onCheckedChange={(v) =>
                                            toggle('sortableFields', field.custom_field_id, v)
                                        }
                                    />
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </CardContent>
        </Card>
    );
};
