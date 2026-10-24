package vacademy.io.admin_core_service.features.quiz_results.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.learner_tracking.util.AutoEvaluationScorer;
import vacademy.io.admin_core_service.features.learner_tracking.util.RichTextForAI;
import vacademy.io.admin_core_service.features.quiz_results.dto.LearnerQuizAnswersResponse;
import vacademy.io.admin_core_service.features.quiz_results.dto.LearnerQuizDetailResponse;
import vacademy.io.admin_core_service.features.quiz_results.dto.LearnerQuizOverviewResponse;
import vacademy.io.admin_core_service.features.quiz_results.dto.QuizAttemptProjection;
import vacademy.io.admin_core_service.features.quiz_results.dto.QuizLearnerProjection;
import vacademy.io.admin_core_service.features.quiz_results.dto.QuizLearnerResultsResponse;
import vacademy.io.admin_core_service.features.quiz_results.dto.QuizOptionProjection;
import vacademy.io.admin_core_service.features.quiz_results.dto.QuizOverviewResponse;
import vacademy.io.admin_core_service.features.quiz_results.dto.QuizQuestionAnalysisResponse;
import vacademy.io.admin_core_service.features.quiz_results.dto.QuizQuestionProjection;
import vacademy.io.admin_core_service.features.quiz_results.dto.QuizResponseProjection;
import vacademy.io.admin_core_service.features.quiz_results.dto.QuizSlideMetaProjection;
import vacademy.io.admin_core_service.features.quiz_results.repository.QuizResultsRepository;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.VacademyException;

import java.sql.Timestamp;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Builds the course-details Quiz Results tab.
 *
 * <p><b>Why scoring happens here and not in SQL.</b> {@code response_status} is only
 * sometimes a verdict. The quiz viewer graded client-side and its "Finish" path wrote the
 * placeholder {@code "SUBMITTED"} for every question until server-side scoring landed, so
 * the large majority of stored responses carry no verdict. Aggregating that column would
 * report a class that answered everything correctly as having scored zero - the same bug
 * the scoring fix was written for, re-introduced one layer up. So every response is
 * re-derived from the question's stored answer key via {@link AutoEvaluationScorer}
 * whenever the stored status is not already a real verdict.
 *
 * <p>Responses the scorer cannot grade (free text, manual evaluation, an unrecognised key)
 * are reported as {@code ungraded} rather than silently counted wrong.
 */
@Service
@Slf4j
@RequiredArgsConstructor
public class QuizResultsService {

    /** Wrong-answer statuses; the apps have written both spellings over time. */
    private static final Set<String> WRONG_STATUSES = Set.of("WRONG", "INCORRECT");

    private static final String STATUS_CORRECT = "CORRECT";

    /** Per-answer verdict for a WRONG answer that still earned partial marks. */
    private static final String VERDICT_PARTIAL = "PARTIAL";
    private static final String STATUS_SKIPPED = "SKIPPED";

    private final QuizResultsRepository quizResultsRepository;
    private final AutoEvaluationScorer autoEvaluationScorer;

    /**
     * Ceiling on the learner roster returned for one quiz. A batch is normally tens to low
     * hundreds of learners; the cap exists only so a pathological batch cannot make the
     * response unbounded, and the UI is told when it bites rather than quietly showing a
     * partial class.
     */
    @Value("${quiz-results.learner-row-limit:2000}")
    private int learnerRowLimit;

    // ------------------------------------------------------------------- overview

    /** Every quiz in the batch with participation and score aggregates. */
    public QuizOverviewResponse getOverview(String batchId, CustomUserDetails user) {
        requireText(batchId, "batchId");

        List<QuizSlideMetaProjection> metas = quizResultsRepository.getQuizSlides(batchId, null);
        long enrolled = quizResultsRepository.countEnrolledLearners(batchId);
        if (metas.isEmpty()) {
            return QuizOverviewResponse.builder()
                    .summary(QuizOverviewResponse.Summary.builder()
                            .totalQuizzes(0)
                            .enrolledLearners(enrolled)
                            .learnersAttempted(0)
                            .attemptedPairs(0)
                            .quizzesWithNoAttempts(0)
                            .build())
                    .quizzes(List.of())
                    .build();
        }

        QuestionIndex index = loadQuestionIndex(batchId, null, false);
        Map<String, Map<String, AttemptScore>> scores =
                grade(quizResultsRepository.getLatestAttemptResponses(batchId, null, null), index);
        Map<String, List<QuizAttemptProjection>> attemptsBySlide = new HashMap<>();
        for (QuizAttemptProjection attempt : quizResultsRepository.getAttempts(batchId, null, null)) {
            attemptsBySlide.computeIfAbsent(attempt.getSlideId(), k -> new ArrayList<>()).add(attempt);
        }

        List<QuizOverviewResponse.QuizRow> quizzes = new ArrayList<>(metas.size());
        Set<String> distinctAttemptees = new HashSet<>();
        double weightedPercentSum = 0;
        long scoredPairs = 0;
        long attemptedPairs = 0;
        int noAttempts = 0;

        for (QuizSlideMetaProjection meta : metas) {
            List<QuizAttemptProjection> attempts = attemptsBySlide.getOrDefault(meta.getSlideId(), List.of());
            Map<String, AttemptScore> slideScores = scores.getOrDefault(meta.getSlideId(), Map.of());
            double totalMarks = nz(meta.getTotalMarks());

            long totalAttempts = 0;
            long timeSecondsSum = 0;
            long timedLearners = 0;
            long passed = 0;
            Timestamp lastAttemptAt = null;
            AttemptScore batchTotals = new AttemptScore();
            List<Double> percents = new ArrayList<>(attempts.size());

            for (QuizAttemptProjection attempt : attempts) {
                distinctAttemptees.add(attempt.getUserId());
                totalAttempts += nz(attempt.getAttemptCount());
                if (attempt.getLastAttemptAt() != null
                        && (lastAttemptAt == null || attempt.getLastAttemptAt().after(lastAttemptAt))) {
                    lastAttemptAt = attempt.getLastAttemptAt();
                }
                if (attempt.getEngagedMs() != null && attempt.getEngagedMs() > 0) {
                    timeSecondsSum += attempt.getEngagedMs() / 1000;
                    timedLearners++;
                }
                // An attempt with no graded responses still counts as a 0 - the learner
                // did open and submit the quiz, and hiding them would flatter the batch.
                AttemptScore score = slideScores.getOrDefault(attempt.getUserId(), new AttemptScore());
                batchTotals.add(score);
                if (totalMarks > 0) {
                    percents.add(score.obtained * 100.0 / totalMarks);
                }
            }

            long attemptedLearners = attempts.size();
            Double avgScorePercent = mean(percents);
            if (attemptedLearners == 0) {
                noAttempts++;
            } else {
                attemptedPairs += attemptedLearners;
                if (avgScorePercent != null) {
                    // Weighted by learners, so the tab-level average is a mean over
                    // learner-quiz pairs rather than a mean of per-quiz means (which would
                    // let a quiz two people took outweigh one the whole batch took).
                    weightedPercentSum += avgScorePercent * attemptedLearners;
                    scoredPairs += attemptedLearners;
                }
            }
            if (meta.getPassPercentage() != null && totalMarks > 0) {
                for (Double percent : percents) {
                    if (percent >= meta.getPassPercentage()) {
                        passed++;
                    }
                }
            }

            long graded = batchTotals.correct + batchTotals.wrong + batchTotals.skipped;
            quizzes.add(QuizOverviewResponse.QuizRow.builder()
                    .slideId(meta.getSlideId())
                    .quizSlideId(meta.getQuizSlideId())
                    .title(meta.getSlideTitle())
                    .slideStatus(meta.getSlideStatus())
                    .subjectName(meta.getSubjectName())
                    .moduleName(meta.getModuleName())
                    .chapterId(meta.getChapterId())
                    .chapterName(meta.getChapterName())
                    .questionCount(nz(meta.getQuestionCount()))
                    .totalMarks(totalMarks)
                    .passPercentage(meta.getPassPercentage())
                    .timeLimitInMinutes(meta.getTimeLimitInMinutes())
                    .attemptedLearners(attemptedLearners)
                    .enrolledLearners(enrolled)
                    .totalAttempts(totalAttempts)
                    .avgScorePercent(avgScorePercent)
                    .accuracyPercent(graded > 0 ? round1(batchTotals.correct * 100.0 / graded) : null)
                    .correctResponses(batchTotals.correct)
                    .wrongResponses(batchTotals.wrong)
                    .skippedResponses(batchTotals.skipped)
                    .ungradedResponses(batchTotals.ungraded)
                    .passedLearners(meta.getPassPercentage() == null ? null : passed)
                    .avgTimeSeconds(timedLearners > 0 ? timeSecondsSum / timedLearners : null)
                    .lastAttemptAtEpochMillis(epochMillis(lastAttemptAt))
                    .build());
        }

        long possiblePairs = (long) quizzes.size() * enrolled;
        return QuizOverviewResponse.builder()
                .summary(QuizOverviewResponse.Summary.builder()
                        .totalQuizzes(quizzes.size())
                        .enrolledLearners(enrolled)
                        .learnersAttempted(distinctAttemptees.size())
                        .attemptedPairs(attemptedPairs)
                        .avgScorePercent(scoredPairs > 0 ? round1(weightedPercentSum / scoredPairs) : null)
                        .participationPercent(possiblePairs > 0
                                ? round1(attemptedPairs * 100.0 / possiblePairs)
                                : null)
                        .quizzesWithNoAttempts(noAttempts)
                        .build())
                .quizzes(quizzes)
                .build();
    }

    // -------------------------------------------------------------- learner results

    /** One quiz: a row per enrolled learner, including everyone who never attempted it. */
    public QuizLearnerResultsResponse getQuizResults(String batchId, String slideId, CustomUserDetails user) {
        requireText(batchId, "batchId");
        requireText(slideId, "slideId");

        QuizSlideMetaProjection meta = firstOrNull(quizResultsRepository.getQuizSlides(batchId, slideId));
        if (meta == null) {
            throw new VacademyException("No quiz found for slide " + slideId + " in this batch");
        }

        QuestionIndex index = loadQuestionIndex(batchId, slideId, false);
        Map<String, AttemptScore> scores =
                grade(quizResultsRepository.getLatestAttemptResponses(batchId, slideId, null), index)
                        .getOrDefault(slideId, Map.of());
        Map<String, QuizAttemptProjection> attempts = new HashMap<>();
        for (QuizAttemptProjection attempt : quizResultsRepository.getAttempts(batchId, slideId, null)) {
            attempts.put(attempt.getUserId(), attempt);
        }

        List<QuizLearnerProjection> roster =
                quizResultsRepository.getBatchRoster(batchId, learnerRowLimit + 1);
        boolean truncated = roster.size() > learnerRowLimit;
        if (truncated) {
            roster = roster.subList(0, learnerRowLimit);
        }

        long questionCount = nz(meta.getQuestionCount());
        double totalMarks = nz(meta.getTotalMarks());
        Double passPercentage = meta.getPassPercentage();

        List<QuizLearnerResultsResponse.LearnerRow> learners = new ArrayList<>(roster.size());
        List<Double> attemptedPercents = new ArrayList<>();
        long attemptedLearners = 0;
        long totalAttempts = 0;
        long passed = 0;
        long ungradedResponses = 0;
        long timeSecondsSum = 0;
        long timedLearners = 0;

        for (QuizLearnerProjection learner : roster) {
            QuizAttemptProjection attempt = attempts.get(learner.getUserId());
            boolean attempted = attempt != null;
            AttemptScore score = attempted
                    ? scores.getOrDefault(learner.getUserId(), new AttemptScore())
                    : new AttemptScore();

            Double scorePercent = (attempted && totalMarks > 0)
                    ? round1(score.obtained * 100.0 / totalMarks)
                    : null;
            long unanswered = attempted ? Math.max(0, questionCount - score.responded()) : questionCount;
            String status = resolveLearnerStatus(attempted, scorePercent, passPercentage, unanswered);

            if (attempted) {
                attemptedLearners++;
                totalAttempts += nz(attempt.getAttemptCount());
                ungradedResponses += score.ungraded;
                if (scorePercent != null) {
                    attemptedPercents.add(scorePercent);
                }
                if ("PASSED".equals(status)) {
                    passed++;
                }
                if (attempt.getEngagedMs() != null && attempt.getEngagedMs() > 0) {
                    timeSecondsSum += attempt.getEngagedMs() / 1000;
                    timedLearners++;
                }
            }

            learners.add(QuizLearnerResultsResponse.LearnerRow.builder()
                    .userId(learner.getUserId())
                    .fullName(learner.getFullName())
                    .email(learner.getEmail())
                    .mobileNumber(learner.getMobileNumber())
                    .enrollmentStatus(learner.getEnrollmentStatus())
                    .status(status)
                    .attemptCount(attempted ? nz(attempt.getAttemptCount()) : 0)
                    .lastAttemptAtEpochMillis(attempted ? epochMillis(attempt.getLastAttemptAt()) : null)
                    .latestActivityId(attempted ? attempt.getActivityId() : null)
                    .marksObtained(attempted ? round2(score.obtained) : null)
                    .totalMarks(totalMarks)
                    .scorePercent(scorePercent)
                    .correctCount(score.correct)
                    .wrongCount(score.wrong)
                    .skippedCount(score.skipped)
                    .ungradedCount(score.ungraded)
                    .unansweredCount(unanswered)
                    .timeSpentSeconds(attempted && attempt.getEngagedMs() != null
                            ? attempt.getEngagedMs() / 1000
                            : null)
                    .build());
        }

        QuizLearnerResultsResponse.QuizMeta quizMeta = QuizLearnerResultsResponse.QuizMeta.builder()
                .slideId(meta.getSlideId())
                .quizSlideId(meta.getQuizSlideId())
                .title(meta.getSlideTitle())
                .slideStatus(meta.getSlideStatus())
                .subjectName(meta.getSubjectName())
                .moduleName(meta.getModuleName())
                .chapterName(meta.getChapterName())
                .questionCount(questionCount)
                .totalMarks(totalMarks)
                .passPercentage(passPercentage)
                .timeLimitInMinutes(meta.getTimeLimitInMinutes())
                .reAttemptCount(meta.getReAttemptCount())
                .enrolledLearners(learners.size())
                .attemptedLearners(attemptedLearners)
                .totalAttempts(totalAttempts)
                .ungradedResponses(ungradedResponses)
                .avgScorePercent(mean(attemptedPercents))
                .highestScorePercent(attemptedPercents.isEmpty() ? null : Collections.max(attemptedPercents))
                .lowestScorePercent(attemptedPercents.isEmpty() ? null : Collections.min(attemptedPercents))
                .medianScorePercent(median(attemptedPercents))
                .passedLearners(passPercentage == null ? null : passed)
                .avgTimeSeconds(timedLearners > 0 ? timeSecondsSum / timedLearners : null)
                .build();

        return QuizLearnerResultsResponse.builder()
                .quiz(quizMeta)
                .distribution(buildDistribution(attemptedPercents))
                .learners(learners)
                .returned(learners.size())
                .truncated(truncated)
                .build();
    }

    /**
     * PASSED/FAILED only where the quiz defines a pass mark. Without one the honest answer
     * is how much of the quiz the learner actually finished, not an invented pass line.
     */
    private String resolveLearnerStatus(boolean attempted, Double scorePercent, Double passPercentage,
            long unanswered) {
        if (!attempted) {
            return "NOT_ATTEMPTED";
        }
        if (passPercentage != null && scorePercent != null) {
            return scorePercent >= passPercentage ? "PASSED" : "FAILED";
        }
        return unanswered > 0 ? "PARTIAL" : "COMPLETED";
    }

    /** Fixed 10% bands so the spread is comparable between quizzes, not data-fitted. */
    private QuizLearnerResultsResponse.Distribution buildDistribution(List<Double> percents) {
        long[] counts = new long[10];
        for (Double percent : percents) {
            if (percent == null) {
                continue;
            }
            // 100% belongs in the top band, not an eleventh one.
            int bucket = Math.max(0, Math.min(9, (int) Math.floor(percent / 10.0)));
            counts[bucket]++;
        }
        List<QuizLearnerResultsResponse.Distribution.Bucket> buckets = new ArrayList<>(10);
        for (int i = 0; i < 10; i++) {
            buckets.add(QuizLearnerResultsResponse.Distribution.Bucket.builder()
                    .from(i * 10)
                    .to(i == 9 ? 100 : i * 10 + 9)
                    .learners(counts[i])
                    .build());
        }
        return QuizLearnerResultsResponse.Distribution.builder().buckets(buckets).build();
    }


    // ------------------------------------------------------------- learner-wise view

    /**
     * Learner-wise overview: the same graded data as {@link #getOverview}, pivoted so the
     * learner is the row. One grading pass answers both questions — "which quiz is landing
     * badly" and "who is falling behind".
     */
    public LearnerQuizOverviewResponse getLearnerOverview(String batchId, CustomUserDetails user) {
        requireText(batchId, "batchId");

        List<QuizSlideMetaProjection> metas = quizResultsRepository.getQuizSlides(batchId, null);
        List<QuizLearnerProjection> roster = quizResultsRepository.getBatchRoster(batchId, learnerRowLimit + 1);
        boolean truncated = roster.size() > learnerRowLimit;
        if (truncated) {
            roster = roster.subList(0, learnerRowLimit);
        }

        Map<String, Map<String, AttemptScore>> scores = metas.isEmpty()
                ? Map.of()
                : grade(quizResultsRepository.getLatestAttemptResponses(batchId, null, null),
                        loadQuestionIndex(batchId, null, false));
        Map<String, Map<String, QuizAttemptProjection>> attemptsBySlide = new HashMap<>();
        for (QuizAttemptProjection attempt : quizResultsRepository.getAttempts(batchId, null, null)) {
            attemptsBySlide.computeIfAbsent(attempt.getSlideId(), k -> new HashMap<>())
                    .put(attempt.getUserId(), attempt);
        }

        double courseMaxMarks = metas.stream().mapToDouble(m -> nz(m.getTotalMarks())).sum();
        List<LearnerQuizOverviewResponse.LearnerRow> rows = new ArrayList<>(roster.size());
        List<Double> learnerAverages = new ArrayList<>();
        long learnersAttempted = 0;

        for (QuizLearnerProjection learner : roster) {
            LearnerQuizOverviewResponse.LearnerRow row =
                    buildLearnerRow(learner, metas, attemptsBySlide, scores, courseMaxMarks);
            if (row.getQuizzesAttempted() > 0) {
                learnersAttempted++;
                if (row.getAvgScorePercent() != null) {
                    learnerAverages.add(row.getAvgScorePercent());
                }
            }
            rows.add(row);
        }

        return LearnerQuizOverviewResponse.builder()
                .summary(LearnerQuizOverviewResponse.Summary.builder()
                        .enrolledLearners(rows.size())
                        .quizzesInCourse(metas.size())
                        .learnersAttempted(learnersAttempted)
                        .learnersNotStarted(rows.size() - learnersAttempted)
                        .avgScorePercent(mean(learnerAverages))
                        .build())
                .learners(rows)
                .returned(rows.size())
                .truncated(truncated)
                .build();
    }

    /** One learner's row: their totals across every quiz in the course. */
    private LearnerQuizOverviewResponse.LearnerRow buildLearnerRow(
            QuizLearnerProjection learner,
            List<QuizSlideMetaProjection> metas,
            Map<String, Map<String, QuizAttemptProjection>> attemptsBySlide,
            Map<String, Map<String, AttemptScore>> scores,
            double courseMaxMarks) {

        double obtained = 0;
        double attemptedMax = 0;
        int attemptedQuizzes = 0;
        long totalAttempts = 0;
        long passed = 0;
        long withPassMark = 0;
        Timestamp lastAttemptAt = null;
        AttemptScore totals = new AttemptScore();
        List<Double> perQuizPercents = new ArrayList<>();

        for (QuizSlideMetaProjection meta : metas) {
            if (meta.getPassPercentage() != null) {
                withPassMark++;
            }
            QuizAttemptProjection attempt = attemptsBySlide
                    .getOrDefault(meta.getSlideId(), Map.of())
                    .get(learner.getUserId());
            if (attempt == null) {
                continue;
            }
            attemptedQuizzes++;
            totalAttempts += nz(attempt.getAttemptCount());
            if (attempt.getLastAttemptAt() != null
                    && (lastAttemptAt == null || attempt.getLastAttemptAt().after(lastAttemptAt))) {
                lastAttemptAt = attempt.getLastAttemptAt();
            }

            AttemptScore score = scores.getOrDefault(meta.getSlideId(), Map.of())
                    .getOrDefault(learner.getUserId(), new AttemptScore());
            totals.add(score);
            double quizTotal = nz(meta.getTotalMarks());
            obtained += score.obtained;
            attemptedMax += quizTotal;
            if (quizTotal > 0) {
                double percent = score.obtained * 100.0 / quizTotal;
                perQuizPercents.add(round1(percent));
                if (meta.getPassPercentage() != null && percent >= meta.getPassPercentage()) {
                    passed++;
                }
            }
        }

        return LearnerQuizOverviewResponse.LearnerRow.builder()
                .userId(learner.getUserId())
                .fullName(learner.getFullName())
                .email(learner.getEmail())
                .mobileNumber(learner.getMobileNumber())
                .enrollmentStatus(learner.getEnrollmentStatus())
                .quizzesInCourse(metas.size())
                .quizzesAttempted(attemptedQuizzes)
                .totalAttempts(totalAttempts)
                .marksObtained(attemptedQuizzes > 0 ? round2(obtained) : null)
                .attemptedMaxMarks(attemptedQuizzes > 0 ? round2(attemptedMax) : null)
                .courseMaxMarks(round2(courseMaxMarks))
                // Averaged over the marks they were actually examined on, not the whole
                // course — otherwise a learner who has done one quiz perfectly reads as
                // failing simply because the rest of the course is still ahead of them.
                .avgScorePercent(attemptedMax > 0 ? round1(obtained * 100.0 / attemptedMax) : null)
                .bestScorePercent(perQuizPercents.isEmpty() ? null : Collections.max(perQuizPercents))
                .lowestScorePercent(perQuizPercents.isEmpty() ? null : Collections.min(perQuizPercents))
                .correctCount(totals.correct)
                .wrongCount(totals.wrong)
                .skippedCount(totals.skipped)
                .ungradedCount(totals.ungraded)
                .passedQuizzes(passed)
                .quizzesWithPassMark(withPassMark)
                .lastAttemptAtEpochMillis(epochMillis(lastAttemptAt))
                .build();
    }

    /** One learner's side view: every quiz in the course, attempted or not. */
    public LearnerQuizDetailResponse getLearnerDetail(String batchId, String userId, CustomUserDetails user) {
        requireText(batchId, "batchId");
        requireText(userId, "userId");

        List<QuizSlideMetaProjection> metas = quizResultsRepository.getQuizSlides(batchId, null);
        QuizLearnerProjection learner = quizResultsRepository.getBatchRoster(batchId, learnerRowLimit).stream()
                .filter(l -> userId.equals(l.getUserId()))
                .findFirst()
                .orElseThrow(() -> new VacademyException("Learner " + userId + " is not enrolled in this batch"));

        // Scoped to this learner, so the side view costs a fraction of the batch-wide load.
        Map<String, Map<String, AttemptScore>> scores = metas.isEmpty()
                ? Map.of()
                : grade(quizResultsRepository.getLatestAttemptResponses(batchId, null, userId),
                        loadQuestionIndex(batchId, null, false));
        Map<String, Map<String, QuizAttemptProjection>> attemptsBySlide = new HashMap<>();
        for (QuizAttemptProjection attempt : quizResultsRepository.getAttempts(batchId, null, userId)) {
            attemptsBySlide.computeIfAbsent(attempt.getSlideId(), k -> new HashMap<>())
                    .put(attempt.getUserId(), attempt);
        }

        double courseMaxMarks = metas.stream().mapToDouble(m -> nz(m.getTotalMarks())).sum();
        List<LearnerQuizDetailResponse.QuizRow> quizzes = new ArrayList<>(metas.size());
        for (QuizSlideMetaProjection meta : metas) {
            QuizAttemptProjection attempt = attemptsBySlide
                    .getOrDefault(meta.getSlideId(), Map.of()).get(userId);
            boolean attempted = attempt != null;
            AttemptScore score = attempted
                    ? scores.getOrDefault(meta.getSlideId(), Map.of())
                            .getOrDefault(userId, new AttemptScore())
                    : new AttemptScore();

            double quizTotal = nz(meta.getTotalMarks());
            Double scorePercent = (attempted && quizTotal > 0)
                    ? round1(score.obtained * 100.0 / quizTotal)
                    : null;
            long questionCount = nz(meta.getQuestionCount());
            long unanswered = attempted ? Math.max(0, questionCount - score.responded()) : questionCount;

            quizzes.add(LearnerQuizDetailResponse.QuizRow.builder()
                    .slideId(meta.getSlideId())
                    .title(meta.getSlideTitle())
                    .subjectName(meta.getSubjectName())
                    .moduleName(meta.getModuleName())
                    .chapterName(meta.getChapterName())
                    .questionCount(questionCount)
                    .totalMarks(quizTotal)
                    .passPercentage(meta.getPassPercentage())
                    .status(resolveLearnerStatus(attempted, scorePercent, meta.getPassPercentage(), unanswered))
                    .attemptCount(attempted ? nz(attempt.getAttemptCount()) : 0)
                    .marksObtained(attempted ? round2(score.obtained) : null)
                    .scorePercent(scorePercent)
                    .correctCount(score.correct)
                    .wrongCount(score.wrong)
                    .skippedCount(score.skipped)
                    .ungradedCount(score.ungraded)
                    .unansweredCount(unanswered)
                    .timeSpentSeconds(attempted && attempt.getEngagedMs() != null
                            ? attempt.getEngagedMs() / 1000 : null)
                    .lastAttemptAtEpochMillis(attempted ? epochMillis(attempt.getLastAttemptAt()) : null)
                    .build());
        }

        return LearnerQuizDetailResponse.builder()
                .learner(buildLearnerRow(learner, metas, attemptsBySlide, scores, courseMaxMarks))
                .quizzes(quizzes)
                .build();
    }

    /** What one learner answered on one quiz, attempt by attempt. */
    public LearnerQuizAnswersResponse getLearnerAnswers(String batchId, String slideId, String userId,
            CustomUserDetails user) {
        requireText(batchId, "batchId");
        requireText(slideId, "slideId");
        requireText(userId, "userId");

        QuizSlideMetaProjection meta = firstOrNull(quizResultsRepository.getQuizSlides(batchId, slideId));
        if (meta == null) {
            throw new VacademyException("No quiz found for slide " + slideId + " in this batch");
        }
        QuestionIndex index = loadQuestionIndex(batchId, slideId, true);
        String fullName = quizResultsRepository.getBatchRoster(batchId, learnerRowLimit).stream()
                .filter(l -> userId.equals(l.getUserId()))
                .map(QuizLearnerProjection::getFullName)
                .findFirst()
                .orElse(null);

        List<QuizResultsRepository.LearnerAttemptProjection> attemptRows =
                quizResultsRepository.getLearnerAttempts(batchId, slideId, userId);
        Map<String, List<QuizResultsRepository.LearnerResponseProjection>> byActivity = new HashMap<>();
        for (QuizResultsRepository.LearnerResponseProjection response :
                quizResultsRepository.getLearnerResponses(slideId, userId)) {
            byActivity.computeIfAbsent(response.getActivityId(), k -> new ArrayList<>()).add(response);
        }

        double totalMarks = index.questions.values().stream().mapToDouble(q -> q.marks).sum();
        List<LearnerQuizAnswersResponse.Attempt> attempts = new ArrayList<>(attemptRows.size());
        for (int i = 0; i < attemptRows.size(); i++) {
            QuizResultsRepository.LearnerAttemptProjection attemptRow = attemptRows.get(i);
            Map<String, QuizResultsRepository.LearnerResponseProjection> answered = new HashMap<>();
            for (QuizResultsRepository.LearnerResponseProjection r :
                    byActivity.getOrDefault(attemptRow.getActivityId(), List.of())) {
                answered.put(r.getQuestionId(), r);
            }

            AttemptScore score = new AttemptScore();
            long notAnswered = 0;
            List<LearnerQuizAnswersResponse.Answer> answers = new ArrayList<>(index.questions.size());
            int order = 0;
            for (QuestionInfo question : index.questions.values()) {
                order++;
                QuizResultsRepository.LearnerResponseProjection response = answered.get(question.questionId);
                String verdict;
                double awarded = 0;
                Set<String> selected = Set.of();
                if (response == null) {
                    verdict = "NOT_ANSWERED";
                    notAnswered++;
                } else {
                    selected = autoEvaluationScorer.selectedAnswerIds(response.getResponseJson());
                    Outcome outcome = outcomeOf(response.getResponseStatus(), response.getResponseJson(), question);
                    verdict = outcome.name();
                    switch (outcome) {
                        case CORRECT -> {
                            score.correct++;
                            score.obtained += question.marks;
                            awarded = question.marks;
                        }
                        case WRONG -> {
                            score.wrong++;
                            awarded = partialAward(question, response.getResponseJson());
                            score.obtained += awarded;
                            if (awarded > 0) {
                                verdict = VERDICT_PARTIAL;
                            }
                        }
                        case SKIPPED -> score.skipped++;
                        case UNGRADED -> score.ungraded++;
                    }
                }

                List<LearnerQuizAnswersResponse.Option> options = new ArrayList<>(question.options.size());
                for (OptionInfo option : question.options) {
                    options.add(LearnerQuizAnswersResponse.Option.builder()
                            .optionId(option.optionId)
                            .text(RichTextForAI.toPlainText(option.text))
                            .correct(question.correctOptionIds.contains(option.optionId))
                            .selected(selected.contains(option.optionId))
                            .build());
                }

                answers.add(LearnerQuizAnswersResponse.Answer.builder()
                        .questionId(question.questionId)
                        .order(question.order != null ? question.order : order)
                        .questionText(RichTextForAI.toPlainText(question.text))
                        .questionType(question.questionType)
                        .explanation(RichTextForAI.toPlainText(question.explanation))
                        .verdict(verdict)
                        .learnerAnswer(renderAnswer(selected, question))
                        .correctAnswer(renderAnswer(question.correctOptionIds, question))
                        .marks(question.marks)
                        .marksAwarded(round2(awarded))
                        .options(options)
                        .build());
            }

            attempts.add(LearnerQuizAnswersResponse.Attempt.builder()
                    .attemptNumber(i + 1)
                    .activityId(attemptRow.getActivityId())
                    .attemptedAtEpochMillis(epochMillis(attemptRow.getAttemptedAt()))
                    .timeSpentSeconds(attemptRow.getEngagedMs() == null ? null : attemptRow.getEngagedMs() / 1000)
                    // The query is oldest-first, so the last row is the one every other
                    // screen reports on.
                    .latest(i == attemptRows.size() - 1)
                    .marksObtained(round2(score.obtained))
                    .scorePercent(totalMarks > 0 ? round1(score.obtained * 100.0 / totalMarks) : null)
                    .correctCount(score.correct)
                    .wrongCount(score.wrong)
                    .skippedCount(score.skipped)
                    .ungradedCount(score.ungraded)
                    .unansweredCount(notAnswered)
                    .answers(answers)
                    .build());
        }

        return LearnerQuizAnswersResponse.builder()
                .slideId(meta.getSlideId())
                .quizTitle(meta.getSlideTitle())
                .userId(userId)
                .fullName(fullName)
                .questionCount(index.questions.size())
                .totalMarks(round2(totalMarks))
                .passPercentage(meta.getPassPercentage())
                .attempts(attempts)
                .build();
    }

    /** Option ids as readable text; falls back to the raw value for free-text answers. */
    private String renderAnswer(Set<String> optionIds, QuestionInfo question) {
        if (optionIds == null || optionIds.isEmpty()) {
            return "";
        }
        Map<String, String> textById = new LinkedHashMap<>();
        for (OptionInfo option : question.options) {
            textById.put(option.optionId, RichTextForAI.toPlainText(option.text));
        }
        List<String> labels = new ArrayList<>();
        for (String id : optionIds) {
            String label = textById.get(id);
            if (label != null && !label.isBlank()) {
                labels.add(label);
            } else if (textById.isEmpty()) {
                labels.add(id);
            }
        }
        return String.join(", ", labels);
    }

    // ------------------------------------------------------------- question analysis

    /** One quiz: per-question accuracy and the option-by-option answer distribution. */
    public QuizQuestionAnalysisResponse getQuestionAnalysis(String batchId, String slideId,
            CustomUserDetails user) {
        requireText(batchId, "batchId");
        requireText(slideId, "slideId");

        QuestionIndex index = loadQuestionIndex(batchId, slideId, true);
        if (index.questions.isEmpty()) {
            return QuizQuestionAnalysisResponse.builder()
                    .attemptedLearners(0)
                    .questions(List.of())
                    .build();
        }

        long attemptedLearners = quizResultsRepository.getAttempts(batchId, slideId, null).size();

        Map<String, List<QuizResponseProjection>> byQuestion = new HashMap<>();
        for (QuizResponseProjection response : quizResultsRepository.getLatestAttemptResponses(batchId, slideId, null)) {
            byQuestion.computeIfAbsent(response.getQuestionId(), k -> new ArrayList<>()).add(response);
        }

        List<QuizQuestionAnalysisResponse.QuestionStat> stats = new ArrayList<>(index.questions.size());
        int position = 0;
        for (QuestionInfo question : index.questions.values()) {
            position++;
            List<QuizResponseProjection> responses = byQuestion.getOrDefault(question.questionId, List.of());

            long correct = 0;
            long wrong = 0;
            long skipped = 0;
            long ungraded = 0;
            Map<String, Long> selections = new HashMap<>();
            for (QuizResponseProjection response : responses) {
                switch (outcomeOf(response.getResponseStatus(), response.getResponseJson(), question)) {
                    case CORRECT -> correct++;
                    case WRONG -> wrong++;
                    case SKIPPED -> skipped++;
                    case UNGRADED -> ungraded++;
                }
                for (String optionId : autoEvaluationScorer.selectedAnswerIds(response.getResponseJson())) {
                    selections.merge(optionId, 1L, Long::sum);
                }
            }

            // Ungraded responses leave the denominator rather than counting as failures.
            long gradable = Math.max(0, attemptedLearners - ungraded);
            Double accuracy = gradable > 0 ? round1(correct * 100.0 / gradable) : null;
            long responded = responses.size();

            List<QuizQuestionAnalysisResponse.OptionStat> options = new ArrayList<>();
            for (OptionInfo option : question.options) {
                long selected = selections.getOrDefault(option.optionId, 0L);
                options.add(QuizQuestionAnalysisResponse.OptionStat.builder()
                        .optionId(option.optionId)
                        .text(RichTextForAI.toPlainText(option.text))
                        .correct(question.correctOptionIds.contains(option.optionId))
                        .selectedCount(selected)
                        .selectedPercent(responded > 0 ? round1(selected * 100.0 / responded) : null)
                        .build());
            }

            stats.add(QuizQuestionAnalysisResponse.QuestionStat.builder()
                    .questionId(question.questionId)
                    .order(question.order != null ? question.order : position)
                    .questionText(RichTextForAI.toPlainText(question.text))
                    .explanation(RichTextForAI.toPlainText(question.explanation))
                    .questionType(question.questionType)
                    .marks(question.marks)
                    .responded(responded)
                    .correctCount(correct)
                    .wrongCount(wrong)
                    .skippedCount(skipped)
                    .ungradedCount(ungraded)
                    .unansweredCount(Math.max(0, attemptedLearners - responded))
                    .accuracyPercent(accuracy)
                    .difficulty(difficultyOf(accuracy))
                    .options(options)
                    .build());
        }

        return QuizQuestionAnalysisResponse.builder()
                .attemptedLearners(attemptedLearners)
                .questions(stats)
                .build();
    }

    /** Bands chosen so CRITICAL means the batch did worse than guessing a 4-option question. */
    private String difficultyOf(Double accuracyPercent) {
        if (accuracyPercent == null) {
            return null;
        }
        if (accuracyPercent >= 80) {
            return "EASY";
        }
        if (accuracyPercent >= 50) {
            return "MODERATE";
        }
        if (accuracyPercent >= 25) {
            return "HARD";
        }
        return "CRITICAL";
    }

    // --------------------------------------------------------------------- grading

    private enum Outcome {
        CORRECT, WRONG, SKIPPED,
        /** Answered, but nothing here can grade it - never counted as wrong. */
        UNGRADED
    }

    /**
     * The stored verdict wins when it is one; otherwise the answer key does. Server-side
     * scoring writes CORRECT/WRONG/SKIPPED for everything submitted since it shipped, so
     * this only re-derives the older placeholder rows.
     */
    private Outcome outcomeOf(String storedStatus, String responseJson, QuestionInfo question) {
        String status = storedStatus == null ? "" : storedStatus.trim().toUpperCase();
        if (STATUS_CORRECT.equals(status)) {
            return Outcome.CORRECT;
        }
        if (WRONG_STATUSES.contains(status)) {
            return Outcome.WRONG;
        }
        if (STATUS_SKIPPED.equals(status)) {
            return Outcome.SKIPPED;
        }
        return switch (autoEvaluationScorer.evaluate(question.autoEvaluationJson, responseJson,
                () -> question.optionIds)) {
            case CORRECT -> Outcome.CORRECT;
            case WRONG -> Outcome.WRONG;
            case SKIPPED -> Outcome.SKIPPED;
            case UNKNOWN -> Outcome.UNGRADED;
        };
    }

    /**
     * Marks a not-fully-correct answer still earns when its quiz has partial marking on
     * and the answer was scored partial when submitted: a share of the question's marks
     * for picking only correct options. 0 otherwise.
     */
    private double partialAward(QuestionInfo question, String responseJson) {
        if (!question.partialMarking || !AutoEvaluationScorer.isMultiSelect(question.questionType)
                || !autoEvaluationScorer.isMarkedPartial(responseJson)) {
            return 0;
        }
        return question.marks * AutoEvaluationScorer.partialCreditFraction(
                question.correctOptionIds, autoEvaluationScorer.selectedAnswerIds(responseJson));
    }

    /** Grade every response into a per-(slide, learner) score. */
    private Map<String, Map<String, AttemptScore>> grade(List<QuizResponseProjection> responses,
            QuestionIndex index) {
        Map<String, Map<String, AttemptScore>> bySlide = new HashMap<>();
        for (QuizResponseProjection response : responses) {
            QuestionInfo question = index.questions.get(response.getQuestionId());
            if (question == null) {
                // Answered a question that has since been deleted from the quiz: it is not
                // part of the total either, so it must not add to the score.
                continue;
            }
            AttemptScore score = bySlide
                    .computeIfAbsent(response.getSlideId(), k -> new HashMap<>())
                    .computeIfAbsent(response.getUserId(), k -> new AttemptScore());
            switch (outcomeOf(response.getResponseStatus(), response.getResponseJson(), question)) {
                case CORRECT -> {
                    score.correct++;
                    score.obtained += question.marks;
                }
                case WRONG -> {
                    score.wrong++;
                    score.obtained += partialAward(question, response.getResponseJson());
                }
                case SKIPPED -> score.skipped++;
                case UNGRADED -> score.ungraded++;
            }
        }
        return bySlide;
    }

    private QuestionIndex loadQuestionIndex(String batchId, String slideId, boolean includeText) {
        QuestionIndex index = new QuestionIndex();
        for (QuizQuestionProjection projection :
                quizResultsRepository.getQuestions(batchId, slideId, includeText)) {
            QuestionInfo info = new QuestionInfo();
            info.questionId = projection.getQuestionId();
            info.slideId = projection.getSlideId();
            info.order = projection.getQuestionOrder();
            info.questionType = projection.getQuestionType();
            info.marks = nz(projection.getMarks());
            info.partialMarking = Boolean.TRUE.equals(projection.getPartialMarking());
            info.autoEvaluationJson = projection.getAutoEvaluationJson();
            info.text = projection.getTextContent();
            info.explanation = projection.getExplanationContent();
            index.questions.put(info.questionId, info);
        }
        for (QuizOptionProjection option :
                quizResultsRepository.getQuestionOptions(batchId, slideId, includeText)) {
            QuestionInfo question = index.questions.get(option.getQuestionId());
            if (question == null) {
                continue;
            }
            OptionInfo optionInfo = new OptionInfo();
            optionInfo.optionId = option.getOptionId();
            optionInfo.text = option.getTextContent();
            question.options.add(optionInfo);
            question.optionIds.add(optionInfo.optionId);
        }
        // Resolved once per question: a positional answer key needs the option list, and
        // the scorer would otherwise re-walk it for every learner's response.
        for (QuestionInfo question : index.questions.values()) {
            question.correctOptionIds = autoEvaluationScorer.correctAnswerIds(
                    question.autoEvaluationJson, () -> question.optionIds);
        }
        return index;
    }

    private static final class QuestionIndex {
        /** insertion-ordered: the query returns questions in authoring order. */
        private final Map<String, QuestionInfo> questions = new LinkedHashMap<>();
    }

    private static final class QuestionInfo {
        private String questionId;
        private String slideId;
        private Integer order;
        private String questionType;
        private double marks;
        private boolean partialMarking;
        private String autoEvaluationJson;
        private String text;
        private String explanation;
        private final List<OptionInfo> options = new ArrayList<>();
        private final List<String> optionIds = new ArrayList<>();
        private Set<String> correctOptionIds = Set.of();
    }

    private static final class OptionInfo {
        private String optionId;
        private String text;
    }

    /**
     * Mutable accumulator for one learner's latest attempt at one quiz. Deliberately has
     * no shared "empty" singleton — it is mutable, and one accidental {@code add()}
     * through a shared instance would corrupt every zero-score learner at once.
     */
    private static final class AttemptScore {
        private double obtained;
        private long correct;
        private long wrong;
        private long skipped;
        private long ungraded;

        private long responded() {
            return correct + wrong + skipped + ungraded;
        }

        private void add(AttemptScore other) {
            obtained += other.obtained;
            correct += other.correct;
            wrong += other.wrong;
            skipped += other.skipped;
            ungraded += other.ungraded;
        }
    }

    // --------------------------------------------------------------------- helpers

    private static void requireText(String value, String field) {
        if (!StringUtils.hasText(value)) {
            throw new VacademyException(field + " is required");
        }
    }

    private static <T> T firstOrNull(List<T> values) {
        return values.isEmpty() ? null : values.get(0);
    }

    private static long nz(Long value) {
        return value == null ? 0L : value;
    }

    private static double nz(Double value) {
        return value == null ? 0d : value;
    }

    private static Long epochMillis(Timestamp timestamp) {
        return timestamp == null ? null : timestamp.getTime();
    }

    private static Double mean(List<Double> values) {
        if (values.isEmpty()) {
            return null;
        }
        double sum = 0;
        for (Double value : values) {
            sum += value;
        }
        return round1(sum / values.size());
    }

    private static Double median(List<Double> values) {
        if (values.isEmpty()) {
            return null;
        }
        List<Double> sorted = new ArrayList<>(values);
        Collections.sort(sorted);
        int size = sorted.size();
        return round1(size % 2 == 1
                ? sorted.get(size / 2)
                : (sorted.get(size / 2 - 1) + sorted.get(size / 2)) / 2.0);
    }

    private static Double round1(double value) {
        return Math.round(value * 10.0) / 10.0;
    }

    private static Double round2(double value) {
        return Math.round(value * 100.0) / 100.0;
    }
}
