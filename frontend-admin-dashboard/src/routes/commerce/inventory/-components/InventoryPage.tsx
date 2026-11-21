import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { PlainSelect } from '@/routes/commerce/-components/CatalogueBits';
import { CommercePage } from '@/routes/commerce/-components/CommercePage';
import { CommerceEmptyState, CommerceLoadingRows } from '@/routes/commerce/-components/CommerceStates';
import {
    assignedLocations,
    readRememberedLocation,
    rememberLocation,
    useInventoryLocations,
} from '../-shared/inventory-hooks';
import {
    INVENTORY_TABS,
    type InventoryLocation,
    type InventoryTab,
    ONE_LOCATION_TABS,
    type ReceiveSource,
} from '../-shared/inventory-types';
import { CountsTab } from './CountsTab';
import { InventoryErrorNotice, NeedOneLocation } from './inventory-ui';
import { LabelsTab } from './LabelsTab';
import { LowStockTab } from './LowStockTab';
import { MovementsTab } from './MovementsTab';
import { type OpeningLink, OpeningStockPanel } from './OpeningStockPanel';
import { ReceiveTab } from './ReceiveTab';
import { StockTab } from './StockTab';
import { TransfersTab } from './TransfersTab';

export const ALL_LOCATIONS = 'all';

/** What every tab gets: the chosen place (null = all of mine) and the places. */
export interface TabProps {
    locationId: string | null;
    /** The places the person works at (ADMIN: all). */
    places: InventoryLocation[];
    /** Every place of the institute (names of other places, transfer destinations). */
    allPlaces: InventoryLocation[];
    onPickLocation: (id: string) => void;
    /** The receipt source to start with (the opening-stock panel's link: OPENING). */
    presetSource?: ReceiveSource;
}

/**
 * The place the screens work at: the address first, then the last choice on
 * this device, then the only place a person has; "All my locations" otherwise.
 */
export function resolveLocation(
    fromAddress: string | undefined,
    remembered: string | null,
    places: InventoryLocation[]
): string {
    const known = (id: string | null | undefined) => !!id && (id === ALL_LOCATIONS || places.some((p) => p.id === id));
    if (known(fromAddress)) return fromAddress as string;
    if (known(remembered)) return remembered as string;
    if (places.length === 1) return places[0]?.id as string;
    return ALL_LOCATIONS;
}

/** I1 (contract §7.1): seven tabs over the shop's stock, with a place picker in the header. */
export function InventoryPage() {
    const { t } = useTranslation('commerce');
    return (
        <CommercePage navId="commerce-inventory" title={t('inventory.title')} description={t('inventory.description')}>
            <InventoryBody />
        </CommercePage>
    );
}

function InventoryBody() {
    const { t } = useTranslation('commerce');
    const navigate = useNavigate();
    const search = useSearch({ from: '/commerce/inventory/' });
    const locations = useInventoryLocations();
    const places = useMemo(() => assignedLocations(locations.data), [locations.data]);
    const allPlaces = locations.data ?? [];
    const tab: InventoryTab = search.tab ?? 'stock';
    const location = resolveLocation(search.location, readRememberedLocation(), places);
    const locationId = location === ALL_LOCATIONS ? null : location;
    const [presetSource, setPresetSource] = useState<ReceiveSource | undefined>(undefined);

    const setSearch = (next: Partial<typeof search>) =>
        void navigate({
            to: '/commerce/inventory',
            search: (previous: Record<string, unknown>) => ({ ...previous, ...next }),
            replace: true,
        });

    const pickLocation = (id: string) => {
        rememberLocation(id);
        setSearch({ location: id });
    };

    useEffect(() => {
        if (locations.isSuccess && search.location !== location) setSearch({ location });
        // Write the resolved place into the address once the places are known.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [locations.isSuccess, location]);

    if (locations.isLoading) return <CommerceLoadingRows rows={4} />;
    if (locations.isError) return <InventoryErrorNotice error={locations.error} />;
    if (places.length === 0) {
        return (
            <CommerceEmptyState title={t('inventory.location.none')} description={t('inventory.location.noneHelp')} />
        );
    }

    const needsOne = ONE_LOCATION_TABS.includes(tab) && !locationId;
    const props: TabProps = { locationId, places, allPlaces, onPickLocation: pickLocation, presetSource };
    const openFromPanel = (next: OpeningLink) => {
        if (next === 'receive') setPresetSource('OPENING');
        setSearch({ tab: next, item: undefined });
    };

    return (
        <div className="flex flex-col gap-4">
            <OpeningStockPanel locationId={locationId} onGo={openFromPanel} />
            <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
                <InventoryTabs
                    active={tab}
                    onChange={(next) => {
                        setPresetSource(undefined);
                        setSearch({ tab: next, item: undefined });
                    }}
                />
                <PlainSelect
                    className="md:w-72"
                    label={t('inventory.location.label')}
                    value={location}
                    onChange={(id) => pickLocation(id || ALL_LOCATIONS)}
                    options={[
                        { value: ALL_LOCATIONS, label: t('inventory.location.all') },
                        ...places.map((p) => ({
                            value: p.id,
                            label: `${p.code} · ${p.name}${p.status === 'INACTIVE' ? ` (${t('status.location.INACTIVE')})` : ''}`,
                        })),
                    ]}
                />
            </div>
            <div role="tabpanel" id="inventory-panel" aria-labelledby={`inventory-tab-${tab}`}>
                {needsOne ? (
                    <NeedOneLocation places={places} onPick={pickLocation} />
                ) : (
                    <TabContent tab={tab} props={props} item={search.item} onItem={(item) => setSearch({ item })} />
                )}
            </div>
        </div>
    );
}

function TabContent({
    tab,
    props,
    item,
    onItem,
}: {
    tab: InventoryTab;
    props: TabProps;
    item: string | undefined;
    onItem: (item: string | undefined) => void;
}) {
    switch (tab) {
        case 'movements':
            return <MovementsTab {...props} item={item} onItem={onItem} />;
        case 'receive':
            return <ReceiveTab {...props} />;
        case 'transfers':
            return <TransfersTab {...props} />;
        case 'counts':
            return <CountsTab {...props} />;
        case 'low':
            return <LowStockTab {...props} />;
        case 'labels':
            return <LabelsTab {...props} />;
        default:
            return <StockTab {...props} />;
    }
}

/** The seven tabs: 48 px tall, scroll sideways on a phone; arrows move between them. */
function InventoryTabs({ active, onChange }: { active: InventoryTab; onChange: (tab: InventoryTab) => void }) {
    const { t } = useTranslation('commerce');
    const listRef = useRef<HTMLDivElement | null>(null);
    const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
        const tabs = Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]') ?? []);
        const current = tabs.indexOf(document.activeElement as HTMLButtonElement);
        if (current < 0) return;
        const last = tabs.length - 1;
        const moves: Record<string, number> = {
            ArrowRight: current === last ? 0 : current + 1,
            ArrowLeft: current === 0 ? last : current - 1,
            Home: 0,
            End: last,
        };
        const next = moves[event.key];
        if (next === undefined) return;
        event.preventDefault();
        tabs[next]?.focus();
    };
    return (
        <div
            ref={listRef}
            role="tablist"
            aria-label={t('inventory.title')}
            onKeyDown={onKeyDown}
            className="-mx-1 flex min-w-0 gap-1 overflow-x-auto px-1 pb-1"
        >
            {INVENTORY_TABS.map((id) => {
                const selected = id === active;
                return (
                    <button
                        key={id}
                        id={`inventory-tab-${id}`}
                        type="button"
                        role="tab"
                        aria-selected={selected}
                        aria-controls="inventory-panel"
                        tabIndex={selected ? 0 : -1}
                        onClick={() => onChange(id)}
                        className={cn(
                            'h-12 shrink-0 whitespace-nowrap rounded-md px-4 text-body transition-colors',
                            selected
                                ? 'bg-primary-50 font-medium text-primary-500'
                                : 'text-muted-foreground hover:bg-neutral-100 hover:text-foreground'
                        )}
                    >
                        {t(`inventory.tabs.${id}`)}
                    </button>
                );
            })}
        </div>
    );
}
