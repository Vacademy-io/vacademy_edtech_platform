package vacademy.io.admin_core_service.features.learner_tracking.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.learner_quiz.answerkey.AnswerKeyAccess;
import vacademy.io.admin_core_service.features.learner_quiz.answerkey.AnswerKeyStripper;
import vacademy.io.admin_core_service.features.learner_quiz.answerkey.AuthoringAnswerAccess;
import vacademy.io.admin_core_service.features.learner_quiz.repository.LearnerQuizAttemptRepository;
import vacademy.io.admin_core_service.features.learner_quiz.service.LearnerQuizAccessService;
import vacademy.io.admin_core_service.features.learner_quiz.service.QuizGrader;
import vacademy.io.admin_core_service.features.learner_quiz.service.QuizLoader;
import vacademy.io.admin_core_service.features.learner_tracking.dto.ActivityLogDTO;
import vacademy.io.admin_core_service.features.learner_tracking.dto.QuizQuestionFeedbackDTO;
import vacademy.io.admin_core_service.features.learner_tracking.dto.QuizSideActivityLogDTO;
import vacademy.io.admin_core_service.features.learner_tracking.entity.ActivityLog;
import vacademy.io.admin_core_service.features.learner_tracking.entity.QuizSlideQuestionTracked;
import vacademy.io.admin_core_service.features.learner_tracking.repository.ActivityLogRepository;
import vacademy.io.admin_core_service.features.learner_tracking.repository.QuizSlideQuestionTrackedRepository;
import vacademy.io.admin_core_service.features.learner_tracking.util.AutoEvaluationScorer;
import vacademy.io.admin_core_service.features.slide.entity.QuizSlideQuestion;
import vacademy.io.admin_core_service.features.slide.entity.QuizSlideQuestionOption;
import vacademy.io.admin_core_service.features.slide.repository.QuizSlideQuestionOptionRepository;
import vacademy.io.admin_core_service.features.slide.repository.QuizSlideQuestionRepository;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.ActivityLogAccessDeniedException;
import vacademy.io.common.exceptions.ConflictException;
import vacademy.io.common.exceptions.ForbiddenException;
import vacademy.io.common.exceptions.InvalidRequestException;
import vacademy.io.common.exceptions.ResourceNotFoundException;
import vacademy.io.common.exceptions.VacademyException;

import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;
import java.util.stream.Collectors;

@Service
@Slf4j
@RequiredArgsConstructor
public class QuizSlideActivityLogService {

    private final QuizSlideQuestionTrackedRepository quizSlideTrackedRepositry;
    private final ActivityLogRepository activityLogRepository;
    private final ActivityLogService activityLogService;
    private final LearnerTrackingAsyncService learnerTrackingAsyncService;
    private final QuizSlideQuestionRepository quizSlideQuestionRepository;
    private final QuizSlideQuestionOptionRepository quizSlideQuestionOptionRepository;
    private final AutoEvaluationScorer autoEvaluationScorer;
    private final QuizLoader quizLoader;
    private final QuizGrader quizGrader;
    private final AnswerKeyAccess answerKeyAccess;
    private final AnswerKeyStripper answerKeyStripper;
    private final LearnerQuizAccessService learnerQuizAccessService;
    private final LearnerQuizAttemptRepository learnerQuizAttemptRepository;
    private final AuthoringAnswerAccess authoringAnswerAccess;
    private final PlatformTransactionManager transactionManager;

    /** Status of a row the server cannot place. Readers treat it as answered, not yet marked. */
    private static final String UNPLACED_STATUS = "SUBMITTED";

    public void addQuizSlideActivityLog(ActivityLog activityLog, List<QuizSideActivityLogDTO> quizSideActivityLogDTOS) {
        quizSlideTrackedRepositry.deleteByActivityId(activityLog.getId());
        List<QuizSlideQuestionTracked> questionSlideTrackeds = quizSideActivityLogDTOS
                .stream()
                .map(quizSideActivityLogDTO -> new QuizSlideQuestionTracked(quizSideActivityLogDTO, activityLog))
                .toList();
        quizSlideTrackedRepositry.saveAll(questionSlideTrackeds);
    }

    /** How one write to an attempt ended. Worked out inside the transaction, acted on after it. */
    private enum WriteOutcome { WRITTEN, ALREADY_RECORDED, OWNED_ELSEWHERE, OTHER_SLIDE, NOT_FOUND, NO_ATTEMPTS_LEFT }

    /**
     * Records an attempt from a client that still grades on the device. Once an attempt has
     * answers on it, they stay: a client only ever repeats an attempt because the reply to
     * its first send was lost, and that repeat gets the same id back with nothing changed.
     */
    public String addOrUpdateQuizSlideActivityLog(ActivityLogDTO activityLogDTO,
            String slideId,
            String chapterId,
            String moduleId,
            String subjectId,
            String packageSessionId,
            String userId,
            CustomUserDetails user) {
        // Identity comes from the token, never from the userId request param —
        // a learner could otherwise submit (or overwrite) as someone else.
        if (!StringUtils.hasText(activityLogDTO.getId())) {
            throw new InvalidRequestException("An attempt needs an id");
        }
        List<QuizSideActivityLogDTO> sides = activityLogDTO.getQuizSides() == null ? new ArrayList<>()
                : new ArrayList<>(activityLogDTO.getQuizSides().stream().filter(Objects::nonNull).toList());
        activityLogDTO.setQuizSides(sides);

        // Grade on the server before anything is persisted. The DTOs are mutated in
        // place, so the tracked rows, the learner-operation update and the LLM raw JSON
        // all see the same authoritative verdict.
        applyServerSideScoring(sides);
        reconcileRecordedMarks(slideId, sides);
        assignRowIds(activityLogDTO.getId(), sides);

        ActivityLog[] written = new ActivityLog[1];
        // Worked out as a value rather than thrown: an offline replay joins its event's
        // transaction here, and an exception crossing it would stop that event being recorded.
        WriteOutcome outcome = new TransactionTemplate(transactionManager).execute(status ->
                writeAttempt(activityLogDTO, sides, slideId, user.getUserId(), written));
        switch (outcome) {
            case OWNED_ELSEWHERE -> {
                log.warn("User {} attempted to write activity {} owned by another learner", user.getUserId(),
                        activityLogDTO.getId());
                throw new ActivityLogAccessDeniedException(activityLogDTO.getId());
            }
            case OTHER_SLIDE -> throw new ConflictException("This attempt belongs to another slide");
            case NOT_FOUND -> throw new ResourceNotFoundException("Activity log " + activityLogDTO.getId() + " not found");
            case NO_ATTEMPTS_LEFT -> throw new ConflictException("No attempts remaining for this quiz");
            case ALREADY_RECORDED -> {
                return activityLogDTO.getId();
            }
            default -> {
                // Carries on below.
            }
        }
        learnerTrackingAsyncService.updateLearnerOperationsForQuiz(user.getUserId(), slideId, chapterId, moduleId,
                subjectId, packageSessionId, activityLogDTO);

        // Save raw data for LLM analytics (async, non-blocking)
        learnerTrackingAsyncService.saveLLMQuizDataAsync(
                written[0].getId(),
                slideId,
                chapterId,
                packageSessionId,
                subjectId,
                activityLogDTO);

        return written[0].getId();
    }

    /** Under the same per-learner, per-quiz lock as the submit endpoint, so the two cannot interleave. */
    private WriteOutcome writeAttempt(ActivityLogDTO activityLogDTO, List<QuizSideActivityLogDTO> sides, String slideId,
            String userId, ActivityLog[] written) {
        learnerQuizAttemptRepository.lockLearnerOnQuiz("quiz-attempt|" + userId + "|" + slideId);
        LearnerQuizAttemptRepository.AttemptStateRow existing = learnerQuizAttemptRepository
                .findAttemptState(activityLogDTO.getId()).orElse(null);
        if (existing != null) {
            if (!Objects.equals(existing.getUserId(), userId)) {
                return WriteOutcome.OWNED_ELSEWHERE;
            }
            if (StringUtils.hasText(existing.getSlideId()) && !existing.getSlideId().equals(slideId)) {
                return WriteOutcome.OTHER_SLIDE;
            }
            if (existing.getAnswerCount() > 0) {
                return WriteOutcome.ALREADY_RECORDED;
            }
        } else if (!activityLogDTO.isNewActivity()) {
            return WriteOutcome.NOT_FOUND;
        }
        // Empty posts stay allowed past the cap: they record no attempt, and the tutor uses
        // one to complete a quiz slide it has finished.
        if (answerKeyAccess.enforcesLegacySubmit() && !sides.isEmpty()) {
            Integer cap = learnerQuizAttemptRepository.findQuizBySlideId(slideId)
                    .map(LearnerQuizAttemptRepository.QuizMetaRow::getReAttemptCount)
                    .orElse(null);
            if (cap != null && learnerQuizAttemptRepository.countQuizAttempts(userId, slideId) >= cap) {
                return WriteOutcome.NO_ATTEMPTS_LEFT;
            }
        }
        ActivityLog activityLog = activityLogDTO.isNewActivity()
                ? activityLogService.saveActivityLog(activityLogDTO, userId, slideId)
                : activityLogService.updateActivityLog(activityLogDTO, userId);
        activityLogRepository.flush();
        addQuizSlideActivityLog(activityLog, sides);
        written[0] = activityLog;
        return WriteOutcome.WRITTEN;
    }

    /**
     * Row ids come from the attempt and the position in it, never from the client: an assigned
     * id on save merges into whichever row already has it, including another learner's.
     */
    private static void assignRowIds(String attemptId, List<QuizSideActivityLogDTO> sides) {
        for (int i = 0; i < sides.size(); i++) {
            QuizSideActivityLogDTO side = sides.get(i);
            side.setId(UUID.nameUUIDFromBytes((attemptId + "|" + i + "|" + side.getQuestionId())
                    .getBytes(StandardCharsets.UTF_8)).toString());
        }
    }

    /**
     * Recompute {@code response_status} from the stored answer key.
     *
     * <p>The quiz viewer grades client-side (the key ships with the questions so feedback
     * is instant) and its main "Finish" path sent the placeholder {@code "SUBMITTED"} for
     * every question, so no quiz answer was ever recorded as CORRECT. Everything reading
     * the column downstream - LLM analytics, marks-by-subject, pulse - read that as a
     * score of zero. Grading here makes the server the source of truth and also closes
     * the hole where a learner could simply post {@code "CORRECT"} for every question.
     *
     * <p>Questions the scorer cannot grade (free text, manual evaluation, an unrecognised
     * key) keep whatever the client sent.
     */
    private void applyServerSideScoring(List<QuizSideActivityLogDTO> quizSides) {
        if (quizSides == null || quizSides.isEmpty()) {
            return;
        }
        try {
            List<String> questionIds = quizSides.stream()
                    .filter(q -> q != null && q.getQuestionId() != null)
                    .map(QuizSideActivityLogDTO::getQuestionId)
                    .distinct()
                    .toList();
            if (questionIds.isEmpty()) {
                return;
            }
            Map<String, QuizSlideQuestion> questions = quizSlideQuestionRepository.findAllById(questionIds)
                    .stream()
                    .collect(Collectors.toMap(QuizSlideQuestion::getId, q -> q, (a, b) -> a));

            // Option ids are only needed for the older index-based answer keys, and only
            // once per question even when a learner has several responses to it.
            Map<String, List<String>> optionIdCache = new HashMap<>();

            for (QuizSideActivityLogDTO side : quizSides) {
                if (side == null || side.getQuestionId() == null) {
                    continue;
                }
                QuizSlideQuestion question = questions.get(side.getQuestionId());
                if (question == null) {
                    continue;
                }
                AutoEvaluationScorer.Verdict verdict = autoEvaluationScorer.evaluate(
                        question.getAutoEvaluationJson(),
                        side.getResponseJson(),
                        () -> optionIdCache.computeIfAbsent(question.getId(), this::optionIdsInOrder));
                if (verdict != AutoEvaluationScorer.Verdict.UNKNOWN) {
                    side.setResponseStatus(verdict.name());
                }
            }
        } catch (Exception e) {
            // Scoring must never cost a learner their submission.
            log.error("Server-side quiz scoring failed; falling back to client-reported status", e);
        }
    }

    /**
     * The marks inside response_json, which the review screen and activity dialog read.
     *
     * <p>With the switch off, a row stays exactly as the client judged it, whatever has
     * happened to the quiz since the client loaded it: a question removed or re-marked during
     * the attempt, or a slow submit routed under whichever slide was open by then. Each row
     * says who judged it, and that is how older clients are counted. {@code /result} takes
     * nothing on trust from these rows, so keeping them gives a score no more than they had.
     *
     * <p>With it on, the marks become the server's. The AI tutor is the exception: see below.
     *
     * <p>In both positions a row in a shape the server cannot read keeps what was answered and
     * loses its claimed marks and verdict. No client this endpoint serves sends those.
     */
    private void reconcileRecordedMarks(String slideId, List<QuizSideActivityLogDTO> quizSides) {
        if (slideId == null || quizSides.isEmpty()) {
            return;
        }
        if (answerKeyAccess.enforcesLegacySubmit()) {
            regradeAgainstTheQuiz(slideId, quizSides);
            return;
        }
        for (QuizSideActivityLogDTO side : quizSides) {
            if (!autoEvaluationScorer.recognisesResponse(side.getResponseJson())) {
                removeClaims(side);
            } else {
                side.setResponseJson(quizGrader.withClientMarker(side.getResponseJson(),
                        quizGrader.isTutorRecord(side.getResponseJson()) ? null : QuizGrader.GRADED_BY_CLIENT));
            }
        }
    }

    private void regradeAgainstTheQuiz(String slideId, List<QuizSideActivityLogDTO> quizSides) {
        QuizLoader.LoadedQuiz quiz;
        try {
            quiz = quizLoader.load(slideId).orElse(null);
        } catch (Exception e) {
            // Marking must never cost a learner their submission.
            log.error("Could not load quiz for slide {}; keeping what the client recorded", slideId, e);
            return;
        }
        if (quiz == null) {
            return;
        }
        Map<String, QuizGrader.Question> questions = quiz.questions().stream()
                .collect(Collectors.toMap(QuizGrader.Question::id, q -> q, (a, b) -> a));
        for (QuizSideActivityLogDTO side : quizSides) {
            QuizGrader.Question question = questions.get(side.getQuestionId());
            if (question == null || !autoEvaluationScorer.recognisesResponse(side.getResponseJson())) {
                removeClaims(side);
                continue;
            }
            if (quizGrader.isTutorRecord(side.getResponseJson())) {
                // The AI tutor posts here too, with its own judgement of spoken and typed
                // answers and the words the learner used. Nothing here can redo that.
                side.setResponseJson(quizGrader.withinQuestionLimits(question, quiz.rules(), side.getResponseJson()));
                continue;
            }
            QuizGrader.Graded graded = quizGrader.regrade(question, quiz.rules(), side.getResponseJson(),
                    QuizGrader.GRADED_BY_LEGACY);
            side.setResponseJson(graded.responseJson());
            side.setResponseStatus(graded.responseStatus());
        }
    }

    private void removeClaims(QuizSideActivityLogDTO side) {
        side.setResponseJson(quizGrader.withoutClaims(side.getResponseJson()));
        side.setResponseStatus(UNPLACED_STATUS);
    }

    private List<String> optionIdsInOrder(String questionId) {
        return quizSlideQuestionOptionRepository.findByQuizSlideQuestionId(questionId)
                .stream()
                .map(QuizSlideQuestionOption::getId)
                .toList();
    }

    public Page<ActivityLogDTO> getQuizSlideActivityLog(String userId, String slideId, Pageable pageable,
            CustomUserDetails userDetails) {
        boolean stripping = answerKeyAccess.stripsAttemptLogs();
        boolean staff = stripping && authoringAnswerAccess.keepsAnswersOnSlide(userDetails, slideId);
        if (stripping && !staff && (userDetails == null || !Objects.equals(userDetails.getUserId(), userId))) {
            throw new ForbiddenException("Attempts can only be read by the learner who made them");
        }
        Page<ActivityLog> activityLogs = activityLogRepository.findActivityLogsWithQuizSlide(userId, slideId, pageable);
        Page<ActivityLogDTO> logs = activityLogs.map(activityLog -> activityLog.toActivityLogDTO());
        if (stripping && !staff) {
            logs.forEach(this::removeRecordedAnswers);
        }
        return logs;
    }

    private void removeRecordedAnswers(ActivityLogDTO log) {
        if (log.getQuizSides() != null) {
            log.getQuizSides().forEach(side ->
                    side.setResponseJson(answerKeyStripper.withoutCorrectOptions(side.getResponseJson())));
        }
    }

    /**
     * With grading on the server, this endpoint and offline replays follow the same enrolment
     * rules as the submit endpoint. The attempt cap is checked with the write, under the lock.
     * Repeating an attempt already recorded is always allowed: that learner's reply was lost.
     */
    public void requireLegacySubmitAllowed(ActivityLogDTO activityLogDTO, String slideId, CustomUserDetails user,
            String clientInstituteId) {
        if (!answerKeyAccess.enforcesLegacySubmit()) {
            return;
        }
        if (StringUtils.hasText(activityLogDTO.getId()) && user != null) {
            LearnerQuizAttemptRepository.AttemptStateRow existing = learnerQuizAttemptRepository
                    .findAttemptState(activityLogDTO.getId()).orElse(null);
            if (existing != null && existing.getAnswerCount() > 0 && Objects.equals(existing.getUserId(), user.getUserId())
                    && Objects.equals(existing.getSlideId(), slideId)) {
                return;
            }
        }
        learnerQuizAccessService.requireAccess(user, slideId, clientInstituteId, null, null);
        learnerQuizAttemptRepository.findQuizBySlideId(slideId)
                .filter(quiz -> !"PUBLISHED".equals(quiz.getSlideStatus()) && !"UNSYNC".equals(quiz.getSlideStatus()))
                .ifPresent(quiz -> {
                    throw new ResourceNotFoundException("This quiz is no longer available");
                });
    }

    public String saveQuizQuestionFeedback(QuizQuestionFeedbackDTO dto) {
        if (dto.getTrackedId() == null || dto.getTrackedId().isBlank()) {
            throw new VacademyException("trackedId is required");
        }
        QuizSlideQuestionTracked tracked = quizSlideTrackedRepositry.findById(dto.getTrackedId())
                .orElseThrow(() -> new VacademyException("Quiz response not found for tracked id " + dto.getTrackedId()));
        tracked.setInstructorFeedback(dto.getInstructorFeedback());
        tracked.setInstructorFeedbackFileId(dto.getInstructorFeedbackFileId());
        quizSlideTrackedRepositry.save(tracked);
        return tracked.getId();
    }
}
