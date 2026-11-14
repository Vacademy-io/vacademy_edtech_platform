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
 * The counsellor follow-ups on a lead: what is open (and whether it is overdue) and how the last one
 * closed. Lets the brain hold back while a counsellor is due to call today (F-1) and treat a follow-up
 * closed as not interested like a lost lead (F-6).
 */
@Component
@RequiredArgsConstructor
public class CrmFollowupsDataPointProvider implements DataPointProvider {

    static final int MAX_OPEN = 5;
    static final int MAX_TEXT = 200;

    private final EngagementCrmReadDao dao;
    private final ObjectMapper mapper = new ObjectMapper();

    @Override public String key() { return "crm_followups"; }
    @Override public boolean alwaysOn() { return false; }

    @Override
    public DataPointSpec declare() {
        return DataPointSpec.builder()
                .key(key()).label("Counsellor follow-ups")
                .description("Open counsellor follow-ups on the lead (when, what, overdue or not, priority) "
                        + "and how the last one closed (reason, interest level, the lead's response). "
                        + "Absent when the lead has no follow-ups.")
                .sensitivity("MEDIUM").cost("IN_PROCESS").build();
    }

    @Override
    public Map<String, JsonNode> fetch(FetchContext ctx, List<Subject> subjects) {
        List<String> leadIds = subjects.stream()
                .map(Subject::getAudienceResponseId).filter(Objects::nonNull).distinct().toList();
        Map<String, List<Object[]>> byLead = dao.followupsByLeadIds(ctx.getInstituteId(), leadIds, MAX_OPEN);
        Instant now = Instant.now();

        Map<String, JsonNode> out = new HashMap<>();
        for (Subject s : subjects) {
            List<Object[]> rows = s.getAudienceResponseId() != null ? byLead.get(s.getAudienceResponseId()) : null;
            if (rows == null || rows.isEmpty()) continue;
            ObjectNode n = mapper.createObjectNode();
            ArrayNode open = n.putArray("open");
            for (Object[] r : rows) {
                if (Boolean.TRUE.equals(r[1])) {
                    ObjectNode c = n.putObject("lastClosed");
                    CrmText.putTime(c, "closedAt", r[10] != null ? r[10] : r[11]);
                    CrmText.put(c, "reason", CrmText.cleanNote(r[6], MAX_TEXT));
                    CrmText.put(c, "interest", CrmText.clean(r[7], 40));
                    CrmText.put(c, "response", CrmText.cleanNote(r[8], MAX_TEXT));
                    CrmText.put(c, "nextAction", CrmText.cleanNote(r[9], MAX_TEXT));
                } else {
                    ObjectNode o = open.addObject();
                    Instant due = CrmText.instant(r[3]);
                    CrmText.putTime(o, "dueAt", r[3]);
                    o.put("overdue", "OVERDUE".equals(r[2]) || (due != null && due.isBefore(now)));
                    o.put("priority", Boolean.TRUE.equals(r[5]));
                    CrmText.put(o, "content", CrmText.cleanNote(r[4], MAX_TEXT));
                }
            }
            out.put(s.getMemberId(), n);
        }
        return out;
    }

    @Override
    public String render(JsonNode p) {
        if (p == null) return "FOLLOW-UPS: none on record.";
        Instant now = Instant.now();
        JsonNode open = p.path("open");
        StringBuilder sb = new StringBuilder("FOLLOW-UPS (counsellor tasks, internal): ");
        if (open.isEmpty()) {
            sb.append("none open.");
        } else {
            sb.append(open.size()).append(" open:");
            for (JsonNode o : open) {
                sb.append("\n  due ").append(o.has("dueAt") ? CrmText.relative(o.get("dueAt"), now) : "(no time set)");
                if (o.path("overdue").asBoolean()) sb.append(" OVERDUE");
                if (o.path("priority").asBoolean()) sb.append(" PRIORITY");
                if (o.hasNonNull("content")) sb.append(" — ").append(o.get("content").asText());
            }
        }
        JsonNode c = p.get("lastClosed");
        if (c != null) {
            sb.append("\n  last closed ").append(CrmText.relative(c.get("closedAt"), now)).append(":");
            if (c.hasNonNull("reason")) sb.append(" reason=").append(c.get("reason").asText());
            if (c.hasNonNull("interest")) sb.append(" interest=").append(c.get("interest").asText());
            if (c.hasNonNull("response")) sb.append(" leadSaid=").append(c.get("response").asText());
            if (c.hasNonNull("nextAction")) sb.append(" next=").append(c.get("nextAction").asText());
        }
        return sb.toString();
    }
}
