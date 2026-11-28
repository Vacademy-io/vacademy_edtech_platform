package vacademy.io.admin_core_service.features.certificate.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import vacademy.io.admin_core_service.features.certificate.client.AssessmentScoreClient;
import vacademy.io.admin_core_service.features.certificate.dao.CertificateCriteriaDao;
import vacademy.io.admin_core_service.features.certificate.dto.CertificateCriteriaDto;
import vacademy.io.admin_core_service.features.certificate.dto.CertificateEligibilityDto;
import vacademy.io.admin_core_service.features.certificate.dto.CertificateTestOptionDto;
import vacademy.io.admin_core_service.features.certificate.dto.ResolvedCertificateConfig;
import vacademy.io.admin_core_service.features.quiz_results.service.QuizResultsService;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/**
 * Decides whether learners have earned a course certificate under the course's
 * {@link CertificateCriteriaDto}: course progress, marks in chosen quizzes and
 * assessments, or both.
 *
 * <p>Every consumer goes through here - the issue gate, the admin Certificates tab
 * and the learner's course page - so the three can never disagree about who is due.
 *
 * <p>Rules that hold throughout:
 * <ul>
 *   <li><b>Best attempt counts.</b> Retrying a quiz for practice after passing it must
 *       not cost the certificate.</li>
 *   <li><b>Only marks the learner can see.</b> Assessment marks held for a teacher or a
 *       release are AWAITING_RESULT, never a pass.</li>
 *   <li><b>Fails closed.</b> No matching test in the learner's batch, or assessment
 *       marks that could not be fetched, means not eligible - a score rule over an empty
 *       or unknown set must not hand out certificates.</li>
 *   <li><b>Only live tests.</b> Draft slides learners cannot open do not count.</li>
 * </ul>
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class CertificateCriteriaEvaluator {

    private static final Set<String> LIVE_SLIDE_STATUSES = Set.of("PUBLISHED", "UNSYNC");

    private final CertificateCriteriaDao criteriaDao;
    private final QuizResultsService quizResultsService;
    private final AssessmentScoreClient assessmentScoreClient;

    // ------------------------------------------------------------------ rule shape

    public static String modeOf(CertificateCriteriaDto criteria) {
        String mode = criteria != null && criteria.getMode() != null
                ? criteria.getMode().trim().toUpperCase(Locale.ROOT) : null;
        return mode != null && CertificateCriteriaDto.MODES.contains(mode)
                ? mode : CertificateCriteriaDto.MODE_PROGRESS;
    }

    public static boolean requiresScore(CertificateCriteriaDto criteria) {
        return !CertificateCriteriaDto.MODE_PROGRESS.equals(modeOf(criteria));
    }

    public static boolean requiresProgress(CertificateCriteriaDto criteria) {
        return !CertificateCriteriaDto.MODE_SCORE.equals(modeOf(criteria));
    }

    public static String passRuleOf(CertificateCriteriaDto criteria) {
        String rule = criteria != null && criteria.getPassRule() != null
                ? criteria.getPassRule().trim().toUpperCase(Locale.ROOT) : null;
        return rule != null && CertificateCriteriaDto.RULES.contains(rule)
                ? rule : CertificateCriteriaDto.RULE_ALL;
    }

    public static int passPercentOf(CertificateCriteriaDto criteria) {
        Integer pct = criteria != null ? criteria.getPassPercent() : null;
        return pct == null ? CertificateCriteriaDto.DEFAULT_PASS_PERCENT : Math.max(0, Math.min(100, pct));
    }

    /**
     * The live tests the rule counts, out of a batch's tests. A test picked by slide
     * id always counts; a whole course, module or chapter expands to the chosen types.
     */
    public static List<CertificateTestOptionDto> testsInRule(CertificateCriteriaDto criteria,
                                                             List<CertificateTestOptionDto> batchTests) {
        Set<String> types = new HashSet<>();
        if (criteria != null && criteria.getTestTypes() != null) {
            for (String type : criteria.getTestTypes()) {
                if (type != null && CertificateCriteriaDto.TYPES.contains(type.toUpperCase(Locale.ROOT))) {
                    types.add(type.toUpperCase(Locale.ROOT));
                }
            }
        }
        if (types.isEmpty()) {
            types.addAll(CertificateCriteriaDto.TYPES);
        }
        boolean custom = criteria != null
                && CertificateCriteriaDto.SCOPE_CUSTOM.equalsIgnoreCase(criteria.getTestScope());
        Set<String> moduleIds = toSet(criteria != null ? criteria.getModuleIds() : null);
        Set<String> chapterIds = toSet(criteria != null ? criteria.getChapterIds() : null);
        Set<String> slideIds = toSet(criteria != null ? criteria.getSlideIds() : null);

        List<CertificateTestOptionDto> out = new ArrayList<>();
        for (CertificateTestOptionDto test : batchTests) {
            if (test.getStatus() == null || !LIVE_SLIDE_STATUSES.contains(test.getStatus())) {
                continue;
            }
            // An Assessment slide that launches no assessment cannot be taken, so it can be
            // neither passed nor failed; counting it would block the rule for everyone.
            if (CertificateCriteriaDto.TYPE_ASSESSMENT.equals(test.getType())
                    && (test.getAssessmentId() == null || test.getAssessmentId().isBlank())) {
                continue;
            }
            boolean counts;
            if (custom) {
                counts = slideIds.contains(test.getSlideId())
                        || (types.contains(test.getType())
                            && (moduleIds.contains(test.getModuleId()) || chapterIds.contains(test.getChapterId())));
            } else {
                counts = types.contains(test.getType());
            }
            if (counts) {
                out.add(test);
            }
        }
        return out;
    }

    /** How many live tests in this batch the rule counts. */
    public int countTestsInRule(String packageSessionId, CertificateCriteriaDto criteria) {
        return testsInRule(criteria, criteriaDao.findTests(List.of(packageSessionId))).size();
    }

    // ------------------------------------------------------------------ evaluation

    /** One learner. {@code completionPercentage} may be null (no progress row yet). */
    public CertificateEligibilityDto evaluateOne(String packageSessionId, String userId,
                                                 ResolvedCertificateConfig config, Double completionPercentage) {
        Map<String, Double> completion = new HashMap<>();
        completion.put(userId, completionPercentage);
        return evaluate(packageSessionId, config, completion).get(userId);
    }

    /**
     * Many learners of one batch at once: one test lookup, one quiz grading pass and one
     * assessment-service call however many learners there are.
     *
     * @param completionByUser every learner to judge, mapped to their course progress
     *                         (null values allowed)
     */
    public Map<String, CertificateEligibilityDto> evaluate(String packageSessionId,
                                                           ResolvedCertificateConfig config,
                                                           Map<String, Double> completionByUser) {
        CertificateCriteriaDto criteria = config != null ? config.getCriteria() : null;
        String mode = modeOf(criteria);
        boolean progressRequired = requiresProgress(criteria);
        boolean scoreRequired = requiresScore(criteria);
        int threshold = config != null ? config.getThresholdPercent() : CertificateSettingsResolver.DEFAULT_THRESHOLD_PERCENT;
        boolean enabled = config != null && config.isEnabled();

        Map<String, CertificateEligibilityDto> out = new LinkedHashMap<>();
        if (completionByUser == null || completionByUser.isEmpty()) {
            return out;
        }

        ScoreInputs inputs = scoreRequired
                ? loadScoreInputs(packageSessionId, criteria, completionByUser)
                : null;

        for (Map.Entry<String, Double> entry : completionByUser.entrySet()) {
            Double completion = entry.getValue();
            // Same floor the progress gate has always applied to the stored rollup.
            boolean progressMet = completion != null && Math.floor(completion) >= threshold;

            CertificateEligibilityDto result = CertificateEligibilityDto.builder()
                    .enabled(enabled)
                    .mode(mode)
                    .progressRequired(progressRequired)
                    .thresholdPercent(threshold)
                    .completionPercentage(completion)
                    .progressMet(progressMet)
                    .scoreRequired(scoreRequired)
                    .build();

            if (scoreRequired) {
                applyScore(result, entry.getKey(), criteria, inputs);
            }
            boolean eligible = (!progressRequired || progressMet) && (!scoreRequired || result.isScoreMet());
            result.setEligible(eligible);
            out.put(entry.getKey(), result);
        }
        return out;
    }

    /** Everything the per-learner score check needs, loaded once for the whole batch. */
    private static final class ScoreInputs {
        private List<CertificateTestOptionDto> tests = List.of();
        private Map<String, Map<String, QuizResultsService.QuizBestScore>> quizScores = Map.of();
        /** Null when assessments are in the rule but their marks could not be fetched. */
        private Map<String, Map<String, AssessmentScoreClient.AssessmentScore>> assessmentScores = Map.of();
    }

    private ScoreInputs loadScoreInputs(String packageSessionId, CertificateCriteriaDto criteria,
                                        Map<String, Double> completionByUser) {
        ScoreInputs inputs = new ScoreInputs();
        inputs.tests = testsInRule(criteria, criteriaDao.findTests(List.of(packageSessionId)));
        if (inputs.tests.isEmpty()) {
            return inputs;
        }
        String singleUser = completionByUser.size() == 1 ? completionByUser.keySet().iterator().next() : null;

        boolean hasQuiz = inputs.tests.stream()
                .anyMatch(t -> CertificateCriteriaDto.TYPE_QUIZ.equals(t.getType()));
        if (hasQuiz) {
            inputs.quizScores = quizResultsService.getBestScores(packageSessionId, singleUser);
        }

        List<String> assessmentIds = inputs.tests.stream()
                .filter(t -> CertificateCriteriaDto.TYPE_ASSESSMENT.equals(t.getType()))
                .map(CertificateTestOptionDto::getAssessmentId)
                .filter(id -> id != null && !id.isBlank())
                .distinct()
                .toList();
        if (!assessmentIds.isEmpty()) {
            inputs.assessmentScores = assessmentScoreClient.fetchBestScores(
                    new ArrayList<>(completionByUser.keySet()), assessmentIds);
        }
        return inputs;
    }

    private void applyScore(CertificateEligibilityDto result, String userId,
                            CertificateCriteriaDto criteria, ScoreInputs inputs) {
        String rule = passRuleOf(criteria);
        int passPercent = passPercentOf(criteria);
        boolean useOwn = criteria == null || !Boolean.FALSE.equals(criteria.getUseOwnPassPercent());
        boolean average = CertificateCriteriaDto.RULE_AVERAGE.equals(rule);

        result.setPassRule(rule);
        result.setPassPercent(passPercent);

        int passed = 0;
        int awaiting = 0;
        int notAttempted = 0;
        double scoreSum = 0;
        boolean assessmentsUnknown = false;
        List<CertificateEligibilityDto.TestResult> tests = new ArrayList<>(inputs.tests.size());

        for (CertificateTestOptionDto test : inputs.tests) {
            int attempts;
            Double percent;
            boolean mayRise;
            Double bar = average ? null
                    : (useOwn && test.getOwnPassPercent() != null ? test.getOwnPassPercent() : (double) passPercent);

            if (CertificateCriteriaDto.TYPE_QUIZ.equals(test.getType())) {
                QuizResultsService.QuizBestScore quiz = inputs.quizScores
                        .getOrDefault(test.getSlideId(), Map.of()).get(userId);
                attempts = quiz != null ? quiz.attempts() : 0;
                percent = quiz != null ? quiz.bestPercent() : null;
                mayRise = quiz != null && quiz.awaitingGrading();
            } else if (inputs.assessmentScores == null) {
                // Could not ask: unknown, not "not attempted".
                assessmentsUnknown = true;
                attempts = 0;
                percent = null;
                mayRise = true;
            } else {
                AssessmentScoreClient.AssessmentScore score = inputs.assessmentScores
                        .getOrDefault(userId, Map.of()).get(test.getAssessmentId());
                attempts = score != null ? (int) (score.finalAttempts() + score.heldAttempts()) : 0;
                percent = score != null && score.finalAttempts() > 0 ? score.bestPercent() : null;
                mayRise = score != null && score.heldAttempts() > 0;
            }

            String status;
            if (CertificateCriteriaDto.TYPE_ASSESSMENT.equals(test.getType()) && inputs.assessmentScores == null) {
                status = CertificateEligibilityDto.STATUS_AWAITING_RESULT;
            } else if (attempts == 0) {
                status = CertificateEligibilityDto.STATUS_NOT_ATTEMPTED;
            } else if (percent == null) {
                status = CertificateEligibilityDto.STATUS_AWAITING_RESULT;
            } else if (average) {
                // Still being graded: the score may rise, so say so rather than "done".
                status = mayRise ? CertificateEligibilityDto.STATUS_AWAITING_RESULT
                        : CertificateEligibilityDto.STATUS_COMPLETED;
            } else if (percent >= bar) {
                status = CertificateEligibilityDto.STATUS_PASSED;
            } else if (mayRise) {
                status = CertificateEligibilityDto.STATUS_AWAITING_RESULT;
            } else {
                status = CertificateEligibilityDto.STATUS_FAILED;
            }

            switch (status) {
                case CertificateEligibilityDto.STATUS_PASSED -> passed++;
                case CertificateEligibilityDto.STATUS_AWAITING_RESULT -> awaiting++;
                case CertificateEligibilityDto.STATUS_NOT_ATTEMPTED -> notAttempted++;
                default -> { /* FAILED / COMPLETED */ }
            }
            scoreSum += percent != null ? percent : 0;

            tests.add(CertificateEligibilityDto.TestResult.builder()
                    .slideId(test.getSlideId())
                    .title(test.getTitle())
                    .type(test.getType())
                    .moduleName(test.getModuleName())
                    .chapterName(test.getChapterName())
                    .scorePercent(percent)
                    .passPercent(bar)
                    .status(status)
                    .attempts(attempts)
                    .build());
        }

        int total = inputs.tests.size();
        Double averagePercent = total > 0 ? Math.round(scoreSum * 10.0 / total) / 10.0 : null;
        Integer required = null;
        boolean met;
        if (total == 0) {
            met = false;
            result.setScoreBlocker(CertificateEligibilityDto.BLOCKER_NO_TESTS);
        } else if (CertificateCriteriaDto.RULE_AT_LEAST.equals(rule)) {
            int wanted = criteria != null && criteria.getMinTestsToPass() != null ? criteria.getMinTestsToPass() : 1;
            required = Math.max(1, Math.min(total, wanted));
            met = passed >= required;
        } else if (average) {
            met = averagePercent != null && averagePercent >= passPercent;
        } else {
            required = total;
            met = passed == total;
        }
        if (assessmentsUnknown) {
            met = false;
            result.setScoreBlocker(CertificateEligibilityDto.BLOCKER_SCORES_UNAVAILABLE);
        }

        result.setTests(tests);
        result.setTestsTotal(total);
        result.setTestsPassed(passed);
        result.setTestsAwaitingResult(awaiting);
        result.setTestsNotAttempted(notAttempted);
        result.setTestsRequired(required);
        result.setAverageScorePercent(averagePercent);
        result.setScoreMet(met);
    }

    private static Set<String> toSet(List<String> values) {
        Set<String> set = new HashSet<>();
        if (values != null) {
            for (String value : values) {
                if (value != null && !value.isBlank()) {
                    set.add(value);
                }
            }
        }
        return set;
    }
}
