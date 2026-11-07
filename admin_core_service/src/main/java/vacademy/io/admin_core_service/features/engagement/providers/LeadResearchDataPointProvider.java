package vacademy.io.admin_core_service.features.engagement.providers;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
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
 * What the Lead Agent found out about an organisation it delivered as a lead: what they do, the
 * signal that makes them a fit, who decides, what they use today, and the question to open with.
 * It is what lets a first email be specific instead of generic.
 *
 * <p>All of it was written by our research agent from public pages, not by the person, so it is
 * rendered as internal notes the brain must never quote back or reveal. Page text is untrusted:
 * values are trimmed, capped and stripped of the prompt's own delimiter runs.
 */
@Component
@RequiredArgsConstructor
@Slf4j
public class LeadResearchDataPointProvider implements DataPointProvider {

    static final int MAX_VALUE = 400;

    private final EngagementReadDao dao;
    private final ObjectMapper mapper = new ObjectMapper();

    @Override public String key() { return "lead_research"; }
    @Override public boolean alwaysOn() { return false; }

    @Override
    public DataPointSpec declare() {
        return DataPointSpec.builder()
                .key(key()).label("Lead Agent research")
                .description("For organisations the Lead Agent found: what they do, the signal that makes "
                        + "them a fit, the decision maker, the software they use and a suggested opening "
                        + "question. Written by our research, not by the organisation.")
                .sensitivity("LOW").cost("IN_PROCESS").build();
    }

    @Override
    public Map<String, JsonNode> fetch(FetchContext ctx, List<Subject> subjects) {
        List<String> leadIds = subjects.stream()
                .map(Subject::getAudienceResponseId).filter(java.util.Objects::nonNull).toList();
        Map<String, String> research = dao.leadAgentResearchByResponseIds(leadIds, ctx.getInstituteId());
        Map<String, JsonNode> out = new HashMap<>();
        for (Subject s : subjects) {
            String raw = s.getAudienceResponseId() != null ? research.get(s.getAudienceResponseId()) : null;
            if (raw == null) continue;
            try {
                out.put(s.getMemberId(), compact(mapper.readTree(raw)));
            } catch (Exception e) {
                log.warn("Unreadable Lead Agent research for lead {}: {}", s.getAudienceResponseId(), e.getMessage());
            }
        }
        return out;
    }

    /** The few fields worth a prompt line, cleaned. */
    public ObjectNode compact(JsonNode j) {
        ObjectNode n = mapper.createObjectNode();
        JsonNode org = j.path("organisation");
        put(n, "organisation", text(org, "name"));
        put(n, "city", text(org, "city"));
        put(n, "whatTheyDo", text(org, "what_they_do"));
        put(n, "website", text(org, "website"));
        JsonNode signal = j.path("top_signal");
        put(n, "fitSignal", join(text(signal, "label"), text(signal, "value")));
        put(n, "signalQuote", text(signal, "quote"));
        put(n, "summary", j.path("summary").isTextual() ? j.get("summary").asText() : null);
        JsonNode dm = j.path("decision_maker");
        if (dm.isObject()) {
            put(n, "decisionMaker", join(text(dm, "name"), firstText(dm, "role", "title")));
        }
        JsonNode software = j.path("current_software");
        if (software.isArray() && software.size() > 0) {
            StringBuilder sb = new StringBuilder();
            software.forEach(s -> {
                String name = s.isTextual() ? s.asText() : firstText(s, "name", "vendor");
                if (name != null && !name.isBlank()) sb.append(sb.length() > 0 ? ", " : "").append(name);
            });
            put(n, "currentSoftware", sb.toString());
        }
        put(n, "size", text(j.path("size"), "tier"));
        put(n, "openingQuestion", j.path("discovery_question").isTextual() ? j.get("discovery_question").asText() : null);
        return n;
    }

    @Override
    public String render(JsonNode p) {
        if (p == null || p.isEmpty()) return "RESEARCH: none on record.";
        StringBuilder sb = new StringBuilder("RESEARCH (internal notes from our research on public pages — not the ")
                .append("organisation's own words: never quote them back, never say you researched them, never ")
                .append("imply they contacted us):");
        line(sb, p, "organisation", "Organisation");
        line(sb, p, "city", "City");
        line(sb, p, "whatTheyDo", "What they do");
        line(sb, p, "website", "Website");
        line(sb, p, "fitSignal", "Why they may need us");
        line(sb, p, "signalQuote", "Seen on their site");
        line(sb, p, "summary", "Summary");
        line(sb, p, "decisionMaker", "Decision maker");
        line(sb, p, "currentSoftware", "Software they use");
        line(sb, p, "size", "Size");
        line(sb, p, "openingQuestion", "Suggested opening question");
        return sb.toString();
    }

    private static void line(StringBuilder sb, JsonNode p, String key, String label) {
        if (p.hasNonNull(key)) sb.append("\n  ").append(label).append(": ").append(p.get(key).asText());
    }

    private static void put(ObjectNode n, String key, String value) {
        String clean = clean(value);
        if (clean != null) n.put(key, clean);
    }

    /** Trim, collapse whitespace, drop the prompt's own delimiter runs, cap the length. */
    static String clean(String v) {
        if (v == null) return null;
        String s = v.replaceAll("={3,}", "—").replaceAll("[\\p{Cntrl}\\s]+", " ").trim();
        if (s.isEmpty() || "null".equals(s)) return null;
        return s.length() <= MAX_VALUE ? s : s.substring(0, MAX_VALUE) + "…";
    }

    private static String text(JsonNode node, String field) {
        JsonNode v = node == null ? null : node.get(field);
        return v != null && v.isTextual() ? v.asText() : null;
    }

    private static String firstText(JsonNode node, String... fields) {
        for (String f : fields) {
            String t = text(node, f);
            if (t != null && !t.isBlank()) return t;
        }
        return null;
    }

    private static String join(String a, String b) {
        if (a == null || a.isBlank()) return b;
        if (b == null || b.isBlank()) return a;
        return a + " — " + b;
    }
}
