package vacademy.io.admin_core_service.features.telephony.publicapi;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Service;
import vacademy.io.admin_core_service.features.telephony.core.AiCallService;
import vacademy.io.admin_core_service.features.telephony.core.CallBillingService;
import vacademy.io.admin_core_service.features.telephony.persistence.entity.AiCallResult;
import vacademy.io.admin_core_service.features.telephony.persistence.entity.TelephonyCallLog;
import vacademy.io.admin_core_service.features.telephony.publicapi.entity.AiCallApiCall;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.sql.Timestamp;
import java.time.*;
import java.time.format.DateTimeParseException;
import java.util.*;

/**
 * Credits and usage for the public AI calling API: the balance a client's CRM checks before
 * a campaign, what calls cost per day, and what each call cost.
 *
 * <p>Everything is read from the ledger the wallet itself uses (institute_credits and
 * credit_transactions live in this database), never recomputed from rates: a call's cost
 * is the sum of the charges whose external_reference_id names it ("voice_call:{log}",
 * "ai_call:{log}" or "ai_call:uuid:{provider}:{uuid}", the keys CallBillingService writes).
 * The balance is read from the table rather than through ai_service, whose balance route
 * grants 100 credits to an institute it has not seen.
 *
 * <p>Billing runs after the call (and is swept every 10 minutes), so a just-finished call
 * can show {@code billed: false} for a short while.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class AiCallingUsageService {

    static final int MAX_RANGE_DAYS = 92;
    static final String SOURCE_API = "api";
    static final String SOURCE_ALL = "all";

    private final NamedParameterJdbcTemplate jdbc;
    private final AiCallService aiCallService;

    // ── Balance ──────────────────────────────────────────────────────────────────

    public Map<String, Object> credits(String instituteId) {
        MapSqlParameterSource p = new MapSqlParameterSource("i", instituteId);
        List<Map<String, Object>> rows = jdbc.queryForList(
                "SELECT current_balance, low_balance_threshold, updated_at FROM institute_credits WHERE institute_id = :i", p);
        BigDecimal balance = rows.isEmpty() ? null : (BigDecimal) rows.get(0).get("current_balance");
        BigDecimal threshold = rows.isEmpty() ? null : (BigDecimal) rows.get(0).get("low_balance_threshold");
        boolean canPlace;
        if (!aiCallService.isCreditGateEnabled()) {
            canPlace = true;
        } else if (balance == null) {
            // No wallet row yet: the call gate will create one on first use; ask it.
            canPlace = aiCallService.canAffordCall(instituteId);
        } else {
            canPlace = balance.signum() > 0;
        }
        Long waiting = jdbc.queryForObject(
                "SELECT COUNT(*) FROM ai_call_queue WHERE institute_id = :i AND status = 'QUEUED'", p, Long.class);

        Map<String, Object> m = new LinkedHashMap<>();
        m.put("object", "credits");
        m.put("balance", balance == null ? 0.0 : balance.setScale(2, RoundingMode.HALF_UP).doubleValue());
        m.put("low_balance_threshold", threshold == null ? null : threshold.doubleValue());
        m.put("low_balance", balance == null || (threshold != null && balance.compareTo(threshold) < 0));
        m.put("can_place_calls", canPlace);
        m.put("calls_waiting", waiting == null ? 0 : waiting);
        Object updated = rows.isEmpty() ? null : rows.get(0).get("updated_at");
        m.put("updated_at", updated instanceof Timestamp t ? t.toInstant().toString() : null);
        return m;
    }

    // ── Usage per day ────────────────────────────────────────────────────────────

    public Map<String, Object> usage(String instituteId, String fromRaw, String toRaw, String tzRaw, String sourceRaw) {
        ZoneId zone;
        try {
            zone = tzRaw == null || tzRaw.isBlank() ? ZoneId.of("UTC") : ZoneId.of(tzRaw.trim());
        } catch (DateTimeException e) {
            throw AiCallingApiException.invalid("timezone must be an IANA name, e.g. Asia/Kolkata.");
        }
        String source = sourceRaw == null || sourceRaw.isBlank() ? SOURCE_API : sourceRaw.trim().toLowerCase(Locale.ROOT);
        if (!SOURCE_API.equals(source) && !SOURCE_ALL.equals(source)) {
            throw AiCallingApiException.invalid("source must be api or all.");
        }
        LocalDate today = LocalDate.now(zone);
        LocalDate to = parseDate(toRaw, "to", today);
        LocalDate from = parseDate(fromRaw, "from", to.minusDays(6));
        if (from.isAfter(to)) throw AiCallingApiException.invalid("from must be on or before to.");
        if (from.plusDays(MAX_RANGE_DAYS - 1).isBefore(to)) {
            throw AiCallingApiException.invalid("A usage range is at most " + MAX_RANGE_DAYS + " days.");
        }
        Instant start = from.atStartOfDay(zone).toInstant();
        Instant end = to.plusDays(1).atStartOfDay(zone).toInstant();

        // telephony_call_log / credit_transactions hold naive UTC timestamps.
        // "unbilled" = a leg CallBillingService will still charge (the same gates as
        // voiceLegPending / aiLegPending below and the reconciliation sweep): the voice leg
        // only on Vacademy-paid trunks (PLIVO, VACADEMY_AI), the AI leg on VACADEMY_AI and
        // AAVTAAR. Reading only telephony_call_log.credits_billed_at counted every connected
        // AAVTAAR call as unbilled forever (no voice leg is ever stamped for it), and called
        // a VACADEMY_AI call billed while its AI leg was still owed.
        MapSqlParameterSource p = new MapSqlParameterSource()
                .addValue("i", instituteId)
                .addValue("start", Timestamp.valueOf(LocalDateTime.ofInstant(start, ZoneOffset.UTC)))
                .addValue("end", Timestamp.valueOf(LocalDateTime.ofInstant(end, ZoneOffset.UTC)))
                .addValue("tz", zone.getId())
                .addValue("apiOnly", SOURCE_API.equals(source));
        String sql = """
                WITH logs AS (
                    SELECT l.id, l.created_at, l.status, l.duration_seconds,
                           ((l.provider_type IN ('PLIVO', 'VACADEMY_AI') AND l.status = 'COMPLETED'
                                AND COALESCE(l.duration_seconds, 0) > 0 AND l.credits_billed_at IS NULL)
                            OR EXISTS (SELECT 1 FROM ai_call_result r
                                        WHERE r.call_log_id = l.id
                                          AND r.provider IN ('VACADEMY_AI', 'AAVTAAR')
                                          AND r.processing_status = 'PROCESSED'
                                          AND lower(trim(coalesce(r.status, ''))) IN ('completed', 'complete')
                                          AND (r.duration_seconds IS NULL OR r.duration_seconds > 0)
                                          AND (r.call_uuid IS NOT NULL OR r.correlation_id IS NOT NULL)
                                          AND r.credits_billed_at IS NULL)) AS unbilled
                      FROM telephony_call_log l
                     WHERE l.institute_id = :i
                       AND l.created_at >= :start AND l.created_at < :end
                       AND l.provider_type IN ('VACADEMY_AI', 'AAVTAAR')
                       AND (:apiOnly = FALSE OR l.subject_type = 'API_CONTACT')
                ), refs AS (
                    SELECT id AS log_id, 'voice_call:' || id AS ref FROM logs
                    UNION ALL SELECT id, 'ai_call:' || id FROM logs
                    UNION ALL SELECT r.call_log_id, 'ai_call:uuid:' || r.provider || ':' || r.call_uuid
                                FROM ai_call_result r JOIN logs ON logs.id = r.call_log_id
                               WHERE r.call_uuid IS NOT NULL
                ), cost AS (
                    SELECT refs.log_id, SUM(ABS(t.amount)) AS credits
                      FROM refs JOIN credit_transactions t
                        ON t.external_reference_id = refs.ref AND t.institute_id = :i
                       AND t.transaction_type = 'USAGE_DEDUCTION'
                     GROUP BY refs.log_id
                )
                SELECT to_char((logs.created_at AT TIME ZONE 'UTC') AT TIME ZONE :tz, 'YYYY-MM-DD') AS day,
                       COUNT(*) AS calls,
                       COUNT(*) FILTER (WHERE logs.status = 'COMPLETED') AS connected,
                       COALESCE(SUM(logs.duration_seconds) FILTER (WHERE logs.status = 'COMPLETED'), 0) AS seconds,
                       COALESCE(SUM(cost.credits), 0) AS credits,
                       COUNT(*) FILTER (WHERE logs.unbilled) AS unbilled
                  FROM logs LEFT JOIN cost ON cost.log_id = logs.id
                 GROUP BY 1
                 ORDER BY 1
                """;
        Map<String, Map<String, Object>> byDay = new HashMap<>();
        for (Map<String, Object> row : jdbc.queryForList(sql, p)) byDay.put((String) row.get("day"), row);

        List<Map<String, Object>> days = new ArrayList<>();
        long calls = 0, connected = 0, seconds = 0, unbilled = 0;
        BigDecimal credits = BigDecimal.ZERO;
        for (LocalDate d = from; !d.isAfter(to); d = d.plusDays(1)) {
            Map<String, Object> row = byDay.get(d.toString());
            long c = row == null ? 0 : ((Number) row.get("calls")).longValue();
            long cn = row == null ? 0 : ((Number) row.get("connected")).longValue();
            long s = row == null ? 0 : ((Number) row.get("seconds")).longValue();
            BigDecimal cr = row == null ? BigDecimal.ZERO : new BigDecimal(String.valueOf(row.get("credits")));
            unbilled += row == null ? 0 : ((Number) row.get("unbilled")).longValue();
            calls += c;
            connected += cn;
            seconds += s;
            credits = credits.add(cr);
            Map<String, Object> day = new LinkedHashMap<>();
            day.put("date", d.toString());
            day.put("calls", c);
            day.put("connected", cn);
            day.put("talk_seconds", s);
            day.put("credits", round(cr));
            days.add(day);
        }
        Map<String, Object> totals = new LinkedHashMap<>();
        totals.put("calls", calls);
        totals.put("connected", connected);
        totals.put("talk_seconds", seconds);
        totals.put("credits", round(credits));
        totals.put("calls_not_yet_billed", unbilled);

        Map<String, Object> out = new LinkedHashMap<>();
        out.put("object", "usage");
        out.put("source", source);
        out.put("from", from.toString());
        out.put("to", to.toString());
        out.put("timezone", zone.getId());
        out.put("totals", totals);
        out.put("days", days);
        // Added in v1.2, after every v1.1 field so those stay byte-identical.
        out.put("human_calls", humanUsage(p, from, to));
        return out;
    }

    /**
     * Human (counsellor) calls in the same range and day cut: source=api counts the calls
     * placed through POST /v1/human-calls, source=all every outbound counsellor call placed
     * on a telephony provider (PLIVO, EXOTEL, AIRTEL: the dashboard's Call button, the API,
     * and Airtel calls imported from the counsellor's extension). MANUAL rows are uploads
     * of calls made off the platform, never placed here, so they are not counted. Only
     * Vacademy Voice (PLIVO) talk time is charged to the wallet ("voice_call:{log}"); calls
     * on the institute's own Exotel/Airtel account count with 0 credits.
     */
    private Map<String, Object> humanUsage(MapSqlParameterSource p, LocalDate from, LocalDate to) {
        String sql = """
                WITH logs AS (
                    SELECT l.id, l.created_at, l.status, l.duration_seconds,
                           (l.provider_type = 'PLIVO' AND l.status = 'COMPLETED'
                                AND COALESCE(l.duration_seconds, 0) > 0 AND l.credits_billed_at IS NULL) AS unbilled
                      FROM telephony_call_log l
                     WHERE l.institute_id = :i
                       AND l.created_at >= :start AND l.created_at < :end
                       AND l.direction = 'OUTBOUND' AND l.counsellor_user_id IS NOT NULL
                       AND l.provider_type IN ('PLIVO', 'EXOTEL', 'AIRTEL')
                       AND (:apiOnly = FALSE OR EXISTS (SELECT 1 FROM human_call_api_call h WHERE h.call_log_id = l.id))
                ), cost AS (
                    SELECT logs.id AS log_id, SUM(ABS(t.amount)) AS credits
                      FROM logs JOIN credit_transactions t
                        ON t.external_reference_id = 'voice_call:' || logs.id AND t.institute_id = :i
                       AND t.transaction_type = 'USAGE_DEDUCTION'
                     GROUP BY logs.id
                )
                SELECT to_char((logs.created_at AT TIME ZONE 'UTC') AT TIME ZONE :tz, 'YYYY-MM-DD') AS day,
                       COUNT(*) AS calls,
                       COUNT(*) FILTER (WHERE logs.status = 'COMPLETED') AS connected,
                       COALESCE(SUM(logs.duration_seconds) FILTER (WHERE logs.status = 'COMPLETED'), 0) AS seconds,
                       COALESCE(SUM(cost.credits), 0) AS credits,
                       COUNT(*) FILTER (WHERE logs.unbilled) AS unbilled
                  FROM logs LEFT JOIN cost ON cost.log_id = logs.id
                 GROUP BY 1
                 ORDER BY 1
                """;
        Map<String, Map<String, Object>> byDay = new HashMap<>();
        for (Map<String, Object> row : jdbc.queryForList(sql, p)) byDay.put((String) row.get("day"), row);
        List<Map<String, Object>> days = new ArrayList<>();
        long calls = 0, connected = 0, seconds = 0, unbilled = 0;
        BigDecimal credits = BigDecimal.ZERO;
        for (LocalDate d = from; !d.isAfter(to); d = d.plusDays(1)) {
            Map<String, Object> row = byDay.get(d.toString());
            long c = row == null ? 0 : ((Number) row.get("calls")).longValue();
            long cn = row == null ? 0 : ((Number) row.get("connected")).longValue();
            long s = row == null ? 0 : ((Number) row.get("seconds")).longValue();
            BigDecimal cr = row == null ? BigDecimal.ZERO : new BigDecimal(String.valueOf(row.get("credits")));
            unbilled += row == null ? 0 : ((Number) row.get("unbilled")).longValue();
            calls += c;
            connected += cn;
            seconds += s;
            credits = credits.add(cr);
            Map<String, Object> day = new LinkedHashMap<>();
            day.put("date", d.toString());
            day.put("calls", c);
            day.put("connected", cn);
            day.put("talk_seconds", s);
            day.put("credits", round(cr));
            days.add(day);
        }
        Map<String, Object> totals = new LinkedHashMap<>();
        totals.put("calls", calls);
        totals.put("connected", connected);
        totals.put("talk_seconds", seconds);
        totals.put("credits", round(credits));
        totals.put("calls_not_yet_billed", unbilled);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("totals", totals);
        out.put("days", days);
        return out;
    }

    // ── Per call ─────────────────────────────────────────────────────────────────

    /**
     * What one call cost: {credits, billed, balance_after, deductions}. null while the call
     * has not ended (nothing to know yet); 0 for a test call or a call that did not connect
     * (never billed).
     */
    public Map<String, Object> costOfCall(AiCallApiCall c, TelephonyCallLog l, AiCallResult r) {
        return costOf(c.getInstituteId(), c.isTestMode(), l, r);
    }

    /**
     * The same rule for a call that has no API row (an inbound call answered on one of the
     * institute's numbers): its voice leg and AI leg are charged under the same ledger keys.
     */
    public Map<String, Object> costOfCallLog(String instituteId, TelephonyCallLog l, AiCallResult r) {
        return costOf(instituteId, false, l, r);
    }

    private Map<String, Object> costOf(String instituteId, boolean test, TelephonyCallLog l, AiCallResult r) {
        if (test) return settledAtZero();
        if (l == null || l.getStatus() == null) return null;
        String status = l.getStatus();
        if (!"COMPLETED".equals(status)) {
            return Set.of("NO_ANSWER", "BUSY", "FAILED", "CANCELLED").contains(status) ? settledAtZero() : null;
        }
        List<String> refs = new ArrayList<>(List.of("voice_call:" + l.getId(), "ai_call:" + l.getId()));
        if (r != null && r.getCallUuid() != null) refs.add("ai_call:uuid:" + r.getProvider() + ":" + r.getCallUuid());
        Ledger ledger = readLedger(jdbc, instituteId, refs);
        if (ledger == null) return null;
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("credits", round(ledger.credits()));
        m.put("billed", !voiceLegPending(l) && !aiLegPending(r));
        ledger.putInto(m);
        return m;
    }

    /** A call that is never charged: a test call, or one that did not connect. */
    static Map<String, Object> settledAtZero() {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("credits", 0.0);
        m.put("billed", true);
        m.put("balance_after", null);
        m.put("deductions", List.of());
        return m;
    }

    /**
     * The wallet charges behind one call, oldest first, read from credit_transactions (the
     * ledger the dashboard's AI Credits History lists). Each USAGE_DEDUCTION row carries the
     * balance it left behind (balance_after), so a call reports what each charge took and
     * what the wallet held right after it. A call is charged in up to two legs, voice
     * (talk time on a Vacademy-paid line) and AI (the agent's minutes), each its own row.
     */
    public record Ledger(BigDecimal credits, Double balanceAfter, List<Map<String, Object>> deductions) {

        /** Adds balance_after and deductions after the fields a cost block already has. */
        void putInto(Map<String, Object> m) {
            m.put("balance_after", balanceAfter);
            m.put("deductions", deductions);
        }
    }

    /** The ledger rows under these keys; null when the lookup fails (the cost is then unknown). */
    static Ledger readLedger(NamedParameterJdbcTemplate jdbc, String instituteId, List<String> refs) {
        List<Map<String, Object>> rows;
        try {
            // description is not selected: it names the carrier and engine
            // ("Call minutes (PLIVO INBOUND) · 5 x 30s"), which the client API never shows.
            rows = jdbc.queryForList("""
                    SELECT amount, balance_after, request_type, external_reference_id,
                           created_at AT TIME ZONE 'UTC' AS charged_at
                      FROM credit_transactions
                     WHERE institute_id = :i AND transaction_type = 'USAGE_DEDUCTION'
                       AND external_reference_id IN (:refs)
                     ORDER BY created_at ASC, id ASC
                    """, new MapSqlParameterSource().addValue("i", instituteId).addValue("refs", refs));
        } catch (RuntimeException e) {
            log.warn("ai-calling-api: credit ledger lookup failed for {}: {}", refs, e.getMessage());
            return null;
        }
        BigDecimal total = BigDecimal.ZERO;
        Double balanceAfter = null;
        List<Map<String, Object>> out = new ArrayList<>();
        for (Map<String, Object> row : rows) {
            BigDecimal amount = decimal(row.get("amount")).abs();
            total = total.add(amount);
            Double after = row.get("balance_after") == null ? null : round(decimal(row.get("balance_after")));
            balanceAfter = after;
            Map<String, Object> d = new LinkedHashMap<>();
            d.put("type", legOf((String) row.get("request_type"), (String) row.get("external_reference_id")));
            d.put("credits", round(amount));
            d.put("balance_after", after);
            Object at = row.get("charged_at");
            d.put("charged_at", at instanceof Timestamp t ? t.toInstant().toString()
                    : at instanceof OffsetDateTime o ? o.toInstant().toString() : null);
            out.add(d);
        }
        return new Ledger(total, balanceAfter, out);
    }

    /** voice | ai, from the charge's request type (voice_call_in, ai_call_out, …), else its key. */
    static String legOf(String requestType, String ref) {
        String s = requestType != null && !requestType.isBlank() ? requestType : ref == null ? "" : ref;
        s = s.toLowerCase(Locale.ROOT);
        if (s.startsWith("voice_call")) return "voice";
        if (s.startsWith("ai_call")) return "ai";
        return "other";
    }

    private static BigDecimal decimal(Object v) {
        if (v == null) return BigDecimal.ZERO;
        if (v instanceof BigDecimal b) return b;
        return new BigDecimal(String.valueOf(v));
    }

    /**
     * The voice leg is still to be charged: CallLogService.maybeBillVoiceLeg and the sweep
     * charge it only on Vacademy-paid trunks (PLIVO, VACADEMY_AI), for a COMPLETED call with
     * talk time, and stamp telephony_call_log.credits_billed_at. Any other provider never
     * gets the stamp, so its absence there means nothing is owed.
     */
    static boolean voiceLegPending(TelephonyCallLog l) {
        return l != null && l.getCreditsBilledAt() == null
                && CallBillingService.isVoiceBillable(l.getProviderType())
                && "COMPLETED".equals(l.getStatus())
                && l.getDurationSeconds() != null && l.getDurationSeconds() > 0;
    }

    /**
     * The AI leg is still to be charged: the same gates as AiCallOutcomeProcessor's live
     * charge and the reconciliation sweep (an AI-billable provider, a PROCESSED report whose
     * own status is completed, talk time unknown or positive, and a stable identity:
     * call_uuid, or correlation_id bound to a call log). A report that fails any gate is
     * never charged, so it is not "not yet billed" either.
     */
    static boolean aiLegPending(AiCallResult r) {
        if (r == null || r.getCreditsBilledAt() != null) return false;
        if (!CallBillingService.isAiBillable(r.getProvider())) return false;
        if (!"PROCESSED".equals(r.getProcessingStatus())) return false;
        String status = r.getStatus() == null ? "" : r.getStatus().trim().toLowerCase(Locale.ROOT);
        if (!"completed".equals(status) && !"complete".equals(status)) return false;
        if (r.getDurationSeconds() != null && r.getDurationSeconds() <= 0) return false;
        return r.getCallUuid() != null || (r.getCorrelationId() != null && r.getCallLogId() != null);
    }

    private static double round(BigDecimal v) {
        return v.setScale(2, RoundingMode.HALF_UP).doubleValue();
    }

    private static LocalDate parseDate(String raw, String field, LocalDate fallback) {
        if (raw == null || raw.isBlank()) return fallback;
        try {
            return LocalDate.parse(raw.trim());
        } catch (DateTimeParseException e) {
            throw AiCallingApiException.invalid(field + " must be a date like 2026-10-14.");
        }
    }
}
