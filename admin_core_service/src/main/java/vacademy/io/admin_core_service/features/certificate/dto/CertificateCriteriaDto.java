package vacademy.io.admin_core_service.features.certificate.dto;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.util.List;
import java.util.Set;

/**
 * What a learner has to do to earn this course's certificate, stored inside the
 * course's {@code CERTIFICATE_SETTING} next to the other per-course overrides.
 *
 * <p>Null, or a null {@link #mode}, means the rule every course had before this
 * existed: course progress at or above the threshold. Nothing about a course that
 * never saved criteria changes.
 *
 * <p>Course-level only. The tests are slides inside one course, so an institute
 * default cannot name them.
 */
@Setter
@Getter
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonIgnoreProperties(ignoreUnknown = true)
public class CertificateCriteriaDto {

    public static final String MODE_PROGRESS = "PROGRESS";
    public static final String MODE_SCORE = "SCORE";
    public static final String MODE_PROGRESS_AND_SCORE = "PROGRESS_AND_SCORE";
    public static final Set<String> MODES = Set.of(MODE_PROGRESS, MODE_SCORE, MODE_PROGRESS_AND_SCORE);

    public static final String SCOPE_ALL = "ALL";
    public static final String SCOPE_CUSTOM = "CUSTOM";
    public static final Set<String> SCOPES = Set.of(SCOPE_ALL, SCOPE_CUSTOM);

    public static final String RULE_ALL = "ALL";
    public static final String RULE_AT_LEAST = "AT_LEAST";
    public static final String RULE_AVERAGE = "AVERAGE";
    public static final Set<String> RULES = Set.of(RULE_ALL, RULE_AT_LEAST, RULE_AVERAGE);

    public static final String TYPE_QUIZ = "QUIZ";
    public static final String TYPE_ASSESSMENT = "ASSESSMENT";
    public static final Set<String> TYPES = Set.of(TYPE_QUIZ, TYPE_ASSESSMENT);

    public static final int DEFAULT_PASS_PERCENT = 60;

    /** PROGRESS | SCORE | PROGRESS_AND_SCORE. Null means PROGRESS. */
    private String mode;

    /**
     * ALL = every quiz and assessment in the course (filtered by {@link #testTypes});
     * CUSTOM = the union of {@link #moduleIds}, {@link #chapterIds} and {@link #slideIds}.
     * Null means ALL.
     */
    private String testScope;

    /** CUSTOM: every test inside these modules, including tests added later. */
    private List<String> moduleIds;

    /** CUSTOM: every test inside these chapters, including tests added later. */
    private List<String> chapterIds;

    /** CUSTOM: these exact quiz or assessment slides, whatever {@link #testTypes} says. */
    private List<String> slideIds;

    /**
     * Which kinds of test a course, module or chapter selection expands to:
     * QUIZ and/or ASSESSMENT. Null or empty means both.
     */
    private List<String> testTypes;

    /** ALL | AT_LEAST | AVERAGE. Null means ALL. */
    private String passRule;

    /** AT_LEAST: how many of the tests must be passed. */
    private Integer minTestsToPass;

    /**
     * The pass mark, as a percentage of a test's maximum marks. With AVERAGE it is
     * the bar for the average across all the tests. Null means 60.
     */
    private Integer passPercent;

    /**
     * When true (the default), a quiz that has its own pass % is judged by it and
     * {@link #passPercent} covers only tests without one (assessments never have one).
     * When false, {@link #passPercent} applies to every test.
     */
    private Boolean useOwnPassPercent;
}
