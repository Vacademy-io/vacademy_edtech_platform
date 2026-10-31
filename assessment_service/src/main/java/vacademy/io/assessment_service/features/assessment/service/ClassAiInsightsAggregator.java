package vacademy.io.assessment_service.features.assessment.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.Builder;
import lombok.Getter;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * Folds the per-learner AI analyses an assessment already has into ONE class
 * view: topic accuracy, a cognitive profile, and the misconceptions many
 * learners share.
 *
 * <p><b>Why aggregate rather than ask the model again.</b> admin_core has
 * already analysed each learner's attempt and stored the result — 249 processed
 * analyses exist for a single real assessment. Summing those costs nothing and
 * spends no AI credits, whereas a fresh class-level LLM call would spend them
 * on every download and need a job, a cache and an invalidation rule to be
 * affordable. The numbers are also better: a count of learners who actually got
 * a topic wrong is arithmetic, not a model's estimate.
 *
 * <p>The one thing this cannot produce is prose. Narrative and a written action
 * plan need a model; everything here is counting.
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class ClassAiInsightsAggregator {

    /** A learner counts as weak in a topic below this accuracy — the report's banding. */
    private static final double WEAK_THRESHOLD = 40.0;
    /** Misconceptions shared by fewer than this many learners are noise, not a teaching gap. */
    private static final int MIN_LEARNERS_FOR_MISCONCEPTION = 2;
    private static final int MAX_MISCONCEPTIONS = 10;
    private static final String[] BLOOM_KEYS =
            {"remember", "understand", "apply", "analyze", "evaluate", "create"};

    private final ObjectMapper objectMapper;

    @Getter
    @Builder
    public static class TopicAggregate {
        private final String topic;
        private final int questionCount;
        private final double classAccuracy;
        private final int weakLearners;
        private final int learnersCovering;
    }

    @Getter
    @Builder
    public static class MisconceptionAggregate {
        private final String questionSummary;
        private final int affectedLearners;
        private final String wrongAnswer;
        private final String correctAnswer;
        private final String misconception;
        private final String remediation;
    }

    @Getter
    @Builder
    public static class ClassInsights {
        /** How many learner analyses actually contributed. 0 means "no AI half". */
        private final int analysedLearners;
        private final List<TopicAggregate> topics;
        /** Bloom's level -> {correct, total} summed across learners. */
        private final Map<String, int[]> blooms;
        private final List<MisconceptionAggregate> misconceptions;

        public boolean isEmpty() {
            return analysedLearners == 0;
        }
    }

    /**
     * @param processedJsons one learner's analysis per entry; malformed entries
     *                       are skipped rather than failing the whole report
     */
    public ClassInsights aggregate(List<String> processedJsons) {
        if (processedJsons == null || processedJsons.isEmpty()) {
            return ClassInsights.builder()
                    .analysedLearners(0).topics(List.of()).blooms(Map.of()).misconceptions(List.of())
                    .build();
        }

        Map<String, int[]> blooms = new LinkedHashMap<>();
        // topic key -> [questions, correct, weakLearners, learnersCovering]
        Map<String, long[]> topics = new LinkedHashMap<>();
        Map<String, String> topicLabels = new LinkedHashMap<>();
        Map<String, MisconceptionAccumulator> misconceptions = new LinkedHashMap<>();
        int analysed = 0;

        for (String json : processedJsons) {
            if (json == null || json.isBlank()) continue;
            JsonNode root;
            try {
                root = objectMapper.readTree(json);
            } catch (Exception e) {
                // A 'failed' row stores an error object under the same column.
                continue;
            }
            if (root == null || !root.isObject() || !root.has("performance_analysis")) {
                continue;
            }
            analysed++;
            accumulateBlooms(root.get("blooms_taxonomy"), blooms);
            accumulateTopics(root.get("topic_analysis"), topics, topicLabels);
            accumulateMisconceptions(root.get("misconception_analysis"), misconceptions);
        }

        return ClassInsights.builder()
                .analysedLearners(analysed)
                .topics(buildTopics(topics, topicLabels))
                .blooms(blooms)
                .misconceptions(buildMisconceptions(misconceptions))
                .build();
    }

    private void accumulateBlooms(JsonNode node, Map<String, int[]> out) {
        if (node == null || !node.isObject()) return;
        for (String key : BLOOM_KEYS) {
            JsonNode level = node.get(key);
            if (level == null) continue;
            int total = level.path("total").asInt(0);
            int correct = level.path("correct").asInt(0);
            if (total <= 0) continue;
            int[] acc = out.computeIfAbsent(key, k -> new int[2]);
            acc[0] += correct;
            acc[1] += total;
        }
    }

    private void accumulateTopics(JsonNode node, Map<String, long[]> out, Map<String, String> labels) {
        if (node == null || !node.isArray()) return;
        for (JsonNode t : node) {
            String raw = t.path("topic").asText("").trim();
            if (raw.isEmpty()) continue;
            // The model infers topic names per learner, so the same topic arrives
            // with different casing and spacing. Normalise for the key, keep the
            // first spelling seen for display.
            String key = raw.toLowerCase(Locale.ROOT).replaceAll("\\s+", " ");
            labels.putIfAbsent(key, raw);

            long questions = t.path("questions_count").asLong(0);
            long correct = t.path("correct").asLong(0);
            double accuracy = t.path("accuracy").asDouble(
                    questions > 0 ? correct * 100.0 / questions : 0);

            long[] acc = out.computeIfAbsent(key, k -> new long[4]);
            acc[0] += questions;
            acc[1] += correct;
            if (accuracy < WEAK_THRESHOLD) acc[2]++;
            acc[3]++;
        }
    }

    private List<TopicAggregate> buildTopics(Map<String, long[]> topics, Map<String, String> labels) {
        List<TopicAggregate> out = new ArrayList<>();
        for (Map.Entry<String, long[]> e : topics.entrySet()) {
            long[] v = e.getValue();
            if (v[0] <= 0) continue;
            out.add(TopicAggregate.builder()
                    .topic(labels.getOrDefault(e.getKey(), e.getKey()))
                    // Per-learner question counts sum across the class, so divide
                    // back down to the paper's own question count.
                    .questionCount((int) Math.max(1, Math.round((double) v[0] / Math.max(1, v[3]))))
                    .classAccuracy(Math.round(v[1] * 1000.0 / v[0]) / 10.0)
                    .weakLearners((int) v[2])
                    .learnersCovering((int) v[3])
                    .build());
        }
        // Weakest first: the table doubles as the order to reteach in.
        out.sort(Comparator.comparingDouble(TopicAggregate::getClassAccuracy));
        return out;
    }

    private static class MisconceptionAccumulator {
        int learners;
        String summary;
        String wrong;
        String correct;
        String why;
        String fix;
    }

    private void accumulateMisconceptions(JsonNode node, Map<String, MisconceptionAccumulator> out) {
        if (node == null || !node.isArray()) return;
        for (JsonNode m : node) {
            String summary = m.path("question_summary").asText("").trim();
            String correct = m.path("correct_answer").asText("").trim();
            if (summary.isEmpty() && correct.isEmpty()) continue;
            // Keyed on the question rather than the model's wording of the error:
            // the same mistake is described differently for each learner, and
            // keying on the description would split one gap into thirty.
            String key = (summary + "|" + correct).toLowerCase(Locale.ROOT).replaceAll("\\s+", " ");

            MisconceptionAccumulator acc = out.computeIfAbsent(key, k -> new MisconceptionAccumulator());
            acc.learners++;
            if (acc.summary == null || acc.summary.isBlank()) acc.summary = summary;
            if (acc.correct == null || acc.correct.isBlank()) acc.correct = correct;
            if (acc.wrong == null || acc.wrong.isBlank()) acc.wrong = m.path("student_answer").asText("");
            if (acc.why == null || acc.why.isBlank()) acc.why = m.path("misconception").asText("");
            if (acc.fix == null || acc.fix.isBlank()) acc.fix = m.path("remediation").asText("");
        }
    }

    private List<MisconceptionAggregate> buildMisconceptions(Map<String, MisconceptionAccumulator> in) {
        List<MisconceptionAggregate> out = new ArrayList<>();
        for (MisconceptionAccumulator a : in.values()) {
            if (a.learners < MIN_LEARNERS_FOR_MISCONCEPTION) continue;
            out.add(MisconceptionAggregate.builder()
                    .questionSummary(a.summary)
                    .affectedLearners(a.learners)
                    .wrongAnswer(a.wrong)
                    .correctAnswer(a.correct)
                    .misconception(a.why)
                    .remediation(a.fix)
                    .build());
        }
        // Most widely shared first — that is the highest-yield thing to reteach.
        out.sort(Comparator.comparingInt(MisconceptionAggregate::getAffectedLearners).reversed());
        return out.size() > MAX_MISCONCEPTIONS ? out.subList(0, MAX_MISCONCEPTIONS) : out;
    }
}
