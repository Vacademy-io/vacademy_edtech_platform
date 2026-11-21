import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { CaretDown, CaretRight, Scales } from '@phosphor-icons/react';
import { MoneyCell } from '@/components/design-system/money-cell';
import { StatusChip, type StatusType } from '@/components/design-system/status-chips';
import { Card, CardContent } from '@/components/ui/card';
import { formatDate } from '@/lib/formatters';
import { cn } from '@/lib/utils';
import type { JournalEntryDTO, JournalLineDTO } from '@/routes/erp/-shared/hr-types';

/** Amounts arrive as BigDecimal strings or numbers; anything else counts as zero. */
const toAmount = (value: number | string | null | undefined): number => {
    const numeric = typeof value === 'string' ? Number(value) : (value ?? 0);
    return Number.isFinite(numeric) ? numeric : 0;
};

/**
 * Half a paisa. Journal amounts are 2-decimal, so anything at or above this is a
 * genuine imbalance rather than a float-representation artefact.
 */
const BALANCE_EPSILON = 0.005;

/** "HR_PAYROLL" → "HR Payroll" — readable without losing which module posted it. */
const humanizeModule = (value: string | undefined, t: TFunction): string => {
    if (!value) return t('unknownSource');
    return value
        .split(/[_\s]+/)
        .filter(Boolean)
        .map((word) =>
            word.toUpperCase() === word && word.length <= 3
                ? word
                : word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
        )
        .join(' ');
};

const statusMeta = (
    status: string | undefined,
    t: TFunction
): { label: string; type: StatusType } => {
    switch ((status ?? '').toUpperCase()) {
        case 'POSTED':
            return { label: t('statusPosted'), type: 'SUCCESS' };
        case 'REVERSED':
            return { label: t('statusReversed'), type: 'WARNING' };
        default:
            return { label: status || t('statusUnknown'), type: 'INFO' };
    }
};

const LineRow = ({
    line,
    currency,
    t,
}: {
    line: JournalLineDTO;
    currency: string | undefined;
    t: TFunction;
}) => (
    <div className="flex items-start gap-4 px-3 py-2 odd:bg-muted/40">
        <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-body text-foreground">
                {line.account_name || line.account_code || t('defaultAccount')}
            </span>
            <span className="font-mono text-caption text-muted-foreground">
                {line.account_code || '—'}
            </span>
        </span>
        <MoneyCell
            value={line.debit}
            currency={currency}
            dashOnZero
            className="w-28 shrink-0 text-body sm:w-36"
        />
        <MoneyCell
            value={line.credit}
            currency={currency}
            dashOnZero
            className="w-28 shrink-0 text-body sm:w-36"
        />
    </div>
);

/**
 * One journal entry, collapsed to its summary until you open it.
 *
 * Collapsed by default because the question a month of journals answers is "what
 * posted, and did it balance" — the account-level detail is what you open when the
 * answer is surprising. The totals footer is not decoration: it states Dr = Cr
 * explicitly, and when the two sides differ the entry is flagged DANGER rather
 * than rendered as if it were fine. An unbalanced entry is a real accounting bug,
 * and hiding it behind a tidy layout is how it reaches the accountant instead.
 */
export const JournalEntryCard = ({ entry }: { entry: JournalEntryDTO }) => {
    const { t } = useTranslation('erpJournalEntryCard');
    const [open, setOpen] = useState(false);
    const lines = useMemo(
        () => [...(entry.lines ?? [])].sort((a, b) => (a.line_no ?? 0) - (b.line_no ?? 0)),
        [entry.lines]
    );

    const lineDebit = lines.reduce((sum, line) => sum + toAmount(line.debit), 0);
    const lineCredit = lines.reduce((sum, line) => sum + toAmount(line.credit), 0);

    // Prefer the server's own totals for the header; fall back to the lines when
    // it did not send them, so the summary is never blank on a valid entry.
    const headerDebit = entry.total_debit ?? lineDebit;
    const headerCredit = entry.total_credit ?? lineCredit;
    const isBalanced =
        Math.abs(toAmount(headerDebit) - toAmount(headerCredit)) < BALANCE_EPSILON &&
        (lines.length === 0 || Math.abs(lineDebit - lineCredit) < BALANCE_EPSILON);

    const status = statusMeta(entry.status, t);
    const Caret = open ? CaretDown : CaretRight;

    return (
        <Card>
            <button
                type="button"
                onClick={() => setOpen((previous) => !previous)}
                aria-expanded={open}
                className={cn(
                    'flex w-full flex-col gap-3 p-4 text-start transition-colors',
                    'hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-200'
                )}
            >
                <div className="flex flex-wrap items-center gap-2">
                    <Caret size={16} className="shrink-0 text-muted-foreground" />
                    <span className="text-body font-semibold text-foreground">
                        {entry.entry_date ? formatDate(entry.entry_date) : t('undated')}
                    </span>
                    <span className="font-mono text-caption text-muted-foreground">
                        {entry.reference || '—'}
                    </span>
                    <StatusChip
                        text={humanizeModule(entry.source_module, t)}
                        textSize="text-caption"
                        status="INFO"
                        showIcon={false}
                    />
                    <StatusChip
                        text={status.label}
                        textSize="text-caption"
                        status={status.type}
                        showIcon={false}
                    />
                    {!isBalanced && (
                        <StatusChip
                            text={t('doesNotBalance')}
                            textSize="text-caption"
                            status="DANGER"
                            showIcon
                        />
                    )}
                </div>

                <div className="flex flex-wrap items-end justify-between gap-3">
                    <p className="max-w-2xl text-caption text-muted-foreground">
                        {entry.memo || t('noMemo')}
                    </p>
                    <div className="flex items-center gap-4">
                        <span className="flex flex-col">
                            <span className="text-caption text-muted-foreground">{t('debit')}</span>
                            <MoneyCell
                                value={headerDebit}
                                currency={entry.currency}
                                className="text-body font-semibold text-foreground"
                            />
                        </span>
                        <span className="flex flex-col">
                            <span className="text-caption text-muted-foreground">{t('credit')}</span>
                            <MoneyCell
                                value={headerCredit}
                                currency={entry.currency}
                                className="text-body font-semibold text-foreground"
                            />
                        </span>
                    </div>
                </div>
            </button>

            {open && (
                <CardContent className="flex flex-col gap-2 border-t border-border p-4">
                    {lines.length === 0 ? (
                        <p className="text-caption text-muted-foreground">
                            {t('noLinesStored')}
                        </p>
                    ) : (
                        <div className="overflow-x-auto">
                            <div className="min-w-max">
                                <div className="flex items-center gap-4 border-b border-border px-3 pb-2">
                                    <span className="min-w-0 flex-1 text-caption font-semibold text-muted-foreground">
                                        {t('accountColumn')}
                                    </span>
                                    <span className="w-28 shrink-0 text-end text-caption font-semibold text-muted-foreground sm:w-36">
                                        {t('debit')}
                                    </span>
                                    <span className="w-28 shrink-0 text-end text-caption font-semibold text-muted-foreground sm:w-36">
                                        {t('credit')}
                                    </span>
                                </div>
                                {lines.map((line, index) => (
                                    <LineRow
                                        key={`${line.line_no ?? index}-${line.account_code ?? index}`}
                                        line={line}
                                        currency={entry.currency}
                                        t={t}
                                    />
                                ))}
                                <div
                                    className={cn(
                                        'mt-1 flex items-center gap-4 border-t-2 border-border px-3 pt-2',
                                        !isBalanced && 'bg-danger-50'
                                    )}
                                >
                                    <span className="flex min-w-0 flex-1 items-center gap-2">
                                        <Scales
                                            size={16}
                                            className={cn(
                                                'shrink-0',
                                                isBalanced
                                                    ? 'text-success-600'
                                                    : 'text-danger-600'
                                            )}
                                        />
                                        <span className="text-caption font-semibold text-foreground">
                                            {isBalanced
                                                ? t('totalsBalanced')
                                                : t('totalsUnbalanced')}
                                        </span>
                                    </span>
                                    <MoneyCell
                                        value={lineDebit}
                                        currency={entry.currency}
                                        className="w-28 shrink-0 text-body font-semibold sm:w-36"
                                    />
                                    <MoneyCell
                                        value={lineCredit}
                                        currency={entry.currency}
                                        className="w-28 shrink-0 text-body font-semibold sm:w-36"
                                    />
                                </div>
                            </div>
                        </div>
                    )}
                    {!isBalanced && (
                        <p className="text-caption text-danger-600">
                            {t('unbalancedWarning')}
                        </p>
                    )}
                </CardContent>
            )}
        </Card>
    );
};
