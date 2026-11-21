package vacademy.io.assessment_service.features.submission_review.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.cache.Cache;
import org.springframework.cache.CacheManager;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.context.annotation.Lazy;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import vacademy.io.assessment_service.features.assessment.dto.evaluation_ai.QuestionOverrideRequest;
import vacademy.io.assessment_service.features.assessment.entity.Assessment;
import vacademy.io.assessment_service.features.assessment.entity.StudentAttempt;
import vacademy.io.assessment_service.features.assessment.enums.AttemptResultStatusEnum;
import vacademy.io.assessment_service.features.assessment.enums.QuestionResponseEnum;
import vacademy.io.assessment_service.features.assessment.enums.ResultTypeEnum;
import vacademy.io.assessment_service.features.assessment.repository.SectionRepository;
import vacademy.io.assessment_service.features.assessment.repository.StudentAttemptRepository;
import vacademy.io.assessment_service.features.assessment.service.StudentAttemptService;
import vacademy.io.assessment_service.features.assessment.service.evaluation_ai.CopyCheckReportDataSender;
import vacademy.io.assessment_service.features.learner_assessment.entity.QuestionWiseMarks;
import vacademy.io.assessment_service.features.learner_assessment.repository.QuestionWiseMarksRepository;
import vacademy.io.assessment_service.features.open_evaluation.policy.ApiCandidatePolicy;
import vacademy.io.assessment_service.features.open_evaluation.policy.ResultLockGuard;
import vacademy.io.assessment_service.features.open_evaluation.submission.ApiSubmissionFeed;
import vacademy.io.assessment_service.features.question_core.repository.QuestionRepository;
import vacademy.io.assessment_service.features.submission_review.entity.MarkEvent;
import vacademy.io.assessment_service.features.submission_review.model.ActorType;
import vacademy.io.assessment_service.features.submission_review.model.AnswerStatus;
import vacademy.io.assessment_service.features.submission_review.model.MarkEventType;
import vacademy.io.assessment_service.features.submission_review.model.MarkState;
import vacademy.io.assessment_service.features.submission_review.model.MarkedByKind;
import vacademy.io.assessment_service.features.submission_review.model.MarksSource;
import vacademy.io.assessment_service.features.submission_review.model.QuestionKinds;
import vacademy.io.assessment_service.features.submission_review.model.SubmissionKind;
import vacademy.io.assessment_service.features.submission_review.model.SubmissionReviewException;

import java.util.ArrayList;
import java.util.Date;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;

/**
 * The one write path for a question's mark (contract 3). Order inside a call: lock the
 * attempt, check the guards, lock the marks rows, check the paper / revision / precedence /
 * range of every item, write the changed rows with history, recompute the attempt (R6
 * total, result status, one marks_revision bump), then after-commit work.
 */
@Slf4j
@Service
public class MarkWriter {

    /**
     * Who is writing. {@code QUESTION_MARKS_PUT} is the first "change one question's marks"
     * endpoint (PUT admin/participants/question-marks, PR #3814): a teacher's mark exactly
     * like {@code TEACHER} (MANUAL, history, revision, AI verdict mirror), except that it
     * clamps into the question's range instead of refusing, needs no reason (its caller
     * supplies one after release), and refuses an answer an AI run is still checking.
     */
    public enum Writer { TEACHER, ACCEPT_AI, ANSWER_KEY, ANSWER_KEY_FORCE, LEGACY_MANUAL_SUBMIT, LEGACY_REVIEW_PUT,
        QUESTION_MARKS_PUT }

    /**
     * One answer to change. {@code feedback}: null keeps, "" clears. {@code statusOverride}:
     * the question_wise_marks.status to write (answer key / manual-submit dto), null = from
     * the marks. {@code aiEvaluationId}: the AI verdict already updated by the caller (the
     * review PUT); MarkWriter then does not mirror again.
     */
    public record MarkChange(String attemptId, String sectionId, String questionId, Writer writer,
                             Double marks, List<PartMark> partMarks, String feedback,
                             boolean notAnswered, String reason, String actorUserId,
                             Integer expectedRevision, String expectedRelease,
                             boolean notifyLearner, List<QuestionOverrideRequest.AnnotationEdit> annotationEdits,
                             String statusOverride, String aiEvaluationId) {

        public static MarkChange of(String attemptId, String sectionId, String questionId, Writer writer,
                                    Double marks, String feedback, String actorUserId) {
            return new MarkChange(attemptId, sectionId, questionId, writer, marks, null, feedback, false, null,
                    actorUserId, null, null, false, null, null, null);
        }

        public String key() {
            return Review.key(sectionId, questionId);
        }
    }

    public record BatchContext(String reason, String expectedRelease, boolean notifyLearner, String actorUserId,
                               Writer writer) {
    }

    public record PartMark(String criterion, double marks, Double max) {
    }

    public record RowResult(String sectionId, String questionId, Double oldMarks, double newMarks, String oldState,
                            String newState, String oldSource, String newSource, int revision, boolean changed,
                            boolean skippedProtected) {
    }

    public record TotalRecomputed(double storedTotal, double r6Before) {
    }

    public record MarkResult(String attemptId, double totalBefore, double totalAfter, Double maxTotal,
                             TotalRecomputed totalRecomputed, List<RowResult> rows, boolean released,
                             Date resultRevisedAt, int marksRevision, boolean releaseQueued, boolean updateQueued,
                             int changed, SubmissionReviewStore.AttemptState attemptBefore,
                             SubmissionSnapshots.Snapshot after) {
    }

    private static final ObjectMapper JSON = new ObjectMapper();
    static final String COMPARISON_CACHE = "comparisonData";

    private final StudentAttemptRepository attemptRepository;
    private final QuestionWiseMarksRepository marksRepository;
    private final SubmissionReviewStore store;
    private final PaperOutline paperOutline;
    private final SubmissionSnapshots snapshots;
    private final MarkHistory history;
    private final AiVerdictMirror mirror;
    private final ResultLockGuard resultLockGuard;
    private final ApplicationEventPublisher publisher;
    private final SectionRepository sectionRepository;
    private final QuestionRepository questionRepository;

    @Autowired(required = false)
    private CacheManager cacheManager;
    @Autowired(required = false)
    @Lazy
    private CopyCheckReportDataSender reportDataSender;
    @Autowired(required = false)
    private ApiSubmissionFeed submissionFeed;

    public MarkWriter(StudentAttemptRepository attemptRepository, QuestionWiseMarksRepository marksRepository,
                      SubmissionReviewStore store, PaperOutline paperOutline, SubmissionSnapshots snapshots,
                      MarkHistory history, AiVerdictMirror mirror, ResultLockGuard resultLockGuard,
                      ApplicationEventPublisher publisher, SectionRepository sectionRepository,
                      QuestionRepository questionRepository) {
        this.attemptRepository = attemptRepository;
        this.marksRepository = marksRepository;
        this.store = store;
        this.paperOutline = paperOutline;
        this.snapshots = snapshots;
        this.history = history;
        this.mirror = mirror;
        this.resultLockGuard = resultLockGuard;
        this.publisher = publisher;
        this.sectionRepository = sectionRepository;
        this.questionRepository = questionRepository;
    }

    @Transactional
    public MarkResult apply(MarkChange change) {
        return run(change.attemptId(), List.of(change), change.reason(), change.expectedRelease(),
                change.notifyLearner(), change.actorUserId(), true);
    }

    @Transactional
    public MarkResult applyAll(String attemptId, List<MarkChange> changes, BatchContext ctx) {
        return run(attemptId, changes, ctx.reason(), ctx.expectedRelease(), ctx.notifyLearner(), ctx.actorUserId(),
                true);
    }

    /** The same computation with no locks and no writes (A3 preview). */
    @Transactional(readOnly = true)
    public MarkResult preview(MarkChange change) {
        return run(change.attemptId(), List.of(change), change.reason(), change.expectedRelease(), false,
                change.actorUserId(), false);
    }

    @Transactional(readOnly = true)
    public MarkResult previewAll(String attemptId, List<MarkChange> changes, BatchContext ctx) {
        return run(attemptId, changes, ctx.reason(), ctx.expectedRelease(), false, ctx.actorUserId(), false);
    }

    /** Lock and recompute only: the attempt total and result status from the current rows. */
    @Transactional
    public MarkResult recomputeAttempt(String attemptId, String actorUserId) {
        return run(attemptId, List.of(), null, null, false, actorUserId, true, true);
    }

    private MarkResult run(String attemptId, List<MarkChange> changes, String reason, String expectedRelease,
                           boolean notify, String actor, boolean write) {
        return run(attemptId, changes, reason, expectedRelease, notify, actor, write, false);
    }

    private MarkResult run(String attemptId, List<MarkChange> changes, String reason, String expectedRelease,
                           boolean notify, String actor, boolean write, boolean forceRecompute) {
        // 1. Lock the attempt, then read it fresh.
        if (write && attemptRepository.lockById(attemptId) == null) {
            throw new SubmissionReviewException(HttpStatus.NOT_FOUND, "NOT_FOUND", "Submission not found");
        }
        StudentAttempt attempt = attemptRepository.findById(attemptId)
                .orElseThrow(() -> new SubmissionReviewException(HttpStatus.NOT_FOUND, "NOT_FOUND",
                        "Submission not found"));
        SubmissionReviewStore.AttemptState state = store.attempt(attemptId);
        if (state == null) {
            throw new SubmissionReviewException(HttpStatus.NOT_FOUND, "NOT_FOUND", "Submission not found");
        }
        Assessment assessment = attempt.getRegistration().getAssessment();
        boolean legacy = changes.stream().allMatch(c -> c.writer() == Writer.LEGACY_MANUAL_SUBMIT
                || c.writer() == Writer.LEGACY_REVIEW_PUT);

        // 2. Guards.
        boolean submitted = "ENDED".equals(state.status()) || "COPY_CHECK".equals(state.status());
        if (!changes.isEmpty() && (legacy ? "LIVE".equals(state.status()) : !submitted)) {
            throw SubmissionReviewException.unprocessable("ATTEMPT_NOT_SUBMITTED",
                    "The learner has not submitted this test yet", null);
        }
        resultLockGuard.requireNotFinalizedForApiExam(attempt);
        if (expectedRelease != null && !expectedRelease.equals(state.token())) {
            throw SubmissionReviewException.conflict("RELEASE_CHANGED",
                    "The result was released or hidden while you were editing", Map.of("release", Map.of(
                            "status", state.released() ? "RELEASED" : "NOT_RELEASED", "token", state.token())));
        }
        boolean released = state.released();
        for (MarkChange c : changes) {
            boolean needsReason = c.writer() == Writer.TEACHER || c.writer() == Writer.ANSWER_KEY
                    || c.writer() == Writer.ANSWER_KEY_FORCE;
            String r = c.reason() != null ? c.reason() : reason;
            // A preview (the Edit marks dialog's live total) writes nothing: it may run before
            // the reason is typed, so only the real save needs one.
            if (write && released && needsReason && (r == null || r.isBlank())) {
                throw SubmissionReviewException.unprocessable("REASON_REQUIRED",
                        "Say why the mark changed: the result is already released", null);
            }
        }

        // 3. Lock the marks rows (or just read them for a preview).
        List<QuestionWiseMarks> entities = write ? marksRepository.lockAllForAttempt(attemptId)
                : marksRepository.findByStudentAttemptId(attemptId);
        // An imported total with no question marks (spec edge case 14): one question's mark
        // must not silently replace it ("Add question marks" converts it, Phase 4).
        if (!legacy && !changes.isEmpty() && entities.isEmpty() && state.totalMarks() != null
                && Math.abs(state.totalMarks()) > 0.005) {
            throw SubmissionReviewException.unprocessable("TOTAL_ONLY",
                    "This result was entered as a total, without question marks; editing one question would replace that total",
                    Map.of("stored_total", state.totalMarks()));
        }
        Map<String, QuestionWiseMarks> entityById = new HashMap<>();
        List<Review.MarkRow> rows = new ArrayList<>();
        for (QuestionWiseMarks e : entities) {
            entityById.put(e.getId(), e);
            rows.add(Review.MarkRow.of(e));
        }
        Review.Paper paper = paperOutline.get(assessment.getId());
        Map<String, Review.MarkRow> targets = Review.targets(paper, rows);
        Review.RunInfo run = store.runs(attemptId);
        var groups = snapshots.groups(assessment.getId());
        SubmissionSnapshots.Facts facts = SubmissionSnapshots.Facts.of(assessment,
                SubmissionSnapshots.kind(state.status(), assessment, attempt.getAttemptData(), !rows.isEmpty()));
        SubmissionSnapshots.Snapshot before = snapshots.compute(facts, released, paper, targets, run, groups);

        // The PDF tool sends only the boxes the teacher filled. On a hand-marked copy (an
        // uploaded answer sheet: handwritten or scanned test, or a homework marked by hand or
        // answered with a file) a box left empty is an answer the learner did not give:
        // record it as Not answered (0), so the submitted copy is complete (COMPLETED, no
        // "released with unmarked answers"), as the tool always treated it. Never an answer
        // the AI is still checking. An answer the AI failed on IS filled: a failed copy check
        // flags every unmarked answer, and submitting the whole sheet in the tool is the
        // person looking at them (RF10; a failed run must not leave the copy unfinished).
        if (write && !changes.isEmpty()
                && changes.stream().allMatch(c -> c.writer() == Writer.LEGACY_MANUAL_SUBMIT)
                && marksAnUploadedSheet(facts.kind(), assessment, attempt.getAttemptData())) {
            java.util.Set<String> sent = new java.util.HashSet<>();
            for (MarkChange c : changes) sent.add(c.key());
            List<MarkChange> withBlanks = new ArrayList<>(changes);
            for (SubmissionSnapshots.KeyState k : before.keys()) {
                if (k.state() != MarkState.NEEDS_MARKING || k.aiChecking() || sent.contains(k.key().key())) continue;
                // A typed answer with a keyword-match suggestion was answered: never zero it.
                if (k.derived().markedBy() == MarkedByKind.KEYWORD) continue;
                withBlanks.add(new MarkChange(attemptId, k.key().sectionId(), k.key().questionId(),
                        Writer.LEGACY_MANUAL_SUBMIT, 0.0, null, null, true, "Left blank on the answer sheet", actor,
                        null, null, false, null, null, null));
            }
            changes = withBlanks;
        }

        boolean uploadedSheet = marksAnUploadedSheet(facts.kind(), assessment, attempt.getAttemptData());

        // 4-8. Check every item before writing anything.
        List<Plan> plans = new ArrayList<>();
        List<String> stale = new ArrayList<>();
        for (MarkChange c : changes) {
            Review.PaperKey key = paper.find(c.sectionId(), c.questionId());
            boolean legacyWriter = c.writer() == Writer.LEGACY_MANUAL_SUBMIT || c.writer() == Writer.LEGACY_REVIEW_PUT;
            if (key == null && !legacyWriter) {
                throw SubmissionReviewException.unprocessable("NOT_IN_PAPER", "This question is not on the paper",
                        Map.of("key", c.key()));
            }
            Review.MarkRow target = targets.get(c.key());
            if (target == null && key == null) {
                target = newestRow(rows, c.sectionId(), c.questionId());
            }
            if (write && c.expectedRevision() != null) {
                int current = target == null ? 0 : target.revision();
                if (current != c.expectedRevision()) {
                    stale.add(c.key());
                    continue;
                }
            }
            SubmissionSnapshots.KeyState ks = before.find(c.sectionId(), c.questionId());
            Plan plan = plan(c, key, target, ks, c.reason() != null ? c.reason() : reason, uploadedSheet);
            if (plan != null) plans.add(plan);
        }
        if (!stale.isEmpty() && write) {
            Map<String, Object> details = new LinkedHashMap<>();
            details.put("stale_keys", stale);
            throw SubmissionReviewException.conflict("STALE_REVISION",
                    "Someone else changed this mark while you were editing", details);
        }

        // 9. Apply the changes (to entities when writing; always to the row view).
        Date now = new Date();
        Map<String, Review.MarkRow> after = new LinkedHashMap<>(targets);
        List<RowResult> results = new ArrayList<>();
        List<MarkEvent> events = new ArrayList<>();
        boolean anyAiType = false;
        for (Plan p : plans) {
            Review.MarkRow old = p.target;
            String oldState = p.oldState;
            boolean changed = old == null
                    || Math.abs(old.marks() - p.marks) > 0.0001
                    || !Objects.equals(old.markState() == null ? oldState : old.markState(), p.state.name())
                    || !Objects.equals(old.marksSource(), p.source)
                    || p.feedbackChanges(entityById.get(old.id()))
                    || p.partMarksJson != null && !p.partMarksJson.equals(partMarksOf(entityById.get(old.id())));
            int newRevision = (old == null ? 0 : old.revision()) + (changed ? 1 : 0);
            if (changed) {
                QuestionWiseMarks entity = null;
                if (write) {
                    entity = old == null ? null : entityById.get(old.id());
                    if (entity == null) entity = newRow(attempt, assessment, p.change);
                    String oldFeedback = entity.getEvaluatorFeedback();
                    entity.setMarks(p.marks);
                    entity.setMarkState(p.state.name());
                    entity.setMarksSource(p.source);
                    entity.setStatus(p.status);
                    if (p.change.feedback() != null) {
                        entity.setEvaluatorFeedback(p.change.feedback().isEmpty() ? null : p.change.feedback());
                    }
                    if (p.key != null && entity.getSectionId() == null && entity.getSection() == null) {
                        entity.setSection(section(p.key.sectionId()));
                    }
                    entity.setMaxMarks(p.max);
                    entity.setMarkedBy(p.markedBy);
                    entity.setMarkedAt(now);
                    entity.setRevision(newRevision);
                    if (p.partMarksJson != null) {
                        entity.setPartMarksJson(p.partMarksJson.isEmpty() ? null : p.partMarksJson);
                    } else if (p.clearPartMarks) {
                        entity.setPartMarksJson(null);
                    }
                    String aiqeId = p.change.aiEvaluationId();
                    if (aiqeId == null && (p.change.writer() == Writer.TEACHER
                            || p.change.writer() == Writer.QUESTION_MARKS_PUT) && !p.change.notAnswered()) {
                        aiqeId = mirror.apply(attemptId, null, p.change.questionId(), p.marks, p.change.feedback(),
                                p.change.annotationEdits(), p.change.actorUserId());
                    }
                    if (aiqeId != null) {
                        entity.setAiQuestionEvaluationId(aiqeId);
                        anyAiType = true;
                    }
                    marksRepository.save(entity);
                    events.add(history.base(attempt, p.eventType, ActorType.TEACHER, p.change.actorUserId(), released)
                            .sectionId(p.change.sectionId()).questionId(p.change.questionId())
                            .oldMarks(old == null ? null : old.marks()).newMarks(p.marks).maxMarks(p.max)
                            .oldSource(old == null ? null : old.marksSource()).newSource(p.source)
                            .oldState(oldState).newState(p.state.name())
                            .oldFeedback(oldFeedback).newFeedback(entity.getEvaluatorFeedback())
                            .reason(p.reason).aiQuestionEvaluationId(aiqeId)
                            .build());
                }
                String id = old != null ? old.id() : "new:" + p.change.key();
                after.put(p.change.key(), new Review.MarkRow(id, attemptId, p.change.sectionId(),
                        p.change.questionId(), p.marks, p.status, p.source, p.state.name(), newRevision, p.max,
                        p.markedBy, now, old != null && old.hasFeedback() || p.change.feedback() != null
                        && !p.change.feedback().isEmpty(), old == null ? null : old.answerPages(),
                        old == null ? null : old.aiQuestionEvaluationId(), old != null ? old.createdAt() : now,
                        old == null ? null : old.responseJson()));
                if (p.key != null && (QuestionKinds.isCbe(p.key.questionType())
                        || QuestionKinds.isLongAnswer(p.key.questionType()))) {
                    anyAiType = true;
                }
            }
            if (!changed && write && old != null && p.status != null) {
                // Same mark, state and source: no history, no revision. Only bring a stale
                // legacy status in line with the mark (rows the AI callback or the old review
                // PUT wrote left it PENDING, which the learner report counts as skipped).
                QuestionWiseMarks entity = entityById.get(old.id());
                if (entity != null && !p.status.equals(entity.getStatus())) {
                    entity.setStatus(p.status);
                    marksRepository.save(entity);
                }
            }
            results.add(new RowResult(p.change.sectionId(), p.change.questionId(), old == null ? null : old.marks(),
                    p.marks, oldState, p.state.name(), old == null ? null : old.marksSource(), p.source, newRevision,
                    changed, false));
        }

        // 11. Recompute the attempt.
        SubmissionSnapshots.Snapshot afterSnap = snapshots.compute(facts, released, paper, after, run, groups);
        int changedCount = (int) results.stream().filter(RowResult::changed).count();
        boolean anyChange = changedCount > 0 || forceRecompute;
        double stored = state.totalMarks() == null ? 0.0 : state.totalMarks();
        TotalRecomputed recomputed = null;
        if (anyChange && Math.abs(before.total() - stored) > 0.005) {
            recomputed = new TotalRecomputed(stored, before.total());
        }
        int marksRevision = state.marksRevision();
        Date revisedAt = state.resultRevisedAt();
        boolean releaseQueued = false;
        boolean updateQueued = false;
        if (write && anyChange) {
            if (recomputed != null) {
                Map<String, Object> payload = new LinkedHashMap<>();
                payload.put("stored_total", stored);
                payload.put("r6_before", before.total());
                payload.put("r6_after", afterSnap.total());
                events.add(history.base(attempt, MarkEventType.TOTAL_RECOMPUTED, ActorType.SYSTEM, actor, released)
                        .payloadJson(MarkHistory.json(payload)).build());
            }
            history.saveAll(events);
            attemptRepository.applyMarkTotals(attemptId, afterSnap.total(), afterSnap.resultStatus(), released, now);
            marksRevision++;
            if (released) revisedAt = now;
            String id = attemptId;
            if (released) {
                afterCommit(this::clearComparisonCache);
                if (notify) {
                    publisher.publishEvent(new ReviewEvents.SendUpdateRequested(id, actor));
                    updateQueued = true;
                }
            } else if (state.releaseWhenMarked()
                    // "Release the rest once marked": nothing blocks a release any more (AI
                    // drafts do not: the teacher's Release was their OK), whatever the stored
                    // result status was before (an old attempt may already say COMPLETED).
                    ? afterSnap.blockers().isEmpty()
                    // A test released on submit (autoReleasesOnSubmit): this edit completed the
                    // marking, and no teacher hid the result ("Hide result again" wins over
                    // every automatic release).
                    : !AttemptResultStatusEnum.COMPLETED.name().equals(state.resultStatus())
                    && AttemptResultStatusEnum.COMPLETED.name().equals(afterSnap.resultStatus())
                    && !state.withheld() && autoReleasesOnSubmit(assessment)) {
                publisher.publishEvent(new ReviewEvents.AttemptReadyForRelease(id, actor));
                releaseQueued = true;
            }
            if (anyAiType && reportDataSender != null) {
                reportDataSender.sendAfterCommit(attemptId);
            }
            if (submissionFeed != null) {
                submissionFeed.touch(attemptId);
            }
        }
        return new MarkResult(attemptId, before.total(), afterSnap.total(), afterSnap.maxTotal(), recomputed,
                results, released, revisedAt, marksRevision, releaseQueued, updateQueued, changedCount, state,
                afterSnap);
    }

    /** What one change does to its answer, after precedence and range (contract 3.2 steps 6-8). */
    private Plan plan(MarkChange c, Review.PaperKey key, Review.MarkRow target, SubmissionSnapshots.KeyState ks,
                      String reason, boolean uploadedSheet) {
        MarkState oldState = ks != null ? ks.state()
                : target == null ? MarkState.NOT_ANSWERED
                : target.markState() != null ? MarkState.valueOf(target.markState()) : MarkState.MARKED;
        String src = target == null ? null : target.marksSource();
        boolean isAi = MarksSource.AI.equals(src);
        boolean human = MarksSource.isProtected(src) || (src == null && ks != null
                && ks.derived().markedBy() == MarkedByKind.TEACHER_LEGACY);
        Double max = key != null ? QuestionMaxResolver.max(key) : null;
        double min = key != null ? QuestionMaxResolver.min(key) : 0.0;
        Plan p = new Plan();
        p.change = c;
        p.key = key;
        p.target = target;
        p.oldState = oldState.name();
        p.max = max;
        p.reason = reason;
        p.markedBy = c.actorUserId();
        p.eventType = MarkEventType.TEACHER_EDITED;

        switch (c.writer()) {
            case ACCEPT_AI -> {
                if (!isAi || oldState != MarkState.AI_DRAFT) return null;
                p.marks = target.marks();
                p.state = MarkState.MARKED;
                p.source = MarksSource.AI_REVIEWED;
                // The status follows the accepted mark (an older keyword / pre-AI status no longer
                // applies); a 0 on a blank answer stays PENDING (skipped).
                p.status = AnswerStatus.forAcceptedAi(p.marks, max, target.status(),
                        uploadedSheet ? null : MarkStateDeriver.isBlank(target, key));
                p.reason = reason != null ? reason : "Accepted the AI mark";
                return p;
            }
            case ANSWER_KEY, ANSWER_KEY_FORCE -> {
                if ((isAi || human) && c.writer() == Writer.ANSWER_KEY) {
                    throw SubmissionReviewException.conflict("PROTECTED_MARK",
                            "A teacher or the AI set this mark; re-mark with force to replace it",
                            src == null ? Map.of() : Map.of("marks_source", MarksSource.canonical(src)));
                }
                double marks = checkRange(c, value(c), min, max, true);
                p.marks = marks;
                boolean unanswered = QuestionResponseEnum.PENDING.name().equals(c.statusOverride());
                p.state = unanswered ? MarkState.NOT_ANSWERED : MarkState.MARKED;
                p.source = MarksSource.AUTO;
                p.status = c.statusOverride() != null ? c.statusOverride() : AnswerStatus.fromMarks(marks, max);
                p.markedBy = null;
                p.eventType = (isAi || human) ? MarkEventType.OVERRIDE_TEACHER : MarkEventType.KEY_REAPPLIED;
                return p;
            }
            case LEGACY_MANUAL_SUBMIT, LEGACY_REVIEW_PUT -> {
                if (c.notAnswered()) {
                    p.marks = 0.0;
                    p.state = MarkState.NOT_ANSWERED;
                    p.source = MarksSource.MANUAL;
                    p.status = QuestionResponseEnum.PENDING.name();
                    p.clearPartMarks = true;
                    return p;
                }
                double marks = checkRange(c, value(c), min, max, false);
                p.marks = marks;
                p.state = MarkState.MARKED;
                p.source = c.writer() == Writer.LEGACY_REVIEW_PUT ? MarksSource.AI_REVIEWED : MarksSource.MANUAL;
                // A status the caller sends counts only when it is a real one: the PDF evaluation
                // tool sends "evaluated" with every mark, which no report counts.
                p.status = AnswerStatus.knownOrFromMarks(c.statusOverride(), marks, max);
                p.reason = reason != null && !reason.isBlank() ? reason
                        : c.writer() == Writer.LEGACY_MANUAL_SUBMIT ? "Marked on the answer sheet"
                        : "Edited on the AI review page";
                return p;
            }
            default -> {
                // TEACHER, QUESTION_MARKS_PUT
                boolean putEndpoint = c.writer() == Writer.QUESTION_MARKS_PUT;
                if (putEndpoint && ks != null && ks.aiChecking()) {
                    // The same "AI checking" the Submission page shows: a run is active, it
                    // grades this answer, and no person has marked it yet. PR #3814's endpoint
                    // refused here; kept so its callers see the same answer.
                    Map<String, Object> d = new LinkedHashMap<>();
                    d.put("key", c.key());
                    throw SubmissionReviewException.conflict("AI_CHECKING",
                            "AI is still checking this answer. Change its marks after it finishes.", d);
                }
                if (c.notAnswered()) {
                    p.marks = 0.0;
                    p.state = MarkState.NOT_ANSWERED;
                    p.source = MarksSource.MANUAL;
                    p.status = QuestionResponseEnum.PENDING.name();
                    p.clearPartMarks = true;
                    return p;
                }
                if (c.marks() == null) {
                    throw SubmissionReviewException.unprocessable("OUT_OF_RANGE", "Enter a mark",
                            rangeDetails(c, min, max));
                }
                double marks = checkRange(c, c.marks(), min, max, !putEndpoint);
                p.marks = marks;
                p.state = MarkState.MARKED;
                p.source = isAi && target != null && Math.abs(QuestionMaxResolver.round2(target.marks()) - marks) < 0.005
                        ? MarksSource.AI_REVIEWED : MarksSource.MANUAL;
                p.status = AnswerStatus.fromMarks(marks, max);
                if (c.partMarks() != null) {
                    p.partMarksJson = partMarks(c, marks);
                } else {
                    p.clearPartMarks = target == null || Math.abs(target.marks() - marks) > 0.0001;
                }
                return p;
            }
        }
    }

    private static double value(MarkChange c) {
        return c.marks() == null ? 0.0 : c.marks();
    }

    private static double checkRange(MarkChange c, double value, double min, Double max, boolean strict) {
        double v = QuestionMaxResolver.round2(value);
        boolean below = v < min - 0.0001;
        boolean above = max != null && v > max + 0.0001;
        if (!below && !above) return v;
        if (strict) {
            throw SubmissionReviewException.unprocessable("OUT_OF_RANGE",
                    "The mark must be between " + fmt(min) + " and " + (max == null ? "any value" : fmt(max)),
                    rangeDetails(c, min, max));
        }
        return below ? min : max;
    }

    private static Map<String, Object> rangeDetails(MarkChange c, double min, Double max) {
        Map<String, Object> d = new LinkedHashMap<>();
        d.put("key", c.key());
        d.put("min", min);
        d.put("max", max);
        return d;
    }

    private static String fmt(double v) {
        return v == Math.rint(v) ? String.valueOf((long) v) : String.valueOf(v);
    }

    private static String partMarks(MarkChange c, double marks) {
        if (c.partMarks().isEmpty()) return "";
        double sum = 0;
        List<Map<String, Object>> out = new ArrayList<>();
        for (PartMark pm : c.partMarks()) {
            if (pm.marks() < 0 || (pm.max() != null && pm.marks() > pm.max() + 0.0001)) {
                Map<String, Object> d = new LinkedHashMap<>();
                d.put("key", c.key());
                d.put("criterion", pm.criterion());
                d.put("min", 0);
                d.put("max", pm.max());
                throw SubmissionReviewException.unprocessable("OUT_OF_RANGE",
                        "A part mark is outside its range", d);
            }
            sum += pm.marks();
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("criterion", pm.criterion());
            m.put("marks", pm.marks());
            m.put("max", pm.max());
            out.add(m);
        }
        if (Math.abs(sum - marks) > 0.01) {
            Map<String, Object> d = new LinkedHashMap<>();
            d.put("key", c.key());
            d.put("sum", QuestionMaxResolver.round2(sum));
            d.put("marks", marks);
            throw SubmissionReviewException.unprocessable("PART_MARKS_SUM_MISMATCH",
                    "The part marks do not add up to the mark", d);
        }
        return MarkHistory.json(out);
    }

    private static String partMarksOf(QuestionWiseMarks e) {
        return e == null ? null : e.getPartMarksJson();
    }

    private static Review.MarkRow newestRow(List<Review.MarkRow> rows, String sectionId, String questionId) {
        Review.MarkRow best = null;
        for (Review.MarkRow r : rows) {
            if (!Objects.equals(r.sectionId(), sectionId) || !Objects.equals(r.questionId(), questionId)) continue;
            if (best == null || (r.createdAt() != null && (best.createdAt() == null || r.createdAt().after(best.createdAt())))) {
                best = r;
            }
        }
        return best;
    }

    private QuestionWiseMarks newRow(StudentAttempt attempt, Assessment assessment, MarkChange c) {
        return QuestionWiseMarks.builder()
                .assessment(assessment)
                .studentAttempt(attempt)
                .question(questionRepository.getReferenceById(c.questionId()))
                .section(section(c.sectionId()))
                .status(QuestionResponseEnum.PENDING.name())
                .marks(0)
                .revision(0)
                .build();
    }

    private vacademy.io.assessment_service.features.assessment.entity.Section section(String sectionId) {
        return sectionRepository.findById(sectionId).orElseThrow(() -> SubmissionReviewException.unprocessable(
                "NOT_IN_PAPER", "This section is not on the paper", Map.of("section_id", sectionId)));
    }

    /**
     * Whether the PDF tool is marking an uploaded answer sheet: a handwritten or scanned
     * copy, or a homework that is marked by hand (evaluation type MANUAL) or was answered
     * with an uploaded file (pre-ship review R4: such a homework is kind HOMEWORK).
     */
    static boolean marksAnUploadedSheet(SubmissionKind kind, Assessment assessment, String attemptData) {
        if (kind == SubmissionKind.HANDWRITTEN || kind == SubmissionKind.SCANNED) return true;
        if (kind != SubmissionKind.HOMEWORK) return false;
        if (assessment != null && "MANUAL".equalsIgnoreCase(assessment.getEvaluationType())) return true;
        if (attemptData == null || attemptData.isBlank()) return false;
        try {
            JsonNode id = JSON.readTree(attemptData).path("fileId");
            return id.isTextual() && !id.asText().isBlank();
        } catch (Exception e) {
            return false;
        }
    }

    /**
     * Tests whose submit releases the result, so a held attempt releases once marked (not
     * OMR, not partner API exams): AUTO_AFTER_SUBMISSION, and AUTO_AFTER_ASSESSMENT_END on
     * a mock / practice test, which never ends (submit releases it; the cron never would).
     */
    static boolean autoReleasesOnSubmit(Assessment a) {
        if (a == null || Boolean.TRUE.equals(a.getOmrMode()) || ApiCandidatePolicy.isApiExam(a)) return false;
        if (ResultTypeEnum.AUTO_AFTER_SUBMISSION.name().equals(a.getResultType())) return true;
        return ResultTypeEnum.AUTO_AFTER_ASSESSMENT_END.name().equals(a.getResultType())
                && a.getPlayMode() != null
                && StudentAttemptService.OPEN_ENDED_PLAY_MODES.contains(a.getPlayMode().toUpperCase());
    }

    private void clearComparisonCache() {
        try {
            Cache cache = cacheManager == null ? null : cacheManager.getCache(COMPARISON_CACHE);
            if (cache != null) cache.clear();
        } catch (Exception e) {
            log.warn("[submission-review] could not clear comparisonData: {}", e.getMessage());
        }
    }

    static void afterCommit(Runnable r) {
        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override
                public void afterCommit() {
                    r.run();
                }
            });
        } else {
            r.run();
        }
    }

    private static final class Plan {
        MarkChange change;
        Review.PaperKey key;
        Review.MarkRow target;
        String oldState;
        double marks;
        MarkState state;
        String source;
        String status;
        Double max;
        String reason;
        String markedBy;
        String partMarksJson;
        boolean clearPartMarks;
        MarkEventType eventType;

        boolean feedbackChanges(QuestionWiseMarks entity) {
            String fb = change.feedback();
            if (fb == null) return false;
            String current = entity == null ? null : entity.getEvaluatorFeedback();
            String next = fb.isEmpty() ? null : fb;
            if (entity == null && target != null) {
                return !Objects.equals(target.hasFeedback() ? "?" : null, next);
            }
            return !Objects.equals(current, next);
        }
    }
}
