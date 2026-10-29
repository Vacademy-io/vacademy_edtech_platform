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
        if (callsByLead.isEmpty()) return new HashMap<>();

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
            if (calls == null || calls.isEmpty()) continue;
            ObjectNode n = mapper.createObjectNode();
            ArrayNode arr = n.putArray("calls");
            for (Object[] c : calls) {
                arr.add(call(c, botByCall.get((String) c[1]), promisesByCall.get((String) c[1])));
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
        if (calls == null || calls.isEmpty()) return "CALLS: none on record.";
        Instant now = Instant.now();
        StringBuilder sb = new StringBuilder("CALLS (newest first; summaries and notes are internal, never quote them):");
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
