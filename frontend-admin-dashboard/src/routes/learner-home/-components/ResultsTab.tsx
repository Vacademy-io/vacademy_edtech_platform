import { Fragment, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { CaretDown, CaretRight, DownloadSimple } from '@phosphor-icons/react';
import { Skeleton } from '@/components/ui/skeleton';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import { MyButton } from '@/components/design-system/button';
import { MyDialog } from '@/components/design-system/dialog';
import { cn } from '@/lib/utils';
import type { AnalyticsBlockRow, HomeBlock } from '../-types/learner-home-types';
import { learnerHomeApi } from '../-services/learner-home-service';
import { acksCsv, formatCtr, resultsRange } from '../-utils/results';
import { formatInZone } from '../-utils/schedule';
import { useInstituteZone } from '../-hooks/usePickerOptions';
import { BLOCK_TYPE_ICON, blockName } from './block-display';

const RANGES = [7, 30, 90] as const;
const ACKS_PAGE = 50;
/** The server's largest page (spec 5.2: size ≤ 100). */
const DOWNLOAD_PAGE = 100;

/** Results (spec 8.2): views, clicks and click rate per block, with details per slide or tile. */
export function ResultsTab({ instituteId, blocks }: { instituteId: string; blocks: HomeBlock[] }) {
    const { t } = useTranslation('learnerHome');
    const zone = useInstituteZone();
    const [days, setDays] = useState<(typeof RANGES)[number]>(30);
    const [open, setOpen] = useState<Set<string>>(new Set());
    const [acksFor, setAcksFor] = useState<{ key: string; name: string } | null>(null);
    const range = useMemo(() => resultsRange(days, zone), [days, zone]);
    const byKey = useMemo(() => new Map(blocks.map((b) => [b.block_key, b])), [blocks]);
    const analytics = useQuery({
        queryKey: ['learner-home', 'analytics', instituteId, range.from, range.to],
        queryFn: () => learnerHomeApi.getAnalytics(instituteId, range.from, range.to),
        enabled: !!instituteId,
    });

    const nameOf = (row: AnalyticsBlockRow) => {
        const block = byKey.get(row.block_key);
        if (block) return blockName(block, t);
        return row.admin_label || `${t(`blockTypes.${row.type}`)} · ${t('results.removedBlock')}`;
    };
    const itemLabel = (row: AnalyticsBlockRow, itemKey: string, fallback: string | null) => {
        const block = byKey.get(row.block_key);
        if (block?.type === 'BANNER_CAROUSEL') {
            const i = block.config.slides.findIndex((s) => s.key === itemKey);
            if (i >= 0) return t('results.slide', { n: i + 1 });
        }
        if (block?.type === 'SHORTCUTS') {
            const tile = block.config.tiles.find((x) => x.key === itemKey);
            if (tile?.label) return tile.label;
        }
        return fallback || itemKey;
    };
    const toggle = (key: string) =>
        setOpen((s) => {
            const next = new Set(s);
            if (next.has(key)) next.delete(key);
            else next.add(key);
            return next;
        });

    const rows = analytics.data?.blocks ?? [];
    return (
        <div className="space-y-4">
            <div className="flex flex-wrap gap-2" role="group">
                {RANGES.map((d) => (
                    <MyButton
                        key={d}
                        type="button"
                        buttonType={d === days ? 'primary' : 'secondary'}
                        scale="small"
                        aria-pressed={d === days}
                        onClick={() => setDays(d)}
                    >
                        {t(`results.range.${d}`)}
                    </MyButton>
                ))}
            </div>
            {analytics.isLoading && <Skeleton className="h-48 w-full" />}
            {analytics.isError && (
                <p className="text-body text-danger-600">{t('results.failed')}</p>
            )}
            {analytics.isSuccess && rows.length === 0 && (
                <p className="rounded-md border border-dashed border-neutral-300 p-6 text-center text-body text-neutral-500">
                    {t('results.empty')}
                </p>
            )}
            {rows.length > 0 && (
                <div className="overflow-x-auto rounded-md border border-neutral-200">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>{t('results.block')}</TableHead>
                                <TableHead className="text-end">{t('results.views')}</TableHead>
                                <TableHead className="text-end">{t('results.clicks')}</TableHead>
                                <TableHead className="text-end">{t('results.ctr')}</TableHead>
                                <TableHead className="text-end">{t('results.phone')}</TableHead>
                                <TableHead className="text-end">{t('results.desktop')}</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {rows.map((row) => {
                                const name = nameOf(row);
                                const Icon = BLOCK_TYPE_ICON[row.type] ?? BLOCK_TYPE_ICON.BUILTIN;
                                const phone = row.by_device.PHONE;
                                const desktop = row.by_device.DESKTOP;
                                const tablet = row.by_device.TABLET;
                                const expandable = row.items.length > 0 || row.type === 'NOTICE';
                                const isOpen = open.has(row.block_key);
                                return (
                                    <Fragment key={row.block_key}>
                                        <TableRow>
                                            <TableCell>
                                                <button
                                                    type="button"
                                                    disabled={!expandable}
                                                    onClick={() => toggle(row.block_key)}
                                                    aria-expanded={expandable ? isOpen : undefined}
                                                    aria-label={
                                                        expandable
                                                            ? t('results.expand', { name })
                                                            : undefined
                                                    }
                                                    className="flex items-center gap-1.5 rounded-sm text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default"
                                                >
                                                    {expandable ? (
                                                        isOpen ? (
                                                            <CaretDown
                                                                className="size-3.5"
                                                                aria-hidden
                                                            />
                                                        ) : (
                                                            <CaretRight
                                                                className="size-3.5"
                                                                aria-hidden
                                                            />
                                                        )
                                                    ) : (
                                                        <span className="size-3.5" aria-hidden />
                                                    )}
                                                    <Icon
                                                        className="size-4 text-primary-500"
                                                        aria-hidden
                                                    />
                                                    <span className="text-body">{name}</span>
                                                </button>
                                            </TableCell>
                                            <TableCell className="text-end tabular-nums">
                                                {row.views}
                                            </TableCell>
                                            <TableCell className="text-end tabular-nums">
                                                {row.clicks}
                                            </TableCell>
                                            <TableCell className="text-end tabular-nums">
                                                {formatCtr(row.clicks, row.views, row.ctr)}
                                            </TableCell>
                                            <TableCell className="text-end tabular-nums">
                                                {phone ? `${phone.views} / ${phone.clicks}` : '–'}
                                            </TableCell>
                                            <TableCell className="text-end tabular-nums">
                                                {desktop || tablet
                                                    ? `${(desktop?.views ?? 0) + (tablet?.views ?? 0)} / ${(desktop?.clicks ?? 0) + (tablet?.clicks ?? 0)}`
                                                    : '–'}
                                            </TableCell>
                                        </TableRow>
                                        {isOpen &&
                                            row.items.map((item) => (
                                                <TableRow
                                                    key={`${row.block_key}-${item.item_key}`}
                                                    className="bg-neutral-50"
                                                >
                                                    <TableCell className="ps-12 text-caption text-neutral-600">
                                                        {itemLabel(row, item.item_key, item.label)}
                                                    </TableCell>
                                                    <TableCell className="text-end text-caption tabular-nums">
                                                        {item.views}
                                                    </TableCell>
                                                    <TableCell className="text-end text-caption tabular-nums">
                                                        {item.clicks}
                                                    </TableCell>
                                                    <TableCell className="text-end text-caption tabular-nums">
                                                        {formatCtr(item.clicks, item.views)}
                                                    </TableCell>
                                                    <TableCell />
                                                    <TableCell />
                                                </TableRow>
                                            ))}
                                        {isOpen && row.type === 'NOTICE' && (
                                            <TableRow className="bg-neutral-50">
                                                <TableCell colSpan={6} className="ps-12">
                                                    <div className="flex flex-wrap items-center gap-4 text-caption text-neutral-600">
                                                        <span>
                                                            {t('results.dismisses')}:{' '}
                                                            <span className="tabular-nums">
                                                                {row.dismisses}
                                                            </span>
                                                        </span>
                                                        <span>
                                                            {t('results.acks')}:{' '}
                                                            <span className="tabular-nums">
                                                                {row.acks}
                                                            </span>
                                                        </span>
                                                        {row.acks > 0 && (
                                                            <MyButton
                                                                type="button"
                                                                buttonType="text"
                                                                scale="small"
                                                                onClick={() =>
                                                                    setAcksFor({
                                                                        key: row.block_key,
                                                                        name,
                                                                    })
                                                                }
                                                            >
                                                                {t('results.seeWhoRead')}
                                                            </MyButton>
                                                        )}
                                                    </div>
                                                </TableCell>
                                            </TableRow>
                                        )}
                                    </Fragment>
                                );
                            })}
                        </TableBody>
                    </Table>
                </div>
            )}
            {acksFor && (
                <AcksDialog
                    instituteId={instituteId}
                    blockKey={acksFor.key}
                    name={acksFor.name}
                    zone={zone}
                    onClose={() => setAcksFor(null)}
                />
            )}
        </div>
    );
}

function AcksDialog({
    instituteId,
    blockKey,
    name,
    zone,
    onClose,
}: {
    instituteId: string;
    blockKey: string;
    name: string;
    zone: string;
    onClose: () => void;
}) {
    const { t, i18n } = useTranslation('learnerHome');
    const [page, setPage] = useState(0);
    const list = useQuery({
        queryKey: ['learner-home', 'acks', instituteId, blockKey, page],
        queryFn: () => learnerHomeApi.getAcks(instituteId, blockKey, page, ACKS_PAGE),
    });
    const total = list.data?.total ?? 0;
    const pages = Math.max(1, Math.ceil(total / ACKS_PAGE));

    const download = async () => {
        // Every page, then one CSV built in the browser.
        const all = [];
        const downloadPages = Math.ceil(total / DOWNLOAD_PAGE);
        for (let p = 0; p < downloadPages; p += 1) {
            const res = await learnerHomeApi.getAcks(instituteId, blockKey, p, DOWNLOAD_PAGE);
            all.push(...res.rows);
        }
        const csv = acksCsv(all, [t('acks.name'), t('acks.email'), t('acks.at')]);
        const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
        const a = document.createElement('a');
        a.href = url;
        a.download = `read-${blockKey}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    };

    return (
        <MyDialog
            heading={t('acks.title', { name })}
            open
            onOpenChange={(o) => !o && onClose()}
            footerLeft={
                total > ACKS_PAGE ? (
                    <div className="flex items-center gap-2">
                        <MyButton
                            type="button"
                            buttonType="secondary"
                            scale="small"
                            disabled={page === 0}
                            onClick={() => setPage((p) => p - 1)}
                        >
                            {t('acks.prev')}
                        </MyButton>
                        <span className="text-caption text-neutral-500">
                            {page + 1} / {pages}
                        </span>
                        <MyButton
                            type="button"
                            buttonType="secondary"
                            scale="small"
                            disabled={page >= pages - 1}
                            onClick={() => setPage((p) => p + 1)}
                        >
                            {t('acks.next')}
                        </MyButton>
                    </div>
                ) : undefined
            }
            footer={
                <MyButton
                    type="button"
                    buttonType="secondary"
                    scale="medium"
                    disable={total === 0}
                    onAsyncClick={download}
                >
                    <DownloadSimple className="me-1 size-4" aria-hidden />
                    {t('acks.export')}
                </MyButton>
            }
        >
            {list.isLoading && <Skeleton className="h-40 w-full" />}
            {list.isError && <p className="text-body text-danger-600">{t('acks.failed')}</p>}
            {list.data && (
                <div className="space-y-3">
                    <p className="text-body text-neutral-700">
                        {t('acks.total', { count: total })}
                    </p>
                    {list.data.rows.length === 0 ? (
                        <p className="text-body text-neutral-500">{t('acks.empty')}</p>
                    ) : (
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>{t('acks.name')}</TableHead>
                                    <TableHead>{t('acks.email')}</TableHead>
                                    <TableHead>{t('acks.at')}</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {list.data.rows.map((r) => (
                                    <TableRow key={r.user_id}>
                                        <TableCell>{r.full_name || '–'}</TableCell>
                                        <TableCell className={cn(!r.email && 'text-neutral-400')}>
                                            {r.email || '–'}
                                        </TableCell>
                                        <TableCell>
                                            {formatInZone(r.acknowledged_at, zone, i18n.language)}
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    )}
                </div>
            )}
        </MyDialog>
    );
}
