import { useEffect, useMemo, useState } from 'react';
import { createLazyFileRoute } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Helmet } from 'react-helmet';
import { toast } from 'sonner';

import { LayoutContainer } from '@/components/common/layout-container/layout-container';
import { useNavHeadingStore } from '@/stores/layout-container/useNavHeadingStore';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Plus, X, FloppyDisk, ArrowClockwise, Buildings } from '@phosphor-icons/react';
import { getCurrentInstituteId } from '@/lib/auth/instituteUtils';
import {
    connectorDisplayId,
    listConnectors,
    updateConnector,
    type ConnectorListItem,
} from '@/routes/settings/-services/ad-platform-service';

export const Route = createLazyFileRoute('/connector-center-details/')({
    component: () => (
        <LayoutContainer>
            <ConnectorCenterDetailsPage />
        </LayoutContainer>
    ),
});

interface KeyValueRow {
    key: string;
    value: string;
}

const VENDOR_LABEL: Record<string, string> = {
    META_LEAD_ADS: 'Meta Lead Ads',
    GOOGLE_LEAD_ADS: 'Google Lead Ads',
    ZOHO_FORMS: 'Zoho Forms',
    GOOGLE_FORMS: 'Google Forms',
    MICROSOFT_FORMS: 'Microsoft Forms',
};

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
        // ignore — fall through to empty editor
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

const hasDuplicateKeys = (rows: KeyValueRow[]): boolean => {
    const seen = new Set<string>();
    for (const r of rows) {
        const k = r.key.trim();
        if (!k) continue;
        if (seen.has(k)) return true;
        seen.add(k);
    }
    return false;
};

function ConnectorCenterDetailsPage() {
    const { setNavHeading } = useNavHeadingStore();
    const queryClient = useQueryClient();
    const instituteId = getCurrentInstituteId() ?? '';

    useEffect(() => {
        setNavHeading(
            <div className="flex items-center gap-2">
                <Buildings className="text-primary size-5" weight="fill" />
                <h1 className="text-lg font-semibold">Center Details</h1>
            </div>
        );
    }, [setNavHeading]);

    const {
        data: connectors = [],
        isLoading,
        error,
        refetch,
        isFetching,
    } = useQuery({
        queryKey: ['ad-connectors', instituteId],
        queryFn: () => listConnectors(instituteId),
        enabled: !!instituteId,
        retry: false,
    });

    return (
        <>
            <Helmet>
                <title>Center Details | Vacademy</title>
                <meta
                    name="description"
                    content="Edit per-center metadata that auto-fills lead submissions for each connector."
                />
            </Helmet>

            <div className="space-y-4 p-4 text-sm">
                <div className="flex items-start justify-between gap-2">
                    <div>
                        <h2 className="text-lg font-semibold">Center Details</h2>
                        <p className="text-sm text-muted-foreground">
                            Configure per-connector defaults (center name, schedule link, contact
                            phone, etc.) that get merged into every form submission. Form payloads
                            always take precedence — these only fill in fields the form did not
                            provide.
                        </p>
                    </div>
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => refetch()}
                        disabled={isFetching}
                        className="gap-1"
                    >
                        <ArrowClockwise
                            className={`size-3.5 ${isFetching ? 'animate-spin' : ''}`}
                        />
                        Refresh
                    </Button>
                </div>

                {isLoading ? (
                    <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
                        <div className="border-primary-500 size-4 animate-spin rounded-full border-2 border-t-transparent" />
                        Loading connectors…
                    </div>
                ) : error ? (
                    <div className="rounded-md border border-amber-100 bg-amber-50 p-3 text-sm text-amber-700">
                        Could not load connectors. The integration API may not be deployed yet.
                    </div>
                ) : connectors.length === 0 ? (
                    <div className="flex flex-col items-center gap-2 rounded-xl border-2 border-dashed border-neutral-200 bg-neutral-50/50 py-10 text-center">
                        <p className="text-sm font-medium text-neutral-500">No connectors yet</p>
                        <p className="text-xs text-neutral-400">
                            Add a Meta or Google connector from Settings → Integrations to start
                            configuring center details.
                        </p>
                    </div>
                ) : (
                    <div className="grid gap-4 md:grid-cols-2">
                        {connectors.map((c) => (
                            <ConnectorCenterCard
                                key={c.id}
                                connector={c}
                                onSaved={() =>
                                    queryClient.invalidateQueries({
                                        queryKey: ['ad-connectors', instituteId],
                                    })
                                }
                            />
                        ))}
                    </div>
                )}
            </div>
        </>
    );
}

function ConnectorCenterCard({
    connector,
    onSaved,
}: {
    connector: ConnectorListItem;
    onSaved: () => void;
}) {
    const initial = useMemo(
        () => parseDefaultValues(connector.defaultValuesJson),
        [connector.defaultValuesJson]
    );
    const [rows, setRows] = useState<KeyValueRow[]>(
        initial.length > 0 ? initial : [{ key: '', value: '' }]
    );

    // Reset local edits if the upstream connector data changes (after a refetch).
    useEffect(() => {
        setRows(initial.length > 0 ? initial : [{ key: '', value: '' }]);
    }, [initial]);

    const updateRow = (idx: number, patch: Partial<KeyValueRow>) =>
        setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
    const addRow = () => setRows((prev) => [...prev, { key: '', value: '' }]);
    const removeRow = (idx: number) =>
        setRows((prev) => (prev.length === 1 ? [{ key: '', value: '' }] : prev.filter((_, i) => i !== idx)));

    const dirty = useMemo(() => {
        const original = parseDefaultValues(connector.defaultValuesJson);
        return serializeDefaultValues(rows) !== serializeDefaultValues(original);
    }, [rows, connector.defaultValuesJson]);

    const duplicates = hasDuplicateKeys(rows);

    const { mutate: save, isPending } = useMutation({
        mutationFn: () =>
            updateConnector(connector.id, {
                defaultValuesJson: serializeDefaultValues(rows),
            }),
        onSuccess: () => {
            toast.success('Center details saved');
            onSaved();
        },
        onError: (err: unknown) => {
            const msg =
                (err as { response?: { data?: { message?: string } } })?.response?.data?.message ??
                'Failed to save center details';
            toast.error(msg);
        },
    });

    return (
        <Card>
            <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                    <span className="rounded bg-neutral-100 px-2 py-0.5 text-xs font-medium text-neutral-700">
                        {VENDOR_LABEL[connector.vendor] ?? connector.vendor}
                    </span>
                    <span
                        className={`text-xs font-medium ${
                            connector.connectionStatus === 'ACTIVE'
                                ? 'text-green-600'
                                : 'text-neutral-400'
                        }`}
                    >
                        {connector.connectionStatus}
                    </span>
                </CardTitle>
                <CardDescription className="space-y-0.5 text-xs">
                    <div>
                        <span className="text-neutral-500">Form / Campaign:</span>{' '}
                        <span className="font-mono">{connectorDisplayId(connector) ?? '—'}</span>
                    </div>
                    <div>
                        <span className="text-neutral-500">Audience:</span>{' '}
                        <span className="font-mono">{connector.audienceId}</span>
                    </div>
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
                <div className="space-y-2">
                    <Label className="text-xs font-medium">Default values</Label>
                    <div className="grid grid-cols-[1fr_1fr_28px] gap-2 text-caption font-medium uppercase tracking-wider text-neutral-400">
                        <span>Key</span>
                        <span>Value</span>
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
                                placeholder="e.g. center name"
                            />
                            <Input
                                value={row.value}
                                onChange={(e) => updateRow(idx, { value: e.target.value })}
                                placeholder="e.g. Baner"
                            />
                            <button
                                type="button"
                                onClick={() => removeRow(idx)}
                                className="text-neutral-400 hover:text-red-600"
                                title="Remove row"
                            >
                                <X className="size-4" />
                            </button>
                        </div>
                    ))}
                    <Button variant="outline" size="sm" onClick={addRow} className="gap-1">
                        <Plus className="size-3.5" />
                        Add field
                    </Button>
                    {duplicates && (
                        <p className="text-xs text-red-600">
                            Duplicate keys detected — only the last value for each key will be kept.
                        </p>
                    )}
                </div>

                <div className="flex justify-end gap-2 border-t pt-3">
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                            setRows(
                                initial.length > 0 ? initial : [{ key: '', value: '' }]
                            )
                        }
                        disabled={!dirty || isPending}
                    >
                        Reset
                    </Button>
                    <Button
                        size="sm"
                        onClick={() => save()}
                        disabled={!dirty || isPending}
                        className="gap-1"
                    >
                        <FloppyDisk className="size-3.5" />
                        {isPending ? 'Saving…' : 'Save'}
                    </Button>
                </div>
            </CardContent>
        </Card>
    );
}
