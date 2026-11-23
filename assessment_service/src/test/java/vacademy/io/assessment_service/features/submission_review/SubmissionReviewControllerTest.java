package vacademy.io.assessment_service.features.submission_review;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import vacademy.io.assessment_service.features.assessment.entity.StudentAttempt;
import vacademy.io.assessment_service.features.assessment.service.evaluation_ai.EvaluationAccessValidator;
import vacademy.io.assessment_service.features.open_evaluation.policy.ResultLockedException;
import vacademy.io.assessment_service.features.submission_review.controller.SubmissionReviewController;
import vacademy.io.assessment_service.features.submission_review.controller.SubmissionReviewExceptionHandler;
import vacademy.io.assessment_service.features.submission_review.model.SubmissionReviewException;
import vacademy.io.assessment_service.features.submission_review.service.MarkWriter;
import vacademy.io.assessment_service.features.submission_review.service.SubmissionReviewService;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** Wire shape of the submission review API: snake_case bodies and the {code, message, details} errors. */
class SubmissionReviewControllerTest {

    private SubmissionReviewService service;
    private EvaluationAccessValidator validator;
    private MockMvc mvc;
    private CustomUserDetails user;
    private StudentAttempt attempt;

    @BeforeEach
    void setUp() {
        service = mock(SubmissionReviewService.class);
        validator = mock(EvaluationAccessValidator.class);
        mvc = MockMvcBuilders.standaloneSetup(new SubmissionReviewController(service, validator))
                .setControllerAdvice(new SubmissionReviewExceptionHandler()).build();
        user = ReviewFixtures.user("teacher-1", "TEACHER");
        attempt = ReviewFixtures.attempt("att-1", ReviewFixtures.assessment("A", "AUTO", false), "ENDED");
        when(validator.requireAttemptAccess(user, "inst-1", "att-1")).thenReturn(attempt);
    }

    @Test
    void acceptance4_stale_edit_is_409_with_code_and_current_row() throws Exception {
        when(service.editOne(eq(user), eq(attempt), any(), anyBoolean())).thenThrow(SubmissionReviewException.conflict(
                "STALE_REVISION", "Someone else changed this mark", Map.of("current", Map.of("revision", 2))));
        mvc.perform(patch("/assessment-service/assessment/submission-review/v1/submissions/att-1/questions/s1/q2")
                        .requestAttr("user", user).header("clientId", "inst-1").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"marks\":7,\"expected_revision\":0,\"expected_release\":\"PENDING|0\"}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("STALE_REVISION"))
                .andExpect(jsonPath("$.details.current.revision").value(2));
    }

    @Test
    void acceptance4_out_of_range_is_422() throws Exception {
        when(service.editOne(eq(user), eq(attempt), any(), anyBoolean())).thenThrow(SubmissionReviewException.unprocessable(
                "OUT_OF_RANGE", "The mark must be between 0 and 10", Map.of("min", 0, "max", 10)));
        mvc.perform(patch("/assessment-service/assessment/submission-review/v1/submissions/att-1/questions/s1/q2")
                        .requestAttr("user", user).header("clientId", "inst-1").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"marks\":11,\"expected_revision\":0,\"expected_release\":\"PENDING|0\"}"))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.code").value("OUT_OF_RANGE"))
                .andExpect(jsonPath("$.details.max").value(10));
    }

    @Test
    void edit_needs_expected_revision_and_release() throws Exception {
        mvc.perform(patch("/assessment-service/assessment/submission-review/v1/submissions/att-1/questions/s1/q2")
                        .requestAttr("user", user).header("clientId", "inst-1").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"marks\":7}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("BAD_REQUEST"));
    }

    @Test
    void edit_body_is_read_as_snake_case() throws Exception {
        when(service.editOne(eq(user), eq(attempt), any(), anyBoolean())).thenReturn(Map.of("preview", true));
        mvc.perform(patch("/assessment-service/assessment/submission-review/v1/submissions/att-1/questions/s1/q2")
                        .requestAttr("user", user).header("clientId", "inst-1").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"marks\":7,\"expected_revision\":3,\"expected_release\":\"RELEASED|5\","
                                + "\"reason\":\"recheck\",\"notify_learner\":true,\"preview\":true,"
                                + "\"part_marks\":[{\"criterion\":\"A\",\"marks\":7,\"max\":10}]}"))
                .andExpect(status().isOk());
        ArgumentCaptor<MarkWriter.MarkChange> c = ArgumentCaptor.forClass(MarkWriter.MarkChange.class);
        verify(service).editOne(eq(user), eq(attempt), c.capture(), eq(true));
        MarkWriter.MarkChange change = c.getValue();
        assertThat(change.expectedRevision()).isEqualTo(3);
        assertThat(change.expectedRelease()).isEqualTo("RELEASED|5");
        assertThat(change.notifyLearner()).isTrue();
        assertThat(change.reason()).isEqualTo("recheck");
        assertThat(change.partMarks()).hasSize(1);
        assertThat(change.writer()).isEqualTo(MarkWriter.Writer.TEACHER);
        assertThat(change.actorUserId()).isEqualTo("teacher-1");
    }

    @Test
    void acceptance2_release_blockers_body() throws Exception {
        when(service.release(eq(user), eq(attempt), anyBoolean(), anyBoolean(), anyBoolean(), any()))
                .thenThrow(SubmissionReviewException.conflict("BLOCKERS", "Some answers are not marked yet",
                        Map.of("blockers", List.of(Map.of("key", "s1:q2", "state", "NEEDS_MARKING")))));
        mvc.perform(post("/assessment-service/assessment/submission-review/v1/submissions/att-1/release")
                        .requestAttr("user", user).header("clientId", "inst-1").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"notify\":true,\"expected_release\":\"PENDING|0\"}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("BLOCKERS"))
                .andExpect(jsonPath("$.details.blockers[0].key").value("s1:q2"));
    }

    @Test
    void release_when_marked_answers_202() throws Exception {
        when(service.release(eq(user), eq(attempt), eq(true), eq(false), eq(true), any()))
                .thenReturn(Map.of("released", false, "release_when_marked", true));
        mvc.perform(post("/assessment-service/assessment/submission-review/v1/submissions/att-1/release")
                        .requestAttr("user", user).header("clientId", "inst-1").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"release_when_marked\":true}"))
                .andExpect(status().isAccepted());
    }

    @Test
    void finalized_partner_exam_is_409_result_locked() throws Exception {
        when(service.outline(user, attempt)).thenThrow(new ResultLockedException("att-1"));
        mvc.perform(get("/assessment-service/assessment/submission-review/v1/submissions/att-1")
                        .requestAttr("user", user).header("clientId", "inst-1"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("RESULT_LOCKED"));
    }

    @Test
    void every_route_checks_staff_role_first() throws Exception {
        when(service.outline(user, attempt)).thenReturn(Map.of("attempt_id", "att-1"));
        mvc.perform(get("/assessment-service/assessment/submission-review/v1/submissions/att-1")
                        .requestAttr("user", user).header("clientId", "inst-1"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.attempt_id").value("att-1"));
        verify(validator).requireStaffRole(user);
        verify(validator).requireAttemptAccess(user, "inst-1", "att-1");
        assertThat(HttpStatus.OK.value()).isEqualTo(200);
    }

    /** Review 3 #4: accept-AI and re-mark with key need the release token (checked under the lock). */
    @Test
    void accept_ai_and_reapply_key_need_expected_release() throws Exception {
        String base = "/assessment-service/assessment/submission-review/v1/submissions/att-1";
        mvc.perform(post(base + "/accept-ai").requestAttr("user", user).header("clientId", "inst-1")
                        .contentType(MediaType.APPLICATION_JSON).content("{\"question_keys\":[]}"))
                .andExpect(status().isBadRequest());
        mvc.perform(post(base + "/questions/s1/q1/reapply-key").requestAttr("user", user).header("clientId", "inst-1")
                        .contentType(MediaType.APPLICATION_JSON).content("{}"))
                .andExpect(status().isBadRequest());
        when(service.acceptAi(eq(user), eq(attempt), any(), eq("PENDING|0"), any())).thenReturn(Map.of("accepted", 1));
        mvc.perform(post(base + "/accept-ai").requestAttr("user", user).header("clientId", "inst-1")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"question_keys\":[\"s1:q2\"],\"expected_release\":\"PENDING|0\",\"expected_revisions\":{\"s1:q2\":3}}"))
                .andExpect(status().isOk());
        @SuppressWarnings("unchecked")
        ArgumentCaptor<Map<String, Integer>> revisions = ArgumentCaptor.forClass(Map.class);
        verify(service).acceptAi(eq(user), eq(attempt), eq(List.of("s1:q2")), eq("PENDING|0"), revisions.capture());
        assertThat(revisions.getValue()).containsEntry("s1:q2", 3);
    }
}
