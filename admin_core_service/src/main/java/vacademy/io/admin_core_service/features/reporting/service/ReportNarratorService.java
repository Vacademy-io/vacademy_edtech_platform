package vacademy.io.admin_core_service.features.reporting.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import vacademy.io.admin_core_service.features.ai_models.service.AIModelRegistryService;
import vacademy.io.admin_core_service.features.ai_models.service.LlmGatewayRouter;
import vacademy.io.admin_core_service.features.ai_usage.enums.ApiProvider;
import vacademy.io.admin_core_service.features.ai_usage.enums.RequestType;
import vacademy.io.admin_core_service.features.ai_usage.service.AiTokenUsageService;
import vacademy.io.admin_core_service.features.reporting.spi.SectionFacts;

import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Turns the computed facts into precise, actionable advice.
 *
 * <h3>The model never produces a number</h3>
 * This is the load-bearing rule of the whole feature. The narrator is handed the
 * already-computed {@link SectionFacts} as text and asked to write prose ABOUT
 * them: what to do, what to improve, who to contact. It never recomputes, never
 * aggregates, and is told explicitly to quote figures only as they appear. A model
 * allowed to do arithmetic will eventually email an institute owner a confidently
 * wrong completion rate, and one wrong number destroys trust in every right one.
 *
 * <h3>Failure is not an error</h3>
 * If the model is slow, down, or returns something unusable, this returns null and
 * the static report goes out exactly as before — free. The analysis is an add-on,
 * so it must never be able to cost an institute its report.
 *
 * <h3>Never for a scoped reader</h3>
 * The caller only requests a narrative for UNRESTRICTED readers. A narrative
 * written from institute-wide facts is prose, and prose cannot be filtered by
 * learner id afterwards — handing it to a teacher scoped to their own cohort would
 * leak other cohorts through the summary even though every table was correctly
 * restricted.
 *
 * <h3>Billing</h3>
 * Token usage is recorded to {@code ai_token_usage} for attribution and margin
 * measurement, but this service does NOT deduct token-priced credits: the report
 * carries a flat charge from {@link ReportBillingService}, and doing both would
 * bill the institute twice for one analysis.
 */
@Service
@Slf4j
public class ReportNarratorService {

    /** Model registry use case. "analytics" is what the other report generators use. */
    private static final String USE_CASE = "analytics";
    /**
     * Reasoning is ON for reports — nobody is waiting on a scheduled job, and the
     * analysis is the product. Measured at ~21s with reasoning, so the ceiling is
     * generous; but it IS a ceiling, because a hung call would stall the whole run.
     */
    private static final Duration TIMEOUT = Duration.ofSeconds(75);
    /** The whole chain walk (default, then fallback) stays inside this. */
    private static final Duration TIME_BUDGET = Duration.ofSeconds(150);
    /**
     * Reasoning made an earlier draft four times longer than useful. The budget is
     * stated in the prompt AND capped here, because an eight-paragraph essay at the
     * top of a digest is worse than no analysis at all.
     */
    private static final int MAX_ACTIONS = 5;
    private static final int MAX_ROWS_PER_SECTION = 12;

    private final ObjectMapper objectMapper;
    private final AiTokenUsageService aiTokenUsageService;
    private final AIModelRegistryService modelRegistry;
    private final LlmGatewayRouter gatewayRouter;

    public ReportNarratorService(ObjectMapper objectMapper,
                                 AiTokenUsageService aiTokenUsageService,
                                 AIModelRegistryService modelRegistry,
                                 LlmGatewayRouter gatewayRouter) {
        this.objectMapper = objectMapper;
        this.aiTokenUsageService = aiTokenUsageService;
        this.modelRegistry = modelRegistry;
        this.gatewayRouter = gatewayRouter;
    }

    /** One piece of advice: what to do, why, and who it concerns. */
    public record Action(String title, String detail, String who) {}

    /**
     * @param headline one sentence on the state of things
     * @param actions  ranked, specific, each tied to a figure in the report
     * @param asking   what learners are asking for that the library cannot answer
     */
    public record Narrative(String headline, List<Action> actions, List<String> asking) {
        public boolean isUsable() {
            return headline != null && !headline.isBlank() && actions != null && !actions.isEmpty();
        }
    }

    /**
     * @return a narrative, or null when one could not be produced — the caller must
     *         treat null as "send the static report and charge nothing".
     */
    public Narrative narrate(String instituteName, String periodLabel,
                             List<SectionFacts> facts, String instituteId) {
        if (facts == null || facts.stream().allMatch(SectionFacts::isEmpty)) {
            return null; // nothing to analyse; the static report says so itself
        }

        List<String> models = modelChain();
        if (models.isEmpty()) {
            log.warn("[reporting] no model available for use case '{}' — skipping AI analysis", USE_CASE);
            return null;
        }

        try {
            Map<String, Object> payload = Map.of(
                    "messages", List.of(
                            Map.of("role", "system", "content", SYSTEM_PROMPT),
                            Map.of("role", "user", "content",
                                    userPrompt(instituteName, periodLabel, facts))),
                    "response_format", Map.of("type", "json_object"));

            // Walks the chain (Isoquant for routed models, OpenRouter on a gateway failure,
            // then the fallback model). GLM gets reasoning headroom + effort low.
            LlmGatewayRouter.LlmResult result = gatewayRouter.chat(models, payload, TIMEOUT, null, TIME_BUDGET);
            recordUsage(objectMapper.readTree(result.body()), result.modelId(), instituteId);

            String content = result.content();
            if (content == null || content.isBlank()) return null;

            Narrative narrative = parse(objectMapper.readTree(stripFences(content)));
            if (narrative == null || !narrative.isUsable()) {
                log.warn("[reporting] narrator returned nothing usable — sending static report");
                return null;
            }
            return narrative;

        } catch (Exception e) {
            // Deliberately swallowed: see the class note. A failed analysis must
            // never stop a report that is otherwise ready to send.
            log.warn("[reporting] AI analysis failed ({}) — sending static report",
                    e.getClass().getSimpleName(), e);
            return null;
        }
    }

    private List<String> modelChain() {
        try {
            List<String> priority = modelRegistry.getModelPriority(USE_CASE);
            return priority == null ? List.of() : priority;
        } catch (Exception e) {
            log.warn("[reporting] model registry lookup failed for '{}'", USE_CASE, e);
            return List.of();
        }
    }

    /** Some models wrap JSON in a markdown fence even in json_object mode. */
    private static String stripFences(String content) {
        String s = content.strip();
        if (s.startsWith("```")) {
            int firstNewline = s.indexOf('\n');
            int lastFence = s.lastIndexOf("```");
            if (firstNewline >= 0 && lastFence > firstNewline) {
                s = s.substring(firstNewline + 1, lastFence).strip();
            }
        }
        return s;
    }

    private Narrative parse(JsonNode json) {
        String headline = json.path("headline").asText(null);
        List<Action> actions = new ArrayList<>();
        for (JsonNode a : json.path("actions")) {
            if (actions.size() >= MAX_ACTIONS) break;
            String title = a.path("title").asText(null);
            if (title == null || title.isBlank()) continue;
            actions.add(new Action(title,
                    a.path("detail").asText(""),
                    a.path("who").asText("")));
        }
        List<String> asking = new ArrayList<>();
        for (JsonNode q : json.path("asking")) {
            if (asking.size() >= 6) break;
            String t = q.asText(null);
            if (t != null && !t.isBlank()) asking.add(t);
        }
        return new Narrative(headline, actions, asking);
    }

    private void recordUsage(JsonNode root, String model, String instituteId) {
        try {
            JsonNode usage = root.path("usage");
            if (usage.isMissingNode()) return;
            aiTokenUsageService.recordUsageAsync(
                    ApiProvider.OPENAI,
                    RequestType.ANALYTICS,
                    model,
                    usage.path("prompt_tokens").asInt(0),
                    usage.path("completion_tokens").asInt(0),
                    asUuid(instituteId),
                    null);
        } catch (Exception e) {
            log.warn("[reporting] could not record narrator token usage", e);
        }
    }

    private static UUID asUuid(String s) {
        try {
            return s == null ? null : UUID.fromString(s);
        } catch (IllegalArgumentException e) {
            return null;
        }
    }

    /**
     * Serialises the facts as text.
     *
     * Rows are capped per section because the prompt is the cost driver and a
     * 400-row table adds nothing an analyst could use that the first dozen rows do
     * not already show.
     */
    private String userPrompt(String instituteName, String periodLabel, List<SectionFacts> facts) {
        StringBuilder b = new StringBuilder(4096);
        b.append("Institute: ").append(instituteName)
                .append("\nPeriod covered: ").append(periodLabel).append("\n");
        for (SectionFacts f : facts) {
            if (f.isEmpty()) continue;
            b.append("\n## ").append(f.getTitle()).append('\n');
            if (f.getHeadlines() != null) {
                f.getHeadlines().forEach((k, v) -> b.append("- ").append(k).append(": ").append(v).append('\n'));
            }
            List<SectionFacts.Row> rows = f.getRows();
            if (rows != null && !rows.isEmpty()) {
                b.append("columns: ").append(String.join(" | ", f.getColumns())).append('\n');
                int n = 0;
                for (SectionFacts.Row r : rows) {
                    if (n++ >= MAX_ROWS_PER_SECTION) {
                        b.append("(").append(rows.size() - MAX_ROWS_PER_SECTION)
                                .append(" more rows not shown)\n");
                        break;
                    }
                    b.append("  ").append(String.join(" | ", r.getValues())).append('\n');
                }
            }
        }
        return b.toString();
    }

    private static final String SYSTEM_PROMPT = """
            You advise the head of an online education institute. You are given a \
            report that has ALREADY been computed from their database.

            HARD RULES
            1. Never compute, estimate, total or infer any number. Quote figures only \
               exactly as they appear in the data given to you. If a figure you want \
               is not present, describe the problem without a number.
            2. Be specific and actionable. "Improve engagement" is useless. \
               "Chase the 26 doubts unanswered for more than three days, oldest first" \
               is useful.
            3. Name the thing to act on — the class, the batch, the queue, the topic — \
               using the exact labels from the data.
            4. Say WHO should act: the teacher of a named class, whoever answers \
               doubts, the person chasing payments, the content owner.
            5. Prefer causes over symptoms. Repeated "lagging" comments on low-rated \
               classes are a streaming problem, not a teaching problem. Material \
               searches that find nothing are a content gap, not a learner failure.
            6. Ignore anything that is already fine. Do not pad.

            Reply with STRICT JSON only:
            {
              "headline": "one sentence, max 30 words, on what most needs attention",
              "actions": [
                {"title": "imperative, max 12 words",
                 "detail": "max 40 words, referencing the exact figure or label",
                 "who": "max 8 words, the role or person who should act"}
              ],
              "asking": ["what learners searched for or asked that went unanswered"]
            }

            At most 5 actions, ranked most urgent first. Fewer is better than padded. \
            "asking" only if the report contains learner questions or searches; \
            otherwise return an empty list.
            """;
}
