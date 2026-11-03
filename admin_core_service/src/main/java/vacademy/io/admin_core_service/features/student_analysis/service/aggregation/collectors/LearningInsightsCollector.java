package vacademy.io.admin_core_service.features.student_analysis.service.aggregation.collectors;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import vacademy.io.admin_core_service.features.learner_tracking.entity.ActivityLog;
import vacademy.io.admin_core_service.features.learner_tracking.repository.ActivityLogRepository;
import vacademy.io.admin_core_service.features.student_analysis.dto.comprehensive.LearningInsightsSection;

import java.sql.Timestamp;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;

/**
 * Parses per-attempt {@code activity_log.processed_json} (produced by the LLM-analytics pipeline —
 * see {@code docs/LLM_ANALYSIS.md}) and aggregates it into the graph-ready
 * {@link LearningInsightsSection}. This promotes data that v1 only ever dumped as opaque prompt
 * text into structured numbers that drive charts AND ground the Layer-2 narrative.
 *
 * <p>READ-ONLY on {@code activity_log}. Per-collector isolation: any failure yields an
 * {@code available=false} section, never breaking the report. Every number is recomputed in Java
 * from the parsed JSON — the LLM's own arithmetic inside processed_json is never trusted for totals.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class LearningInsightsCollector {

    /** Bloom's cognitive levels in canonical order (matches the LLM-analytics prompt schema). */
    private static final List<String> BLOOM_LEVELS =
            List.of("remember", "understand", "apply", "analyze", "evaluate", "create");

    private static final int MAX_MISCONCEPTIONS = 8;

    /** A learner under this accuracy in a topic counts as struggling with it. */
    private static final double STRUGGLING_BELOW = 40;

    private final ActivityLogRepository activityLogRepository;
    private final ObjectMapper objectMapper;

    public LearningInsightsSection collect(String userId, LocalDate startDate, LocalDate endDate) {
        return collect(userId, startDate, endDate, null);
    }

    /**
     * @param sourceIds when not null, only analysed attempts of these sources (the assessments
     *                  and slides of a picked batch) count; an empty set means nothing does.
     */
    public LearningInsightsSection collect(String userId, LocalDate startDate, LocalDate endDate,
                                           Collection<String> sourceIds) {
        if (sourceIds != null && sourceIds.isEmpty()) {
            return LearningInsightsSection.builder().available(false).build();
        }
        try {
            Timestamp startTs = Timestamp.valueOf(startDate.atStartOfDay());
            Timestamp endTs = Timestamp.valueOf(endDate.atTime(23, 59, 59));

            List<ActivityLog> logs = sourceIds == null
                    ? activityLogRepository.findAllProcessedLogsForInsights(userId, startTs, endTs)
                    : activityLogRepository.findProcessedLogsForInsightsBySources(userId, sourceIds, startTs, endTs);

            if (logs == null || logs.isEmpty()) {
                return LearningInsightsSection.builder().available(false).build();
            }
            List<String[]> rows = new ArrayList<>();
            for (ActivityLog l : logs) rows.add(new String[]{null, l.getProcessedJson()});
            return fromJson(rows);
        } catch (Exception e) {
            log.error("[LearningInsightsCollector] Failed for userId={}: {}", userId, e.getMessage());
            return LearningInsightsSection.builder().available(false).build();
        }
    }

    /** Most rows parsed for a cohort roll-up; newest first. */
    private static final int MAX_COHORT_ROWS = 3000;

    /**
     * Topic mastery, Bloom levels and confidence rolled up across a cohort (the batch report),
     * from the newest {@value #MAX_COHORT_ROWS} analysed attempts in the window.
     */
    public LearningInsightsSection collectForUsers(List<String> userIds, LocalDate startDate, LocalDate endDate) {
        return collectForUsers(userIds, startDate, endDate, null);
    }

    /** As above; with {@code sourceIds}, only analysed attempts of those assessments count. */
    public LearningInsightsSection collectForUsers(List<String> userIds, LocalDate startDate, LocalDate endDate,
                                                   Collection<String> sourceIds) {
        if (userIds == null || userIds.isEmpty() || (sourceIds != null && sourceIds.isEmpty())) {
            return LearningInsightsSection.builder().available(false).build();
        }
        try {
            Timestamp startTs = Timestamp.valueOf(startDate.atStartOfDay());
            Timestamp endTs = Timestamp.valueOf(endDate.atTime(23, 59, 59));
            List<String[]> rows = new ArrayList<>();
            List<Object[]> found = sourceIds == null
                    ? activityLogRepository.findProcessedJsonForUsers(userIds, startTs, endTs, MAX_COHORT_ROWS)
                    : activityLogRepository.findProcessedJsonForUsersAndSources(userIds, sourceIds, startTs, endTs, MAX_COHORT_ROWS);
            for (Object[] r : found) {
                if (r == null || r.length < 2 || r[1] == null) continue;
                rows.add(new String[]{r[0] == null ? null : r[0].toString(), r[1].toString()});
            }
            return fromJson(rows);
        } catch (Exception e) {
            log.error("[LearningInsightsCollector] Cohort roll-up failed for {} users: {}", userIds.size(), e.getMessage());
            return LearningInsightsSection.builder().available(false).build();
        }
    }

    /** Each row is [userId or null, processed_json]. */
    private LearningInsightsSection fromJson(List<String[]> rows) {
        try {
            if (rows == null || rows.isEmpty()) {
                return LearningInsightsSection.builder().available(false).build();
            }

            TopicAccumulator topics = new TopicAccumulator();
            BloomAccumulator blooms = new BloomAccumulator();
            ConfidenceAccumulator confidence = new ConfidenceAccumulator();
            List<LearningInsightsSection.Misconception> misconceptions = new ArrayList<>();

            int analyzed = 0;
            for (String[] row : rows) {
                String json = row[1];
                if (json == null || json.isBlank()) continue;
                JsonNode root;
                try {
                    root = objectMapper.readTree(json);
                } catch (Exception e) {
                    continue; // unparseable row — skip, don't fail the section
                }
                // Skip failure-marker rows ({"error": "...", ...}).
                if (root.has("error") && !root.has("topic_analysis") && !root.has("blooms_taxonomy")) {
                    continue;
                }

                accumulateTopics(row[0], root.path("topic_analysis"), topics);
                accumulateBlooms(root.path("blooms_taxonomy"), blooms);
                confidence.add(root.path("confidence_estimation"));
                collectMisconceptions(root.path("misconception_analysis"), misconceptions);
                analyzed++;
            }

            if (analyzed == 0) {
                return LearningInsightsSection.builder().available(false).build();
            }

            List<LearningInsightsSection.TopicMastery> topicMastery = topics.build();
            List<LearningInsightsSection.BloomLevel> bloomLevels = blooms.build();
            LearningInsightsSection.ConfidenceProfile confidenceProfile = confidence.build();
            if (misconceptions.size() > MAX_MISCONCEPTIONS) {
                misconceptions = new ArrayList<>(misconceptions.subList(0, MAX_MISCONCEPTIONS));
            }

            // If we parsed rows but extracted nothing usable, the section has no value to show.
            boolean hasContent = !topicMastery.isEmpty() || !bloomLevels.isEmpty()
                    || confidenceProfile != null || !misconceptions.isEmpty();
            if (!hasContent) {
                return LearningInsightsSection.builder().available(false).build();
            }

            return LearningInsightsSection.builder()
                    .available(true)
                    .attemptsAnalyzed(analyzed)
                    .topicMastery(topicMastery.isEmpty() ? null : topicMastery)
                    .blooms(bloomLevels.isEmpty() ? null : bloomLevels)
                    .confidence(confidenceProfile)
                    .misconceptions(misconceptions.isEmpty() ? null : misconceptions)
                    .build();

        } catch (Exception e) {
            log.error("[LearningInsightsCollector] Failed to roll up insights: {}", e.getMessage());
            return LearningInsightsSection.builder().available(false).build();
        }
    }

    // ── topic_analysis ──────────────────────────────────────────────────────────

    private void accumulateTopics(String userId, JsonNode node, TopicAccumulator acc) {
        if (!node.isArray()) return;
        for (JsonNode t : node) {
            String topic = asText(t, "topic");
            if (topic == null || topic.isBlank()) continue;
            int questions = asInt(t, "questions_count", 0);
            int correct = asInt(t, "correct", 0);
            // Guard against malformed rows where correct > questions.
            if (questions <= 0) continue;
            if (correct > questions) correct = questions;
            double avgTime = asDouble(t, "avg_time_seconds", 0.0);
            acc.add(userId, topic, questions, correct, avgTime);
        }
    }

    // ── blooms_taxonomy ─────────────────────────────────────────────────────────

    private void accumulateBlooms(JsonNode node, BloomAccumulator acc) {
        if (!node.isObject()) return;
        for (String level : BLOOM_LEVELS) {
            JsonNode lvl = node.path(level);
            if (!lvl.isObject()) continue;
            int total = asInt(lvl, "total", 0);
            int correct = asInt(lvl, "correct", 0);
            if (total <= 0) continue;
            if (correct > total) correct = total;
            acc.add(level, total, correct);
        }
    }

    // ── misconception_analysis ──────────────────────────────────────────────────

    private void collectMisconceptions(JsonNode node, List<LearningInsightsSection.Misconception> out) {
        if (!node.isArray()) return;
        for (JsonNode m : node) {
            if (out.size() >= MAX_MISCONCEPTIONS) return;
            String misconception = asText(m, "misconception");
            if (misconception == null || misconception.isBlank()) continue;
            out.add(LearningInsightsSection.Misconception.builder()
                    .topic(asText(m, "topic"))
                    .context(asText(m, "question_summary"))
                    .misconception(misconception)
                    .remediation(asText(m, "remediation"))
                    .build());
        }
    }

    // ── accumulators ────────────────────────────────────────────────────────────

    /**
     * The AI names topics freely on every attempt, so one topic arrives as "Photosynthesis",
     * "photosynthesis process" and "Process of Photosynthesis". Names are merged on a key of
     * their significant words: lower case, punctuation and filler words dropped, simple plurals
     * folded, words sorted. The name shown is the spelling backed by the most questions.
     */
    static String topicKey(String topic) {
        String cleaned = topic.toLowerCase(Locale.ROOT).replace("&", " and ")
                .replaceAll("[^\\p{L}\\p{M}\\p{N}]+", " ").trim();
        TreeSet<String> words = new TreeSet<>();
        for (String w : cleaned.split(" ")) {
            if (w.isEmpty() || TOPIC_FILLER.contains(w)) continue;
            words.add(singular(w));
        }
        return words.isEmpty() ? cleaned : String.join(" ", words);
    }

    private static final Set<String> TOPIC_FILLER = Set.of(
            "a", "an", "the", "of", "and", "in", "on", "to", "for", "with", "its", "their",
            "basic", "basics", "introduction", "intro", "concept", "concepts", "fundamental",
            "fundamentals", "overview", "understanding", "topic", "topics");

    private static String singular(String w) {
        if (w.length() <= 3) return w;
        if (w.endsWith("ies")) return w.substring(0, w.length() - 3) + "y";
        if (w.endsWith("ss") || w.endsWith("us") || w.endsWith("is")) return w;
        if (w.endsWith("s")) return w.substring(0, w.length() - 1);
        return w;
    }

    private static final class TopicAccumulator {
        private final Map<String, int[]> counts = new LinkedHashMap<>();   // key → [questions, correct]
        private final Map<String, double[]> time = new LinkedHashMap<>();  // key → [weightedTimeSum]
        private final Map<String, Map<String, Integer>> spellings = new HashMap<>(); // key → name → questions
        private final Map<String, Map<String, int[]>> perLearner = new HashMap<>();  // key → user → [questions, correct]

        void add(String userId, String topic, int questions, int correct, double avgTime) {
            String key = topicKey(topic);
            spellings.computeIfAbsent(key, k -> new HashMap<>()).merge(topic.trim(), questions, Integer::sum);
            counts.computeIfAbsent(key, k -> new int[2]);
            time.computeIfAbsent(key, k -> new double[1]);
            counts.get(key)[0] += questions;
            counts.get(key)[1] += correct;
            time.get(key)[0] += avgTime * questions; // weight avg time by question count
            if (userId != null) {
                int[] qc = perLearner.computeIfAbsent(key, k -> new HashMap<>())
                        .computeIfAbsent(userId, k -> new int[2]);
                qc[0] += questions;
                qc[1] += correct;
            }
        }

        List<LearningInsightsSection.TopicMastery> build() {
            List<LearningInsightsSection.TopicMastery> out = new ArrayList<>();
            for (Map.Entry<String, int[]> e : counts.entrySet()) {
                int questions = e.getValue()[0];
                int correct = e.getValue()[1];
                if (questions <= 0) continue;
                double accuracy = round1(correct * 100.0 / questions);
                double avgTime = round1(time.get(e.getKey())[0] / questions);
                Integer learners = null;
                Integer struggling = null;
                Map<String, int[]> users = perLearner.get(e.getKey());
                if (users != null) {
                    learners = users.size();
                    struggling = (int) users.values().stream()
                            .filter(qc -> qc[0] > 0 && qc[1] * 100.0 / qc[0] < STRUGGLING_BELOW).count();
                }
                out.add(LearningInsightsSection.TopicMastery.builder()
                        .topic(displayName(e.getKey()))
                        .questions(questions)
                        .correct(correct)
                        .accuracy(accuracy)
                        .avgTimeSeconds(avgTime)
                        .masteryLevel(masteryFromAccuracy(accuracy))
                        .learners(learners)
                        .learnersStruggling(struggling)
                        .build());
            }
            // Highest mastery first.
            out.sort(Comparator.comparingDouble(
                    (LearningInsightsSection.TopicMastery tm) -> tm.getAccuracy() == null ? 0 : tm.getAccuracy())
                    .reversed());
            return out;
        }

        /** The spelling backed by the most questions; ties go to the alphabetically first. */
        private String displayName(String key) {
            return spellings.get(key).entrySet().stream()
                    .max(Map.Entry.<String, Integer>comparingByValue()
                            .thenComparing(Map.Entry.comparingByKey(Comparator.reverseOrder())))
                    .map(Map.Entry::getKey)
                    .orElse(key);
        }
    }

    private static final class BloomAccumulator {
        private final Map<String, int[]> levels = new LinkedHashMap<>(); // level → [total, correct]

        void add(String level, int total, int correct) {
            levels.computeIfAbsent(level, k -> new int[2]);
            levels.get(level)[0] += total;
            levels.get(level)[1] += correct;
        }

        List<LearningInsightsSection.BloomLevel> build() {
            List<LearningInsightsSection.BloomLevel> out = new ArrayList<>();
            for (String level : BLOOM_LEVELS) {
                int[] tc = levels.get(level);
                if (tc == null || tc[0] <= 0) continue;
                double accuracy = round1(tc[1] * 100.0 / tc[0]);
                out.add(LearningInsightsSection.BloomLevel.builder()
                        .level(level)
                        .total(tc[0])
                        .correct(tc[1])
                        .accuracy(accuracy)
                        .build());
            }
            return out;
        }
    }

    private final class ConfidenceAccumulator {
        private double overallSum = 0.0;
        private int overallCount = 0;
        private int knows = 0;              // high_confidence_correct
        private int lowConfCorrect = 0;     // low_confidence_correct
        private int guessedCorrect = 0;     // guessed_correct
        private int highConfWrong = 0;      // high_confidence_wrong
        private boolean any = false;

        void add(JsonNode node) {
            if (!node.isObject()) return;
            any = true;
            if (node.has("overall_confidence") && !node.get("overall_confidence").isNull()) {
                overallSum += node.get("overall_confidence").asDouble();
                overallCount++;
            }
            knows += asInt(node, "high_confidence_correct", 0);
            lowConfCorrect += asInt(node, "low_confidence_correct", 0);
            guessedCorrect += asInt(node, "guessed_correct", 0);
            highConfWrong += asInt(node, "high_confidence_wrong", 0);
        }

        LearningInsightsSection.ConfidenceProfile build() {
            if (!any) return null;
            Double overall = overallCount > 0 ? round1(overallSum / overallCount) : null;
            return LearningInsightsSection.ConfidenceProfile.builder()
                    .overall(overall)
                    .knows(knows)
                    .guesses(lowConfCorrect + guessedCorrect)
                    .highConfidenceWrong(highConfWrong)
                    .build();
        }
    }

    // ── helpers ─────────────────────────────────────────────────────────────────

    private static String masteryFromAccuracy(double accuracy) {
        if (accuracy >= 85) return "Expert";
        if (accuracy >= 70) return "Proficient";
        if (accuracy >= 50) return "Developing";
        return "Beginner";
    }

    private static String asText(JsonNode node, String field) {
        JsonNode v = node.path(field);
        return v.isMissingNode() || v.isNull() ? null : v.asText();
    }

    private static int asInt(JsonNode node, String field, int def) {
        JsonNode v = node.path(field);
        return v.isMissingNode() || v.isNull() ? def : v.asInt(def);
    }

    private static double asDouble(JsonNode node, String field, double def) {
        JsonNode v = node.path(field);
        return v.isMissingNode() || v.isNull() ? def : v.asDouble(def);
    }

    private static double round1(double v) {
        return Math.round(v * 10.0) / 10.0;
    }
}
