import { useTranslation } from 'react-i18next';
import { ArrowRight } from '@phosphor-icons/react';
import type { AuditChange } from '../../-shared/report-types';

/** A changed value as text: "—" for none, JSON for a nested object, the value otherwise. */
export function changeValueText(value: unknown): string {
    if (value === null || value === undefined || value === '') return '—';
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
}

/**
 * The old → new list of one audit row (contract §6.4: the server computes
 * `{key, old, new}` per key of the stored JSON; the screen only prints it).
 */
export function AuditChanges({ changes }: { changes: AuditChange[] }) {
    const { t } = useTranslation('commerce');
    if (changes.length === 0) return <span className="text-caption text-muted-foreground">{t('reports.audit.noChanges')}</span>;
    return (
        <ul className="flex flex-col gap-1" data-testid="audit-changes">
            {changes.map((change) => (
                <li key={change.key} className="flex flex-wrap items-center gap-1 text-caption">
                    <span className="font-medium text-foreground">{change.key}</span>
                    <span className="break-all text-muted-foreground">{changeValueText(change.old)}</span>
                    <ArrowRight size={12} className="shrink-0 text-muted-foreground rtl:rotate-180" aria-label={t('reports.audit.becomes')} />
                    <span className="break-all text-foreground">{changeValueText(change.new)}</span>
                </li>
            ))}
        </ul>
    );
}
