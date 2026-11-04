package vacademy.io.admin_core_service.features.engagement.report;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import vacademy.io.admin_core_service.features.engagement.report.EngagementDailyReport.TemplateRow;
import vacademy.io.admin_core_service.features.engagement.report.EngagementDailyReportDao.AgentDay;
import vacademy.io.admin_core_service.features.engagement.report.EngagementDailyReportService.Window;
import vacademy.io.admin_core_service.features.engagement.report.EngagementDiagnosis.BreakdownRow;
import vacademy.io.admin_core_service.features.engagement.report.EngagementDiagnosis.CallHourRow;
import vacademy.io.admin_core_service.features.engagement.report.EngagementDiagnosis.CallInsights;
import vacademy.io.admin_core_service.features.engagement.report.EngagementDiagnosis.CallLengths;
import vacademy.io.admin_core_service.features.engagement.report.EngagementDiagnosis.DataGap;
import vacademy.io.admin_core_service.features.engagement.report.EngagementDiagnosis.EmailSubjectRow;
import vacademy.io.admin_core_service.features.engagement.report.EngagementDiagnosis.LeadSourceRow;
import vacademy.io.admin_core_service.features.engagement.report.EngagementDiagnosis.Link;
import vacademy.io.admin_core_service.features.engagement.report.EngagementDiagnosis.ObjectionCount;
import vacademy.io.admin_core_service.features.engagement.report.EngagementDiagnosis.OutcomeCount;
import vacademy.io.admin_core_service.features.engagement.report.EngagementDiagnosis.Problem;
import vacademy.io.admin_core_service.features.engagement.report.EngagementDiagnosis.PromptChangeRow;
import vacademy.io.admin_core_service.features.engagement.report.EngagementDiagnosis.StageStatus;
import vacademy.io.admin_core_service.features.engagement.report.EngagementDiagnosis.WhatsAppFailureRow;
import vacademy.io.admin_core_service.features.engagement.report.EngagementDiagnosis.WhatsAppTemplateRow;
import vacademy.io.admin_core_service.features.engagement.service.EngagementSendSchedule;
import vacademy.io.admin_core_service.features.engagement.report.EngagementDiagnosisDao.ActionRow;
import vacademy.io.admin_core_service.features.engagement.report.EngagementDiagnosisDao.AgentRow;
import vacademy.io.admin_core_service.features.engagement.report.EngagementDiagnosisDao.BookingRow;
import vacademy.io.admin_core_service.features.engagement.report.EngagementDiagnosisDao.CallRow;
import vacademy.io.admin_core_service.features.engagement.report.EngagementDiagnosisDao.LeadRow;
import vacademy.io.admin_core_service.features.engagement.report.EngagementDiagnosisDao.PromptVersionRow;
import vacademy.io.admin_core_service.features.engagement.report.EngagementReportSignalsClient.Signal;

import java.time.DateTimeException;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.TreeSet;
import java.util.function.Predicate;

/**
 * Every threshold of the engagement diagnosis and the logic from facts to problems, with no database
 * access (docs/engagement/ENGAGEMENT_DIAGNOSIS.md is the catalogue). A fact that could not be read is
 * null: its rules stay silent and its stage reads UNAVAILABLE. The health banners of the daily report
 * read the shared numbers from here, so the two surfaces cannot disagree.
 *
 * <p>SENT_OUTSIDE_SCHEDULE is left out on purpose. A send outside the engine's window is normal: the
 * decision moves a person's send time after unanswered messages (EngagementAdaptiveSendTime), answers to
 * someone who wrote in and first touches are exempt, and none of that is recorded on the action. The
 * schedule also has no history, so a past send could only be judged against today's settings.
 */
final class EngagementDiagnosisRules {

    private EngagementDiagnosisRules() {
    }

    static final String DAILY = "DAILY", WEEKLY = "WEEKLY";
    static final int DAILY_CAP = 5, WEEKLY_CAP = 10;

    static final String LEADS = "LEADS", CALLING = "CALLING", WHATSAPP = "WHATSAPP", EMAIL = "EMAIL", ENGINE = "ENGINE";
    static final List<String> STAGES = List.of(LEADS, CALLING, WHATSAPP, EMAIL, ENGINE);

    static final String CRITICAL = "critical", WARNING = "warning";
    static final String PROBLEM = "PROBLEM", UNAVAILABLE = "UNAVAILABLE", NO_ACTIVITY = "NO_ACTIVITY",
            NOT_ENOUGH_DATA = "NOT_ENOUGH_DATA", OK = "OK";
    static final String BEST = "BEST", WORST = "WORST";

    // ── thresholds ───────────────────────────────────────────────────────────

    /** A row is weak when its rate is below this share of the rate it is compared with. */
    static final double WEAK_SHARE = 0.5;

    static final int LEADS_MIN_ADDED = 10;
    static final double LEADS_NEITHER_RATE = 0.10;
    static final double LEADS_NO_PHONE_RATE = 0.30;
    static final int MIN_LEADS_PER_SOURCE = 30;

    static final int NOT_DIALLED_MIN = 5;
    static final double NOT_DIALLED_RATE = 0.20;
    static final int CONNECT_MIN_PLACED = 20;
    static final int CONNECT_MIN_BASELINE = 50;
    static final int CONNECT_BASELINE_DAYS = 7;
    static final int SHORT_CALLS_MIN_CONNECTED = 20;
    static final double SHORT_CALLS_SHARE = 0.40;
    static final int SHORT_CALL_SECONDS = 20, LONG_CALL_SECONDS = 60;
    static final int MIN_CALLS_PER_HOUR = 20;
    static final int OBJECTION_MIN_ANALYSED = 10;
    static final double OBJECTION_SHARE = 0.20;
    static final int MAX_OBJECTIONS = 10;

    /** Shared with the WHATSAPP_FAILED_HIGH health banner. */
    static final int WHATSAPP_MIN_TRIED = 20;
    static final double WHATSAPP_FAILED_RATE = 0.10;
    static final double WHATSAPP_FAILED_CRITICAL = 0.30;
    static final int MIN_SENDS_PER_ROW = 100;

    /** Shared with the EMAIL_BOUNCE_HIGH and EMAIL_COMPLAINTS health banners. */
    static final int EMAIL_MIN_SENT = 20;
    static final double EMAIL_BOUNCE_RATE = 0.05;
    static final double EMAIL_BOUNCE_CRITICAL = 0.10;
    static final double EMAIL_COMPLAINT_CRITICAL = 0.001;

    static final int ACTIONS_MIN_DECISIONS = 10;
    static final double ACTIONS_FAILED_RATE = 0.20;
    static final double ACTIONS_FAILED_CRITICAL = 0.50;
    static final int DOUBLE_CONTACT_MIN_PEOPLE = 3;
    static final double DOUBLE_CONTACT_RATE = 0.05;
    static final int SENT_AFTER_REPLY_HOURS = 72;
    static final int SENT_AFTER_REPLY_CRITICAL = 5;
    /** Shared with the CREDITS_LOW health banner. */
    static final double CREDITS_RUNWAY_DAYS = 7;
    static final double CREDITS_RUNWAY_CRITICAL = 2;
    static final int MEMBERS_STUCK_MIN = 5;
    static final int MEMBERS_STUCK_HOURS = 48;

    static final int PROMPT_CHANGE_CHARS = 300;

    /** lead_agent.window_json's defaults, as DEFAULT_WINDOW in ai_service's lead_agent/pacing.py. */
    private static final Set<Integer> DEFAULT_WINDOW_DAYS = Set.of(1, 2, 3, 4, 5, 6);
    private static final String DEFAULT_WINDOW_START = "09:30", DEFAULT_WINDOW_END = "19:00";

    /** Leads no Lead Agent delivered. */
    static final String OTHER_SOURCE = "OTHER";
    /** The daily report's names for WhatsApp messages and emails with no template or subject. */
    static final String NO_TEMPLATE = "(no template)", NO_SUBJECT = "(no subject)";

    private static final Set<String> NOT_DIALLED = Set.of("FAILED", "EXPIRED", "CANCELLED");
    private static final Set<String> CALL_IN_PROGRESS =
            Set.of("QUEUED", "INITIATED", "IN_PROGRESS", "COUNSELLOR_RINGING", "COUNSELLOR_ANSWERED");
    private static final ObjectMapper JSON = new ObjectMapper();

    // ── facts ────────────────────────────────────────────────────────────────

    record ContactCounts(long added, long noPhone, long noEmail, long neither) {
    }

    record AgentFact(String name, String status, long discovered, long rejected, long review, long delivered) {
    }

    record LeadFacts(ContactCounts contacts, List<AgentFact> agents, List<LeadSourceRow> sources) {
    }

    /**
     * The report's call counts. Its "placed" is every queue row, so {@link #placed} takes out the ones
     * the queue gave up on, and {@link #finished} those still waiting or ringing too: a call in progress
     * is not a missed connection.
     */
    record CallCounts(long queued, long notDialled, long inProgress, long connected) {
        long placed() {
            return Math.max(0, queued - notDialled);
        }

        long finished() {
            return Math.max(0, queued - notDialled - inProgress);
        }
    }

    record CallDetails(CallLengths lengths, List<CallHourRow> hours, CallInsights insights) {
    }

    /** baseline: the 7 days before the period; null when not needed (too few calls) or not readable. */
    record CallFacts(CallCounts counts, CallCounts baseline, CallDetails details) {
    }

    record WhatsAppCounts(long tried, long failed, List<BreakdownRow> reasons) {
    }

    /** channelRate: replies over sent. */
    record WhatsAppFacts(WhatsAppCounts counts, List<WhatsAppTemplateRow> templates, Double channelRate) {
    }

    record EmailCounts(long sent, long bounced, long complained, double bounceRate, boolean tracked) {
    }

    /** channelRate: replies over the sends that could report one. */
    record EmailFacts(EmailCounts counts, List<EmailSubjectRow> subjects, Double channelRate) {
    }

    record RunCounts(long decisions, long failed, List<BreakdownRow> topErrors) {
    }

    record DoubleContact(long people, long contacted) {
    }

    /** runwayDays: null when unknown (also when nothing was spent lately), as the banner reads it. */
    record EngineFacts(RunCounts runs, DoubleContact doubleContact, Long sentAfterReply, Double runwayDays,
                       Long stuckMembers) {
    }

    record Facts(LeadFacts leads, CallFacts calls, WhatsAppFacts whatsapp, EmailFacts email, EngineFacts engine) {
    }

    record Outcome(List<Problem> problems, int moreProblems, List<StageStatus> stages) {
    }

    // ── evaluation ───────────────────────────────────────────────────────────

    /** Ranks every problem that fired, cuts to the view's cap, and says how each stage stands. */
    static Outcome evaluate(String view, Facts f, Set<String> unavailableStages) {
        boolean weekly = WEEKLY.equals(view);
        List<Problem> all = new ArrayList<>();
        leadProblems(f.leads(), weekly, all);
        callProblems(f.calls(), weekly, all);
        whatsappProblems(f.whatsapp(), weekly, all);
        emailProblems(f.email(), weekly, all);
        engineProblems(f.engine(), weekly, all);
        all.sort(RANK);
        int cap = weekly ? WEEKLY_CAP : DAILY_CAP;
        List<Problem> shown = all.size() > cap ? List.copyOf(all.subList(0, cap)) : List.copyOf(all);
        return new Outcome(shown, all.size() - shown.size(), stages(weekly, f, all, unavailableStages));
    }

    /** Severity (critical first), then affected, then stage order; the rest only keeps it deterministic. */
    private static final Comparator<Problem> RANK = Comparator
            .comparingInt((Problem p) -> CRITICAL.equals(p.severity()) ? 0 : 1)
            .thenComparing(Comparator.comparingLong(Problem::affected).reversed())
            .thenComparingInt(p -> STAGES.indexOf(p.stage()))
            .thenComparing(Problem::code)
            .thenComparing(p -> String.join(",", p.names()))
            .thenComparing(p -> String.valueOf(p.numbers().get("hour")));

    private static Problem problem(String code, String stage, String severity, long affected,
                                   Map<String, Object> numbers, List<BreakdownRow> breakdown, List<String> names,
                                   Link link) {
        return new Problem(code, stage, severity, affected, numbers, breakdown, names, link);
    }

    private static Problem problem(String code, String stage, String severity, long affected,
                                   Map<String, Object> numbers, Link link) {
        return problem(code, stage, severity, affected, numbers, List.of(), List.of(), link);
    }

    private static Link outcomes(String channel, String outcome) {
        return new Link("OUTCOMES", channel, outcome, null);
    }

    /** Alternating key, value. */
    private static Map<String, Object> numbers(Object... keysAndValues) {
        Map<String, Object> out = new LinkedHashMap<>();
        for (int i = 0; i < keysAndValues.length; i += 2) out.put((String) keysAndValues[i], keysAndValues[i + 1]);
        return out;
    }

    // ── LEADS ────────────────────────────────────────────────────────────────

    private static void leadProblems(LeadFacts f, boolean weekly, List<Problem> out) {
        if (f == null) return;
        ContactCounts c = f.contacts();
        if (c != null && c.added() >= LEADS_MIN_ADDED) {
            boolean neither = atLeast(rate(c.neither(), c.added()), LEADS_NEITHER_RATE);
            boolean noPhone = atLeast(rate(c.noPhone(), c.added()), LEADS_NO_PHONE_RATE);
            if (neither || noPhone) {
                out.add(problem("LEADS_MISSING_CONTACT", LEADS, neither ? CRITICAL : WARNING,
                        neither ? c.neither() : c.noPhone(),
                        numbers("added", c.added(), "noPhone", c.noPhone(), "noEmail", c.noEmail(),
                                "neither", c.neither()),
                        new Link("ITEMS", null, null, "LEADS_ADDED")));
            }
        }
        if (f.agents() != null) {
            List<AgentFact> quiet = f.agents().stream()
                    .filter(a -> "ACTIVE".equals(a.status()) && a.delivered() == 0)
                    .sorted(Comparator.comparing(AgentFact::name, Comparator.nullsLast(Comparator.naturalOrder())))
                    .toList();
            if (!quiet.isEmpty()) {
                out.add(problem("LEAD_AGENT_NOT_DELIVERING", LEADS, WARNING, quiet.size(),
                        numbers("discovered", quiet.stream().mapToLong(AgentFact::discovered).sum(),
                                "rejected", quiet.stream().mapToLong(AgentFact::rejected).sum(),
                                "review", quiet.stream().mapToLong(AgentFact::review).sum()),
                        List.of(), quiet.stream().map(AgentFact::name).toList(), null));
            }
        }
        if (weekly && f.sources() != null) {
            Double overall = overallResponseRate(f.sources());
            for (LeadSourceRow s : f.sources()) {
                if (s.enough() && weakAgainst(s.responseRate(), overall)) {
                    out.add(problem("LEAD_SOURCE_WEAK", LEADS, WARNING, s.leads(),
                            numbers("leads", s.leads(), "responseRate", s.responseRate(), "overallRate", overall),
                            List.of(), List.of(s.source()), null));
                }
            }
        }
    }

    /** Responded over leads across the sources; null when any source's replies are unknown. */
    private static Double overallResponseRate(List<LeadSourceRow> sources) {
        long leads = 0, responded = 0;
        for (LeadSourceRow s : sources) {
            if (s.responded() == null) return null;
            leads += s.leads();
            responded += s.responded();
        }
        return rate(responded, leads);
    }

    // ── CALLING ──────────────────────────────────────────────────────────────

    private static void callProblems(CallFacts f, boolean weekly, List<Problem> out) {
        if (f == null) return;
        CallCounts c = f.counts();
        if (c != null) {
            long placed = c.placed();
            if (c.notDialled() >= NOT_DIALLED_MIN
                    && atLeast(rate(c.notDialled(), placed + c.notDialled()), NOT_DIALLED_RATE)) {
                out.add(problem("CALLS_NOT_GOING_OUT", CALLING, placed == 0 ? CRITICAL : WARNING, c.notDialled(),
                        numbers("placed", placed, "notDialled", c.notDialled()), null));
            }
            CallCounts base = f.baseline();
            long finished = c.finished();
            if (finished >= CONNECT_MIN_PLACED && base != null && base.finished() >= CONNECT_MIN_BASELINE) {
                Double connectRate = rate(c.connected(), finished);
                Double baselineRate = rate(base.connected(), base.finished());
                if (weakAgainst(connectRate, baselineRate)) {
                    out.add(problem("CONNECT_RATE_LOW", CALLING, WARNING, finished - c.connected(),
                            numbers("placed", finished, "connected", c.connected(), "rate", connectRate,
                                    "baselineRate", baselineRate),
                            outcomes("AI_CALL", "no_answer")));
                }
            }
        }
        CallDetails d = f.details();
        if (d == null) return;
        CallLengths len = d.lengths();
        if (len.connected() >= SHORT_CALLS_MIN_CONNECTED) {
            Double share = rate(len.under20s(), len.connected());
            if (atLeast(share, SHORT_CALLS_SHARE)) {
                out.add(problem("SHORT_CALLS", CALLING, WARNING, len.under20s(),
                        numbers("connected", len.connected(), "under20s", len.under20s(), "share", share),
                        outcomes("AI_CALL", "connected")));
            }
        }
        if (!weekly) return;
        Double overall = rate(d.hours().stream().mapToLong(CallHourRow::connected).sum(),
                d.hours().stream().mapToLong(CallHourRow::placed).sum());
        CallHourRow best = d.hours().stream()
                .filter(h -> h.enough() && h.connectRate() != null)
                .max(Comparator.comparingDouble(CallHourRow::connectRate)
                        .thenComparing(Comparator.comparingInt(CallHourRow::hour).reversed()))
                .orElse(null);
        for (CallHourRow h : d.hours()) {
            if (h.enough() && weakAgainst(h.connectRate(), overall)) {
                out.add(problem("CALL_HOUR_WEAK", CALLING, WARNING, h.placed(),
                        numbers("hour", h.hour(), "placed", h.placed(), "connectRate", h.connectRate(),
                                "overallRate", overall, "bestHour", best == null ? null : best.hour(),
                                "bestRate", best == null ? null : best.connectRate()),
                        null));
            }
        }
        CallInsights in = d.insights();
        if (in.analysed() >= OBJECTION_MIN_ANALYSED && !in.topObjections().isEmpty()) {
            ObjectionCount top = in.topObjections().get(0);
            if (atLeast(rate(top.count(), in.analysed()), OBJECTION_SHARE)) {
                out.add(problem("OBJECTION_RECURRING", CALLING, WARNING, top.count(),
                        numbers("analysed", in.analysed(), "count", top.count()),
                        List.of(), List.of(top.text()), null));
            }
        }
    }

    // ── WHATSAPP ─────────────────────────────────────────────────────────────

    private static void whatsappProblems(WhatsAppFacts f, boolean weekly, List<Problem> out) {
        if (f == null) return;
        WhatsAppCounts c = f.counts();
        if (c != null && c.tried() >= WHATSAPP_MIN_TRIED) {
            Double failRate = whatsappFailRate(c.failed(), c.tried());
            if (atLeast(failRate, WHATSAPP_FAILED_RATE)) {
                out.add(problem("WHATSAPP_FAILED_HIGH", WHATSAPP,
                        atLeast(failRate, WHATSAPP_FAILED_CRITICAL) ? CRITICAL : WARNING, c.failed(),
                        numbers("failed", c.failed(), "tried", c.tried(), "rate", failRate),
                        c.reasons(), List.of(), outcomes("WHATSAPP", "failed")));
            }
        }
        if (!weekly || f.templates() == null) return;
        for (WhatsAppTemplateRow t : f.templates()) {
            if (judged(t.verdict()) && comparable(t.name()) && weakAgainst(t.replyRate(), f.channelRate())) {
                out.add(problem("TEMPLATE_UNDERPERFORMING", WHATSAPP, WARNING, t.sent(),
                        numbers("sent", t.sent(), "replyRate", t.replyRate(), "channelRate", f.channelRate()),
                        List.of(), List.of(t.name()), outcomes("WHATSAPP", null)));
            }
        }
    }

    /** failed also counts sends rejected at dispatch, so the base is every send tried, as in the banner. */
    static Double whatsappFailRate(long failed, long tried) {
        Double r = rate(failed, tried);
        return r == null ? null : Double.valueOf(Math.min(1.0, r));
    }

    // ── EMAIL ────────────────────────────────────────────────────────────────

    private static void emailProblems(EmailFacts f, boolean weekly, List<Problem> out) {
        if (f == null) return;
        EmailCounts c = f.counts();
        if (c != null) {
            if (c.tracked() && c.sent() >= EMAIL_MIN_SENT && c.bounceRate() >= EMAIL_BOUNCE_RATE) {
                out.add(problem("EMAIL_BOUNCE_HIGH", EMAIL,
                        c.bounceRate() >= EMAIL_BOUNCE_CRITICAL ? CRITICAL : WARNING, c.bounced(),
                        numbers("bounced", c.bounced(), "sent", c.sent(), "rate", c.bounceRate()),
                        outcomes("EMAIL", "bounced")));
            }
            if (c.complained() > 0) {
                out.add(problem("EMAIL_COMPLAINTS", EMAIL,
                        atLeast(rate(c.complained(), c.sent()), EMAIL_COMPLAINT_CRITICAL) ? CRITICAL : WARNING,
                        c.complained(), numbers("complained", c.complained(), "sent", c.sent()),
                        outcomes("EMAIL", "complained")));
            }
        }
        if (!weekly || f.subjects() == null) return;
        for (EmailSubjectRow s : f.subjects()) {
            if (judged(s.verdict()) && comparable(s.name()) && weakAgainst(s.replyRate(), f.channelRate())) {
                out.add(problem("SUBJECT_UNDERPERFORMING", EMAIL, WARNING, s.sent(),
                        numbers("sent", s.sent(), "replyRate", s.replyRate(), "channelRate", f.channelRate()),
                        List.of(), List.of(s.name()), outcomes("EMAIL", null)));
            }
        }
    }

    // ── ENGINE ───────────────────────────────────────────────────────────────

    private static void engineProblems(EngineFacts f, boolean weekly, List<Problem> out) {
        if (f == null) return;
        RunCounts r = f.runs();
        if (r != null && r.decisions() >= ACTIONS_MIN_DECISIONS) {
            Double failRate = rate(r.failed(), r.decisions());
            if (atLeast(failRate, ACTIONS_FAILED_RATE)) {
                out.add(problem("ENGINE_ACTIONS_FAILING", ENGINE,
                        atLeast(failRate, ACTIONS_FAILED_CRITICAL) ? CRITICAL : WARNING, r.failed(),
                        numbers("failed", r.failed(), "decisions", r.decisions(), "rate", failRate),
                        r.topErrors(), List.of(), null));
            }
        }
        DoubleContact dc = f.doubleContact();
        if (dc != null && dc.people() > 0 && (dc.people() >= DOUBLE_CONTACT_MIN_PEOPLE
                || atLeast(rate(dc.people(), dc.contacted()), DOUBLE_CONTACT_RATE))) {
            out.add(problem("DOUBLE_CONTACT", ENGINE, WARNING, dc.people(),
                    numbers("people", dc.people(), "contacted", dc.contacted()), null));
        }
        Long afterReply = f.sentAfterReply();
        if (afterReply != null && afterReply > 0) {
            out.add(problem("SENT_AFTER_REPLY", ENGINE, afterReply >= SENT_AFTER_REPLY_CRITICAL ? CRITICAL : WARNING,
                    afterReply, numbers("sends", afterReply), null));
        }
        Double runway = f.runwayDays();
        if (runway != null && runway < CREDITS_RUNWAY_DAYS) {
            out.add(problem("CREDITS_LOW", ENGINE, runway < CREDITS_RUNWAY_CRITICAL ? CRITICAL : WARNING, 0,
                    numbers("runwayDays", runway), null));
        }
        if (weekly && f.stuckMembers() != null && f.stuckMembers() >= MEMBERS_STUCK_MIN) {
            out.add(problem("MEMBERS_STUCK", ENGINE, WARNING, f.stuckMembers(),
                    numbers("members", f.stuckMembers()), null));
        }
    }

    // ── stages ───────────────────────────────────────────────────────────────

    /**
     * A fired problem wins over missing data: what fired is known to be wrong, and errors still names
     * what could not be read. Otherwise missing data wins, so a failed read is never OK or a quiet stage.
     */
    private static List<StageStatus> stages(boolean weekly, Facts f, List<Problem> all, Set<String> unavailable) {
        Set<String> fired = new HashSet<>();
        all.forEach(p -> fired.add(p.stage()));
        List<StageStatus> out = new ArrayList<>();
        for (String stage : STAGES) {
            String status;
            if (fired.contains(stage)) {
                status = PROBLEM;
            } else if (unavailable.contains(stage)) {
                status = UNAVAILABLE;
            } else if (!hasActivity(stage, f)) {
                status = NO_ACTIVITY;
            } else {
                status = hasEnough(stage, f, weekly) ? OK : NOT_ENOUGH_DATA;
            }
            out.add(new StageStatus(stage, status));
        }
        return out;
    }

    private static boolean hasActivity(String stage, Facts f) {
        return switch (stage) {
            case LEADS -> f.leads() != null && ((f.leads().contacts() != null && f.leads().contacts().added() > 0)
                    || (f.leads().agents() != null
                    && f.leads().agents().stream().anyMatch(a -> "ACTIVE".equals(a.status()))));
            case CALLING -> f.calls() != null && f.calls().counts() != null && f.calls().counts().queued() > 0;
            case WHATSAPP -> f.whatsapp() != null && f.whatsapp().counts() != null
                    && f.whatsapp().counts().tried() > 0;
            case EMAIL -> f.email() != null && f.email().counts() != null && f.email().counts().sent() > 0;
            case ENGINE -> f.engine() != null && ((f.engine().runs() != null && f.engine().runs().decisions() > 0)
                    || (f.engine().doubleContact() != null && f.engine().doubleContact().contacted() > 0));
            default -> false;
        };
    }

    /** Whether the activity reaches a volume at least one of the stage's rules can judge. */
    private static boolean hasEnough(String stage, Facts f, boolean weekly) {
        return switch (stage) {
            case LEADS -> f.leads().contacts() != null && f.leads().contacts().added() >= LEADS_MIN_ADDED;
            case CALLING -> callingHasEnough(f.calls(), weekly);
            case WHATSAPP -> f.whatsapp().counts().tried() >= WHATSAPP_MIN_TRIED;
            case EMAIL -> {
                EmailCounts c = f.email().counts();
                yield (c.tracked() && c.sent() >= EMAIL_MIN_SENT) || (weekly && f.email().subjects() != null
                        && f.email().subjects().stream().anyMatch(s -> judged(s.verdict())));
            }
            case ENGINE -> f.engine().runs() != null && f.engine().runs().decisions() >= ACTIONS_MIN_DECISIONS;
            default -> false;
        };
    }

    private static boolean callingHasEnough(CallFacts f, boolean weekly) {
        CallCounts c = f.counts();
        if (c.notDialled() >= NOT_DIALLED_MIN) return true;
        if (c.finished() >= CONNECT_MIN_PLACED && f.baseline() != null
                && f.baseline().finished() >= CONNECT_MIN_BASELINE) {
            return true;
        }
        CallDetails d = f.details();
        if (d == null) return false;
        return d.lengths().connected() >= SHORT_CALLS_MIN_CONNECTED
                || (weekly && (d.insights().analysed() >= OBJECTION_MIN_ANALYSED
                || d.hours().stream().anyMatch(CallHourRow::enough)));
    }

    /** Which stages a failed section leaves unjudged. On WEEKLY the lead sources read messages and replies too. */
    static Set<String> unavailableStages(String view, Collection<String> failedSections) {
        boolean weekly = WEEKLY.equals(view);
        Set<String> out = new LinkedHashSet<>();
        for (String section : failedSections) {
            switch (section) {
                case "report" -> out.addAll(STAGES);
                case "lists", "leadDetails", "leadAgents", "demos" -> out.add(LEADS);
                case "calls", "callDetails", "callBaseline" -> {
                    out.add(CALLING);
                    if (weekly && "callDetails".equals(section)) out.add(LEADS);
                }
                case "outreach", "actions", "delivery", "replies" -> {
                    out.addAll(List.of(WHATSAPP, EMAIL, ENGINE));
                    if (weekly) out.add(LEADS);
                }
                case "runs", "creditBalance", "stuckMembers", "promptChanges" -> out.add(ENGINE);
                default -> {
                }
            }
        }
        return out;
    }

    // ── facts from rows ──────────────────────────────────────────────────────

    /** A phone is any non-blank one; a synthesized placeholder address is no email. */
    static ContactCounts contactCounts(List<LeadRow> rows, Predicate<String> isPlaceholderEmail) {
        long noPhone = 0, noEmail = 0, neither = 0;
        for (LeadRow r : rows) {
            boolean phone = !blank(r.stPhone()) || !blank(r.leadPhone());
            boolean email = realEmail(r.stEmail(), isPlaceholderEmail) || realEmail(r.leadEmail(), isPlaceholderEmail);
            if (!phone) noPhone++;
            if (!email) noEmail++;
            if (!phone && !email) neither++;
        }
        return new ContactCounts(rows.size(), noPhone, noEmail, neither);
    }

    private static boolean realEmail(String email, Predicate<String> isPlaceholderEmail) {
        return !blank(email) && !isPlaceholderEmail.test(email);
    }

    /**
     * Each agent's counters summed over the period's days. Left out: an agent created after the period,
     * which did not exist yet, and one whose delivery window hasn't closed on a working day of the
     * period, which has not had its chance (this morning, or its day off).
     */
    static List<AgentFact> agentFacts(List<AgentRow> agents, List<AgentDay> days, Window w, Instant now) {
        Map<String, AgentDay> period = new HashMap<>();
        for (AgentDay d : days) {
            if (w.inPeriod(d.day())) period.merge(d.agentId(), d, AgentDay::plus);
        }
        return agents.stream()
                .filter(a -> a.createdAt() == null || a.createdAt().isBefore(w.to()))
                .filter(a -> windowClosedInPeriod(a.windowJson(), w.fromDay(), w.toDay(), now))
                .map(a -> {
            AgentDay d = period.get(a.agentId());
            return d == null ? new AgentFact(a.name(), a.status(), 0, 0, 0, 0)
                    : new AgentFact(a.name(), a.status(), d.discovered(), d.rejected(), d.review(), d.delivered());
                }).toList();
    }

    /**
     * Whether the agent's window has closed on a working day of the period. Reads lead_agent.window_json
     * as ai_service's lead_agent/pacing.py does: a missing key takes its default, days are ISO weekdays, a
     * window ending before it starts runs past midnight, and one that can't be read never opens.
     */
    static boolean windowClosedInPeriod(String windowJson, LocalDate from, LocalDate to, Instant now) {
        JsonNode window;
        try {
            window = blank(windowJson) ? JSON.createObjectNode() : JSON.readTree(windowJson);
        } catch (Exception e) {
            window = JSON.createObjectNode();
        }
        Set<Integer> days = new HashSet<>();
        JsonNode dayList = window.get("days");
        if (dayList == null || dayList.isNull()) {
            days.addAll(DEFAULT_WINDOW_DAYS);
        } else {
            dayList.forEach(d -> days.add(d.asInt(0)));
        }
        LocalTime start = time(window.path("start").asText(DEFAULT_WINDOW_START));
        LocalTime end = time(window.path("end").asText(DEFAULT_WINDOW_END));
        if (start == null || end == null) return false;
        ZoneId zone;
        try {
            zone = ZoneId.of(window.path("tz").asText(EngagementSendSchedule.DEFAULT_ZONE.getId()));
        } catch (DateTimeException e) {
            zone = EngagementSendSchedule.DEFAULT_ZONE;
        }
        for (LocalDate day = from; !day.isAfter(to); day = day.plusDays(1)) {
            if (!days.contains(day.getDayOfWeek().getValue())) continue;
            LocalDate endDay = end.isBefore(start) ? day.plusDays(1) : day;
            if (!endDay.atTime(end).atZone(zone).toInstant().isAfter(now)) return true;
        }
        return false;
    }

    private static LocalTime time(String hhmm) {
        try {
            return LocalTime.parse(hhmm);
        } catch (DateTimeException e) {
            return null;
        }
    }

    /** The reason for a failed WhatsApp from Meta's error code; no code means it failed before Meta. */
    static String whatsappFailureReason(String code) {
        if (blank(code)) return "REJECTED_AT_SEND";
        int c;
        try {
            c = Integer.parseInt(code.trim());
        } catch (NumberFormatException e) {
            return "OTHER";
        }
        if (c >= 132000 && c <= 132999) return "TEMPLATE_PROBLEM";
        return switch (c) {
            case 131026 -> "NOT_ON_WHATSAPP";
            case 131049 -> "MARKETING_LIMIT";
            case 131050 -> "USER_STOPPED_MARKETING";
            case 131047 -> "OUTSIDE_24H_WINDOW";
            case 131042 -> "PAYMENT_ISSUE";
            case 130429, 131048, 131056 -> "RATE_LIMITED";
            default -> "OTHER";
        };
    }

    private static boolean inPeriod(ActionRow a, Window w) {
        return w.inPeriod(w.localDay(a.dispatchedAt()));
    }

    /** The period's messages by the report's definition, on one channel. */
    private static List<ActionRow> periodSends(List<ActionRow> actions, String channel, Window w) {
        return actions.stream()
                .filter(a -> a.reportSend() && channel.equals(a.channel()) && inPeriod(a, w))
                .toList();
    }

    /** WhatsApp sends rejected before they went out: the report's failed count includes them, its sent does not. */
    static long whatsappRejected(List<ActionRow> actions, Window w) {
        return periodSends(actions, WHATSAPP, w).stream().filter(a -> !a.sent()).count();
    }

    /**
     * One row per reason and raw code, biggest first: the period's WhatsApp that failed. Meta's code wins
     * over the action's status, because EngagementDeliveryCheckJob moves a send Meta refused to FAILED
     * within minutes. Only a failed row with no code failed before Meta.
     */
    static List<WhatsAppFailureRow> whatsappFailures(List<ActionRow> actions, Map<String, Signal> signals, Window w) {
        Map<String, Long> counts = new HashMap<>();
        for (ActionRow a : periodSends(actions, WHATSAPP, w)) {
            Signal g = signals.get(a.id());
            if (a.sent() && (g == null || !"FAILED".equalsIgnoreCase(g.deliveryStatus()))) continue;
            String code = g == null ? null : g.deliveryErrorCode();
            counts.merge(blank(code) ? "\u0000" : code.trim(), 1L, Long::sum);
        }
        List<WhatsAppFailureRow> rows = new ArrayList<>();
        counts.forEach((code, n) -> {
            String raw = "\u0000".equals(code) ? null : code;
            rows.add(new WhatsAppFailureRow(whatsappFailureReason(raw), raw, n));
        });
        rows.sort(Comparator.comparingLong(WhatsAppFailureRow::count).reversed()
                .thenComparing(WhatsAppFailureRow::reason)
                .thenComparing(r -> r.code() == null ? "" : r.code()));
        return rows;
    }

    /** The failure rows per reason, biggest first (the problem's breakdown). */
    static List<BreakdownRow> failureReasons(List<WhatsAppFailureRow> failures) {
        Map<String, Long> byReason = new HashMap<>();
        failures.forEach(f -> byReason.merge(f.reason(), f.count(), Long::sum));
        return byReason.entrySet().stream()
                .map(e -> new BreakdownRow(e.getKey(), e.getValue()))
                .sorted(Comparator.comparingLong(BreakdownRow::count).reversed().thenComparing(BreakdownRow::key))
                .toList();
    }

    /**
     * People sent 2+ SEND actions on one channel in one local day, and everyone a message went out to.
     * Attempts are not people, so both are counted by person (one user on two lead rows is one).
     */
    static DoubleContact doubleContact(List<ActionRow> actions, Window w) {
        Set<String> contacted = new HashSet<>();
        Set<String> seen = new HashSet<>();
        Set<String> people = new HashSet<>();
        for (ActionRow a : actions) {
            if (!a.sent() || !a.reportSend() || !inPeriod(a, w)) continue;
            String person = a.contactKey();
            contacted.add(person);
            if ("SEND".equals(a.kind())
                    && !seen.add(person + "\u0000" + a.channel() + "\u0000" + w.localDay(a.dispatchedAt()))) {
                people.add(person);
            }
        }
        return new DoubleContact(people.size(), contacted.size());
    }

    /**
     * The period's SENDs on email or WhatsApp that went out within 72 hours after the same person wrote
     * in. Every first-reply time of every message read counts as a moment they wrote in, whichever
     * message it was credited to: the question here is only whether they had written.
     */
    static long sentAfterReply(List<ActionRow> actions, Map<String, Signal> signals, Window w) {
        Map<String, TreeSet<Long>> writtenAt = new HashMap<>();
        for (ActionRow a : actions) {
            Signal g = signals.get(a.id());
            if (g != null && g.firstReplyAt() != null) {
                writtenAt.computeIfAbsent(a.contactKey(), k -> new TreeSet<>()).add(g.firstReplyAt());
            }
        }
        long windowMs = SENT_AFTER_REPLY_HOURS * 3_600_000L;
        long count = 0;
        for (ActionRow a : actions) {
            if (!"SEND".equals(a.kind()) || !a.sent() || !inPeriod(a, w)
                    || !(EMAIL.equals(a.channel()) || WHATSAPP.equals(a.channel()))) {
                continue;
            }
            TreeSet<Long> times = writtenAt.get(a.contactKey());
            long sentAt = epochMs(a.dispatchedAt());
            Long last = times == null ? null : times.lower(sentAt);
            if (last != null && sentAt - last <= windowMs) count++;
        }
        return count;
    }

    private static long epochMs(LocalDateTime utc) {
        return utc.toInstant(ZoneOffset.UTC).toEpochMilli();
    }

    /** Lengths, hours and what the analysis found, from the period's queue rows. */
    static CallDetails callDetails(List<CallRow> rows) {
        long connected = 0, under20s = 0, s20to60 = 0, over60 = 0;
        Map<Integer, long[]> byHour = new TreeMap<>();
        long analysed = 0, high = 0;
        Map<String, Long> sentiment = new LinkedHashMap<>();
        for (String s : List.of("POSITIVE", "NEUTRAL", "NEGATIVE")) sentiment.put(s, 0L);
        Map<String, Long> outcomes = new HashMap<>();
        Map<String, Object[]> objections = new HashMap<>();
        for (CallRow r : rows) {
            if (r.connected()) {
                connected++;
                if (r.durationSeconds() != null) {
                    if (r.durationSeconds() < SHORT_CALL_SECONDS) under20s++;
                    else if (r.durationSeconds() <= LONG_CALL_SECONDS) s20to60++;
                    else over60++;
                }
            }
            if (dialledAndFinished(r)) {
                long[] h = byHour.computeIfAbsent(r.localHour(), k -> new long[2]);
                h[0]++;
                if (r.connected()) h[1]++;
            }
            if (!r.analysed()) continue;
            analysed++;
            if (!blank(r.leadSentiment())) sentiment.merge(r.leadSentiment().trim().toUpperCase(Locale.ROOT), 1L, Long::sum);
            if (!blank(r.genericStatus())) outcomes.merge(r.genericStatus().trim(), 1L, Long::sum);
            if ("HIGH".equalsIgnoreCase(r.conversionLikelihood())) high++;
            for (String text : objections(r.objectionsJson())) {
                Object[] acc = objections.computeIfAbsent(text.toLowerCase(Locale.ROOT), k -> new Object[]{text, 0L});
                acc[1] = (Long) acc[1] + 1;
            }
        }
        List<CallHourRow> hours = new ArrayList<>();
        byHour.forEach((hour, h) -> hours.add(
                new CallHourRow(hour, h[0], h[1], rate(h[1], h[0]), h[0] >= MIN_CALLS_PER_HOUR)));
        List<OutcomeCount> outcomeRows = outcomes.entrySet().stream()
                .map(e -> new OutcomeCount(e.getKey(), e.getValue()))
                .sorted(Comparator.comparingLong(OutcomeCount::count).reversed().thenComparing(OutcomeCount::status))
                .toList();
        List<ObjectionCount> top = objections.values().stream()
                .map(a -> new ObjectionCount((String) a[0], (Long) a[1]))
                .sorted(Comparator.comparingLong(ObjectionCount::count).reversed().thenComparing(ObjectionCount::text))
                .limit(MAX_OBJECTIONS)
                .toList();
        return new CallDetails(new CallLengths(connected, under20s, s20to60, over60), hours,
                new CallInsights(analysed, sentiment, outcomeRows, high, top));
    }

    private static boolean dialledAndFinished(CallRow r) {
        if (r.callLogId() == null || r.callStatus() == null || r.localHour() == null
                || NOT_DIALLED.contains(r.queueStatus())) {
            return false;
        }
        return r.connected() || !CALL_IN_PROGRESS.contains(r.callStatus());
    }

    /**
     * The distinct objections of one call (call_analysis.objections: [{objection, handled}], as
     * CallIntelligenceQueryService reads them), so a call counts once per objection. Unreadable: none.
     */
    static List<String> objections(String json) {
        if (blank(json)) return List.of();
        JsonNode list;
        try {
            list = JSON.readTree(json);
        } catch (Exception e) {
            return List.of();
        }
        if (list == null || !list.isArray()) return List.of();
        Map<String, String> distinct = new LinkedHashMap<>();
        for (JsonNode o : list) {
            JsonNode text = o.get("objection");
            if (text != null && text.isTextual() && !text.asText().isBlank()) {
                distinct.putIfAbsent(text.asText().trim().toLowerCase(Locale.ROOT), text.asText().trim());
            }
        }
        return List.copyOf(distinct.values());
    }

    /** People who got a message or a dialled call in the period (the report's person). */
    static Set<String> contactedPeople(List<ActionRow> actions, List<CallRow> calls, Window w) {
        Set<String> out = new HashSet<>();
        for (ActionRow a : actions) {
            if (a.sent() && a.reportSend() && inPeriod(a, w)) out.add(a.person());
        }
        for (CallRow c : calls) {
            if (c.callLogId() != null && !NOT_DIALLED.contains(c.queueStatus())) out.add(c.person());
        }
        return out;
    }

    /**
     * People who answered a message sent in the period or picked up a call (the report's person). A
     * call counts here though the report's funnel has it as delivered: this judges whether a source's
     * leads are real and reachable, and an engine that only calls would otherwise show none.
     */
    static Set<String> respondedPeople(List<ActionRow> actions, Map<String, Long> replies, List<CallRow> calls,
                                       Window w) {
        Set<String> out = new HashSet<>();
        for (ActionRow a : actions) {
            if (a.sent() && a.reportSend() && inPeriod(a, w) && replies.containsKey(a.id())) out.add(a.person());
        }
        for (CallRow c : calls) {
            if (c.connected()) out.add(c.person());
        }
        return out;
    }

    /**
     * Whether anything of the period could show a response: a dialled call, a WhatsApp, or an email whose
     * replies reach us. When nothing could, "nobody responded" would be a false zero, so it is unknown.
     */
    static boolean responsesVisible(List<ActionRow> actions, List<CallRow> calls, Map<String, Signal> signals,
                                    boolean inboundEmail, Set<String> unreachableSenders, Window w) {
        for (CallRow c : calls) {
            if (c.callLogId() != null && !NOT_DIALLED.contains(c.queueStatus())) return true;
        }
        for (ActionRow a : actions) {
            if (replyableSend(a, w) && (!EMAIL.equals(a.channel())
                    || replyCanReachUs(signals.get(a.id()), inboundEmail, unreachableSenders))) {
                return true;
            }
        }
        return false;
    }

    /**
     * The messages to read signals for: the report's, plus failed WhatsApp, because that is where a send
     * Meta refused ends up and Meta's reason is only in notification_service.
     */
    static List<String> signalIds(List<ActionRow> actions) {
        List<String> ids = new ArrayList<>(EngagementDailyReportService.signalIds(
                actions.stream().map(ActionRow::asSend).toList()));
        for (ActionRow a : actions) {
            if (!a.sent() && WHATSAPP.equals(a.channel()) && a.reportSend()) ids.add(a.id());
        }
        return ids;
    }

    /**
     * The people added in the period per source. A null argument means that read failed: the column and
     * its rate are null for every row.
     */
    static List<LeadSourceRow> leadSources(List<LeadRow> leads, Set<String> contacted, Set<String> responded,
                                           List<BookingRow> bookings) {
        Map<String, String> sourceOf = new HashMap<>();
        Map<String, long[]> bySource = new HashMap<>();
        for (LeadRow r : leads) {
            String source = blank(r.source()) ? OTHER_SOURCE : r.source();
            sourceOf.put(r.person(), source);
            long[] n = bySource.computeIfAbsent(source, k -> new long[4]);
            n[0]++;
            if (contacted != null && contacted.contains(r.person())) n[1]++;
            if (responded != null && responded.contains(r.person())) n[2]++;
        }
        if (bookings != null) {
            for (BookingRow b : bookings) {
                String source = sourceOf.get(b.person());
                if (source != null) bySource.get(source)[3]++;
            }
        }
        List<LeadSourceRow> rows = new ArrayList<>();
        bySource.forEach((source, n) -> rows.add(new LeadSourceRow(source, n[0],
                contacted == null ? null : n[1], responded == null ? null : n[2],
                bookings == null ? null : n[3],
                contacted == null ? null : rate(n[1], n[0]), responded == null ? null : rate(n[2], n[0]),
                n[0] >= MIN_LEADS_PER_SOURCE)));
        rows.sort(Comparator.comparingLong(LeadSourceRow::leads).reversed().thenComparing(LeadSourceRow::source));
        return rows;
    }

    /** A row placeholder sums several things, so it is not a template or subject to judge or rewrite. */
    static boolean comparable(String name) {
        return name != null && !NO_TEMPLATE.equals(name) && !NO_SUBJECT.equals(name)
                && !EngagementDailyReportService.OTHER_TEMPLATES.equals(name);
    }

    private static boolean judged(String verdict) {
        return !NOT_ENOUGH_DATA.equals(verdict);
    }

    /**
     * Verdicts in row order. Below the minimum, without a rate or a row of "(other)": NOT_ENOUGH_DATA.
     * BEST and WORST only among comparable rows with enough sends, when at least two have enough and
     * their rates differ; every other row with enough is OK.
     *
     * @param sends the sends each rate is over
     */
    static List<String> verdicts(List<String> names, List<Long> sends, List<Double> rates) {
        double best = Double.NEGATIVE_INFINITY, worst = Double.POSITIVE_INFINITY;
        int ranked = 0;
        for (int i = 0; i < names.size(); i++) {
            if (comparable(names.get(i)) && sends.get(i) >= MIN_SENDS_PER_ROW && rates.get(i) != null) {
                ranked++;
                best = Math.max(best, rates.get(i));
                worst = Math.min(worst, rates.get(i));
            }
        }
        boolean rank = ranked >= 2 && best > worst;
        List<String> out = new ArrayList<>();
        for (int i = 0; i < names.size(); i++) {
            String name = names.get(i);
            Double r = rates.get(i);
            if (sends.get(i) < MIN_SENDS_PER_ROW || r == null
                    || EngagementDailyReportService.OTHER_TEMPLATES.equals(name)) {
                out.add(NOT_ENOUGH_DATA);
            } else if (rank && comparable(name) && r == best) {
                out.add(BEST);
            } else if (rank && comparable(name) && r == worst) {
                out.add(WORST);
            } else {
                out.add(OK);
            }
        }
        return out;
    }

    /** The WhatsApp rows of the report's template table, most sent first, with their verdicts. */
    static List<WhatsAppTemplateRow> whatsappTemplates(List<TemplateRow> templates) {
        List<TemplateRow> rows = templates.stream()
                .filter(t -> WHATSAPP.equals(t.channel()))
                .sorted(Comparator.comparingLong(TemplateRow::sent).reversed().thenComparing(TemplateRow::name))
                .toList();
        List<String> verdicts = verdicts(rows.stream().map(TemplateRow::name).toList(),
                rows.stream().map(TemplateRow::sent).toList(),
                rows.stream().map(t -> (Double) t.replyRate()).toList());
        List<WhatsAppTemplateRow> out = new ArrayList<>();
        for (int i = 0; i < rows.size(); i++) {
            TemplateRow t = rows.get(i);
            out.add(new WhatsAppTemplateRow(t.name(), t.sent(), t.delivered(), t.read(), t.replied(), t.replyRate(),
                    verdicts.get(i)));
        }
        return out;
    }

    /**
     * Whether a reply to this message could reach us. Unknown (no signal, no sender) keeps today's
     * behaviour and counts as yes.
     */
    static boolean replyCanReachUs(Signal g, boolean inboundEmail, Set<String> unreachableSenders) {
        if (!inboundEmail) return false;
        return g == null || g.sender() == null || !unreachableSenders.contains(g.sender());
    }

    private static final class SubjectAcc {
        final String name;
        long sent, delivered, clicked, bounced, tracked, reachable, replied;

        SubjectAcc(String name) {
            this.name = name;
        }

        void add(SubjectAcc o) {
            sent += o.sent;
            delivered += o.delivered;
            clicked += o.clicked;
            bounced += o.bounced;
            tracked += o.tracked;
            reachable += o.reachable;
            replied += o.replied;
        }
    }

    record EmailSubjects(List<EmailSubjectRow> rows, Double channelRate) {
    }

    /**
     * The period's sent emails per subject, named as in the report's table: an email drafted on a
     * template is that template's row, an AI-written one its subject's. Past the report's row cap,
     * one "(other)" row holds the rest. Replies count only over the sends that could report one.
     */
    static EmailSubjects emailSubjects(List<ActionRow> actions, Map<String, Signal> signals, Map<String, Long> replies,
                                       boolean inboundEmail, Set<String> unreachableSenders, Window w) {
        Map<String, SubjectAcc> byName = new HashMap<>();
        long reachable = 0, replied = 0;
        for (ActionRow a : periodSends(actions, EMAIL, w)) {
            if (!a.sent()) continue;
            Signal g = signals.get(a.id());
            SubjectAcc acc = byName.computeIfAbsent(emailRowName(a, g), SubjectAcc::new);
            acc.sent++;
            if (g != null) {
                if (g.delivered() || g.opened() || g.clicked()) acc.delivered++;
                if (g.clicked()) acc.clicked++;
                if (g.bounced()) acc.bounced++;
                if (g.emailTracked()) acc.tracked++;
            }
            if (replyCanReachUs(g, inboundEmail, unreachableSenders)) {
                acc.reachable++;
                reachable++;
                if (replies.containsKey(a.id())) {
                    acc.replied++;
                    replied++;
                }
            }
        }
        List<SubjectAcc> sorted = byName.values().stream()
                .sorted(Comparator.comparingLong((SubjectAcc s) -> s.sent).reversed().thenComparing(s -> s.name))
                .toList();
        List<SubjectAcc> kept = new ArrayList<>();
        SubjectAcc other = null;
        for (int i = 0; i < sorted.size(); i++) {
            if (i < EngagementDailyReportService.MAX_TEMPLATE_ROWS) {
                kept.add(sorted.get(i));
            } else {
                if (other == null) other = new SubjectAcc(EngagementDailyReportService.OTHER_TEMPLATES);
                other.add(sorted.get(i));
            }
        }
        if (other != null) kept.add(other);
        List<String> verdicts = verdicts(kept.stream().map(s -> s.name).toList(),
                kept.stream().map(s -> s.reachable).toList(),
                kept.stream().map(s -> rate(s.replied, s.reachable)).toList());
        List<EmailSubjectRow> rows = new ArrayList<>();
        for (int i = 0; i < kept.size(); i++) {
            SubjectAcc s = kept.get(i);
            rows.add(new EmailSubjectRow(s.name, s.sent, s.delivered, s.clicked, s.bounced,
                    s.reachable == 0 ? null : s.replied, rate(s.clicked, s.tracked), rate(s.replied, s.reachable),
                    verdicts.get(i)));
        }
        return new EmailSubjects(rows, rate(replied, reachable));
    }

    private static String emailRowName(ActionRow a, Signal g) {
        if (!blank(a.emailTemplateId())) return blank(a.emailTemplateName()) ? a.emailTemplateId() : a.emailTemplateName();
        if (g != null && !blank(g.subject())) return g.subject();
        return blank(a.subject()) ? NO_SUBJECT : a.subject();
    }

    /** The prompt versions behind the period's emails and WhatsApp messages. */
    static Set<String> promptVersionIds(List<ActionRow> actions, Window w) {
        Set<String> out = new HashSet<>();
        for (ActionRow a : actions) {
            if (a.promptVersionId() != null && replyableSend(a, w)) out.add(a.promptVersionId());
        }
        return out;
    }

    /** A sent message of the period on a channel that can report a reply. */
    private static boolean replyableSend(ActionRow a, Window w) {
        return a.sent() && a.reportSend() && (EMAIL.equals(a.channel()) || WHATSAPP.equals(a.channel()))
                && inPeriod(a, w);
    }

    /**
     * Per prompt version, newest first. A booking goes to the version of the person's latest message of
     * the period before it. A null replies map means delivery could not be read, and a version none of
     * whose sends could report a reply has no reply count either; null bookings means the demos could
     * not be read. Those columns are then null. The rate is over the sends that could report a reply.
     */
    static List<PromptChangeRow> promptChanges(List<PromptVersionRow> versions, List<ActionRow> actions,
                                               Map<String, Signal> signals, Map<String, Long> replies,
                                               boolean inboundEmail, Set<String> unreachableSenders,
                                               List<BookingRow> bookings, Window w) {
        Map<String, long[]> byVersion = new HashMap<>();
        Map<String, List<ActionRow>> byPerson = new HashMap<>();
        for (ActionRow a : actions) {
            if (!replyableSend(a, w)) continue;
            byPerson.computeIfAbsent(a.person(), k -> new ArrayList<>()).add(a);
            if (a.promptVersionId() == null) continue;
            long[] n = byVersion.computeIfAbsent(a.promptVersionId(), k -> new long[4]);
            n[0]++;
            boolean reachable = !EMAIL.equals(a.channel())
                    || replyCanReachUs(signals.get(a.id()), inboundEmail, unreachableSenders);
            if (reachable) n[1]++;
            if (reachable && replies != null && replies.containsKey(a.id())) n[2]++;
        }
        if (bookings != null) {
            for (BookingRow b : bookings) {
                ActionRow latest = byPerson.getOrDefault(b.person(), List.of()).stream()
                        .filter(a -> b.bookedAt() != null && a.dispatchedAt().isBefore(b.bookedAt()))
                        .max(Comparator.comparing(ActionRow::dispatchedAt))
                        .orElse(null);
                long[] n = latest == null || latest.promptVersionId() == null ? null
                        : byVersion.get(latest.promptVersionId());
                if (n != null) n[3]++;
            }
        }
        List<PromptChangeRow> rows = new ArrayList<>();
        for (PromptVersionRow v : versions) {
            long[] n = byVersion.get(v.id());
            if (n == null) continue;
            rows.add(new PromptChangeRow(v.engineId(), v.engineName(), v.version(),
                    EngagementReportDay.iso(v.createdAt()), v.source(), v.change(), n[0],
                    replies == null || n[1] == 0 ? null : (Long) n[2], replies == null ? null : rate(n[2], n[1]),
                    bookings == null ? null : n[3], n[1] >= MIN_SENDS_PER_ROW));
        }
        rows.sort(Comparator.comparing(PromptChangeRow::createdAt, Comparator.nullsLast(Comparator.reverseOrder()))
                .thenComparing(Comparator.comparingInt(PromptChangeRow::version).reversed()));
        return rows;
    }

    /**
     * The gap for the addresses the period's emails went from whose replies cannot reach us: all of them
     * while inbound email is off, when it applies even if no row recorded its sender. null when none.
     */
    static DataGap repliesGap(List<ActionRow> actions, Map<String, Signal> signals, boolean inboundEmail,
                              Set<String> unreachableSenders, Window w) {
        Set<String> names = new TreeSet<>();
        boolean sent = false;
        for (ActionRow a : periodSends(actions, EMAIL, w)) {
            if (!a.sent()) continue;
            sent = true;
            Signal g = signals.get(a.id());
            if (g == null || g.sender() == null) continue;
            if (!inboundEmail || unreachableSenders.contains(g.sender())) names.add(g.sender());
        }
        return (sent && !inboundEmail) || !names.isEmpty()
                ? new DataGap("EMAIL_REPLIES_NOT_TRACKED", List.copyOf(names)) : null;
    }

    /**
     * email.repliesTracked of the daily report: false while inbound email is off, or when every sender of
     * the period is unreachable. A sender we don't know (old rows) keeps today's behaviour.
     */
    static boolean repliesTracked(boolean inboundEmail, Collection<String> periodSenders,
                                  Collection<String> unreachableSenders) {
        if (!inboundEmail) return false;
        if (periodSenders.isEmpty()) return true;
        for (String sender : periodSenders) {
            if (sender == null || !unreachableSenders.contains(sender)) return true;
        }
        return false;
    }

    // ── small helpers ────────────────────────────────────────────────────────

    /** part / whole as a 0..1 fraction, rounded as the report rounds it; null when there is no whole. */
    static Double rate(long part, long whole) {
        return whole <= 0 ? null : Double.valueOf(Math.round((double) part / whole * 10_000d) / 10_000d);
    }

    private static boolean atLeast(Double value, double threshold) {
        return value != null && value >= threshold;
    }

    private static boolean weakAgainst(Double rate, Double overall) {
        return rate != null && overall != null && rate < WEAK_SHARE * overall;
    }

    private static boolean blank(String s) {
        return s == null || s.isBlank();
    }
}
