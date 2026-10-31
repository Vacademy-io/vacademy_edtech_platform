package vacademy.io.admin_core_service.features.engagement.providers;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
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
 * Who owns the lead and when a human last touched it, so the brain does not talk over a counsellor
 * who is working the lead. The owner follows the CRM dashboard, so an unconverted lead's counsellor
 * shows too (the crm_lead data point reads it through the user's lead profile only). A human touch is
 * a note a person wrote or a call by a person; messages a counsellor sends by hand are not seen here.
 */
@Component
@RequiredArgsConstructor
public class OwnershipDataPointProvider implements DataPointProvider {

    private final EngagementCrmReadDao dao;
    private final ObjectMapper mapper = new ObjectMapper();

    @Override public String key() { return "ownership"; }
    @Override public boolean alwaysOn() { return false; }

    @Override
    public DataPointSpec declare() {
        return DataPointSpec.builder()
                .key(key()).label("Counsellor ownership")
                .description("Whether a counsellor owns the lead, and when a human last touched it (a note "
                        + "or a call by a person) and first responded. Messages a counsellor sends by "
                        + "hand are not tracked here. Absent for subjects who are not leads.")
                .sensitivity("MEDIUM").cost("IN_PROCESS").build();
    }

    @Override
    public Map<String, JsonNode> fetch(FetchContext ctx, List<Subject> subjects) {
        List<String> leadIds = subjects.stream()
                .map(Subject::getAudienceResponseId).filter(Objects::nonNull).distinct().toList();
        Map<String, Object[]> byLead = dao.ownershipByLeadIds(ctx.getInstituteId(), leadIds);

        Map<String, JsonNode> out = new HashMap<>();
        for (Subject s : subjects) {
            Object[] r = s.getAudienceResponseId() != null ? byLead.get(s.getAudienceResponseId()) : null;
            if (r == null) continue;
            ObjectNode n = mapper.createObjectNode();
            n.put("hasOwner", Boolean.TRUE.equals(r[1]));
            CrmText.put(n, "owner", CrmText.clean(r[2], 80));
            CrmText.putTime(n, "firstResponseAt", r[3]);
            CrmText.putTime(n, "lastActivityAt", r[4]);
            CrmText.putTime(n, "lastHumanNoteAt", r[5]);
            CrmText.putTime(n, "lastHumanCallAt", r[6]);
            Instant note = CrmText.instant(r[5]);
            Instant call = CrmText.instant(r[6]);
            Instant last = note == null ? call : call == null || note.isAfter(call) ? note : call;
            if (last != null) {
                n.put("lastHumanTouchAt", last.toString());
                n.put("lastHumanTouch", last.equals(note) ? "NOTE" : "CALL");
            }
            out.put(s.getMemberId(), n);
        }
        return out;
    }

    @Override
    public String render(JsonNode p) {
        if (p == null) return "OWNERSHIP: not a lead.";
        Instant now = Instant.now();
        StringBuilder sb = new StringBuilder("OWNERSHIP: ");
        if (!p.path("hasOwner").asBoolean()) {
            sb.append("no counsellor assigned");
        } else {
            sb.append("counsellor assigned");
            if (p.hasNonNull("owner")) sb.append(" (").append(p.get("owner").asText()).append(")");
        }
        if (p.hasNonNull("lastHumanTouchAt")) {
            sb.append(" | last human touch ").append(CrmText.relative(p.get("lastHumanTouchAt"), now))
                    .append(" (").append(p.path("lastHumanTouch").asText().toLowerCase()).append(")");
        } else {
            sb.append(" | no human note or call on record");
        }
        if (p.hasNonNull("firstResponseAt")) {
            sb.append(" | first responded ").append(CrmText.relative(p.get("firstResponseAt"), now));
        }
        return sb.toString();
    }
}
