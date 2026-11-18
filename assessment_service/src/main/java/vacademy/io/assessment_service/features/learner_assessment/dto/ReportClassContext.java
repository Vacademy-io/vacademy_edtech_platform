package vacademy.io.assessment_service.features.learner_assessment.dto;

import com.fasterxml.jackson.annotation.JsonIgnore;
import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AccessLevel;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import vacademy.io.assessment_service.features.assessment.dto.LeaderBoardDto;
import vacademy.io.assessment_service.features.assessment.dto.admin_get_dto.response.AssessmentOverviewDto;
import vacademy.io.assessment_service.features.assessment.dto.admin_get_dto.response.MarksRankDto;
import vacademy.io.assessment_service.features.learner_assessment.dto.context.HistogramSpec;
import vacademy.io.assessment_service.features.learner_assessment.dto.context.SectionAggregateSnapshot;
import vacademy.io.assessment_service.features.learner_assessment.dto.context.SectionSnapshot;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.function.Function;

/**
 * Job-scoped, immutable-after-build carrier of all assessment-wide report
 * data. Built once per bulk-export job (or per request for the existing
 * single-attempt callers) by {@code LearnerReportService.loadClassContext},
 * and reused per student via {@code buildComparisonFromContext} /
 * {@code createStudentReportDetailResponse(ctx, ...)}.
 *
 * <p>NOT routed through the Spring cache — {@code @CacheEvict(allEntries=true)}
 * fires on every attempt update (see plan C11), which would make it unusable
 * as mid-job state.
 *
 * <p>Fields marked {@code @JsonIgnore} are deliberately excluded from the
 * {@code context_snapshot} persisted on the export job row: they are
 * immutable for a published assessment and cheap to re-query, whereas the
 * snapshotted fields are the §6.3 consistency guarantee (every report in one
 * ZIP quotes identical class statistics regardless of how many runs produced
 * it). See ARCHITECTURE.md §5.1.
 */
@Getter
@Setter
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
@JsonIgnoreProperties(ignoreUnknown = true)
public class ReportClassContext {

    // ---- identity (snapshotted) ----
    private String assessmentId;
    private String instituteId;
    private String assessmentName;

    // ---- class aggregates (SNAPSHOTTED — the §6.3 consistency guarantee) ----
    private AssessmentOverviewDto overview;              // holds AssessmentOverviewSnapshot
    private List<MarksRankDto> marksDistribution;         // holds MarksRankSnapshot
    private List<LeaderBoardDto> fullLeaderboard;          // holds LeaderBoardSnapshot
    private Map<String, SectionAggregateSnapshot> sectionAggregation; // by sectionId
    private Double totalMarks;
    private Double classAccuracy;
    private Double highestMarks;
    private Double lowestMarks;
    private HistogramSpec histogram;
    private ReportBrandingDto branding;

    // ---- assessment structure (NOT snapshotted — immutable & cheap to re-query) ----
    @JsonIgnore
    @Builder.Default
    private List<SectionSnapshot> sections = List.of();
    @JsonIgnore
    @Builder.Default
    private Map<String, Integer> questionOrderByQuestionAndSection = new HashMap<>(); // "qId#sId" -> order
    @JsonIgnore
    @Builder.Default
    private Map<String, Map<String, Double>> optionDistribution = new HashMap<>(); // qId -> optId -> pct

    /**
     * sectionId -> questionId -> the newest mapping's marking_json: the paper's max of an old
     * question_wise_marks row that has none. Filled lazily, once per section, by the report
     * reader ({@link #markingJsonForSection}); never snapshotted. Not a builder/constructor
     * argument, so every context, however built, starts with an empty cache.
     */
    @JsonIgnore
    @Getter(AccessLevel.NONE)
    @Setter(AccessLevel.NONE)
    private final ConcurrentHashMap<String, Map<String, String>> markingJsonBySection = new ConcurrentHashMap<>();

    // ---- provenance ----
    private int snapshotVersion;
    @JsonIgnore
    private boolean rebuiltAfterDriftFailure;

    /**
     * The section's question -> marking_json, loaded by {@code loader} the first time a
     * section is asked for and reused for every later attempt of the job. A loader that
     * returns null (a failed load) caches nothing and returns null.
     */
    public Map<String, String> markingJsonForSection(String sectionId,
                                                     Function<String, Map<String, String>> loader) {
        return markingJsonBySection.computeIfAbsent(sectionId, loader);
    }

    public static String mappingKey(String questionId, String sectionId) {
        return questionId + '#' + sectionId;
    }
}
