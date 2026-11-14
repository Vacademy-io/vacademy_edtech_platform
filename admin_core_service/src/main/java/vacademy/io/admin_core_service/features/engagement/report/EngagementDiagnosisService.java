package vacademy.io.admin_core_service.features.engagement.report;

import com.github.benmanes.caffeine.cache.Cache;
import com.github.benmanes.caffeine.cache.Caffeine;
import lombok.extern.slf4j.Slf4j;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import vacademy.io.admin_core_service.features.audience.service.LeadReportSettingService;
import vacademy.io.admin_core_service.features.audience.service.PlaceholderEmailService;
import vacademy.io.admin_core_service.features.engagement.report.EngagementDailyReportDao.AgentDay;
import vacademy.io.admin_core_service.features.engagement.report.EngagementDailyReportDao.CallDay;
import vacademy.io.admin_core_service.features.engagement.report.EngagementDailyReportService.Window;
import vacademy.io.admin_core_service.features.engagement.report.EngagementDiagnosis.BreakdownRow;
import vacademy.io.admin_core_service.features.engagement.report.EngagementDiagnosis.DataGap;
import vacademy.io.admin_core_service.features.engagement.report.EngagementDiagnosis.EngineChecks;
import vacademy.io.admin_core_service.features.engagement.report.EngagementDiagnosis.LeadSourceRow;
import vacademy.io.admin_core_service.features.engagement.report.EngagementDiagnosis.Minimums;
import vacademy.io.admin_core_service.features.engagement.report.EngagementDiagnosis.PromptChangeRow;
import vacademy.io.admin_core_service.features.engagement.report.EngagementDiagnosis.StageStatus;
import vacademy.io.admin_core_service.features.engagement.report.EngagementDiagnosis.Weekly;
import vacademy.io.admin_core_service.features.engagement.report.EngagementDiagnosis.WhatsAppFailureRow;
import vacademy.io.admin_core_service.features.engagement.report.EngagementDiagnosis.WhatsAppTemplateRow;
import vacademy.io.admin_core_service.features.engagement.report.EngagementDiagnosisDao.ActionRow;
import vacademy.io.admin_core_service.features.engagement.report.EngagementDiagnosisDao.AgentRow;
import vacademy.io.admin_core_service.features.engagement.report.EngagementDiagnosisDao.BookingRow;
import vacademy.io.admin_core_service.features.engagement.report.EngagementDiagnosisDao.CallRow;
import vacademy.io.admin_core_service.features.engagement.report.EngagementDiagnosisDao.LeadRow;
import vacademy.io.admin_core_service.features.engagement.report.EngagementDiagnosisDao.PromptVersionRow;
import vacademy.io.admin_core_service.features.engagement.report.EngagementDiagnosisRules.AgentFact;
import vacademy.io.admin_core_service.features.engagement.report.EngagementDiagnosisRules.CallCounts;
import vacademy.io.admin_core_service.features.engagement.report.EngagementDiagnosisRules.CallDetails;
import vacademy.io.admin_core_service.features.engagement.report.EngagementDiagnosisRules.CallFacts;
import vacademy.io.admin_core_service.features.engagement.report.EngagementDiagnosisRules.DoubleContact;
import vacademy.io.admin_core_service.features.engagement.report.EngagementDiagnosisRules.EmailCounts;
import vacademy.io.admin_core_service.features.engagement.report.EngagementDiagnosisRules.EmailFacts;
import vacademy.io.admin_core_service.features.engagement.report.EngagementDiagnosisRules.EmailSubjects;
import vacademy.io.admin_core_service.features.engagement.report.EngagementDiagnosisRules.EngineFacts;
import vacademy.io.admin_core_service.features.engagement.report.EngagementDiagnosisRules.Facts;
import vacademy.io.admin_core_service.features.engagement.report.EngagementDiagnosisRules.LeadFacts;
import vacademy.io.admin_core_service.features.engagement.report.EngagementDiagnosisRules.Outcome;
import vacademy.io.admin_core_service.features.engagement.report.EngagementDiagnosisRules.RunCounts;
import vacademy.io.admin_core_service.features.engagement.report.EngagementDiagnosisRules.WhatsAppCounts;
import vacademy.io.admin_core_service.features.engagement.report.EngagementDiagnosisRules.WhatsAppFacts;
import vacademy.io.admin_core_service.features.engagement.report.EngagementReportSignalsClient.Signal;
import vacademy.io.admin_core_service.features.engagement.report.EngagementReportSignalsClient.Signals;
import vacademy.io.admin_core_service.features.institute.service.InstituteTimezoneService;
import vacademy.io.common.exceptions.InvalidRequestException;
import vacademy.io.common.exceptions.ResourceNotFoundException;

import java.sql.Types;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.function.Supplier;

/**
 * Where the lead-to-demo chain is breaking and what to change (docs/engagement/ENGAGEMENT_DIAGNOSIS.md):
 * no AI, queries compute the numbers and {@link EngagementDiagnosisRules} decides what is wrong. Every
 * number the daily report already has comes from {@link EngagementDailyReportService}; the rest is read
 * here per person and per call. Each section runs in its own read-only transaction with a statement
 * timeout; one that fails is named in errors, its stage reads UNAVAILABLE and the rest still renders.
 */
@Slf4j
@Service
public class EngagementDiagnosisService {

    /** The one section name for the daily report itself failing outright. */
    static final String REPORT = "report";
    /** The daily report's sections the diagnosis reads; a failure in another (revenue, costs) is not its concern. */
    private static final Set<String> REPORT_SECTIONS =
            Set.of("lists", "runs", "outreach", "calls", "creditBalance", "delivery", "replies");
    private static final String DELIVERY = "delivery", REPLIES = "replies", UNAVAILABLE = "unavailable";
    private static final int WEEK_DAYS = 7;
    /**
     * A reply can precede a send by {@link EngagementDiagnosisRules#SENT_AFTER_REPLY_HOURS}, and is only
     * seen through a message sent up to the reply window before it, so messages are read this far back.
     */
    private static final int SIGNAL_LOOKBACK_HOURS =
            EngagementDiagnosisRules.SENT_AFTER_REPLY_HOURS + EngagementDailyReportService.REPLY_WINDOW_HOURS;
    private static final String STATEMENT_TIMEOUT = "SET LOCAL statement_timeout = '8s'";

    private final EngagementDiagnosisDao dao;
    private final EngagementDailyReportDao reportDao;
    private final EngagementDailyReportService reportService;
    private final NamedParameterJdbcTemplate jdbc;
    private final TransactionTemplate readOnlyTx;
    private final InstituteTimezoneService timezoneService;
    private final LeadReportSettingService leadReportSettings;
    private final PlaceholderEmailService placeholderEmailService;
    private final EngagementReportSignalsClient signalsClient;
    private final Cache<String, EngagementDiagnosis> cache = Caffeine.newBuilder()
            .expireAfterWrite(EngagementDailyReportService.CACHE_TTL)
            .maximumSize(500)
            .build();

    public EngagementDiagnosisService(EngagementDiagnosisDao dao,
                                      EngagementDailyReportDao reportDao,
                                      EngagementDailyReportService reportService,
                                      NamedParameterJdbcTemplate jdbc,
                                      PlatformTransactionManager transactionManager,
                                      InstituteTimezoneService timezoneService,
                                      LeadReportSettingService leadReportSettings,
                                      PlaceholderEmailService placeholderEmailService,
                                      EngagementReportSignalsClient signalsClient) {
        this.dao = dao;
        this.reportDao = reportDao;
        this.reportService = reportService;
        this.jdbc = jdbc;
        this.readOnlyTx = new TransactionTemplate(transactionManager);
        this.readOnlyTx.setReadOnly(true);
        this.timezoneService = timezoneService;
        this.leadReportSettings = leadReportSettings;
        this.placeholderEmailService = placeholderEmailService;
        this.signalsClient = signalsClient;
    }

    /**
     * @param engineId null or blank = every engine of the institute
     * @param view     DAILY (null or blank) or WEEKLY
     * @param to       the last day, YYYY-MM-DD in the institute's zone; null or blank = today there
     * @param fresh    skip the cached copy and build it again (the dashboard's Refresh button)
     * @throws InvalidRequestException   a bad view or format, a future day, a day before today − 89
     * @throws ResourceNotFoundException the engine is not one of this institute's
     */
    public EngagementDiagnosis diagnosis(String instituteId, String engineId, String view, String to, boolean fresh) {
        String v = view(view);
        ZoneId zone = EngagementDailyReportService.zone(timezoneService.getTimezoneId(instituteId));
        LocalDate today = LocalDate.now(zone);
        EngagementReportDay.Period period = period(v, to, today);
        String engine = engineId == null || engineId.isBlank() ? null : engineId.trim();
        String key = String.join("|", instituteId, engine == null ? "*" : engine, v, period.from().toString(),
                period.to().toString(), zone.getId());
        EngagementDiagnosis cached = fresh ? null : cache.getIfPresent(key);
        if (cached != null) return cached;
        EngagementDiagnosis out = build(instituteId, engine, v, period, today, zone, fresh);
        if (EngagementDailyReportService.cacheable(out.errors())) cache.put(key, out);
        return out;
    }

    static String view(String view) {
        if (view == null || view.isBlank()) return EngagementDiagnosisRules.DAILY;
        String v = view.trim().toUpperCase(Locale.ROOT);
        if (!EngagementDiagnosisRules.DAILY.equals(v) && !EngagementDiagnosisRules.WEEKLY.equals(v)) {
            throw new InvalidRequestException("view must be DAILY or WEEKLY");
        }
        return v;
    }

    /** to..to for DAILY, the 7 days ending at to for WEEKLY; the daily report's rules apply to both ends. */
    static EngagementReportDay.Period period(String view, String to, LocalDate today) {
        LocalDate last = to == null || to.isBlank() ? today : EngagementReportDay.day("to", to, today);
        long back = EngagementDiagnosisRules.WEEKLY.equals(view) ? WEEK_DAYS - 1L : 0L;
        return EngagementReportDay.range(last.minusDays(back).toString(), last.toString(), today);
    }

    /** What was read beyond the daily report; a section that failed leaves null. */
    private static final class Loaded {
        List<LeadRow> leads;
        List<AgentFact> agents;
        /** Messages of the period and the reply lookback before it. */
        List<ActionRow> actions;
        Signals signals;
        List<CallRow> calls;
        CallCounts baseline;
        List<BookingRow> bookings;
        List<PromptVersionRow> versions;
        Long stuckMembers;
    }

    private EngagementDiagnosis build(String instituteId, String engineId, String view,
                                      EngagementReportDay.Period period, LocalDate today, ZoneId zone, boolean fresh) {
        boolean weekly = EngagementDiagnosisRules.WEEKLY.equals(view);
        Map<String, String> errors = new LinkedHashMap<>();
        EngagementDailyReport report;
        try {
            // Never as a super admin: nothing here shows real money, and this shares the admins' cached copy.
            report = reportService.daily(instituteId, engineId, null, period.from().toString(),
                    period.to().toString(), false, fresh);
        } catch (InvalidRequestException | ResourceNotFoundException e) {
            throw e;
        } catch (RuntimeException e) {
            log.warn("[EngagementDiagnosis] daily report failed for institute {}: {}", instituteId, e.getMessage());
            errors.put(REPORT, UNAVAILABLE);
            return unavailable(view, period, zone, engineId, weekly, errors);
        }
        report.errors().forEach((section, value) -> {
            if (REPORT_SECTIONS.contains(section)) errors.put(section, value);
        });
        List<String> engineIds = report.engines().stream().map(EngagementDailyReport.EngineOption::id)
                .filter(id -> engineId == null || id.equals(engineId)).toList();
        Window w = EngagementDailyReportService.window(period.from(), period.to(), today, zone);
        Loaded d = new Loaded();
        if (engineIds.isEmpty()) {
            // No engines: nothing went out, nothing is missing.
            d.leads = List.of();
            d.agents = List.of();
            d.actions = List.of();
            d.signals = new Signals(false, Map.of());
            d.calls = List.of();
            d.bookings = List.of();
            d.versions = List.of();
            d.stuckMembers = 0L;
        } else {
            load(d, report, instituteId, engineIds, w, weekly, errors);
        }
        return assemble(d, report, view, weekly, engineId, w, errors);
    }

    // ── loading ──────────────────────────────────────────────────────────────

    private void load(Loaded d, EngagementDailyReport report, String instituteId, List<String> engineIds, Window w,
                      boolean weekly, Map<String, String> errors) {
        MapSqlParameterSource p = EngagementDailyReportService.params(instituteId, engineIds, w,
                EngagementDailyReportService.connectedCsv(leadReportSettings.get(instituteId)));

        section("leadDetails", errors, () -> inTx(() -> {
            d.leads = dao.leads(p);
            return null;
        }));
        section("leadAgents", errors, () -> inTx(() -> {
            d.agents = agents(report, p, w);
            return null;
        }));
        section("actions", errors, () -> inTx(() -> {
            LocalDateTime lookback = w.from().minusHours(SIGNAL_LOOKBACK_HOURS);
            d.actions = dao.actions(p, lookback, w.to());
            return null;
        }));
        section("callDetails", errors, () -> inTx(() -> {
            d.calls = dao.calls(p);
            return null;
        }));
        if (needsBaseline(report)) {
            section("callBaseline", errors, () -> inTx(() -> {
                d.baseline = baseline(p, w);
                return null;
            }));
        }
        if (weekly) {
            section("demos", errors, () -> inTx(() -> {
                d.bookings = dao.bookings(p);
                return null;
            }));
            section("stuckMembers", errors, () -> inTx(() -> {
                MapSqlParameterSource q = new MapSqlParameterSource(p.getValues()).addValue("stuckBefore",
                        LocalDateTime.now(ZoneOffset.UTC).minusHours(EngagementDiagnosisRules.MEMBERS_STUCK_HOURS),
                        Types.TIMESTAMP);
                d.stuckMembers = dao.stuckMembers(q);
                return null;
            }));
            if (d.actions != null) {
                section("promptChanges", errors, () -> inTx(() -> {
                    d.versions = promptVersions(d.actions, p, w);
                    return null;
                }));
            }
        }
        loadSignals(d, instituteId, errors);
    }

    /** The agents of the report's lists, with their counters over the period. */
    private List<AgentFact> agents(EngagementDailyReport report, MapSqlParameterSource p, Window w) {
        List<String> listIds = report.lists().stream()
                .filter(l -> "LIST".equals(l.kind()) && l.listId() != null)
                .map(EngagementDailyReport.ListRow::listId)
                .distinct()
                .toList();
        if (listIds.isEmpty()) return List.of();
        MapSqlParameterSource q = new MapSqlParameterSource(p.getValues()).addValue("listIds", listIds);
        List<AgentRow> agents = dao.leadAgents(q);
        List<AgentDay> days = agents.isEmpty() ? List.of() : reportDao.leadAgentDays(q);
        return EngagementDiagnosisRules.agentFacts(agents, days, w, Instant.now());
    }

    /** The baseline only matters past the rule's own minimum of calls. */
    private static boolean needsBaseline(EngagementDailyReport report) {
        EngagementDailyReport.Calls c = report.calls();
        return !report.errors().containsKey("calls")
                && callCounts(c).finished() >= EngagementDiagnosisRules.CONNECT_MIN_PLACED;
    }

    /** The report's own call read over the 7 days before the period, so both rates count the same calls. */
    private CallCounts baseline(MapSqlParameterSource p, Window w) {
        LocalDateTime from = LocalDateTime.ofInstant(
                w.fromDay().minusDays(EngagementDiagnosisRules.CONNECT_BASELINE_DAYS).atStartOfDay(w.zone()).toInstant(),
                ZoneOffset.UTC);
        MapSqlParameterSource q = new MapSqlParameterSource(p.getValues())
                .addValue("dataFrom", from, Types.TIMESTAMP)
                .addValue("to", w.from(), Types.TIMESTAMP);
        long queued = 0, notDialled = 0, inProgress = 0, connected = 0;
        for (CallDay c : reportDao.calls(q)) {
            queued += c.placed();
            notDialled += c.notDialled();
            inProgress += c.inProgress();
            connected += c.connected();
        }
        return new CallCounts(queued, notDialled, inProgress, connected);
    }

    private List<PromptVersionRow> promptVersions(List<ActionRow> actions, MapSqlParameterSource p, Window w) {
        Set<String> ids = EngagementDiagnosisRules.promptVersionIds(actions, w);
        if (ids.isEmpty()) return List.of();
        return dao.promptVersions(new MapSqlParameterSource(p.getValues()).addValue("versionIds", List.copyOf(ids)));
    }

    /**
     * Delivery and replies of the messages read: the same call as the daily report's, over a range that
     * reaches further back. When the report itself could not read them they are unknown here too.
     */
    private void loadSignals(Loaded d, String instituteId, Map<String, String> errors) {
        if (d.actions == null || errors.containsKey(DELIVERY)) return;
        List<String> ids = EngagementDiagnosisRules.signalIds(d.actions);
        if (ids.size() > EngagementDailyReportService.MAX_SIGNAL_ACTIONS) {
            log.warn("[EngagementDiagnosis] {} messages for institute {}: delivery skipped (cap {})",
                    ids.size(), instituteId, EngagementDailyReportService.MAX_SIGNAL_ACTIONS);
            errors.put(DELIVERY, EngagementDailyReportService.TOO_MANY);
            errors.put(REPLIES, EngagementDailyReportService.TOO_MANY);
            return;
        }
        try {
            d.signals = ids.isEmpty() ? new Signals(false, Map.of())
                    : signalsClient.fetch(instituteId, ids, EngagementDailyReportService.REPLY_WINDOW_HOURS);
        } catch (Exception e) {
            log.warn("[EngagementDiagnosis] signals failed for institute {}: {}", instituteId, e.getMessage());
            errors.put(DELIVERY, UNAVAILABLE);
            errors.put(REPLIES, UNAVAILABLE);
        }
    }

    private void section(String name, Map<String, String> errors, Runnable body) {
        try {
            body.run();
        } catch (Exception e) {
            log.warn("[EngagementDiagnosis] section {} failed: {}", name, e.getMessage());
            errors.put(name, UNAVAILABLE);
        }
    }

    private <T> T inTx(Supplier<T> body) {
        return readOnlyTx.execute(status -> {
            jdbc.getJdbcTemplate().execute(STATEMENT_TIMEOUT);
            return body.get();
        });
    }

    // ── assembly ─────────────────────────────────────────────────────────────

    private EngagementDiagnosis assemble(Loaded d, EngagementDailyReport report, String view, boolean weekly,
                                         String engineId, Window w, Map<String, String> errors) {
        boolean signalsOk = d.signals != null;
        Map<String, Signal> signals = signalsOk ? d.signals.byActionId() : Map.of();
        boolean inbound = signalsOk && d.signals.inboundEmailEnabled();
        Set<String> unreachable = signalsOk ? d.signals.unreachableSenders() : Set.of();
        // As in the report: only its messages take part in crediting a reply to a send.
        Map<String, Long> replies = signalsOk ? replies(d.actions, signals) : null;
        boolean deliveryRead = !errors.containsKey(DELIVERY) && !errors.containsKey("outreach");

        List<WhatsAppFailureRow> failures = signalsOk
                ? EngagementDiagnosisRules.whatsappFailures(d.actions, signals, w) : List.of();
        List<WhatsAppTemplateRow> templates = deliveryRead
                ? EngagementDiagnosisRules.whatsappTemplates(report.templates()) : List.of();
        EmailSubjects subjects = signalsOk
                ? EngagementDiagnosisRules.emailSubjects(d.actions, signals, replies, inbound, unreachable, w)
                : new EmailSubjects(List.of(), null);
        CallDetails callDetails = d.calls == null ? null : EngagementDiagnosisRules.callDetails(d.calls);
        DoubleContact doubleContact = d.actions == null ? null : EngagementDiagnosisRules.doubleContact(d.actions, w);
        Long sentAfterReply = signalsOk ? (Long) EngagementDiagnosisRules.sentAfterReply(d.actions, signals, w) : null;
        List<LeadSourceRow> sources = weekly ? leadSources(d, replies, signals, inbound, unreachable, w) : List.of();

        Facts facts = new Facts(
                new LeadFacts(d.leads == null ? null
                        : EngagementDiagnosisRules.contactCounts(d.leads, placeholderEmailService::isPlaceholder),
                        d.agents, sources),
                new CallFacts(errors.containsKey("calls") ? null : callCounts(report.calls()), d.baseline, callDetails),
                new WhatsAppFacts(whatsappCounts(report, d, failures, signalsOk, deliveryRead, w), templates,
                        EngagementDiagnosisRules.rate(report.whatsapp().replied(), report.whatsapp().sent())),
                new EmailFacts(deliveryRead ? emailCounts(report) : null, subjects.rows(), subjects.channelRate()),
                new EngineFacts(errors.containsKey("runs") ? null : runCounts(report), doubleContact, sentAfterReply,
                        errors.containsKey("creditBalance") ? null : report.summary().creditRunwayDays(),
                        d.stuckMembers));
        Outcome outcome = EngagementDiagnosisRules.evaluate(view, facts,
                EngagementDiagnosisRules.unavailableStages(view, errors.keySet()));

        Weekly weeklyBlock = !weekly ? null : new Weekly(minimums(), sources,
                callDetails == null ? List.of() : callDetails.hours(),
                callDetails == null ? null : callDetails.lengths(),
                callDetails == null ? null : callDetails.insights(),
                failures, templates, subjects.rows(),
                promptChanges(d, signals, replies, inbound, unreachable, w),
                new EngineChecks(doubleContact == null ? null : (Long) doubleContact.people(), sentAfterReply,
                        d.stuckMembers));

        return new EngagementDiagnosis(view, w.fromDay().toString(), w.toDay().toString(), w.days(), w.zone().getId(),
                engineId, Instant.now().toString(), outcome.problems(), outcome.moreProblems(), outcome.stages(),
                dataGaps(d, report, signals, inbound, unreachable, deliveryRead, callDetails, w), weeklyBlock, errors);
    }

    /** The report's rule for crediting a reply to one message, over the messages it counts. */
    private static Map<String, Long> replies(List<ActionRow> actions, Map<String, Signal> signals) {
        Map<String, Signal> attributable = new HashMap<>();
        for (ActionRow a : actions) {
            Signal g = signals.get(a.id());
            if (g != null && a.sent() && a.reportSend()) attributable.put(a.id(), g);
        }
        return EngagementDailyReportService.attributeReplies(attributable);
    }

    private static CallCounts callCounts(EngagementDailyReport.Calls c) {
        return new CallCounts(c.placed(), c.notDialled(), c.inProgress(), c.connected());
    }

    private static WhatsAppCounts whatsappCounts(EngagementDailyReport report, Loaded d,
                                                 List<WhatsAppFailureRow> failures, boolean signalsOk,
                                                 boolean deliveryRead, Window w) {
        if (!signalsOk || !deliveryRead) return null;
        // The report's failed includes the sends rejected at dispatch, its sent does not (as in its banner).
        long tried = report.whatsapp().sent() + EngagementDiagnosisRules.whatsappRejected(d.actions, w);
        return new WhatsAppCounts(tried, report.whatsapp().failed(), EngagementDiagnosisRules.failureReasons(failures));
    }

    private static EmailCounts emailCounts(EngagementDailyReport report) {
        EngagementDailyReport.Email e = report.email();
        return new EmailCounts(e.sent(), e.bounced(), e.complained(), e.bounceRate(), e.tracked());
    }

    private static RunCounts runCounts(EngagementDailyReport report) {
        return new RunCounts(report.runs().decisions(), report.runs().failed(), report.runs().topErrors().stream()
                .map(e -> new BreakdownRow(e.message(), e.count())).toList());
    }

    private static List<LeadSourceRow> leadSources(Loaded d, Map<String, Long> replies, Map<String, Signal> signals,
                                                   boolean inbound, Set<String> unreachable, Window w) {
        if (d.leads == null) return List.of();
        Set<String> contacted = d.actions == null || d.calls == null ? null
                : EngagementDiagnosisRules.contactedPeople(d.actions, d.calls, w);
        Set<String> responded = replies == null || d.calls == null
                || !EngagementDiagnosisRules.responsesVisible(d.actions, d.calls, signals, inbound, unreachable, w)
                ? null : EngagementDiagnosisRules.respondedPeople(d.actions, replies, d.calls, w);
        return EngagementDiagnosisRules.leadSources(d.leads, contacted, responded, d.bookings);
    }

    private static List<PromptChangeRow> promptChanges(Loaded d, Map<String, Signal> signals, Map<String, Long> replies,
                                                       boolean inbound, Set<String> unreachable, Window w) {
        if (d.versions == null || d.actions == null) return List.of();
        return EngagementDiagnosisRules.promptChanges(d.versions, d.actions, signals, replies, inbound, unreachable,
                d.bookings, w);
    }

    private static Minimums minimums() {
        return new Minimums(EngagementDiagnosisRules.MIN_LEADS_PER_SOURCE, EngagementDiagnosisRules.MIN_CALLS_PER_HOUR,
                EngagementDiagnosisRules.MIN_SENDS_PER_ROW);
    }

    private static List<DataGap> dataGaps(Loaded d, EngagementDailyReport report, Map<String, Signal> signals,
                                          boolean inbound, Set<String> unreachable, boolean deliveryRead,
                                          CallDetails callDetails, Window w) {
        List<DataGap> gaps = new ArrayList<>();
        if (d.signals != null) {
            DataGap replies = EngagementDiagnosisRules.repliesGap(d.actions, signals, inbound, unreachable, w);
            if (replies != null) gaps.add(replies);
        }
        if (deliveryRead) {
            if (report.email().sent() > 0 && !report.email().tracked()) {
                gaps.add(new DataGap("EMAIL_TRACKING_OFF", List.of()));
            }
            if (report.whatsapp().sent() > 0 && !report.whatsapp().deliveryTracked()) {
                gaps.add(new DataGap("WHATSAPP_TRACKING_OFF", List.of()));
            }
        }
        if (callDetails != null && callDetails.lengths().connected() > 0 && callDetails.insights().analysed() == 0) {
            gaps.add(new DataGap("CALL_ANALYSIS_EMPTY", List.of()));
        }
        return gaps;
    }

    /** The daily report itself could not be read: nothing can be judged. */
    private static EngagementDiagnosis unavailable(String view, EngagementReportDay.Period period, ZoneId zone,
                                                   String engineId, boolean weekly, Map<String, String> errors) {
        List<StageStatus> stages = EngagementDiagnosisRules.STAGES.stream()
                .map(s -> new StageStatus(s, EngagementDiagnosisRules.UNAVAILABLE)).toList();
        Weekly block = !weekly ? null : new Weekly(minimums(), List.of(), List.of(), null, null, List.of(), List.of(),
                List.of(), List.of(), new EngineChecks(null, null, null));
        return new EngagementDiagnosis(view, period.from().toString(), period.to().toString(), period.days(),
                zone.getId(), engineId, Instant.now().toString(), List.of(), 0, stages, List.of(), block, errors);
    }
}
