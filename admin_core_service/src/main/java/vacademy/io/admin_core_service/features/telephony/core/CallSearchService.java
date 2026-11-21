package vacademy.io.admin_core_service.features.telephony.core;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.PageRequest;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Service;
import vacademy.io.admin_core_service.features.audience.service.LeadReportSettingService;
import vacademy.io.admin_core_service.features.audience.service.ReportScopeResolver;
import vacademy.io.admin_core_service.features.auth_service.service.AuthService;
import vacademy.io.admin_core_service.features.telephony.core.dto.CallDispositionCatalogDTO;
import vacademy.io.admin_core_service.features.telephony.core.dto.CallMetricsDTO;
import vacademy.io.admin_core_service.features.telephony.core.dto.CallRowDTO;
import vacademy.io.admin_core_service.features.telephony.core.dto.CallSearchFilterDTO;
import vacademy.io.admin_core_service.features.telephony.core.dto.DispositionCountDTO;
import vacademy.io.common.auth.dto.UserDTO;

import java.sql.Timestamp;
import java.sql.Types;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collection;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Paginated, RBAC-scoped call search for the team calling dashboard. Reads the
 * single universal call table (telephony_call_log) so AI (Aavtaar) and human
 * (Exotel/Airtel), inbound and outbound, every provider, show up together;
 * {@code callType} is derived (AI = an Aavtaar call or one with an
 * ai_call_result), never a stored column.
 *
 * <p>Same conventions as {@link vacademy.io.admin_core_service.features.audience.service.CallingReportService}:
 * raw NamedParameterJdbcTemplate (read-only), institute-TZ day bounds converted
 * to UTC instants, "connected" is the institute-configurable status set, scope
 * comes from {@link ReportScopeResolver} (null = institute-wide admin, "" =
 * zeroed), and counsellor names are hydrated via the auth-service batch lookup
 * (never JOIN users).
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class CallSearchService {

    private final NamedParameterJdbcTemplate jdbc;
    private final ReportScopeResolver reportScopeResolver;
    private final CallDispositionOptionsService callDispositionOptionsService;
    private final LeadReportSettingService leadReportSettingService;
    private final AuthService authService;

    private static final int DEFAULT_RANGE_DAYS = 30;
    private static final int MAX_PAGE_SIZE = 200;

    /** "DEAD_AIR,TTS_WEDGE" -> ["DEAD_AIR","TTS_WEDGE"]; null/blank -> null (NOT []). */
    private static List<String> splitDiagFaults(String csv) {
        if (csv == null || csv.isBlank()) return null;
        return Arrays.stream(csv.split(","))
                .map(String::trim).filter(t -> !t.isEmpty()).toList();
    }
    private static final ZoneId FALLBACK_ZONE = ZoneId.of("Asia/Kolkata");

    /** Per-row AI metadata (latest result wins on webhook dupes), joined laterally. */
    /**
     * "Is this an AI-agent call?" — an AI result has landed, OR the row was placed on
     * an AI provider. The provider list must stay in sync with the AI implementations
     * of {@code AiOutboundCaller} (see {@code ProviderType}): AAVTAAR, VACADEMY_AI (our
     * own voice bot, dialled over Plivo) and MOCK.
     *
     * <p>Testing the provider matters because the result arm alone only turns true once
     * the end-of-call report lands. Checking {@code = 'AAVTAAR'} here meant a VACADEMY_AI
     * call was reported as HUMAN for its whole life when no report ever arrives — every
     * no-answer/busy/failed dial, which on a bulk campaign is a large share of the list —
     * so the AI/Human KPI undercounted and the "AI" call-type filter hid them outright.
     *
     * <p>Repeated inline at the four sites below rather than concatenated in: three of
     * them sit inside SQL text blocks.
     */
    private static final String AI_LATERAL = """
            LEFT JOIN LATERAL (
                SELECT r.id AS acr_id, r.disposition AS ai_disposition, r.callback_at AS ai_callback_at,
                       r.callback AS ai_callback, r.transfer_triggered AS transfer_triggered,
                       r.diag_health AS diag_health, r.diag_faults AS diag_faults,
                       r.follow_up AS follow_up, r.follow_up_gist AS follow_up_gist
                FROM ai_call_result r
                WHERE r.call_log_id = tcl.id
                ORDER BY r.received_at DESC NULLS LAST
                LIMIT 1
            ) acr ON TRUE
            """;

    /**
     * The FROM clause every query here shares. Besides the AI result and the lead,
     * the call log row now carries what the Call Log table shows inline (2026-09-11):
     * the lead's pipeline status (editable in the table) and the call's intelligence
     * verdict (two-line update, ratings, sentiment). Both joins are 1:1 on unique
     * keys (ux on call_intelligence.call_log_id; lead_status.id), so the count
     * queries pay nothing measurable for them.
     */
    private static final String FROM_TAIL = " FROM telephony_call_log tcl " + AI_LATERAL
            + " LEFT JOIN audience_response ar ON ar.id = tcl.response_id"
            + " LEFT JOIN lead_status ls ON ls.id = ar.lead_status_id"
            + " LEFT JOIN call_intelligence ci ON ci.call_log_id = tcl.id ";

    /**
     * "No later connected call to this lead" — shared by the missed-inbound and
     * callbacks-due chips so an entry self-clears the moment anyone reconnects.
     * A later call counts as connected if it was answered, had talk time, or its
     * status is in the institute's connected set.
     */
    private static final String NO_LATER_CONNECT = """
            AND tcl.user_id IS NOT NULL AND tcl.user_id <> 'UNKNOWN'
            AND NOT EXISTS (
                SELECT 1 FROM telephony_call_log t2
                WHERE t2.institute_id = tcl.institute_id
                  AND t2.user_id = tcl.user_id
                  AND COALESCE(t2.start_time, t2.created_at) > COALESCE(tcl.start_time, tcl.created_at)
                  AND (t2.answer_time IS NOT NULL
                       OR COALESCE(t2.duration_seconds, 0) > 0
                       OR t2.status = ANY(STRING_TO_ARRAY(:connectedCsv, ',')))
            )
            """;

    public Page<CallRowDTO> search(CallSearchFilterDTO f, String callerUserId, boolean unmaskNumbers) {
        LeadReportSettingService.ReportSettings settings = leadReportSettingService.get(f.getInstituteId());
        ZoneId tz = safeZone(settings);
        String scopeCsv = reportScopeResolver.resolveScopeUsersCsv(
                f.getInstituteId(), callerUserId, trimToNull(f.getTeamId()), trimToNull(f.getCounsellorUserId()));

        MapSqlParameterSource params = new MapSqlParameterSource();
        String where = buildWhere(f, tz, settings, scopeCsv, params, true);

        Long total = jdbc.queryForObject(
                "SELECT COUNT(*)" + FROM_TAIL + where,
                params, Long.class);
        long count = total == null ? 0 : total;

        int size = Math.min(f.getSize() <= 0 ? 25 : f.getSize(), MAX_PAGE_SIZE);
        int page = Math.max(f.getPage(), 0);
        PageRequest pageable = PageRequest.of(page, size);
        if (count == 0) {
            return new PageImpl<>(List.of(), pageable, 0);
        }

        params.addValue("limit", size).addValue("offset", (long) page * size);
        String sql = ROW_SELECT + FROM_TAIL + where + orderBy(f) + " LIMIT :limit OFFSET :offset";

        List<CallRowDTO> rows = jdbc.query(sql, params, (rs, i) -> mapRow(rs, unmaskNumbers));

        Map<String, String> names = fetchNames(
                rows.stream().map(CallRowDTO::getCounsellorUserId).toList());
        rows.forEach(r -> r.setCounsellorName(names.get(r.getCounsellorUserId())));

        return new PageImpl<>(rows, pageable, count);
    }

    // ── Export ────────────────────────────────────────────────────────────────

    /**
     * Flat, capped projection of the filtered call list for CSV/XLSX export — same
     * filters + scope + masking as {@link #search}, no pagination. Honors the chips.
     */
    public List<CallRowDTO> exportRows(CallSearchFilterDTO f, String callerUserId, boolean unmaskNumbers, int cap) {
        LeadReportSettingService.ReportSettings settings = leadReportSettingService.get(f.getInstituteId());
        ZoneId tz = safeZone(settings);
        String scopeCsv = reportScopeResolver.resolveScopeUsersCsv(
                f.getInstituteId(), callerUserId, trimToNull(f.getTeamId()), trimToNull(f.getCounsellorUserId()));

        MapSqlParameterSource params = new MapSqlParameterSource();
        String where = buildWhere(f, tz, settings, scopeCsv, params, true);
        params.addValue("cap", cap);

        String sql = ROW_SELECT + FROM_TAIL + where + orderBy(f) + " LIMIT :cap";

        List<CallRowDTO> rows = jdbc.query(sql, params, (rs, i) -> mapRow(rs, unmaskNumbers));
        Map<String, String> names = fetchNames(rows.stream().map(CallRowDTO::getCounsellorUserId).toList());
        rows.forEach(r -> r.setCounsellorName(names.get(r.getCounsellorUserId())));
        return rows;
    }

    // ── KPI strip ───────────────────────────────────────────────────────────────

    private static final String METRICS_HEAD = """
            SELECT COUNT(*) AS total,
                   COUNT(*) FILTER (WHERE tcl.status = ANY(STRING_TO_ARRAY(:connectedCsv, ','))) AS connected,
                   COALESCE(SUM(COALESCE(tcl.duration_seconds, 0))
                            FILTER (WHERE tcl.status = ANY(STRING_TO_ARRAY(:connectedCsv, ','))), 0) AS talk_seconds,
                   COUNT(DISTINCT tcl.user_id) FILTER (WHERE tcl.user_id IS NOT NULL AND tcl.user_id <> 'UNKNOWN') AS unique_leads,
                   COUNT(*) FILTER (WHERE tcl.direction = 'INBOUND') AS inbound,
                   COUNT(*) FILTER (WHERE tcl.direction = 'OUTBOUND') AS outbound,
                   COUNT(*) FILTER (WHERE acr.acr_id IS NOT NULL
                                       OR tcl.provider_type IN ('AAVTAAR', 'VACADEMY_AI', 'MOCK')) AS ai_calls
            """;

    /**
     * KPI strip. Headline counts honor every filter EXCEPT the chips (so the
     * strip matches the table); the two chip badges are scope+date-window totals
     * (independent of the table's other filters — they're "needs attention" counts).
     */
    public CallMetricsDTO metrics(CallSearchFilterDTO f, String callerUserId) {
        LeadReportSettingService.ReportSettings settings = leadReportSettingService.get(f.getInstituteId());
        ZoneId tz = safeZone(settings);
        String scopeCsv = reportScopeResolver.resolveScopeUsersCsv(
                f.getInstituteId(), callerUserId, trimToNull(f.getTeamId()), trimToNull(f.getCounsellorUserId()));

        MapSqlParameterSource params = new MapSqlParameterSource();
        String where = buildWhere(f, tz, settings, scopeCsv, params, false);

        CallMetricsDTO m = jdbc.queryForObject(
                METRICS_HEAD + FROM_TAIL + where,
                params, (rs, i) -> {
                    long total = rs.getLong("total");
                    long connected = rs.getLong("connected");
                    long talk = rs.getLong("talk_seconds");
                    long ai = rs.getLong("ai_calls");
                    return CallMetricsDTO.builder()
                            .totalCalls(total)
                            .connectedCalls(connected)
                            .connectRate(total == 0 ? null : Math.round(connected * 1000.0 / total) / 10.0)
                            .totalTalkSeconds(talk)
                            .avgTalkSeconds(connected == 0 ? null : Math.round(talk * 10.0 / connected) / 10.0)
                            .uniqueLeads(rs.getLong("unique_leads"))
                            .inboundCalls(rs.getLong("inbound"))
                            .outboundCalls(rs.getLong("outbound"))
                            .aiCalls(ai)
                            .humanCalls(total - ai)
                            .build();
                });
        if (m == null) m = CallMetricsDTO.builder().build();

        m.setMissedInboundDue(chipCount(f, tz, settings, scopeCsv, true, false));
        m.setCallbacksDue(chipCount(f, tz, settings, scopeCsv, false, true));
        return m;
    }

    /**
     * COUNT(*) for one worklist chip over scope + date window only (ignores the table's other filters).
     * Best-effort: a chip-query failure must never blank the whole KPI strip — the headline counts are
     * the primary value, the chip badges are secondary. Returns 0 on error (logged).
     */
    private long chipCount(CallSearchFilterDTO src, ZoneId tz, LeadReportSettingService.ReportSettings settings,
                           String scopeCsv, boolean missed, boolean callbacks) {
        try {
            CallSearchFilterDTO chip = new CallSearchFilterDTO();
            chip.setInstituteId(src.getInstituteId());
            chip.setFromDate(src.getFromDate());
            chip.setToDate(src.getToDate());
            chip.setFromTs(src.getFromTs());
            chip.setToTs(src.getToTs());
            chip.setMissedInbound(missed);
            chip.setCallbacksDue(callbacks);
            MapSqlParameterSource p = new MapSqlParameterSource();
            String where = buildWhere(chip, tz, settings, scopeCsv, p, true);
            Long c = jdbc.queryForObject(
                    "SELECT COUNT(*)" + FROM_TAIL + where,
                    p, Long.class);
            return c == null ? 0 : c;
        } catch (Exception e) {
            log.warn("[CallSearch] chip count failed (missed={}, callbacks={}): {}", missed, callbacks, e.getMessage());
            return 0;
        }
    }

    private static final String ROW_SELECT = """
            SELECT tcl.id, tcl.provider_type, tcl.direction, tcl.status, tcl.termination_reason,
                   tcl.from_number, tcl.to_number, tcl.caller_id,
                   CASE WHEN tcl.direction = 'OUTBOUND' THEN tcl.to_number ELSE tcl.from_number END AS lead_number,
                   tcl.start_time, tcl.answer_time, tcl.end_time, tcl.duration_seconds,
                   tcl.recording_storage_key, tcl.counsellor_user_id, tcl.response_id,
                   -- An API call's user id is a pseudo id that exists nowhere: hide it so the
                   -- row offers no "View lead" / assign actions that would open an empty lead.
                   CASE WHEN tcl.subject_type = 'API_CONTACT' THEN NULL ELSE tcl.user_id END AS user_id,
                   tcl.disposition_key, tcl.disposition_notes, tcl.dispositioned_at, tcl.created_at,
                   tcl.ivr_selection,
                   COALESCE(ar.parent_name, CASE WHEN tcl.subject_type = 'API_CONTACT'
                       THEN COALESCE((SELECT api.contact_name FROM ai_call_api_call api WHERE api.id = tcl.subject_id),
                                     (SELECT h.contact_name FROM human_call_api_call h WHERE h.id = tcl.subject_id)) END)
                       AS lead_name,
                   acr.ai_disposition AS ai_disposition,
                   acr.diag_health AS diag_health,
                   acr.diag_faults AS diag_faults,
                   acr.follow_up AS follow_up,
                   acr.follow_up_gist AS follow_up_gist,
                   CASE WHEN (acr.acr_id IS NOT NULL
                              OR tcl.provider_type IN ('AAVTAAR', 'VACADEMY_AI', 'MOCK'))
                        THEN 'AI' ELSE 'HUMAN' END AS call_type,
                   COALESCE(tcl.callback_at, acr.ai_callback_at AT TIME ZONE 'UTC') AS callback_at_eff,
                   ar.lead_status_id, ls.status_key AS lead_status_key, ls.label AS lead_status_label,
                   ls.color AS lead_status_color,
                   ci.status AS ci_status, ci.short_update AS ci_short_update,
                   ci.caller_self_goal_rating AS ci_caller_rating, ci.call_output_rating AS ci_outcome_rating,
                   ci.lead_sentiment AS ci_lead_sentiment, ci.conversion_likelihood AS ci_conversion,
                   acr.ai_callback AS ai_callback, acr.transfer_triggered AS transfer_triggered,
                   (SELECT COUNT(*) FROM engagement_action ea
                     WHERE ea.institute_id = tcl.institute_id AND ea.source = 'AI_CALL'
                       AND ea.source_ref LIKE tcl.id || ':%') AS sends_total,
                   (SELECT COUNT(*) FROM engagement_action ea
                     WHERE ea.institute_id = tcl.institute_id AND ea.source = 'AI_CALL'
                       AND ea.source_ref LIKE tcl.id || ':%' AND ea.status = 'SENT') AS sends_sent
            """;

    /** Shared row projection mapper for the search page and the live panel. */
    private CallRowDTO mapRow(java.sql.ResultSet rs, boolean unmaskNumbers) throws java.sql.SQLException {
        return CallRowDTO.builder()
                .id(rs.getString("id"))
                .providerType(rs.getString("provider_type"))
                .callType(rs.getString("call_type"))
                .direction(rs.getString("direction"))
                .status(rs.getString("status"))
                .terminationReason(rs.getString("termination_reason"))
                .fromNumber(mask(rs.getString("from_number"), unmaskNumbers))
                .toNumber(mask(rs.getString("to_number"), unmaskNumbers))
                .leadNumber(mask(rs.getString("lead_number"), unmaskNumbers))
                .callerId(rs.getString("caller_id"))
                .startTime(rs.getTimestamp("start_time"))
                .answerTime(rs.getTimestamp("answer_time"))
                .endTime(rs.getTimestamp("end_time"))
                .durationSeconds(getNullableInt(rs, "duration_seconds"))
                .hasRecording(rs.getString("recording_storage_key") != null)
                .counsellorUserId(rs.getString("counsellor_user_id"))
                .responseId(rs.getString("response_id"))
                .userId(rs.getString("user_id"))
                .leadName(rs.getString("lead_name"))
                .ivrSelection(rs.getString("ivr_selection"))
                .dispositionKey(rs.getString("disposition_key"))
                .dispositionNotes(rs.getString("disposition_notes"))
                .dispositionedAt(rs.getTimestamp("dispositioned_at"))
                .aiDisposition(rs.getString("ai_disposition"))
                // Health rides the LIST, not just the detail: the row cell reads it
                // synchronously, so without it a row can never show a verdict and can
                // never become "detailable" either — the dot only appeared on rows some
                // OTHER feature had already fetched detail for.
                .diagHealth(rs.getString("diag_health"))
                .diagFaults(splitDiagFaults(rs.getString("diag_faults")))
                // The follow-up gist rides the list for the same reason health does:
                // the counsellor reads it in the row to decide whether to call, not
                // only in the detail drawer.
                .followUp(rs.getString("follow_up"))
                .followUpGist(rs.getString("follow_up_gist"))
                .callbackAt(rs.getTimestamp("callback_at_eff"))
                .createdAt(rs.getTimestamp("created_at"))
                .leadStatusId(rs.getString("lead_status_id"))
                .leadStatusKey(rs.getString("lead_status_key"))
                .leadStatusLabel(rs.getString("lead_status_label"))
                .leadStatusColor(rs.getString("lead_status_color"))
                .ciStatus(rs.getString("ci_status"))
                .ciShortUpdate(rs.getString("ci_short_update"))
                .ciCallerRating(getNullableDouble(rs, "ci_caller_rating"))
                .ciOutcomeRating(getNullableDouble(rs, "ci_outcome_rating"))
                .ciLeadSentiment(rs.getString("ci_lead_sentiment"))
                .ciConversionLikelihood(rs.getString("ci_conversion"))
                .aiCallback(rs.getBoolean("ai_callback") && !rs.wasNull())
                .transferred(notBlank(rs.getString("transfer_triggered")))
                .sendsTotal(rs.getInt("sends_total"))
                .sendsSent(rs.getInt("sends_sent"))
                .build();
    }

    // ── Disposition strip ─────────────────────────────────────────────────────

    /**
     * Every distinct effective outcome in the current filter window with its
     * count — the chip strip above the table (2026-09-11). Grouped on the same
     * normalized key the disposition FILTER matches on, so clicking a chip and
     * filtering by it agree exactly. Rows with no outcome at all are reported
     * under the empty key so the strip can show "Not set".
     */
    public List<DispositionCountDTO> dispositionCounts(CallSearchFilterDTO f, String callerUserId) {
        LeadReportSettingService.ReportSettings settings = leadReportSettingService.get(f.getInstituteId());
        ZoneId tz = safeZone(settings);
        String scopeCsv = reportScopeResolver.resolveScopeUsersCsv(
                f.getInstituteId(), callerUserId, trimToNull(f.getTeamId()), trimToNull(f.getCounsellorUserId()));
        MapSqlParameterSource params = new MapSqlParameterSource();
        // Chips excluded and the disposition filter itself excluded: the strip is
        // the menu of outcomes the current window holds, not the current selection.
        CallSearchFilterDTO base = new CallSearchFilterDTO();
        base.setInstituteId(f.getInstituteId());
        base.setFromDate(f.getFromDate()); base.setToDate(f.getToDate());
        base.setFromTs(f.getFromTs()); base.setToTs(f.getToTs());
        base.setDirection(f.getDirection()); base.setStatuses(f.getStatuses());
        base.setProviderType(f.getProviderType()); base.setCallType(f.getCallType());
        base.setCounsellorUserId(f.getCounsellorUserId()); base.setTeamId(f.getTeamId());
        base.setFromNumber(f.getFromNumber()); base.setToNumber(f.getToNumber());
        base.setLeadName(f.getLeadName()); base.setHasRecording(f.getHasRecording());
        String where = buildWhere(base, tz, settings, scopeCsv, params, false);

        Map<String, CallDispositionCatalogDTO> catalog = new HashMap<>();
        try {
            for (CallDispositionCatalogDTO o : callDispositionOptionsService.filterOptions(f.getInstituteId())) {
                catalog.putIfAbsent(CallDispositionOptionsService.normalizeKey(o.getDispositionKey()), o);
            }
        } catch (Exception e) {
            log.warn("[CallSearch] disposition catalog unavailable for chips: {}", e.getMessage());
        }
        String sql = """
                SELECT UPPER(REGEXP_REPLACE(COALESCE(NULLIF(tcl.disposition_key, ''), acr.ai_disposition, ''),
                                            '[^A-Za-z0-9]', '', 'g')) AS k,
                       MIN(COALESCE(NULLIF(tcl.disposition_key, ''), acr.ai_disposition)) AS raw,
                       COUNT(*) AS n
                """ + FROM_TAIL + where + " GROUP BY 1 ORDER BY n DESC";
        return jdbc.query(sql, params, (rs, i) -> {
            String k = rs.getString("k");
            String raw = rs.getString("raw");
            CallDispositionCatalogDTO o = k == null || k.isEmpty() ? null : catalog.get(k);
            return DispositionCountDTO.builder()
                    .key(k == null ? "" : k)
                    .label(o != null ? o.getLabel() : raw)
                    .color(o != null ? o.getColor() : null)
                    .category(o != null ? o.getCategory() : null)
                    .settable(o != null && o.isSettable())
                    .count(rs.getLong("n"))
                    .build();
        });
    }

    private static Double getNullableDouble(java.sql.ResultSet rs, String col) throws java.sql.SQLException {
        double v = rs.getDouble(col);
        return rs.wasNull() ? null : v;
    }

    /** Builds the shared FROM-tail WHERE (binds into {@code params}) for both count and page. */
    private String buildWhere(CallSearchFilterDTO f, ZoneId tz,
                              LeadReportSettingService.ReportSettings settings,
                              String scopeCsv, MapSqlParameterSource params, boolean includeChips) {
        Window w = resolveWindow(f, tz);
        params.addValue("instituteId", f.getInstituteId())
                .addValue("connectedCsv", connectedCsv(settings))
                .addValue("scopeCsv", scopeCsv, Types.VARCHAR)
                .addValue("fromUtc", w.fromUtc(), Types.TIMESTAMP)
                .addValue("toUtc", w.toUtc(), Types.TIMESTAMP);

        // Scope: a scoped counsellor sees calls owned by a counsellor in their scope,
        // PLUS unassigned INBOUND calls — a helpline / IVR-AI call belongs to the
        // institute, not to any one counsellor (counsellor_user_id IS NULL), so it
        // would otherwise be invisible to everyone. Institute-wide admins (scopeCsv
        // NULL) already see everything. Still institute-bounded — never cross-tenant.
        //
        // Third arm: an UNOWNED call whose LEAD is assigned to someone in scope. A
        // workflow-fired AI call has no human actor at all (placeCall gets a null
        // counsellor by design), so ownership can never be stamped on it — without
        // this, calls to a counsellor's own leads are invisible to her and visible
        // only to admins. Deliberately restricted to counsellor_user_id IS NULL: it
        // rescues calls nobody owns, and never exposes another counsellor's calls.
        StringBuilder sb = new StringBuilder("""
                WHERE tcl.institute_id = :instituteId
                  AND COALESCE(tcl.start_time, tcl.created_at) >= :fromUtc
                  AND COALESCE(tcl.start_time, tcl.created_at) < :toUtc
                  AND (:scopeCsv IS NULL
                       OR tcl.counsellor_user_id = ANY(STRING_TO_ARRAY(:scopeCsv, ','))
                       OR (tcl.direction = 'INBOUND' AND tcl.counsellor_user_id IS NULL)
                       OR (tcl.counsellor_user_id IS NULL AND EXISTS (
                             SELECT 1 FROM user_lead_profile ulp
                             WHERE ulp.user_id = tcl.user_id
                               AND ulp.institute_id = tcl.institute_id
                               AND ulp.assigned_counselor_id
                                     = ANY(STRING_TO_ARRAY(:scopeCsv, ',')))))
                """);

        if (notBlank(f.getDirection())) {
            sb.append(" AND tcl.direction = :direction");
            params.addValue("direction", f.getDirection().trim().toUpperCase());
        }
        if (f.getStatuses() != null && !f.getStatuses().isEmpty()) {
            sb.append(" AND tcl.status IN (:statuses)");
            params.addValue("statuses", f.getStatuses());
        }
        if (notBlank(f.getProviderType())) {
            sb.append(" AND tcl.provider_type = :providerType");
            params.addValue("providerType", f.getProviderType().trim().toUpperCase());
        }
        if (notBlank(f.getCallType())) {
            if ("AI".equalsIgnoreCase(f.getCallType().trim())) {
                sb.append(" AND (acr.acr_id IS NOT NULL"
                        + " OR tcl.provider_type IN ('AAVTAAR', 'VACADEMY_AI', 'MOCK'))");
            } else if ("HUMAN".equalsIgnoreCase(f.getCallType().trim())) {
                // COALESCE: `NULL NOT IN (...)` is NULL, so a row with no provider
                // matched NEITHER filter while the call_type column in the SELECT
                // rendered it HUMAN — it showed in the unfiltered list and vanished
                // the moment Type = Human was chosen. Keep the filter and the column
                // on the same rule.
                sb.append(" AND (acr.acr_id IS NULL"
                        + " AND COALESCE(tcl.provider_type, '') NOT IN ('AAVTAAR', 'VACADEMY_AI', 'MOCK'))");
            }
        }
        // Disposition filter matches the EFFECTIVE outcome — the same value the
        // Disposition column renders: the counsellor's manual key when set, else the
        // AI agent's. Matching tcl.disposition_key alone silently excluded every AI
        // call (their outcome lives in ai_call_result), which on an AI-heavy institute
        // is the entire log. Comparison is on the normalized key so "NOT_INTERESTED"
        // (catalog), "Not_Interested" (AI settings) and "Not Interested" (a hand-typed
        // agent value) are one outcome — see CallDispositionOptionsService.
        List<String> dispositionKeys = normalizedDispositionKeys(f.getDispositionKeys());
        if (!dispositionKeys.isEmpty()) {
            sb.append(" AND UPPER(REGEXP_REPLACE("
                    + "COALESCE(NULLIF(tcl.disposition_key, ''), acr.ai_disposition), "
                    + "'[^A-Za-z0-9]', '', 'g')) IN (:dispositionKeys)");
            params.addValue("dispositionKeys", dispositionKeys);
        }
        if (notBlank(f.getFromNumber())) {
            sb.append(" AND RIGHT(regexp_replace(tcl.from_number, '[^0-9]', '', 'g'), 10)"
                    + " = RIGHT(regexp_replace(:fromNumber, '[^0-9]', '', 'g'), 10)");
            params.addValue("fromNumber", f.getFromNumber().trim());
        }
        if (notBlank(f.getToNumber())) {
            sb.append(" AND RIGHT(regexp_replace(tcl.to_number, '[^0-9]', '', 'g'), 10)"
                    + " = RIGHT(regexp_replace(:toNumber, '[^0-9]', '', 'g'), 10)");
            params.addValue("toNumber", f.getToNumber().trim());
        }
        if (notBlank(f.getLeadName())) {
            // API contacts (AI calls and human click-to-calls placed through the public API)
            // carry their name on the API row, not on a lead.
            sb.append(" AND (ar.parent_name ILIKE :leadName OR (tcl.subject_type = 'API_CONTACT' AND (EXISTS ("
                    + "SELECT 1 FROM ai_call_api_call api WHERE api.id = tcl.subject_id AND api.contact_name ILIKE :leadName)"
                    + " OR EXISTS (SELECT 1 FROM human_call_api_call h WHERE h.id = tcl.subject_id"
                    + " AND h.contact_name ILIKE :leadName))))");
            params.addValue("leadName", "%" + f.getLeadName().trim() + "%");
        }
        if (f.getHasRecording() != null) {
            sb.append(f.getHasRecording()
                    ? " AND tcl.recording_storage_key IS NOT NULL"
                    : " AND tcl.recording_storage_key IS NULL");
        }
        if (includeChips && Boolean.TRUE.equals(f.getMissedInbound())) {
            sb.append(" AND tcl.direction = 'INBOUND'"
                    + " AND tcl.status IN ('NO_ANSWER','BUSY','FAILED','CANCELLED')");
            sb.append(NO_LATER_CONNECT);
        }
        if (includeChips && Boolean.TRUE.equals(f.getCallbacksDue())) {
            sb.append(" AND COALESCE(tcl.callback_at, acr.ai_callback_at AT TIME ZONE 'UTC') IS NOT NULL"
                    + " AND COALESCE(tcl.callback_at, acr.ai_callback_at AT TIME ZONE 'UTC') <= :nowUtc");
            sb.append(NO_LATER_CONNECT);
            params.addValue("nowUtc", LocalDateTime.now(ZoneOffset.UTC), Types.TIMESTAMP);
        }
        return sb.toString();
    }

    /**
     * Requested disposition keys reduced to their normalized form, blanks dropped.
     * Empty out ⇒ no disposition predicate at all (same as an absent filter), never a
     * predicate that can't match — a selection of only-blank keys is not a request for
     * zero rows.
     */
    private static List<String> normalizedDispositionKeys(List<String> requested) {
        if (requested == null || requested.isEmpty()) return List.of();
        return requested.stream()
                .map(CallDispositionOptionsService::normalizeKey)
                .filter(k -> !k.isEmpty())
                .distinct()
                .toList();
    }

    /** Whitelisted sort — never interpolate user input into SQL. */
    private String orderBy(CallSearchFilterDTO f) {
        String col = switch (f.getSortBy() == null ? "" : f.getSortBy().trim().toUpperCase()) {
            case "DURATION" -> "tcl.duration_seconds";
            case "STATUS" -> "tcl.status";
            default -> "COALESCE(tcl.start_time, tcl.created_at)";
        };
        String dir = "ASC".equalsIgnoreCase(f.getSortDirection()) ? "ASC" : "DESC";
        return " ORDER BY " + col + " " + dir + " NULLS LAST, tcl.id DESC";
    }

    // ── helpers (mirrors CallingReportService) ──────────────────────────────────

    private record Window(LocalDateTime fromUtc, LocalDateTime toUtc) {
    }

    /**
     * Instant bounds win over calendar dates when given: the "last 1 h / 3 h / 24 h"
     * presets (2026-09-11) are wall-clock windows, which day-granular dates cannot
     * express. Both are UTC epoch millis; a missing toTs means "now".
     */
    private Window resolveWindow(CallSearchFilterDTO f, ZoneId tz) {
        if (f.getFromTs() != null) {
            LocalDateTime from = LocalDateTime.ofEpochSecond(Math.floorDiv(f.getFromTs(), 1000L), 0, ZoneOffset.UTC);
            LocalDateTime to = f.getToTs() != null
                    ? LocalDateTime.ofEpochSecond(Math.floorDiv(f.getToTs(), 1000L), 0, ZoneOffset.UTC)
                    : LocalDateTime.now(ZoneOffset.UTC).plusMinutes(1);
            return new Window(from, to);
        }
        return resolveWindow(f.getFromDate(), f.getToDate(), tz);
    }

    private Window resolveWindow(String fromDate, String toDate, ZoneId tz) {
        LocalDate today = LocalDate.now(tz);
        LocalDate to = parseOr(toDate, today);
        LocalDate from = parseOr(fromDate, to.minusDays(DEFAULT_RANGE_DAYS - 1L));
        return new Window(
                from.atStartOfDay(tz).withZoneSameInstant(ZoneOffset.UTC).toLocalDateTime(),
                to.plusDays(1).atStartOfDay(tz).withZoneSameInstant(ZoneOffset.UTC).toLocalDateTime());
    }

    private ZoneId safeZone(LeadReportSettingService.ReportSettings settings) {
        try {
            return ZoneId.of(settings.timezone());
        } catch (Exception e) {
            return FALLBACK_ZONE;
        }
    }

    private static String connectedCsv(LeadReportSettingService.ReportSettings settings) {
        var statuses = settings != null ? settings.connectedCallStatuses() : null;
        if (statuses == null || statuses.isEmpty()) return "COMPLETED";
        return String.join(",", statuses);
    }

    private Map<String, String> fetchNames(Collection<String> userIds) {
        List<String> ids = userIds.stream().filter(id -> id != null && !id.isBlank()).distinct().toList();
        // HashMap, NOT Map.of(): the callers do names.get(row.getCounsellorUserId()), and an
        // unassigned INBOUND row has a null counsellor_user_id. Map.of() is an immutable map
        // whose get() rejects a null key with an NPE; HashMap.get(null) returns null (correct —
        // no counsellor, no name). Without this, a page of only-unassigned inbound calls 500s.
        if (ids.isEmpty()) return new HashMap<>();
        Map<String, String> out = new HashMap<>();
        try {
            for (UserDTO u : authService.getUsersFromAuthServiceByUserIds(new ArrayList<>(ids))) {
                if (u != null && u.getId() != null) out.put(u.getId(), u.getFullName());
            }
        } catch (Exception e) {
            log.warn("[CallSearch] counsellor name hydration failed: {}", e.getMessage());
        }
        return out;
    }

    private static String mask(String number, boolean unmask) {
        if (unmask || number == null || number.length() < 4) return number;
        String tail = number.substring(number.length() - 4);
        return "*".repeat(number.length() - 4) + tail;
    }

    private static Integer getNullableInt(java.sql.ResultSet rs, String col) throws java.sql.SQLException {
        int v = rs.getInt(col);
        return rs.wasNull() ? null : v;
    }

    private static LocalDate parseOr(String iso, LocalDate fallback) {
        if (iso == null || iso.isBlank()) return fallback;
        try {
            return LocalDate.parse(iso.trim());
        } catch (Exception e) {
            return fallback;
        }
    }

    private static boolean notBlank(String s) {
        return s != null && !s.isBlank();
    }

    private static String trimToNull(String s) {
        return (s == null || s.isBlank()) ? null : s.trim();
    }
}
