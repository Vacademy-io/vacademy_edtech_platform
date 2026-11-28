import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Ticket } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import { ACCESS_PASS_QUERY_KEYS, formatPassPrice, listAccessPasses } from '@/services/access-pass';

const COLS: Record<number, string> = { 2: 'grid-cols-2', 3: 'grid-cols-3', 4: 'grid-cols-4' };

/** Builder canvas preview of `accessPassGrid`: the passes the live section will show. */
export const AccessPassGridPreview: React.FC<{ props: any }> = ({ props }) => {
    const { data: passes = [], isLoading } = useQuery({
        queryKey: ACCESS_PASS_QUERY_KEYS.list,
        queryFn: listAccessPasses,
    });
    const tag = String(props.tag ?? '').trim().toLowerCase();
    const shown = passes.filter(
        (p) => p.status === 'ACTIVE' && (!tag || (p.tags ?? []).some((t) => t.toLowerCase() === tag))
    );
    const cols = COLS[Number(props.columns) || 3] ?? COLS[3];

    return (
        <div className="p-6">
            {props.title && <h2 className="text-xl font-semibold">{props.title}</h2>}
            {props.subtitle && <p className="mb-4 text-sm text-neutral-500">{props.subtitle}</p>}
            {isLoading ? (
                <p className="text-sm text-neutral-400">Loading passes…</p>
            ) : shown.length === 0 ? (
                <div className="rounded-md border border-dashed p-6 text-center text-sm text-neutral-500">
                    No published access passes{tag ? ` tagged “${props.tag}”` : ''} yet. Visitors will not see this
                    section until one is published.
                </div>
            ) : (
                <div className={cn('grid gap-4', cols)}>
                    {shown.map((p) => (
                        <div key={p.id} className="overflow-hidden rounded-lg border">
                            {p.cover_image_url ? (
                                <img src={p.cover_image_url} alt="" className="aspect-video w-full object-cover" />
                            ) : (
                                <div className="flex aspect-video items-center justify-center bg-neutral-100">
                                    <Ticket className="size-8 text-neutral-400" />
                                </div>
                            )}
                            <div className="flex flex-col gap-1 p-3">
                                <span className="font-medium">{p.name}</span>
                                <span className="text-xs text-neutral-500">{p.course_count ?? 0} courses</span>
                                {props.showPrice !== false && (
                                    <span className="text-sm font-semibold">{formatPassPrice(p.price)}</span>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};
