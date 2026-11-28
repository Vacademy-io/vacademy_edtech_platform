import { useTranslation } from 'react-i18next';
import { Info, WarningCircle } from '@phosphor-icons/react';
import type { CheckIssue } from '../../-types/learner-home-types';
import { cn } from '@/lib/utils';
import { issueFieldKey, issueTextKey } from '../../-utils/issue-text';

/** The sentence for one check issue: our own text for known codes, else the server's. */
export function useIssueText() {
    const { t, i18n } = useTranslation('learnerHome');
    return (issue: CheckIssue): string => {
        const picked = issueTextKey(issue, (key) => i18n.exists(key, { ns: 'learnerHome' }));
        if (picked) return t(picked.key, picked.params);
        return issue.message || t('issues.fallback');
    };
}

/** "Field: sentence", or just the sentence when the path names no known field. */
export function useIssueLine() {
    const { t } = useTranslation('learnerHome');
    const text = useIssueText();
    return (issue: CheckIssue): string => {
        const field = issueFieldKey(issue.path);
        return field ? `${t(field)}: ${text(issue)}` : text(issue);
    };
}

/** Issues shown under a field; errors first. Renders nothing when there are none. */
export function FieldIssues({ issues, className }: { issues: CheckIssue[]; className?: string }) {
    const text = useIssueText();
    if (issues.length === 0) return null;
    const sorted = [...issues].sort(
        (a, b) => Number(a.severity === 'warning') - Number(b.severity === 'warning')
    );
    return (
        <ul className={cn('space-y-1', className)}>
            {sorted.map((issue, i) => {
                const warn = issue.severity === 'warning';
                const Icon = warn ? Info : WarningCircle;
                return (
                    <li
                        key={`${issue.path}-${issue.code}-${i}`}
                        className={cn(
                            'flex items-start gap-1.5 text-caption',
                            warn ? 'text-warning-700' : 'text-danger-600'
                        )}
                    >
                        <Icon className="mt-0.5 size-3.5 shrink-0" weight="bold" aria-hidden />
                        <span>{text(issue)}</span>
                    </li>
                );
            })}
        </ul>
    );
}
