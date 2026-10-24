import { Check, X } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';

type ScopeFilter = 'dates' | 'team' | 'counsellor' | 'list';

/**
 * Which shared filters each report actually reads (checked against each tab's query).
 * Follow-up aging is a live snapshot and the forecast always uses its own trailing
 * window, so dates do not apply to them; UTM reads dates only.
 */
const NO_DATES = new Set(['followups', 'forecast']);
const NO_PEOPLE = new Set(['utm']);
const NOTE: Record<string, string> = {
    calling: 'calling',
    'lead-calls': 'leadCalls',
    followups: 'followups',
    forecast: 'forecast',
};

/**
 * Reports: "This report uses: ✓ Dates ✓ Team ✗ Lead list" under the filter
 * bar, so nobody reads a number as filtered when that report ignores the filter.
 */
export function ReportScope({ tab, listApplies }: { tab: string; listApplies: boolean }) {
    const { t } = useTranslation('crmPages');
    const uses: Record<ScopeFilter, boolean> = {
        dates: !NO_DATES.has(tab),
        team: !NO_PEOPLE.has(tab),
        counsellor: !NO_PEOPLE.has(tab),
        list: listApplies,
    };
    const note = NOTE[tab];
    return (
        <div className="flex flex-wrap items-center gap-1.5 text-neutral-500">
            <span className="text-caption">{t('reports.scope.label')}</span>
            {(Object.keys(uses) as ScopeFilter[]).map((k) => (
                <span
                    key={k}
                    className={cn(
                        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-medium',
                        uses[k]
                            ? 'border-success-200 bg-success-50 text-success-700'
                            : 'border-neutral-200 bg-neutral-50 text-neutral-400 line-through'
                    )}
                >
                    {uses[k] ? <Check size={11} weight="bold" /> : <X size={11} weight="bold" />}
                    <span className="text-caption">{t(`reports.scope.${k}`)}</span>
                </span>
            ))}
            {note && <span className="text-caption">· {t(`reports.scope.note.${note}`)}</span>}
        </div>
    );
}
