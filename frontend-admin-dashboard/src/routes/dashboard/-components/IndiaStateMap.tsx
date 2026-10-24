import { useMemo, useState } from 'react';
import { ArrowsOut } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { MyDialog } from '@/components/design-system/dialog';
import indiaStatesRaw from '../-data/india-states.geojson.json';

// A self-contained India choropleth (no map library): the bundled states
// GeoJSON is projected to SVG paths here and shaded by sub-org count. Kept
// dependency-free on purpose — react-simple-maps/d3 don't resolve against this
// repo's dep tree, and a simple equirectangular projection (aspect-corrected at
// India's centre latitude) is more than accurate enough for a dashboard viz.

type Ring = number[][];
interface GeoFeature {
    properties: { st_nm: string };
    geometry:
        | { type: 'Polygon'; coordinates: Ring[] }
        | { type: 'MultiPolygon'; coordinates: Ring[][] };
}
const FEATURES = (indiaStatesRaw as { features: GeoFeature[] }).features;

// Match a free-form state string to a map state. Lowercase + strip punctuation,
// with aliases for the common name variants Indian address forms produce.
const STATE_ALIASES: Record<string, string> = {
    orissa: 'odisha',
    uttaranchal: 'uttarakhand',
    pondicherry: 'puducherry',
    nctofdelhi: 'delhi',
    delhinct: 'delhi',
    'nationalcapitalterritoryofdelhi': 'delhi',
};
export const normalizeState = (s: string | null | undefined): string => {
    const k = (s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
    return STATE_ALIASES[k] ?? k;
};

const W = 360;
const H = 400;
const PAD = 6;
const CENTER_LAT = 22.5;

interface StatePath {
    name: string;
    key: string;
    d: string;
    count: number;
    /** Label anchor (projected bounding-box centre of the state). */
    cx: number;
    cy: number;
}

interface IndiaStateMapProps {
    /** normalized state key (see normalizeState) -> sub-org count */
    counts: Map<string, number>;
    subOrgPlural: string;
}

const polysOf = (f: GeoFeature): Ring[][] =>
    f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;

export default function IndiaStateMap({ counts, subOrgPlural }: IndiaStateMapProps) {
    const { t } = useTranslation('dashboardIndiaStateMap');
    const [hover, setHover] = useState<{ name: string; count: number } | null>(null);

    const { paths, maxCount } = useMemo(() => {
        const k = Math.cos((CENTER_LAT * Math.PI) / 180);
        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;
        for (const f of FEATURES) {
            for (const poly of polysOf(f)) {
                for (const ring of poly) {
                    for (const [lng, lat] of ring) {
                        const x = (lng ?? 0) * k;
                        const y = -(lat ?? 0);
                        if (x < minX) minX = x;
                        if (x > maxX) maxX = x;
                        if (y < minY) minY = y;
                        if (y > maxY) maxY = y;
                    }
                }
            }
        }
        const s = Math.min((W - 2 * PAD) / (maxX - minX), (H - 2 * PAD) / (maxY - minY));
        const ox = PAD + (W - 2 * PAD - s * (maxX - minX)) / 2;
        const oy = PAD + (H - 2 * PAD - s * (maxY - minY)) / 2;
        const project = (lng: number, lat: number): [number, number] => [
            ox + s * (lng * k - minX),
            oy + s * (-lat - minY),
        ];

        let max = 0;
        const built: StatePath[] = FEATURES.map((f) => {
            const key = normalizeState(f.properties.st_nm);
            const count = counts.get(key) ?? 0;
            if (count > max) max = count;
            let d = '';
            let sMinX = Infinity;
            let sMinY = Infinity;
            let sMaxX = -Infinity;
            let sMaxY = -Infinity;
            for (const poly of polysOf(f)) {
                for (const ring of poly) {
                    ring.forEach(([lng, lat], i) => {
                        const [x, y] = project(lng ?? 0, lat ?? 0);
                        d += `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`;
                        if (x < sMinX) sMinX = x;
                        if (x > sMaxX) sMaxX = x;
                        if (y < sMinY) sMinY = y;
                        if (y > sMaxY) sMaxY = y;
                    });
                    d += 'Z';
                }
            }
            return {
                name: f.properties.st_nm,
                key,
                d,
                count,
                cx: (sMinX + sMaxX) / 2,
                cy: (sMinY + sMaxY) / 2,
            };
        });
        return { paths: built, maxCount: max };
    }, [counts]);

    // Readout defaults to the highest state so the panel is never empty.
    const top = useMemo(
        () => paths.reduce((a, b) => (b.count > a.count ? b : a), { name: '', count: -1 } as StatePath),
        [paths]
    );
    const shown = hover ?? (top.count > 0 ? { name: top.name, count: top.count } : null);
    const [expanded, setExpanded] = useState(false);

    const readout = (
        <div className="mb-1 flex items-center justify-between gap-2 text-xs">
            <span className="font-medium text-neutral-500">{t('legend.title')}</span>
            {shown ? (
                <span className="truncate text-neutral-700">
                    <span className="font-semibold text-primary-600">{shown.count}</span>{' '}
                    {subOrgPlural} · {shown.name}
                </span>
            ) : (
                <span className="text-neutral-400">{t('legend.hoverPrompt')}</span>
            )}
        </div>
    );

    // Labels scale with the map; bigger font in the enlarged dialog.
    const renderSvg = (className: string, labelSize: number) => (
        <svg
            viewBox={`0 0 ${W} ${H}`}
            className={className}
            role="img"
            aria-label={t('map.ariaLabel', { subOrgPlural })}
        >
            {paths.map((p) => {
                const ratio = maxCount > 0 ? p.count / maxCount : 0;
                const opacity = p.count > 0 ? 0.25 + 0.75 * ratio : 0.05;
                const active = hover?.name === p.name;
                return (
                    <path
                        key={p.key || p.name}
                        d={p.d}
                        fill="hsl(var(--primary-500))"
                        fillOpacity={opacity}
                        stroke={active ? 'hsl(var(--primary-600))' : 'hsl(var(--card))'}
                        strokeWidth={active ? 1.2 : 0.5}
                        className="cursor-pointer transition-[stroke-width] duration-150"
                        onMouseEnter={() => setHover({ name: p.name, count: p.count })}
                        onMouseLeave={() => setHover(null)}
                    >
                        <title>{t('map.tooltip', { name: p.name, count: p.count })}</title>
                    </path>
                );
            })}
            {/* VLE count labels — only on states that have any, so the map stays clean */}
            {paths
                .filter((p) => p.count > 0)
                .map((p) => (
                    <text
                        key={`lbl-${p.key || p.name}`}
                        x={p.cx}
                        y={p.cy}
                        textAnchor="middle"
                        dominantBaseline="central"
                        fontSize={labelSize}
                        fontWeight={700}
                        paintOrder="stroke"
                        stroke="hsl(var(--card))"
                        strokeWidth={2.5}
                        fill="hsl(var(--primary-700))"
                        className="pointer-events-none select-none"
                    >
                        {p.count}
                    </text>
                ))}
        </svg>
    );

    return (
        <>
            <div className="relative flex h-full flex-col">
                <button
                    type="button"
                    onClick={() => setExpanded(true)}
                    aria-label={t('actions.enlargeMap')}
                    title={t('actions.enlargeMap')}
                    className="absolute bottom-0 right-0 z-10 flex size-6 cursor-pointer items-center justify-center rounded-md border border-neutral-200 bg-white text-neutral-500 shadow-sm transition-colors hover:border-primary-300 hover:text-primary-600"
                >
                    <ArrowsOut size={13} weight="bold" />
                </button>
                {readout}
                {renderSvg('min-h-0 w-full flex-1', 11)}
            </div>

            <MyDialog
                heading={t('dialog.heading', { subOrgPlural })}
                open={expanded}
                onOpenChange={setExpanded}
                dialogWidth="max-w-2xl"
            >
                <div className="flex flex-col gap-2">
                    {readout}
                    <div className="mx-auto aspect-square w-full">
                        {renderSvg('h-full w-full', 13)}
                    </div>
                </div>
            </MyDialog>
        </>
    );
}
