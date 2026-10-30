import { useQuery } from '@tanstack/react-query';
import { fetchConversionBySource } from '../-services/sales-dashboard-services';

interface Props {
    instituteId: string;
    teamId?: string | undefined;
    /** When set, scope to this single counsellor's leads (used by the
     *  counsellors detail drawer). Otherwise team / caller RBAC applies. */
    counsellorUserId?: string | undefined;
    from?: number | undefined;
    to?: number | undefined;
}

// audience_response.source_type values, as readable names. Anything not listed
// falls back to a title-cased version of the raw value (see sourceLabel).
const SOURCE_LABELS: Record<string, string> = {
    AUDIENCE_CAMPAIGN: 'Website / campaign form',
    WEBSITE: 'Website / campaign form',
    WALK_IN: 'Walk-in (added by counsellor)',
    SELF_SIGNUP: 'Self sign-up',
    META_LEAD_ADS: 'Meta lead ads',
    FACEBOOK_ADS: 'Facebook ads',
    INSTAGRAM_ADS: 'Instagram ads',
    GOOGLE_ADS: 'Google ads',
    GOOGLE_LEAD_ADS: 'Google ads',
    LINKEDIN_ADS: 'LinkedIn ads',
    INBOUND_CALL: 'Inbound call',
    LIVE_SESSION: 'Live session',
    COURSE_CATALOGUE: 'Course catalogue',
    UNKNOWN: 'Unknown (no lead form)',
};

function sourceLabel(source: string): string {
    const key = source.trim().toUpperCase();
    const known = SOURCE_LABELS[key];
    if (known) return known;
    const words = key.replace(/_/g, ' ').toLowerCase();
    return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * Where the leads are coming from. Each row = one lead source with inbound
 * volume, converted count, and a conversion-rate %. A lead is counted under
 * exactly one source, so the rows add up to the total lead count.
 *
 * Rendered as a list so the row-by-row comparison stays scannable; the bar
 * width is the source's share of all leads.
 */
export function ConversionBySourceWidget({
    instituteId,
    teamId,
    counsellorUserId,
    from,
    to,
}: Props) {
    const { data, isLoading } = useQuery({
        queryKey: [
            'sales-dashboard-source-conversion',
            instituteId,
            teamId,
            counsellorUserId,
            from,
            to,
        ],
        enabled: !!instituteId,
        queryFn: () => fetchConversionBySource(instituteId, teamId, counsellorUserId, from, to),
    });

    const rows = data ?? [];
    const totalLeads = rows.reduce((s, r) => s + r.leads, 0);

    return (
        <section className="rounded-lg border border-neutral-200 bg-white p-4">
            <div className="mb-3">
                <h3 className="text-h4 font-medium text-neutral-900">Conversion by source</h3>
                <p className="text-caption text-neutral-500">
                    Leads by source. Bar = share of leads, figures = converted / total leads
                </p>
            </div>
            {isLoading ? (
                <div className="text-subtitle text-neutral-500">Loading…</div>
            ) : rows.length === 0 ? (
                <div className="text-subtitle text-neutral-500">No leads in this window.</div>
            ) : (
                <ul className="space-y-2">
                    {rows.map((r) => {
                        const widthPct = totalLeads > 0 ? (r.leads / totalLeads) * 100 : 0;
                        return (
                            <li key={r.source} className="space-y-1">
                                <div className="flex items-baseline justify-between gap-2">
                                    <span className="text-body font-medium text-neutral-900">
                                        {sourceLabel(r.source)}
                                    </span>
                                    <span className="text-caption text-neutral-500">
                                        {r.conversions} / {r.leads} ·{' '}
                                        <span className="font-semibold text-neutral-700">
                                            {r.conversion_rate.toFixed(1)}%
                                        </span>
                                    </span>
                                </div>
                                <div className="h-2 overflow-hidden rounded bg-neutral-100">
                                    <div
                                        className="h-full bg-primary-500"
                                        // Dynamic % bar — width is data-driven, not stylistic.
                                        style={{ width: `${Math.max(2, widthPct)}%` }}
                                    />
                                </div>
                            </li>
                        );
                    })}
                </ul>
            )}
        </section>
    );
}
