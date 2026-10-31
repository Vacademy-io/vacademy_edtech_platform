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
import vacademy.io.admin_core_service.features.engagement.report.EngagementDailyReport.*;
import vacademy.io.admin_core_service.features.engagement.report.EngagementDailyReportDao.AgentDay;
import vacademy.io.admin_core_service.features.engagement.report.EngagementDailyReportDao.AgentInfo;
import vacademy.io.admin_core_service.features.engagement.report.EngagementDailyReportDao.Balance;
import vacademy.io.admin_core_service.features.engagement.report.EngagementDailyReportDao.Booking;
import vacademy.io.admin_core_service.features.engagement.report.EngagementDailyReportDao.CallDay;
import vacademy.io.admin_core_service.features.engagement.report.EngagementDailyReportDao.Conversion;
import vacademy.io.admin_core_service.features.engagement.report.EngagementDailyReportDao.Engine;
import vacademy.io.admin_core_service.features.engagement.report.EngagementDailyReportDao.ErrorRow;
import vacademy.io.admin_core_service.features.engagement.report.EngagementDailyReportDao.ListSelector;
import vacademy.io.admin_core_service.features.engagement.report.EngagementDailyReportDao.MemberBucket;
import vacademy.io.admin_core_service.features.engagement.report.EngagementDailyReportDao.MembersAdded;
import vacademy.io.admin_core_service.features.engagement.report.EngagementDailyReportDao.MessageCredit;
import vacademy.io.admin_core_service.features.engagement.report.EngagementDailyReportDao.Run;
import vacademy.io.admin_core_service.features.engagement.report.EngagementDailyReportDao.Send;
import vacademy.io.admin_core_service.features.engagement.report.EngagementDailyReportDao.StatusChangeRow;
import vacademy.io.admin_core_service.features.engagement.report.EngagementReportSignalsClient.Signal;
import vacademy.io.admin_core_service.features.engagement.report.EngagementReportSignalsClient.Signals;
import vacademy.io.admin_core_service.features.institute.service.InstituteTimezoneService;
import vacademy.io.admin_core_service.features.live_session.util.TimezoneNormalizer;
import vacademy.io.common.exceptions.InvalidRequestException;
import vacademy.io.common.exceptions.ResourceNotFoundException;

import java.time.DateTimeException;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.function.Supplier;

/**
 * Engagement daily report: what an engine (or every engine) did in a period of institute-local
 * days (one day by default), what it cost and what came back (design §3, v3 for the period). Each
 * section runs in its own read-only transaction (replica) with a statement timeout, as the group
 * dashboards do; a section that fails is named in {@code errors} and the rest still renders.
 * Delivery, replies and WhatsApp pricing come from notification_service in chunked calls. A
 * complete report is cached for {@link #CACHE_TTL} per institute, engine, period and viewer class
 * (super admins also get real money).
 */
@Slf4j
@Service
public class EngagementDailyReportService {

    static final Duration CACHE_TTL = Duration.ofMinutes(3);
    /** The trend shows at least this many days (ending the period's last). */
    static final int TREND_DAYS = 7;
    /**
     * Most messages one report reads delivery for. Past it (a long period of a busy institute) the
     * delivery and reply numbers are skipped as "too_many" rather than left to time out.
     */
    static final int MAX_SIGNAL_ACTIONS = 20_000;
    /** errors value when there were more than {@link #MAX_SIGNAL_ACTIONS} messages to read. */
    static final String TOO_MANY = "too_many";
    /** errors key of the previous period's own reads (its sends, leads added and conversions). */
    static final String PREVIOUS = "previous";
    /** A reply counts for a message when it arrives within this long after it (design D7). */
    static final int REPLY_WINDOW_HOURS = 72;
    /** A message goes out within hours of its draft; this bounds the send scan to the engine index. */
    static final Duration SEND_SCAN_SLACK = Duration.ofDays(15);
    static final int MAX_TEMPLATE_ROWS = 200;
    /** Name of the per-channel row that sums the templates past {@link #MAX_TEMPLATE_ROWS}. */
    static final String OTHER_TEMPLATES = "(other)";
    /** errors key when the WhatsApp rate card cannot be read (the amount is then unknown, not 0). */
    static final String WHATSAPP_COST = "whatsappCost";
    private static final String STATEMENT_TIMEOUT = "SET LOCAL statement_timeout = '8s'";
    private static final String DEFAULT_CURRENCY = "INR";

    private final EngagementDailyReportDao dao;
    private final NamedParameterJdbcTemplate jdbc;
    private final TransactionTemplate readOnlyTx;
    private final InstituteTimezoneService timezoneService;
    private final LeadReportSettingService leadReportSettings;
    private final EngagementReportSignalsClient signalsClient;
    private final WhatsAppRateCardService rateCard;
    private final Cache<String, EngagementDailyReport> cache = Caffeine.newBuilder()
            .expireAfterWrite(CACHE_TTL)
            .maximumSize(500)
            .build();

    public EngagementDailyReportService(EngagementDailyReportDao dao,
                                        NamedParameterJdbcTemplate jdbc,
                                        PlatformTransactionManager transactionManager,
                                        InstituteTimezoneService timezoneService,
                                        LeadReportSettingService leadReportSettings,
                                        EngagementReportSignalsClient signalsClient,
                                        WhatsAppRateCardService rateCard) {
        this.dao = dao;
        this.jdbc = jdbc;
        this.readOnlyTx = new TransactionTemplate(transactionManager);
        this.readOnlyTx.setReadOnly(true);
        this.timezoneService = timezoneService;
        this.leadReportSettings = leadReportSettings;
        this.signalsClient = signalsClient;
        this.rateCard = rateCard;
    }

    /**
     * @param engineId null or blank = every engine of the institute
     * @param date     YYYY-MM-DD in the institute's zone, the same as from = to = date
     * @param from     with to: the period, YYYY-MM-DD inclusive (wins over date); neither = today there
     * @throws InvalidRequestException  a bad format, from after to, a future day, a day before
     *                                   today − 89, or only one of from / to
     * @throws ResourceNotFoundException the engine is not one of this institute's
     */
    public EngagementDailyReport daily(String instituteId, String engineId, String date, String from, String to,
                                       boolean superAdmin) {
        ZoneId zone = zone(timezoneService.getTimezoneId(instituteId));
        LocalDate today = LocalDate.now(zone);
        EngagementReportDay.Period period = EngagementReportDay.period(date, from, to, today);
        if (period == null) period = EngagementReportDay.Period.of(today);
        String engine = engineId == null || engineId.isBlank() ? null : engineId.trim();
        String key = String.join("|", instituteId, engine == null ? "*" : engine, period.from().toString(),
                period.to().toString(), zone.getId(), superAdmin ? "sa" : "admin");
        EngagementDailyReport cached = cache.getIfPresent(key);
        if (cached != null) return cached;
        EngagementDailyReport report = build(instituteId, engine, period, today, zone, superAdmin);
        if (cacheable(report.errors())) cache.put(key, report);
        return report;
    }

    /** Complete, or only short of what it will never read (too many messages): same answer next time. */
    static boolean cacheable(Map<String, String> errors) {
        return errors.values().stream().allMatch(TOO_MANY::equals);
    }

    // ── window ───────────────────────────────────────────────────────────────

    /**
     * The period [fromDay, toDay] and the ranges around it, as naive UTC bounds (the engagement
     * tables' storage). from / to = start of fromDay / of the day after toDay.
     * <ul>
     *   <li>trendFromDay: the trend's first day, fromDay or 6 days before toDay when the period is
     *   shorter than {@link #TREND_DAYS}.</li>
     *   <li>prevFromDay .. fromDay − 1: the equal-length period before (the KPI deltas); prevFrom
     *   is its start.</li>
     *   <li>dataFromDay / dataFrom: where the per-day reads start, the earlier of the two above.</li>
     *   <li>signalsFrom = start of the trend − the reply window: the sends whose delivery and
     *   replies the period and the trend need (a reply on a day belongs to a message sent at most
     *   that long before it). sendsFrom = dataFrom − the reply window does the same for the
     *   previous period, read separately (its sends are [sendsFrom, signalsFrom)).</li>
     * </ul>
     */
    record Window(LocalDate fromDay, LocalDate toDay, ZoneId zone, LocalDateTime from, LocalDateTime to,
                  LocalDate trendFromDay, LocalDate prevFromDay, LocalDateTime prevFrom,
                  LocalDate dataFromDay, LocalDateTime dataFrom, LocalDateTime signalsFrom,
                  LocalDateTime sendsFrom, LocalDateTime trackedLookback) {

        int days() {
            return (int) ChronoUnit.DAYS.between(fromDay, toDay) + 1;
        }

        LocalDate prevToDay() {
            return fromDay.minusDays(1);
        }

        LocalDate localDay(LocalDateTime utc) {
            return utc == null ? null : utc.atOffset(ZoneOffset.UTC).atZoneSameInstant(zone).toLocalDate();
        }

        LocalDate localDay(Long epochMs) {
            return epochMs == null ? null : Instant.ofEpochMilli(epochMs).atZone(zone).toLocalDate();
        }

        boolean inPeriod(LocalDate d) {
            return d != null && !d.isBefore(fromDay) && !d.isAfter(toDay);
        }

        boolean inPrevious(LocalDate d) {
            return d != null && !d.isBefore(prevFromDay) && d.isBefore(fromDay);
        }

        boolean inTrend(LocalDate d) {
            return d != null && !d.isBefore(trendFromDay) && !d.isAfter(toDay);
        }

        /** The previous period's sends are not all in the first sends read (a period of 4+ days). */
        boolean previousBeforeTrend() {
            return prevFromDay.isBefore(trendFromDay);
        }
    }

    static Window window(LocalDate fromDay, LocalDate toDay, LocalDate today, ZoneId zone) {
        long days = ChronoUnit.DAYS.between(fromDay, toDay) + 1;
        LocalDate shortTrend = toDay.minusDays(TREND_DAYS - 1L);
        LocalDate trendFromDay = shortTrend.isBefore(fromDay) ? shortTrend : fromDay;
        LocalDate prevFromDay = fromDay.minusDays(days);
        LocalDate dataFromDay = prevFromDay.isBefore(trendFromDay) ? prevFromDay : trendFromDay;
        Duration replyWindow = Duration.ofHours(REPLY_WINDOW_HOURS);
        Instant dataFrom = dataFromDay.atStartOfDay(zone).toInstant();
        return new Window(fromDay, toDay, zone,
                utc(fromDay.atStartOfDay(zone).toInstant()),
                utc(toDay.plusDays(1).atStartOfDay(zone).toInstant()),
                trendFromDay,
                prevFromDay,
                utc(prevFromDay.atStartOfDay(zone).toInstant()),
                dataFromDay,
                utc(dataFrom),
                utc(trendFromDay.atStartOfDay(zone).toInstant().minus(replyWindow)),
                utc(dataFrom.minus(replyWindow)),
                utc(EngagementReportDay.earliest(today).atStartOfDay(zone).toInstant()));
    }

    /**
     * The institute's zone in a form Postgres accepts (it goes into {@code AT TIME ZONE :tz}):
     * legacy aliases such as Asia/Calcutta are rewritten, and bare offsets fall back to the default
     * (Postgres reads "+05:30" with the POSIX sign, the opposite of Java).
     */
    static ZoneId zone(String tz) {
        String name = TimezoneNormalizer.normalize(tz);
        if (!name.contains("/") && !"UTC".equals(name)) name = TimezoneNormalizer.DEFAULT_TIMEZONE;
        try {
            return ZoneId.of(name);
        } catch (DateTimeException e) {
            return ZoneId.of(TimezoneNormalizer.DEFAULT_TIMEZONE);
        }
    }

    private static LocalDateTime utc(Instant i) {
        return LocalDateTime.ofInstant(i, ZoneOffset.UTC);
    }

    private static MapSqlParameterSource params(String instituteId, List<String> engineIds, Window w, String connectedCsv) {
        return new MapSqlParameterSource()
                .addValue("instituteId", instituteId)
                .addValue("engineIds", engineIds)
                .addValue("tz", w.zone().getId())
                .addValue("toDay", w.toDay().toString())
                .addValue("dataFromDay", w.dataFromDay().toString())
                .addValue("from", w.from(), java.sql.Types.TIMESTAMP)
                .addValue("to", w.to(), java.sql.Types.TIMESTAMP)
                .addValue("prevFrom", w.prevFrom(), java.sql.Types.TIMESTAMP)
                .addValue("dataFrom", w.dataFrom(), java.sql.Types.TIMESTAMP)
                .addValue("trackedLookback", w.trackedLookback(), java.sql.Types.TIMESTAMP)
                .addValue("connectedCsv", connectedCsv);
    }

    private static String connectedCsv(LeadReportSettingService.ReportSettings settings) {
        Set<String> statuses = settings != null ? settings.connectedCallStatuses() : null;
        if (statuses == null || statuses.isEmpty()) return "COMPLETED";
        return String.join(",", statuses);
    }

    // ── loading ──────────────────────────────────────────────────────────────

    /** Everything read for one report; a section that failed leaves its defaults (empty). */
    private static final class Data {
        List<ListSelector> selectors = List.of();
        MembersAdded members = MembersAdded.NONE;
        List<AgentInfo> agents = List.of();
        List<AgentDay> agentDays = List.of();
        List<Run> runs = List.of();
        List<ErrorRow> topErrors = List.of();
        LocalDateTime aiTrackedSince;
        /** Sends of [signalsFrom, to): the period, the trend and the reply lookback. */
        List<Send> sends = List.of();
        boolean sendsLoaded;
        /** Sends of [sendsFrom, signalsFrom): the rest of the previous period and its lookback. */
        List<Send> previousSends = List.of();
        boolean previousSendsLoaded;
        /** null when the previous period's leads added and conversions could not be read. */
        EngagementDailyReportDao.PreviousTotals previous;
        Signals signals;
        /** Delivery and replies were read for previousSends too. */
        boolean previousSignals;
        List<CallDay> calls = List.of();
        List<MessageCredit> messageCredits = List.of();
        Balance balance;
        List<StatusChangeRow> statusChanges = List.of();
        /** null when the section failed: the report then sends newTemplates: null, not zeros. */
        List<EngagementDailyReportDao.NewTemplateRow> newTemplates;
        List<Conversion> conversions = List.of();
        List<Booking> bookings = List.of();
    }

    private EngagementDailyReport build(String instituteId, String engineId, EngagementReportDay.Period period,
                                        LocalDate today, ZoneId zone, boolean superAdmin) {
        List<Engine> engines = inTx(() -> dao.engines(instituteId));
        if (engineId != null && engines.stream().noneMatch(e -> e.id().equals(engineId))) {
            throw new ResourceNotFoundException("Engagement engine not found: " + engineId);
        }
        List<Engine> scope = engineId == null ? engines
                : engines.stream().filter(e -> e.id().equals(engineId)).toList();
        List<String> engineIds = scope.stream().map(Engine::id).toList();

        Window w = window(period.from(), period.to(), today, zone);
        Map<String, String> errors = new LinkedHashMap<>();
        Data d = new Data();
        if (!engineIds.isEmpty()) {
            load(d, instituteId, engineId, scope, w, errors);
        } else {
            // No engines: nothing went out, nothing is missing.
            d.signals = new Signals(false, Map.of());
            d.previousSignals = true;
            d.sendsLoaded = d.previousSendsLoaded = true;
            d.previous = new EngagementDailyReportDao.PreviousTotals(0, 0);
        }
        return assemble(d, engines, scope, engineId, w, superAdmin, errors);
    }

    private void load(Data d, String instituteId, String engineId, List<Engine> scope, Window w,
                      Map<String, String> errors) {
        List<String> engineIds = scope.stream().map(Engine::id).toList();
        MapSqlParameterSource p = params(instituteId, engineIds, w,
                connectedCsv(leadReportSettings.get(instituteId)));

        section("lists", errors, () -> inTx(() -> {
            d.selectors = dao.listSelectors(p);
            d.members = dao.membersAdded(p);
            Set<String> listIds = new HashSet<>();
            relevantSelectors(d.selectors, scope, engineId).forEach(s -> listIds.add(s.listId()));
            d.members.byList().stream().filter(b -> b.listId() != null).forEach(b -> listIds.add(b.listId()));
            listIds.remove(null);
            if (!listIds.isEmpty()) {
                p.addValue("listIds", List.copyOf(listIds));
                d.agents = dao.leadAgents(p);
                d.agentDays = d.agents.isEmpty() ? List.of() : dao.leadAgentDays(p);
            }
            return null;
        }));
        section("runs", errors, () -> inTx(() -> {
            d.runs = dao.runs(p);
            d.topErrors = dao.topErrors(p);
            d.aiTrackedSince = dao.aiTrackedSince(p);
            return null;
        }));
        section("outreach", errors, () -> inTx(() -> {
            d.sends = dao.sends(p, w.signalsFrom(), w.to());
            d.sendsLoaded = true;
            return null;
        }));
        // The previous period, for the KPI deltas: its own section so a slow read of a long period
        // costs the deltas only, never the period's numbers.
        section(PREVIOUS, errors, () -> inTx(() -> {
            d.previous = dao.previous(p);
            if (w.previousBeforeTrend()) d.previousSends = dao.sends(p, w.sendsFrom(), w.signalsFrom());
            d.previousSendsLoaded = true;
            return null;
        }));
        section("calls", errors, () -> inTx(() -> {
            d.calls = dao.calls(p);
            return null;
        }));
        section("costs", errors, () -> inTx(() -> {
            d.messageCredits = dao.messageCredits(p);
            return null;
        }));
        section("creditBalance", errors, () -> inTx(() -> {
            d.balance = dao.balance(p);
            return null;
        }));
        section("statusChanges", errors, () -> inTx(() -> {
            d.statusChanges = dao.statusChanges(p);
            return null;
        }));
        section("conversions", errors, () -> inTx(() -> {
            d.conversions = dao.conversions(p);
            return null;
        }));
        section("newTemplates", errors, () -> inTx(() -> {
            d.newTemplates = dao.newTemplates(p);
            return null;
        }));
        section("demos", errors, () -> inTx(() -> {
            d.bookings = dao.bookings(p);
            return null;
        }));

        // Delivery and replies: every WhatsApp / email message that went out in the signals range,
        // and the previous period's when they fit under the cap.
        if (!d.sendsLoaded) {
            errors.put("delivery", "unavailable");
            errors.put("replies", "unavailable");
            return;
        }
        List<String> ids = signalIds(d.sends);
        if (ids.size() > MAX_SIGNAL_ACTIONS) {
            log.warn("[EngagementReport] {} messages in {}..{} for institute {}: delivery skipped (cap {})",
                    ids.size(), w.fromDay(), w.toDay(), instituteId, MAX_SIGNAL_ACTIONS);
            errors.put("delivery", TOO_MANY);
            errors.put("replies", TOO_MANY);
            return;
        }
        List<String> previousIds = signalIds(d.previousSends);
        boolean withPrevious = d.previousSendsLoaded && ids.size() + previousIds.size() <= MAX_SIGNAL_ACTIONS;
        if (withPrevious && !previousIds.isEmpty()) {
            List<String> all = new ArrayList<>(previousIds);   // both in send order, previous first
            all.addAll(ids);
            ids = all;
        }
        try {
            d.signals = ids.isEmpty() ? new Signals(false, Map.of())
                    : signalsClient.fetch(instituteId, ids, REPLY_WINDOW_HOURS);
            d.previousSignals = withPrevious;
        } catch (Exception e) {
            log.warn("[EngagementReport] signals failed for institute {}: {}", instituteId, e.getMessage());
            errors.put("delivery", "unavailable");
            errors.put("replies", "unavailable");
        }
    }

    /**
     * The messages notification_service has delivery data for (sent WhatsApp / email), in send
     * order: each chunk of the signals call then spans a short stretch of time, which keeps its
     * inbound-reply read narrow on a long period.
     */
    static List<String> signalIds(List<Send> sends) {
        return sends.stream()
                .filter(s -> "SENT".equals(s.status())
                        && ("WHATSAPP".equals(s.channel()) || "EMAIL".equals(s.channel())))
                .sorted(Comparator.comparing(Send::dispatchedAt, Comparator.nullsFirst(Comparator.naturalOrder()))
                        .thenComparing(Send::id))
                .map(Send::id)
                .toList();
    }

    /**
     * Lists an engine targets count even in a period they added no one. For "All", an archived
     * engine's lists are left out unless they added people in the period (the member buckets).
     */
    private static List<ListSelector> relevantSelectors(List<ListSelector> selectors, List<Engine> scope,
                                                        String engineId) {
        if (engineId != null) return selectors;
        Set<String> archived = new HashSet<>();
        scope.stream().filter(e -> "ARCHIVED".equals(e.status())).forEach(e -> archived.add(e.id()));
        return selectors.stream().filter(s -> !archived.contains(s.engineId())).toList();
    }

    private void section(String name, Map<String, String> errors, Runnable body) {
        try {
            body.run();
        } catch (Exception e) {
            log.warn("[EngagementReport] section {} failed: {}", name, e.getMessage());
            errors.put(name, "unavailable");
        }
    }

    private <T> T inTx(Supplier<T> body) {
        return readOnlyTx.execute(status -> {
            jdbc.getJdbcTemplate().execute(STATEMENT_TIMEOUT);
            return body.get();
        });
    }

    // ── assembly ─────────────────────────────────────────────────────────────

    /** Per-engine running totals for the "All engines" table. */
    private static final class EngineAcc {
        long leadsAdded, sent, replies, cohortReplied, decisions, demosBooked;
        final Set<String> conversions = new HashSet<>();
        double credits;
    }

    private static final class ChannelAcc {
        long sent, delivered, read, replied, failed;
        double credits;
    }

    private static final class TemplateAcc {
        final String channel, name;
        long sent, delivered, read, replied, bounced;
        double cost;

        TemplateAcc(String channel, String name) {
            this.channel = channel;
            this.name = name;
        }

        void add(TemplateAcc o) {
            sent += o.sent;
            delivered += o.delivered;
            read += o.read;
            replied += o.replied;
            bounced += o.bounced;
            cost += o.cost;
        }

        TemplateRow row(String currency) {
            return new TemplateRow(channel, name, sent, delivered, read, replied, rate(replied, sent), bounced,
                    round4(cost), currency);
        }
    }

    private static final class ListAcc {
        final String listId, kind;
        String name;
        long leadsAdded, newLeads;

        ListAcc(String listId, String kind, String name) {
            this.listId = listId;
            this.kind = kind;
            this.name = name;
        }
    }

    private static final class TrendAcc {
        long sent, replies, demosBooked, statusChanges;
        double credits;
    }

    private static final class CategoryAcc {
        final String category;
        final double rate;
        final boolean estimated;
        long count;
        double cost;

        CategoryAcc(String category, double rate, boolean estimated) {
            this.category = category;
            this.rate = rate;
            this.estimated = estimated;
        }
    }

    private EngagementDailyReport assemble(Data d, List<Engine> engines, List<Engine> scope, String engineId,
                                           Window w, boolean superAdmin, Map<String, String> errors) {
        Map<String, EngineAcc> perEngine = new LinkedHashMap<>();
        scope.forEach(e -> perEngine.put(e.id(), new EngineAcc()));
        // Per-day totals from the first per-day day (trend or previous period) to the period's last:
        // the trend and the previous period's totals are read off them.
        Map<LocalDate, TrendAcc> daily = dailyAccs(w);
        Map<String, ChannelAcc> channels = new LinkedHashMap<>();
        for (String c : List.of("EMAIL", "WHATSAPP", "IN_APP", "AI_CALL")) channels.put(c, new ChannelAcc());

        // ── leads in (lists, lead agents) ──
        // In people, not memberships: the list rows and the totals come from the across-engines
        // counts, so a lead two engines took in is one lead; perEngine keeps each engine's own.
        Map<String, ListAcc> lists = new LinkedHashMap<>();
        Map<String, Set<String>> engineLists = new HashMap<>();
        for (MemberBucket b : d.members.byList()) {
            String key = "LIST".equals(b.kind()) ? "LIST:" + b.listId() : b.kind();
            String name = "LIST".equals(b.kind()) ? b.listName()
                    : "BATCH".equals(b.kind()) ? "Batch members" : "Individual users";
            ListAcc acc = lists.computeIfAbsent(key, k -> new ListAcc(
                    "LIST".equals(b.kind()) ? b.listId() : b.kind(), b.kind(), name));
            if (acc.name == null) acc.name = name;
            acc.leadsAdded += b.leadsAdded();
            acc.newLeads += b.newLeads();
        }
        for (MemberBucket b : d.members.byEngine()) {
            EngineAcc ea = perEngine.get(b.engineId());
            if (ea != null) ea.leadsAdded += b.leadsAdded();
            if (b.listId() != null) engineLists.computeIfAbsent(b.engineId(), k -> new HashSet<>()).add(b.listId());
        }
        for (ListSelector s : relevantSelectors(d.selectors, scope, engineId)) {
            if (s.listId() == null) continue;
            ListAcc acc = lists.computeIfAbsent("LIST:" + s.listId(), k -> new ListAcc(s.listId(), "LIST", s.listName()));
            if (acc.name == null) acc.name = s.listName();
            engineLists.computeIfAbsent(s.engineId(), k -> new HashSet<>()).add(s.listId());
        }
        // Each agent's counters summed over the period's days.
        Map<String, AgentDay> agentPeriod = new HashMap<>();
        for (AgentDay ad : d.agentDays) {
            TrendAcc t = daily.get(ad.day());
            if (t != null) t.credits += ad.credits();
            if (w.inPeriod(ad.day())) agentPeriod.merge(ad.agentId(), ad, AgentDay::plus);
        }
        double leadAgentCredits = 0, leadAgentUsd = 0;
        for (AgentDay ad : agentPeriod.values()) {
            leadAgentCredits += ad.credits();
            leadAgentUsd += ad.costUsd();
        }
        Map<String, List<AgentInfo>> agentsByList = new HashMap<>();
        d.agents.forEach(a -> agentsByList.computeIfAbsent(a.listId(), k -> new ArrayList<>()).add(a));
        // An engine carries the Lead Agent spend of the lists it targets (each agent once per engine).
        engineLists.forEach((eid, listIds) -> {
            EngineAcc ea = perEngine.get(eid);
            if (ea == null) return;
            Set<String> seen = new HashSet<>();
            for (String l : listIds) {
                for (AgentInfo a : agentsByList.getOrDefault(l, List.of())) {
                    AgentDay ad = agentPeriod.get(a.agentId());
                    if (ad != null && seen.add(a.agentId())) ea.credits += ad.credits();
                }
            }
        });

        List<ListRow> listRows = new ArrayList<>();
        for (ListAcc acc : lists.values()) {
            LeadAgent la = null;
            if ("LIST".equals(acc.kind) && acc.listId != null) {
                AgentInfo agent = agentsByList.getOrDefault(acc.listId, List.of()).stream()
                        .min(Comparator.comparing((AgentInfo a) -> agentPeriod.containsKey(a.agentId()) ? 0 : 1)
                                .thenComparing(a -> "ARCHIVED".equals(a.status()) ? 1 : 0))
                        .orElse(null);
                if (agent != null) {
                    AgentDay ad = agentPeriod.get(agent.agentId());
                    la = ad == null
                            ? new LeadAgent(agent.agentId(), agent.name(), 0, 0, 0, 0, 0, agent.alreadyInCrm(), 0, 0, 0)
                            : new LeadAgent(agent.agentId(), agent.name(), ad.discovered(), ad.researched(),
                            ad.delivered(), ad.review(), ad.rejected(), agent.alreadyInCrm(), ad.searches(),
                            ad.pages(), round2(ad.credits()));
                }
            }
            listRows.add(new ListRow(acc.listId, acc.name, acc.kind, acc.leadsAdded, acc.newLeads,
                    acc.leadsAdded - acc.newLeads, la));
        }
        listRows.sort(Comparator.comparing((ListRow r) -> "LIST".equals(r.kind()) ? 0 : 1)
                .thenComparing(Comparator.comparingLong(ListRow::leadsAdded).reversed())
                .thenComparing((ListRow r) -> r.name() == null ? "" : r.name()));
        // Distinct people overall: may be below the sum of the list rows when one user came in as a
        // named user for one engine and as a batch member for another.
        long leadsAdded = d.members.people(), newLeads = d.members.newPeople();

        // ── runs ──
        long decisions = 0, members = 0, sendK = 0, taskK = 0, noOpK = 0, replyK = 0, failed = 0, expired = 0;
        long optOuts = 0, tokensIn = 0, tokensOut = 0, withUsage = 0;
        double aiUsd = 0;
        for (Run r : d.runs) {
            decisions += r.decisions();
            members += r.members();
            sendK += r.send();
            taskK += r.task();
            noOpK += r.noOp();
            replyK += r.reply();
            failed += r.failed();
            expired += r.expired();
            optOuts += r.optOuts();
            tokensIn += r.tokensIn();
            tokensOut += r.tokensOut();
            withUsage += r.withUsage();
            aiUsd += r.aiUsd();
            EngineAcc ea = perEngine.get(r.engineId());
            if (ea != null) ea.decisions += r.decisions();
        }
        Map<String, Long> byKind = new LinkedHashMap<>();
        byKind.put("SEND", sendK);
        byKind.put("TASK", taskK);
        byKind.put("NO_OP", noOpK);
        byKind.put("REPLY", replyK);
        Runs runs = new Runs(decisions, members, byKind, failed, expired,
                d.topErrors.stream().map(e -> new ErrorCount(e.message(), e.count())).toList());
        LocalDate trackedSinceDay = w.localDay(d.aiTrackedSince);

        // ── outreach: messages, delivery, replies, WhatsApp cost ──
        boolean signalsOk = d.signals != null;
        Map<String, Signal> sig = signalsOk ? d.signals.byActionId() : Map.of();
        // Every reply count below (activity, cohort, channels, templates, trend, per engine) reads this.
        Map<String, Long> replyAt = attributeReplies(sig);
        Map<String, TemplateAcc> templates = new LinkedHashMap<>();
        long emailDelivered = 0, emailOpened = 0, emailClicked = 0, emailBounced = 0, emailComplained = 0;
        long waDelivered = 0, waRead = 0, waReplied = 0, waDispatchFailed = 0;
        boolean anyEmailTracked = false, anyWaObservable = false;
        long repliesInPeriod = 0;
        // WhatsApp pricing (design §3.5)
        Map<String, CategoryAcc> categories = new LinkedHashMap<>();
        String currency = null;
        double waAmount = 0;
        long billable = 0, estimatedMsgs = 0, missingRate = 0;

        // The previous period's own sends (before signalsFrom) only feed the per-day totals.
        List<Send> allSends = new ArrayList<>(d.previousSends);
        allSends.addAll(d.sends);
        for (Send s : allSends) {
            LocalDate sentDay = w.localDay(s.dispatchedAt());
            boolean sent = "SENT".equals(s.status());
            Signal g = sent ? sig.get(s.id()) : null;
            Long repliedAt = g != null ? replyAt.get(s.id()) : null;

            TrendAcc sentAcc = sent && sentDay != null ? daily.get(sentDay) : null;
            if (sentAcc != null) sentAcc.sent++;
            // Replies received on a day (activity): any message of the signals range answered that day.
            if (repliedAt != null) {
                LocalDate replyDay = w.localDay(repliedAt);
                TrendAcc replyAcc = daily.get(replyDay);
                if (replyAcc != null) replyAcc.replies++;
                if (w.inPeriod(replyDay)) {
                    repliesInPeriod++;
                    EngineAcc ea = perEngine.get(s.engineId());
                    if (ea != null) ea.replies++;
                }
            }
            if (!w.inPeriod(sentDay)) continue;

            ChannelAcc ch = channels.get(s.channel());
            if (!sent) {
                if (ch != null) ch.failed++;
                if ("WHATSAPP".equals(s.channel())) waDispatchFailed++;
                continue;
            }
            EngineAcc ea = perEngine.get(s.engineId());
            if (ea != null) ea.sent++;
            if (ch == null) continue;
            ch.sent++;
            boolean replied = repliedAt != null;
            if (replied) {
                ch.replied++;
                if (ea != null) ea.cohortReplied++;
            }

            TemplateAcc t = null;
            if ("WHATSAPP".equals(s.channel()) || "EMAIL".equals(s.channel())) {
                // An email drafted on an email template is that template's row (its name, else its
                // id); an AI-written email is its subject's.
                String name = "WHATSAPP".equals(s.channel())
                        ? firstNonBlank(s.templateName(), g != null ? g.templateName() : null, "(no template)")
                        : s.emailTemplateId() != null && !s.emailTemplateId().isBlank()
                        ? firstNonBlank(s.emailTemplateName(), s.emailTemplateId())
                        : firstNonBlank(g != null ? g.subject() : null, s.subject(), "(no subject)");
                t = templates.computeIfAbsent(s.channel() + "|" + name, k -> new TemplateAcc(s.channel(), name));
                t.sent++;
                if (replied) t.replied++;
            }

            switch (s.channel()) {
                case "IN_APP" -> ch.delivered++;   // written straight to the app inbox
                case "EMAIL" -> {
                    if (g == null) break;
                    anyEmailTracked |= g.emailTracked();
                    boolean delivered = g.delivered() || g.opened() || g.clicked();
                    if (delivered) {
                        ch.delivered++;
                        emailDelivered++;
                        t.delivered++;
                    }
                    if (g.opened()) {
                        ch.read++;
                        emailOpened++;
                        t.read++;
                    }
                    if (g.clicked()) emailClicked++;
                    if (g.bounced()) {
                        emailBounced++;
                        t.bounced++;
                    }
                    if (g.complained()) emailComplained++;
                }
                case "WHATSAPP" -> {
                    if (replied) waReplied++;
                    if (g == null) {
                        missingRate++;   // nothing to price it with
                        break;
                    }
                    if (!"WATI".equalsIgnoreCase(g.provider())) anyWaObservable = true;
                    String ds = g.deliveryStatus() == null ? "" : g.deliveryStatus().toUpperCase(Locale.ROOT);
                    if ("DELIVERED".equals(ds) || "READ".equals(ds)) {
                        ch.delivered++;
                        waDelivered++;
                        t.delivered++;
                    }
                    if ("READ".equals(ds)) {
                        ch.read++;
                        waRead++;
                        t.read++;
                    }
                    if ("FAILED".equals(ds)) {
                        ch.failed++;   // Meta's failure, or rejected at send time
                        // Meta does not charge a message it failed, even one its `sent` status priced.
                        break;
                    }

                    String type = lower(g.pricingType());
                    boolean estimated = type == null;
                    String category;
                    boolean isBillable;
                    if (!estimated) {
                        category = lower(firstNonBlank(g.pricingCategory(), g.templateCategory()));
                        isBillable = !type.startsWith("free")
                                && (g.pricingBillable() != null ? g.pricingBillable() : "regular".equals(type));
                    } else {
                        boolean template = firstNonBlank(s.templateName(), g.templateName()) != null;
                        category = template ? lower(g.templateCategory()) : "service";
                        isBillable = template;
                        estimatedMsgs++;
                    }
                    if (!isBillable) {
                        // One "free" row, not a second zero-rate row per category: Meta files a free
                        // reply under utility/service too, and two "utility" rows read as a bug.
                        CategoryAcc c = categories.computeIfAbsent("free|0|" + estimated,
                                k -> new CategoryAcc("free", 0, estimated));
                        c.count++;
                        break;
                    }
                    billable++;
                    WhatsAppRateCardService.Price price = category == null || errors.containsKey(WHATSAPP_COST)
                            ? null : priceFor(g.recipient(), category, sentDay, errors);
                    if (price == null || (currency != null && !currency.equals(price.currency()))) {
                        missingRate++;
                        break;
                    }
                    currency = price.currency();
                    waAmount += price.rate();
                    t.cost += price.rate();
                    CategoryAcc c = categories.computeIfAbsent(category + "|" + price.rate() + "|" + estimated,
                            k -> new CategoryAcc(category, price.rate(), estimated));
                    c.count++;
                    c.cost += price.rate();
                }
                default -> {
                }
            }
        }
        if (currency == null) currency = DEFAULT_CURRENCY;
        final String cur = currency;

        // ── calls ──
        long placed = 0, notDialled = 0, connected = 0, noAnswer = 0, busy = 0, callFailed = 0, inProgress = 0;
        long totalSeconds = 0;
        double connectedSecondsWeighted = 0, callCredits = 0;
        for (CallDay c : d.calls) {
            TrendAcc t = daily.get(c.day());
            if (t != null) t.credits += c.credits();
            if (!w.inPeriod(c.day())) continue;
            placed += c.placed();
            notDialled += c.notDialled();
            connected += c.connected();
            noAnswer += c.noAnswer();
            busy += c.busy();
            callFailed += c.failed();
            inProgress += c.inProgress();
            totalSeconds += c.totalSeconds();
            if (c.avgConnectedSec() != null) connectedSecondsWeighted += c.avgConnectedSec() * c.connected();
            callCredits += c.credits();
            EngineAcc ea = perEngine.get(c.engineId());
            if (ea != null) ea.credits += c.credits();
        }
        ChannelAcc aiCall = channels.get("AI_CALL");
        aiCall.sent = placed;
        aiCall.delivered = connected;
        aiCall.failed = callFailed + notDialled;
        aiCall.credits = callCredits;
        Calls calls = new Calls(placed, notDialled, connected, noAnswer, busy, callFailed, inProgress,
                round1(totalSeconds / 60.0), connected == 0 ? 0 : Math.round(connectedSecondsWeighted / connected),
                round2(callCredits));

        // ── message credits ──
        double messageCredits = 0;
        for (MessageCredit m : d.messageCredits) {
            TrendAcc t = daily.get(m.day());
            if (t != null) t.credits += m.credits();
            if (!w.inPeriod(m.day())) continue;
            messageCredits += m.credits();
            ChannelAcc ch = m.channel() == null ? null : channels.get(m.channel());
            if (ch != null) ch.credits += m.credits();
            EngineAcc ea = perEngine.get(m.engineId());
            if (ea != null) ea.credits += m.credits();
        }

        // ── outcomes ──
        Map<String, long[]> moves = new LinkedHashMap<>();
        Map<String, String[]> moveLabels = new HashMap<>();
        long statusChangesInPeriod = 0;
        for (StatusChangeRow r : d.statusChanges) {
            TrendAcc t = daily.get(r.day());
            if (t != null) t.statusChanges += r.total();
            if (!w.inPeriod(r.day())) continue;
            statusChangesInPeriod += r.total();
            String k = r.fromLabel() + "\u0000" + r.toLabel();
            long[] n = moves.computeIfAbsent(k, x -> new long[3]);
            n[0] += r.byEngine();
            n[1] += r.byTeam();
            n[2] += r.byAutomation();
            moveLabels.putIfAbsent(k, new String[]{r.fromLabel(), r.toLabel()});
        }
        List<StatusChange> statusChanges = new ArrayList<>();
        moves.forEach((k, n) -> statusChanges.add(
                new StatusChange(moveLabels.get(k)[0], moveLabels.get(k)[1], n[0], n[1], n[2])));
        statusChanges.sort(Comparator.comparingLong((StatusChange s) -> s.byEngine() + s.byTeam() + s.byAutomation())
                .reversed());

        Set<String> converted = new HashSet<>();
        for (Conversion c : d.conversions) {
            converted.add(c.leadKey());
            EngineAcc ea = perEngine.get(c.engineId());
            if (ea != null) ea.conversions.add(c.leadKey());
        }

        Map<LocalDate, Set<String>> bookedByDay = new HashMap<>();
        Map<String, Set<String>> bookedByEngine = new HashMap<>();
        Set<String> booked = new HashSet<>();
        Set<String> scheduled = new HashSet<>(), done = new HashSet<>(), noShow = new HashSet<>();
        for (Booking b : d.bookings) {
            if (b.bookedDay() != null) {
                bookedByDay.computeIfAbsent(b.bookedDay(), k -> new HashSet<>()).add(b.bookingId());
                if (w.inPeriod(b.bookedDay())) {
                    booked.add(b.bookingId());
                    bookedByEngine.computeIfAbsent(b.engineId(), k -> new HashSet<>()).add(b.bookingId());
                }
            }
            if (b.scheduledInPeriod()) {
                scheduled.add(b.bookingId());
                if ("COMPLETED".equals(b.outcome())) done.add(b.bookingId());
                if ("NO_SHOW".equals(b.outcome())) noShow.add(b.bookingId());
            }
        }
        bookedByDay.forEach((dd, ids) -> {
            TrendAcc t = daily.get(dd);
            if (t != null) t.demosBooked += ids.size();
        });
        bookedByEngine.forEach((eid, ids) -> {
            EngineAcc ea = perEngine.get(eid);
            if (ea != null) ea.demosBooked += ids.size();
        });
        long demosBooked = booked.size();
        Outcomes outcomes = new Outcomes(demosBooked, scheduled.size(), done.size(), noShow.size(),
                Math.max(0, scheduled.size() - done.size() - noShow.size()), converted.size(), statusChanges);

        // ── costs ──
        double creditsTotal = messageCredits + callCredits + leadAgentCredits;
        Costs costs = new Costs(
                new CreditCosts(round2(messageCredits), round2(callCredits), round2(leadAgentCredits), round2(creditsTotal)),
                new WhatsAppCost(round4(waAmount), cur, billable, estimatedMsgs, missingRate, missingRate > 0),
                new AiUsage(tokensIn, tokensOut, withUsage, trackedSinceDay == null ? null : trackedSinceDay.toString()));
        RealCost realCost = superAdmin
                ? new RealCost(round6(aiUsd), round6(leadAgentUsd), null, round6(aiUsd + leadAgentUsd))
                : null;

        Double balance = d.balance != null ? d.balance.balance() : null;
        Double runway = null;
        if (balance != null && d.balance.last7() > 0) {
            runway = round1(balance / (d.balance.last7() / 7.0));
        }

        // ── channels, email, whatsapp, templates ──
        ChannelAcc email = channels.get("EMAIL"), wa = channels.get("WHATSAPP"), inApp = channels.get("IN_APP");
        List<ChannelRow> channelRows = new ArrayList<>();
        channels.forEach((c, a) -> channelRows.add(new ChannelRow(c, a.sent, a.delivered, a.read, a.replied, a.failed,
                rate(a.replied, a.sent), round2(a.credits))));
        boolean emailTracked = signalsOk && (email.sent == 0 || anyEmailTracked);
        boolean repliesTracked = signalsOk && d.signals.inboundEmailEnabled();
        Email emailBlock = new Email(email.sent, emailDelivered, emailOpened, emailClicked, emailBounced,
                emailComplained, rate(emailBounced, email.sent), emailTracked, repliesTracked);
        boolean waTracked = signalsOk && (wa.sent == 0 || anyWaObservable);
        List<CategoryCost> byCategory = categories.values().stream()
                .map(c -> new CategoryCost(c.category, c.count, round4(c.rate), round4(c.cost), cur, c.estimated))
                .toList();
        WhatsApp waBlock = new WhatsApp(wa.sent, waDelivered, waRead, wa.failed, waReplied, waTracked, billable,
                byCategory);
        // WhatsApp templates first so the cap never drops them: they are few and reused, while
        // AI-written emails carry a new subject per send and can fill the cap on their own.
        List<TemplateAcc> sortedTemplates = templates.values().stream()
                .sorted(Comparator.comparing((TemplateAcc t) -> "WHATSAPP".equals(t.channel) ? 0 : 1)
                        .thenComparing(Comparator.comparingLong((TemplateAcc t) -> t.sent).reversed())
                        .thenComparing((TemplateAcc t) -> t.name))
                .toList();
        // Past the cap, one "(other)" row per channel holds the rest, so each channel's rows still
        // add up to what it sent.
        List<TemplateRow> templateRows = new ArrayList<>();
        Map<String, TemplateAcc> otherTemplates = new LinkedHashMap<>();
        for (int i = 0; i < sortedTemplates.size(); i++) {
            TemplateAcc t = sortedTemplates.get(i);
            if (i < MAX_TEMPLATE_ROWS) {
                templateRows.add(t.row(cur));
            } else {
                otherTemplates.computeIfAbsent(t.channel, c -> new TemplateAcc(c, OTHER_TEMPLATES)).add(t);
            }
        }
        otherTemplates.values().forEach(o -> templateRows.add(o.row(cur)));

        // ── summary, funnel, trend ──
        long contacted = email.sent + wa.sent + inApp.sent + placed;
        long delivered = email.delivered + wa.delivered + inApp.delivered + connected;
        // The funnel is one cohort, the period's messages: replied = replies to messages sent in it,
        // whenever they came. summary.replies stays the activity count (replies that arrived in it).
        long cohortReplies = channels.values().stream().mapToLong(a -> a.replied).sum();
        Summary summary = new Summary(leadsAdded, newLeads, leadsAdded - newLeads,
                decisions, noOpK, failed,
                contacted, email.sent, wa.sent, inApp.sent, placed,
                delivered, repliesInPeriod, connected,
                demosBooked, scheduled.size(), done.size(), converted.size(), statusChangesInPeriod, optOuts,
                round2(creditsTotal),
                new Money(round4(waAmount), cur, estimatedMsgs > 0, missingRate > 0),
                per(creditsTotal, repliesInPeriod), per(creditsTotal, demosBooked), per(creditsTotal, converted.size()),
                balance == null ? null : round2(balance), runway);
        List<FunnelStage> funnel = List.of(
                new FunnelStage("CONTACTED", contacted),
                new FunnelStage("DELIVERED", delivered),
                new FunnelStage("REPLIED", cohortReplies),
                new FunnelStage("DEMO_BOOKED", demosBooked),
                new FunnelStage("CONVERTED", converted.size()));
        List<TrendDay> trendRows = new ArrayList<>();
        daily.forEach((dd, t) -> {
            if (w.inTrend(dd)) {
                trendRows.add(new TrendDay(dd.toString(), t.sent, t.replies, t.demosBooked, round2(t.credits),
                        t.statusChanges));
            }
        });
        Previous previous = previous(d, w, daily, errors);

        // ── per engine (All only) ──
        List<EngineRow> engineRows = null;
        if (engineId == null) {
            engineRows = new ArrayList<>();
            for (Engine e : scope) {
                EngineAcc a = perEngine.get(e.id());
                boolean active = a.leadsAdded + a.sent + a.replies + a.decisions + a.demosBooked
                        + a.conversions.size() > 0 || a.credits > 0;
                if (!active && "ARCHIVED".equals(e.status())) continue;
                engineRows.add(new EngineRow(e.id(), e.name(), e.system(), a.leadsAdded, a.sent, a.replies,
                        rate(a.cohortReplied, a.sent), a.demosBooked, a.conversions.size(), round2(a.credits),
                        per(a.credits, a.replies)));
            }
            engineRows.sort(Comparator.comparingLong(EngineRow::sent).reversed()
                    .thenComparing(EngineRow::name, Comparator.nullsLast(Comparator.naturalOrder())));
        }

        // ── health (codes and values; the dashboard writes the copy) ──
        List<Health> health = new ArrayList<>();
        double bounceRate = rate(emailBounced, email.sent);
        if (emailTracked && email.sent >= 20 && bounceRate >= 0.10) {
            health.add(new Health("EMAIL_BOUNCE_HIGH", "critical", bounceRate, null));
        } else if (emailTracked && email.sent >= 20 && bounceRate >= 0.05) {
            health.add(new Health("EMAIL_BOUNCE_HIGH", "warning", bounceRate, null));
        }
        // Any spam complaint is worth seeing; it is critical from 0.1% of the emails sent (mailbox
        // providers' bulk-sender line), so one complaint in a long, busy period reads as a warning.
        if (emailComplained > 0) {
            health.add(new Health("EMAIL_COMPLAINTS",
                    rate(emailComplained, email.sent) >= 0.001 ? "critical" : "warning", emailComplained, null));
        }
        // Out of every WhatsApp tried in the period: wa.failed also counts the ones rejected at
        // dispatch, which never reach wa.sent, so over sent alone the ratio could pass 100%.
        long waAttempted = wa.sent + waDispatchFailed;
        double waFailRate = Math.min(1.0, rate(wa.failed, waAttempted));
        if (waAttempted >= 20 && waFailRate >= 0.10) {
            health.add(new Health("WHATSAPP_FAILED_HIGH", "warning", waFailRate, null));
        }
        if (optOuts > 0) health.add(new Health("OPT_OUTS", "info", optOuts, null));
        if (runway != null && runway < 2) {
            health.add(new Health("CREDITS_LOW", "critical", runway, null));
        } else if (runway != null && runway < 7) {
            health.add(new Health("CREDITS_LOW", "warning", runway, null));
        }
        if (signalsOk && email.sent > 0 && !anyEmailTracked) {
            health.add(new Health("TRACKING_OFF", "info", email.sent, "EMAIL"));
        }
        if (signalsOk && wa.sent > 0 && !anyWaObservable) {
            health.add(new Health("TRACKING_OFF", "info", wa.sent, "WHATSAPP"));
        }

        List<EngineOption> options = engines.stream()
                .map(e -> new EngineOption(e.id(), e.name(), e.status(), e.system()))
                .toList();
        return new EngagementDailyReport(w.toDay().toString(), w.fromDay().toString(), w.toDay().toString(), w.days(),
                w.zone().getId(), engineId, Instant.now().toString(),
                options, summary, funnel, trendRows, previous, engineRows, listRows, runs, channelRows, calls,
                emailBlock, waBlock, templateRows, newTemplates(d.newTemplates), outcomes, costs, realCost, health,
                errors);
    }

    /** One empty accumulator per day from the first per-day day to the period's last, in day order. */
    private static TreeMap<LocalDate, TrendAcc> dailyAccs(Window w) {
        TreeMap<LocalDate, TrendAcc> daily = new TreeMap<>();
        for (LocalDate t = w.dataFromDay(); !t.isAfter(w.toDay()); t = t.plusDays(1)) daily.put(t, new TrendAcc());
        return daily;
    }

    /**
     * The previous period's totals (the KPI deltas): per-day sums over its days, leads added and
     * conversions from their own read. A number whose read failed is null, as is replies when
     * its delivery data was not read (too many messages, or notification_service down).
     */
    private static Previous previous(Data d, Window w, Map<LocalDate, TrendAcc> daily, Map<String, String> errors) {
        long sent = 0, replies = 0, demos = 0, statusChanges = 0;
        double credits = 0;
        for (Map.Entry<LocalDate, TrendAcc> e : daily.entrySet()) {
            if (!w.inPrevious(e.getKey())) continue;
            TrendAcc t = e.getValue();
            sent += t.sent;
            replies += t.replies;
            demos += t.demosBooked;
            statusChanges += t.statusChanges;
            credits += t.credits;
        }
        boolean sendsKnown = d.sendsLoaded && (!w.previousBeforeTrend() || d.previousSendsLoaded);
        boolean repliesKnown = sendsKnown && d.signals != null && (!w.previousBeforeTrend() || d.previousSignals);
        boolean creditsKnown = !errors.containsKey("costs") && !errors.containsKey("calls")
                && !errors.containsKey("lists");
        return new Previous(w.prevFromDay().toString(), w.prevToDay().toString(),
                d.previous == null ? null : d.previous.leadsAdded(),
                sendsKnown ? sent : null,
                repliesKnown ? replies : null,
                errors.containsKey("demos") ? null : demos,
                d.previous == null ? null : d.previous.conversions(),
                creditsKnown ? round2(credits) : null,
                errors.containsKey("statusChanges") ? null : statusChanges);
    }

    /**
     * The period's new WhatsApp templates: by the category they were proposed in, and bucketed by
     * where they stand now (see {@link EngagementDailyReport.NewTemplates}). null rows = section failed.
     */
    static EngagementDailyReport.NewTemplates newTemplates(List<EngagementDailyReportDao.NewTemplateRow> rows) {
        if (rows == null) return null;
        Map<String, Long> byCategory = new LinkedHashMap<>();
        long created = 0, inReview = 0, approvedByYou = 0, withMeta = 0, live = 0, rejected = 0, withdrawn = 0,
                moved = 0;
        for (EngagementDailyReportDao.NewTemplateRow r : rows) {
            created += r.n();
            byCategory.merge(r.proposedCategory(), r.n(), Long::sum);
            switch (r.status() == null ? "" : r.status()) {
                case "AI_PROPOSED", "USER_REVIEW" -> inReview += r.n();
                case "USER_APPROVED" -> approvedByYou += r.n();
                case "SUBMITTED", "META_PENDING" -> withMeta += r.n();
                case "META_APPROVED", "META_RECATEGORISED" -> live += r.n();
                case "META_REJECTED", "META_DISABLED" -> rejected += r.n();
                case "WITHDRAWN", "SUPERSEDED" -> withdrawn += r.n();
                default -> {
                }
            }
            if ("UTILITY".equals(r.proposedCategory()) && "MARKETING".equals(r.metaCategory())) moved += r.n();
        }
        List<EngagementDailyReport.CategoryCount> categories = byCategory.entrySet().stream()
                .sorted(Map.Entry.<String, Long>comparingByValue().reversed())
                .map(e -> new EngagementDailyReport.CategoryCount(e.getKey(), e.getValue()))
                .toList();
        return new EngagementDailyReport.NewTemplates(created, categories, inReview, approvedByYou, withMeta, live,
                rejected, withdrawn, moved);
    }

    /**
     * When each message was first answered (epoch ms), keyed by action id, with one inbound
     * WhatsApp credited to one message. notification_service gives every send the first inbound
     * from that phone after it, so two sends before one reply would both claim it. An inbound
     * belongs to the latest send before it: per phone, in send order, a reply that came after the
     * next send is that send's, not this one's. A send Meta failed never reached the phone, so it
     * neither takes a reply nor stands in the way of an earlier one. Email replies are linked to
     * their own email row and are kept as they are.
     */
    static Map<String, Long> attributeReplies(Map<String, Signal> byActionId) {
        Map<String, Long> out = new HashMap<>();
        Map<String, List<String>> byPhone = new HashMap<>();
        byActionId.forEach((id, g) -> {
            if (!"WHATSAPP".equals(g.channel())) {
                if (g.firstReplyAt() != null) out.put(id, g.firstReplyAt());
                return;
            }
            String digits = g.recipient() == null ? "" : g.recipient().replaceAll("\\D", "");
            if (digits.isEmpty() || g.sentAt() == null || "FAILED".equalsIgnoreCase(g.deliveryStatus())) return;
            byPhone.computeIfAbsent(digits, k -> new ArrayList<>()).add(id);
        });
        for (List<String> ids : byPhone.values()) {
            ids.sort(Comparator.comparingLong((String id) -> byActionId.get(id).sentAt())
                    .thenComparing(Comparator.naturalOrder()));
            for (int i = 0; i < ids.size(); i++) {
                Long reply = byActionId.get(ids.get(i)).firstReplyAt();
                Long nextSend = i + 1 < ids.size() ? byActionId.get(ids.get(i + 1)).sentAt() : null;
                if (reply != null && (nextSend == null || reply <= nextSend)) out.put(ids.get(i), reply);
            }
        }
        return out;
    }

    /**
     * The rate card's price, or null when there is none. A rate card that cannot be read is named
     * in errors under {@link #WHATSAPP_COST}: the cost is then unknown rather than ₹0, the report
     * is not cached, and the caller stops asking for the rest of the report.
     */
    private WhatsAppRateCardService.Price priceFor(String recipient, String category, LocalDate day,
                                                   Map<String, String> errors) {
        try {
            return rateCard.priceFor(recipient, category, day);
        } catch (Exception e) {
            log.warn("[EngagementReport] WhatsApp rate card unavailable: {}", e.getMessage());
            errors.put(WHATSAPP_COST, "unavailable");
            return null;
        }
    }

    // ── small helpers ────────────────────────────────────────────────────────

    private static String lower(String s) {
        return s == null || s.isBlank() ? null : s.trim().toLowerCase(Locale.ROOT);
    }

    private static String firstNonBlank(String... values) {
        for (String v : values) if (v != null && !v.isBlank()) return v;
        return null;
    }

    /** part / whole as a 0..1 fraction; 0 when there is no whole. */
    private static double rate(long part, long whole) {
        return whole <= 0 ? 0.0 : round4((double) part / whole);
    }

    /** Credits per outcome; null when there was no outcome. */
    private static Double per(double credits, long count) {
        return count <= 0 ? null : round2(credits / count);
    }

    private static double round1(double v) {
        return Math.round(v * 10d) / 10d;
    }

    private static double round2(double v) {
        return Math.round(v * 100d) / 100d;
    }

    private static double round4(double v) {
        return Math.round(v * 10_000d) / 10_000d;
    }

    private static double round6(double v) {
        return Math.round(v * 1_000_000d) / 1_000_000d;
    }
}
