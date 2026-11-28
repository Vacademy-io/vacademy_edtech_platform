import { useState, type ReactNode } from 'react';
import { format } from 'date-fns';
import { Checkbox } from '@/components/ui/checkbox';
import { tint } from '@/components/common/report-visuals/palette';

/** A4 at 96 dpi; the PDF export captures each page at this width. */
export const PAGE_W = 794;
export const PAGE_H = 1123;

const initials = (s: string) =>
    s
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((w) => w[0]?.toUpperCase())
        .join('') || 'R';

/** The coloured strip on top of every printed page: institute, report name and learner. */
export const ReportBand = ({
    brand,
    instituteName,
    logoUrl,
    subtitle,
    learnerName,
    learnerLine,
}: {
    brand: string;
    instituteName: string;
    logoUrl?: string | null;
    subtitle: string;
    learnerName: string;
    learnerLine?: string;
}) => {
    const [logoOk, setLogoOk] = useState(true);
    return (
        <div
            className="flex items-center gap-4 px-10 py-6 text-white"
            style={{ background: `linear-gradient(110deg, ${brand} 0%, ${tint(brand, 0.25)} 100%)` }}
        >
            {logoUrl && logoOk ? (
                <div className="flex h-12 items-center rounded-lg bg-white px-2">
                    <img
                        src={logoUrl}
                        alt=""
                        crossOrigin="anonymous"
                        className="h-9 w-auto max-w-[140px] object-contain"
                        onError={() => setLogoOk(false)}
                    />
                </div>
            ) : (
                <div
                    className="flex size-12 items-center justify-center rounded-lg bg-white text-lg font-bold"
                    style={{ color: brand }}
                >
                    {initials(instituteName)}
                </div>
            )}
            <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-base font-semibold">{instituteName}</span>
                <span className="text-xs opacity-90">{subtitle}</span>
            </div>
            <div className="flex flex-col items-end text-right">
                <span className="text-lg font-bold">{learnerName}</span>
                {learnerLine && <span className="text-xs opacity-90">{learnerLine}</span>}
            </div>
        </div>
    );
};

/** One A4 page; every element marked data-report-page becomes a PDF page. */
export const ReportPage = ({ children, footer }: { children: ReactNode; footer: string }) => (
    <div
        data-report-page
        className="relative mx-auto flex flex-col bg-white shadow-sm ring-1 ring-neutral-200"
        style={{ width: PAGE_W, minHeight: PAGE_H }}
    >
        {children}
        <div className="mt-auto flex justify-between px-10 pb-6 pt-4 text-2xs text-neutral-400">
            <span>{footer}</span>
            <span>Generated {format(new Date(), 'd MMM yyyy')}</span>
        </div>
    </div>
);

export interface ReportSectionMeta {
    label: string;
    description: string;
}

/** The checkbox list of a report dialog: which charts and tables go into the PDF. */
export function ReportSectionPicker<K extends string>({
    order,
    meta,
    selected,
    onChange,
}: {
    order: readonly K[];
    meta: Record<K, ReportSectionMeta>;
    selected: K[];
    onChange: (next: K[]) => void;
}) {
    const toggle = (key: K) =>
        onChange(
            selected.includes(key)
                ? selected.filter((k) => k !== key)
                : order.filter((k) => k === key || selected.includes(k))
        );
    return (
        <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-neutral-700">Sections</p>
                <button
                    type="button"
                    onClick={() => onChange(selected.length === order.length ? [] : [...order])}
                    className="text-xs font-medium text-primary-600 hover:underline"
                >
                    {selected.length === order.length ? 'Clear all' : 'Select all'}
                </button>
            </div>
            {order.map((key) => (
                <label key={key} className="flex cursor-pointer items-start gap-2">
                    <Checkbox
                        checked={selected.includes(key)}
                        onCheckedChange={() => toggle(key)}
                        className="mt-0.5"
                    />
                    <span className="flex flex-col">
                        <span className="text-sm text-neutral-700">{meta[key].label}</span>
                        <span className="text-xs text-neutral-500">{meta[key].description}</span>
                    </span>
                </label>
            ))}
        </div>
    );
}
