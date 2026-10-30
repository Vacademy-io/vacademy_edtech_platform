package vacademy.io.admin_core_service.features.engagement.providers;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;
import vacademy.io.admin_core_service.features.engagement.service.EngagementCrmReadDao;
import vacademy.io.admin_core_service.features.engagement.spi.DataPointProvider;
import vacademy.io.admin_core_service.features.engagement.spi.DataPointSpec;
import vacademy.io.admin_core_service.features.engagement.spi.FetchContext;
import vacademy.io.admin_core_service.features.engagement.spi.Subject;

import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;

/**
 * The lead's last calls, human or AI, with what was learned on them: the call analysis (summary,
 * sentiment, conversion likelihood, outcome), the voice bot's own result (follow-up gist, callback the
 * lead asked for) and what the call promised and whether it went out (C-5). Keyed by lead id, unlike
 * the phone-matched {@code calls} data point, which stays as it is for the engines using it.
 *
 * <p>An analysis that is not COMPLETED is reported as such and its fields are dropped, so the brain
 * never reads a half-written or failed analysis as a verdict (C-8, C-9).
 */
@Component
@RequiredArgsConstructor
public class AiCallsDataPointProvider implements DataPointProvider {

    static final int CALLS_PER_LEAD = 3;
    static final int MAX_TEXT = 300;

    private final EngagementCrmReadDao dao;
    private final ObjectMapper mapper = new ObjectMapper();

    @Override public String key() { return "ai_calls"; }
    @Override public boolean alwaysOn() { return false; }

    @Override
    public DataPointSpec declare() {
        return DataPointSpec.builder()
                .key(key()).label("Calls with AI insights")
                .description("The lead's last 3 calls (human or AI voice agent): outcome, the call analysis "
                        + "(summary, sentiment, conversion likelihood) once it is complete, the callback "
                        + "they asked for, the counsellor's call notes, and what the call promised to send "
                        + "and whether it was sent. Absent when the lead has no calls.")
                .sensitivity("MEDIUM").cost("IN_PROCESS").build();
    }

    @Override
    public Map<String, JsonNode> fetch(FetchContext ctx, List<Subject> subjects) {
        String instituteId = ctx.getInstituteId();
        List<String> leadIds = subjects.stream()
                .map(Subject::getAudienceResponseId).filter(Objects::nonNull).distinct().toList();
        Map<String, List<Object[]>> callsByLead = dao.callsByLeadIds(instituteId, leadIds, CALLS_PER_LEAD);
        Map<String, List<Object[]>> unplaced = dao.unplacedCallsByLeadIds(instituteId, leadIds);
        if (callsByLead.isEmpty() && unplaced.isEmpty()) return new HashMap<>();

        List<String> callIds = new ArrayList<>();
        Instant oldest = null;
        for (List<Object[]> calls : callsByLead.values()) {
            for (Object[] c : calls) {
                callIds.add((String) c[1]);
                Instant at = CrmText.instant(c[6]);
                if (at != null && (oldest == null || at.isBefore(oldest))) oldest = at;
            }
        }
        // The bot posts its result after the call ends; a day of slack covers any clock skew.
        Instant since = (oldest != null ? oldest : Instant.now()).minus(Duration.ofDays(1));
        Map<String, Object[]> botByCall = dao.aiCallResultsByCallLogIds(instituteId, callIds, since);
        Map<String, List<Object[]>> promisesByCall = dao.callPromisesByLeadIds(instituteId, leadIds);

        Map<String, JsonNode> out = new HashMap<>();
        for (Subject s : subjects) {
            List<Object[]> calls = s.getAudienceResponseId() != null ? callsByLead.get(s.getAudienceResponseId()) : null;
            List<Object[]> missed = s.getAudienceResponseId() != null ? unplaced.get(s.getAudienceResponseId()) : null;
            if ((calls == null || calls.isEmpty()) && (missed == null || missed.isEmpty())) continue;
            ObjectNode n = mapper.createObjectNode();
            ArrayNode arr = n.putArray("calls");
            if (calls != null) {
                for (Object[] c : calls) {
                    arr.add(call(c, botByCall.get((String) c[1]), promisesByCall.get((String) c[1])));
                }
            }
            if (missed != null && !missed.isEmpty()) {
                ArrayNode ma = n.putArray("notPlaced");
                for (Object[] m : missed) {
                    ObjectNode mo = ma.addObject();
                    CrmText.putTime(mo, "at", m[3]);
                    CrmText.put(mo, "status", CrmText.clean(m[1], 16));
                    CrmText.put(mo, "reason", CrmText.cleanNote(m[2], 160));
                }
            }
            out.put(s.getMemberId(), n);
        }
        return out;
    }

    ObjectNode call(Object[] c, Object[] bot, List<Object[]> promises) {
        ObjectNode o = mapper.createObjectNode();
        CrmText.putTime(o, "at", c[6]);
        o.put("by", c[2] != null && EngagementCrmReadDao.isAiProvider(c[2].toString()) ? "AI_AGENT" : "COUNSELLOR");
        CrmText.put(o, "direction", CrmText.clean(c[3], 16));
        CrmText.put(o, "status", CrmText.clean(c[4], 32));
        if (c[5] != null) o.put("durationSeconds", ((Number) c[5]).intValue());
        CrmText.put(o, "disposition", CrmText.clean(c[7], 64));
        CrmText.put(o, "counsellorNotes", CrmText.cleanNote(c[8], MAX_TEXT));

        String ciStatus = c[9] != null ? c[9].toString() : null;
        if (ciStatus == null) {
            o.put("analysis", "NONE");
        } else if ("COMPLETED".equals(ciStatus)) {
            o.put("analysis", "COMPLETED");
            CrmText.put(o, "summary", CrmText.cleanNote(c[10], MAX_TEXT));
            CrmText.put(o, "sentiment", CrmText.clean(c[11], 16));
            CrmText.put(o, "conversionLikelihood", CrmText.clean(c[12], 8));
            CrmText.put(o, "outcome", CrmText.clean(c[13], 32));
            CrmText.put(o, "goal", CrmText.cleanNote(c[14], 160));
        } else if ("FAILED".equals(ciStatus) || "SKIPPED".equals(ciStatus)) {
            o.put("analysis", "UNAVAILABLE");
        } else {
            o.put("analysis", "PROCESSING"); // PENDING / TRANSCRIBING / ANALYZING
        }

        if (bot != null) {
            CrmText.put(o, "agentSummary", CrmText.cleanNote(bot[1], MAX_TEXT));
            CrmText.put(o, "nextStep", CrmText.clean(bot[2], 16));
            CrmText.put(o, "nextStepWhy", CrmText.cleanNote(bot[3], 240));
            CrmText.putTime(o, "callbackAt", bot[4]);
            CrmText.put(o, "callbackAsked", CrmText.clean(bot[5], 128));
            CrmText.put(o, "interest", CrmText.clean(bot[6], 64));
        }
        if (promises != null && !promises.isEmpty()) {
            ArrayNode pa = o.putArray("promised");
            for (Object[] p : promises) {
                ObjectNode po = pa.addObject();
                CrmText.put(po, "channel", CrmText.clean(p[1], 16));
                po.put("sent", "SENT".equals(p[2]));
                CrmText.put(po, "status", CrmText.clean(p[2], 16));
                CrmText.put(po, "what", CrmText.cleanNote(p[3], 160));
            }
        }
        return o;
    }

    @Override
    public String render(JsonNode p) {
        JsonNode calls = p == null ? null : p.get("calls");
        JsonNode notPlaced = p == null ? null : p.get("notPlaced");
        boolean noCalls = calls == null || calls.isEmpty();
        if (noCalls && (notPlaced == null || notPlaced.isEmpty())) return "CALLS: none on record.";
        Instant now = Instant.now();
        StringBuilder sb = new StringBuilder(noCalls ? "CALLS: none connected."
                : "CALLS (newest first; summaries and notes are internal, never quote them):");
        if (notPlaced != null) {
            for (JsonNode m : notPlaced) {
                sb.append("\n  ").append(CrmText.relative(m.get("at"), now))
                        .append(" AI call asked for but NEVER CONNECTED (").append(m.path("status").asText("?"))
                        .append(m.hasNonNull("reason") ? ": " + m.get("reason").asText() : "")
                        .append("): the person was not reached by phone");
            }
        }
        if (noCalls) return sb.toString();
        for (JsonNode c : calls) {
            sb.append("\n  ").append(CrmText.relative(c.get("at"), now)).append(" ")
                    .append(c.path("by").asText()).append(" ").append(c.path("direction").asText("?").toLowerCase())
                    .append(" ").append(c.path("status").asText("?"));
            if (c.has("durationSeconds")) sb.append(" ").append(c.get("durationSeconds").asInt()).append("s");
            if (c.hasNonNull("disposition")) sb.append(" disposition=").append(c.get("disposition").asText());
            switch (c.path("analysis").asText()) {
                case "COMPLETED" -> {
                    if (c.hasNonNull("outcome")) sb.append(" outcome=").append(c.get("outcome").asText());
                    if (c.hasNonNull("sentiment")) sb.append(" sentiment=").append(c.get("sentiment").asText());
                    if (c.hasNonNull("conversionLikelihood")) {
                        sb.append(" likelihood=").append(c.get("conversionLikelihood").asText());
                    }
                    if (c.hasNonNull("summary")) sb.append("\n    summary: ").append(c.get("summary").asText());
                }
                case "PROCESSING" -> sb.append(" (call analysis still processing: wait for it, do not guess)");
                case "UNAVAILABLE" -> sb.append(" (no call analysis available)");
                default -> { }
            }
            if (c.hasNonNull("agentSummary") && !c.hasNonNull("summary")) {
                sb.append("\n    agent summary: ").append(c.get("agentSummary").asText());
            }
            if (c.hasNonNull("nextStepWhy")) sb.append("\n    next step: ").append(c.get("nextStepWhy").asText());
            if (c.hasNonNull("callbackAt") || c.hasNonNull("callbackAsked")) {
                sb.append("\n    asked for a callback: ");
                if (c.hasNonNull("callbackAt")) sb.append(CrmText.relative(c.get("callbackAt"), now)).append(" ");
                if (c.hasNonNull("callbackAsked")) sb.append("\"").append(c.get("callbackAsked").asText()).append("\"");
            }
            if (c.hasNonNull("counsellorNotes")) sb.append("\n    counsellor notes: ").append(c.get("counsellorNotes").asText());
            JsonNode promised = c.get("promised");
            if (promised != null) {
                for (JsonNode pr : promised) {
                    sb.append("\n    promised on the call (").append(pr.path("channel").asText("?")).append("): ")
                            .append(pr.path("what").asText("?")).append(" — ")
                            .append(pr.path("sent").asBoolean() ? "ALREADY SENT, do not send again" : "not sent yet ("
                                    + pr.path("status").asText("?") + ")");
                }
            }
        }
        return sb.toString();
    }
}
