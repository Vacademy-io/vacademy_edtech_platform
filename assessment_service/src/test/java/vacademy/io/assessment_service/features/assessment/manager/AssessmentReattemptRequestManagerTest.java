package vacademy.io.assessment_service.features.assessment.manager;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.Pageable;
import org.springframework.test.util.ReflectionTestUtils;
import vacademy.io.assessment_service.features.assessment.dto.reattempt.CreateReattemptRequestDto;
import vacademy.io.assessment_service.features.assessment.dto.reattempt.ReattemptRequestDto;
import vacademy.io.assessment_service.features.assessment.dto.reattempt.ReviewReattemptRequestDto;
import vacademy.io.assessment_service.features.assessment.entity.AssessmentReattemptRequest;
import vacademy.io.assessment_service.features.assessment.repository.AssessmentReattemptRequestRepository;
import vacademy.io.assessment_service.features.assessment.repository.AssessmentRepository;
import vacademy.io.assessment_service.features.assessment.repository.AssessmentUserRegistrationRepository;
import vacademy.io.assessment_service.features.assessment.repository.QuestionAssessmentSectionMappingRepository;
import vacademy.io.assessment_service.features.assessment.service.AssessmentWorkflowEventPublisher;
import vacademy.io.assessment_service.features.assessment.service.QuestionTextPreview;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.VacademyException;

import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * The learner "Report a problem" request and the "more time" grant: a problem report keeps only
 * a question of this assessment, gets one open report per question and is closed as RESOLVED;
 * approving a time request adds the admin's minutes to the learner's own live attempt.
 */
class AssessmentReattemptRequestManagerTest {

    private static final String INSTITUTE = "inst-1";
    private static final String ASSESSMENT = "asmt-1";
    private static final String LEARNER = "user-1";

    private AssessmentReattemptRequestManager manager;
    private AssessmentReattemptRequestRepository requests;
    private AssessmentUserRegistrationRepository registrations;
    private AssessmentWorkflowEventPublisher events;
    private QuestionAssessmentSectionMappingRepository questions;
    private AssessmentParticipantsManager participants;

    @BeforeEach
    void setUp() {
        manager = new AssessmentReattemptRequestManager();
        requests = mock(AssessmentReattemptRequestRepository.class);
        registrations = mock(AssessmentUserRegistrationRepository.class);
        events = mock(AssessmentWorkflowEventPublisher.class);
        questions = mock(QuestionAssessmentSectionMappingRepository.class);
        participants = mock(AssessmentParticipantsManager.class);
        ReflectionTestUtils.setField(manager, "reattemptRequestRepository", requests);
        ReflectionTestUtils.setField(manager, "assessmentUserRegistrationRepository", registrations);
        ReflectionTestUtils.setField(manager, "assessmentRepository", mock(AssessmentRepository.class));
        ReflectionTestUtils.setField(manager, "assessmentWorkflowEventPublisher", events);
        ReflectionTestUtils.setField(manager, "assessmentParticipantsManager", participants);
        ReflectionTestUtils.setField(manager, "questionMappingRepository", questions);

        when(requests.save(any(AssessmentReattemptRequest.class))).thenAnswer(inv -> inv.getArgument(0));
        when(requests.findByAssessmentIdAndUserIdOrderByCreatedAtDesc(ASSESSMENT, LEARNER)).thenReturn(List.of());
    }

    // ------------------------------------------------------------------ problem report

    @Test
    void problemReportKeepsAQuestionOfThisAssessmentAndFiresNoReattemptEvent() {
        when(questions.existsBySection_Assessment_IdAndQuestion_Id(ASSESSMENT, "q-5")).thenReturn(true);

        ReattemptRequestDto created = manager.createRequest(learner(), report("q-5", "Image does not load"));

        assertThat(created.getRequestType()).isEqualTo("PROBLEM_REPORT");
        assertThat(created.getQuestionId()).isEqualTo("q-5");
        assertThat(created.getStatus()).isEqualTo("PENDING");
        verify(events, never()).publishReattemptRequested(any(), any(), any());
    }

    @Test
    void problemReportOnAQuestionFromElsewhereIsSavedWithoutTheQuestion() {
        when(questions.existsBySection_Assessment_IdAndQuestion_Id(ASSESSMENT, "q-other")).thenReturn(false);

        ReattemptRequestDto created = manager.createRequest(learner(), report("q-other", "Wrong options"));

        assertThat(created.getQuestionId()).isNull();
        assertThat(created.getReason()).isEqualTo("Wrong options");
    }

    @Test
    void oneOpenProblemReportPerQuestion() {
        when(questions.existsBySection_Assessment_IdAndQuestion_Id(eq(ASSESSMENT), anyString())).thenReturn(true);
        AssessmentReattemptRequest open = pending("req-open", "PROBLEM_REPORT");
        open.setQuestionId("q-5");
        open.setReason("first report");
        when(requests.findByAssessmentIdAndUserIdOrderByCreatedAtDesc(ASSESSMENT, LEARNER)).thenReturn(List.of(open));

        ReattemptRequestDto again = manager.createRequest(learner(), report("q-5", "second report"));
        assertThat(again.getId()).isEqualTo("req-open");
        assertThat(again.getReason()).isEqualTo("first report");

        ReattemptRequestDto other = manager.createRequest(learner(), report("q-6", "another question"));
        assertThat(other.getId()).isNull(); // a new row (the id is generated on insert)
        assertThat(other.getQuestionId()).isEqualTo("q-6");
    }

    @Test
    void problemReportIsClosedAsResolved() {
        AssessmentReattemptRequest report = pending("req-1", "PROBLEM_REPORT");
        when(requests.findById("req-1")).thenReturn(Optional.of(report));

        ReattemptRequestDto resolved = manager.review(admin(), "req-1", INSTITUTE, review("resolved", null));
        assertThat(resolved.getStatus()).isEqualTo("RESOLVED");
        assertThat(resolved.getGrantedCount()).isNull();
        verify(participants, never()).provideReattempt(any(), anyString(), anyString(), any());
    }

    @Test
    void anOlderAdminPagesApproveOrRejectOnAReportJustClosesIt() {
        for (String action : new String[] {"APPROVED", "REJECTED"}) {
            AssessmentReattemptRequest report = pending("req-" + action, "PROBLEM_REPORT");
            when(requests.findById("req-" + action)).thenReturn(Optional.of(report));

            ReattemptRequestDto closed = manager.review(admin(), "req-" + action, INSTITUTE, review(action, null));

            assertThat(closed.getStatus()).isEqualTo("RESOLVED");
        }
        verify(participants, never()).provideReattempt(any(), anyString(), anyString(), any());
    }

    @Test
    void aReportCannotTakeAnUnknownStatus() {
        when(requests.findById("req-1")).thenReturn(Optional.of(pending("req-1", "PROBLEM_REPORT")));

        assertThatThrownBy(() -> manager.review(admin(), "req-1", INSTITUTE, review("PENDING", null)))
                .isInstanceOf(VacademyException.class)
                .hasMessageContaining("RESOLVED");
    }

    @Test
    void reattemptAndTimeRequestsCannotBeResolved() {
        when(requests.findById("req-1")).thenReturn(Optional.of(pending("req-1", "TIME_INCREASE")));

        assertThatThrownBy(() -> manager.review(admin(), "req-1", INSTITUTE, review("RESOLVED", null)))
                .isInstanceOf(VacademyException.class)
                .hasMessageContaining("APPROVED or REJECTED");
    }

    // ------------------------------------------------------------------ admin inbox

    @Test
    void inboxShowsWhereTheReportedQuestionSits() {
        AssessmentReattemptRequest report = pending("req-1", "PROBLEM_REPORT");
        report.setQuestionId("q-5");
        when(requests.findForAdmin(eq(INSTITUTE), eq(ASSESSMENT), any(), eq(List.of("PROBLEM_REPORT")), any(Pageable.class)))
                .thenReturn(new PageImpl<>(List.of(report)));
        QuestionAssessmentSectionMappingRepository.ReportedQuestionRow row =
                mock(QuestionAssessmentSectionMappingRepository.ReportedQuestionRow.class);
        when(row.getAssessmentId()).thenReturn(ASSESSMENT);
        when(row.getQuestionId()).thenReturn("q-5");
        when(row.getSectionName()).thenReturn("Physics");
        when(row.getQuestionNumber()).thenReturn(5);
        when(row.getQuestionHtml()).thenReturn("<p>Find the <b>speed</b> of the block.</p><img src=\"x.png\">");
        when(questions.findReportedQuestions(List.of(ASSESSMENT), List.of("q-5"))).thenReturn(List.of(row));

        ReattemptRequestDto listed = manager
                .listForAdmin(INSTITUTE, ASSESSMENT, null, List.of(" problem_report "), 0, 25)
                .getContent().get(0);

        assertThat(listed.getQuestionSectionName()).isEqualTo("Physics");
        assertThat(listed.getQuestionNumber()).isEqualTo(5);
        assertThat(listed.getQuestionText()).isEqualTo("Find the speed of the block.");
    }

    @Test
    void aFailedQuestionLookupStillListsTheRequests() {
        AssessmentReattemptRequest report = pending("req-1", "PROBLEM_REPORT");
        report.setQuestionId("q-5");
        when(requests.findForAdmin(eq(INSTITUTE), eq(ASSESSMENT), any(), any(), any(Pageable.class)))
                .thenReturn(new PageImpl<>(List.of(report)));
        when(questions.findReportedQuestions(anyList(), anyList())).thenThrow(new RuntimeException("db down"));

        List<ReattemptRequestDto> listed = manager.listForAdmin(INSTITUTE, ASSESSMENT, null, null, 0, 25).getContent();

        assertThat(listed).hasSize(1);
        assertThat(listed.get(0).getQuestionText()).isNull();
    }

    @Test
    void previewTextStripsMarkupAndShortensLongQuestions() {
        assertThat(QuestionTextPreview.of(null)).isNull();
        assertThat(QuestionTextPreview.of("<p><img src=\"a.png\"></p>")).isNull();
        String longText = "<p>" + "a".repeat(400) + "</p>";
        String preview = QuestionTextPreview.of(longText);
        assertThat(preview).hasSize(281).endsWith("…");
    }

    // ------------------------------------------------------------------ helpers

    private static CustomUserDetails learner() {
        CustomUserDetails user = mock(CustomUserDetails.class);
        when(user.getUserId()).thenReturn(LEARNER);
        return user;
    }

    private static CustomUserDetails admin() {
        CustomUserDetails user = mock(CustomUserDetails.class);
        when(user.getUserId()).thenReturn("admin-1");
        return user;
    }

    private static CreateReattemptRequestDto report(String questionId, String reason) {
        CreateReattemptRequestDto dto = new CreateReattemptRequestDto();
        dto.setAssessmentId(ASSESSMENT);
        dto.setInstituteId(INSTITUTE);
        dto.setRequestType("problem_report");
        dto.setReason(reason);
        dto.setAttemptId("att-1");
        dto.setQuestionId(questionId);
        return dto;
    }

    private static ReviewReattemptRequestDto review(String status, Integer minutes) {
        ReviewReattemptRequestDto dto = new ReviewReattemptRequestDto();
        dto.setStatus(status);
        return dto;
    }

    private static AssessmentReattemptRequest pending(String id, String type) {
        return AssessmentReattemptRequest.builder()
                .id(id)
                .assessmentId(ASSESSMENT)
                .instituteId(INSTITUTE)
                .userId(LEARNER)
                .requestType(type)
                .reason("please")
                .status("PENDING")
                .build();
    }
}
