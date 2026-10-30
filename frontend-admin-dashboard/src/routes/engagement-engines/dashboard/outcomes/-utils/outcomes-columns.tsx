import type { TFunction } from 'i18next';
import { Warning } from '@phosphor-icons/react';
import { StatusChip, type StatusType } from '@/components/design-system/status-chips';
import type { ReportItemRow } from '@/services/engagement-daily-report';
import {
    DASH,
    formatDateTimeInZone,
    formatStampInZone,
    humanizeKey,
} from '../../-utils/report-format';
import type { ReportColumn } from '../../-utils/report-tables';
import type { ReportTerms } from '../../-utils/report-terms';
import type { OutcomeTab } from '../../-utils/outcomes-params';
import {
    BUCKET_TONE,
    categoryChanged,
    templateBucket,
    templateCategoryLabel,
    templateStatusLabel,
    type TemplateTone,
} from '../../-utils/template-status';
import { LeadCell } from '../-components/LeadCell';

export type OutcomeColumn = ReportColumn<ReportItemRow> & {
    /** The cell draws its own layout (a chip with a note under it), so it is not cut to one line. */
    rich?: boolean;
};

export interface OutcomeColumnsCtx {
    t: TFunction;
    terms: ReportTerms;
    /** The institute's time zone; times are shown and exported in it. */
    timeZone: string | null;
    /** The Engine column only helps when the page covers every engine. */
    showEngine: boolean;
    /** The Excel file: always has the Engine column, and an email and phone on every list. */
    forExport?: boolean;
    openLead: (row: ReportItemRow) => void;
}

const BATCH = 'BATCH';
const USERS = 'USERS';

/**
 * A list's name as the report shows it: batch and individual groups come from the server with
 * English names, so they are renamed with the institute's own words, and a list deleted after
 * people joined it has no name any more.
 */
export const listDisplayName = (
    list: { listId?: string | null; kind?: string | null; name?: string | null },
    t: TFunction,
    terms: ReportTerms
): string =>
    list.kind === BATCH || list.listId === BATCH
        ? t('lists.batchMembers', { batch: terms.batch })
        : list.kind === USERS || list.listId === USERS
          ? t('lists.individuals')
          : list.name?.trim() || t('lists.deleted', { list: terms.list.toLowerCase() });

const orDash = (value: string | null | undefined): string => value?.trim() || DASH;

const CHIP_OF_TONE: Record<TemplateTone, StatusType> = {
    success: 'SUCCESS',
    danger: 'DANGER',
    warning: 'WARNING',
    neutral: 'INFO',
};

/** A lead is named by their name, else the nearest thing that identifies them. */
export const leadLabel = (row: ReportItemRow, t: TFunction): string =>
    row.leadName?.trim() ||
    row.email?.trim() ||
    row.phone?.trim() ||
    t('outcomesPage.value.unknownLead');

/** Who made a status change: the engine, the team (and which person) or an automation. */
const changedBy = (row: ReportItemRow, t: TFunction): string => {
    const actor = row.actor
        ? t(`outcomesPage.value.actor.${row.actor}`, { defaultValue: humanizeKey(row.actor) })
        : DASH;
    const person = row.changedByName?.trim();
    return person && actor !== DASH ? `${actor} (${person})` : person || actor;
};

const demoOutcome = (row: ReportItemRow, t: TFunction): string =>
    t(`outcomesPage.value.demoOutcome.${row.outcome || 'NOT_MARKED'}`, {
        defaultValue: humanizeKey(row.outcome || 'NOT_MARKED'),
    });

const bookingStatus = (row: ReportItemRow, t: TFunction): string =>
    row.bookingStatus
        ? t(`outcomesPage.value.bookingStatus.${row.bookingStatus}`, {
              defaultValue: humanizeKey(row.bookingStatus),
          })
        : DASH;

/** The columns of one tab's table. The same description feeds the screen and the Excel file. */
export function buildOutcomeColumns(tab: OutcomeTab, ctx: OutcomeColumnsCtx): OutcomeColumn[] {
    const { t, terms, timeZone } = ctx;
    const c = (key: string) => t(`outcomesPage.col.${key}`, { list: terms.list });

    const text = (
        id: string,
        header: string,
        get: (row: ReportItemRow) => string,
        size: number,
        extra: Partial<OutcomeColumn> = {}
    ): OutcomeColumn => ({ id, header, size, text: get, ...extra });

    const time = (
        id: string,
        header: string,
        get: (row: ReportItemRow) => string | null | undefined,
        size = 160
    ): OutcomeColumn =>
        text(id, header, (r) => formatDateTimeInZone(get(r), timeZone), size, {
            value: (r) => formatStampInZone(get(r), timeZone),
        });

    const lead = text('lead', c('lead'), (r) => leadLabel(r, t), 220, {
        wrap: true,
        render: (r) => (
            <LeadCell
                row={r}
                label={leadLabel(r, t)}
                openLabel={t('outcomesPage.openProfile', { name: leadLabel(r, t) })}
                onOpen={ctx.openLead}
            />
        ),
    });
    const email = text('email', c('email'), (r) => orDash(r.email), 240);
    const phone = text('phone', c('phone'), (r) => orDash(r.phone), 140);
    const engine = text('engine', c('engine'), (r) => orDash(r.engineName), 180, { wrap: true });
    const maybeEngine = ctx.showEngine || ctx.forExport ? [engine] : [];

    const fromTo = [
        text('from', c('from'), (r) => r.fromStatus?.trim() || t('statusChanges.noStatus'), 160, {
            wrap: true,
        }),
        text('to', c('to'), (r) => r.toStatus?.trim() || t('statusChanges.noStatus'), 160, {
            wrap: true,
        }),
    ];
    const by = text('changedBy', c('changedBy'), (r) => changedBy(r, t), 200, { wrap: true });
    const when = time('when', c('when'), (r) => r.changedAt);

    // New templates: no lead on these rows, so none of the lead columns above are used.
    const templateColumns = (): OutcomeColumn[] => {
        const name = text('templateName', c('templateName'), (r) => orDash(r.templateName), 240, {
            wrap: true,
            render: (r) => (
                <>
                    <span className="font-semibold text-neutral-900">{orDash(r.templateName)}</span>
                    {r.language?.trim() && (
                        <span className="ms-1.5 text-neutral-500">{r.language.trim()}</span>
                    )}
                </>
            ),
        });
        const proposed = text(
            'proposedCategory',
            c('proposedCategory'),
            (r) => templateCategoryLabel(r.proposedCategory, t),
            150
        );
        // A different category than proposed is the one thing to notice: Meta charges more for
        // marketing than for utility. Colour alone does not say so, so it is also in the words.
        const changed = (r: ReportItemRow) => categoryChanged(r.proposedCategory, r.metaCategory);
        const meta = text(
            'metaCategory',
            c('metaCategory'),
            (r) => {
                const label = templateCategoryLabel(r.metaCategory, t);
                return changed(r) ? `${label} (${t('outcomesPage.value.categoryChanged')})` : label;
            },
            170,
            {
                value: (r) => {
                    const label = templateCategoryLabel(r.metaCategory, t);
                    return changed(r)
                        ? `${label} (${t('outcomesPage.value.categoryChanged')})`
                        : label;
                },
                rich: true,
                render: (r) => {
                    const label = templateCategoryLabel(r.metaCategory, t);
                    return changed(r) ? (
                        <span className="inline-flex items-center gap-1 rounded-full border border-warning-200 bg-warning-50 px-2 py-0.5 font-semibold text-warning-700">
                            <Warning size={12} weight="fill" aria-hidden="true" />
                            {label}
                            <span className="sr-only">
                                {t('outcomesPage.value.categoryChanged')}
                            </span>
                        </span>
                    ) : (
                        label
                    );
                },
            }
        );
        // The chip says where it stands; a turned-down template says why, right under it.
        const status = text(
            'status',
            c('status'),
            (r) => {
                const label = templateStatusLabel(r.templateStatus, t);
                const reason = r.rejectionReason?.trim();
                return reason ? `${label}: ${reason}` : label;
            },
            200,
            {
                value: (r) => templateStatusLabel(r.templateStatus, t),
                rich: true,
                render: (r) => {
                    const bucket = templateBucket(r.templateStatus);
                    const reason = r.rejectionReason?.trim();
                    return (
                        <span className="flex flex-col items-start gap-1">
                            <StatusChip
                                status={bucket ? CHIP_OF_TONE[BUCKET_TONE[bucket]] : 'INFO'}
                                showIcon={false}
                                textSize="text-caption"
                                text={templateStatusLabel(r.templateStatus, t)}
                            />
                            {reason && (
                                <span className="line-clamp-2 break-words text-caption text-neutral-600">
                                    {reason}
                                </span>
                            )}
                        </span>
                    );
                },
            }
        );
        return [
            name,
            ...maybeEngine,
            proposed,
            meta,
            status,
            time('createdAt', c('createdAt'), (r) => r.createdAt),
            time('submittedAt', c('submittedAt'), (r) => r.submittedAt),
            // Detail that helps in a spreadsheet and would crowd the screen.
            ...(ctx.forExport
                ? [
                      text('language', c('language'), (r) => orDash(r.language), 100),
                      text(
                          'statusDetail',
                          c('statusDetail'),
                          (r) => (r.templateStatus?.trim() ? humanizeKey(r.templateStatus) : DASH),
                          160
                      ),
                      text(
                          'rejectionReason',
                          c('rejectionReason'),
                          (r) => orDash(r.rejectionReason),
                          260
                      ),
                  ]
                : []),
        ];
    };

    switch (tab) {
        case 'templates':
            return templateColumns();
        case 'leads':
            return [
                lead,
                email,
                phone,
                text(
                    'list',
                    c('list'),
                    (r) => listDisplayName({ listId: r.listId, name: r.listName }, t, terms),
                    200,
                    { wrap: true }
                ),
                text(
                    'type',
                    c('type'),
                    (r) =>
                        r.isNew === null || r.isNew === undefined
                            ? DASH
                            : r.isNew
                              ? t('outcomesPage.value.new')
                              : t('outcomesPage.value.existing'),
                    150
                ),
                time('added', c('added'), (r) => r.joinedAt),
                ...maybeEngine,
            ];
        case 'demos':
            return [
                lead,
                email,
                phone,
                time('scheduledFor', c('scheduledFor'), (r) => r.scheduledStart),
                time('bookedAt', c('bookedAt'), (r) => r.bookedAt),
                text('host', c('host'), (r) => orDash(r.hostName), 160, { wrap: true }),
                text('bookingStatus', c('bookingStatus'), (r) => bookingStatus(r, t), 130),
                text('demoOutcome', c('demoOutcome'), (r) => demoOutcome(r, t), 130),
                ...maybeEngine,
            ];
        case 'status':
            return [
                lead,
                ...(ctx.forExport ? [email, phone] : []),
                ...fromTo,
                by,
                text('source', c('source'), (r) => orDash(r.source && humanizeKey(r.source)), 130),
                when,
                ...maybeEngine,
            ];
        default:
            return [lead, email, phone, ...fromTo, by, when, ...maybeEngine];
    }
}
