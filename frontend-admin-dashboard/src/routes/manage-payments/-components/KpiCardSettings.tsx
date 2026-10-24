import { useCallback, useMemo, useState } from 'react';
import { GearSix } from '@phosphor-icons/react';
import { Checkbox } from '@/components/ui/checkbox';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { MyButton } from '@/components/design-system/button';
import { getCurrentInstituteId } from '@/lib/auth/instituteUtils';
import { hasNotYetDueBalance, type KpiBilling, type KpiCardKey } from './PaymentKpiCards';
import { isInstalmentFirst } from './InstalmentForecast';

/** Every card an admin can switch on or off, in display order. */
export const KPI_CARD_OPTIONS: { key: KpiCardKey; label: string; description: string }[] = [
    { key: 'billed', label: 'Total', description: 'Collected + still to collect' },
    { key: 'paid', label: 'Collected', description: 'Money received' },
    { key: 'outstanding', label: 'Outstanding', description: 'Everything still to collect' },
    { key: 'due', label: 'Due', description: 'Overdue right now' },
    { key: 'upcoming', label: 'Upcoming', description: 'Expected, not yet owed' },
    {
        key: 'schedule',
        label: 'Instalment schedule',
        description: 'Upcoming instalments month by month (needs Upcoming)',
    },
    { key: 'pending', label: 'Payment pending', description: 'Online checkouts in progress' },
    { key: 'failed', label: 'Failed', description: 'Online payments declined' },
];

/**
 * What an institute sees before anyone touches the settings.
 *
 * With instalment plans, Upcoming already carries every future instalment, so Outstanding would
 * only repeat Due + Upcoming — it starts hidden. Otherwise the row is exactly what it was before
 * the settings existed: Outstanding appears only when it says something Due does not.
 *
 * Total and the instalment schedule start on only where instalments are the fee model (see
 * isInstalmentFirst, counted across the whole institute so the row does not change as the admin
 * filters) — there the whole fee is billed up front and paid over months. Everyone else keeps
 * exactly the row they had, and can switch either on themselves.
 */
export const defaultVisibleKpiCards = (billing?: KpiBilling | null): Set<KpiCardKey> => {
    const keys = KPI_CARD_OPTIONS.map((o) => o.key).filter((key) => {
        if (key === 'billed' || key === 'schedule') {
            return (
                !!billing && isInstalmentFirst(billing.instalmentPlanCount, billing.livePlanCount)
            );
        }
        if (key !== 'outstanding') return true;
        if (billing?.usesInstallments) return false;
        return hasNotYetDueBalance(billing);
    });
    return new Set(keys);
};

/**
 * Cards added after admins could first save their own row. A row saved before one of these existed
 * never had the chance to tick it, so it is shown by its default until the admin saves again —
 * otherwise an admin who once hid "Failed" would never see the new card at all.
 */
const CARDS_ADDED_LATER: KpiCardKey[] = ['billed', 'schedule'];

/** Set when the saved row was chosen with every card in CARDS_ADDED_LATER on offer. */
const savedWithNewCardsKey = () => `payment-kpi-cards-v2:${getCurrentInstituteId() ?? 'default'}`;

const readSavedWithNewCards = (): boolean => {
    try {
        return localStorage.getItem(savedWithNewCardsKey()) === '1';
    } catch {
        return false;
    }
};

const storageKey = () => `payment-kpi-cards:${getCurrentInstituteId() ?? 'default'}`;

const readStored = (): KpiCardKey[] | null => {
    try {
        const raw = localStorage.getItem(storageKey());
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return null;
        const known = new Set(KPI_CARD_OPTIONS.map((o) => o.key));
        return parsed.filter((x): x is KpiCardKey => known.has(x));
    } catch {
        return null;
    }
};

/**
 * Which KPI cards (and their matching tabs) are on, per institute in this browser. Until the admin
 * picks, the defaults follow the institute's fee model (see defaultVisibleKpiCards) and keep
 * tracking it; the first tick freezes an explicit list. Shared by Manage Payments and the Payment
 * Dashboard through the same storage key.
 */
export function useKpiCardPrefs(billing?: KpiBilling | null) {
    const [stored, setStored] = useState<KpiCardKey[] | null>(readStored);
    const [savedWithNewCards, setSavedWithNewCards] = useState<boolean>(readSavedWithNewCards);

    const visible = useMemo(() => {
        const defaults = defaultVisibleKpiCards(billing);
        if (!stored) return defaults;
        if (savedWithNewCards) return new Set(stored);
        // A row saved before the newer cards existed: keep it, and show those cards by default.
        return new Set([...stored, ...CARDS_ADDED_LATER.filter((key) => defaults.has(key))]);
    }, [stored, savedWithNewCards, billing]);

    const persist = (next: KpiCardKey[] | null) => {
        try {
            if (next) {
                localStorage.setItem(storageKey(), JSON.stringify(next));
                localStorage.setItem(savedWithNewCardsKey(), '1');
            } else {
                localStorage.removeItem(storageKey());
                localStorage.removeItem(savedWithNewCardsKey());
            }
        } catch {
            /* storage blocked — keep the in-memory choice */
        }
        setStored(next);
        setSavedWithNewCards(!!next);
    };

    const toggle = useCallback(
        (key: KpiCardKey) => {
            const next = new Set(visible);
            if (next.has(key)) next.delete(key);
            else next.add(key);
            persist(KPI_CARD_OPTIONS.map((o) => o.key).filter((k) => next.has(k)));
        },
        [visible]
    );

    const reset = useCallback(() => persist(null), []);

    return { visible, toggle, reset, isCustomised: stored !== null };
}

interface KpiCardSettingsProps {
    visible: Set<KpiCardKey>;
    onToggle: (key: KpiCardKey) => void;
    onReset: () => void;
    isCustomised: boolean;
    /** Options this screen has no use for (e.g. the schedule where there is no instalment plan). */
    hiddenOptions?: KpiCardKey[];
}

/** The gear button: tick which summary cards (and their tabs) to show. */
export function KpiCardSettings({
    visible,
    onToggle,
    onReset,
    isCustomised,
    hiddenOptions,
}: KpiCardSettingsProps) {
    return (
        <Popover>
            <Tooltip>
                <PopoverTrigger asChild>
                    <TooltipTrigger asChild>
                        <MyButton
                            buttonType="secondary"
                            scale="medium"
                            layoutVariant="icon"
                            aria-label="Choose which cards to show"
                        >
                            <GearSix size={18} />
                        </MyButton>
                    </TooltipTrigger>
                </PopoverTrigger>
                <TooltipContent side="bottom">Choose which cards to show</TooltipContent>
            </Tooltip>
            <PopoverContent align="end" className="w-72 p-3">
                <div className="mb-2 flex items-center justify-between">
                    <span className="text-caption font-semibold text-neutral-700">
                        Show cards & tabs
                    </span>
                    {isCustomised && (
                        <button
                            type="button"
                            onClick={onReset}
                            className="text-2xs font-semibold text-primary-600 hover:text-primary-700"
                        >
                            Reset to default
                        </button>
                    )}
                </div>
                <div className="flex flex-col gap-1">
                    {KPI_CARD_OPTIONS.filter((o) => !hiddenOptions?.includes(o.key)).map(
                        (option) => (
                            <label
                                key={option.key}
                                className="flex cursor-pointer items-start gap-2 rounded-md p-1.5 hover:bg-neutral-50"
                            >
                                <Checkbox
                                    className="mt-0.5"
                                    checked={visible.has(option.key)}
                                    onCheckedChange={() => onToggle(option.key)}
                                />
                                <span className="flex flex-col">
                                    <span className="text-caption text-neutral-700">
                                        {option.label}
                                    </span>
                                    <span className="text-2xs text-neutral-400">
                                        {option.description}
                                    </span>
                                </span>
                            </label>
                        )
                    )}
                </div>
            </PopoverContent>
        </Popover>
    );
}
