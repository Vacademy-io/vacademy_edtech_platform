package vacademy.io.assessment_service.features.submission_review;

import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import vacademy.io.assessment_service.features.assessment.entity.Assessment;
import vacademy.io.assessment_service.features.assessment.entity.AssessmentUserRegistration;
import vacademy.io.assessment_service.features.assessment.entity.Section;
import vacademy.io.assessment_service.features.assessment.entity.StudentAttempt;
import vacademy.io.assessment_service.features.learner_assessment.entity.QuestionWiseMarks;
import vacademy.io.assessment_service.features.question_core.entity.Question;
import vacademy.io.assessment_service.features.submission_review.service.Review;
import vacademy.io.assessment_service.features.submission_review.service.SubmissionReviewStore;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.util.ArrayList;
import java.util.Collection;
import java.util.Date;
import java.util.HashSet;
import java.util.List;

import static org.mockito.Mockito.doReturn;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/** Small builders shared by the submission review tests. */
public final class ReviewFixtures {

    private ReviewFixtures() {
    }

    public static String marking(double total, double negative) {
        return "{\"type\":\"X\",\"data\":{\"totalMark\":" + total + ",\"negativeMark\":" + negative + "}}";
    }

    public static Review.PaperKey key(String sectionId, String questionId, int number, String type, double max) {
        return new Review.PaperKey(sectionId, "Section " + sectionId, 1, null, questionId, number, number, type,
                marking(max, 0), null);
    }

    public static Review.Paper paper(String assessmentId, Review.PaperKey... keys) {
        return new Review.Paper(assessmentId, List.of(keys));
    }

    public static Review.MarkRow row(String id, String sectionId, String questionId, double marks, String status,
                                     String source, String state, int revision) {
        return new Review.MarkRow(id, "att-1", sectionId, questionId, marks, status, source, state, revision, null,
                null, null, false, null, null, new Date(1_000_000L), null);
    }

    public static Review.MarkRow rowWithAnswer(String id, String sectionId, String questionId, String responseJson) {
        return new Review.MarkRow(id, "att-1", sectionId, questionId, 0, "PENDING", null, null, 0, null, null, null,
                false, null, null, new Date(1_000_000L), responseJson);
    }

    public static Assessment assessment(String id, String evaluationType, Boolean aiEnabled) {
        Assessment a = new Assessment();
        a.setId(id);
        a.setName("Test " + id);
        a.setEvaluationType(evaluationType);
        a.setAiEvaluationEnabled(aiEnabled);
        a.setResultType("MANUAL");
        return a;
    }

    public static StudentAttempt attempt(String id, Assessment a, String status) {
        AssessmentUserRegistration r = new AssessmentUserRegistration();
        r.setAssessment(a);
        r.setInstituteId("inst-1");
        r.setUserId("learner-1");
        r.setParticipantName("Asha");
        r.setStudentAttempts(new HashSet<>());
        StudentAttempt at = new StudentAttempt();
        at.setId(id);
        at.setRegistration(r);
        at.setStatus(status);
        at.setAttemptNumber(1);
        at.setAttemptData("{\"sections\":[]}");
        return at;
    }

    public static SubmissionReviewStore.AttemptState state(String id, String status, boolean released,
                                                           Double total, int marksRevision, Integer notified) {
        return new SubmissionReviewStore.AttemptState(id, status, released ? "RELEASED" : "PENDING",
                released ? new Date(1_762_861_800_000L) : null, total, "PENDING", marksRevision, notified, null,
                false, null, new Date());
    }

    public static QuestionWiseMarks entity(String id, StudentAttempt attempt, String sectionId, String questionId,
                                           double marks, String status, String source) {
        Section s = new Section();
        s.setId(sectionId);
        Question q = new Question();
        q.setId(questionId);
        QuestionWiseMarks m = QuestionWiseMarks.builder().id(id).studentAttempt(attempt).section(s).sectionId(sectionId)
                .question(q).marks(marks).status(status).marksSource(source).revision(0)
                .assessment(attempt.getRegistration().getAssessment()).build();
        m.setCreatedAt(new Date(1_000_000L));
        return m;
    }

    public static CustomUserDetails user(String id, String... roles) {
        CustomUserDetails u = mock(CustomUserDetails.class);
        when(u.getUserId()).thenReturn(id);
        Collection<GrantedAuthority> auths = new ArrayList<>();
        for (String r : roles) auths.add(new SimpleGrantedAuthority(r));
        doReturn(auths).when(u).getAuthorities();
        return u;
    }
}
