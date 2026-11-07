import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { MyButton } from '@/components/design-system/button';
import { SearchableSelect, prefixFirstFilter } from '@/components/design-system/searchable-select';
import { toast } from 'sonner';
import { getCurrentInstituteId } from '@/lib/auth/instituteUtils';
import { formatDateTime } from '@/lib/formatters';
import {
    Copy,
    Check,
    ArrowSquareOut,
    Trash,
    Plus,
    PencilSimple,
    X,
    Pulse,
    ArrowsClockwise,
    Warning,
    CircleNotch,
    CloudArrowDown,
} from '@phosphor-icons/react';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import {
    initiateMetaOAuth,
    getSessionPages,
    getFormFields,
    listPageForms,
    resolvePageById,
    saveMetaConnector,
    saveGoogleConnector,
    listConnectors,
    deactivateConnector,
    updateConnector,
    checkConnectorHealth,
    resubscribeConnector,
    pollConnectorNow,
    buildGoogleWebhookUrl,
    connectorDisplayId,
    campaignRoutesQueryKey,
    deleteCampaignRoute,
    fetchCampaignRoutes,
    updateCampaignRoute,
    setCampaignAutoLists,
    type CampaignRoute,
    type CampaignRoutes,
    type CampaignRouteUpdate,
    fetchAudienceCustomFields,
    buildFieldMappingJson,
    type MetaPage,
    type ConnectorListItem,
    type ConnectorHealth,
    type PlatformFormField,
    type AudienceCustomField,
} from '../-services/ad-platform-service';
import { AUDIENCE_CAMPAIGNS_LIST } from '@/constants/urls';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import {
    buildCampaignTypeFilterOptions,
    buildDefaultCampaignTypeOptions,
    filterByCampaignTypes,
} from '@/routes/audience-manager/list/-utils/campaign-types';
import { useLeadTerminology } from '@/hooks/use-lead-terminology';
import { EvaluationApiKeysCard } from './EvaluationApiKeysCard';
import { CatalogApiCard } from './catalog-api/CatalogApiCard';

// ── Audience list hook ───────────────────────────────────────────────────────

interface AudienceOption {
    id: string;
    name: string;
    campaignType?: string;
    status?: string;
}

function useAudienceList(instituteId: string) {
    return useQuery({
        queryKey: ['audience-list-for-integrations', instituteId],
        queryFn: async (): Promise<AudienceOption[]> => {
            const res = await authenticatedAxiosInstance.post(AUDIENCE_CAMPAIGNS_LIST, {
                institute_id: instituteId,
                page: 0,
                size: 200,
            });
            const items = res.data?.content ?? [];
            return items.map(
                (c: {
                    id?: string;
                    audience_id?: string;
                    campaign_name: string;
                    campaign_type?: string;
                    status?: string;
                }) => ({
                    id: c.audience_id ?? c.id ?? '',
                    name: c.campaign_name,
                    campaignType: c.campaign_type,
                    status: c.status,
                })
            );
        },
        enabled: !!instituteId,
        staleTime: 60_000,
    });
}

// ── Campaign type → audience picker ─────────────────────────────────────────
// Picking a campaign type narrows the audience list to audiences of that type.
// The type is only a filter — it is not saved on the connector. "All campaign
// types" (the default) lists every audience, as before. Renders two grid cells
// so it slots into the forms' existing two-column grid.

function AudiencePickerByType({
    audiences,
    audienceId,
    onAudienceChange,
    audienceLabel,
    audiencePlaceholder,
}: {
    audiences: AudienceOption[];
    audienceId: string;
    onAudienceChange: (id: string) => void;
    audienceLabel: string;
    audiencePlaceholder: string;
}) {
    const { t } = useTranslation('settingsIntegration');
    const { campaignType: term } = useLeadTerminology();
    const { t: tCampaignType } = useTranslation('audienceManagerCampaignTypeDropdown');
    const [campaignType, setCampaignType] = useState('');
    const typeOptions = buildCampaignTypeFilterOptions(
        buildDefaultCampaignTypeOptions(tCampaignType),
        audiences.map((a) => a.campaignType)
    );
    const visibleAudiences = filterByCampaignTypes(audiences, campaignType ? [campaignType] : []);

    const handleTypeChange = (type: string) => {
        setCampaignType(type);
        // A picked audience of another type would be hidden yet still saved — clear it.
        const stillVisible = filterByCampaignTypes(audiences, type ? [type] : []).some(
            (a) => a.id === audienceId
        );
        if (audienceId && !stillVisible) onAudienceChange('');
    };

    return (
        <>
            <div className="space-y-1">
                <Label className="text-xs">{t('campaignTypeFilter.label', { term })}</Label>
                <select
                    className="w-full rounded-md border bg-white px-3 py-2 text-sm"
                    value={campaignType}
                    onChange={(e) => handleTypeChange(e.target.value)}
                >
                    <option value="">{t('campaignTypeFilter.all', { term })}</option>
                    {typeOptions.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                            {opt.label}
                        </option>
                    ))}
                </select>
            </div>
            <div className="space-y-1">
                <Label className="text-xs">{audienceLabel}</Label>
                <select
                    className="w-full rounded-md border bg-white px-3 py-2 text-sm"
                    value={audienceId}
                    onChange={(e) => onAudienceChange(e.target.value)}
                >
                    <option value="">
                        {visibleAudiences.length === 0 && campaignType
                            ? t('campaignTypeFilter.noAudiences')
                            : audiencePlaceholder}
                    </option>
                    {visibleAudiences.map((a) => (
                        <option key={a.id} value={a.id}>
                            {a.name}
                        </option>
                    ))}
                </select>
            </div>
        </>
    );
}

// ── Derive a short label from a Lead Gen Form name ──────────────────────────
// Takes the first token before `_` or whitespace. Useful as an auto-prefill for
// per-connector default values (e.g. `Wakad_leadform_2026` → `Wakad`).
const firstTokenOfFormName = (formName: string | undefined): string => {
    if (!formName) return '';
    const token = formName.split(/[_\s]/).find(Boolean) ?? '';
    return token.trim();
};

// ── Field mapping builder ─────────────────────────────────────────────────────

interface MappingRow {
    platformKey: string;
    targetFieldName: string;
}

function FieldMappingBuilder({
    platformFields,
    audienceFields,
    value,
    onChange,
}: {
    platformFields: PlatformFormField[];
    audienceFields: AudienceCustomField[];
    value: MappingRow[];
    onChange: (rows: MappingRow[]) => void;
}) {
    const { t } = useTranslation('settingsIntegration');
    // Auto-populate unmapped platform fields
    useEffect(() => {
        if (platformFields.length > 0 && value.length === 0) {
            const initial = platformFields.map((pf) => {
                // Try auto-match by name similarity
                const match = audienceFields.find(
                    (af) => af.fieldName.toLowerCase().trim() === pf.key.toLowerCase().trim()
                );
                return { platformKey: pf.key, targetFieldName: match?.fieldName ?? '' };
            });
            onChange(initial);
        }
    }, [platformFields, audienceFields]);

    const updateRow = (idx: number, target: string) => {
        const updated = [...value];
        updated[idx] = { ...updated[idx]!, targetFieldName: target };
        onChange(updated);
    };

    if (platformFields.length === 0) return null;

    return (
        <div className="space-y-2">
            <Label className="text-xs font-medium">{t('fieldMapping.label')}</Label>
            <p className="text-xs text-muted-foreground">{t('fieldMapping.description')}</p>
            <div className="space-y-1.5 rounded-md border bg-neutral-50 p-3">
                <div className="grid grid-cols-[1fr_24px_1fr] gap-2 text-caption font-medium uppercase tracking-wider text-neutral-400">
                    <span>{t('fieldMapping.platformField')}</span>
                    <span />
                    <span>{t('fieldMapping.audienceField')}</span>
                </div>
                {value.map((row, idx) => (
                    <div
                        key={row.platformKey}
                        className="grid grid-cols-[1fr_24px_1fr] items-center gap-2"
                    >
                        <div className="truncate rounded bg-white px-2 py-1.5 text-xs">
                            {platformFields.find((p) => p.key === row.platformKey)?.label ??
                                row.platformKey}
                        </div>
                        <span className="text-center text-xs text-neutral-300">→</span>
                        <select
                            className="rounded border bg-white px-2 py-1.5 text-xs"
                            value={row.targetFieldName}
                            onChange={(e) => updateRow(idx, e.target.value)}
                        >
                            <option value="">{t('fieldMapping.skipOption')}</option>
                            {audienceFields.map((af) => (
                                <option key={af.id} value={af.fieldName}>
                                    {af.fieldName}
                                </option>
                            ))}
                        </select>
                    </div>
                ))}
            </div>
        </div>
    );
}

// ── Connector edit dialog (per-center default values) ──────────────────────

interface KeyValueRow {
    key: string;
    value: string;
}

const parseDefaultValues = (json: string | null | undefined): KeyValueRow[] => {
    if (!json) return [];
    try {
        const parsed = JSON.parse(json);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            return Object.entries(parsed as Record<string, unknown>).map(([key, value]) => ({
                key,
                value: value == null ? '' : String(value),
            }));
        }
    } catch {
        // ignore — show empty editor and let admin start fresh
    }
    return [];
};

const serializeDefaultValues = (rows: KeyValueRow[]): string => {
    const obj: Record<string, string> = {};
    rows.forEach((r) => {
        const k = r.key.trim();
        if (k) obj[k] = r.value;
    });
    return JSON.stringify(obj);
};

function ConnectorEditDialog({
    connector,
    open,
    onOpenChange,
    onSave,
    isSaving,
}: {
    connector: ConnectorListItem | null;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onSave: (rows: KeyValueRow[]) => void;
    isSaving: boolean;
}) {
    const { t } = useTranslation('settingsIntegration');
    const [rows, setRows] = useState<KeyValueRow[]>([]);

    useEffect(() => {
        if (open && connector) {
            const initial = parseDefaultValues(connector.defaultValuesJson);
            setRows(initial.length > 0 ? initial : [{ key: '', value: '' }]);
        }
    }, [open, connector]);

    const updateRow = (idx: number, patch: Partial<KeyValueRow>) => {
        setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
    };
    const addRow = () => setRows((prev) => [...prev, { key: '', value: '' }]);
    const removeRow = (idx: number) =>
        setRows((prev) => (prev.length === 1 ? prev : prev.filter((_, i) => i !== idx)));

    const handleSave = () => {
        onSave(rows);
    };

    const hasDuplicateKeys = (() => {
        const seen = new Set<string>();
        for (const r of rows) {
            const k = r.key.trim();
            if (!k) continue;
            if (seen.has(k)) return true;
            seen.add(k);
        }
        return false;
    })();

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-xl">
                <DialogHeader>
                    <DialogTitle>{t('editDialog.title')}</DialogTitle>
                    <DialogDescription>{t('editDialog.description')}</DialogDescription>
                </DialogHeader>

                <div className="space-y-2">
                    <div className="grid grid-cols-[1fr_1fr_28px] gap-2 text-caption font-medium uppercase tracking-wider text-neutral-400">
                        <span>{t('editDialog.keyHeader')}</span>
                        <span>{t('editDialog.valueHeader')}</span>
                        <span />
                    </div>
                    {rows.map((row, idx) => (
                        <div
                            key={idx}
                            className="grid grid-cols-[1fr_1fr_28px] items-center gap-2"
                        >
                            <Input
                                value={row.key}
                                onChange={(e) => updateRow(idx, { key: e.target.value })}
                                placeholder={t('editDialog.keyPlaceholder')}
                            />
                            <Input
                                value={row.value}
                                onChange={(e) => updateRow(idx, { value: e.target.value })}
                                placeholder={t('editDialog.valuePlaceholder')}
                            />
                            <button
                                type="button"
                                onClick={() => removeRow(idx)}
                                className="text-neutral-400 hover:text-red-600"
                                title={t('editDialog.removeRow')}
                            >
                                <X className="size-4" />
                            </button>
                        </div>
                    ))}
                    <Button variant="outline" size="sm" onClick={addRow} className="gap-1">
                        <Plus className="size-3.5" />
                        {t('editDialog.addField')}
                    </Button>
                    {hasDuplicateKeys && (
                        <p className="text-xs text-red-600">{t('editDialog.duplicateKeys')}</p>
                    )}
                </div>

                <DialogFooter>
                    <Button
                        variant="outline"
                        onClick={() => onOpenChange(false)}
                        disabled={isSaving}
                    >
                        {t('editDialog.cancel')}
                    </Button>
                    <Button onClick={handleSave} disabled={isSaving}>
                        {isSaving ? t('editDialog.saving') : t('editDialog.save')}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

// ── Connector table ──────────────────────────────────────────────────────────

const VENDOR_LABELS: Record<string, { labelKey: string; color: string; bg: string }> = {
    META_LEAD_ADS: { labelKey: 'vendor.meta', color: 'text-blue-700', bg: 'bg-blue-100' },
    GOOGLE_LEAD_ADS: { labelKey: 'vendor.google', color: 'text-red-700', bg: 'bg-red-100' },
};

function ConnectorTable({
    connectors,
    audiences,
    onDelete,
    onEdit,
    onTest,
    onResubscribe,
    onSyncNow,
    onGoogleSetup,
    testingId,
    syncingId,
}: {
    connectors: ConnectorListItem[];
    audiences: AudienceOption[];
    onDelete: (id: string) => void;
    onEdit: (connector: ConnectorListItem) => void;
    onTest: (id: string) => void;
    onResubscribe: (id: string) => void;
    onSyncNow: (id: string) => void;
    onGoogleSetup: (id: string) => void;
    testingId: string | null;
    syncingId: string | null;
}) {
    const { t } = useTranslation('settingsIntegration');
    const [copiedId, setCopiedId] = useState<string | null>(null);
    const audienceNameById = new Map(audiences.map((a) => [a.id, a.name]));

    if (connectors.length === 0) {
        return (
            <div className="flex flex-col items-center gap-2 rounded-xl border-2 border-dashed border-neutral-200 bg-neutral-50/50 py-8 text-center">
                <p className="text-sm font-medium text-neutral-500">{t('table.emptyTitle')}</p>
                <p className="text-xs text-neutral-400">{t('table.emptyDescription')}</p>
            </div>
        );
    }

    const copyWebhookUrl = (c: ConnectorListItem) => {
        if (c.vendor === 'GOOGLE_LEAD_ADS' && c.platformFormId) {
            navigator.clipboard.writeText(buildGoogleWebhookUrl(c.platformFormId));
            setCopiedId(c.id);
            setTimeout(() => setCopiedId(null), 2000);
        }
    };

    // Google Ads asks for the key separately from the URL; vendorId is that key.
    const copyGoogleKey = (c: ConnectorListItem) => {
        if (c.vendor === 'GOOGLE_LEAD_ADS' && c.vendorId) {
            navigator.clipboard.writeText(c.vendorId);
            setCopiedId(`${c.id}:key`);
            setTimeout(() => setCopiedId(null), 2000);
        }
    };

    return (
        <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-left text-sm">
                <thead className="border-b bg-neutral-50 text-caption text-neutral-500">
                    <tr>
                        <th className="px-4 py-2">{t('table.headers.platform')}</th>
                        <th className="px-4 py-2">{t('table.headers.formCampaign')}</th>
                        <th className="px-4 py-2">{t('table.headers.audience')}</th>
                        <th className="px-4 py-2">{t('table.headers.source')}</th>
                        <th className="px-4 py-2">{t('table.headers.connectedOn')}</th>
                        <th className="px-4 py-2">{t('table.headers.status')}</th>
                        <th className="px-4 py-2">{t('table.headers.webhook')}</th>
                        <th className="px-4 py-2" />
                    </tr>
                </thead>
                <tbody>
                    {connectors.map((c) => {
                        const v = VENDOR_LABELS[c.vendor];
                        const vendorLabel = v ? t(v.labelKey) : c.vendor;
                        const vendorColor = v?.color ?? 'text-neutral-700';
                        const vendorBg = v?.bg ?? 'bg-neutral-100';
                        // A Google connector's form id is its webhook key, a credential: show a
                        // name instead, and only the key's last four characters.
                        const displayName =
                            c.platformFormName ??
                            (c.vendor === 'GOOGLE_LEAD_ADS' ? t('table.googleUnnamed') : null);
                        const displayId = connectorDisplayId(c);
                        return (
                            <tr key={c.id} className="border-b last:border-0">
                                <td className="px-4 py-2.5">
                                    <span
                                        className={`rounded px-2 py-0.5 text-xs font-medium ${vendorBg} ${vendorColor}`}
                                    >
                                        {vendorLabel}
                                    </span>
                                </td>
                                <td className="max-w-xs px-4 py-2.5 text-sm">
                                    {displayName ? (
                                        <>
                                            <div
                                                className="truncate font-medium"
                                                title={displayName}
                                            >
                                                {displayName}
                                            </div>
                                            <div
                                                className="whitespace-nowrap font-mono text-caption text-neutral-400"
                                                title={displayId ?? undefined}
                                            >
                                                {displayId ?? '-'}
                                            </div>
                                        </>
                                    ) : (
                                        <span
                                            className="whitespace-nowrap font-mono text-caption text-neutral-600"
                                            title={displayId ?? undefined}
                                        >
                                            {displayId ?? '-'}
                                        </span>
                                    )}
                                </td>
                                <td className="max-w-sm px-4 py-2.5 text-sm">
                                    {audienceNameById.get(c.audienceId) ? (
                                        <>
                                            <div className="truncate font-medium">
                                                {audienceNameById.get(c.audienceId)}
                                            </div>
                                            <div
                                                className="whitespace-nowrap font-mono text-caption text-neutral-400"
                                                title={c.audienceId}
                                            >
                                                {c.audienceId}
                                            </div>
                                        </>
                                    ) : (
                                        <span
                                            className="whitespace-nowrap font-mono text-caption text-neutral-500"
                                            title={c.audienceId}
                                        >
                                            {c.audienceId}
                                        </span>
                                    )}
                                </td>
                                <td className="px-4 py-2.5 text-xs text-neutral-500">
                                    {c.producesSourceType ?? '-'}
                                </td>
                                {/* When the link was established. createdAt is the row's own
                                    creation, so re-authorising an existing connector keeps the
                                    original date rather than resetting it — which is what
                                    "when did we connect this form" means. */}
                                <td
                                    className="whitespace-nowrap px-4 py-2.5 text-xs text-neutral-500"
                                    title={c.createdAt ?? undefined}
                                >
                                    {c.createdAt
                                        ? new Date(c.createdAt).toLocaleDateString(undefined, {
                                              day: 'numeric',
                                              month: 'short',
                                              year: 'numeric',
                                          })
                                        : t('table.neverConnected')}
                                </td>
                                <td className="px-4 py-2.5">
                                    {c.connectionStatus === 'ACTIVE' ? (
                                        <span className="text-xs font-medium text-success-600">
                                            {t('table.statusActive')}
                                        </span>
                                    ) : c.connectionStatus === 'ACTION_REQUIRED' ? (
                                        <span
                                            className="inline-flex items-center gap-1 text-xs font-medium text-warning-700"
                                            title={c.statusDetail ?? undefined}
                                        >
                                            <Warning className="size-3.5" weight="fill" />
                                            {t('table.statusActionNeeded')}
                                        </span>
                                    ) : (
                                        <span className="text-xs font-medium text-neutral-400">
                                            {c.connectionStatus}
                                        </span>
                                    )}
                                    {c.connectionStatus === 'ACTION_REQUIRED' &&
                                        c.statusDetail && (
                                            <p className="mt-0.5 max-w-xs text-caption leading-snug text-warning-700">
                                                {c.statusDetail}
                                            </p>
                                        )}
                                    {c.vendor === 'GOOGLE_LEAD_ADS' &&
                                        (c.unmappedCampaigns ?? 0) > 0 && (
                                            <button
                                                onClick={() => onGoogleSetup(c.id)}
                                                className="mt-1 block rounded-full bg-warning-50 px-2 py-0.5 text-caption font-medium text-warning-700 hover:bg-warning-100"
                                            >
                                                {t('table.unmappedCampaigns', {
                                                    count: c.unmappedCampaigns ?? 0,
                                                })}
                                            </button>
                                        )}
                                </td>
                                <td className="px-4 py-2.5">
                                    {c.vendor === 'GOOGLE_LEAD_ADS' && c.platformFormId && (
                                        <div className="flex items-center gap-3">
                                            <button
                                                onClick={() => copyWebhookUrl(c)}
                                                className="flex items-center gap-1 text-xs text-neutral-400 hover:text-neutral-700"
                                                title={t('table.copyWebhookUrl')}
                                            >
                                                {copiedId === c.id ? (
                                                    <Check className="size-4 text-green-600" />
                                                ) : (
                                                    <Copy className="size-4" />
                                                )}
                                                {t('table.urlLabel')}
                                            </button>
                                            {c.vendorId && (
                                                <button
                                                    onClick={() => copyGoogleKey(c)}
                                                    className="flex items-center gap-1 text-xs text-neutral-400 hover:text-neutral-700"
                                                    title={t('table.copyKey')}
                                                >
                                                    {copiedId === `${c.id}:key` ? (
                                                        <Check className="size-4 text-green-600" />
                                                    ) : (
                                                        <Copy className="size-4" />
                                                    )}
                                                    {t('table.keyLabel')}
                                                </button>
                                            )}
                                        </div>
                                    )}
                                    {c.vendor === 'META_LEAD_ADS' && (
                                        <span className="text-xs text-neutral-400">
                                            {t('table.autoLabel')}
                                        </span>
                                    )}
                                </td>
                                <td className="px-4 py-2.5">
                                    <div className="flex items-center gap-2">
                                        {c.vendor === 'META_LEAD_ADS' && (
                                            <button
                                                onClick={() => onSyncNow(c.id)}
                                                disabled={syncingId === c.id}
                                                className="text-neutral-400 hover:text-primary-600 disabled:opacity-50"
                                                title={t('table.syncNow')}
                                            >
                                                {syncingId === c.id ? (
                                                    <CircleNotch className="size-4 animate-spin" />
                                                ) : (
                                                    <CloudArrowDown className="size-4" />
                                                )}
                                            </button>
                                        )}
                                        {c.vendor === 'META_LEAD_ADS' && (
                                            <button
                                                onClick={() => onTest(c.id)}
                                                disabled={testingId === c.id}
                                                className="text-neutral-400 hover:text-primary-600 disabled:opacity-50"
                                                title={t('table.testConnection')}
                                            >
                                                {testingId === c.id ? (
                                                    <CircleNotch className="size-4 animate-spin" />
                                                ) : (
                                                    <Pulse className="size-4" />
                                                )}
                                            </button>
                                        )}
                                        {c.vendor === 'META_LEAD_ADS' &&
                                            c.connectionStatus === 'ACTION_REQUIRED' && (
                                                <button
                                                    onClick={() => onResubscribe(c.id)}
                                                    className="text-neutral-400 hover:text-success-600"
                                                    title={t('table.resubscribeTooltip')}
                                                >
                                                    <ArrowsClockwise className="size-4" />
                                                </button>
                                            )}
                                        {c.vendor === 'GOOGLE_LEAD_ADS' && (
                                            <button
                                                onClick={() => onGoogleSetup(c.id)}
                                                className="text-neutral-400 hover:text-primary-600"
                                                title={t('table.googleSetup')}
                                            >
                                                <Pulse className="size-4" />
                                            </button>
                                        )}
                                        <button
                                            onClick={() => onEdit(c)}
                                            className="text-neutral-400 hover:text-primary-600"
                                            title={t('table.editDefaultValues')}
                                        >
                                            <PencilSimple className="size-4" />
                                        </button>
                                        <button
                                            onClick={() => onDelete(c.id)}
                                            className="text-neutral-400 hover:text-danger-600"
                                            title={t('table.deactivateConnector')}
                                        >
                                            <Trash className="size-4" />
                                        </button>
                                    </div>
                                </td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
}

// ── Connection health dialog ──────────────────────────────────────────────────

const HEALTH_STATUS_STYLES: Record<string, string> = {
    PASS: 'text-success-600',
    WARN: 'text-warning-700',
    FAIL: 'text-danger-600',
    SKIP: 'text-neutral-400',
};

const OVERALL_LABELS: Record<string, { labelKey: string; className: string }> = {
    VERIFIED: { labelKey: 'health.overall.verified', className: 'text-success-600' },
    DEGRADED: { labelKey: 'health.overall.degraded', className: 'text-warning-700' },
    ACTION_REQUIRED: {
        labelKey: 'health.overall.actionRequired',
        className: 'text-warning-700',
    },
    BROKEN: { labelKey: 'health.overall.broken', className: 'text-danger-600' },
    UNKNOWN: { labelKey: 'health.overall.unknown', className: 'text-neutral-500' },
};

function ConnectorHealthDialog({
    health,
    open,
    onOpenChange,
    onResubscribe,
}: {
    health: ConnectorHealth | null;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onResubscribe: (id: string) => void;
}) {
    const { t } = useTranslation('settingsIntegration');
    if (!health) return null;
    const overall = OVERALL_LABELS[health.overall] ?? OVERALL_LABELS.UNKNOWN!;
    const needsResubscribe = health.checks.some(
        (c) => c.key === 'SUBSCRIPTION' && c.status === 'FAIL'
    );

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-lg">
                <DialogHeader>
                    <DialogTitle>{t('health.dialogTitle')}</DialogTitle>
                    <DialogDescription>
                        {t('health.statusLabel')}{' '}
                        <span className={`font-semibold ${overall.className}`}>
                            {t(overall.labelKey)}
                        </span>
                        {health.lastLeadAt && (
                            <>
                                {' · '}
                                {t('health.lastLead')}{' '}
                                {new Date(health.lastLeadAt).toLocaleString()}
                            </>
                        )}
                    </DialogDescription>
                </DialogHeader>

                <ul className="space-y-2.5">
                    {health.checks.map((c) => (
                        <li key={c.key} className="flex items-start gap-2 text-sm">
                            <span
                                className={`mt-0.5 shrink-0 ${
                                    HEALTH_STATUS_STYLES[c.status] ?? 'text-neutral-400'
                                }`}
                            >
                                {c.status === 'PASS' ? (
                                    <Check className="size-4" weight="bold" />
                                ) : c.status === 'SKIP' ? (
                                    <X className="size-4" />
                                ) : (
                                    <Warning className="size-4" weight="fill" />
                                )}
                            </span>
                            <div>
                                <p className="font-medium text-neutral-700">{c.label}</p>
                                <p className="text-caption text-neutral-500">{c.message}</p>
                                {c.remediation && c.status !== 'PASS' && (
                                    <p className="mt-0.5 text-caption text-warning-700">
                                        {c.remediation}
                                    </p>
                                )}
                            </div>
                        </li>
                    ))}
                </ul>

                <DialogFooter>
                    {needsResubscribe && (
                        <MyButton
                            buttonType="secondary"
                            scale="medium"
                            onClick={() => onResubscribe(health.connectorId)}
                        >
                            <ArrowsClockwise className="size-4" />
                            {t('health.resubscribe')}
                        </MyButton>
                    )}
                    <MyButton scale="medium" onClick={() => onOpenChange(false)}>
                        {t('health.close')}
                    </MyButton>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

// ── Add Google form ──────────────────────────────────────────────────────────

/** One read-only value with a copy button — the Google setup panel shows two. */
function CopyableValue({ label, value }: { label: string; value: string }) {
    const [copied, setCopied] = useState(false);
    return (
        <div className="space-y-1">
            <Label className="text-xs">{label}</Label>
            <div className="flex items-center gap-2 rounded-md border bg-neutral-50 px-3 py-2">
                <code className="flex-1 truncate text-xs">{value}</code>
                <button
                    onClick={() => {
                        navigator.clipboard.writeText(value);
                        setCopied(true);
                        setTimeout(() => setCopied(false), 2000);
                    }}
                    className="shrink-0 text-neutral-500 hover:text-neutral-700"
                    title={label}
                >
                    {copied ? (
                        <Check className="size-4 text-green-600" />
                    ) : (
                        <Copy className="size-4" />
                    )}
                </button>
            </div>
        </div>
    );
}

/** The server sends zone-less LocalDateTime strings; the admin_core JVM runs in UTC. */
function parseServerUtc(value: string): Date {
    return new Date(/([zZ]|[+-]\d\d:\d\d)$/.test(value) ? value : `${value}Z`);
}

/** The Google Ads side of the setup, in the order the admin does it. */
function GoogleSetupSteps() {
    const { t } = useTranslation('settingsIntegration');
    return (
        <ol className="list-decimal space-y-1.5 ps-5 text-sm text-neutral-700">
            <li>{t('google.setupStep1')}</li>
            <li>{t('google.setupStep2')}</li>
            <li>{t('google.setupStep3')}</li>
            <li>{t('google.setupStep4')}</li>
            <li>{t('google.setupStep5')}</li>
        </ol>
    );
}

/**
 * Whether Google has reached this connector yet and how that went. The webhook stamps
 * lastCheckedAt on every delivery with a known key; statusDetail says why one failed.
 */
function GoogleDeliveryStatus({ connector }: { connector: ConnectorListItem }) {
    const { t } = useTranslation('settingsIntegration');
    if (!connector.lastCheckedAt) {
        return (
            <div className="flex items-start gap-2 rounded-md border bg-neutral-50 p-3 text-sm text-neutral-600">
                <CircleNotch className="mt-0.5 size-4 shrink-0 animate-spin" />
                <span>{t('google.statusWaiting')}</span>
            </div>
        );
    }
    const when = formatDateTime(parseServerUtc(connector.lastCheckedAt), { second: '2-digit' });
    if (connector.connectionStatus === 'ACTION_REQUIRED') {
        return (
            <div className="flex items-start gap-2 rounded-md border border-warning-200 bg-warning-50 p-3 text-sm text-warning-700">
                <Warning className="mt-0.5 size-4 shrink-0" weight="fill" />
                <span>
                    {connector.statusDetail ?? t('table.statusActionNeeded')}{' '}
                    <span className="text-caption">({when})</span>
                </span>
            </div>
        );
    }
    return (
        <div className="flex items-start gap-2 rounded-md border border-success-200 bg-success-50 p-3 text-sm text-success-700">
            <Check className="mt-0.5 size-4 shrink-0" weight="bold" />
            <span>{t('google.statusReceived', { time: when })}</span>
        </div>
    );
}

/** Rename a Google connector: the list shows this name, never the key (a credential). */
function GoogleConnectorName({ connector }: { connector: ConnectorListItem }) {
    const { t } = useTranslation('settingsIntegration');
    const queryClient = useQueryClient();
    // null = not edited; the list refetches every few seconds while the dialog is open.
    const [draft, setDraft] = useState<string | null>(null);
    const current = connector.platformFormName ?? '';
    const value = draft ?? current;

    const { mutate: rename, isPending } = useMutation({
        mutationFn: () => updateConnector(connector.id, { platformFormName: value.trim() }),
        onSuccess: () => {
            toast.success(t('google.nameSaved'));
            setDraft(null);
            queryClient.invalidateQueries({ queryKey: ['ad-connectors'] });
        },
        onError: () => toast.error(t('google.nameSaveError')),
    });

    return (
        <div className="space-y-1">
            <Label className="text-xs">{t('google.connectorNameLabel')}</Label>
            <div className="flex gap-2">
                <Input
                    value={value}
                    placeholder={t('google.connectorNamePlaceholder')}
                    onChange={(e) => setDraft(e.target.value)}
                />
                <MyButton
                    buttonType="secondary"
                    scale="small"
                    onClick={() => rename()}
                    disable={isPending || value.trim() === current}
                >
                    {isPending ? t('google.saving') : t('google.nameSave')}
                </MyButton>
            </div>
        </div>
    );
}

/** Select value meaning "create a new list for this campaign". */
const CREATE_LIST = '__create_list__';

/** Server message from a failed request, or the fallback. */
function apiErrorMessage(err: unknown, fallback: string): string {
    return (
        (err as { response?: { data?: { message?: string; ex?: string } } })?.response?.data
            ?.message ??
        (err as { response?: { data?: { ex?: string } } })?.response?.data?.ex ??
        fallback
    );
}

/**
 * One campaign's routing row: where its leads go, with an inline "create a new list"
 * and the option to move the campaign's existing leads along. With `route` null it is
 * the "add a campaign" row (the admin types a campaign id from Google Ads).
 */
function CampaignRouteRow({
    connectorId,
    route,
    mainAudienceId,
    lists,
}: {
    connectorId: string;
    route: CampaignRoute | null;
    mainAudienceId: string;
    lists: AudienceOption[];
}) {
    const { t } = useTranslation('settingsIntegration');
    const { campaignType: term } = useLeadTerminology();
    const { t: tCampaignType } = useTranslation('audienceManagerCampaignTypeDropdown');
    const queryClient = useQueryClient();
    const isNew = route === null;
    const current = route?.audience_id ?? '';
    const [campaignId, setCampaignId] = useState('');
    const [campaignName, setCampaignName] = useState('');
    const [editingName, setEditingName] = useState(false);
    const [nameDraft, setNameDraft] = useState('');
    const [selection, setSelection] = useState(current);
    const [newListName, setNewListName] = useState('');
    const [newListType, setNewListType] = useState('');
    const [moveExisting, setMoveExisting] = useState(true);

    const mainName = lists.find((l) => l.id === mainAudienceId)?.name;
    const typeOptions = buildCampaignTypeFilterOptions(
        buildDefaultCampaignTypeOptions(tCampaignType),
        lists.map((l) => l.campaignType)
    );
    const creating = selection === CREATE_LIST;
    // A new row can be saved with just a name: its list then comes later (or automatically).
    const dirty = isNew
        ? !!campaignId.trim() && (!!selection || !!campaignName.trim())
        : selection !== current;
    // Where this campaign's existing leads sit today (unmapped = the main list).
    const effectiveCurrent = current || mainAudienceId;
    const canMove =
        !isNew && (route?.lead_count ?? 0) > 0 && (creating || selection !== effectiveCurrent);

    const reset = () => {
        setSelection(current);
        setNewListName('');
        setNewListType('');
        setMoveExisting(true);
        if (isNew) {
            setCampaignId('');
            setCampaignName('');
        }
    };

    const refreshRoutes = () => {
        queryClient.invalidateQueries({ queryKey: campaignRoutesQueryKey(connectorId) });
        queryClient.invalidateQueries({ queryKey: ['ad-connectors'] });
    };

    const { mutate: save, isPending } = useMutation({
        mutationFn: () => {
            const update: CampaignRouteUpdate = { move_existing_leads: canMove && moveExisting };
            if (creating) {
                update.new_list = {
                    name: newListName.trim(),
                    campaign_type: newListType || undefined,
                };
            } else if (selection) {
                update.audience_id = selection;
            }
            if (isNew && campaignName.trim()) update.campaign_name = campaignName.trim();
            return updateCampaignRoute(
                connectorId,
                isNew ? campaignId.trim() : route!.campaign_id,
                update
            );
        },
        onSuccess: (result) => {
            if (!creating && !selection) {
                toast.success(t('google.routes.nameSaved'));
            } else {
                const listName = creating
                    ? newListName.trim()
                    : lists.find((l) => l.id === result.route.audience_id)?.name ?? '';
                toast.success(t('google.routes.saved', { list: listName }));
            }
            if (result.moved_leads > 0) {
                toast.info(t('google.routes.moved', { count: result.moved_leads }));
            }
            if (result.skipped_leads > 0) {
                toast.warning(t('google.routes.skipped', { count: result.skipped_leads }));
            }
            refreshRoutes();
            if (result.created_audience_id) {
                queryClient.invalidateQueries({ queryKey: ['audience-list-for-integrations'] });
            }
            if (isNew) reset();
            else {
                setNewListName('');
                setNewListType('');
            }
        },
        onError: (err) => toast.error(apiErrorMessage(err, t('google.routes.saveError'))),
    });

    const { mutate: saveName, isPending: isSavingName } = useMutation({
        mutationFn: () =>
            updateCampaignRoute(connectorId, route!.campaign_id, {
                campaign_name: nameDraft.trim(),
            }),
        onSuccess: () => {
            toast.success(t('google.routes.nameSaved'));
            setEditingName(false);
            refreshRoutes();
            // Naming a campaign also renames its automatically named list.
            queryClient.invalidateQueries({ queryKey: ['audience-list-for-integrations'] });
        },
        onError: (err) => toast.error(apiErrorMessage(err, t('google.routes.saveError'))),
    });

    const { mutate: remove, isPending: isRemoving } = useMutation({
        mutationFn: () => deleteCampaignRoute(connectorId, route!.campaign_id),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: campaignRoutesQueryKey(connectorId) });
            queryClient.invalidateQueries({ queryKey: ['ad-connectors'] });
        },
        onError: (err) => toast.error(apiErrorMessage(err, t('google.routes.saveError'))),
    });

    // Keep the select in step with the server after a save or a refetch.
    useEffect(() => {
        setSelection(current);
    }, [current]);

    return (
        <div className="space-y-2 p-2.5">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <div className="min-w-0 sm:w-56">
                    {isNew ? (
                        <div className="space-y-1.5">
                            <Input
                                value={campaignId}
                                inputMode="numeric"
                                placeholder={t('google.routes.campaignIdPlaceholder')}
                                onChange={(e) => setCampaignId(e.target.value.replace(/\D/g, ''))}
                            />
                            <Input
                                value={campaignName}
                                placeholder={t('google.routes.campaignNamePlaceholder')}
                                onChange={(e) => setCampaignName(e.target.value)}
                            />
                        </div>
                    ) : (
                        <>
                            {editingName ? (
                                <div className="mb-1 flex items-center gap-1">
                                    <Input
                                        value={nameDraft}
                                        autoFocus
                                        placeholder={t('google.routes.campaignNamePlaceholder')}
                                        onChange={(e) => setNameDraft(e.target.value)}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter') saveName();
                                            if (e.key === 'Escape') setEditingName(false);
                                        }}
                                    />
                                    <button
                                        onClick={() => saveName()}
                                        disabled={isSavingName}
                                        className="text-primary-500 hover:text-primary-600 disabled:opacity-50"
                                        title={t('google.routes.save')}
                                    >
                                        <Check className="size-4" />
                                    </button>
                                    <button
                                        onClick={() => setEditingName(false)}
                                        className="text-neutral-400 hover:text-neutral-600"
                                        title={t('google.routes.cancel')}
                                    >
                                        <X className="size-4" />
                                    </button>
                                </div>
                            ) : (
                                <p className="flex items-center gap-1 text-sm font-medium text-neutral-800">
                                    <span className="truncate">
                                        {route!.campaign_name || (
                                            <span className="font-normal text-neutral-400">
                                                {t('google.routes.unnamed')}
                                            </span>
                                        )}
                                    </span>
                                    <button
                                        onClick={() => {
                                            setNameDraft(route!.campaign_name ?? '');
                                            setEditingName(true);
                                        }}
                                        className="shrink-0 text-neutral-400 hover:text-primary-500"
                                        title={t('google.routes.editName')}
                                        aria-label={t('google.routes.editName')}
                                    >
                                        <PencilSimple className="size-3.5" />
                                    </button>
                                </p>
                            )}
                            <p className="flex items-center gap-1.5 font-mono text-xs text-neutral-700">
                                {route!.campaign_id}
                                {!route!.audience_id && (
                                    <span className="rounded-full bg-warning-50 px-1.5 py-0.5 font-sans text-caption text-warning-700">
                                        {t('google.routes.notMapped')}
                                    </span>
                                )}
                            </p>
                            <p className="text-caption text-neutral-500">
                                {route!.lead_count > 0
                                    ? t('google.routes.leads', { count: route!.lead_count }) +
                                      (route!.last_lead_at
                                          ? ` · ${t('google.routes.lastLead', {
                                                time: formatDateTime(
                                                    parseServerUtc(route!.last_lead_at)
                                                ),
                                            })}`
                                          : '')
                                    : t('google.routes.noLeadsYet')}
                            </p>
                        </>
                    )}
                </div>
                <select
                    className="w-full flex-1 rounded-md border bg-white px-3 py-2 text-sm"
                    value={selection}
                    onChange={(e) => {
                        const value = e.target.value;
                        setSelection(value);
                        // A new list is usually named after its campaign.
                        if (value === CREATE_LIST && !newListName) {
                            setNewListName((isNew ? campaignName : route!.campaign_name) ?? '');
                        }
                    }}
                    aria-label={t('google.routes.listLabel')}
                >
                    {(isNew || !current) && (
                        <option value="">
                            {isNew
                                ? t('google.routes.chooseList')
                                : t('google.routes.unmappedOption', { list: mainName ?? '' })}
                        </option>
                    )}
                    <option value={mainAudienceId}>
                        {t('google.routes.mainListOption', { list: mainName ?? '' })}
                    </option>
                    {lists
                        .filter((l) => l.id !== mainAudienceId)
                        .map((l) => (
                            <option key={l.id} value={l.id}>
                                {l.name}
                            </option>
                        ))}
                    <option value={CREATE_LIST}>{t('google.routes.createListOption')}</option>
                </select>
                {!isNew && route!.lead_count === 0 && (
                    <button
                        onClick={() => remove()}
                        disabled={isRemoving}
                        className="text-neutral-400 hover:text-danger-600 disabled:opacity-50"
                        title={t('google.routes.remove')}
                    >
                        <Trash className="size-4" />
                    </button>
                )}
            </div>

            {creating && (
                <div className="grid gap-2 rounded-md bg-neutral-50 p-2.5 sm:grid-cols-2">
                    <div className="space-y-1">
                        <Label className="text-xs">{t('google.routes.newListName')}</Label>
                        <Input
                            value={newListName}
                            placeholder={t('google.routes.newListNamePlaceholder')}
                            onChange={(e) => setNewListName(e.target.value)}
                        />
                    </div>
                    <div className="space-y-1">
                        <Label className="text-xs">{t('campaignTypeFilter.label', { term })}</Label>
                        <select
                            className="w-full rounded-md border bg-white px-3 py-2 text-sm"
                            value={newListType}
                            onChange={(e) => setNewListType(e.target.value)}
                        >
                            <option value="">{t('google.routes.sameTypeAsMain')}</option>
                            {typeOptions.map((opt) => (
                                <option key={opt.value} value={opt.value}>
                                    {opt.label}
                                </option>
                            ))}
                        </select>
                    </div>
                    <p className="text-caption text-neutral-500 sm:col-span-2">
                        {t('google.routes.newListHint')}
                    </p>
                </div>
            )}

            {dirty && (
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    {canMove ? (
                        <label className="flex items-center gap-2 text-xs text-neutral-700">
                            <input
                                type="checkbox"
                                checked={moveExisting}
                                onChange={(e) => setMoveExisting(e.target.checked)}
                            />
                            {t('google.routes.moveExisting', { count: route!.lead_count })}
                        </label>
                    ) : (
                        <span />
                    )}
                    <div className="flex gap-2">
                        {!isNew && (
                            <MyButton buttonType="secondary" scale="small" onClick={reset}>
                                {t('google.routes.cancel')}
                            </MyButton>
                        )}
                        <MyButton
                            buttonType="primary"
                            scale="small"
                            onClick={() => save()}
                            disable={
                                isPending ||
                                (creating && !newListName.trim()) ||
                                (isNew && !selection && !campaignName.trim())
                            }
                        >
                            {isPending
                                ? t('google.saving')
                                : isNew
                                  ? t('google.routes.add')
                                  : t('google.routes.save')}
                        </MyButton>
                    </div>
                </div>
            )}
        </div>
    );
}

/**
 * Campaign → lead list routing. One Google lead form usually runs in several
 * campaigns; each campaign can send its leads to its own list (with that list's
 * workflows and counsellors). Campaigns without a list go to the main list, so a
 * new campaign never loses a lead.
 */
function GoogleCampaignRoutes({
    connector,
    audiences,
}: {
    connector: ConnectorListItem;
    audiences: AudienceOption[];
}) {
    const { t } = useTranslation('settingsIntegration');
    const queryClient = useQueryClient();
    const { data, isLoading } = useQuery({
        queryKey: campaignRoutesQueryKey(connector.id),
        queryFn: () => fetchCampaignRoutes(connector.id),
    });
    const { mutate: toggleAutoLists, isPending: isTogglingAutoLists } = useMutation({
        mutationFn: (enabled: boolean) => setCampaignAutoLists(connector.id, enabled),
        onSuccess: (result: CampaignRoutes) => {
            queryClient.setQueryData(campaignRoutesQueryKey(connector.id), result);
            toast.success(
                t(
                    result.auto_create_lists
                        ? 'google.routes.autoListsOn'
                        : 'google.routes.autoListsOff'
                )
            );
        },
        onError: (err) => toast.error(apiErrorMessage(err, t('google.routes.saveError'))),
    });
    const mainAudienceId = data?.main_audience_id ?? connector.audienceId;
    const mainName = audiences.find((a) => a.id === mainAudienceId)?.name ?? '';
    const mainType = audiences.find((a) => a.id === mainAudienceId)?.campaignType?.trim();
    const routes = data?.routes ?? [];
    // Leads can only be routed to a live list of the main list's type (Google lists
    // only, not every website/Facebook list of the institute). A list a campaign is
    // already routed to stays listed so the row still shows it.
    const mappedIds = new Set(routes.map((r) => r.audience_id).filter(Boolean));
    const activeLists = audiences.filter((a) => !a.status || a.status === 'ACTIVE');
    const sameType = new Set(
        filterByCampaignTypes(activeLists, mainType ? [mainType] : []).map((a) => a.id)
    );
    const lists = activeLists.filter(
        (a) => sameType.has(a.id) || a.id === mainAudienceId || mappedIds.has(a.id)
    );

    return (
        <div className="space-y-1.5">
            <p className="text-xs font-medium text-neutral-500">{t('google.routes.heading')}</p>
            <p className="text-caption text-neutral-500">
                {t('google.routes.hint', { list: mainName })}
            </p>
            {data && (
                <label className="flex items-start gap-2.5 rounded-md border bg-neutral-50 p-2.5">
                    <Switch
                        checked={data.auto_create_lists}
                        disabled={isTogglingAutoLists}
                        onCheckedChange={(checked) => toggleAutoLists(checked)}
                        aria-label={t('google.routes.autoListsLabel')}
                    />
                    <span className="space-y-0.5">
                        <span className="block text-sm font-medium text-neutral-800">
                            {t('google.routes.autoListsLabel')}
                        </span>
                        <span className="block text-caption text-neutral-500">
                            {t('google.routes.autoListsHint')}
                        </span>
                    </span>
                </label>
            )}
            {isLoading ? (
                <div className="flex items-center gap-2 text-sm text-neutral-500">
                    <CircleNotch className="size-4 animate-spin" />
                    {t('activeConnectors.loading')}
                </div>
            ) : (
                <div className="divide-y rounded-md border">
                    {routes.length === 0 && (
                        <p className="p-2.5 text-caption text-neutral-500">
                            {t('google.routes.empty')}
                        </p>
                    )}
                    {routes.map((r) => (
                        <CampaignRouteRow
                            key={r.campaign_id}
                            connectorId={connector.id}
                            route={r}
                            mainAudienceId={mainAudienceId}
                            lists={lists}
                        />
                    ))}
                    <div className="bg-neutral-50/50">
                        <p className="px-2.5 pt-2.5 text-caption font-medium text-neutral-600">
                            {t('google.routes.addHeading')}
                        </p>
                        <CampaignRouteRow
                            connectorId={connector.id}
                            route={null}
                            mainAudienceId={mainAudienceId}
                            lists={lists}
                        />
                    </div>
                </div>
            )}
        </div>
    );
}

const GOOGLE_SETUP_DIALOG_CLASS = 'flex max-h-[90vh] w-[95vw] max-w-2xl flex-col'; // design-lint-ignore: viewport-bounded so the guide scrolls on short screens

/**
 * Setup & status for one Google connector: the two values to paste, the Google Ads
 * steps, live delivery status (the parent polls the list while this is open) and what
 * Google's test errors mean. Opens right after a connector is created, and from the row.
 */
export function GoogleSetupDialog({
    connector,
    audienceName,
    audiences,
    open,
    onOpenChange,
}: {
    connector: ConnectorListItem | null;
    audienceName: string | undefined;
    audiences: AudienceOption[];
    open: boolean;
    onOpenChange: (open: boolean) => void;
}) {
    const { t } = useTranslation('settingsIntegration');
    const googleKey = connector?.vendorId;
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className={GOOGLE_SETUP_DIALOG_CLASS}>
                <DialogHeader>
                    <DialogTitle>{t('google.dialogTitle')}</DialogTitle>
                    <DialogDescription>
                        {audienceName
                            ? t('google.dialogDescription', { audience: audienceName })
                            : t('google.dialogDescriptionNoAudience')}
                    </DialogDescription>
                </DialogHeader>

                {/* Header and footer stay put; only the guide scrolls on short screens. */}
                <div className="-me-2 min-h-0 flex-1 overflow-y-auto pe-2">
                    {!connector || !googleKey ? (
                        <div className="flex items-center gap-2 py-4 text-sm text-neutral-500">
                            <CircleNotch className="size-4 animate-spin" />
                            {t('activeConnectors.loading')}
                        </div>
                    ) : (
                        <div className="space-y-4">
                            <GoogleConnectorName connector={connector} />
                            <div className="grid gap-3 sm:grid-cols-2">
                                <CopyableValue
                                    label={t('google.webhookUrlLabel')}
                                    value={buildGoogleWebhookUrl(googleKey)}
                                />
                                <CopyableValue label={t('google.keyLabel')} value={googleKey} />
                            </div>
                            <GoogleSetupSteps />
                            <div className="space-y-1.5">
                                <p className="text-xs font-medium text-neutral-500">
                                    {t('google.statusHeading')}
                                </p>
                                <GoogleDeliveryStatus connector={connector} />
                            </div>
                            <GoogleCampaignRoutes connector={connector} audiences={audiences} />
                            <div className="space-y-1">
                                <p className="text-xs font-medium text-neutral-500">
                                    {t('google.troubleshootHeading')}
                                </p>
                                <ul className="list-disc space-y-1 ps-5 text-caption text-neutral-600">
                                    <li>{t('google.troubleshoot404')}</li>
                                    <li>{t('google.troubleshoot401')}</li>
                                    <li>{t('google.troubleshootNoLeads')}</li>
                                </ul>
                            </div>
                        </div>
                    )}
                </div>

                <DialogFooter>
                    <MyButton scale="medium" onClick={() => onOpenChange(false)}>
                        {t('health.close')}
                    </MyButton>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

function AddGoogleForm({ onCreated }: { onCreated: (connectorId: string) => void }) {
    const { t } = useTranslation('settingsIntegration');
    const [audienceId, setAudienceId] = useState('');
    const [name, setName] = useState('');
    const instituteId = getCurrentInstituteId() ?? '';
    const { data: audiences = [] } = useAudienceList(instituteId);

    const { mutate: save, isPending } = useMutation({
        // No googleKey: the server generates it and the setup dialog shows it.
        mutationFn: () =>
            saveGoogleConnector({
                vendor: 'GOOGLE_LEAD_ADS',
                instituteId,
                audienceId,
                platformFormName: name.trim() || undefined,
                producesSourceType: 'GOOGLE_ADS',
            }),
        onSuccess: (result) => {
            toast.success(result.message);
            setAudienceId('');
            setName('');
            onCreated(result.connector_id);
        },
        onError: () => toast.error(t('google.saveError')),
    });

    return (
        <div className="space-y-3 rounded-lg border bg-white p-4">
            <div className="grid gap-3 sm:grid-cols-2">
                <AudiencePickerByType
                    audiences={audiences}
                    audienceId={audienceId}
                    onAudienceChange={setAudienceId}
                    audienceLabel={t('google.audienceLabel')}
                    audiencePlaceholder={t('google.selectAudiencePlaceholder')}
                />
                <div className="space-y-1">
                    <Label className="text-xs">{t('google.connectorNameLabel')}</Label>
                    <Input
                        value={name}
                        placeholder={t('google.connectorNamePlaceholder')}
                        onChange={(e) => setName(e.target.value)}
                    />
                </div>
            </div>
            <div className="rounded-md bg-neutral-50 p-3">
                <p className="mb-1.5 text-xs font-medium text-neutral-600">
                    {t('google.howItWorksTitle')}
                </p>
                <ol className="list-decimal space-y-1 ps-5 text-xs text-neutral-600">
                    <li>{t('google.howItWorks1')}</li>
                    <li>{t('google.howItWorks2')}</li>
                    <li>{t('google.howItWorks3')}</li>
                </ol>
            </div>
            <MyButton
                buttonType="primary"
                scale="small"
                onClick={() => save()}
                disable={isPending || !audienceId}
            >
                {isPending ? t('google.saving') : t('google.save')}
            </MyButton>
        </div>
    );
}

// ── Add Meta form ────────────────────────────────────────────────────────────

/** True if an API error is the backend's "session not found or expired" signal. */
function isSessionExpiredError(err: unknown): boolean {
    const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
    return !!msg && /session not found or expired/i.test(msg);
}

function AddMetaForm({
    sessionKey,
    setSessionKey,
    onSaved,
}: {
    sessionKey: string;
    setSessionKey: (key: string) => void;
    onSaved: () => void;
}) {
    const { t } = useTranslation('settingsIntegration');
    const instituteId = getCurrentInstituteId() ?? '';
    const [selectedPageId, setSelectedPageId] = useState('');
    // Pages resolved by ID (fallback when /me/accounts doesn't enumerate a
    // business-owned Page granted via Login for Business).
    const [manualPages, setManualPages] = useState<MetaPage[]>([]);
    const [manualPageId, setManualPageId] = useState('');
    const [formId, setFormId] = useState('');
    const [audienceId, setAudienceId] = useState('');
    const [sourceType, setSourceType] = useState<'FACEBOOK_ADS' | 'INSTAGRAM_ADS'>('FACEBOOK_ADS');
    const [fieldMappings, setFieldMappings] = useState<MappingRow[]>([]);
    // Per-connector default: which audience field gets stamped, and with what value.
    // Both come from the admin — nothing about the field name is hardcoded.
    const [stampFieldName, setStampFieldName] = useState('');
    const [stampValue, setStampValue] = useState('');
    const [stampValueTouched, setStampValueTouched] = useState(false);
    const { data: audiences = [] } = useAudienceList(instituteId);

    const {
        data: pages,
        isLoading: loadingPages,
        error: pagesError,
    } = useQuery({
        queryKey: ['meta-pages', sessionKey],
        queryFn: () => getSessionPages(sessionKey),
        enabled: !!sessionKey,
        retry: false,
    });

    // Fetch forms when a page is selected
    const {
        data: forms = [],
        isLoading: loadingForms,
        error: formsError,
    } = useQuery({
        queryKey: ['meta-forms', sessionKey, selectedPageId],
        queryFn: () => listPageForms(sessionKey, selectedPageId),
        enabled: !!sessionKey && !!selectedPageId,
        retry: false,
    });

    // Fetch form fields when a form is selected (for mapping UI)
    const { data: platformFields = [] } = useQuery({
        queryKey: ['meta-form-fields', sessionKey, formId, selectedPageId],
        queryFn: () => getFormFields(sessionKey, formId, selectedPageId),
        enabled: !!sessionKey && !!formId && !!selectedPageId,
        retry: false,
    });

    // Fetch audience custom fields when an audience is selected (for mapping UI)
    const { data: audienceFields = [] } = useQuery({
        queryKey: ['audience-custom-fields', instituteId, audienceId],
        queryFn: () => fetchAudienceCustomFields(instituteId, audienceId),
        enabled: !!instituteId && !!audienceId,
    });

    // Picking a different form or audience invalidates the current field mapping.
    // Reset it here, at event time — NOT in an effect. An effect keyed on
    // [formId, audienceId] raced FieldMappingBuilder's auto-populate effect:
    // child effects run before parent effects, so when the audience custom-fields
    // are cached (a synchronous cache-hit, e.g. when adding a 2nd form in the same
    // session) the parent reset ran last and clobbered the freshly built rows to
    // [], leaving the mapping table empty even though the fields had loaded.
    const selectForm = (id: string) => {
        setFormId(id);
        setFieldMappings([]);
    };
    const selectAudience = (id: string) => {
        setAudienceId(id);
        setFieldMappings([]);
    };

    // The forms fetch is the first call after page selection to hit the OAuth
    // session, so it's where a mid-flow expiry surfaces. Clear the session (which
    // flips isAuthorized false and re-shows "Connect Meta Account") instead of
    // letting the UI fall back to a misleading "No forms found".
    useEffect(() => {
        if (formsError && isSessionExpiredError(formsError)) {
            setSessionKey('');
            toast.error(t('meta.sessionExpiredReconnect'));
        }
    }, [formsError, setSessionKey, t]);

    // Auto-prefill the stamp value (e.g. "Wakad") from the selected Lead Gen
    // Form name, until the admin types into the value. Picking a different form
    // re-derives. The field NAME is never auto-populated — it must be chosen
    // explicitly from the audience's custom fields.
    useEffect(() => {
        if (stampValueTouched) return;
        const selected = forms.find((f) => f.id === formId);
        setStampValue(firstTokenOfFormName(selected?.name));
    }, [formId, forms, stampValueTouched]);

    const { mutate: initOAuth, isPending: initiating } = useMutation({
        mutationFn: () => initiateMetaOAuth(instituteId),
        onSuccess: (data) => {
            window.location.href = data.oauth_url;
        },
        onError: () => toast.error(t('meta.startOauthError')),
    });

    const { mutate: saveConnector, isPending: saving } = useMutation({
        mutationFn: () => {
            const trimmedField = stampFieldName.trim();
            const trimmedValue = stampValue.trim();
            const hasStamp = !!trimmedField && !!trimmedValue;
            const selectedForm = forms.find((f) => f.id === formId);
            return saveMetaConnector({
                vendor: 'META_LEAD_ADS',
                instituteId,
                audienceId,
                sessionKey,
                selectedPageId,
                platformFormId: formId,
                platformFormName: selectedForm?.name,
                producesSourceType: sourceType,
                platformPageId: selectedPageId,
                fieldMappingJson:
                    fieldMappings.length > 0 ? buildFieldMappingJson(fieldMappings) : undefined,
                defaultValuesJson: hasStamp
                    ? JSON.stringify({ [trimmedField]: trimmedValue })
                    : undefined,
            });
        },
        onSuccess: (result) => {
            // The connector is saved either way, but if the page→app subscribe
            // failed (e.g. the connecting account lacks Full control), leads won't
            // flow until that's fixed — surface it as an actionable warning, not a
            // green "success" that hides the problem.
            if (result.subscribed === 'false' || result.status === 'ACTION_REQUIRED') {
                toast.warning(result.message, { duration: 10000 });
            } else {
                toast.success(result.message);
            }
            // Keep sessionKey AND selectedPageId so the admin can immediately add
            // another form (often on the same page) without reconnecting or
            // re-picking the page — the backend keeps the session valid for more saves.
            setFormId('');
            setAudienceId('');
            setFieldMappings([]);
            setStampFieldName('');
            setStampValue('');
            setStampValueTouched(false);
            onSaved();
        },
        onError: (err: unknown) => {
            if (isSessionExpiredError(err)) {
                setSessionKey('');
                toast.error(t('meta.sessionExpiredRetry'));
                return;
            }
            const msg = (err as { response?: { data?: { message?: string } } })?.response?.data
                ?.message;
            toast.error(msg ?? t('meta.saveError'));
        },
    });

    // Resolve a Page by ID when it isn't auto-listed (business-owned Login-for-Business Pages).
    const { mutate: addPageById, isPending: resolvingPage } = useMutation({
        mutationFn: (pid: string) => resolvePageById(sessionKey, pid),
        onSuccess: (page) => {
            setManualPages((prev) => [...prev.filter((p) => p.id !== page.id), page]);
            setSelectedPageId(page.id);
            setManualPageId('');
            toast.success(t('meta.pageAdded', { name: page.name }));
        },
        onError: (err: unknown) => {
            if (isSessionExpiredError(err)) {
                setSessionKey('');
                toast.error(t('meta.sessionExpiredReconnect'));
                return;
            }
            const msg = (err as { response?: { data?: { message?: string } } })?.response?.data
                ?.message;
            toast.error(msg ?? t('meta.addPageError'));
        },
    });

    // The session is usable once the /pages call resolves — even if it returns 0 pages.
    // Business-owned Pages granted via Login for Business don't enumerate; the admin
    // adds them by ID below.
    const isAuthorized = !!sessionKey && Array.isArray(pages);
    const effectivePages: MetaPage[] = [
        ...(pages ?? []),
        ...manualPages.filter((mp) => !(pages ?? []).some((p) => p.id === mp.id)),
    ];

    return (
        <div className="space-y-3 rounded-lg border bg-white p-4">
            {!isAuthorized && (
                <>
                    {pagesError && (
                        <div className="rounded-md border border-red-100 bg-red-50 p-3 text-sm text-red-600">
                            {t('meta.sessionInvalid')}
                        </div>
                    )}
                    <MyButton
                        buttonType="primary"
                        scale="small"
                        onClick={() => initOAuth()}
                        disable={initiating}
                    >
                        <ArrowSquareOut className="size-4" />
                        {initiating ? t('meta.redirecting') : t('meta.connectButton')}
                    </MyButton>
                    <p className="text-xs text-muted-foreground">{t('meta.connectHint')}</p>
                </>
            )}

            {loadingPages && sessionKey && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <div className="size-4 animate-spin rounded-full border-2 border-primary-500 border-t-transparent" />
                    {t('meta.loadingPages')}
                </div>
            )}

            {isAuthorized && (
                <>
                    <div className="rounded-md border border-green-100 bg-green-50 p-2 text-xs text-green-700">
                        {t('meta.connectedBanner')}
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                        <div className="space-y-1">
                            <Label className="text-xs">{t('meta.pageLabel')}</Label>
                            <select
                                className="w-full rounded-md border bg-white px-3 py-2 text-sm"
                                value={selectedPageId}
                                onChange={(e) => setSelectedPageId(e.target.value)}
                            >
                                <option value="">{t('meta.selectPagePlaceholder')}</option>
                                {effectivePages.map((p: MetaPage) => (
                                    <option key={p.id} value={p.id}>
                                        {p.name}
                                        {p.canReceiveLeads === false
                                            ? t('meta.needsFullControl')
                                            : ''}
                                    </option>
                                ))}
                            </select>
                            {(() => {
                                const sel = effectivePages.find(
                                    (p: MetaPage) => p.id === selectedPageId
                                );
                                return sel?.warning ? (
                                    <div className="mt-1 flex items-start gap-1.5 rounded-md border border-warning-200 bg-warning-50 p-2 text-caption text-warning-700">
                                        <Warning
                                            className="mt-0.5 size-3.5 shrink-0"
                                            weight="fill"
                                        />
                                        <span>{sel.warning}</span>
                                    </div>
                                ) : null;
                            })()}
                            {/* Fallback: business-owned Pages granted via Login for Business
                                don't auto-list — let the admin add one by its Page ID. */}
                            <div className="mt-2 rounded-md border border-dashed border-neutral-200 bg-neutral-50 p-2">
                                <p className="text-caption text-neutral-500">
                                    {effectivePages.length === 0
                                        ? t('meta.noPageListedHint')
                                        : t('meta.pageNotListedHint')}
                                </p>
                                <div className="mt-2 flex gap-2">
                                    <Input
                                        value={manualPageId}
                                        onChange={(e) => setManualPageId(e.target.value)}
                                        placeholder={t('meta.pageIdPlaceholder')}
                                        className="text-sm"
                                    />
                                    <MyButton
                                        buttonType="secondary"
                                        scale="small"
                                        onClick={() => addPageById(manualPageId.trim())}
                                        disable={!manualPageId.trim() || resolvingPage}
                                    >
                                        {resolvingPage ? t('meta.addingPage') : t('meta.addPage')}
                                    </MyButton>
                                </div>
                            </div>
                        </div>
                        <div className="space-y-1">
                            <Label className="text-xs">{t('meta.leadFormLabel')}</Label>
                            {loadingForms ? (
                                <div className="flex items-center gap-2 py-2 text-xs text-muted-foreground">
                                    <div className="size-3 animate-spin rounded-full border-2 border-primary-500 border-t-transparent" />
                                    {t('meta.loadingForms')}
                                </div>
                            ) : forms.length > 0 ? (
                                <SearchableSelect
                                    options={forms.map((f) => ({
                                        label: `${f.name} (${f.id})`,
                                        value: f.id,
                                    }))}
                                    value={formId}
                                    onChange={selectForm}
                                    placeholder={t('meta.selectFormPlaceholder')}
                                    searchPlaceholder={t('meta.searchFormsPlaceholder')}
                                    emptyText={t('meta.noFormsMatch')}
                                    filter={prefixFirstFilter}
                                    triggerClassName="text-sm"
                                />
                            ) : (
                                <>
                                    <Input
                                        placeholder={
                                            selectedPageId
                                                ? t('meta.pasteFormIdPlaceholder')
                                                : t('meta.selectPageFirstPlaceholder')
                                        }
                                        value={formId}
                                        onChange={(e) => selectForm(e.target.value)}
                                    />
                                    {selectedPageId && (
                                        <p className="mt-1 text-caption text-neutral-500">
                                            {t('meta.cantAutoListForms')}
                                        </p>
                                    )}
                                </>
                            )}
                        </div>
                        <AudiencePickerByType
                            audiences={audiences}
                            audienceId={audienceId}
                            onAudienceChange={selectAudience}
                            audienceLabel={t('meta.audienceLabel')}
                            audiencePlaceholder={t('meta.selectAudiencePlaceholder')}
                        />
                        <div className="space-y-1">
                            <Label className="text-xs">{t('meta.sourceTypeLabel')}</Label>
                            <div className="flex gap-3 pt-2">
                                {(['FACEBOOK_ADS', 'INSTAGRAM_ADS'] as const).map((st) => (
                                    <label
                                        key={st}
                                        className="flex cursor-pointer items-center gap-1.5 text-xs"
                                    >
                                        <input
                                            type="radio"
                                            name="metaSourceType"
                                            checked={sourceType === st}
                                            onChange={() => setSourceType(st)}
                                        />
                                        {st === 'FACEBOOK_ADS'
                                            ? t('meta.facebook')
                                            : t('meta.instagram')}
                                    </label>
                                ))}
                            </div>
                        </div>
                    </div>

                    {/* Per-connector default: stamp one audience field with a fixed value
                        on every lead from this form. Both the field name and value are
                        chosen by the admin — nothing is hardcoded. */}
                    {formId && audienceId && audienceFields.length > 0 && (
                        <div className="grid gap-3 sm:grid-cols-2">
                            <div className="space-y-1">
                                <Label className="text-caption">{t('meta.stampFieldLabel')}</Label>
                                <select
                                    className="w-full rounded-md border bg-white px-3 py-2 text-sm"
                                    value={stampFieldName}
                                    onChange={(e) => setStampFieldName(e.target.value)}
                                >
                                    <option value="">{t('meta.noneOption')}</option>
                                    {audienceFields.map((af) => (
                                        <option key={af.id} value={af.fieldName}>
                                            {af.fieldName}
                                        </option>
                                    ))}
                                </select>
                            </div>
                            <div className="space-y-1">
                                <Label className="text-caption">{t('meta.valueLabel')}</Label>
                                <Input
                                    placeholder={t('meta.valuePlaceholder')}
                                    value={stampValue}
                                    onChange={(e) => {
                                        setStampValue(e.target.value);
                                        setStampValueTouched(true);
                                    }}
                                />
                                <p className="text-caption text-muted-foreground">
                                    {t('meta.stampValueHint')}
                                </p>
                            </div>
                        </div>
                    )}

                    {/* Field mapping — appears once both form and audience are selected */}
                    {formId &&
                        audienceId &&
                        platformFields.length > 0 &&
                        audienceFields.length > 0 && (
                            <FieldMappingBuilder
                                platformFields={platformFields}
                                audienceFields={audienceFields}
                                value={fieldMappings}
                                onChange={setFieldMappings}
                            />
                        )}

                    <MyButton
                        buttonType="primary"
                        scale="small"
                        onClick={() => saveConnector()}
                        disable={saving || !selectedPageId || !formId || !audienceId}
                    >
                        {saving ? t('meta.saving') : t('meta.save')}
                    </MyButton>
                </>
            )}
        </div>
    );
}

// ── Main Integrations Page ───────────────────────────────────────────────────

export default function IntegrationSettings() {
    const { t } = useTranslation('settingsIntegration');
    const queryClient = useQueryClient();
    const instituteId = getCurrentInstituteId() ?? '';

    // Check for session_key in URL (set by Meta OAuth callback redirect)
    const urlParams = new URLSearchParams(window.location.search);
    const sessionKeyFromUrl = urlParams.get('session_key') || undefined;
    const oauthError = urlParams.get('error');

    const [showAddGoogle, setShowAddGoogle] = useState(false);
    const [showAddMeta, setShowAddMeta] = useState(!!sessionKeyFromUrl);
    // Held here (not inside AddMetaForm) so the authorized Meta session survives
    // collapsing the Add-connector panel or switching to the Google tab — both of
    // which unmount AddMetaForm and would otherwise discard the session.
    const [metaSessionKey, setMetaSessionKey] = useState(sessionKeyFromUrl || '');

    // Loaded once for both the connector list (id → name lookup) and AddMetaForm.
    const { data: audiences = [] } = useAudienceList(instituteId);

    useEffect(() => {
        if (oauthError) toast.error(t('meta.oauthFailed', { error: oauthError }));
        if (sessionKeyFromUrl) {
            toast.success(t('toasts.metaAccountConnected'));
            setMetaSessionKey(sessionKeyFromUrl);
        }
        if (sessionKeyFromUrl || oauthError) {
            const clean = new URL(window.location.href);
            clean.searchParams.delete('session_key');
            clean.searchParams.delete('error');
            window.history.replaceState({}, '', clean.toString());
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [oauthError, sessionKeyFromUrl]);

    // Google connector whose Setup & status dialog is open (also opened right after create).
    const [googleSetupId, setGoogleSetupId] = useState<string | null>(null);

    // Fetch existing connectors
    const {
        data: connectors = [],
        isLoading,
        error: connectorsError,
    } = useQuery({
        queryKey: ['ad-connectors', instituteId],
        queryFn: () => listConnectors(instituteId),
        enabled: !!instituteId,
        retry: false,
        // While the Google setup dialog is open, poll so "Send test data" shows up live.
        refetchInterval: googleSetupId ? 5000 : false,
    });
    const googleSetupConnector =
        (Array.isArray(connectors) ? connectors : []).find((c) => c.id === googleSetupId) ?? null;

    const { mutate: deleteConnector } = useMutation({
        mutationFn: deactivateConnector,
        onSuccess: () => {
            toast.success(t('toasts.connectorDeactivated'));
            queryClient.invalidateQueries({ queryKey: ['ad-connectors'] });
        },
        onError: () => toast.error(t('toasts.deactivateFailed')),
    });

    // "Test connection" — runs the live health check and shows the result.
    const [healthResult, setHealthResult] = useState<ConnectorHealth | null>(null);
    const {
        mutate: testConnector,
        isPending: isTesting,
        variables: testingVar,
    } = useMutation({
        mutationFn: checkConnectorHealth,
        onSuccess: (data) => {
            setHealthResult(data);
            // The server may have flipped the status (e.g. back to ACTIVE) — refetch.
            queryClient.invalidateQueries({ queryKey: ['ad-connectors'] });
        },
        onError: () => toast.error(t('toasts.healthCheckFailed')),
    });
    const testingId = isTesting ? (testingVar ?? null) : null;

    const { mutate: resubscribe } = useMutation({
        mutationFn: resubscribeConnector,
        onSuccess: (data) => {
            if (data.subscribed === 'true') toast.success(data.message);
            else toast.warning(data.message);
            queryClient.invalidateQueries({ queryKey: ['ad-connectors'] });
        },
        onError: (err: unknown) => {
            const msg =
                (err as { response?: { data?: { message?: string } } })?.response?.data
                    ?.message ?? t('toasts.resubscribeFailedFallback');
            toast.error(msg);
        },
    });

    // "Sync leads now" — pull the last 24h from Meta on demand (the PULL fallback
    // for pages where realtime webhook delivery is blocked / CRM access revoked).
    const {
        mutate: syncNow,
        isPending: isSyncing,
        variables: syncingVar,
    } = useMutation({
        mutationFn: (id: string) => pollConnectorNow(id),
        onSuccess: (data) => {
            if (data.truncated) {
                // Backend surfaced a partial sync (window held more than one pull returns).
                toast.warning(data.message);
            } else if (data.fetched > 0) {
                toast.success(t('toasts.syncedLeads', { count: data.fetched }));
            } else {
                toast.info(t('toasts.noNewLeads'));
            }
            queryClient.invalidateQueries({ queryKey: ['ad-connectors'] });
        },
        onError: (err: unknown) => {
            const msg =
                (err as { response?: { data?: { message?: string } } })?.response?.data?.message ??
                t('toasts.syncFailedFallback');
            toast.error(msg);
        },
    });
    const syncingId = isSyncing ? (syncingVar ?? null) : null;

    const [editingConnector, setEditingConnector] = useState<ConnectorListItem | null>(null);

    const { mutate: saveConnectorEdits, isPending: isSavingEdits } = useMutation({
        mutationFn: (args: { id: string; defaultValuesJson: string }) =>
            updateConnector(args.id, { defaultValuesJson: args.defaultValuesJson }),
        onSuccess: () => {
            toast.success(t('toasts.connectorUpdated'));
            setEditingConnector(null);
            queryClient.invalidateQueries({ queryKey: ['ad-connectors'] });
        },
        onError: (err: unknown) => {
            const msg =
                (err as { response?: { data?: { message?: string } } })?.response?.data?.message ??
                t('toasts.updateFailedFallback');
            toast.error(msg);
        },
    });

    const handleSaved = () => {
        queryClient.invalidateQueries({ queryKey: ['ad-connectors'] });
    };

    return (
        <div className="space-y-6 p-6">
            <div>
                <h2 className="text-lg font-semibold">{t('page.heading')}</h2>
                <p className="text-sm text-muted-foreground">{t('page.description')}</p>
            </div>

            <Separator />

            {/* ── Existing connectors ── */}
            <Card>
                <CardHeader className="pb-3">
                    <CardTitle className="text-base">{t('activeConnectors.title')}</CardTitle>
                    <CardDescription>{t('activeConnectors.description')}</CardDescription>
                </CardHeader>
                <CardContent>
                    {isLoading ? (
                        <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
                            <div className="size-4 animate-spin rounded-full border-2 border-primary-500 border-t-transparent" />
                            {t('activeConnectors.loading')}
                        </div>
                    ) : connectorsError ? (
                        <div className="rounded-md border border-amber-100 bg-amber-50 p-3 text-sm text-amber-700">
                            {t('activeConnectors.loadError')}
                        </div>
                    ) : (
                        <ConnectorTable
                            connectors={Array.isArray(connectors) ? connectors : []}
                            audiences={audiences}
                            onDelete={(id) => deleteConnector(id)}
                            onEdit={(c) => setEditingConnector(c)}
                            onTest={(id) => testConnector(id)}
                            onResubscribe={(id) => resubscribe(id)}
                            onSyncNow={(id) => syncNow(id)}
                            onGoogleSetup={(id) => setGoogleSetupId(id)}
                            testingId={testingId}
                            syncingId={syncingId}
                        />
                    )}
                </CardContent>
            </Card>

            {/* ── Add new connectors ── */}
            <Card>
                <CardHeader className="pb-3">
                    <CardTitle className="text-base">{t('addConnector.title')}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                    <div className="flex gap-2">
                        <Button
                            variant={showAddMeta ? 'default' : 'outline'}
                            size="sm"
                            onClick={() => {
                                setShowAddMeta(!showAddMeta);
                                setShowAddGoogle(false);
                            }}
                        >
                            <Plus className="mr-1 size-3.5" />
                            {t('addConnector.metaButton')}
                        </Button>
                        <Button
                            variant={showAddGoogle ? 'default' : 'outline'}
                            size="sm"
                            onClick={() => {
                                setShowAddGoogle(!showAddGoogle);
                                setShowAddMeta(false);
                            }}
                        >
                            <Plus className="mr-1 size-3.5" />
                            {t('addConnector.googleButton')}
                        </Button>
                    </div>

                    {showAddMeta && (
                        <AddMetaForm
                            sessionKey={metaSessionKey}
                            setSessionKey={setMetaSessionKey}
                            onSaved={handleSaved}
                        />
                    )}
                    {showAddGoogle && (
                        <AddGoogleForm
                            onCreated={(connectorId) => {
                                handleSaved();
                                setShowAddGoogle(false);
                                setGoogleSetupId(connectorId);
                            }}
                        />
                    )}
                </CardContent>
            </Card>

            {/* ── AI Evaluation API keys (partner access, spec §6.3) ── */}
            <EvaluationApiKeysCard />

            {/* ── Catalogue API: own-website course listing + enquiries ── */}
            <CatalogApiCard />

            <ConnectorEditDialog
                connector={editingConnector}
                open={!!editingConnector}
                onOpenChange={(o) => {
                    if (!o) setEditingConnector(null);
                }}
                onSave={(rows) =>
                    editingConnector &&
                    saveConnectorEdits({
                        id: editingConnector.id,
                        defaultValuesJson: serializeDefaultValues(rows),
                    })
                }
                isSaving={isSavingEdits}
            />

            <GoogleSetupDialog
                connector={googleSetupConnector}
                audienceName={
                    googleSetupConnector
                        ? audiences.find((a) => a.id === googleSetupConnector.audienceId)?.name
                        : undefined
                }
                audiences={audiences}
                open={!!googleSetupId}
                onOpenChange={(o) => {
                    if (!o) setGoogleSetupId(null);
                }}
            />

            <ConnectorHealthDialog
                health={healthResult}
                open={!!healthResult}
                onOpenChange={(o) => {
                    if (!o) setHealthResult(null);
                }}
                onResubscribe={(id) => {
                    resubscribe(id);
                    setHealthResult(null);
                }}
            />
        </div>
    );
}
