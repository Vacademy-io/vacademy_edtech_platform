package vacademy.io.admin_core_service.features.engagement.report;

import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Repository;

import java.math.BigDecimal;
import java.sql.Timestamp;
import java.sql.Types;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * Reads for the engagement daily report ({@link EngagementDailyReportSql}). Plain reads, no
 * transaction of their own: the service runs each section inside its read-only transaction with
 * a statement timeout. Rows come back as small records; all aggregation the service does on them
 * is per engine, per day and over the period.
 */
@Repository
public class EngagementDailyReportDao {

    private final NamedParameterJdbcTemplate jdbc;

    public EngagementDailyReportDao(NamedParameterJdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    record Engine(String id, String name, String status, String createdBy) {
        boolean system() {
            return "SYSTEM_AI_CALL".equals(createdBy);
        }
    }

    record ListSelector(String engineId, String listId, String listName) {
    }

    record MemberBucket(String engineId, String kind, String listId, String listName, long leadsAdded, long newLeads) {
    }

    /**
     * Members added in the period in distinct people: per engine and list (engineId set), per list
     * across the engines (engineId null), and everyone.
     */
    record MembersAdded(List<MemberBucket> byEngine, List<MemberBucket> byList, long people, long newPeople) {
        static final MembersAdded NONE = new MembersAdded(List.of(), List.of(), 0, 0);
    }

    record AgentInfo(String agentId, String name, String listId, String status, long alreadyInCrm) {
    }

    record AgentDay(String agentId, LocalDate day, long discovered, long researched, long delivered, long review,
                    long rejected, long searches, long pages, double costUsd, double credits) {

        /** This day's counters plus another day's of the same agent (a period's total; day = the first). */
        AgentDay plus(AgentDay o) {
            return new AgentDay(agentId, day.isBefore(o.day) ? day : o.day, discovered + o.discovered,
                    researched + o.researched, delivered + o.delivered, review + o.review, rejected + o.rejected,
                    searches + o.searches, pages + o.pages, costUsd + o.costUsd, credits + o.credits);
        }
    }

    record Run(String engineId, long decisions, long members, long send, long task, long noOp, long reply,
               long failed, long expired, long optOuts, long tokensIn, long tokensOut, long withUsage, double aiUsd) {
    }

    record ErrorRow(String message, long count) {
    }

    /** emailTemplateName is null when the template id no longer resolves to one of the engine's templates. */
    record Send(String id, String engineId, String kind, String channel, String status, String templateName,
                String subject, String emailTemplateId, String emailTemplateName, LocalDateTime dispatchedAt) {
    }

    record CallDay(String engineId, LocalDate day, long placed, long notDialled, long connected, long noAnswer,
                   long busy, long failed, long inProgress, long totalSeconds, Double avgConnectedSec, double credits) {
    }

    record MessageCredit(String engineId, String channel, LocalDate day, double credits) {
    }

    record Balance(Double balance, double last7) {
    }

    record StatusChangeRow(LocalDate day, String fromLabel, String toLabel, long byEngine, long byTeam,
                           long byAutomation) {
        long total() {
            return byEngine + byTeam + byAutomation;
        }
    }

    record Conversion(String engineId, String leadKey) {
    }

    /** scheduledInPeriod: scheduled to start in the period (not cancelled or rescheduled). */
    record Booking(String engineId, String bookingId, LocalDate bookedDay, boolean scheduledInPeriod, String outcome) {
    }

    /** The previous period's distinct-people totals (EngagementDailyReportSql.PREVIOUS). */
    record PreviousTotals(long leadsAdded, long conversions) {
    }

    List<Engine> engines(String instituteId) {
        return rows(EngagementDailyReportSql.ENGINES, new MapSqlParameterSource("instituteId", instituteId)).stream()
                .map(r -> new Engine(str(r, "id"), str(r, "name"), str(r, "status"), str(r, "created_by")))
                .toList();
    }

    List<ListSelector> listSelectors(MapSqlParameterSource p) {
        return rows(EngagementDailyReportSql.LIST_SELECTORS, p).stream()
                .map(r -> new ListSelector(str(r, "engine_id"), str(r, "list_id"), str(r, "list_name")))
                .toList();
    }

    MembersAdded membersAdded(MapSqlParameterSource p) {
        List<MemberBucket> byEngine = new ArrayList<>();
        List<MemberBucket> byList = new ArrayList<>();
        long people = 0, newPeople = 0;
        for (Map<String, Object> r : rows(EngagementDailyReportSql.MEMBERS_ADDED, p)) {
            long grp = lng(r, "grp");
            if (grp == 7) {
                people = lng(r, "leads_added");
                newPeople = lng(r, "new_leads");
                continue;
            }
            MemberBucket b = new MemberBucket(str(r, "engine_id"), str(r, "kind"), str(r, "list_id"),
                    str(r, "list_name"), lng(r, "leads_added"), lng(r, "new_leads"));
            (grp == 0 ? byEngine : byList).add(b);
        }
        return new MembersAdded(byEngine, byList, people, newPeople);
    }

    /** {@code p} must carry a non-empty {@code listIds}. */
    List<AgentInfo> leadAgents(MapSqlParameterSource p) {
        return rows(EngagementDailyReportSql.LEAD_AGENTS, p).stream()
                .map(r -> new AgentInfo(str(r, "agent_id"), str(r, "name"), str(r, "list_id"), str(r, "status"),
                        lng(r, "already_in_crm")))
                .toList();
    }

    /** {@code p} must carry a non-empty {@code listIds}. */
    List<AgentDay> leadAgentDays(MapSqlParameterSource p) {
        return rows(EngagementDailyReportSql.LEAD_AGENT_DAYS, p).stream()
                .map(r -> new AgentDay(str(r, "agent_id"), LocalDate.parse(str(r, "day")),
                        lng(r, "discovered"), lng(r, "researched"), lng(r, "delivered"), lng(r, "review"),
                        lng(r, "rejected"), lng(r, "searches"), lng(r, "pages"), dbl(r, "cost_usd"), dbl(r, "credits")))
                .toList();
    }

    List<Run> runs(MapSqlParameterSource p) {
        return rows(EngagementDailyReportSql.RUNS, p).stream()
                .map(r -> new Run(str(r, "engine_id"), lng(r, "decisions"), lng(r, "members"),
                        lng(r, "k_send"), lng(r, "k_task"), lng(r, "k_noop"), lng(r, "k_reply"),
                        lng(r, "failed"), lng(r, "expired"), lng(r, "opt_outs"),
                        lng(r, "tokens_in"), lng(r, "tokens_out"), lng(r, "with_usage"), dbl(r, "ai_usd")))
                .toList();
    }

    List<ErrorRow> topErrors(MapSqlParameterSource p) {
        return rows(EngagementDailyReportSql.TOP_ERRORS, p).stream()
                .map(r -> new ErrorRow(str(r, "message"), lng(r, "n")))
                .toList();
    }

    LocalDateTime aiTrackedSince(MapSqlParameterSource p) {
        List<Map<String, Object>> rows = rows(EngagementDailyReportSql.AI_TRACKED_SINCE, p);
        return rows.isEmpty() ? null : ts(rows.get(0), "first_at");
    }

    /**
     * Messages dispatched in [from, to), on a copy of {@code p}: the created_at scan starts
     * {@link EngagementDailyReportService#SEND_SCAN_SLACK} before from.
     */
    List<Send> sends(MapSqlParameterSource p, LocalDateTime from, LocalDateTime to) {
        MapSqlParameterSource q = new MapSqlParameterSource(p.getValues())
                .addValue("sendsFrom", from, Types.TIMESTAMP)
                .addValue("sendsTo", to, Types.TIMESTAMP)
                .addValue("scanFrom", from.minus(EngagementDailyReportService.SEND_SCAN_SLACK), Types.TIMESTAMP);
        return rows(EngagementDailyReportSql.SENDS, q).stream()
                .map(r -> new Send(str(r, "id"), str(r, "engine_id"), str(r, "kind"), str(r, "channel"),
                        str(r, "status"), str(r, "template_name"), str(r, "subject"), str(r, "email_template_id"),
                        str(r, "email_template_name"), ts(r, "dispatched_at")))
                .toList();
    }

    List<CallDay> calls(MapSqlParameterSource p) {
        return rows(EngagementDailyReportSql.CALLS, p).stream()
                .map(r -> new CallDay(str(r, "engine_id"), LocalDate.parse(str(r, "day")),
                        lng(r, "placed"), lng(r, "not_dialled"), lng(r, "connected"), lng(r, "no_answer"),
                        lng(r, "busy"), lng(r, "failed"), lng(r, "in_progress"), lng(r, "total_seconds"),
                        dblOrNull(r, "avg_connected_sec"), dbl(r, "credits")))
                .toList();
    }

    List<MessageCredit> messageCredits(MapSqlParameterSource p) {
        return rows(EngagementDailyReportSql.MESSAGE_CREDITS, p).stream()
                .map(r -> new MessageCredit(str(r, "engine_id"), str(r, "channel"), LocalDate.parse(str(r, "day")),
                        dbl(r, "credits")))
                .toList();
    }

    Balance balance(MapSqlParameterSource p) {
        List<Map<String, Object>> rows = rows(EngagementDailyReportSql.CREDIT_BALANCE, p);
        if (rows.isEmpty()) return new Balance(null, 0);
        return new Balance(dblOrNull(rows.get(0), "balance"), dbl(rows.get(0), "last7"));
    }

    record NewTemplateRow(String proposedCategory, String status, String metaCategory, long n) {
    }

    List<NewTemplateRow> newTemplates(MapSqlParameterSource p) {
        return rows(EngagementDailyReportSql.NEW_TEMPLATES, p).stream()
                .map(r -> new NewTemplateRow(str(r, "proposed_category"), str(r, "status"), str(r, "meta_category"),
                        lng(r, "n")))
                .toList();
    }

    List<StatusChangeRow> statusChanges(MapSqlParameterSource p) {
        return rows(EngagementDailyReportSql.STATUS_CHANGES, p).stream()
                .map(r -> new StatusChangeRow(LocalDate.parse(str(r, "day")), str(r, "from_label"), str(r, "to_label"),
                        lng(r, "by_engine"), lng(r, "by_team"), lng(r, "by_automation")))
                .toList();
    }

    List<Conversion> conversions(MapSqlParameterSource p) {
        return rows(EngagementDailyReportSql.CONVERSIONS, p).stream()
                .map(r -> new Conversion(str(r, "engine_id"), str(r, "lead_key")))
                .toList();
    }

    List<Booking> bookings(MapSqlParameterSource p) {
        return rows(EngagementDailyReportSql.BOOKINGS, p).stream()
                .map(r -> {
                    String booked = str(r, "booked_day");
                    return new Booking(str(r, "engine_id"), str(r, "booking_id"),
                            booked == null ? null : LocalDate.parse(booked),
                            Boolean.TRUE.equals(r.get("scheduled_in_period")), str(r, "outcome"));
                })
                .toList();
    }

    PreviousTotals previous(MapSqlParameterSource p) {
        List<Map<String, Object>> rows = rows(EngagementDailyReportSql.PREVIOUS, p);
        if (rows.isEmpty()) return new PreviousTotals(0, 0);
        return new PreviousTotals(lng(rows.get(0), "leads_added"), lng(rows.get(0), "conversions"));
    }

    // ── row helpers ──────────────────────────────────────────────────────────

    private List<Map<String, Object>> rows(String sql, MapSqlParameterSource p) {
        return jdbc.queryForList(sql, p);
    }

    private static String str(Map<String, Object> r, String col) {
        Object v = r.get(col);
        return v == null ? null : v.toString();
    }

    private static long lng(Map<String, Object> r, String col) {
        Object v = r.get(col);
        return v instanceof Number n ? n.longValue() : 0L;
    }

    private static double dbl(Map<String, Object> r, String col) {
        Object v = r.get(col);
        return v instanceof Number n ? n.doubleValue() : 0d;
    }

    private static Double dblOrNull(Map<String, Object> r, String col) {
        Object v = r.get(col);
        if (v instanceof BigDecimal b) return b.doubleValue();
        return v instanceof Number n ? n.doubleValue() : null;
    }

    private static LocalDateTime ts(Map<String, Object> r, String col) {
        Object v = r.get(col);
        if (v instanceof Timestamp t) return t.toLocalDateTime();
        if (v instanceof LocalDateTime l) return l;
        return null;
    }
}
