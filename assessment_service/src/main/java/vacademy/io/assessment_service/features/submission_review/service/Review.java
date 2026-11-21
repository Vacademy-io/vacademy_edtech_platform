package vacademy.io.assessment_service.features.submission_review.service;

import vacademy.io.assessment_service.features.learner_assessment.entity.QuestionWiseMarks;

import java.util.ArrayList;
import java.util.Collection;
import java.util.Date;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/** Value types shared by the submission-review read and write paths. */
public final class Review {

    private Review() {
    }

    public static String key(String sectionId, String questionId) {
        return sectionId + ":" + questionId;
    }

    /** One answer slot of the paper: a live mapping of a live section. */
    public record PaperKey(String sectionId, String sectionName, int sectionOrder, Double marksPerQuestion,
                           String questionId, int questionOrder, int questionNumber, String questionType,
                           String markingJson, String autoEvaluationJson) {
        public String key() {
            return Review.key(sectionId, questionId);
        }
    }

    /** The paper of an assessment, in section then question order. */
    public record Paper(String assessmentId, List<PaperKey> keys) {
        public PaperKey find(String sectionId, String questionId) {
            for (PaperKey k : keys) {
                if (k.sectionId().equals(sectionId) && k.questionId().equals(questionId)) return k;
            }
            return null;
        }

        public List<PaperKey> keysOfQuestion(String questionId) {
            List<PaperKey> out = new ArrayList<>();
            for (PaperKey k : keys) {
                if (k.questionId().equals(questionId)) out.add(k);
            }
            return out;
        }

        /** Section ids in paper order with their keys. */
        public Map<String, List<PaperKey>> bySection() {
            Map<String, List<PaperKey>> out = new LinkedHashMap<>();
            for (PaperKey k : keys) out.computeIfAbsent(k.sectionId(), s -> new ArrayList<>()).add(k);
            return out;
        }
    }

    /**
     * One question_wise_marks row as the review logic needs it. {@code responseJson} is only
     * filled when the row's state has to be derived from the answer (legacy written rows).
     */
    public record MarkRow(String id, String attemptId, String sectionId, String questionId, double marks,
                          String status, String marksSource, String markState, int revision, Double maxMarks,
                          String markedBy, Date markedAt, boolean hasFeedback, String answerPages,
                          String aiQuestionEvaluationId, Date createdAt, String responseJson) {

        public static MarkRow of(QuestionWiseMarks q) {
            String sectionId = q.getSectionId() != null ? q.getSectionId()
                    : (q.getSection() != null ? q.getSection().getId() : null);
            String attemptId = q.getStudentAttempt() != null ? q.getStudentAttempt().getId() : null;
            String questionId = q.getQuestion() != null ? q.getQuestion().getId() : null;
            return new MarkRow(q.getId(), attemptId, sectionId, questionId, q.getMarks(), q.getStatus(),
                    q.getMarksSource(), q.getMarkState(), q.getRevision(), q.getMaxMarks(), q.getMarkedBy(),
                    q.getMarkedAt(), q.getEvaluatorFeedback() != null && !q.getEvaluatorFeedback().isBlank(),
                    q.getAnswerPages(), q.getAiQuestionEvaluationId(), q.getCreatedAt(), q.getResponseJson());
        }
    }

    /** The AI runs of one attempt, as far as the review states need them. */
    public record RunInfo(ProcessInfo active, ProcessInfo newest, ProcessInfo newestTerminal,
                          Map<String, String> terminalQuestionStatus) {
        public static final RunInfo NONE = new RunInfo(null, null, null, Map.of());

        public boolean hasActive() {
            return active != null;
        }
    }

    public record ProcessInfo(String id, String status, String lane, String triggeredBy, String apiKeyId,
                              String errorMessage, Integer questionsCompleted, Integer questionsTotal,
                              Integer pageCount, Date startedAt, Date createdAt) {
        /** A run nobody asked for on a test with AI off: it grades the CBE answers only. */
        public boolean cbeOnly(Boolean aiEvaluationEnabled) {
            if (Boolean.TRUE.equals(aiEvaluationEnabled)) return false;
            boolean teacher = triggeredBy != null && !triggeredBy.isBlank();
            boolean partner = apiKeyId != null && !apiKeyId.isBlank();
            return !teacher && !partner;
        }
    }

    /**
     * The row that holds an answer's mark (contract 3.2 step 3): the newest row of the key;
     * else the newest section-less row of the question when the question sits in exactly one
     * section of the paper. Older duplicates are ignored.
     */
    public static Map<String, MarkRow> targets(Paper paper, Collection<MarkRow> rows) {
        Map<String, MarkRow> byKey = new HashMap<>();
        Map<String, MarkRow> noSection = new HashMap<>();
        for (MarkRow r : rows) {
            if (r.questionId() == null) continue;
            if (r.sectionId() == null) {
                noSection.merge(r.questionId(), r, Review::newer);
            } else {
                byKey.merge(key(r.sectionId(), r.questionId()), r, Review::newer);
            }
        }
        Map<String, MarkRow> out = new LinkedHashMap<>();
        for (PaperKey k : paper.keys()) {
            MarkRow r = byKey.get(k.key());
            if (r == null && noSection.containsKey(k.questionId()) && paper.keysOfQuestion(k.questionId()).size() == 1) {
                r = noSection.get(k.questionId());
            }
            if (r != null) out.put(k.key(), r);
        }
        return out;
    }

    private static MarkRow newer(MarkRow a, MarkRow b) {
        if (a.createdAt() == null) return b;
        if (b.createdAt() == null) return a;
        return b.createdAt().after(a.createdAt()) ? b : a;
    }

    /** questionId -> marks of its first paper key (the choice-group input). */
    public static Map<String, Double> marksByQuestion(Paper paper, Map<String, MarkRow> targets) {
        Map<String, Double> out = new LinkedHashMap<>();
        for (PaperKey k : paper.keys()) {
            if (out.containsKey(k.questionId())) continue;
            MarkRow r = targets.get(k.key());
            out.put(k.questionId(), r == null ? 0.0 : r.marks());
        }
        return out;
    }

    public static boolean isAnyOf(String value, Set<String> set) {
        return value != null && set.contains(value);
    }
}
