package vacademy.io.assessment_service.features.submission_review.service;

import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.cache.Cache;
import org.springframework.cache.CacheManager;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.assessment_service.features.assessment.entity.Assessment;
import vacademy.io.assessment_service.features.assessment.entity.StudentAttempt;
import vacademy.io.assessment_service.features.assessment.repository.StudentAttemptRepository;
import vacademy.io.assessment_service.features.assessment.service.ReleaseStateWriter;
import vacademy.io.assessment_service.features.learner_assessment.entity.QuestionWiseMarks;
import vacademy.io.assessment_service.features.learner_assessment.repository.QuestionWiseMarksRepository;
import vacademy.io.assessment_service.features.open_evaluation.policy.ApiCandidatePolicy;
import vacademy.io.assessment_service.features.open_evaluation.submission.ApiSubmissionFeed;
import vacademy.io.assessment_service.features.submission_review.model.ActorType;
import vacademy.io.assessment_service.features.submission_review.model.MarkEventType;
import vacademy.io.assessment_service.features.submission_review.model.AnswerStatus;
import vacademy.io.assessment_service.features.submission_review.model.MarkState;
import vacademy.io.assessment_service.features.submission_review.model.MarksSource;
import vacademy.io.assessment_service.features.submission_review.model.SubmissionReviewException;

import java.util.ArrayList;
import java.util.Collection;
import java.util.Date;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Release, withdraw and "send updated result" for one submission (contract 6), and the one
 * release write every dashboard release goes through ({@link #markReleased}).
 */
@Slf4j
@Service
public class SubmissionReleaseService {

    public enum Source { ROW, BULK, W9, MANUAL_SUBMIT, RELEASE_WHEN_MARKED, SEND_UPDATE, RENDER, LEGACY, AUTO }

    /**
     * Who released and from where. RENDER / SEND_UPDATE / AUTO keep the release date and write
     * no release event. {@code requestedAt}: when the release was asked for; a result a teacher
     * hid after that moment is not released by this (late, async) write.
     */
    public record ReleaseContext(String actorUserId, Source source, boolean allowUnmarked, Date requestedAt) {
        public ReleaseContext(String actorUserId, Source source, boolean allowUnmarked) {
            this(actorUserId, source, allowUnmarked, new Date());
        }

        public static ReleaseContext legacy(String actor) {
            return new ReleaseContext(actor, Source.LEGACY, false);
        }
    }

    /** {@code released}: false when the write was skipped (the result was hidden meanwhile). */
    public record ReleaseOutcome(boolean wasReleased, int acceptedAiDrafts, List<String> unmarkedKeys,
                                 boolean released) {
        static ReleaseOutcome skipped(boolean wasReleased) {
            return new ReleaseOutcome(wasReleased, 0, List.of(), false);
        }
    }

    /** {@code unmarkedAtRelease}: answers still needing marking (or being checked) when it was released. */
    public record RowRelease(boolean released, boolean releaseWhenMarked, int acceptedAiDrafts, boolean notified,
                             SubmissionReviewStore.AttemptState state, int unmarkedAtRelease) {
    }

    private final StudentAttemptRepository attemptRepository;
    private final QuestionWiseMarksRepository marksRepository;
    private final SubmissionReviewStore store;
    private final PaperOutline paperOutline;
    private final SubmissionSnapshots snapshots;
    private final MarkHistory history;
    private final ReleaseStateWriter releaseStateWriter;
    private final SubmissionResultMailer mailer;

    @Autowired(required = false)
    private CacheManager cacheManager;
    @Autowired(required = false)
    private ApiSubmissionFeed submissionFeed;

    public SubmissionReleaseService(StudentAttemptRepository attemptRepository,
                                    QuestionWiseMarksRepository marksRepository, SubmissionReviewStore store,
                                    PaperOutline paperOutline, SubmissionSnapshots snapshots, MarkHistory history,
                                    ReleaseStateWriter releaseStateWriter, SubmissionResultMailer mailer) {
        this.attemptRepository = attemptRepository;
        this.marksRepository = marksRepository;
        this.store = store;
        this.paperOutline = paperOutline;
        this.snapshots = snapshots;
        this.history = history;
        this.releaseStateWriter = releaseStateWriter;
        this.mailer = mailer;
    }

    /**
     * The release state change (contract 6.2): lock, accept stored AI drafts on a first
     * release, one targeted UPDATE (never a save of a possibly stale entity), history, then
     * the comparison cache and partner feed after commit. Joins the caller's transaction
     * (the caller may already hold the attempt lock); the async render loop has none, so
     * there it runs in its own.
     */
    @Transactional
    public ReleaseOutcome markReleased(String attemptId, String pdfFileId, ReleaseContext ctx) {
        attemptRepository.lockById(attemptId);
        StudentAttempt attempt = attemptRepository.findById(attemptId).orElse(null);
        SubmissionReviewStore.AttemptState state = store.attempt(attemptId);
        if (attempt == null || state == null) return ReleaseOutcome.skipped(false);
        boolean wasReleased = state.released();
        // A render or an update for a result that is no longer released ("Hide result again"
        // pressed in between) must not show it again, and its email must not go out.
        if (!wasReleased && (ctx.source() == Source.RENDER || ctx.source() == Source.SEND_UPDATE)) {
            log.info("[submission-review] attempt {} was hidden before its {} ran; not released again",
                    attemptId, ctx.source());
            return ReleaseOutcome.skipped(false);
        }
        // A release asked for before the teacher hid the result (bulk / W9 render loop), or
        // an automatic one: the teacher's hide wins.
        if (!wasReleased && state.withheldAt() != null && (ctx.source() == Source.AUTO
                || ctx.requestedAt() == null || state.withheldAt().after(ctx.requestedAt()))) {
            log.info("[submission-review] attempt {} was hidden by a teacher; {} release skipped",
                    attemptId, ctx.source());
            return ReleaseOutcome.skipped(false);
        }
        boolean submitted = "ENDED".equals(state.status()) || "COPY_CHECK".equals(state.status());
        boolean keepDate = ctx.source() == Source.SEND_UPDATE || ctx.source() == Source.RENDER
                || (ctx.source() == Source.AUTO && wasReleased);
        boolean writeEvents = submitted && ctx.source() != Source.SEND_UPDATE && ctx.source() != Source.RENDER
                && ctx.source() != Source.AUTO;
        int accepted = 0;
        List<String> unmarked = new ArrayList<>();
        if (!wasReleased && submitted) {
            Assessment assessment = attempt.getRegistration().getAssessment();
            List<QuestionWiseMarks> rows = marksRepository.lockAllForAttempt(attemptId);
            Review.Paper paper = paperOutline.get(assessment.getId());
            List<Review.MarkRow> view = rows.stream().map(Review.MarkRow::of).toList();
            SubmissionSnapshots.Facts facts = SubmissionSnapshots.Facts.of(assessment,
                    SubmissionSnapshots.kind(state.status(), assessment, attempt.getAttemptData(), !rows.isEmpty()));
            Review.RunInfo runs = store.runs(attemptId);
            var groups = snapshots.groups(assessment.getId());
            SubmissionSnapshots.Snapshot snap = snapshots.compute(facts, false, paper, view, runs, groups);
            for (SubmissionSnapshots.KeyState k : snap.blockers()) unmarked.add(k.key().key());
            // Owner decision 1: a teacher pressing Release is their OK for the AI's marks. The
            // drafts (stored AI_DRAFT, or source AI with no stored state - what the AI callback
            // writes) become "AI, checked by <teacher>": protected from later AI runs, and
            // "ai_reviewed" for the partner API. The cron (AUTO) has no teacher: unchanged.
            if (ctx.source() != Source.AUTO) {
                Map<String, QuestionWiseMarks> byId = new LinkedHashMap<>();
                for (QuestionWiseMarks q : rows) byId.put(q.getId(), q);
                boolean uploadedSheet = MarkWriter.marksAnUploadedSheet(facts.kind(), assessment,
                        attempt.getAttemptData());
                List<String> draftKeys = new ArrayList<>();
                Date now = new Date();
                for (SubmissionSnapshots.KeyState k : snap.keys()) {
                    if (k.state() != MarkState.AI_DRAFT || k.row() == null) continue;
                    QuestionWiseMarks q = byId.get(k.row().id());
                    if (q == null) continue;
                    q.setMarkState(MarkState.MARKED.name());
                    q.setMarksSource(MarksSource.AI_REVIEWED);
                    // The legacy status follows the mark (a PENDING row is "skipped" on the
                    // learner report while its marks count in the total); a 0 on a blank
                    // answer stays PENDING (skipped).
                    Double max = QuestionMaxResolver.max(k.key());
                    q.setStatus(AnswerStatus.forAcceptedAi(q.getMarks(), max != null ? max : q.getMaxMarks(),
                            q.getStatus(), uploadedSheet ? null : MarkStateDeriver.isBlank(k.row(), k.key())));
                    q.setMarkedBy(ctx.actorUserId());
                    q.setMarkedAt(now);
                    q.setRevision(q.getRevision() + 1);
                    marksRepository.save(q);
                    draftKeys.add(k.key().key());
                }
                accepted = draftKeys.size();
                if (accepted > 0 && writeEvents) {
                    history.submissionEvent(attempt, MarkEventType.AI_ACCEPTED_ON_RELEASE, ActorType.TEACHER,
                            ctx.actorUserId(), false, Map.of("count", accepted, "keys", draftKeys), null);
                }
                if (accepted > 0) {
                    // Pre-ship review R3: the accepted drafts may have been what held the
                    // attempt EVALUATING (a CBE-only run on an AI-off test). Store the result
                    // status and total of the rows as they now are, through the same write
                    // MarkWriter uses, so a released attempt never stays EVALUATING with
                    // every answer marked.
                    List<Review.MarkRow> acceptedView = rows.stream().map(Review.MarkRow::of).toList();
                    SubmissionSnapshots.Snapshot afterSnap = snapshots.compute(facts, false, paper, acceptedView,
                            runs, groups);
                    boolean statusMoved = !java.util.Objects.equals(afterSnap.resultStatus(), state.resultStatus());
                    boolean totalMoved = state.totalMarks() == null
                            || Math.abs(state.totalMarks() - afterSnap.total()) > 0.005;
                    if (statusMoved || totalMoved) {
                        attemptRepository.applyMarkTotals(attemptId, afterSnap.total(), afterSnap.resultStatus(),
                                false, now);
                    }
                }
            }
        }
        // A first release starts a fresh "Revised" history (an old date from before a hide
        // would otherwise tag a result the learner is seeing for the first time).
        attemptRepository.markReleasedState(attemptId, pdfFileId, keepDate, new Date(), !wasReleased);
        if (writeEvents) {
            Map<String, Object> payload = new LinkedHashMap<>();
            if (wasReleased) {
                payload.put("resend", true);
                payload.put("source", ctx.source().name());
                history.submissionEvent(attempt, MarkEventType.RELEASED, ActorType.TEACHER, ctx.actorUserId(), true,
                        payload, null);
            } else {
                payload.put("count", unmarked.size());
                payload.put("keys", unmarked);
                payload.put("source", ctx.source().name());
                history.submissionEvent(attempt, unmarked.isEmpty() ? MarkEventType.RELEASED
                        : MarkEventType.RELEASED_WITH_UNMARKED, ActorType.TEACHER, ctx.actorUserId(), false,
                        payload, null);
            }
        }
        MarkWriter.afterCommit(() -> {
            clearComparisonCache();
            if (submissionFeed != null) submissionFeed.touch(attemptId);
        });
        return new ReleaseOutcome(wasReleased, accepted, unmarked, true);
    }

    /** A8: release one submission from the submission page or the list row. */
    @Transactional
    public RowRelease releaseOne(String attemptId, boolean notify, boolean allowUnmarked, boolean releaseWhenMarked,
                                 String expectedRelease, String actor) {
        attemptRepository.lockById(attemptId);
        StudentAttempt attempt = attemptRepository.findById(attemptId).orElseThrow(this::notFound);
        SubmissionReviewStore.AttemptState state = store.attempt(attemptId);
        Assessment assessment = attempt.getRegistration().getAssessment();
        if (!"ENDED".equals(state.status()) && !"COPY_CHECK".equals(state.status())) {
            throw SubmissionReviewException.unprocessable("ATTEMPT_NOT_SUBMITTED",
                    "The learner has not submitted this test yet", null);
        }
        requireNotApiExam(assessment);
        if (state.released()) {
            throw SubmissionReviewException.conflict("ALREADY_RELEASED", "This result is already released", null);
        }
        if (expectedRelease != null && !expectedRelease.equals(state.token())) {
            throw SubmissionReviewException.conflict("RELEASE_CHANGED", "The result changed while you were looking",
                    Map.of("release", Map.of("status", "NOT_RELEASED", "token", state.token())));
        }
        SubmissionSnapshots.Snapshot snap = snapshot(attempt, state);
        List<SubmissionSnapshots.KeyState> blockers = snap.blockers();
        if (!blockers.isEmpty() && !allowUnmarked) {
            if (!releaseWhenMarked) {
                Map<String, Object> details = new LinkedHashMap<>();
                details.put("blockers", blockerViews(blockers));
                details.put("ai_eta_minutes", aiEtaMinutes(store.runs(attemptId)));
                throw SubmissionReviewException.conflict("BLOCKERS", "Some answers are not marked yet", details);
            }
            attemptRepository.markReleaseWhenMarked(List.of(attemptId));
            return new RowRelease(false, true, 0, false, store.attempt(attemptId), 0);
        }
        ReleaseOutcome out = markReleased(attemptId, null, new ReleaseContext(actor, Source.ROW, allowUnmarked));
        if (notify) {
            MarkWriter.afterCommit(() -> mailer.render(attemptId, Source.RENDER, actor));
        }
        return new RowRelease(true, false, out.acceptedAiDrafts(), notify, store.attempt(attemptId),
                out.unmarkedKeys().size());
    }

    /** A9: hide a released result again. */
    @Transactional
    public SubmissionReviewStore.AttemptState withdraw(String attemptId, String reason, String actor) {
        attemptRepository.lockById(attemptId);
        StudentAttempt attempt = attemptRepository.findById(attemptId).orElseThrow(this::notFound);
        SubmissionReviewStore.AttemptState state = store.attempt(attemptId);
        requireNotApiExam(attempt.getRegistration().getAssessment());
        if (!state.released()) {
            throw SubmissionReviewException.conflict("NOT_RELEASED", "This result is not released", null);
        }
        // A targeted UPDATE, not ReleaseStateWriter.withdraw: that saves the whole entity, and
        // the one in this request was loaded before the lock (open-session-in-view).
        attemptRepository.markWithdrawn(attemptId, new Date());
        MarkWriter.afterCommit(() -> {
            clearComparisonCache();
            if (submissionFeed != null) submissionFeed.touch(attemptId);
        });
        history.submissionEvent(attempt, MarkEventType.WITHDRAWN, ActorType.TEACHER, actor, true, null, reason);
        return store.attempt(attemptId);
    }

    /** A9b (and an edit with notify_learner): the learner gets the current marks, once. */
    @Transactional
    public SubmissionReviewStore.AttemptState sendUpdate(String attemptId, String actor) {
        attemptRepository.lockById(attemptId);
        StudentAttempt attempt = attemptRepository.findById(attemptId).orElseThrow(this::notFound);
        SubmissionReviewStore.AttemptState state = store.attempt(attemptId);
        requireNotApiExam(attempt.getRegistration().getAssessment());
        if (!state.released()) {
            throw SubmissionReviewException.conflict("NOT_RELEASED", "This result is not released", null);
        }
        attemptRepository.markNotifiedToCurrent(attemptId);
        history.submissionEvent(attempt, MarkEventType.UPDATE_SENT, ActorType.TEACHER, actor, true,
                Map.of("marks_revision", state.marksRevision()), null);
        MarkWriter.afterCommit(() -> mailer.render(attemptId, Source.SEND_UPDATE, actor));
        return store.attempt(attemptId);
    }

    /**
     * Release when marked (contract 6.4), after a teacher's edit or an AI run finished:
     * <ul>
     *   <li>flagged "release the rest once marked" (W9 / A8): released once nothing blocks a
     *       release any more (no answer needs marking or is being checked). AI drafts do not
     *       block: the teacher already pressed Release, which is their OK (owner decision 1);</li>
     *   <li>otherwise a test released on submit ({@link MarkWriter#autoReleasesOnSubmit}) whose
     *       marking a teacher just finished:
     *       released when COMPLETED and not hidden by a teacher; the result message only for
     *       EXAM tests (a mock / practice attempt is retaken freely; same rule as on submit).</li>
     * </ul>
     */
    @Transactional
    public boolean releaseWhenMarked(String attemptId, String actor) {
        attemptRepository.lockById(attemptId);
        SubmissionReviewStore.AttemptState state = store.attempt(attemptId);
        if (state == null || state.released()) return false;
        StudentAttempt attempt = attemptRepository.findById(attemptId).orElse(null);
        if (attempt == null || attempt.getRegistration() == null) return false;
        Assessment assessment = attempt.getRegistration().getAssessment();
        boolean notify = true;
        if (state.releaseWhenMarked()) {
            if (ApiCandidatePolicy.isApiExam(assessment) || !snapshot(attempt, state).blockers().isEmpty()) {
                return false;
            }
        } else {
            if (state.withheld() || !"COMPLETED".equals(state.resultStatus())
                    || !MarkWriter.autoReleasesOnSubmit(assessment)) {
                return false;
            }
            notify = "EXAM".equalsIgnoreCase(assessment.getPlayMode());
        }
        markReleased(attemptId, null, new ReleaseContext(actor, Source.RELEASE_WHEN_MARKED, false));
        if (notify) {
            MarkWriter.afterCommit(() -> mailer.render(attemptId, Source.RENDER, actor));
        }
        return true;
    }

    // ---------------------------------------------------------------------------------
    // Classification (A11, and the opt-in release-result flags).

    public enum ReleaseClass { NOT_SUBMITTED, ALREADY_RELEASED, AI_CHECKING, UNMARKED, AI_DRAFTS, READY }

    public record Classified(String attemptId, ReleaseClass cls, int unmarkedAnswers, int draftAnswers,
                             Integer etaMinutes) {
    }

    /** First match wins: not submitted, already released, AI checking, unmarked, AI drafts, ready. */
    public List<Classified> classify(Assessment assessment, List<SubmissionReviewStore.AttemptState> attempts) {
        List<Classified> out = new ArrayList<>();
        if (attempts.isEmpty()) return out;
        List<String> ids = attempts.stream().map(SubmissionReviewStore.AttemptState::id).toList();
        Map<String, List<Review.MarkRow>> rowsByAttempt = new LinkedHashMap<>();
        boolean wide = ids.size() > SubmissionReviewStore.MAX_IN;
        for (Review.MarkRow r : wide ? store.rowsOfAssessment(assessment.getId()) : store.rows(ids)) {
            rowsByAttempt.computeIfAbsent(r.attemptId(), k -> new ArrayList<>()).add(r);
        }
        Map<String, Review.RunInfo> runs = wide ? store.runsOfAssessment(assessment.getId()) : store.runs(ids);
        Review.Paper paper = paperOutline.get(assessment.getId());
        var groups = snapshots.groups(assessment.getId());
        for (SubmissionReviewStore.AttemptState a : attempts) {
            boolean submitted = "ENDED".equals(a.status()) || "COPY_CHECK".equals(a.status());
            if (!submitted) {
                out.add(new Classified(a.id(), ReleaseClass.NOT_SUBMITTED, 0, 0, null));
                continue;
            }
            if (a.released()) {
                out.add(new Classified(a.id(), ReleaseClass.ALREADY_RELEASED, 0, 0, null));
                continue;
            }
            List<Review.MarkRow> rows = rowsByAttempt.getOrDefault(a.id(), List.of());
            Review.RunInfo run = runs.getOrDefault(a.id(), Review.RunInfo.NONE);
            SubmissionSnapshots.Snapshot snap = snapshots.compute(SubmissionSnapshots.Facts.of(assessment,
                    SubmissionSnapshots.kind(a.status(), assessment, null, !rows.isEmpty())), false, paper, rows, run,
                    groups);
            boolean totalOnly = rows.isEmpty() && a.totalMarks() != null;
            if (totalOnly) {
                out.add(new Classified(a.id(), ReleaseClass.READY, 0, 0, null));
            } else if (snap.counts().aiChecking() > 0) {
                out.add(new Classified(a.id(), ReleaseClass.AI_CHECKING, snap.needsIncludingChecking(), 0,
                        aiEtaMinutes(run)));
            } else if (snap.needsIncludingChecking() > 0) {
                out.add(new Classified(a.id(), ReleaseClass.UNMARKED, snap.needsIncludingChecking(), 0, null));
            } else if (snap.counts().aiDraft() > 0) {
                out.add(new Classified(a.id(), ReleaseClass.AI_DRAFTS, 0, snap.counts().aiDraft(), null));
            } else {
                out.add(new Classified(a.id(), ReleaseClass.READY, 0, 0, null));
            }
        }
        return out;
    }

    /**
     * The opt-in flags of release-result (contract 6.1): lock the targets, classify, flag the
     * skipped ones "release when marked", and return the ids to release. Runs in the request.
     */
    @Transactional
    public List<String> planBulkRelease(Assessment assessment, List<String> targetIds,
                                        Boolean skipUnready, Boolean skipAlreadyReleased, Boolean allowUnmarked,
                                        Boolean releaseWhenMarked) {
        List<String> ids = targetIds.stream().distinct().sorted().toList();
        List<SubmissionReviewStore.AttemptState> fresh = new ArrayList<>();
        // Locked in id order, in chunks (JDBC bind limit); every chunk stays locked to commit.
        for (int from = 0; from < ids.size(); from += SubmissionReviewStore.MAX_IN) {
            List<String> chunk = ids.subList(from, Math.min(ids.size(), from + SubmissionReviewStore.MAX_IN));
            attemptRepository.lockByIdsOrdered(chunk);
            fresh.addAll(store.attempts(assessment.getId(), chunk));
        }
        List<String> release = new ArrayList<>();
        List<String> flag = new ArrayList<>();
        boolean allow = Boolean.TRUE.equals(allowUnmarked);
        for (Classified c : classify(assessment, fresh)) {
            switch (c.cls()) {
                case NOT_SUBMITTED -> {
                    // W9 never releases a learner who has not submitted: one still taking the
                    // test would get a report mid-test, and a later submit would land on an
                    // already released result with unmarked answers. The dialog says so.
                    // (The old body, without these flags, keeps today's handling.)
                }
                case ALREADY_RELEASED -> {
                    if (!Boolean.TRUE.equals(skipAlreadyReleased)) release.add(c.attemptId());
                }
                case UNMARKED, AI_CHECKING -> {
                    if (allow || !Boolean.TRUE.equals(skipUnready)) {
                        release.add(c.attemptId());
                    } else if (Boolean.TRUE.equals(releaseWhenMarked)) {
                        flag.add(c.attemptId());
                    }
                }
                default -> release.add(c.attemptId());
            }
        }
        for (int from = 0; from < flag.size(); from += SubmissionReviewStore.MAX_IN) {
            attemptRepository.markReleaseWhenMarked(flag.subList(from, Math.min(flag.size(),
                    from + SubmissionReviewStore.MAX_IN)));
        }
        return release;
    }

    // ---------------------------------------------------------------------------------

    public SubmissionSnapshots.Snapshot snapshot(StudentAttempt attempt, SubmissionReviewStore.AttemptState state) {
        Assessment assessment = attempt.getRegistration().getAssessment();
        List<Review.MarkRow> rows = store.rows(List.of(attempt.getId()));
        return snapshots.compute(SubmissionSnapshots.Facts.of(assessment, SubmissionSnapshots.kind(state.status(),
                        assessment, attempt.getAttemptData(), !rows.isEmpty())), state.released(),
                paperOutline.get(assessment.getId()), rows, store.runs(attempt.getId()),
                snapshots.groups(assessment.getId()));
    }

    static List<Map<String, Object>> blockerViews(Collection<SubmissionSnapshots.KeyState> blockers) {
        List<Map<String, Object>> out = new ArrayList<>();
        for (SubmissionSnapshots.KeyState k : blockers) {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("key", k.key().key());
            m.put("section_id", k.key().sectionId());
            m.put("question_id", k.key().questionId());
            m.put("question_number", k.key().questionNumber());
            m.put("question_type", k.key().questionType());
            m.put("state", k.aiChecking() ? "AI_CHECKING" : k.aiFailedReason() != null ? "AI_FAILED" : "NEEDS_MARKING");
            m.put("reason", k.aiFailedReason());
            out.add(m);
        }
        return out;
    }

    /** Best effort: a typed run needs about a minute per question left, a copy a minute per page. */
    static Integer aiEtaMinutes(Review.RunInfo run) {
        if (run == null || run.active() == null) return null;
        Review.ProcessInfo p = run.active();
        if ("COPY".equalsIgnoreCase(p.lane())) {
            return p.pageCount() == null ? null : Math.max(1, p.pageCount());
        }
        if (p.questionsTotal() == null) return null;
        int left = p.questionsTotal() - (p.questionsCompleted() == null ? 0 : p.questionsCompleted());
        return Math.max(1, left);
    }

    private static void requireNotApiExam(Assessment assessment) {
        if (ApiCandidatePolicy.isApiExam(assessment)) {
            throw SubmissionReviewException.unprocessable("API_EXAM",
                    "This exam is run through the partner API: use finalize / unfinalize", null);
        }
    }

    private SubmissionReviewException notFound() {
        return new SubmissionReviewException(HttpStatus.NOT_FOUND, "NOT_FOUND", "Submission not found");
    }

    private void clearComparisonCache() {
        try {
            Cache cache = cacheManager == null ? null : cacheManager.getCache(MarkWriter.COMPARISON_CACHE);
            if (cache != null) cache.clear();
        } catch (Exception e) {
            log.warn("[submission-review] could not clear comparisonData: {}", e.getMessage());
        }
    }
}
