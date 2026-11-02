package vacademy.io.admin_core_service.features.student_analysis.dto.comprehensive;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

/**
 * v2 comprehensive report ADDITIVE section: "Learning Insights" — serialized as
 * {@code learning_insights}.
 *
 * <p>Built by {@code LearningInsightsCollector} by parsing and aggregating the per-attempt
 * {@code activity_log.processed_json} that the LLM-analytics pipeline already produces
 * (see {@code docs/LLM_ANALYSIS.md}). This turns data that v1 only ever dumped as opaque
 * prompt text into structured, graph-ready numbers:
 * <ul>
 *   <li>{@code topic_mastery} — per-topic accuracy/mastery across all attempts in range (bar/heat).</li>
 *   <li>{@code blooms} — the six cognitive levels with correct/total (radar).</li>
 *   <li>{@code confidence} — knows-vs-guesses buckets (donut).</li>
 *   <li>{@code misconceptions} — concrete "what went wrong → how to fix" cards.</li>
 * </ul>
 *
 * <p>All numbers are computed deterministically in Java from the parsed JSON — no LLM here.
 * Degrades to {@code available=false} when there are no processed attempts to parse.
 */
@Data
@Builder
@AllArgsConstructor
@NoArgsConstructor
@JsonInclude(JsonInclude.Include.NON_NULL)
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class LearningInsightsSection {

    private boolean available;

    /** Number of processed attempts (activity_log rows) that fed this section. */
    private Integer attemptsAnalyzed;

    /** Per-topic mastery aggregated across all analyzed attempts (highest-mastery first). */
    private List<TopicMastery> topicMastery;

    /** The six Bloom's cognitive levels with aggregated correct/total. Fixed order R→U→A→An→E→C. */
    private List<BloomLevel> blooms;

    /** Aggregated confidence profile: how much the learner knows vs guesses. */
    private ConfidenceProfile confidence;

    /** Concrete misconceptions with remediation (newest first, capped). */
    private List<Misconception> misconceptions;

    @Data
    @Builder
    @AllArgsConstructor
    @NoArgsConstructor
    @JsonInclude(JsonInclude.Include.NON_NULL)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class TopicMastery {
        private String topic;
        private Integer questions;
        private Integer correct;
        /** correct / questions * 100, recomputed in Java. */
        private Double accuracy;
        private Double avgTimeSeconds;
        /** Expert / Proficient / Developing / Beginner — derived from aggregated accuracy. */
        private String masteryLevel;
        /** Cohort roll-up only: learners with questions in this topic. */
        private Integer learners;
        /** Cohort roll-up only: of those, learners under 40% in this topic. */
        private Integer learnersStruggling;
    }

    @Data
    @Builder
    @AllArgsConstructor
    @NoArgsConstructor
    @JsonInclude(JsonInclude.Include.NON_NULL)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class BloomLevel {
        /** remember | understand | apply | analyze | evaluate | create */
        private String level;
        private Integer total;
        private Integer correct;
        /** correct / total * 100, recomputed in Java (null when total = 0). */
        private Double accuracy;
    }

    @Data
    @Builder
    @AllArgsConstructor
    @NoArgsConstructor
    @JsonInclude(JsonInclude.Include.NON_NULL)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class ConfidenceProfile {
        /** Average overall_confidence across attempts (0-100). */
        private Double overall;
        /** high_confidence_correct — confidently right (truly knows). */
        private Integer knows;
        /** low_confidence_correct + guessed_correct — right but unsure. */
        private Integer guesses;
        /** high_confidence_wrong — confidently wrong (dangerous misconceptions). */
        private Integer highConfidenceWrong;
    }

    @Data
    @Builder
    @AllArgsConstructor
    @NoArgsConstructor
    @JsonInclude(JsonInclude.Include.NON_NULL)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class Misconception {
        /** Optional topic/subject hint if the source carried one. */
        private String topic;
        /** Short summary of the question/context where it surfaced. */
        private String context;
        private String misconception;
        private String remediation;
    }
}
