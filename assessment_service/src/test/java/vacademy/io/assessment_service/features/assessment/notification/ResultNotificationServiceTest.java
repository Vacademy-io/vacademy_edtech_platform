package vacademy.io.assessment_service.features.assessment.notification;

import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import vacademy.io.assessment_service.features.assessment.entity.AssessmentUserRegistration;
import vacademy.io.assessment_service.features.assessment.entity.StudentAttempt;
import vacademy.io.assessment_service.features.client.AdminCoreServiceClient;
import vacademy.io.assessment_service.features.notification.dto.unified.UnifiedSendRequest;
import vacademy.io.assessment_service.features.notification.service.NotificationService;
import vacademy.io.common.media.service.FileService;
import vacademy.io.common.notification.dto.AttachmentNotificationDTO;

import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class ResultNotificationServiceTest {

    private final AdminCoreServiceClient adminCore = mock(AdminCoreServiceClient.class);
    private final NotificationService notifications = mock(NotificationService.class);
    private final FileService files = mock(FileService.class);
    private final ResultNotificationService service = new ResultNotificationService(adminCore, notifications, files);

    private static StudentAttempt attempt(String id, String email, String phone, String fileId) {
        AssessmentUserRegistration reg = new AssessmentUserRegistration();
        reg.setUserId("u-" + id);
        reg.setUserEmail(email);
        reg.setPhoneNumber(phone);
        reg.setParticipantName("Riya Verma");
        StudentAttempt a = new StudentAttempt();
        a.setId(id);
        a.setRegistration(reg);
        a.setReportPdfFileId(fileId);
        return a;
    }

    private static final Map<String, String> VARS = Map.of("student_name", "Riya Verma", "score", "70",
            "max_score", "100", "scholarship_percent", "70", "assessment_name", "UnlockX - Class 10");

    @Test
    void emailUsesTheBoundTemplateAndCarriesEveryReportValue() {
        var templates = new ResultNotificationService.Templates(
                Map.of("name", "UnlockX result", "subject", "Result: {{assessment_name}}", "content", "<p>Hi {{student_name}}, {{scholarship_percent}}%</p>"),
                null);
        service.sendEmails(List.of(new ResultNotificationService.Item(attempt("a1", "r@x.com", null, null), new byte[]{1, 2}, VARS)),
                "as1", "inst", templates);
        ArgumentCaptor<AttachmentNotificationDTO> dto = ArgumentCaptor.forClass(AttachmentNotificationDTO.class);
        verify(notifications).sendAttachmentEmailToUsers(dto.capture(), eq("inst"));
        assertThat(dto.getValue().getSubject()).isEqualTo("Result: {{assessment_name}}");
        assertThat(dto.getValue().getBody()).contains("{{scholarship_percent}}");
        var user = dto.getValue().getUsers().get(0);
        assertThat(user.getPlaceholders()).containsEntry("scholarship_percent", "70").containsEntry("learner_name", "Riya Verma");
        assertThat(user.getAttachments().get(0).getAttachmentName()).isEqualTo("UnlockX - Class 10.pdf");
    }

    @Test
    void emailFallsBackToTheBuiltInBodyWhenNothingIsBound() {
        service.sendEmails(List.of(new ResultNotificationService.Item(attempt("a1", "r@x.com", null, null), new byte[]{1}, VARS)),
                "as1", "inst", new ResultNotificationService.Templates(null, null));
        ArgumentCaptor<AttachmentNotificationDTO> dto = ArgumentCaptor.forClass(AttachmentNotificationDTO.class);
        verify(notifications).sendAttachmentEmailToUsers(dto.capture(), eq("inst"));
        assertThat(dto.getValue().getBody()).isNotBlank();
    }

    @Test
    void whatsAppSendsTheReportAsADocumentAndSkipsLearnersItCannotReach() {
        when(files.getPublicUrlForFileId("f1")).thenReturn("https://cdn/report_a1.pdf");
        when(notifications.sendWhatsAppTemplate(any(), any(), any(), any(), any(), any(), any())).thenReturn(true);
        var templates = new ResultNotificationService.Templates(null,
                Map.of("name", "unlockx_result_letter", "setting_json", "{\"language_code\":\"en\"}"));
        int sent = service.sendWhatsApps(List.of(
                new ResultNotificationService.Item(attempt("a1", null, "919999999999", "f1"), null, VARS),
                new ResultNotificationService.Item(attempt("a2", null, null, "f2"), null, VARS),          // no phone
                new ResultNotificationService.Item(attempt("a3", null, "918888888888", null), null, VARS)), // no stored report
                "as1", "inst", templates);
        assertThat(sent).isEqualTo(1);
        @SuppressWarnings("unchecked")
        ArgumentCaptor<List<UnifiedSendRequest.Recipient>> rs = ArgumentCaptor.forClass(List.class);
        verify(notifications).sendWhatsAppTemplate(eq("inst"), eq("unlockx_result_letter"), eq("en"), rs.capture(),
                eq("document"), eq("ASSESSMENT_REPORT"), eq("as1"));
        assertThat(rs.getValue()).hasSize(1);
        assertThat(rs.getValue().get(0).getVariables()).containsEntry("_headerUrl", "https://cdn/report_a1.pdf");
    }

    @Test
    void noWhatsAppTemplateMeansNoWhatsApp() {
        int sent = service.sendWhatsApps(List.of(new ResultNotificationService.Item(attempt("a1", null, "919999999999", "f1"), null, VARS)),
                "as1", "inst", new ResultNotificationService.Templates(null, null));
        assertThat(sent).isZero();
        verifyNoInteractions(notifications);
    }
}
