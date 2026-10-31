import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import {
    AUDIENCE_CAMPAIGNS_LIST,
    GET_LIVE_SESSIONS,
    GET_INVITE_LIST,
    INIT_INSTITUTE,
} from '@/constants/urls';

/**
 * Show the search box only once the list is long enough to need it — filtering
 * two batches is noise, filtering four hundred is the only way through.
 */
const SEARCHABLE_FROM = 8;

interface EventEntityPickerProps {
    eventAppliedType: string;
    /** Single value — backward compat (used if multiValue not provided) */
    value?: string | undefined;
    onChange?: (id: string | undefined) => void;
    /** Multi-select mode */
    multiValue?: string[];
    onMultiChange?: (ids: string[]) => void;
    instituteId: string;
}

interface EntityOption {
    id: string;
    label: string;
    subtitle?: string;
}

async function fetchPackageSessions(instituteId: string, t: TFunction): Promise<EntityOption[]> {
    try {
        // Use the institute details endpoint which returns batches_for_sessions
        const response = await authenticatedAxiosInstance.get(`${INIT_INSTITUTE}/${instituteId}`);
        const batches = response.data?.batches_for_sessions ?? [];
        if (!Array.isArray(batches)) return [];
        return batches.map((batch: Record<string, unknown>) => {
            const pkg = (batch.package_dto ?? {}) as Record<string, string>;
            const level = (batch.level ?? {}) as Record<string, string>;
            const session = (batch.session ?? {}) as Record<string, string>;
            const packageName = pkg.package_name ?? t('unknown');
            const levelName = level.level_name ?? '';
            const sessionName = session.session_name ?? '';
            return {
                id: (batch.id as string) ?? '',
                label: `${packageName} — ${levelName} / ${sessionName}`.trim().replace(/— \/ $/, '').replace(/ \/ $/, ''),
                subtitle: (batch.status as string) ?? undefined,
            };
        });
    } catch {
        return [];
    }
}

async function fetchAudiences(instituteId: string, t: TFunction): Promise<EntityOption[]> {
    try {
        const response = await authenticatedAxiosInstance.post(AUDIENCE_CAMPAIGNS_LIST, {
            institute_id: instituteId,
            page: 0,
            size: 100,
        });
        const content = response.data?.content ?? response.data ?? [];
        if (!Array.isArray(content)) return [];
        return content.map((item: Record<string, string>) => ({
            id: item.campaign_id ?? item.id ?? '',
            label: item.campaign_name ?? item.name ?? item.id ?? t('unknown'),
            subtitle: item.campaign_type ?? undefined,
        }));
    } catch {
        return [];
    }
}

async function fetchLiveSessions(instituteId: string, t: TFunction): Promise<EntityOption[]> {
    try {
        const response = await authenticatedAxiosInstance.get(GET_LIVE_SESSIONS, {
            params: { instituteId },
        });
        const data = response.data ?? [];
        if (!Array.isArray(data)) return [];
        const sessions: EntityOption[] = [];
        for (const item of data) {
            if (item.sessions && Array.isArray(item.sessions)) {
                for (const s of item.sessions) {
                    sessions.push({
                        id: s.sessionId ?? s.session_id ?? s.id ?? '',
                        label: s.title ?? t('untitledSession'),
                        subtitle: s.subject ?? undefined,
                    });
                }
            } else {
                sessions.push({
                    id: item.sessionId ?? item.session_id ?? item.id ?? '',
                    label: item.title ?? t('untitledSession'),
                    subtitle: item.subject ?? undefined,
                });
            }
        }
        return sessions;
    } catch {
        return [];
    }
}

async function fetchEnrollInvites(instituteId: string, t: TFunction): Promise<EntityOption[]> {
    try {
        const response = await authenticatedAxiosInstance.post(GET_INVITE_LIST, {
            institute_id: instituteId,
            page_no: 0,
            page_size: 100,
        });
        const content = response.data?.content ?? response.data ?? [];
        if (!Array.isArray(content)) return [];
        return content.map((item: Record<string, string>) => ({
            id: item.id ?? '',
            label: item.name ?? item.inviteCode ?? item.id ?? t('unknown'),
            subtitle: item.inviteCode ? t('codeLabel', { code: item.inviteCode }) : undefined,
        }));
    } catch {
        return [];
    }
}

/**
 * Options for one applied-type, shared by the picker and by every read-only surface that
 * needs to turn stored entity ids back into names (the trigger summary, the trigger node
 * panel). Exported so those surfaces resolve labels from the SAME source the picker offers
 * -- a second lookup path would be one more place for ids to leak into the UI.
 */
export function useEntityOptions(eventAppliedType: string, instituteId: string) {
    const { t } = useTranslation('workflowEventEntityPicker');
    return useQuery({
        queryKey: ['workflow-entity-picker', eventAppliedType, instituteId],
        queryFn: async (): Promise<EntityOption[]> => {
            switch (eventAppliedType) {
                case 'PACKAGE_SESSION':
                    return fetchPackageSessions(instituteId, t);
                case 'AUDIENCE':
                    return fetchAudiences(instituteId, t);
                case 'LIVE_SESSION':
                    return fetchLiveSessions(instituteId, t);
                case 'ENROLL_INVITE':
                    return fetchEnrollInvites(instituteId, t);
                default:
                    return [];
            }
        },
        staleTime: 5 * 60 * 1000,
        enabled: !!instituteId && ['PACKAGE_SESSION', 'AUDIENCE', 'LIVE_SESSION', 'ENROLL_INVITE'].includes(eventAppliedType),
        retry: false,
    });
}

function buildTypeLabels(t: TFunction): Record<string, string> {
    return {
        PACKAGE_SESSION: t('typeLabels.packageSession'),
        AUDIENCE: t('typeLabels.audience'),
        LIVE_SESSION: t('typeLabels.liveSession'),
        ENROLL_INVITE: t('typeLabels.enrollInvite'),
        INSTITUTE: t('typeLabels.institute'),
        ASSESSMENT: t('typeLabels.assessment'),
        USER_PLAN: t('typeLabels.userPlan'),
        PAYMENT: t('typeLabels.payment'),
    };
}

export function EventEntityPicker({ eventAppliedType, value, onChange, multiValue, onMultiChange, instituteId }: EventEntityPickerProps) {
    const { t } = useTranslation('workflowEventEntityPicker');
    const [showManual, setShowManual] = useState(false);
    const [search, setSearch] = useState('');
    const hasDropdownSupport = ['PACKAGE_SESSION', 'AUDIENCE', 'LIVE_SESSION', 'ENROLL_INVITE'].includes(eventAppliedType);
    const { data: options = [], isLoading, isError } = useEntityOptions(eventAppliedType, instituteId);

    const typeLabel = buildTypeLabels(t)[eventAppliedType] ?? eventAppliedType.replace(/_/g, ' ').toLowerCase();

    // Multi-select mode
    const isMulti = !!onMultiChange;
    const selectedIds = multiValue ?? (value ? [value] : []);

    const toggleId = (id: string) => {
        if (!isMulti) {
            // Single mode: just set the value
            onChange?.(id || undefined);
            return;
        }
        const updated = selectedIds.includes(id)
            ? selectedIds.filter((s) => s !== id)
            : [...selectedIds, id];
        onMultiChange?.(updated);
    };

    // For INSTITUTE — no entity picker needed
    if (eventAppliedType === 'INSTITUTE') {
        return (
            <div className="rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-500">
                {t('institute.appliesToWhole')}
            </div>
        );
    }

    // For types without dropdown support — manual input
    if (!hasDropdownSupport || showManual || isError) {
        return (
            <div className="space-y-2">
                <div className="flex items-center justify-between">
                    <Label className="text-xs font-medium text-gray-600">
                        {t('manual.restrictLabel', { type: typeLabel })}
                    </Label>
                    {hasDropdownSupport && !isError && (
                        <button
                            type="button"
                            className="text-[10px] text-primary-500 hover:underline"
                            onClick={() => setShowManual(false)}
                        >
                            {t('manual.pickFromList')}
                        </button>
                    )}
                </div>
                <Input
                    value={isMulti ? selectedIds.join(', ') : (value ?? '')}
                    onChange={(e) => {
                        const raw = e.target.value;
                        if (isMulti) {
                            const ids = raw.split(',').map((s) => s.trim()).filter(Boolean);
                            onMultiChange?.(ids);
                        } else {
                            onChange?.(raw || undefined);
                        }
                    }}
                    className="text-sm"
                    placeholder={t('manual.placeholder', { type: typeLabel })}
                />
                <p className="text-[10px] text-gray-400">
                    {selectedIds.length > 0
                        ? t('manual.willFireForSelected', { count: selectedIds.length, type: typeLabel })
                        : t('manual.willFireForAll', { type: typeLabel })
                    }
                </p>
            </div>
        );
    }

    // Filter what's shown, never the selection: an institute with hundreds of
    // batches can't scroll to the one it wants, but a ticked row that scrolls
    // out of the filter must stay ticked. selectedIds is untouched, and the
    // summary below says when the search is hiding some of it.
    const needle = search.trim().toLowerCase();
    const visibleOptions = needle
        ? options.filter(
            (opt) =>
                opt.label.toLowerCase().includes(needle)
                || (opt.subtitle?.toLowerCase().includes(needle) ?? false)
        )
        : options;
    const hiddenSelectedCount = selectedIds.filter(
        (id) => !visibleOptions.some((opt) => opt.id === id)
    ).length;

    // Checkbox list mode for supported types (multi-select)
    return (
        <div className="space-y-2">
            <div className="flex items-center justify-between">
                <Label className="text-xs font-medium text-gray-600">
                    {t('checklist.selectLabel', { type: typeLabel })}
                </Label>
                <button
                    type="button"
                    className="text-[10px] text-primary-500 hover:underline"
                    onClick={() => setShowManual(true)}
                >
                    {t('checklist.enterIdManually')}
                </button>
            </div>

            {/* Only worth the extra control once the list is long enough that
                scrolling is the problem it solves. */}
            {options.length > SEARCHABLE_FROM && (
                <Input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="h-8 text-sm"
                    placeholder={t('checklist.searchPlaceholder', { type: typeLabel })}
                />
            )}

            <div className="max-h-48 overflow-y-auto rounded-lg border border-gray-300 bg-white">
                {isLoading && (
                    <div className="px-3 py-2 text-xs text-gray-400">{t('checklist.loading')}</div>
                )}
                {!isLoading && options.length === 0 && (
                    <div className="px-3 py-2 text-xs text-gray-400">{t('checklist.noneFound', { type: typeLabel })}</div>
                )}
                {!isLoading && options.length > 0 && visibleOptions.length === 0 && (
                    <div className="px-3 py-2 text-xs text-gray-400">
                        {t('checklist.noMatches', { search: search.trim() })}
                    </div>
                )}
                {visibleOptions.map((opt) => {
                    const checked = selectedIds.includes(opt.id);
                    return (
                        <label
                            key={opt.id}
                            className={`flex items-center gap-2.5 px-3 py-2 cursor-pointer border-b last:border-b-0 transition-colors ${
                                checked ? 'bg-primary-50' : 'hover:bg-gray-50'
                            }`}
                        >
                            <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => toggleId(opt.id)}
                                className="rounded border-gray-300 text-primary-600 focus:ring-primary-500 h-4 w-4"
                            />
                            <div className="flex-1 min-w-0">
                                <div className="text-sm text-gray-800 truncate">{opt.label}</div>
                                {opt.subtitle && (
                                    <div className="text-[10px] text-gray-400">{opt.subtitle}</div>
                                )}
                            </div>
                        </label>
                    );
                })}
            </div>

            {/* Selected count summary */}
            <p className="text-[10px] text-gray-400">
                {selectedIds.length === 0
                    ? t('checklist.summaryNone', { type: typeLabel })
                    : t('checklist.summarySelected', { count: selectedIds.length, type: typeLabel })
                }
                {/* The count above covers the whole selection, so say when the
                    search is hiding part of it rather than let it read wrong. */}
                {hiddenSelectedCount > 0 && ` — ${t('checklist.hiddenBySearch', { count: hiddenSelectedCount })}`}
            </p>
        </div>
    );
}

/**
 * Resolve stored trigger entity ids to display labels. Falls back to the raw id when the
 * entity list hasn't loaded or the id no longer exists (a deleted audience must still be
 * visible as something, not silently vanish from the summary).
 */
export function useEntityLabels(
    eventAppliedType: string | undefined,
    ids: string[],
    instituteId: string
): { labels: Array<{ id: string; label: string; resolved: boolean }>; isLoading: boolean } {
    const { data: options = [], isLoading } = useEntityOptions(eventAppliedType ?? '', instituteId);
    const labels = ids.map((id) => {
        const match = options.find((o) => o.id === id);
        return { id, label: match?.label ?? id, resolved: !!match };
    });
    return { labels, isLoading };
}
