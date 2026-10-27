package vacademy.io.admin_core_service.features.engagement.providers;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;
import vacademy.io.admin_core_service.features.engagement.service.EngagementReadDao;
import vacademy.io.admin_core_service.features.engagement.spi.DataPointProvider;
import vacademy.io.admin_core_service.features.engagement.spi.DataPointSpec;
import vacademy.io.admin_core_service.features.engagement.spi.FetchContext;
import vacademy.io.admin_core_service.features.engagement.spi.Subject;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Always-on: who the subject is. Contacts are already on the Subject (ContactResolver);
 * this adds lead-attached custom fields (the admissions form answers) for lead subjects.
 * User-attached custom fields are NOT read in 1a — their storage path (source_type
 * USER / SSIGM / SUB_ORG_REGISTRATION) varies by flow; revisit with a verified query.
 */
@Component
@RequiredArgsConstructor
public class ProfileDataPointProvider implements DataPointProvider {

    private final EngagementReadDao dao;
    private final ObjectMapper mapper = new ObjectMapper();

    @Override public String key() { return "profile"; }
    @Override public boolean alwaysOn() { return true; }

    @Override
    public DataPointSpec declare() {
        return DataPointSpec.builder()
                .key(key()).label("User details")
                .description("Name, contact identifiers, subject type (learner vs lead), and for "
                        + "leads the form answers (custom fields). Absence of a field means it was "
                        + "never collected — not that the person declined.")
                .sensitivity("LOW").cost("IN_PROCESS").build();
    }

    /** audience_response.source_type of leads the Lead Agent delivered. */
    static final String LEAD_AGENT_SOURCE = "LEAD_AGENT";
    /** A cold, researched organisation that has never contacted the institute. */
    static final String ORGANISATION_PROSPECT = "ORGANISATION_PROSPECT";

    @Override
    public Map<String, JsonNode> fetch(FetchContext ctx, List<Subject> subjects) {
        List<String> leadIds = subjects.stream()
                .map(Subject::getAudienceResponseId).filter(java.util.Objects::nonNull).toList();
        Map<String, Map<String, String>> leadFields = dao.leadCustomFieldsByResponseIds(leadIds);
        Map<String, String> sourceTypes = dao.leadSourceTypesByResponseIds(leadIds);

        Map<String, JsonNode> out = new HashMap<>();
        for (Subject s : subjects) {
            ObjectNode n = mapper.createObjectNode();
            n.put("name", s.getName());
            n.put("phone", s.getPhone());
            n.put("email", s.getEmail());
            // Every CRM lead gets a user_id at submit time, so user_id cannot tell a researched
            // organisation from a learner. The lead's source can: the Lead Agent's leads never
            // contacted the institute, and their custom fields are our research, not form answers.
            boolean prospect = s.getAudienceResponseId() != null
                    && LEAD_AGENT_SOURCE.equals(sourceTypes.get(s.getAudienceResponseId()));
            n.put("subjectType", prospect ? ORGANISATION_PROSPECT
                    : s.getUserId() != null ? "LEARNER_OR_CONVERTED_LEAD" : "UNCONVERTED_LEAD");
            if (s.getAudienceResponseId() != null) {
                Map<String, String> fields = leadFields.get(s.getAudienceResponseId());
                if (fields != null && !fields.isEmpty()) {
                    ObjectNode f = n.putObject(prospect ? "researchNotes" : "formAnswers");
                    fields.forEach((k, v) -> {
                        String clean = LeadResearchDataPointProvider.clean(v);
                        if (clean != null) f.put(k, clean);
                    });
                }
            }
            out.put(s.getMemberId(), n);
        }
        return out;
    }

    @Override
    public String render(JsonNode p) {
        if (p == null) return "PROFILE: unknown";
        boolean prospect = ORGANISATION_PROSPECT.equals(p.path("subjectType").asText());
        StringBuilder sb = new StringBuilder("PROFILE: ");
        sb.append(p.hasNonNull("name") ? p.get("name").asText()
                        : prospect ? "contact name unknown (address the organisation or the role)" : "unnamed")
          .append(" [").append(prospect
                        ? "ORGANISATION_PROSPECT: cold — found by our research, has never contacted us"
                        : p.path("subjectType").asText("?")).append("]");
        if (p.hasNonNull("phone")) sb.append(" phone=").append(p.get("phone").asText());
        if (p.hasNonNull("email")) sb.append(" email=").append(p.get("email").asText());
        JsonNode fa = p.get("formAnswers");
        if (fa != null && fa.size() > 0) {
            sb.append(" | form: ");
            fa.fields().forEachRemaining(e -> sb.append(e.getKey()).append("=")
                    .append(e.getValue().asText()).append("; "));
        }
        JsonNode rn = p.get("researchNotes");
        if (rn != null && rn.size() > 0) {
            sb.append(" | research notes (internal, not their words — never quote): ");
            rn.fields().forEachRemaining(e -> sb.append(e.getKey()).append("=")
                    .append(e.getValue().asText()).append("; "));
        }
        return sb.toString();
    }
}
