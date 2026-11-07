import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { CaretDown, DownloadSimple, FileText, Users, X } from '@phosphor-icons/react';
import { MyTable } from '@/components/design-system/table';
import { MyPagination } from '@/components/design-system/pagination';
import { MyInput } from '@/components/design-system/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { getCurrentInstituteId } from '@/lib/auth/instituteUtils';
import {
    getFreebieDownloads,
    type FreebieLeadRow,
    type FreebieResourceRow,
} from './freebie-downloads-service';
import { FreebieKindIcon } from './freebie-kind';

const RANGES = [30, 90, 365];
const PAGE_SIZE = 20;
const CHIPS_SHOWN = 3;

const Stat = ({
    icon: Icon,
    label,
    value,
}: {
    icon: React.ComponentType<{ className?: string }>;
    label: string;
    value: string;
}) => (
    <div className="rounded-lg border border-neutral-200 p-3">
        <div className="flex items-center gap-1.5 text-caption text-neutral-500">
            <Icon className="size-3.5" />
            {label}
        </div>
        <p className="mt-1 text-h3 font-semibold text-neutral-800">{value}</p>
    </div>
);

const resourceName = (r: FreebieResourceRow) => r.title || r.url;



/**
 * Who took which freebies (resource cards) from the institute's websites.
 *
 * Every opened file is recorded against the lead whose form unlocked it in
 * that browser, so one lead taking seven files shows as one row with seven
 * items. Clicking a file in "Top freebies" narrows the lead list to the people
 * who took it.
 *
 * `audienceId` narrows to one list's leads (the list page); `hideWhenEmpty`
 * keeps the panel off pages where freebies are not in use; `collapsible`
 * starts it as a one-line summary so it does not push a lead table down;
 * `narrow` (the editor's side panel) lists leads as stacked rows instead of a
 * four-column table that would not fit.
 */
export const FreebieDownloadsPanel = ({
    audienceId,
    hideWhenEmpty = false,
    collapsible = false,
    narrow = false,
}: {
    audienceId?: string;
    hideWhenEmpty?: boolean;
    collapsible?: boolean;
    narrow?: boolean;
}) => {
    const { t, i18n } = useTranslation('freebieDownloads');
    const locale = i18n.language || 'en';
    const instituteId = getCurrentInstituteId();
    const [days, setDays] = useState(90);
    const [search, setSearch] = useState('');
    const [resourceFilter, setResourceFilter] = useState<string | null>(null);
    const [page, setPage] = useState(0);
    const [open, setOpen] = useState(!collapsible);

    const { data, isLoading, isError, refetch } = useQuery({
        queryKey: ['freebieDownloads', instituteId, days, audienceId ?? null],
        queryFn: () => getFreebieDownloads(instituteId!, days, audienceId),
        enabled: !!instituteId,
        staleTime: 60_000,
        retry: 1,
    });

    const filteredLeads = useMemo(() => {
        const q = search.trim().toLowerCase();
        return (data?.leads ?? []).filter((l) => {
            if (resourceFilter && !l.resources.includes(resourceFilter)) return false;
            if (!q) return true;
            return [l.name, l.email, l.mobileNumber].some((v) => (v || '').toLowerCase().includes(q));
        });
    }, [data, search, resourceFilter]);

    const totalPages = Math.max(1, Math.ceil(filteredLeads.length / PAGE_SIZE));
    const safePage = Math.min(page, totalPages - 1);
    const tableData = {
        content: filteredLeads.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE),
        total_pages: totalPages,
        page_no: safePage,
        page_size: PAGE_SIZE,
        total_elements: filteredLeads.length,
        last: safePage >= totalPages - 1,
    };

    const formatDate = (iso: string | null) =>
        iso
            ? new Date(iso).toLocaleString(locale, {
                  day: 'numeric',
                  month: 'short',
                  hour: 'numeric',
                  minute: '2-digit',
              })
            : '—';

    // Rebuilt with `t` in the deps — a memo that omits it freezes raw keys.
    const columns = useMemo<ColumnDef<FreebieLeadRow>[]>(
        () => [
            {
                id: 'lead',
                header: t('columns.lead'),
                size: 240,
                cell: ({ row }) => {
                    const l = row.original;
                    return (
                        <div className="min-w-0">
                            <p className="truncate text-body font-medium text-neutral-800">
                                {l.name || l.email || l.mobileNumber || t('unnamed')}
                            </p>
                            <p className="truncate text-caption text-neutral-500">
                                {[l.mobileNumber, l.email].filter(Boolean).join(' · ')}
                            </p>
                        </div>
                    );
                },
            },
            {
                id: 'downloads',
                header: t('columns.freebies'),
                size: 110,
                cell: ({ row }) => (
                    <span className="inline-flex items-center gap-1 rounded-full bg-primary-50 px-2.5 py-0.5 text-caption font-semibold text-primary-500">
                        <DownloadSimple className="size-3" />
                        {row.original.resources.length}
                    </span>
                ),
            },
            {
                id: 'resources',
                header: t('columns.took'),
                size: 380,
                cell: ({ row }) => {
                    const items = row.original.resources;
                    const extra = items.length - CHIPS_SHOWN;
                    return (
                        <div className="flex flex-wrap gap-1" title={items.join('\n')}>
                            {items.slice(0, CHIPS_SHOWN).map((name) => (
                                <span
                                    key={name}
                                    className="max-w-48 truncate rounded-md bg-neutral-100 px-2 py-0.5 text-caption text-neutral-700"
                                >
                                    {name}
                                </span>
                            ))}
                            {extra > 0 && (
                                <span className="rounded-md px-1 py-0.5 text-caption text-neutral-500">
                                    {t('more', { count: extra })}
                                </span>
                            )}
                        </div>
                    );
                },
            },
            {
                id: 'last',
                header: t('columns.last'),
                size: 140,
                cell: ({ row }) => (
                    <span className="text-caption text-neutral-600">
                        {formatDate(row.original.lastDownloadedAt)}
                    </span>
                ),
            },
        ],
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [t, locale]
    );

    if (isLoading) {
        return hideWhenEmpty ? null : (
            <div className="space-y-3 p-4">
                <div className="h-6 w-40 animate-pulse rounded-md bg-neutral-100" />
                <div className="h-24 animate-pulse rounded-lg bg-neutral-100" />
            </div>
        );
    }
    if (isError) {
        return hideWhenEmpty ? null : (
            <div className="flex items-center gap-2 p-4 text-caption text-danger-600">
                {t('error')}
                <button type="button" onClick={() => refetch()} className="font-medium underline">
                    {t('retry')}
                </button>
            </div>
        );
    }

    const empty = !data || data.totalDownloads === 0;
    if (empty && hideWhenEmpty) return null;

    const maxDownloads = Math.max(1, ...(data?.resources ?? []).map((r) => r.downloads));
    const summary = data
        ? t('summary', {
              downloads: data.totalDownloads.toLocaleString(locale),
              leads: data.leadsWithDownloads.toLocaleString(locale),
          })
        : '';

    return (
        <div className={cn('space-y-4', collapsible ? 'rounded-lg border border-neutral-200 p-3' : 'p-4')}>
            <div className="flex flex-wrap items-center justify-between gap-2">
                <button
                    type="button"
                    disabled={!collapsible}
                    onClick={() => setOpen((o) => !o)}
                    aria-expanded={open}
                    className="flex items-center gap-2 text-start disabled:cursor-default"
                >
                    <DownloadSimple className="size-5 text-primary-500" />
                    <h3 className="text-title font-semibold text-neutral-800">{t('title')}</h3>
                    {collapsible && !open && <span className="text-caption text-neutral-500">{summary}</span>}
                    {collapsible && (
                        <CaretDown className={cn('size-4 text-neutral-500 transition-transform', open && 'rotate-180')} />
                    )}
                </button>
                {open && (
                <div className="flex gap-1">
                    {RANGES.map((d) => (
                        <button
                            key={d}
                            type="button"
                            onClick={() => {
                                setDays(d);
                                setPage(0);
                            }}
                            className={cn(
                                'rounded-full border px-3 py-1 text-caption font-medium',
                                days === d
                                    ? 'border-primary-400 bg-primary-50 text-primary-500'
                                    : 'border-neutral-200 text-neutral-600 hover:border-neutral-300'
                            )}
                        >
                            {t('days', { count: d })}
                        </button>
                    ))}
                </div>
                )}
            </div>

            {!open ? null : empty ? (
                <div className="rounded-lg border border-dashed border-neutral-200 py-10 text-center">
                    <p className="text-body text-neutral-600">{t('empty.title')}</p>
                    <p className="mx-auto mt-1 max-w-md text-caption text-neutral-400">{t('empty.body')}</p>
                </div>
            ) : (
                <>
                    <div className={cn('grid', narrow ? 'grid-cols-3 gap-2' : 'grid-cols-2 gap-3 lg:grid-cols-3')}>
                        <Stat
                            icon={DownloadSimple}
                            label={t('stats.downloads')}
                            value={data.totalDownloads.toLocaleString(locale)}
                        />
                        <Stat
                            icon={Users}
                            label={t('stats.leads')}
                            value={data.leadsWithDownloads.toLocaleString(locale)}
                        />
                        <Stat
                            icon={FileText}
                            label={t('stats.files')}
                            value={data.resources.length.toLocaleString(locale)}
                        />
                    </div>

                    <div>
                        <Label className="text-xs">{t('top.title')}</Label>
                        <p className="text-caption text-neutral-400">{t('top.hint')}</p>
                        <div className="mt-2 space-y-1.5">
                            {data.resources.slice(0, 10).map((r) => {
                                const name = resourceName(r);
                                const active = resourceFilter === name;
                                return (
                                    <button
                                        key={r.url}
                                        type="button"
                                        onClick={() => {
                                            setResourceFilter(active ? null : name);
                                            setPage(0);
                                        }}
                                        className={cn(
                                            'block w-full space-y-1 rounded-md px-1.5 py-1 text-start hover:bg-neutral-50',
                                            active && 'bg-primary-50 hover:bg-primary-50'
                                        )}
                                        title={r.url}
                                    >
                                        <span className="flex items-center justify-between gap-2">
                                            <span className="flex min-w-0 items-center gap-1.5">
                                                <FreebieKindIcon url={r.url} />
                                                <span className="truncate text-caption text-neutral-700">{name}</span>
                                            </span>
                                            <span className="shrink-0 text-caption text-neutral-600">
                                                {t('top.counts', {
                                                    downloads: r.downloads.toLocaleString(locale),
                                                    leads: r.leads.toLocaleString(locale),
                                                })}
                                            </span>
                                        </span>
                                        <span className="block h-2 overflow-hidden rounded bg-neutral-100">
                                            <span
                                                className="block h-full rounded bg-primary-300"
                                                style={{ width: `${Math.round((r.downloads / maxDownloads) * 100)}%` }} // design-lint-ignore: data-driven bar width
                                            />
                                        </span>
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    <div className="space-y-2">
                        <div className="flex flex-wrap items-end justify-between gap-2">
                            <div>
                                <Label className="text-xs">{t('leads.title')}</Label>
                                {resourceFilter && (
                                    <button
                                        type="button"
                                        onClick={() => setResourceFilter(null)}
                                        className="ms-2 inline-flex items-center gap-1 rounded-full bg-primary-50 px-2 py-0.5 text-caption text-primary-500"
                                    >
                                        {t('leads.filteredBy', { name: resourceFilter })}
                                        <X className="size-3" />
                                    </button>
                                )}
                            </div>
                            <MyInput
                                input={search}
                                onChangeFunction={(e) => {
                                    setSearch(e.target.value);
                                    setPage(0);
                                }}
                                inputPlaceholder={t('leads.search')}
                                size="medium"
                            />
                        </div>
                        {filteredLeads.length === 0 ? (
                            <p className="rounded-lg border border-dashed border-neutral-200 py-6 text-center text-caption text-neutral-500">
                                {data.leads.length === 0 ? t('leads.noneYet') : t('leads.noMatch')}
                            </p>
                        ) : narrow ? (
                            <ul className="divide-y divide-neutral-100 rounded-lg border border-neutral-200">
                                {tableData.content.map((l) => (
                                    <li key={l.responseId} className="space-y-1.5 p-2.5">
                                        <div className="flex items-start justify-between gap-2">
                                            <div className="min-w-0">
                                                <p className="truncate text-body font-medium text-neutral-800">
                                                    {l.name || l.email || l.mobileNumber || t('unnamed')}
                                                </p>
                                                <p className="truncate text-caption text-neutral-500">
                                                    {[l.mobileNumber, l.email].filter(Boolean).join(' · ')}
                                                </p>
                                            </div>
                                            <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-primary-50 px-2 py-0.5 text-caption font-semibold text-primary-500">
                                                <DownloadSimple className="size-3" />
                                                {l.resources.length}
                                            </span>
                                        </div>
                                        <div className="flex flex-wrap gap-1">
                                            {l.resources.map((name) => (
                                                <span
                                                    key={name}
                                                    className="max-w-full truncate rounded-md bg-neutral-100 px-2 py-0.5 text-caption text-neutral-700"
                                                >
                                                    {name}
                                                </span>
                                            ))}
                                        </div>
                                        <p className="text-caption text-neutral-400">{formatDate(l.lastDownloadedAt)}</p>
                                    </li>
                                ))}
                            </ul>
                        ) : null}
                        {narrow && filteredLeads.length > 0 && totalPages > 1 && (
                            <MyPagination currentPage={safePage} totalPages={totalPages} onPageChange={setPage} />
                        )}
                        {filteredLeads.length === 0 || narrow ? null : (
                            <>
                                <MyTable<FreebieLeadRow>
                                    data={tableData}
                                    columns={columns}
                                    isLoading={false}
                                    error={null}
                                    currentPage={safePage}
                                    enableColumnResizing={false}
                                />
                                {totalPages > 1 && (
                                    <MyPagination
                                        currentPage={safePage}
                                        totalPages={totalPages}
                                        onPageChange={setPage}
                                    />
                                )}
                            </>
                        )}
                        {data.leads.length >= 500 && (
                            <p className="text-caption text-neutral-400">{t('leads.capped')}</p>
                        )}
                    </div>
                </>
            )}
        </div>
    );
};

export default FreebieDownloadsPanel;
