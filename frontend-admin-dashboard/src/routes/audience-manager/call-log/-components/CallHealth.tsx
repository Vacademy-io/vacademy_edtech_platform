/**
 * Call health — the technical post-mortem for an AI call, in the Call Log row.
 *
 * Why this exists: diagnosing three founder-flagged calls took a forensic sweep
 * of ~140k log lines across 220 calls. The root causes (a wedged TTS socket that
 * left the caller in 10.4s of silence, caller answers deleted before the agent
 * ever saw them, replies killed before a single audio byte, false "sorry, I
 * missed that" re-asks) were all known to the bot at call time and simply never
 * carried anywhere. The voice bot now ships them as `diagnostics` on the
 * end-of-call report; this is the read side. The bar it is built to:
 * "would this have told me the answer in 10 seconds?"
 *
 * Two affordances:
 *   • {@link CallHealthCell} — a green/amber/red dot in the row, headline on hover.
 *   • {@link CallHealthSheet} — the full panel: verdict, what happened with the
 *     numbers behind it, timings, the deleted answers verbatim, raw JSON to copy.
 *
 * Both read `GET /v1/telephony/calls/{id}/detail`, which serves the verdict
 * (`diag_health` / `diag_faults` / `diag_headline_text`) to any dashboard viewer
 * but withholds the full `diagnostics` blob unless the caller's role may see
 * unmasked phone numbers (Settings → Display Settings → Call Log phone numbers)
 * — it carries verbatim caller speech. The sheet renders that middle state
 * explicitly instead of pretending there is no report.
 *
 * HONESTY RULES (non-negotiable, they are the whole point):
 *   • A missing verdict renders NEUTRAL, never green. Absence of data is not health.
 *   • `answersDeleted === null` is NOT MEASURED and is rendered as such, never 0.
 *   • Inferred faults (LIKELY_MACHINE, FALSE_REASK) are labelled as inferences.
 *
 * Internal-facing by design ("TTS socket wedge"), so both affordances are
 * admin-gated by the caller — see CallLogTab.
 */
import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CaretDown, Copy, WarningCircle } from '@phosphor-icons/react';
import { toast } from 'sonner';
import { Trans, useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { cn } from '@/lib/utils';
import { MyButton } from '@/components/design-system/button';
import {
    Sheet,
    SheetContent,
    SheetDescription,
    SheetHeader,
    SheetTitle,
} from '@/components/ui/sheet';
import {
    CALL_FAULT_CODES,
    callActionsKey,
    callDetailKey,
    fetchCallActions,
    fetchCallDetail,
    rowCallFaults,
    rowCallHealth,
    type CallDiagnostics,
    type CallHealth as CallHealthVerdict,
    type CallRow,
} from '../-services/call-log-service';

// ── Vocabulary (mirrors voice_bot_service/app/diagnostics.py) ───────────────

/**
 * The bot's `_HEADLINE_TEXT`. Duplicated here so a row can show its headline on
 * hover from `diag_faults` alone, without an N+1 detail fetch — the derivation
 * rule is identical (first fault in CALL_FAULT_CODES order, which IS the bot's
 * HEADLINE_PRIORITY). The sheet still prefers the bot's own `headlineText`.
 */
function buildHeadlineText(t: TFunction): Record<string, string> {
    return {
        CRASH: t('headline.crash'),
        TTS_WEDGE: t('headline.ttsWedge'),
        REPLY_UNPLAYED: t('headline.replyUnplayed'),
        ANSWER_DELETED: t('headline.answerDeleted'),
        BOT_SILENT: t('headline.botSilent'),
        REPLY_LOOP: t('headline.replyLoop'),
        OPENING_REPLAYED: t('headline.openingReplayed'),
        HANDBACK_LOOP: t('headline.handbackLoop'),
        CALLER_IGNORED: t('headline.callerIgnored'),
        REPEATED_LINE: t('headline.repeatedLine'),
        DEAD_AIR: t('headline.deadAir'),
        FALSE_REASK: t('headline.falseReask'),
        LIKELY_MACHINE: t('headline.likelyMachine'),
        STT_DEAF: t('headline.sttDeaf'),
        SLOW_TTS: t('headline.slowTts'),
        SLOW_LLM: t('headline.slowLlm'),
        TRANSFER_FAILED: t('headline.transferFailed'),
        PROMPT_UNFILLED: t('headline.promptUnfilled'),
    };
}

/** Short label for chips and lists (the headline sentence is the long form). */
function buildFaultLabel(t: TFunction): Record<string, string> {
    return {
        CRASH: t('faultLabel.crash'),
        TTS_WEDGE: t('faultLabel.ttsWedge'),
        REPLY_UNPLAYED: t('faultLabel.replyUnplayed'),
        ANSWER_DELETED: t('faultLabel.answerDeleted'),
        BOT_SILENT: t('faultLabel.botSilent'),
        REPLY_LOOP: t('faultLabel.replyLoop'),
        OPENING_REPLAYED: t('faultLabel.openingReplayed'),
        HANDBACK_LOOP: t('faultLabel.handbackLoop'),
        CALLER_IGNORED: t('faultLabel.callerIgnored'),
        REPEATED_LINE: t('faultLabel.repeatedLine'),
        DEAD_AIR: t('faultLabel.deadAir'),
        FALSE_REASK: t('faultLabel.falseReask'),
        LIKELY_MACHINE: t('faultLabel.likelyMachine'),
        STT_DEAF: t('faultLabel.sttDeaf'),
        SLOW_TTS: t('faultLabel.slowTts'),
        SLOW_LLM: t('faultLabel.slowLlm'),
        TRANSFER_FAILED: t('faultLabel.transferFailed'),
        PROMPT_UNFILLED: t('faultLabel.promptUnfilled'),
    };
}

/**
 * Faults derived from a heuristic rather than a measurement — the bot marks the
 * machine block `src: "inferred"`, and a "false" re-ask is a judgement about
 * timing, not an observed fact. Shown with an explicit tag so nobody quotes them
 * as measurements.
 */
const INFERRED_FAULTS = new Set<string>(['LIKELY_MACHINE', 'FALSE_REASK']);

/** CSS tone only (dot / chip background+text) — never user-facing text, so not translated. */
const HEALTH_TONE: Record<CallHealthVerdict | 'UNKNOWN', { dot: string; chip: string }> = {
    GREEN: { dot: 'bg-success-500', chip: 'bg-success-50 text-success-700' },
    AMBER: { dot: 'bg-warning-500', chip: 'bg-warning-50 text-warning-700' },
    RED: { dot: 'bg-danger-500', chip: 'bg-danger-50 text-danger-600' },
    // Grey, NEVER green: we did not measure this call, which is not the same as
    // the call being fine.
    UNKNOWN: { dot: 'bg-neutral-300', chip: 'bg-neutral-100 text-neutral-600' },
};

/** The human label for a verdict — kept separate from HEALTH_TONE so the CSS-only map above never needs a translator. */
function buildHealthLabel(t: TFunction): Record<CallHealthVerdict | 'UNKNOWN', string> {
    return {
        GREEN: t('health.healthy'),
        AMBER: t('health.degraded'),
        RED: t('health.broken'),
        UNKNOWN: t('health.notReported'),
    };
}

// ── Pure formatting / evidence helpers ─────────────────────────────────────

function secs(v: number | null | undefined): string | null {
    if (v == null || Number.isNaN(v)) return null;
    return `${v < 1 ? v.toFixed(2) : v.toFixed(1)}s`;
}

/** Translated "{{count}} X" via CLDR plural forms, or null when zero/unknown (nothing to say). */
function pluralCount(t: TFunction, key: string, n: number | null | undefined): string | null {
    if (n == null || n <= 0) return null;
    return t(key, { count: n });
}

/** Faults in the bot's headline priority order; unknown (newer-bot) codes last. */
export function orderedFaults(faults: string[]): string[] {
    const known = CALL_FAULT_CODES.filter((c) => faults.includes(c)) as string[];
    const unknown = faults.filter((f) => !(CALL_FAULT_CODES as readonly string[]).includes(f));
    return [...known, ...unknown];
}

/** The bot's headline rule, applied to a row that only carries its fault codes. */
function deriveHeadlineText(faults: string[], headlineText: Record<string, string>): string | null {
    const first = orderedFaults(faults)[0];
    return first ? headlineText[first] ?? first : null;
}

/**
 * The specific numbers behind a fired fault — "TTS_WEDGE: 3 stalls, 1 wedge,
 * worst dead air 10.4s". Without these the chip is just a mood.
 */
function faultEvidence(t: TFunction, code: string, d: CallDiagnostics): string[] {
    const tts = d.tts ?? {};
    const playout = d.playout ?? {};
    const turn = d.turnTaking ?? {};
    const latency = d.latency ?? {};
    const machine = d.machine ?? {};
    const infra = d.infra ?? {};
    const out: (string | null)[] = [];

    switch (code) {
        case 'CRASH':
            out.push(infra.crash ? t('evidence.crashError', { error: infra.crash }) : null);
            break;
        case 'TTS_WEDGE':
            out.push(
                pluralCount(t, 'evidence.stall', tts.stalls),
                pluralCount(t, 'evidence.wedge', tts.wedges),
                pluralCount(t, 'evidence.socketRebuild', tts.wedgeReconnects),
                pluralCount(t, 'evidence.silentGeneration', tts.silentGenerations),
                pluralCount(t, 'evidence.letterlessChunkSkipped', tts.letterlessSkipped),
                tts.stallCapHit ? t('evidence.stallCapHit') : null,
                latency.deadAirMax != null
                    ? t('evidence.worstDeadAir', { secs: secs(latency.deadAirMax) })
                    : null
            );
            break;
        case 'REPLY_UNPLAYED':
            out.push(
                playout.repliesNeverPlayed != null
                    ? t('evidence.repliesNeverPlayed', {
                          count: playout.repliesNeverPlayed,
                          total: playout.repliesGenerated ?? '?',
                      })
                    : null
            );
            break;
        case 'ANSWER_DELETED':
            out.push(
                turn.answersDeleted == null
                    ? t('evidence.notMeasured')
                    : pluralCount(t, 'evidence.answerDiscarded', turn.answersDeleted),
                turn.answersDeletedSamples?.length
                    ? t('evidence.capturedVerbatim', { count: turn.answersDeletedSamples.length })
                    : null
            );
            break;
        case 'HANDBACK_LOOP':
            out.push(
                turn.handbacks ? pluralCount(t, 'evidence.handbackTurn', turn.handbacks) : null,
                turn.repeatsSuppressed
                    ? pluralCount(t, 'evidence.sentenceSuppressed', turn.repeatsSuppressed)
                    : null,
                turn.repeatEscalations
                    ? t('evidence.saidAnyway', { count: turn.repeatEscalations })
                    : null
            );
            break;
        case 'OPENING_REPLAYED':
            out.push(
                turn.openingReplays
                    ? pluralCount(t, 'evidence.openingReplayed', turn.openingReplays)
                    : null
            );
            break;
        case 'REPEATED_LINE':
            out.push(
                turn.repeatedLines
                    ? pluralCount(t, 'evidence.repeatedLine', turn.repeatedLines)
                    : null,
                turn.repeatedLineSamples?.[0]
                    ? t('evidence.repeatedLineSample', { text: turn.repeatedLineSamples[0] })
                    : null
            );
            break;
        case 'REPLY_LOOP':
            out.push(
                turn.maxReplyRestarts != null
                    ? t('evidence.replyRestarted', { count: turn.maxReplyRestarts })
                    : null,
                turn.repeatsSuppressed
                    ? pluralCount(t, 'evidence.repeatedLineSuppressed', turn.repeatsSuppressed)
                    : null
            );
            break;
        case 'BOT_SILENT':
            out.push(t('evidence.botSilent'));
            break;
        case 'DEAD_AIR':
            out.push(
                latency.deadAirMax != null
                    ? t('evidence.worstGap', { secs: secs(latency.deadAirMax) })
                    : null,
                latency.deadAirP95 != null
                    ? t('evidence.p95', { secs: secs(latency.deadAirP95) })
                    : null
            );
            break;
        case 'FALSE_REASK':
            out.push(
                turn.orphanFalseReasks != null
                    ? t('evidence.falseReask', {
                          count: turn.orphanFalseReasks,
                          total: turn.orphanReasks ?? '?',
                      })
                    : null
            );
            break;
        case 'LIKELY_MACHINE':
            out.push(
                machine.score != null ? t('evidence.machineScore', { score: machine.score }) : null,
                machine.markers?.length
                    ? t('evidence.machineMarkers', { markers: machine.markers.join(', ') })
                    : null,
                machine.firstUserSecs != null
                    ? t('evidence.firstCallerAudio', { secs: secs(machine.firstUserSecs) })
                    : null,
                machine.longestUserSecs != null
                    ? t('evidence.longestCallerTurn', { secs: secs(machine.longestUserSecs) })
                    : null,
                pluralCount(t, 'evidence.callerTurn', turn.userTurns),
                turn.bargeIns === 0
                    ? t('evidence.noBargeIns')
                    : pluralCount(t, 'evidence.bargeIn', turn.bargeIns)
            );
            break;
        case 'STT_DEAF':
            out.push(pluralCount(t, 'evidence.sttReconnect', infra.sttReconnects));
            break;
        case 'CALLER_IGNORED':
            out.push(pluralCount(t, 'evidence.swallowedTurn', turn.swallowedTurns));
            break;
        case 'SLOW_TTS':
            out.push(
                tts.ttfbP50 != null ? t('evidence.p50', { secs: secs(tts.ttfbP50) }) : null,
                tts.ttfbP95 != null ? t('evidence.p95', { secs: secs(tts.ttfbP95) }) : null,
                tts.ttfbMax != null ? t('evidence.max', { secs: secs(tts.ttfbMax) }) : null
            );
            break;
        case 'SLOW_LLM':
            out.push(
                latency.llmTtfbP50 != null
                    ? t('evidence.p50', { secs: secs(latency.llmTtfbP50) })
                    : null,
                latency.llmTtfbP95 != null
                    ? t('evidence.p95', { secs: secs(latency.llmTtfbP95) })
                    : null
            );
            break;
        case 'TRANSFER_FAILED':
            out.push(t('evidence.transferFailed'));
            break;
        case 'PROMPT_UNFILLED':
            out.push(
                infra.promptUnfilled?.length
                    ? t('evidence.promptUnresolved', { fields: infra.promptUnfilled.join(', ') })
                    : null
            );
            break;
        default:
            break;
    }
    return out.filter((x): x is string => !!x);
}

// ── Row affordance ─────────────────────────────────────────────────────────

function HealthDot({
    health,
    className,
}: {
    health: CallHealthVerdict | null;
    className?: string;
}) {
    return (
        <span
            aria-hidden
            className={cn(
                'inline-block size-2.5 shrink-0 rounded-full',
                HEALTH_TONE[health ?? 'UNKNOWN'].dot,
                className
            )}
        />
    );
}

/**
 * The Call Log's health column: a dot with the headline on hover, opening the
 * full sheet on click. Only AI calls carry diagnostics — human calls show a dash
 * rather than a permanently grey dot, which would read as a fleet-wide fault.
 *
 * The verdict lives on the per-call detail endpoint, not on the search row, and
 * 25 detail fetches per page to colour 25 dots is not a trade worth making. So
 * the cell reads the detail query's CACHE only (`enabled: false` — it subscribes,
 * it never fetches): a row whose detail was already pulled — by this sheet, or by
 * the status popover, which shares the key — colours itself in, and every other
 * row honestly says "not reported" until asked. If the search row ever starts
 * carrying `diag_health`, that wins and no fetch is involved at all.
 */
export function CallHealthCell({
    instituteId,
    row,
    onOpen,
}: {
    instituteId: string;
    row: CallRow;
    onOpen: () => void;
}) {
    const { t } = useTranslation('audienceManagerCallHealth');
    const cached = useQuery({
        queryKey: callDetailKey(instituteId, row.id),
        queryFn: () => fetchCallDetail(instituteId, row.id),
        enabled: false, // cache subscription only — never fires a request
        staleTime: 60_000,
        retry: false,
    });

    if (row.call_type !== 'AI') {
        return (
            <span className="text-xs text-neutral-400" title={t('cell.onlyAiTitle')}>
                —
            </span>
        );
    }

    const detail = cached.data;
    const health = rowCallHealth(row) ?? detail?.diagnostics?.health ?? rowCallHealth(detail ?? {});
    const faults = orderedFaults(
        firstNonEmpty(
            rowCallFaults(row),
            detail?.diagnostics?.faults ?? [],
            rowCallFaults(detail ?? {})
        )
    );
    const healthLabel = buildHealthLabel(t);
    const verdictLabel = healthLabel[health ?? 'UNKNOWN'];
    const headline = detail?.diag_headline_text ?? deriveHeadlineText(faults, buildHeadlineText(t));

    // Three greys, and they are NOT the same claim: we have a verdict; we asked
    // and there was none; we have not asked yet. Labelling the third "not
    // reported" would be the exact dishonesty this panel exists to end.
    const label = health ? headline ?? verdictLabel : detail ? verdictLabel : t('cell.checkHealth');
    const title = health
        ? headline
            ? t('cell.titleWithHeadline', { label: verdictLabel, headline })
            : t('cell.titleNoFaults', { label: verdictLabel })
        : detail
          ? t('notReportedHint')
          : t('cell.reportNotLoaded');

    return (
        <button
            type="button"
            onClick={onOpen}
            title={title}
            aria-label={t('cell.ariaLabel', { label: health ? verdictLabel : label })}
            className="inline-flex max-w-40 items-center gap-1.5 rounded-full px-1 py-0.5 text-xs font-medium text-neutral-600 hover:bg-neutral-100"
        >
            <HealthDot health={health} />
            {/* min-w-0 so the headline truncates inside the flex row instead of overflowing. */}
            <span className="min-w-0 truncate">{label}</span>
        </button>
    );
}

/** Chip tone for a fault whose level may not have been served. */
function faultChipTone(level: string | undefined): string {
    if (level === 'RED') return HEALTH_TONE.RED.chip;
    if (level === 'AMBER') return HEALTH_TONE.AMBER.chip;
    return HEALTH_TONE.UNKNOWN.chip;
}

/** First list with anything in it — used to pick the best-populated fault source. */
function firstNonEmpty(...lists: (string[] | null | undefined)[]): string[] {
    for (const l of lists) {
        if (l && l.length) return l;
    }
    return [];
}

// ── Sheet ──────────────────────────────────────────────────────────────────

function SectionTitle({ children }: { children: ReactNode }) {
    return (
        <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
            {children}
        </h3>
    );
}

function InferredTag() {
    const { t } = useTranslation('audienceManagerCallHealth');
    return (
        <span
            className="rounded-sm bg-neutral-100 px-1.5 py-0.5 text-caption font-medium text-neutral-600"
            title={t('inferredTag.tooltip')}
        >
            {t('inferredTag.label')}
        </span>
    );
}

/**
 * One number. An absent value is spelled out ("not measured"), never shown as 0
 * or blank — the whole panel is worthless if you can't tell the difference
 * between "we looked and it was fine" and "we never looked".
 */
function Stat({
    label,
    value,
    empty,
}: {
    label: string;
    value: string | null;
    empty?: string;
}) {
    const { t } = useTranslation('audienceManagerCallHealth');
    const emptyText = empty ?? t('stat.notMeasured');
    return (
        <div className="flex flex-col gap-0.5">
            <span className="text-caption uppercase tracking-wide text-neutral-500">{label}</span>
            <span
                className={cn(
                    'text-sm font-medium',
                    value ? 'text-neutral-800' : 'text-neutral-400'
                )}
            >
                {value ?? emptyText}
            </span>
        </div>
    );
}

function FaultBlock({
    code,
    level,
    d,
    withheld = false,
}: {
    code: string;
    level: string | undefined;
    d: CallDiagnostics;
    /** Numbers exist but this role may not see them (masked-numbers setting). */
    withheld?: boolean;
}) {
    const { t } = useTranslation('audienceManagerCallHealth');
    // WITHHELD IS NOT "NOT MEASURED". In summary-only mode `d` is empty, so every
    // evidence line would fall through to its absent-value copy and print
    // "not measured on this call" — while the fault FIRING proves the opposite
    // (a live call reported ANSWER_DELETED with 14 deleted answers and the sheet
    // still said "not measured"). Suppress the lines instead of asserting
    // something false; the sheet already explains the withholding once, globally.
    const evidence = withheld ? [] : faultEvidence(t, code, d);
    const tone = level === 'RED' ? HEALTH_TONE.RED : HEALTH_TONE.AMBER;
    const healthLabel = buildHealthLabel(t);
    // Raw "RED"/"AMBER" is backend jargon, not a display string — show its
    // translated verdict word, falling back to the raw level for any future
    // value this dashboard doesn't know about yet.
    const levelLabel =
        level === 'RED' ? healthLabel.RED : level === 'AMBER' ? healthLabel.AMBER : level;
    return (
        <div className="flex flex-col gap-1 rounded-md border border-neutral-200 bg-neutral-50 p-3">
            <div className="flex flex-wrap items-center gap-2">
                {/* No pill when the per-fault level wasn't served — guessing AMBER
                    would quietly downgrade a RED. */}
                {level && (
                    <span
                        className={cn(
                            'rounded-full px-2 py-0.5 text-caption font-semibold',
                            tone.chip
                        )}
                    >
                        {levelLabel}
                    </span>
                )}
                <span className="text-sm font-semibold text-neutral-900">
                    {buildFaultLabel(t)[code] ?? code}
                </span>
                <span className="text-caption text-neutral-400">{code}</span>
                {INFERRED_FAULTS.has(code) && <InferredTag />}
            </div>
            <p className="text-sm text-neutral-600">
                {buildHeadlineText(t)[code] ?? t('faultBlock.unrecognisedCode')}
            </p>
            {evidence.length > 0 && (
                <p className="text-xs text-neutral-500">{evidence.join(' · ')}</p>
            )}
        </div>
    );
}

/** Verbatim caller answers the aggregator dropped — the highest-signal block here. */
function DeletedAnswers({ d }: { d: CallDiagnostics }) {
    const { t } = useTranslation('audienceManagerCallHealth');
    const turn = d.turnTaking ?? {};
    const deleted = turn.answersDeleted;
    const samples = turn.answersDeletedSamples ?? [];

    return (
        <section className="flex flex-col gap-2">
            <SectionTitle>{t('deletedAnswers.title')}</SectionTitle>
            {deleted == null ? (
                // NOT MEASURED. Rendering this as "0" is how a fleet chart claims
                // "fixed" about something that was never looked at.
                <p className="text-sm text-neutral-400">
                    {t('deletedAnswers.notMeasured')}
                    <span className="ml-1 text-neutral-400">
                        {t('deletedAnswers.notMeasuredHint')}
                    </span>
                </p>
            ) : deleted === 0 ? (
                <p className="text-sm text-neutral-600">{t('deletedAnswers.none')}</p>
            ) : (
                <div className="flex flex-col gap-2">
                    {/* "or the transcript or the report" was wrong: the bot derives
                        these very samples FROM the transcript it posts, so a discarded
                        answer is always in both. What it never reached is the MODEL,
                        which is why nothing in the call could respond to it. */}
                    <p className="text-sm text-neutral-700">
                        <Trans
                            t={t}
                            i18nKey="deletedAnswers.reachedTranscript"
                            count={deleted}
                            components={{ bold: <span className="font-semibold text-danger-600" /> }}
                        />
                    </p>
                    {samples.length > 0 && (
                        <ul className="flex flex-col gap-1">
                            {samples.map((s, i) => (
                                <li
                                    key={`${i}-${s}`}
                                    className="rounded-sm border border-danger-100 bg-danger-50 px-2 py-1 text-sm text-neutral-800"
                                >
                                    &ldquo;{s}&rdquo;
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            )}
            <LostFragments turn={turn} />
        </section>
    );
}

/**
 * Sub-word scraps lost the same way as a discarded answer, shown SEPARATELY and
 * without a fault colour. Until rules v3 these were counted as discarded answers:
 * a live call went AMBER on one lost final whose entire text was "वो।", and the
 * panel told the founder an ANSWER had been lost, which sent them looking for an
 * answer nobody ever gave. Hidden entirely would be the other failure — a
 * measured loss must stay on the page — so it is reported as what it is.
 */
function LostFragments({ turn }: { turn: NonNullable<CallDiagnostics['turnTaking']> }) {
    const { t } = useTranslation('audienceManagerCallHealth');
    const lost = turn.fragmentsLost;
    if (lost == null || lost === 0) return null;
    const samples = turn.fragmentsLostSamples ?? [];
    return (
        <div className="flex flex-col gap-1 border-t border-neutral-100 pt-2">
            <p className="text-xs text-neutral-500">{t('lostFragments.summary', { count: lost })}</p>
            {samples.length > 0 && (
                <p className="text-xs text-neutral-600">
                    {samples.map((s) => `“${s}”`).join(' · ')}
                </p>
            )}
        </div>
    );
}

function RawJsonBlock({ diagnostics }: { diagnostics: CallDiagnostics }) {
    const { t } = useTranslation('audienceManagerCallHealth');
    const json = JSON.stringify(diagnostics, null, 2);
    const copy = async () => {
        try {
            await navigator.clipboard.writeText(json);
            toast.success(t('rawJson.copiedToast'));
        } catch {
            toast.error(t('rawJson.copyErrorToast'));
        }
    };
    return (
        <details className="rounded-md border border-neutral-200">
            <summary className="flex cursor-pointer items-center gap-1.5 px-3 py-2 text-xs font-medium text-neutral-600">
                <CaretDown size={12} weight="bold" />
                {t('rawJson.summary')}
            </summary>
            <div className="flex flex-col gap-2 border-t border-neutral-200 p-3">
                <div>
                    <MyButton buttonType="secondary" scale="small" onAsyncClick={copy}>
                        <span className="flex items-center gap-1.5">
                            <Copy size={14} />
                            {t('rawJson.copyButton')}
                        </span>
                    </MyButton>
                </div>
                <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-sm bg-neutral-50 p-2 text-caption text-neutral-600">
                    {json}
                </pre>
            </div>
        </details>
    );
}

/**
 * "Call health" panel. Loads the per-call detail (same endpoint + query key the
 * status popover uses, so it is often a cache hit) and reads `diagnostics`.
 * Degrades in three steps, each of which says which one it is:
 *   1. full blob — verdict, faults with their numbers, timings, deleted answers, JSON;
 *   2. summary only — verdict + fault list, numbers withheld for this role;
 *   3. nothing — no technical report for this call.
 */
/**
 * The engagement ledger's own vocabulary, said the way someone reading a call log
 * would say it. OPEN means the dispatch job has not reached it yet - which reads as
 * "queued", not as "open", to anyone who has not seen engagement_action.
 */
function buildActionStatus(t: TFunction): Record<string, { label: string; tone: string }> {
    return {
        OPEN: { label: t('actionStatus.queued'), tone: 'text-neutral-500' },
        DISPATCHING: { label: t('actionStatus.sending'), tone: 'text-neutral-500' },
        SENT: { label: t('actionStatus.sent'), tone: 'text-success-600' },
        FAILED: { label: t('actionStatus.failed'), tone: 'text-danger-600' },
        EXPIRED: { label: t('actionStatus.expiredUnsent'), tone: 'text-warning-600' },
    };
}

export function CallHealthSheet({
    instituteId,
    call,
    onClose,
}: {
    instituteId: string;
    call: CallRow | null;
    onClose: () => void;
}) {
    const { t } = useTranslation('audienceManagerCallHealth');
    const detailQuery = useQuery({
        queryKey: callDetailKey(instituteId, call?.id ?? ''),
        queryFn: () => fetchCallDetail(instituteId, call!.id),
        enabled: !!call,
        staleTime: 60_000,
        retry: false,
    });

    // Separate from the detail call on purpose: this endpoint needs only institute
    // access, while /detail is gated on VIEW_CALL_NUMBERS because it carries verbatim
    // caller speech. Folding them together would hide the sends from most viewers.
    const actionsQuery = useQuery({
        queryKey: callActionsKey(instituteId, call?.id ?? ''),
        queryFn: () => fetchCallActions(instituteId, call!.id),
        enabled: !!call,
        staleTime: 30_000,
        retry: false,
    });
    const actions = actionsQuery.data ?? [];

    const detail = detailQuery.data ?? null;
    const d = detail?.diagnostics ?? null;
    // Verdict ladder: full blob → the summary fields every viewer gets → the row.
    const health = d?.health ?? rowCallHealth(detail ?? {}) ?? (call ? rowCallHealth(call) : null);
    const healthLabel = buildHealthLabel(t);
    const verdictLabel = healthLabel[health ?? 'UNKNOWN'];
    const faults = orderedFaults(
        firstNonEmpty(d?.faults, rowCallFaults(detail ?? {}), call ? rowCallFaults(call) : [])
    );
    const rulesVersion = d?.rulesVersion ?? detail?.diag_rules_version ?? null;
    const headlineText =
        d?.headlineText ??
        detail?.diag_headline_text ??
        deriveHeadlineText(faults, buildHeadlineText(t)) ??
        (health === 'GREEN' ? t('sheet.noFaultsDetected') : null);
    /** Verdict known, but the numbers behind it withheld (masked-numbers setting). */
    const summaryOnly = !d && (health != null || faults.length > 0);
    const latency = d?.latency ?? {};
    const tts = d?.tts ?? {};
    const setup = d?.setup ?? {};
    const turn = d?.turnTaking ?? {};
    const playout = d?.playout ?? {};
    const infra = d?.infra ?? {};

    return (
        <Sheet
            open={!!call}
            onOpenChange={(open) => {
                if (!open) onClose();
            }}
        >
            <SheetContent
                side="right"
                className="flex w-full flex-col gap-4 overflow-y-auto sm:max-w-xl"
            >
                <SheetHeader>
                    <SheetTitle className="text-base">{t('sheet.title')}</SheetTitle>
                    <SheetDescription className="text-xs">{t('sheet.description')}</SheetDescription>
                </SheetHeader>

                {/* What the call promised. First question anyone asks after a call
                    that offered to send something, and previously answerable only by
                    reading engagement_action by hand. */}
                {actions.length > 0 && (
                    <section className="flex flex-col gap-2 rounded-lg border border-neutral-200 p-4">
                        <p className="text-sm font-medium">{t('sheet.promisedTitle')}</p>
                        {actions.map((a) => {
                            const st = buildActionStatus(t)[(a.status || '').toUpperCase()] ?? {
                                label: a.status || t('actionStatus.unknown'),
                                tone: 'text-neutral-500',
                            };
                            return (
                                <div key={a.id} className="flex flex-col gap-1 border-t border-neutral-100 pt-2 first:border-0 first:pt-0">
                                    <div className="flex items-center justify-between gap-2">
                                        <span className="text-xs">
                                            {a.action_type === 'BOOK_MEETING'
                                                ? t('sheet.bookMeeting')
                                                : (a.channel === 'EMAIL'
                                                      ? t('sheet.email')
                                                      : t('sheet.whatsapp')) +
                                                  (a.template_name ? ' · ' + a.template_name : '')}
                                        </span>
                                        <span className={'text-xs font-medium ' + st.tone}>
                                            {st.label}
                                        </span>
                                    </div>
                                    {a.error_message && (
                                        <p className="break-words text-xs text-danger-600">
                                            {a.error_message}
                                        </p>
                                    )}
                                </div>
                            );
                        })}
                        <p className="text-xs text-neutral-500">{t('sheet.queuedHint')}</p>
                    </section>
                )}

                {/* Verdict — the 10-second answer. */}
                <section className="flex flex-col gap-2 rounded-lg border border-neutral-200 p-4">
                    <div className="flex items-center gap-2">
                        <HealthDot health={health} className="size-3" />
                        {/* Was rendering the raw backend enum ("GREEN"/"AMBER"/"RED") —
                            unreadable outside English. Shows the translated verdict word
                            instead; the duplicate label span below is gone since it would
                            now just repeat this one. */}
                        <span className="text-lg font-bold tracking-tight text-neutral-900">
                            {detailQuery.isLoading ? t('sheet.checking') : verdictLabel}
                        </span>
                    </div>
                    <p className="text-sm text-neutral-700">
                        {detailQuery.isLoading
                            ? t('sheet.loadingDiagnostics')
                            : headlineText ?? t('notReportedHint')}
                    </p>
                    {faults.length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                            {faults.map((f) => (
                                <span
                                    key={f}
                                    title={buildHeadlineText(t)[f] ?? f}
                                    className={cn(
                                        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium',
                                        // Neutral when per-fault levels weren't served, so an
                                        // unknown level never reads as the milder one.
                                        faultChipTone(d?.faultLevels?.[f])
                                    )}
                                >
                                    {buildFaultLabel(t)[f] ?? f}
                                    {INFERRED_FAULTS.has(f) && (
                                        <span className="text-caption font-normal opacity-70">
                                            {t('inferredTag.label')}
                                        </span>
                                    )}
                                </span>
                            ))}
                        </div>
                    )}
                    {call && (
                        <p className="text-caption text-neutral-400">
                            {t('sheet.callIdLine', {
                                lead: call.lead_name || call.lead_number || t('sheet.leadFallback'),
                                id: call.id,
                            })}
                            {rulesVersion != null &&
                                t('sheet.rulesVersionSuffix', { version: rulesVersion })}
                        </p>
                    )}
                </section>

                {detailQuery.isLoading ? (
                    <div className="h-40 animate-pulse rounded-lg bg-neutral-100" />
                ) : summaryOnly ? (
                    // The verdict is public; the numbers behind it are not. Say which,
                    // so "no detail" is never mistaken for "nothing happened".
                    <section className="flex flex-col gap-2">
                        <SectionTitle>{t('sheet.whatHappenedTitle')}</SectionTitle>
                        {faults.map((f) => (
                            <FaultBlock key={f} code={f} level={undefined} d={{}} withheld />
                        ))}
                        <p className="rounded-md border border-dashed border-neutral-300 p-3 text-xs text-neutral-500">
                            {t('sheet.withheldHint')}
                        </p>
                    </section>
                ) : !d ? (
                    <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-neutral-300 p-6 text-center">
                        <WarningCircle size={24} className="text-neutral-400" />
                        <p className="text-sm font-medium text-neutral-700">
                            {t('sheet.noReportTitle')}
                        </p>
                        <p className="max-w-sm text-xs text-neutral-500">
                            {detailQuery.isError
                                ? t('sheet.noReportErrorHint')
                                : t('sheet.noReportEmptyHint')}
                        </p>
                    </div>
                ) : (
                    <>
                        {/* What happened — fired faults, in priority order, with numbers. */}
                        <section className="flex flex-col gap-2">
                            <SectionTitle>{t('sheet.whatHappenedTitle')}</SectionTitle>
                            {faults.length === 0 ? (
                                <p className="text-sm text-neutral-600">
                                    {t('sheet.noFaultsFired', { version: d.rulesVersion ?? 1 })}
                                </p>
                            ) : (
                                faults.map((f) => (
                                    <FaultBlock key={f} code={f} level={d.faultLevels?.[f]} d={d} />
                                ))
                            )}
                            {d.error && (
                                <p className="text-xs text-danger-600">
                                    {t('sheet.diagBuildFailed', { error: d.error })}
                                </p>
                            )}
                        </section>

                        {/* Deleted answers — verbatim when present. */}
                        <DeletedAnswers d={d} />

                        {/* Timings. */}
                        <section className="flex flex-col gap-2">
                            <SectionTitle>{t('sheet.timingsTitle')}</SectionTitle>
                            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                                <Stat label={t('sheet.llmTtfbP50')} value={secs(latency.llmTtfbP50)} />
                                <Stat label={t('sheet.llmTtfbP95')} value={secs(latency.llmTtfbP95)} />
                                <Stat label={t('sheet.ttsTtfbP50')} value={secs(tts.ttfbP50)} />
                                <Stat label={t('sheet.ttsTtfbP95')} value={secs(tts.ttfbP95)} />
                                <Stat label={t('sheet.sttTtfbP50')} value={secs(latency.sttTtfbP50)} />
                                <Stat label={t('sheet.sttTtfbP95')} value={secs(latency.sttTtfbP95)} />
                                <Stat label={t('sheet.deadAirP95')} value={secs(latency.deadAirP95)} />
                                <Stat label={t('sheet.worstDeadAir')} value={secs(latency.deadAirMax)} />
                                <Stat
                                    label={t('sheet.greetPath')}
                                    value={setup.greetPath ?? null}
                                    empty={t('sheet.notReportedEmpty')}
                                />
                                <Stat
                                    label={t('sheet.greetDelay')}
                                    value={secs(setup.greetDelaySecs)}
                                    empty={t('sheet.notReportedEmpty')}
                                />
                                <Stat
                                    label={t('sheet.setup')}
                                    value={secs(setup.setupSecs)}
                                    empty={t('sheet.notReportedEmpty')}
                                />
                            </div>
                        </section>

                        {/* Speech cache. Its own section rather than a Signals row:
                            "did this call cost us TTS money" is a different
                            question from "did this call go well", and burying the
                            hit rate among the fault counters loses it.

                            Shown only when the backend says the cache actually ran
                            on this call (tts_cache_active). Every agent is OFF by
                            default, and a grid of "not measured" would advertise a
                            feature the institute has not enabled while pushing the
                            rows that matter off the screen. */}
                        {detail?.tts_cache_active ? (
                        <section className="flex flex-col gap-2">
                            <SectionTitle>{t('sheet.speechCacheTitle')}</SectionTitle>
                            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                                {/* The section only renders when the cache RAN, so
                                    a 0 here is a genuine reading — it served
                                    nothing on this call — not "we never looked".
                                    "Saved on this call" can still be blank: edge is
                                    free and smallest has no confirmed invoice rate,
                                    so there a hit buys latency, not rupees. */}
                                <Stat
                                    label={t('sheet.servedFromCache')}
                                    value={fmtCount(tts.cacheHits)}
                                />
                                <Stat label={t('sheet.synthesized')} value={fmtCount(tts.cacheMisses)} />
                                <Stat label={t('sheet.hitRate')} value={pct(tts.cacheHitRate)} />
                                <Stat
                                    label={t('sheet.charactersSaved')}
                                    value={fmtCount(tts.cacheCharsSaved)}
                                />
                                <Stat
                                    label={t('sheet.audioReplayed')}
                                    value={secs(tts.cacheSecsSaved)}
                                />
                                <Stat
                                    label={t('sheet.savedOnThisCall')}
                                    value={inr(call?.ttsCacheSavedInr)}
                                    // Blank on edge (free) and smallest (no
                                    // confirmed invoice rate) — there a hit buys
                                    // latency, not rupees.
                                    empty={t('sheet.notPriced')}
                                />
                            </div>
                        </section>
                        ) : null}

                        {/* Raw counters, for the questions the faults didn't answer. */}
                        <section className="flex flex-col gap-2">
                            <SectionTitle>{t('sheet.signalsTitle')}</SectionTitle>
                            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                                <Stat label={t('sheet.callerTurns')} value={fmtCount(turn.userTurns)} />
                                <Stat label={t('sheet.agentTurns')} value={fmtCount(turn.botTurns)} />
                                <Stat label={t('sheet.bargeIns')} value={fmtCount(turn.bargeIns)} />
                                <Stat label={t('sheet.nudges')} value={fmtCount(turn.nudges)} />
                                <Stat
                                    label={t('sheet.repliesPlayed')}
                                    value={
                                        playout.repliesGenerated == null
                                            ? null
                                            : t('sheet.repliesPlayedValue', {
                                                  played:
                                                      playout.repliesGenerated -
                                                      (playout.repliesNeverPlayed ?? 0),
                                                  total: playout.repliesGenerated,
                                              })
                                    }
                                />
                                <Stat label={t('sheet.ttsStalls')} value={fmtCount(tts.stalls)} />
                                <Stat label={t('sheet.ttsWedges')} value={fmtCount(tts.wedges)} />
                                <Stat
                                    label={t('sheet.sttReconnects')}
                                    value={fmtCount(infra.sttReconnects)}
                                />
                                <Stat
                                    label={t('sheet.endedBy')}
                                    value={endedBy(t, turn)}
                                    empty={t('sheet.notReportedEmpty')}
                                />
                            </div>
                            {d.machine && (
                                <p className="flex flex-wrap items-center gap-1.5 text-xs text-neutral-500">
                                    <span>
                                        {t('sheet.machineScore', { score: d.machine.score ?? '—' })}
                                    </span>
                                    {d.machine.src === 'inferred' && <InferredTag />}
                                    {d.machine.markers?.length ? (
                                        <span>
                                            {t('sheet.machineMarkersSuffix', {
                                                markers: d.machine.markers.join(', '),
                                            })}
                                        </span>
                                    ) : null}
                                </p>
                            )}
                        </section>

                        <RawJsonBlock diagnostics={d} />
                    </>
                )}
            </SheetContent>
        </Sheet>
    );
}

/** Counters are measured or absent — 0 is a real answer, undefined is not. */
function pct(v: number | null | undefined): string | null {
    // null, not 0%: a rate over zero attempts is no reading at all.
    if (v === null || v === undefined) return null;
    return `${Math.round(v * 100)}%`;
}

function inr(v: number | null | undefined): string | null {
    if (v === null || v === undefined) return null;
    return `₹${v.toFixed(2)}`;
}

function fmtCount(n: number | null | undefined): string | null {
    return n == null ? null : String(n);
}

/** How the call terminated, when the bot reported either termination flag. */
function endedBy(t: TFunction, turn: NonNullable<CallDiagnostics['turnTaking']>): string | null {
    if (turn.idleHangup) return t('endedBy.idleHangup');
    if (turn.capFarewell) return t('endedBy.turnCap');
    if (turn.idleHangup == null && turn.capFarewell == null) return null;
    return t('endedBy.normalEnd');
}
