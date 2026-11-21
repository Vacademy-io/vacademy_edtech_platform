import { useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import {
    ArrowsLeftRight,
    Buildings,
    Check,
    CircleNotch,
    MagnifyingGlass,
    WarningCircle,
} from '@phosphor-icons/react';
import { MyDialog } from '@/components/design-system/dialog';
import { MyButton } from '@/components/design-system/button';
import { MyInput } from '@/components/design-system/input';
import {
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { getCurrentInstituteId, getRolesForCurrentInstitute } from '@/lib/auth/instituteUtils';
import {
    canOfferInstituteSwitch,
    filterInstitutesByQuery,
    formatRoleName,
    getRoleLabelParts,
} from '@/lib/auth/instituteSwitch';
import {
    beginInstituteSwitch,
    commitInstituteSwitch,
    completeInstituteSwitchWithSubOrg,
    getSwitchableInstitutes,
    isHostBoundToInstitute,
    reloadIfRestoredFromBfcache,
    rollbackInstituteSwitch,
    type InstituteSwitchSession,
} from '@/lib/auth/instituteSwitchFlow';
import { fetchInstituteDetailsById as fetchInstituteSummary } from '@/services/student-list-section/getInstituteDetails';
import { fetchInstituteDetailsById as fetchInstituteFullDetails } from '@/lib/auth/instituteService';
import { getPublicUrl } from '@/services/upload_file';
import type { SubOrgAccess } from '@/types/faculty-access';

/** "Admin", "Counsellor +1" — the user's role in one institute. */
const useRoleLabel = () => {
    const { t } = useTranslation('navbar');
    return (roles: string[]): string => {
        const { primary, extraCount } = getRoleLabelParts(roles);
        if (primary === 'UNKNOWN') return '';
        const name =
            primary === 'ADMIN' || primary === 'TEACHER'
                ? t(`instituteSwitcher.roles.${primary}`)
                : formatRoleName(primary);
        return extraCount > 0
            ? t('instituteSwitcher.roleWithMore', { role: name, count: extraCount })
            : name;
    };
};

function InstituteAvatar({
    name,
    logoUrl,
    className,
}: {
    name: string;
    logoUrl?: string | null;
    className?: string;
}) {
    if (logoUrl) {
        return (
            <img
                src={logoUrl}
                alt=""
                aria-hidden
                className={cn(
                    'size-9 shrink-0 rounded-md border border-neutral-200 bg-white object-contain',
                    className
                )}
            />
        );
    }
    const initial = name.trim().charAt(0).toUpperCase();
    return (
        <span
            aria-hidden
            className={cn(
                'flex size-9 shrink-0 items-center justify-center rounded-md bg-primary-50 text-sm font-semibold text-primary-500',
                className
            )}
        >
            {initial || <Buildings className="size-4" />}
        </span>
    );
}

/** Whether this user/host gets the switcher at all (≥2 eligible institutes, host keeps the choice). */
export const useCanSwitchInstitute = (): boolean =>
    useMemo(
        () => canOfferInstituteSwitch(getSwitchableInstitutes().length, isHostBoundToInstitute()),
        []
    );

/**
 * Top of the profile dropdown: the institute being worked in and, when the user
 * has another one, the "Switch institute" entry.
 */
export function InstituteSwitcherMenuSection({
    instituteName,
    logoFileId,
    canSwitch,
    onSwitchClick,
}: {
    instituteName?: string | null;
    logoFileId?: string | null;
    canSwitch: boolean;
    onSwitchClick: () => void;
}) {
    const { t } = useTranslation('navbar');
    const roleLabel = useRoleLabel();
    const { data: logoUrl } = useQuery({
        queryKey: ['INSTITUTE_SWITCHER_LOGO', logoFileId],
        queryFn: () => getPublicUrl(logoFileId),
        enabled: !!logoFileId,
        staleTime: 30 * 60 * 1000,
    });
    const name = instituteName || t('instituteSwitcher.unnamedInstitute');
    const role = roleLabel(getRolesForCurrentInstitute());

    return (
        <>
            <DropdownMenuLabel className="flex w-60 max-w-full items-center gap-3 p-2 font-normal">
                <InstituteAvatar name={name} logoUrl={logoUrl} />
                <div className="min-w-0 flex-1">
                    <p className="text-caption text-neutral-500">
                        {t('instituteSwitcher.currentInstitute')}
                    </p>
                    <p className="truncate text-sm font-semibold text-neutral-800" title={name}>
                        {name}
                    </p>
                    {role && <p className="truncate text-caption text-neutral-500">{role}</p>}
                </div>
            </DropdownMenuLabel>
            {canSwitch && (
                <DropdownMenuItem
                    className="w-full cursor-pointer gap-2"
                    onSelect={() => onSwitchClick()}
                >
                    <ArrowsLeftRight className="size-4 text-neutral-600" />
                    {t('instituteSwitcher.switchInstitute')}
                </DropdownMenuItem>
            )}
            <DropdownMenuSeparator className="w-full" />
        </>
    );
}

interface InstituteSummary {
    name: string | null;
    logoFileId: string | null;
}

/**
 * Names for the switcher list. Same source of truth as the login picker
 * (institute details by id); the lighter details-non-batches call first, the
 * picker's full-details call as a fallback. Throws only when every lookup
 * failed, so the dialog can show its error state.
 */
const fetchInstituteSummaries = async (
    ids: string[]
): Promise<Record<string, InstituteSummary | null>> => {
    const entries = await Promise.all(
        ids.map(async (id) => {
            const details = await fetchInstituteSummary(id)
                .catch(() => fetchInstituteFullDetails(id))
                .catch(() => null);
            if (!details?.institute_name) return [id, null] as const;
            return [
                id,
                {
                    name: details.institute_name,
                    logoFileId: details.institute_logo_file_id ?? null,
                },
            ] as const;
        })
    );
    if (ids.length > 0 && entries.every(([, summary]) => summary === null)) {
        throw new Error('institute_names_unavailable');
    }
    return Object.fromEntries(entries);
};

type Phase =
    | { kind: 'list' }
    | { kind: 'subOrg'; subOrgs: SubOrgAccess[]; instituteName: string }
    | { kind: 'redirecting' };

/**
 * Searchable list of the user's institutes (name + their role there). Picking
 * one runs the login picker's post-selection steps and reloads into it — see
 * lib/auth/instituteSwitchFlow.ts.
 */
export function InstituteSwitcherDialog({
    open,
    onOpenChange,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
}) {
    const { t } = useTranslation('navbar');
    const roleLabel = useRoleLabel();
    const queryClient = useQueryClient();
    const [search, setSearch] = useState('');
    const [phase, setPhase] = useState<Phase>({ kind: 'list' });
    const [pendingId, setPendingId] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const sessionRef = useRef<InstituteSwitchSession | null>(null);

    const currentInstituteId = getCurrentInstituteId();
    const institutes = useMemo(() => getSwitchableInstitutes(), []);
    const ids = useMemo(() => institutes.map((inst) => inst.id), [institutes]);

    const summaries = useQuery({
        queryKey: ['INSTITUTE_SWITCHER_SUMMARIES', ids],
        queryFn: () => fetchInstituteSummaries(ids),
        enabled: open && ids.length > 0,
        staleTime: 10 * 60 * 1000,
        retry: 1,
    });

    const rows = useMemo(() => {
        const list = institutes.map((inst) => ({
            ...inst,
            name:
                summaries.data?.[inst.id]?.name ??
                t('instituteSwitcher.fallbackName', { idPrefix: inst.id.slice(0, 8) }),
            isCurrent: inst.id === currentInstituteId,
        }));
        list.sort((a, b) =>
            a.isCurrent !== b.isCurrent ? (a.isCurrent ? -1 : 1) : a.name.localeCompare(b.name)
        );
        return list;
    }, [institutes, summaries.data, currentInstituteId, t]);

    const visibleRows = filterInstitutesByQuery(rows, search);
    const busy = pendingId !== null || phase.kind === 'redirecting';

    const cancelSubOrgStep = () => {
        const session = sessionRef.current;
        sessionRef.current = null;
        if (session) rollbackInstituteSwitch(session);
        // The target's selection already ran; reload so nothing of it stays in memory.
        window.location.reload();
    };

    const handleOpenChange = (next: boolean) => {
        if (next) {
            onOpenChange(true);
            return;
        }
        if (busy) return;
        if (phase.kind === 'subOrg') {
            cancelSubOrgStep();
            return;
        }
        setSearch('');
        setError(null);
        onOpenChange(false);
    };

    const handleFailure = (session: InstituteSwitchSession | null, reason: string) => {
        const needsReload = session ? rollbackInstituteSwitch(session) : false;
        sessionRef.current = null;
        const message =
            reason === 'admin_role_required'
                ? t('instituteSwitcher.adminRequired')
                : t('instituteSwitcher.switchFailed');
        toast.error(message);
        if (needsReload) {
            window.location.reload();
            return;
        }
        setError(message);
        setPendingId(null);
        setPhase({ kind: 'list' });
    };

    const handlePickInstitute = async (instituteId: string, instituteName: string) => {
        if (busy || instituteId === currentInstituteId) return;
        setError(null);
        setPendingId(instituteId);
        const { session, outcome } = await beginInstituteSwitch(instituteId);

        switch (outcome.status) {
            case 'redirect':
                setPhase({ kind: 'redirecting' });
                if (session) commitInstituteSwitch(session, outcome.redirectUrl, queryClient);
                return;
            case 'chooseSubOrg':
                sessionRef.current = session;
                setPendingId(null);
                setPhase({ kind: 'subOrg', subOrgs: outcome.subOrgs, instituteName });
                return;
            case 'signedOut':
                // handleInstituteSelection already cleared the session and explained why.
                setPhase({ kind: 'redirecting' });
                queryClient.clear();
                reloadIfRestoredFromBfcache();
                window.location.assign('/login');
                return;
            case 'failed':
                handleFailure(session, outcome.error);
                return;
        }
    };

    const handlePickSubOrg = async (subOrgId: string) => {
        const session = sessionRef.current;
        if (busy || !session) return;
        setPendingId(subOrgId);
        try {
            const redirectUrl = await completeInstituteSwitchWithSubOrg(
                session.targetInstituteId,
                subOrgId
            );
            setPhase({ kind: 'redirecting' });
            commitInstituteSwitch(session, redirectUrl, queryClient);
        } catch {
            handleFailure(session, 'institute_switch_failed');
        }
    };

    const heading =
        phase.kind === 'subOrg'
            ? t('instituteSwitcher.subOrgTitle')
            : t('instituteSwitcher.dialogTitle');

    return (
        <MyDialog
            heading={heading}
            open={open}
            onOpenChange={handleOpenChange}
            dialogWidth="max-w-md"
            footer={
                phase.kind === 'subOrg' ? (
                    <MyButton
                        buttonType="secondary"
                        scale="medium"
                        disabled={busy}
                        onClick={cancelSubOrgStep}
                    >
                        {t('instituteSwitcher.cancelSwitch')}
                    </MyButton>
                ) : undefined
            }
        >
            {phase.kind === 'redirecting' ? (
                <div
                    className="flex flex-col items-center justify-center gap-3 py-10 text-neutral-600"
                    role="status"
                >
                    <CircleNotch className="size-6 animate-spin text-primary-500" />
                    <p className="text-sm">{t('instituteSwitcher.switching')}</p>
                </div>
            ) : phase.kind === 'subOrg' ? (
                <div className="flex flex-col gap-4">
                    <p className="text-sm text-neutral-600">
                        {t('instituteSwitcher.subOrgDescription', {
                            institute: phase.instituteName,
                        })}
                    </p>
                    <ul className="flex flex-col gap-1">
                        {phase.subOrgs.map((subOrg) => {
                            const name = subOrg.subOrgName || subOrg.subOrgId.slice(0, 8);
                            const isPending = pendingId === subOrg.subOrgId;
                            return (
                                <li key={subOrg.subOrgId}>
                                    <button
                                        type="button"
                                        disabled={busy}
                                        onClick={() => void handlePickSubOrg(subOrg.subOrgId)}
                                        className="flex w-full items-center gap-3 rounded-md p-2 text-left transition-colors hover:bg-neutral-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 disabled:cursor-not-allowed disabled:opacity-60"
                                    >
                                        <InstituteAvatar name={name} />
                                        <span className="min-w-0 flex-1 truncate text-sm font-medium text-neutral-800">
                                            {name}
                                        </span>
                                        {isPending && (
                                            <CircleNotch className="size-4 shrink-0 animate-spin text-primary-500" />
                                        )}
                                    </button>
                                </li>
                            );
                        })}
                    </ul>
                </div>
            ) : (
                <div className="flex flex-col gap-4">
                    <p className="text-sm text-neutral-600">
                        {t('instituteSwitcher.dialogDescription')}
                    </p>
                    <div className="relative">
                        <MagnifyingGlass className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-neutral-400" />
                        <MyInput
                            input={search}
                            onChangeFunction={(e) => setSearch(e.target.value)}
                            inputPlaceholder={t('instituteSwitcher.searchPlaceholder')}
                            aria-label={t('instituteSwitcher.searchPlaceholder')}
                            className="w-full pl-9 sm:w-full"
                            disabled={busy}
                        />
                    </div>

                    {summaries.isError && (
                        <div
                            role="alert"
                            className="flex items-start gap-2 rounded-md border border-warning-200 bg-warning-50 p-3 text-sm text-warning-700"
                        >
                            <WarningCircle className="mt-0.5 size-4 shrink-0" />
                            <div className="flex min-w-0 flex-1 flex-col items-start gap-1">
                                <span>{t('instituteSwitcher.loadError')}</span>
                                <MyButton
                                    buttonType="text"
                                    scale="small"
                                    onClick={() => void summaries.refetch()}
                                >
                                    {t('instituteSwitcher.retry')}
                                </MyButton>
                            </div>
                        </div>
                    )}

                    {error && (
                        <p role="alert" className="text-sm text-danger-600">
                            {error}
                        </p>
                    )}

                    {summaries.isLoading ? (
                        <ul className="flex flex-col gap-1" aria-busy="true">
                            {institutes.map((inst) => (
                                <li key={inst.id} className="flex items-center gap-3 p-2">
                                    <Skeleton className="size-9 rounded-md" />
                                    <div className="flex flex-1 flex-col gap-1.5">
                                        <Skeleton className="h-3.5 w-3/5" />
                                        <Skeleton className="h-3 w-1/4" />
                                    </div>
                                </li>
                            ))}
                        </ul>
                    ) : visibleRows.length === 0 ? (
                        <p className="py-6 text-center text-sm text-neutral-500">
                            {t('instituteSwitcher.noMatches', { query: search.trim() })}
                        </p>
                    ) : (
                        <ul className="flex flex-col gap-1">
                            {visibleRows.map((inst) => {
                                const isPending = pendingId === inst.id;
                                const role = roleLabel(inst.roles);
                                return (
                                    <li key={inst.id}>
                                        <button
                                            type="button"
                                            disabled={busy || inst.isCurrent}
                                            aria-current={inst.isCurrent ? 'true' : undefined}
                                            onClick={() =>
                                                void handlePickInstitute(inst.id, inst.name)
                                            }
                                            className={cn(
                                                'flex w-full items-center gap-3 rounded-md p-2 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500',
                                                inst.isCurrent
                                                    ? 'cursor-default bg-primary-50'
                                                    : 'hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-60'
                                            )}
                                        >
                                            <InstituteAvatar name={inst.name} />
                                            <span className="flex min-w-0 flex-1 flex-col">
                                                <span
                                                    className="truncate text-sm font-medium text-neutral-800"
                                                    title={inst.name}
                                                >
                                                    {inst.name}
                                                </span>
                                                {role && (
                                                    <span className="truncate text-caption text-neutral-500">
                                                        {role}
                                                    </span>
                                                )}
                                            </span>
                                            {isPending ? (
                                                <CircleNotch className="size-4 shrink-0 animate-spin text-primary-500" />
                                            ) : inst.isCurrent ? (
                                                <span className="flex shrink-0 items-center gap-1 text-caption font-medium text-primary-500">
                                                    <Check className="size-4" weight="bold" />
                                                    {t('instituteSwitcher.current')}
                                                </span>
                                            ) : null}
                                        </button>
                                    </li>
                                );
                            })}
                        </ul>
                    )}
                </div>
            )}
        </MyDialog>
    );
}
