package vacademy.io.admin_core_service.features.telephony.publicapi;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Service;
import vacademy.io.admin_core_service.features.telephony.enums.ProviderType;
import vacademy.io.admin_core_service.features.telephony.persistence.entity.AiCallResult;
import vacademy.io.admin_core_service.features.telephony.persistence.entity.TelephonyCallLog;
import vacademy.io.admin_core_service.features.telephony.persistence.repository.AiCallResultRepository;
import vacademy.io.admin_core_service.features.telephony.persistence.repository.TelephonyCallLogRepository;
import vacademy.io.admin_core_service.features.telephony.publicapi.entity.AiCallApiCall;
import vacademy.io.admin_core_service.features.telephony.publicapi.repository.AiCallApiCallRepository;

import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.*;

/**
 * Inbound calls in the public calling API (v1.4): calls a contact made TO one of the
 * institute's numbers (an IVR menu, an AI agent answering, or a counsellor picking up).
 *
 * <p>They have no API row: the only record is the telephony_call_log row the inbound
 * webhook writes (InboundRoutingService, direction INBOUND), plus the AI report when an
 * agent answered. Their public id is {@code inb_<call log id>} and their object is
 * {@code inbound_call}, so a client can never mistake one for a call it placed.
 *
 * <p>GET /v1/calls lists them with {@code direction=inbound}, or together with the API's
 * own calls with {@code direction=all}; the default stays {@code outbound} (exactly the
 * pre-v1.4 list), so an existing integration sees no new rows. Read only: nothing here
 * writes, and inbound calls send no webhooks.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class InboundCallApiService {

    static final String ID_PREFIX = "inb_";
    public static final String DIRECTION_OUTBOUND = "outbound";
    public static final String DIRECTION_INBOUND = "inbound";
    public static final String DIRECTION_ALL = "all";
    /** A call that has not reported an end this long after it came in is treated as lost. */
    static final Duration STUCK_AFTER = Duration.ofHours(2);
    /** Airtel rows only settle when the next CDR import runs. */
    static final Duration STUCK_AFTER_AIRTEL = Duration.ofHours(24);
    static final String NO_RESULT = "No final status was received for this call.";

    private final NamedParameterJdbcTemplate jdbc;
    private final TelephonyCallLogRepository callLogRepository;
    private final AiCallResultRepository resultRepository;
    private final AiCallApiCallRepository apiCallRepository;
    private final AiCallingApiViews views;
    private final AiCallingUsageService usage;

    public static boolean isInboundId(String id) {
        return id != null && id.startsWith(ID_PREFIX);
    }

    /** outbound (default) | inbound | all; anything else is a 400. */
    public static String normaliseDirection(String raw) {
        if (raw == null || raw.isBlank()) return DIRECTION_OUTBOUND;
        String d = raw.trim().toLowerCase(Locale.ROOT);
        if (!Set.of(DIRECTION_OUTBOUND, DIRECTION_INBOUND, DIRECTION_ALL).contains(d)) {
            throw AiCallingApiException.invalid("direction must be outbound, inbound or all.");
        }
        return d;
    }

    // ── One call ─────────────────────────────────────────────────────────────────

    public Map<String, Object> get(AiCallingApiAuth.Principal p, String id) {
        TelephonyCallLog l = load(p.instituteId(), id)
                .orElseThrow(() -> AiCallingApiException.notFound("Call " + id));
        return view(p.instituteId(), l, AiCallingApiViews.newestOf(resultRepository.findByCallLogIdIn(List.of(l.getId()))));
    }

    /** An inbound call cannot be canceled: it was never waiting in our queue. */
    public AiCallingApiException notCancelable(AiCallingApiAuth.Principal p, String id) {
        if (load(p.instituteId(), id).isEmpty()) return AiCallingApiException.notFound("Call " + id);
        return new AiCallingApiException(HttpStatus.CONFLICT, "call_not_cancelable",
                "Inbound calls cannot be canceled.", Map.of("direction", DIRECTION_INBOUND));
    }

    private Optional<TelephonyCallLog> load(String instituteId, String publicId) {
        if (!isInboundId(publicId)) return Optional.empty();
        String logId = publicId.substring(ID_PREFIX.length());
        if (logId.isBlank()) return Optional.empty();
        return callLogRepository.findById(logId).filter(l -> instituteId.equals(l.getInstituteId()) && isInbound(l));
    }

    private static boolean isInbound(TelephonyCallLog l) {
        return "INBOUND".equalsIgnoreCase(l.getDirection()) && !"MANUAL".equalsIgnoreCase(l.getProviderType());
    }

    // ── Lists ────────────────────────────────────────────────────────────────────

    private record Cursor(Instant ts, String id) {
    }

    /** One list row before it is rendered: its sort key and the record behind it. */
    private record Entry(Instant ts, String id, AiCallApiCall apiCall, String callLogId) {
    }

    /**
     * direction=inbound: inbound calls only. direction=all: the API's own calls and inbound
     * calls in one list, newest first, under one cursor. Both are ordered by (created_at,
     * public id) descending, so starting_after may be either kind of id.
     */
    public Map<String, Object> list(AiCallingApiAuth.Principal p, String direction, Instant since, int limit,
                                    String startingAfter) {
        int lim = Math.max(1, Math.min(100, limit <= 0 ? 25 : limit));
        Cursor before = cursor(p.instituteId(), startingAfter);
        List<Entry> inbound = inboundPage(p.instituteId(), since, before, lim + 1);
        List<Entry> rows;
        if (DIRECTION_ALL.equals(direction)) {
            List<Entry> outbound = new ArrayList<>();
            for (AiCallApiCall c : apiCallRepository.page(p.instituteId(), null, null, since,
                    before == null ? null : before.ts(), before == null ? null : before.id(), lim + 1)) {
                outbound.add(new Entry(c.getCreatedAt(), c.getId(), c, null));
            }
            rows = merge(outbound, inbound);
        } else {
            rows = inbound;
        }
        boolean hasMore = rows.size() > lim;
        List<Entry> page = rows.subList(0, Math.min(lim, rows.size()));

        List<String> logIds = new ArrayList<>();
        for (Entry e : page) if (e.callLogId() != null) logIds.add(e.callLogId());
        Map<String, TelephonyCallLog> logs = new HashMap<>();
        Map<String, List<AiCallResult>> results = new HashMap<>();
        if (!logIds.isEmpty()) {
            for (TelephonyCallLog l : callLogRepository.findAllById(logIds)) logs.put(l.getId(), l);
            for (AiCallResult r : resultRepository.findByCallLogIdIn(logIds)) {
                results.computeIfAbsent(r.getCallLogId(), k -> new ArrayList<>()).add(r);
            }
        }
        List<Map<String, Object>> data = new ArrayList<>();
        for (Entry e : page) {
            if (e.apiCall() != null) {
                data.add(views.call(e.apiCall(), false));
            } else {
                TelephonyCallLog l = logs.get(e.callLogId());
                if (l == null) continue;
                data.add(view(p.instituteId(), l, AiCallingApiViews.newestOf(
                        results.getOrDefault(l.getId(), List.of()))));
            }
        }
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("object", "list");
        out.put("data", data);
        out.put("has_more", hasMore);
        return out;
    }

    /** Two lists already sorted newest first, merged newest first (ties: the larger id first). */
    static List<Entry> merge(List<Entry> a, List<Entry> b) {
        List<Entry> out = new ArrayList<>(a.size() + b.size());
        int i = 0, j = 0;
        while (i < a.size() || j < b.size()) {
            if (j >= b.size()) out.add(a.get(i++));
            else if (i >= a.size()) out.add(b.get(j++));
            else out.add(newerFirst(a.get(i), b.get(j)) ? a.get(i++) : b.get(j++));
        }
        return out;
    }

    private static boolean newerFirst(Entry x, Entry y) {
        int c = x.ts().compareTo(y.ts());
        return c != 0 ? c > 0 : x.id().compareTo(y.id()) > 0;
    }

    private Cursor cursor(String instituteId, String startingAfter) {
        if (startingAfter == null || startingAfter.isBlank()) return null;
        String id = startingAfter.trim();
        if (isInboundId(id)) {
            List<Map<String, Object>> rows = jdbc.queryForList("""
                    SELECT created_at AT TIME ZONE 'UTC' AS created_ts FROM telephony_call_log
                     WHERE id = :id AND institute_id = :i AND upper(direction) = 'INBOUND'
                    """, new MapSqlParameterSource().addValue("id", id.substring(ID_PREFIX.length()))
                    .addValue("i", instituteId));
            Instant ts = rows.isEmpty() ? null : instant(rows.get(0).get("created_ts"));
            if (ts == null) throw AiCallingApiException.invalid("starting_after is not a call of this account.");
            return new Cursor(ts, id);
        }
        AiCallApiCall c = apiCallRepository.findByIdAndInstituteId(id, instituteId)
                .orElseThrow(() -> AiCallingApiException.invalid("starting_after is not a call of this account."));
        return new Cursor(c.getCreatedAt(), c.getId());
    }

    /**
     * One page of inbound call ids, newest first. telephony_call_log.created_at is a naive
     * UTC timestamp, so the instants are converted at the boundary in SQL; served by
     * idx_tcl_institute (institute_id, created_at DESC). MANUAL rows are uploads of calls
     * made off the platform, never calls that came in here.
     */
    private List<Entry> inboundPage(String instituteId, Instant since, Cursor before, int lim) {
        StringBuilder sql = new StringBuilder("""
                SELECT l.id, l.created_at AT TIME ZONE 'UTC' AS created_ts
                  FROM telephony_call_log l
                 WHERE l.institute_id = :i
                   AND upper(l.direction) = 'INBOUND'
                   AND l.provider_type <> 'MANUAL'
                """);
        MapSqlParameterSource params = new MapSqlParameterSource().addValue("i", instituteId).addValue("lim", lim);
        if (since != null) {
            sql.append(" AND l.created_at >= (CAST(:since AS timestamptz) AT TIME ZONE 'UTC')");
            params.addValue("since", OffsetDateTime.ofInstant(since, ZoneOffset.UTC));
        }
        if (before != null) {
            sql.append(" AND (l.created_at < (CAST(:beforeTs AS timestamptz) AT TIME ZONE 'UTC')")
                    .append(" OR (l.created_at = (CAST(:beforeTs AS timestamptz) AT TIME ZONE 'UTC')")
                    .append(" AND ('" + ID_PREFIX + "' || l.id) < :beforeId))");
            params.addValue("beforeTs", OffsetDateTime.ofInstant(before.ts(), ZoneOffset.UTC));
            params.addValue("beforeId", before.id());
        }
        sql.append(" ORDER BY l.created_at DESC, l.id DESC LIMIT :lim");
        List<Entry> out = new ArrayList<>();
        for (Map<String, Object> row : jdbc.queryForList(sql.toString(), params)) {
            String logId = (String) row.get("id");
            Instant ts = instant(row.get("created_ts"));
            out.add(new Entry(ts == null ? Instant.EPOCH : ts, ID_PREFIX + logId, null, logId));
        }
        return out;
    }

    private static Instant instant(Object v) {
        if (v instanceof Timestamp t) return t.toInstant();
        if (v instanceof OffsetDateTime o) return o.toInstant();
        if (v instanceof Instant i) return i;
        return null;
    }

    // ── The object ───────────────────────────────────────────────────────────────

    record State(String status, String reason) {
    }

    /**
     * Public status from the call log: ringing until someone (agent or counsellor) picks
     * up, in_progress while connected, then completed / no_answer / busy / failed /
     * canceled. A call that never reports an end is failed after {@link #STUCK_AFTER}.
     */
    static State state(TelephonyCallLog l, Instant now) {
        String ls = l.getStatus() == null ? "" : l.getStatus();
        String reason = l.getTerminationReason();
        return switch (ls) {
            case "COMPLETED" -> new State("completed", null);
            case "NO_ANSWER" -> new State("no_answer", reason);
            case "BUSY" -> new State("busy", reason);
            case "FAILED" -> new State("failed", reason);
            case "CANCELLED" -> new State("canceled", reason);
            default -> {
                Instant came = l.getCreatedAt() == null ? null : l.getCreatedAt().toInstant();
                Duration stuck = ProviderType.AIRTEL.equalsIgnoreCase(l.getProviderType()) ? STUCK_AFTER_AIRTEL : STUCK_AFTER;
                if (came != null && came.plus(stuck).isBefore(now)) yield new State("failed", NO_RESULT);
                boolean talking = "IN_PROGRESS".equals(ls) || "COUNSELLOR_ANSWERED".equals(ls);
                yield new State(talking ? "in_progress" : "ringing", null);
            }
        };
    }

    Map<String, Object> view(String instituteId, TelephonyCallLog l, AiCallResult r) {
        Instant now = Instant.now();
        State s = state(l, now);
        boolean ended = !"ringing".equals(s.status()) && !"in_progress".equals(s.status());
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", ID_PREFIX + l.getId());
        m.put("object", "inbound_call");
        m.put("direction", DIRECTION_INBOUND);
        m.put("status", s.status());
        if (s.reason() != null && !s.reason().isBlank()) m.put("status_reason", s.reason());
        // The inbound webhook stores the caller in from_number and our number in to_number;
        // a row first created from an AI report has only the caller, in to_number.
        boolean hasFrom = l.getFromNumber() != null && !l.getFromNumber().isBlank();
        m.put("phone_number", hasFrom ? l.getFromNumber() : l.getToNumber());
        m.put("called_number", hasFrom ? l.getToNumber() : null);
        m.put("ivr_selection", l.getIvrSelection());
        m.put("handled_by", handledBy(l, r));
        m.put("agent_id", r != null && ProviderType.VACADEMY_AI.equalsIgnoreCase(r.getProvider()) ? r.getCampaignId() : null);
        m.put("counsellor_id", l.getCounsellorUserId());
        Map<String, Object> contact = new LinkedHashMap<>();
        contact.put("name", r == null ? null : r.getCustomerName());
        m.put("contact", contact);
        m.put("crm_lead_linked", l.getResponseId() != null);

        Integer duration = l.getDurationSeconds() != null ? l.getDurationSeconds()
                : r != null ? r.getDurationSeconds() : null;
        m.put("duration_seconds", duration);
        m.put("created_at", iso(l.getCreatedAt()));
        Instant endedAt = ended ? endedAt(l, duration, now) : null;
        m.put("answered_at", iso(answeredAt(l, s.status(), endedAt, duration, now)));
        m.put("ended_at", endedAt == null ? null : endedAt.toString());

        String recordingUrl = views.recordingUrl(l);
        m.put("recording_url", recordingUrl);
        m.put("recording_expires_at", recordingUrl == null ? null
                : now.plus(AiCallingApiViews.RECORDING_LINK_TTL).toString());
        m.put("cost", usage.costOfCallLog(instituteId, l, r));
        m.put("outcome", views.outcome(r));
        return m;
    }

    /** ai_agent when an agent took the call, counsellor when a person did, else null (missed). */
    static String handledBy(TelephonyCallLog l, AiCallResult r) {
        if (r != null || ProviderType.VACADEMY_AI.equalsIgnoreCase(l.getProviderType())) return "ai_agent";
        if (l.getCounsellorUserId() != null && !l.getCounsellorUserId().isBlank()) return "counsellor";
        return null;
    }

    /** The carrier's end time, else start + talk time, else when the row last changed; never in the future. */
    static Instant endedAt(TelephonyCallLog l, Integer duration, Instant now) {
        if (l.getEndTime() != null && !l.getEndTime().toInstant().isAfter(now)) return l.getEndTime().toInstant();
        Timestamp startTs = l.getAnswerTime() != null ? l.getAnswerTime() : l.getStartTime();
        if (startTs != null && duration != null && !startTs.toInstant().plusSeconds(duration).isAfter(now)) {
            return startTs.toInstant().plusSeconds(duration);
        }
        if (l.getUpdatedAt() != null && !l.getUpdatedAt().toInstant().isAfter(now)) return l.getUpdatedAt().toInstant();
        return now;
    }

    /** The carrier's answer time, else end − talk time for a connected call; never in the future. */
    static Instant answeredAt(TelephonyCallLog l, String status, Instant endedAt, Integer duration, Instant now) {
        if (l.getAnswerTime() != null && !l.getAnswerTime().toInstant().isAfter(now)) return l.getAnswerTime().toInstant();
        if ("completed".equals(status) && endedAt != null && duration != null && duration > 0) {
            Instant a = endedAt.minusSeconds(duration);
            return a.isAfter(now) ? null : a;
        }
        return null;
    }

    private static String iso(Timestamp t) {
        return t == null ? null : t.toInstant().toString();
    }

    private static String iso(Instant i) {
        return i == null ? null : i.toString();
    }
}
