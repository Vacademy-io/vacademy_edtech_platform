import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MyButton } from '@/components/design-system/button';
import { formatMoney } from '@/components/design-system/money-cell';
import { StatusChip, type StatusType } from '@/components/design-system/status-chips';
import { Textarea } from '@/components/ui/textarea';
import { getInstituteId } from '@/constants/helper';
import { formatNumber } from '@/lib/formatters';
import { COMMERCE_ROLE } from '@/lib/commerce/commerce-access';
import { useCommerceAccess } from '@/lib/commerce/use-commerce-access';
import { cn } from '@/lib/utils';
import { PlainSelect } from '@/routes/commerce/-components/CatalogueBits';
import { CommercePage } from '@/routes/commerce/-components/CommercePage';
import { CommerceEmptyState, CommerceLoadingRows } from '@/routes/commerce/-components/CommerceStates';
import { inputClass, OrderNotice } from '@/routes/commerce/orders/-components/order-ui';
import { ItemCostImportCard } from '@/routes/commerce/products/-components/ItemCostImportCard';
import { readOrderError } from '@/routes/commerce/orders/-shared/order-errors';
import { ExportButtons } from '@/routes/commerce/reports/-components/ExportButtons';
import { placeLabel } from '@/routes/commerce/reports/-components/ReportFilters';
import {
    formatIndiaDate,
    formatIndiaDateTime,
    formatIndiaTime,
    formatMonthText,
    indiaToday,
    monthOf,
    monthRange,
} from '@/routes/commerce/reports/-shared/report-format';
import { fetchReportPlaces } from '@/routes/commerce/reports/-shared/reports-api';
import {
    type DayStatus,
    downloadParallelRun,
    fetchParallelRunDays,
    type ParallelRunDay,
    type SaveDayInput,
    saveParallelRunDay,
} from '../-shared/parallel-run-api';

const NS = 'commerceParallelRun';

/** Months the picker offers: this one and the eleven before it. */
export function recentMonths(today: string, count = 12): string[] {
    const year = Number(today.slice(0, 4));
    const month = Number(today.slice(5, 7));
    const out: string[] = [];
    for (let i = 0; i < count; i++) {
        const index = year * 12 + (month - 1) - i;
        out.push(`${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`);
    }
    return out;
}

const STATUS_TONE: Record<DayStatus, StatusType> = {
    CLEAN: 'SUCCESS',
    DIFFERENT: 'DANGER',
    RECHECK: 'WARNING',
    NOT_SAVED: 'WARNING',
    NO_SALES: 'INFO',
};

/** The entry form as typed. */
export interface DayDraft {
    bills: string;
    sales: string;
    tax: string;
    cash: string;
    returns: string;
    note: string;
}

export type DraftProblem = 'bills' | 'sales' | 'tax' | 'cash' | 'returns' | 'note';

const AMOUNT = /^\d{1,12}(\.\d{1,2})?$/;
const SIGNED_AMOUNT = /^-?\d{1,12}(\.\d{1,2})?$/;
const clean = (value: string) => value.trim().replace(/,/g, '');

/**
 * The fields of a draft the server would refuse (whole bill count, amounts with
 * at most two decimals, cash may be negative, returns optional, note ≤ 500).
 * Whether the day is clean is the server's answer, not computed here.
 */
export function draftProblems(draft: DayDraft): DraftProblem[] {
    const out: DraftProblem[] = [];
    if (!/^\d{1,7}$/.test(clean(draft.bills))) out.push('bills');
    if (!AMOUNT.test(clean(draft.sales))) out.push('sales');
    if (!AMOUNT.test(clean(draft.tax))) out.push('tax');
    if (!SIGNED_AMOUNT.test(clean(draft.cash))) out.push('cash');
    if (clean(draft.returns) !== '' && !AMOUNT.test(clean(draft.returns))) out.push('returns');
    if (draft.note.trim().length > 500) out.push('note');
    return out;
}

export function draftToInput(draft: DayDraft, version: number | null): SaveDayInput {
    return {
        oldBillCount: Number(clean(draft.bills)),
        oldSalesValue: clean(draft.sales),
        oldTax: clean(draft.tax),
        oldCash: clean(draft.cash),
        oldReturns: clean(draft.returns) === '' ? null : clean(draft.returns),
        note: draft.note.trim() === '' ? null : draft.note.trim(),
        version,
    };
}

const draftOf = (day: ParallelRunDay): DayDraft =>
    day.old
        ? {
              bills: String(day.old.billCount),
              sales: day.old.salesValue,
              tax: day.old.tax,
              cash: day.old.cash,
              returns: day.old.returns ?? '',
              note: day.note ?? '',
          }
        : { bills: '', sales: '', tax: '', cash: '', returns: '', note: '' };

export const SAVE_ERROR_CODES = [
    'SESSION_OPEN',
    'DAY_CHANGED',
    'NOTE_REQUIRED',
    'VALIDATION',
    'FEATURE_DISABLED',
    'ROLE_NOT_ALLOWED',
    'LOCATION_NOT_ALLOWED',
    'REPORTS_BUSY',
    'REPORT_TIMEOUT',
] as const;
const SAVE_ERRORS = new Set<string>(SAVE_ERROR_CODES);

export const ERROR_FALLBACKS = ['network', 'generic'] as const;

/** The i18n key of a refusal (`commerceParallelRun:errors.<CODE>`), else the generic or network sentence. */
export function errorKey(error: unknown): string {
    const read = readOrderError(error);
    const key = (name: string) => `${NS}:errors.${name}`;
    if (read.code && SAVE_ERRORS.has(read.code)) return key(read.code);
    if (read.status === 403) return key('LOCATION_NOT_ALLOWED');
    if (read.status === 429) return key('REPORTS_BUSY');
    if (read.status === null && !read.message) return key('network');
    return key('generic');
}

/**
 * `/commerce/parallel-run` (WP-53): during a store's parallel run the manager
 * enters the old system's day totals beside the platform's; the server compares
 * them, keeps the verdict with who reviewed it, and counts the clean days in a
 * row (7 pass). Accountants read and export; only a manager saves.
 */
export function ParallelRunPage() {
    const { t } = useTranslation([NS, 'sidebar']);
    const access = useCommerceAccess();
    const open = access.isResolved && access.canOpen('commerce-parallel-run') && !!getInstituteId();
    /*
     * The item-costs card lives on the product import page, which only a store
     * manager opens. An accountant who cannot open that page loads costs here;
     * the card keeps its own gates (stock + switch-over feature, M/Ac role).
     */
    const showItemCosts =
        open &&
        access.commerceRoles.includes(COMMERCE_ROLE.ACCOUNTANT) &&
        !access.canOpen('commerce-products');
    const today = indiaToday();
    const months = useMemo(() => recentMonths(today), [today]);
    const [month, setMonth] = useState(monthOf(today));
    const [location, setLocation] = useState('');
    const range = monthRange(month, today) ?? { from: `${monthOf(today)}-01`, to: today };

    const places = useQuery({
        queryKey: ['commerce', getInstituteId() ?? 'none', 'parallel-run', 'places'],
        queryFn: fetchReportPlaces,
        enabled: open,
        staleTime: 5 * 60 * 1000,
        retry: false,
    });
    const placeList = places.data?.places ?? [];
    useEffect(() => {
        const first = placeList[0];
        if (!location && first) setLocation(first.id);
    }, [location, placeList]);

    const daysKey = ['commerce', getInstituteId() ?? 'none', 'parallel-run', 'days', location, range.from, range.to];
    const days = useQuery({
        queryKey: daysKey,
        queryFn: () => fetchParallelRunDays(location, range.from, range.to),
        enabled: open && !!location,
        staleTime: 30 * 1000,
        retry: false,
    });
    const answer = days.data;

    return (
        <CommercePage
            navId="commerce-parallel-run"
            title={t('sidebar:commerceParallelRun')}
            description={t('commerceParallelRun:description')}
            actions={
                <ExportButtons
                    formats={['xlsx', 'csv']}
                    disabled={!location}
                    onDownload={(format) => downloadParallelRun(location, range.from, range.to, format)}
                />
            }
        >
            <div className="flex flex-col gap-4" data-testid="parallel-run-page">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:max-w-2xl">
                    <PlainSelect
                        label={t('commerceParallelRun:filters.location')}
                        value={location}
                        placeholder={t('commerceParallelRun:filters.pickLocation')}
                        onChange={setLocation}
                        options={placeList.map((p) => ({ value: p.id, label: placeLabel(p) }))}
                    />
                    <PlainSelect
                        label={t('commerceParallelRun:filters.month')}
                        value={month}
                        onChange={(next) => next && setMonth(next)}
                        options={months.map((value) => ({ value, label: formatMonthText(value) ?? value }))}
                    />
                </div>
                {places.isSuccess && placeList.length === 0 && (
                    <CommerceEmptyState title={t('commerceParallelRun:filters.noPlaces')} />
                )}
                {days.isLoading && <CommerceLoadingRows rows={6} />}
                {days.isError && (
                    <OrderNotice tone="danger">
                        <p data-testid="parallel-run-error">{t(errorKey(days.error))}</p>
                    </OrderNotice>
                )}
                {answer && (
                    <>
                        <StreakBanner
                            streak={answer.streak}
                            needed={answer.cleanDaysNeeded}
                            passed={answer.passed}
                            latestSaved={answer.latestSaved}
                        />
                        <p className="text-caption text-muted-foreground">
                            {t('commerceParallelRun:tolerance', { amount: formatMoney(answer.tolerance) })}
                            {answer.asOf ? ` ${t('commerceParallelRun:asOf', { time: formatIndiaTime(answer.asOf) })}` : ''}
                        </p>
                        <DayTable
                            days={answer.days}
                            canEdit={access.isManager}
                            onSave={(date, input) => saveParallelRunDay(location, date, input)}
                        />
                    </>
                )}
                {showItemCosts && <ItemCostImportCard />}
            </div>
        </CommercePage>
    );
}

function StreakBanner({
    streak,
    needed,
    passed,
    latestSaved,
}: {
    streak: number;
    needed: number;
    passed: boolean;
    latestSaved: string | null;
}) {
    const { t } = useTranslation(NS);
    return (
        <OrderNotice tone={passed ? 'success' : 'info'}>
            <div className="flex flex-col gap-1">
                <p className="font-medium" data-testid="parallel-run-streak">
                    {t(passed ? 'commerceParallelRun:streak.passed' : 'commerceParallelRun:streak.progress', { streak, needed })}
                </p>
                <p className="text-caption">
                    {latestSaved
                        ? t('commerceParallelRun:streak.latest', { date: formatIndiaDate(latestSaved) })
                        : t('commerceParallelRun:streak.none')}
                </p>
            </div>
        </OrderNotice>
    );
}

/** Platform figure, the old system's under it, and the difference when it is not zero. */
function FigureCell({
    platform,
    old,
    difference,
    whole,
}: {
    platform: string | number;
    old: string | number | null | undefined;
    difference: string | number | null | undefined;
    whole?: boolean;
}) {
    const show = (value: string | number) => (whole ? formatNumber(Number(value)) : formatMoney(value));
    const differs = difference !== null && difference !== undefined && Math.abs(Number(difference)) >= 0.005;
    return (
        <div className="flex flex-col items-end gap-0.5 tabular-nums">
            <span className="text-foreground">{show(platform)}</span>
            {old !== null && old !== undefined && <span className="text-muted-foreground">{show(old)}</span>}
            {differs && <span className="text-danger-600">{show(difference as string | number)}</span>}
        </div>
    );
}

function DayTable({
    days,
    canEdit,
    onSave,
}: {
    days: ParallelRunDay[];
    canEdit: boolean;
    onSave: (date: string, input: SaveDayInput) => Promise<ParallelRunDay>;
}) {
    const { t } = useTranslation(NS);
    const [editing, setEditing] = useState<string | null>(null);
    if (days.length === 0) return <CommerceEmptyState title={t('commerceParallelRun:empty')} />;
    return (
        <div className="overflow-x-auto rounded-lg border border-neutral-200">
            <table className="w-full min-w-max text-body" data-testid="parallel-run-table">
                <caption className="sr-only">{t('commerceParallelRun:table.caption')}</caption>
                <thead className="bg-neutral-50 text-caption text-muted-foreground">
                    <tr>
                        <th scope="col" className="p-2 text-start font-medium">
                            {t('commerceParallelRun:table.date')}
                        </th>
                        <th scope="col" className="p-2 text-end font-medium">
                            {t('commerceParallelRun:table.bills')}
                        </th>
                        <th scope="col" className="p-2 text-end font-medium">
                            {t('commerceParallelRun:table.sales')}
                        </th>
                        <th scope="col" className="p-2 text-end font-medium">
                            {t('commerceParallelRun:table.tax')}
                        </th>
                        <th scope="col" className="p-2 text-end font-medium">
                            {t('commerceParallelRun:table.cash')}
                        </th>
                        <th scope="col" className="p-2 text-end font-medium">
                            {t('commerceParallelRun:table.returns')}
                        </th>
                        <th scope="col" className="p-2 text-start font-medium">
                            {t('commerceParallelRun:table.status')}
                        </th>
                        <th scope="col" className="p-2 text-end font-medium">
                            <span className="sr-only">{t('commerceParallelRun:table.action')}</span>
                        </th>
                    </tr>
                    <tr>
                        <td colSpan={8} className="px-2 pb-2 text-caption">
                            {t('commerceParallelRun:table.legend')}
                        </td>
                    </tr>
                </thead>
                <tbody>
                    {days.map((day) => (
                        <DayRows
                            key={day.date}
                            day={day}
                            canEdit={canEdit}
                            editing={editing === day.date}
                            onEdit={() => setEditing(day.date)}
                            onClose={() => setEditing(null)}
                            onSave={onSave}
                            onSaved={() => setEditing(null)}
                        />
                    ))}
                </tbody>
            </table>
        </div>
    );
}

function DayRows({
    day,
    canEdit,
    editing,
    onEdit,
    onClose,
    onSave,
    onSaved,
}: {
    day: ParallelRunDay;
    canEdit: boolean;
    editing: boolean;
    onEdit: () => void;
    onClose: () => void;
    onSave: (date: string, input: SaveDayInput) => Promise<ParallelRunDay>;
    onSaved: () => void;
}) {
    const { t } = useTranslation(NS);
    return (
        <>
            <tr className="border-t border-neutral-200 align-top" data-testid={`parallel-run-day-${day.date}`}>
                <td className="p-2">
                    <div className="flex flex-col gap-0.5">
                        <span className="text-foreground">{formatIndiaDate(day.date)}</span>
                        {day.platform.openSessions > 0 && (
                            <span className="text-caption text-warning-600">
                                {t('commerceParallelRun:openSessions', { count: day.platform.openSessions })}
                            </span>
                        )}
                    </div>
                </td>
                <td className="p-2">
                    <FigureCell
                        whole
                        platform={day.platform.bills}
                        old={day.old?.billCount}
                        difference={day.difference?.bills}
                    />
                </td>
                <td className="p-2">
                    <FigureCell
                        platform={day.platform.salesValue}
                        old={day.old?.salesValue}
                        difference={day.difference?.salesValue}
                    />
                </td>
                <td className="p-2">
                    <FigureCell platform={day.platform.tax} old={day.old?.tax} difference={day.difference?.tax} />
                </td>
                <td className="p-2">
                    <FigureCell platform={day.platform.cash} old={day.old?.cash} difference={day.difference?.cash} />
                </td>
                <td className="p-2">
                    <FigureCell
                        platform={day.platform.returns}
                        old={day.old?.returns}
                        difference={day.difference?.returns}
                    />
                </td>
                <td className="p-2">
                    <div className="flex flex-col gap-1">
                        <StatusChip
                            text={t(`commerceParallelRun:status.${day.status}`)}
                            textSize="text-caption"
                            status={STATUS_TONE[day.status]}
                            showIcon={false}
                        />
                        {day.reviewedAt && (
                            <span className="text-caption text-muted-foreground">
                                {t('commerceParallelRun:reviewed', {
                                    name: day.reviewedByName ?? day.reviewedBy ?? '—',
                                    time: formatIndiaDateTime(day.reviewedAt),
                                })}
                            </span>
                        )}
                        {day.status === 'RECHECK' && (
                            <span className="text-caption text-warning-600">{t('commerceParallelRun:recheckHint')}</span>
                        )}
                        {day.note && <span className="text-caption text-muted-foreground">{day.note}</span>}
                    </div>
                </td>
                <td className="p-2 text-end">
                    {canEdit && !editing && (
                        <MyButton
                            type="button"
                            buttonType="secondary"
                            scale="small"
                            onClick={onEdit}
                            data-testid={`parallel-run-edit-${day.date}`}
                        >
                            {t(day.old ? 'commerceParallelRun:actions.edit' : 'commerceParallelRun:actions.enter')}
                        </MyButton>
                    )}
                </td>
            </tr>
            {editing && (
                <tr className="bg-neutral-50">
                    <td colSpan={8} className="p-3">
                        <DayForm day={day} onClose={onClose} onSave={onSave} onSaved={onSaved} />
                    </td>
                </tr>
            )}
        </>
    );
}

const FIELDS: { key: Exclude<DraftProblem, 'note'>; decimal: boolean }[] = [
    { key: 'bills', decimal: false },
    { key: 'sales', decimal: true },
    { key: 'tax', decimal: true },
    { key: 'cash', decimal: true },
    { key: 'returns', decimal: true },
];

function DayForm({
    day,
    onClose,
    onSave,
    onSaved,
}: {
    day: ParallelRunDay;
    onClose: () => void;
    onSave: (date: string, input: SaveDayInput) => Promise<ParallelRunDay>;
    onSaved: () => void;
}) {
    const { t } = useTranslation(NS);
    const queryClient = useQueryClient();
    const [draft, setDraft] = useState<DayDraft>(() => draftOf(day));
    const [touched, setTouched] = useState(false);
    const problems = draftProblems(draft);
    const save = useMutation({
        mutationFn: () => onSave(day.date, draftToInput(draft, day.version)),
        onSuccess: () => {
            void queryClient.invalidateQueries({ queryKey: ['commerce', getInstituteId() ?? 'none', 'parallel-run'] });
            onSaved();
        },
    });
    const errorCode = save.isError ? readOrderError(save.error).code : null;
    const noteNeeded = errorCode === 'NOTE_REQUIRED';

    return (
        <form
            className="flex flex-col gap-3"
            data-testid="parallel-run-form"
            onSubmit={(event) => {
                event.preventDefault();
                setTouched(true);
                if (problems.length === 0 && !save.isPending) save.mutate();
            }}
        >
            <p className="text-body font-medium text-foreground">
                {t('commerceParallelRun:form.title', { date: formatIndiaDate(day.date) })}
            </p>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                {FIELDS.map(({ key, decimal }) => {
                    const invalid = touched && problems.includes(key);
                    return (
                        <label key={key} className="flex flex-col gap-1.5 text-caption text-muted-foreground">
                            {t(`commerceParallelRun:form.${key}`)}
                            <input
                                type="text"
                                inputMode={decimal ? 'decimal' : 'numeric'}
                                className={cn(inputClass, invalid && 'border-danger-600')}
                                aria-invalid={invalid || undefined}
                                value={draft[key]}
                                onChange={(event) => setDraft({ ...draft, [key]: event.target.value })}
                                data-testid={`parallel-run-input-${key}`}
                            />
                            {invalid && (
                                <span className="text-danger-600">
                                    {t(key === 'bills' ? 'commerceParallelRun:form.invalid.bills' : 'commerceParallelRun:form.invalid.money')}
                                </span>
                            )}
                        </label>
                    );
                })}
            </div>
            <p className="text-caption text-muted-foreground">{t('commerceParallelRun:form.returnsHint')}</p>
            <label className="flex flex-col gap-1.5 text-caption text-muted-foreground">
                {t('commerceParallelRun:form.note')}
                <Textarea
                    value={draft.note}
                    maxLength={500}
                    onChange={(event) => setDraft({ ...draft, note: event.target.value })}
                    aria-invalid={noteNeeded || undefined}
                    className={cn(noteNeeded && 'border-danger-600')}
                    data-testid="parallel-run-input-note"
                />
                <span>{t('commerceParallelRun:form.noteHint')}</span>
            </label>
            {save.isError && (
                <OrderNotice tone="danger">
                    <p data-testid="parallel-run-save-error">{t(errorKey(save.error))}</p>
                </OrderNotice>
            )}
            <div className="flex flex-wrap items-center gap-2">
                <MyButton
                    type="submit"
                    buttonType="primary"
                    scale="medium"
                    disable={save.isPending || (touched && problems.length > 0)}
                    data-testid="parallel-run-save"
                >
                    {t('commerceParallelRun:actions.save')}
                </MyButton>
                <MyButton type="button" buttonType="secondary" scale="medium" onClick={onClose}>
                    {t('commerceParallelRun:actions.cancel')}
                </MyButton>
            </div>
        </form>
    );
}
