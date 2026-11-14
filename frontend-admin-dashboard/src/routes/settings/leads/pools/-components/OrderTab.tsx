/**
 * Rotation order editor. Used by ROUND_ROBIN and TIME_BASED pools — the same
 * `display_order` column drives both. For TIME_BASED, order only matters
 * when multiple counsellors are on the same shift block (it tie-breaks the
 * pick within that intersection). Copy below adapts to the pool's mode.
 *
 * Two render modes (matching OverviewTab's UX pattern):
 *   - Read-only (default) — shows the current order(s) as plain numbered
 *     lists. Header has an Edit button.
 *   - Editing — toggle + up/down arrows + Save/Cancel. Two operating
 *     sub-modes inside Editing:
 *       (a) "Same order across all campaigns" (default ON) — admin orders
 *           the counsellors once, save fans out to every audience.
 *       (b) "Per-campaign" — admin picks a campaign and reorders just
 *           that one.
 *
 * Both views carry the pool's "pool-wide rotation" switch (unified_rotation_order).
 * When it's on, routing uses one order for the whole pool and ignores per-campaign
 * orders, so editing is locked to "same order for all campaigns".
 */

import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { GET_INSTITUTE_USERS } from '@/constants/urls';
import { getCurrentInstituteId } from '@/lib/auth/instituteUtils';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { MyButton } from '@/components/design-system/button';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import {
    handleFetchCampaignsList,
    type CampaignItem,
} from '@/routes/audience-manager/list/-services/get-campaigns-list';
import {
    CounselorPoolDTO,
    PoolMemberDTO,
    useUpdateAudienceOrder,
    useUpdatePool,
} from '@/services/counselor-pool';

interface OrderTabProps {
    pool: CounselorPoolDTO;
}

interface InstituteUser {
    id: string;
    full_name: string;
}

const fetchUsers = async (): Promise<InstituteUser[]> => {
    const instituteId = getCurrentInstituteId();
    const response = await authenticatedAxiosInstance({
        method: 'POST',
        url: GET_INSTITUTE_USERS,
        params: { instituteId, pageNumber: 0, pageSize: 500 },
        data: { roles: ['COUNSELLOR', 'ADMIN'], status: ['ACTIVE'] },
    });
    const raw = Array.isArray(response.data) ? response.data : response.data?.content || [];
    return raw.map((u: Record<string, unknown>) => ({
        id: u.id as string,
        full_name: u.full_name as string,
    }));
};

export default function OrderTab({ pool }: OrderTabProps) {
    const audiences = pool.audiences ?? [];
    const members = pool.members ?? [];
    const isTimeBased = pool.assignment_mode === 'TIME_BASED';

    const readOnlyDescription = isTimeBased
        ? 'Used as a tie-breaker when multiple counsellors are on the same shift. The lower-numbered counsellor goes first.'
        : 'Round-robin cycles counsellors in this order.';
    const editDescription = isTimeBased
        ? 'Set the order in which on-shift counsellors are tried. Only matters when more than one is on the same shift.'
        : 'Use the same order for every campaign, or customise it per campaign.';

    const { data: users = [] } = useQuery({
        queryKey: ['institute-counselors-order'],
        queryFn: fetchUsers,
        staleTime: 60 * 1000,
    });
    const nameById = useMemo(() => {
        const m = new Map<string, string>();
        users.forEach((u) => m.set(u.id, u.full_name));
        return m;
    }, [users]);

    // Fetch campaigns to look up audience names
    const instituteId = getCurrentInstituteId() ?? '';
    const { data: campaignsPage } = useQuery(
        handleFetchCampaignsList({ institute_id: instituteId, page: 0, size: 500 })
    );
    const campaignName = (audienceId: string) => {
        const c = (campaignsPage?.content ?? []).find((it: CampaignItem) => it.id === audienceId);
        return c?.campaign_name ?? `(unknown — ${audienceId.slice(0, 8)}…)`;
    };

    const { mutateAsync: saveOrder, isPending: saving } = useUpdateAudienceOrder(pool.id);
    const { mutateAsync: updatePool, isPending: savingUnified } = useUpdatePool(pool.id);
    const unifiedRotation = !!pool.unified_rotation_order;

    const handleUnifiedRotationChange = async (next: boolean) => {
        try {
            await updatePool({ unified_rotation_order: next });
            toast.success(next ? 'Pool-wide rotation turned on' : 'Pool-wide rotation turned off');
        } catch (e) {
            toast.error(extractError(e) ?? 'Failed to update rotation setting');
        }
    };
    const unifiedRotationCard = (
        <UnifiedRotationCard
            checked={unifiedRotation}
            disabled={savingUnified || saving}
            onChange={handleUnifiedRotationChange}
        />
    );

    // ─── Derived "current saved state" (used for read-only view + reset on Cancel) ─────
    const ordersDiffer = useMemo(() => audienceOrdersDiffer(members, audiences), [members, audiences]);
    const firstAudienceId = audiences[0]?.audience_id;

    const orderForAudience = useMemo(
        () => (audienceId: string) =>
            members
                .filter((m) => m.audience_id === audienceId)
                .sort((a, b) => a.display_order - b.display_order)
                .map((m) => m.counselor_user_id),
        [members]
    );

    const savedUnifiedOrder = useMemo(
        () => (firstAudienceId ? orderForAudience(firstAudienceId) : []),
        [orderForAudience, firstAudienceId]
    );

    // ─── Edit-mode state ──────────────────────────────────────────────────
    const [editing, setEditing] = useState(false);
    const [sameForAll, setSameForAll] = useState(true);
    const [unifiedOrder, setUnifiedOrder] = useState<string[]>(savedUnifiedOrder);
    const [selectedAudienceId, setSelectedAudienceId] = useState<string>(firstAudienceId ?? '');
    const savedPerAudienceOrder = useMemo(
        () => (selectedAudienceId ? orderForAudience(selectedAudienceId) : []),
        [orderForAudience, selectedAudienceId]
    );
    const [perAudienceOrder, setPerAudienceOrder] = useState<string[]>(savedPerAudienceOrder);

    // Rehydrate editable state whenever the underlying pool data changes (e.g. after save).
    useEffect(() => setUnifiedOrder(savedUnifiedOrder), [savedUnifiedOrder]);
    useEffect(() => setPerAudienceOrder(savedPerAudienceOrder), [savedPerAudienceOrder]);
    useEffect(() => {
        if (!selectedAudienceId && firstAudienceId) setSelectedAudienceId(firstAudienceId);
    }, [firstAudienceId, selectedAudienceId]);

    const startEdit = () => {
        // Default toggle: ON when orders are already uniform, OFF when they differ
        // (so the admin sees their current per-audience differences and decides).
        // Pool-wide rotation ignores per-campaign orders, so it always edits one order.
        setSameForAll(unifiedRotation || !ordersDiffer);
        setUnifiedOrder(savedUnifiedOrder);
        setPerAudienceOrder(savedPerAudienceOrder);
        setEditing(true);
    };

    const cancelEdit = () => {
        setUnifiedOrder(savedUnifiedOrder);
        setPerAudienceOrder(savedPerAudienceOrder);
        setEditing(false);
    };

    const handleSaveSame = async () => {
        if (audiences.length === 0) {
            toast.error('Add a campaign to the pool first');
            return;
        }
        try {
            for (const a of audiences) {
                await saveOrder({ audienceId: a.audience_id, counselorUserIds: unifiedOrder });
            }
            toast.success('Same order applied to all campaigns');
            setEditing(false);
        } catch (e) {
            toast.error(extractError(e) ?? 'Failed to save order');
        }
    };

    const handleSavePerAudience = async () => {
        if (!selectedAudienceId) return;
        try {
            await saveOrder({
                audienceId: selectedAudienceId,
                counselorUserIds: perAudienceOrder,
            });
            toast.success('Order updated for campaign');
            setEditing(false);
        } catch (e) {
            toast.error(extractError(e) ?? 'Failed to save order');
        }
    };

    // ─── Render ───────────────────────────────────────────────────────────
    if (audiences.length === 0 || members.length === 0) {
        return (
            <Card>
                <CardContent className="py-8 text-sm text-muted-foreground">
                    Add campaigns and counselors to the pool first. Rotation order can be set once
                    both exist.
                </CardContent>
            </Card>
        );
    }

    // ── Read-only view ────────────────────────────────────────────────────
    if (!editing) {
        return (
            <div className="space-y-6">
                {unifiedRotationCard}
                <Card>
                    <CardHeader className="flex flex-row items-start justify-between space-y-0">
                        <div>
                            <CardTitle>Rotation Order</CardTitle>
                            <CardDescription>{readOnlyDescription}</CardDescription>
                        </div>
                        <MyButton buttonType="secondary" scale="small" onClick={startEdit}>
                            Edit
                        </MyButton>
                    </CardHeader>
                    <CardContent>
                        <Badge
                            className={
                                ordersDiffer
                                    ? 'bg-warning-100 text-warning-700'
                                    : 'bg-primary-100 text-primary-700'
                            }
                        >
                            {ordersDiffer
                                ? 'Different orders per campaign'
                                : 'Same order across all campaigns'}
                        </Badge>
                        {unifiedRotation && ordersDiffer && (
                            <p className="mt-3 rounded border border-warning-200 bg-warning-50 p-2 text-xs text-warning-700">
                                Pool-wide rotation is on, so these per-campaign orders are ignored.
                                Leads rotate in the order most campaigns share. Edit and save one
                                order for all campaigns to make them match.
                            </p>
                        )}
                    </CardContent>
                </Card>

                {ordersDiffer ? (
                    audiences.map((a) => (
                        <Card key={a.audience_id}>
                            <CardHeader>
                                <CardTitle className="text-base">
                                    {campaignName(a.audience_id)}
                                </CardTitle>
                            </CardHeader>
                            <CardContent>
                                <ReadOnlyOrderedList
                                    order={orderForAudience(a.audience_id)}
                                    nameById={nameById}
                                />
                            </CardContent>
                        </Card>
                    ))
                ) : (
                    <Card>
                        <CardHeader>
                            <CardTitle className="text-base">
                                Order (applies to all campaigns)
                            </CardTitle>
                        </CardHeader>
                        <CardContent>
                            <ReadOnlyOrderedList
                                order={savedUnifiedOrder}
                                nameById={nameById}
                            />
                        </CardContent>
                    </Card>
                )}
            </div>
        );
    }

    // ── Editing view ──────────────────────────────────────────────────────
    return (
        <div className="space-y-6">
            {unifiedRotationCard}
            <Card>
                <CardHeader>
                    <CardTitle>Rotation Order</CardTitle>
                    <CardDescription>{editDescription}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-2">
                    <div className="flex items-center gap-3">
                        <Switch
                            id="same-order-toggle"
                            checked={sameForAll || unifiedRotation}
                            onCheckedChange={setSameForAll}
                            disabled={unifiedRotation}
                        />
                        <Label htmlFor="same-order-toggle" className="cursor-pointer">
                            Use the same order for all campaigns
                        </Label>
                    </div>
                    {unifiedRotation && (
                        <p className="text-xs text-muted-foreground">
                            Pool-wide rotation is on, so one order applies to every campaign.
                        </p>
                    )}
                    {sameForAll && ordersDiffer && (
                        <p className="rounded border border-warning-200 bg-warning-50 p-2 text-xs text-warning-700">
                            Orders currently differ across campaigns. Saving will normalize all
                            campaigns to the order shown below.
                        </p>
                    )}
                </CardContent>
            </Card>

            {sameForAll || unifiedRotation ? (
                <Card>
                    <CardHeader>
                        <CardTitle>Order (applies to all campaigns)</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <EditableOrderedList
                            order={unifiedOrder}
                            nameById={nameById}
                            onChange={setUnifiedOrder}
                        />
                        <div className="flex justify-end gap-2">
                            <MyButton
                                buttonType="secondary"
                                scale="medium"
                                onClick={cancelEdit}
                                disable={saving}
                            >
                                Cancel
                            </MyButton>
                            <MyButton
                                buttonType="primary"
                                scale="medium"
                                onClick={handleSaveSame}
                                disable={saving}
                            >
                                {saving ? 'Saving…' : 'Save Order for All'}
                            </MyButton>
                        </div>
                    </CardContent>
                </Card>
            ) : (
                <Card>
                    <CardHeader>
                        <CardTitle>Order (per campaign)</CardTitle>
                        <CardDescription>
                            Pick a campaign and arrange the counselors for its rotation.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <Select
                            value={selectedAudienceId}
                            onValueChange={setSelectedAudienceId}
                        >
                            <SelectTrigger className="w-full max-w-md">
                                <SelectValue placeholder="Select a campaign" />
                            </SelectTrigger>
                            <SelectContent>
                                {audiences.map((a) => (
                                    <SelectItem key={a.audience_id} value={a.audience_id}>
                                        {campaignName(a.audience_id)}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>

                        <EditableOrderedList
                            order={perAudienceOrder}
                            nameById={nameById}
                            onChange={setPerAudienceOrder}
                        />
                        <div className="flex justify-end gap-2">
                            <MyButton
                                buttonType="secondary"
                                scale="medium"
                                onClick={cancelEdit}
                                disable={saving}
                            >
                                Cancel
                            </MyButton>
                            <MyButton
                                buttonType="primary"
                                scale="medium"
                                onClick={handleSavePerAudience}
                                disable={saving || !selectedAudienceId}
                            >
                                {saving ? 'Saving…' : 'Save Order for this Campaign'}
                            </MyButton>
                        </div>
                    </CardContent>
                </Card>
            )}
        </div>
    );
}

interface UnifiedRotationCardProps {
    checked: boolean;
    disabled: boolean;
    onChange: (next: boolean) => void;
}

function UnifiedRotationCard({ checked, disabled, onChange }: UnifiedRotationCardProps) {
    return (
        <Card>
            <CardContent className="flex items-start gap-3 pt-6">
                <Switch
                    id="unified-rotation-toggle"
                    checked={checked}
                    onCheckedChange={onChange}
                    disabled={disabled}
                />
                <div className="space-y-1">
                    <Label htmlFor="unified-rotation-toggle" className="cursor-pointer">
                        Pool-wide rotation
                    </Label>
                    <p className="text-xs text-muted-foreground">
                        Leads from every campaign follow one rotation order, so no counsellor is
                        skipped when campaigns&apos; orders drift apart. Per-campaign orders are
                        ignored while this is on.
                    </p>
                </div>
            </CardContent>
        </Card>
    );
}

interface OrderedListProps {
    order: string[];
    nameById: Map<string, string>;
}

function ReadOnlyOrderedList({ order, nameById }: OrderedListProps) {
    return (
        <ol className="divide-y rounded border">
            {order.map((id, idx) => (
                <li key={id} className="flex items-center gap-3 p-3">
                    <span className="w-6 text-sm font-medium text-muted-foreground">
                        #{idx + 1}
                    </span>
                    <span className="text-sm font-medium">
                        {nameById.get(id) ?? id.slice(0, 8) + '…'}
                    </span>
                </li>
            ))}
        </ol>
    );
}

interface EditableOrderedListProps extends OrderedListProps {
    onChange: (next: string[]) => void;
}

function EditableOrderedList({ order, nameById, onChange }: EditableOrderedListProps) {
    const move = (idx: number, direction: -1 | 1) => {
        const next = [...order];
        const target = idx + direction;
        if (target < 0 || target >= next.length) return;
        [next[idx], next[target]] = [next[target]!, next[idx]!];
        onChange(next);
    };

    return (
        <ol className="divide-y rounded border">
            {order.map((id, idx) => (
                <li key={id} className="flex items-center justify-between gap-3 p-3">
                    <div className="flex items-center gap-3">
                        <span className="w-6 text-sm font-medium text-muted-foreground">
                            #{idx + 1}
                        </span>
                        <span className="text-sm font-medium">
                            {nameById.get(id) ?? id.slice(0, 8) + '…'}
                        </span>
                    </div>
                    <div className="flex gap-1">
                        <button
                            type="button"
                            className="rounded border px-2 py-1 text-xs disabled:opacity-30"
                            onClick={() => move(idx, -1)}
                            disabled={idx === 0}
                            aria-label="Move up"
                        >
                            ↑
                        </button>
                        <button
                            type="button"
                            className="rounded border px-2 py-1 text-xs disabled:opacity-30"
                            onClick={() => move(idx, 1)}
                            disabled={idx === order.length - 1}
                            aria-label="Move down"
                        >
                            ↓
                        </button>
                    </div>
                </li>
            ))}
        </ol>
    );
}

function audienceOrdersDiffer(members: PoolMemberDTO[], audiences: { audience_id: string }[]): boolean {
    if (audiences.length <= 1) return false;
    const perAudience = audiences.map((a) =>
        members
            .filter((m) => m.audience_id === a.audience_id)
            .sort((x, y) => x.display_order - y.display_order)
            .map((m) => m.counselor_user_id)
            .join(',')
    );
    const first = perAudience[0];
    return perAudience.some((s) => s !== first);
}

function extractError(err: unknown): string | undefined {
    return (
        (err as { response?: { data?: { ex?: string; message?: string } } })?.response?.data?.ex ??
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message
    );
}
