import type { ReactNode } from 'react';
import { Cell, Pie, PieChart } from 'recharts';
import { ChartContainer, type ChartConfig } from '@/components/ui/chart';
import { cn } from '@/lib/utils';

export type DonutTone = 'success' | 'warning' | 'danger' | 'neutral';

const SLICE_FILL: Record<DonutTone, string> = {
    success: 'fill-success-400',
    warning: 'fill-warning-400',
    danger: 'fill-danger-400',
    neutral: 'fill-neutral-200',
};

const LEGEND_DOT: Record<DonutTone, string> = {
    success: 'bg-success-400',
    warning: 'bg-warning-400',
    danger: 'bg-danger-400',
    neutral: 'bg-neutral-200',
};

export interface DonutSlice {
    key: string;
    label: string;
    value: number;
    tone: DonutTone;
    /** Shown after the count, e.g. the marks this group earned. */
    detail?: ReactNode;
}

/**
 * A titled donut with its legend, for the test report.
 *
 * recharts is imported directly: the chart used to be React.lazy behind a <Suspense>,
 * and ChartContainer's ResponsiveContainer hands its size to its direct child, so the
 * lazy chart never got a width or height and drew nothing. ChartContainer imports
 * recharts statically anyway, so the lazy import saved nothing.
 */
export function BreakdownDonut({
    title,
    slices,
    centerValue,
    centerLabel,
}: {
    title: string;
    slices: DonutSlice[];
    centerValue: ReactNode;
    centerLabel: string;
}) {
    const drawn = slices.filter((slice) => slice.value > 0);
    // Nothing to split (no questions): a plain grey ring instead of an empty box.
    const data = drawn.length
        ? drawn
        : [{ key: 'empty', label: '', value: 1, tone: 'neutral' as DonutTone }];
    const config: ChartConfig = Object.fromEntries(
        slices.map((slice) => [slice.key, { label: slice.label }])
    );

    return (
        <section className="flex flex-col gap-4 rounded-lg border border-neutral-200 bg-white p-5">
            <h3 className="text-subtitle font-semibold text-neutral-800">{title}</h3>
            <div className="flex flex-col items-center gap-6 sm:flex-row">
                <div className="relative size-40 shrink-0">
                    <ChartContainer config={config} className="aspect-square size-40">
                        <PieChart>
                            <Pie
                                data={data}
                                dataKey="value"
                                nameKey="key"
                                innerRadius={54}
                                outerRadius={78}
                                paddingAngle={data.length > 1 ? 2 : 0}
                                stroke="none"
                                isAnimationActive={false}
                            >
                                {data.map((slice) => (
                                    <Cell key={slice.key} className={SLICE_FILL[slice.tone]} />
                                ))}
                            </Pie>
                        </PieChart>
                    </ChartContainer>
                    <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                        <span className="text-h3 font-bold leading-none text-neutral-800">
                            {centerValue}
                        </span>
                        <span className="mt-1 text-caption text-neutral-500">{centerLabel}</span>
                    </div>
                </div>
                <ul className="flex w-full flex-col gap-3">
                    {slices.map((slice) => (
                        <li
                            key={slice.key}
                            className="flex items-center justify-between gap-3 text-body"
                        >
                            <span className="flex items-center gap-2 text-neutral-600">
                                <span
                                    className={cn(
                                        'size-2.5 shrink-0 rounded-full',
                                        LEGEND_DOT[slice.tone]
                                    )}
                                />
                                {slice.label}
                            </span>
                            <span className="flex items-baseline gap-1.5 whitespace-nowrap font-semibold text-neutral-800">
                                {slice.value}
                                {slice.detail != null && (
                                    <span className="text-caption font-normal text-neutral-500">
                                        {slice.detail}
                                    </span>
                                )}
                            </span>
                        </li>
                    ))}
                </ul>
            </div>
        </section>
    );
}
