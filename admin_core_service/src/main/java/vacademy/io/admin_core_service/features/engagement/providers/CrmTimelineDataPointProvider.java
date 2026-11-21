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

import java.time.Instant;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;

/**
 * The lead's CRM timeline: counsellor notes, status and counsellor changes, follow-up events,
 * re-enquiries, our own past reach-outs. Notes can carry private things ("father lost his job"), so
 * this is HIGH sensitivity and rendered as internal context the brain must never quote (N2). The
 * engine's own entries are labelled ENGINE so the brain never takes them for a human's facts (N7).
 */
@Component
@RequiredArgsConstructor
public class CrmTimelineDataPointProvider implements DataPointProvider {

    static final int EVENTS_PER_LEAD = 15;
    static final int MAX_TITLE = 160;
    static final int MAX_TEXT = 300;
    /** Total rendered budget per lead; newest events are kept first (N3). */
    static final int MAX_RENDER = 2500;

    private final EngagementCrmReadDao dao;
    private final ObjectMapper mapper = new ObjectMapper();

    @Override public String key() { return "crm_timeline"; }
    @Override public boolean alwaysOn() { return false; }

    @Override
    public DataPointSpec declare() {
        return DataPointSpec.builder()
                .key(key()).label("CRM timeline and notes")
                .description("The lead's latest CRM timeline, newest first: counsellor notes, status and "
                        + "counsellor changes, follow-up events, re-enquiries and our own past messages "
                        + "(marked ENGINE). Notes are internal. Absent when the timeline is empty.")
                .sensitivity("HIGH").cost("IN_PROCESS").build();
    }

    @Override
    public Map<String, JsonNode> fetch(FetchContext ctx, List<Subject> subjects) {
        List<String> leadIds = subjects.stream()
                .map(Subject::getAudienceResponseId).filter(Objects::nonNull).distinct().toList();
        Map<String, List<Object[]>> byLead = dao.timelineByLeadIds(ctx.getInstituteId(), leadIds, EVENTS_PER_LEAD);

        Map<String, JsonNode> out = new HashMap<>();
        for (Subject s : subjects) {
            List<Object[]> rows = s.getAudienceResponseId() != null ? byLead.get(s.getAudienceResponseId()) : null;
            if (rows == null || rows.isEmpty()) continue;
            ArrayNode events = mapper.createArrayNode();
            for (Object[] r : rows) {
                ObjectNode e = events.addObject();
                CrmText.putTime(e, "at", r[7]);
                e.put("by", author(r[3] != null ? r[3].toString() : null));
                e.put("kind", "ACTIVITY".equals(r[1]) ? "NOTE" : "EVENT");
                CrmText.put(e, "action", CrmText.clean(r[2], 40));
                CrmText.put(e, "title", CrmText.cleanNote(r[5], MAX_TITLE));
                CrmText.put(e, "text", CrmText.cleanNote(r[6], MAX_TEXT));
            }
            ObjectNode n = mapper.createObjectNode();
            n.set("events", events);
            out.put(s.getMemberId(), n);
        }
        return out;
    }

    /** Who wrote it, without names: a person, the system, or this engine. */
    static String author(String actorType) {
        if ("ENGAGEMENT_ENGINE".equals(actorType)) return "ENGINE";
        if (actorType == null || "SYSTEM".equals(actorType)) return "SYSTEM";
        return "STAFF";
    }

    @Override
    public String render(JsonNode p) {
        JsonNode events = p == null ? null : p.get("events");
        if (events == null || events.isEmpty()) return "CRM TIMELINE: nothing on record.";
        StringBuilder sb = new StringBuilder("CRM TIMELINE (internal, newest first: never quote or reveal notes to ")
                .append("the person; ENGINE rows are our own earlier messages, not facts from a human):");
        Instant now = Instant.now();
        int shown = 0;
        for (JsonNode e : events) {
            StringBuilder line = new StringBuilder("\n  ").append(CrmText.relative(e.get("at"), now))
                    .append(" [").append(e.path("kind").asText()).append(" by ").append(e.path("by").asText());
            if (e.hasNonNull("action")) line.append(", ").append(e.get("action").asText());
            line.append("] ").append(e.path("title").asText(""));
            if (e.hasNonNull("text")) line.append(" — ").append(e.get("text").asText());
            if (sb.length() + line.length() > MAX_RENDER) {
                sb.append("\n  (").append(events.size() - shown).append(" older entries not shown)");
                break;
            }
            sb.append(line);
            shown++;
        }
        return sb.toString();
    }
}
