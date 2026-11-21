package vacademy.io.assessment_service.features.submission_review.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;
import vacademy.io.assessment_service.features.assessment.entity.Assessment;
import vacademy.io.assessment_service.features.assessment.enums.AttemptResultStatusEnum;
import vacademy.io.assessment_service.features.assessment.service.evaluation_ai.DashboardChoiceGroups;
import vacademy.io.assessment_service.features.open_evaluation.choice.ChoiceGroupStore;
import vacademy.io.assessment_service.features.submission_review.model.MarkState;
import vacademy.io.assessment_service.features.submission_review.model.MarkingStatus;
import vacademy.io.assessment_service.features.submission_review.model.MarksSource;
import vacademy.io.assessment_service.features.submission_review.model.QuestionKinds;
import vacademy.io.assessment_service.features.submission_review.model.SubmissionKind;

import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * One computation of an attempt's marks picture: per-answer state, counts, the R6 total,
 * the stored result status (contract 4.2-4.5, 5.3). Used by the submission page, the list
 * counts, the release gate and MarkWriter, so they can never disagree (spec C2-8).
 */
@Component
public class SubmissionSnapshots {

    public static final String AI_FAILED_DEFAULT = "AI couldn't mark this answer";
    private static final ObjectMapper JSON = new ObjectMapper();

    @Autowired(required = false)
    private DashboardChoiceGroups choiceGroups;

    public SubmissionSnapshots() {
    }

    public SubmissionSnapshots(DashboardChoiceGroups choiceGroups) {
        this.choiceGroups = choiceGroups;
    }

    /** What the rules need to know about the test. */
    public record Facts(String assessmentId, String evaluationType, Boolean aiEvaluationEnabled, SubmissionKind kind) {
        public static Facts of(Assessment a, SubmissionKind kind) {
            return new Facts(a.getId(), a.getEvaluationType(), a.getAiEvaluationEnabled(), kind);
        }
    }

    public record KeyState(Review.PaperKey key, Review.MarkRow row, MarkStateDeriver.Derived derived,
                           boolean aiChecking, String aiFailedReason, boolean counted, Double max, double min) {
        public MarkState state() {
            return derived.state();
        }

        public double marks() {
            return row == null || derived.state() == MarkState.NOT_ANSWERED ? 0.0 : row.marks();
        }
    }

    public record Counts(int notAnswered, int needsMarking, int aiDraft, int marked, int aiChecking, int aiFailed,
                         int notCounted) {
    }

    public record Snapshot(List<KeyState> keys, Counts counts, double total, Double maxTotal, String resultStatus,
                           boolean activeRun, int needsIncludingChecking) {
        public KeyState find(String sectionId, String questionId) {
            for (KeyState k : keys) {
                if (k.key().sectionId().equals(sectionId) && k.key().questionId().equals(questionId)) return k;
            }
            return null;
        }

        /** Answers that stop a release: needs marking (AI failed included) or being checked by the AI. */
        public List<KeyState> blockers() {
            List<KeyState> out = new ArrayList<>();
            for (KeyState k : keys) {
                if (k.state() == MarkState.NEEDS_MARKING || k.aiChecking()) out.add(k);
            }
            return out;
        }
    }

    /** Choice groups of the assessment, read once per request. */
    public List<ChoiceGroupStore.ChoiceGroupRow> groups(String assessmentId) {
        return choiceGroups == null ? List.of() : choiceGroups.groups(assessmentId);
    }

    public Snapshot compute(Facts facts, boolean released, Review.Paper paper, Collection<Review.MarkRow> rows,
                            Review.RunInfo run, List<ChoiceGroupStore.ChoiceGroupRow> groups) {
        return compute(facts, released, paper, Review.targets(paper, rows), run, groups);
    }

    public Snapshot compute(Facts facts, boolean released, Review.Paper paper, Map<String, Review.MarkRow> targets,
                            Review.RunInfo run, List<ChoiceGroupStore.ChoiceGroupRow> groups) {
        if (run == null) run = Review.RunInfo.NONE;
        Set<String> notCounted = choiceGroups == null || groups == null || groups.isEmpty() ? Set.of()
                : choiceGroups.notCountedByMarks(groups, Review.marksByQuestion(paper, targets));
        boolean cbeOnly = run.active() != null && run.active().cbeOnly(facts.aiEvaluationEnabled());
        String lane = run.active() != null ? run.active().lane() : null;
        // The automatic CBE-only run of an AI-off test never grades a long answer, so its
        // failure is not a reason on one (e.g. a keyword suggestion just needs the teacher).
        // A copy-check run grades every question, and a legacy run without a lane keeps
        // today's reading.
        Review.ProcessInfo terminal = run.newestTerminal();
        boolean terminalCbeOnly = terminal != null && terminal.lane() != null
                && !"COPY".equalsIgnoreCase(terminal.lane()) && terminal.cbeOnly(facts.aiEvaluationEnabled());
        List<KeyState> out = new ArrayList<>();
        int na = 0, needs = 0, needsAll = 0, drafts = 0, cbeDrafts = 0, marked = 0, checking = 0, failed = 0, nc = 0;
        double total = 0;
        double maxSum = 0;
        boolean anyMax = false;
        for (Review.PaperKey key : paper.keys()) {
            Review.MarkRow row = targets.get(key.key());
            MarkStateDeriver.Derived d = MarkStateDeriver.derive(row, key, facts.kind(), facts.evaluationType(),
                    released);
            boolean aiChecking = run.active() != null && gradable(key.questionType(), lane, cbeOnly)
                    && (row == null || !MarksSource.isProtected(row.marksSource()));
            String failedReason = null;
            if (d.state() == MarkState.NEEDS_MARKING && !aiChecking
                    && !(terminalCbeOnly && !QuestionKinds.isCbe(key.questionType()))) {
                failedReason = failedReason(run, key.questionId());
            }
            boolean counted = !notCounted.contains(key.questionId());
            Double max = QuestionMaxResolver.max(key);
            if (max != null) {
                maxSum += max;
                anyMax = true;
            }
            KeyState ks = new KeyState(key, row, d, aiChecking, failedReason, counted, max,
                    QuestionMaxResolver.min(key));
            out.add(ks);
            switch (d.state()) {
                case NOT_ANSWERED -> na++;
                case NEEDS_MARKING -> {
                    needsAll++;
                    if (!aiChecking) needs++;
                }
                case AI_DRAFT -> {
                    drafts++;
                    if (QuestionKinds.isCbe(key.questionType())) cbeDrafts++;
                }
                case MARKED -> marked++;
            }
            if (aiChecking) checking++;
            if (failedReason != null) failed++;
            if (!counted) nc++;
            if (counted) total += ks.marks();
        }
        Double maxTotal = null;
        if (groups != null && !groups.isEmpty() && choiceGroups != null) {
            maxTotal = choiceGroups.paperMax(facts.assessmentId(), groups);
        }
        if (maxTotal == null && anyMax) maxTotal = QuestionMaxResolver.round2(maxSum);
        boolean active = run.active() != null;
        boolean complete = needsAll == 0 && !active && !holdsDrafts(run, facts.aiEvaluationEnabled(), cbeDrafts);
        String resultStatus = complete ? AttemptResultStatusEnum.COMPLETED.name()
                : (active || drafts > 0 || failed > 0 ? AttemptResultStatusEnum.EVALUATING.name()
                : AttemptResultStatusEnum.PENDING.name());
        return new Snapshot(out, new Counts(na, needs, drafts, marked, checking, failed, nc),
                QuestionMaxResolver.round2(total), maxTotal, resultStatus, active, needsAll);
    }

    /**
     * D5, narrowed by the pre-ship review (R3): AI drafts keep the attempt EVALUATING only
     * when they come from the automatic CBE-only run on an AI-off test, which c644cf9341
     * deliberately leaves EVALUATING (CopyCheckCallbackService) so the cron does not release
     * unreviewed CBE marks. A run a teacher (or a partner) started on an AI-off test ends
     * COMPLETED, and an edit afterwards must keep it so. The newest terminal run decides,
     * as in the AI callback.
     */
    static boolean holdsDrafts(Review.RunInfo run, Boolean aiEvaluationEnabled, int cbeDrafts) {
        if (cbeDrafts == 0 || run == null) return false;
        Review.ProcessInfo terminal = run.newestTerminal();
        return terminal != null && terminal.cbeOnly(aiEvaluationEnabled);
    }

    /** Whether an active run grades this question: COPY every question; TYPED the written ones. */
    static boolean gradable(String type, String lane, boolean cbeOnly) {
        if ("COPY".equalsIgnoreCase(lane)) return true;
        if (cbeOnly) return QuestionKinds.isCbe(type);
        return QuestionKinds.isCbe(type) || QuestionKinds.isLongAnswer(type);
    }

    static String failedReason(Review.RunInfo run, String questionId) {
        Review.ProcessInfo t = run.newestTerminal();
        if (t == null) return null;
        if ("FAILED".equalsIgnoreCase(t.status())) {
            return t.errorMessage() == null || t.errorMessage().isBlank() ? AI_FAILED_DEFAULT : t.errorMessage();
        }
        String q = run.terminalQuestionStatus().get(questionId);
        return "FAILED".equalsIgnoreCase(q) ? AI_FAILED_DEFAULT : null;
    }

    /** W1 "Marking" (contract 5.3). */
    public static MarkingStatus marking(String attemptStatus, boolean hasRows, Double storedTotal, Counts c) {
        if (!"ENDED".equals(attemptStatus) && !"COPY_CHECK".equals(attemptStatus)) return MarkingStatus.NOT_SUBMITTED;
        if (!hasRows && storedTotal != null) return MarkingStatus.TOTAL_ONLY;
        if (c.needsMarking() > 0) return MarkingStatus.NEEDS_MARKING;
        if (c.aiChecking() > 0) return MarkingStatus.AI_CHECKING;
        if (c.aiDraft() > 0) return MarkingStatus.CHECK_AI;
        return MarkingStatus.DONE;
    }

    /** Submission kind, first match (contract 2.4). */
    public static SubmissionKind kind(String attemptStatus, Assessment a, String attemptData, boolean hasRows) {
        if ("COPY_CHECK".equals(attemptStatus)) return SubmissionKind.SCANNED;
        if (a != null && Boolean.TRUE.equals(a.getOmrMode())) return SubmissionKind.OMR;
        if (a != null && "HOMEWORK".equalsIgnoreCase(a.getAssessmentType())) return SubmissionKind.HOMEWORK;
        if (a != null && "MANUAL".equalsIgnoreCase(a.getEvaluationType())) return SubmissionKind.HANDWRITTEN;
        if (hasRows && !hasSections(attemptData)) return SubmissionKind.OFFLINE;
        return SubmissionKind.ONLINE;
    }

    private static boolean hasSections(String attemptData) {
        if (attemptData == null || attemptData.isBlank()) return false;
        try {
            JsonNode n = JSON.readTree(attemptData).path("sections");
            return n.isArray();
        } catch (Exception e) {
            return true;
        }
    }
}
