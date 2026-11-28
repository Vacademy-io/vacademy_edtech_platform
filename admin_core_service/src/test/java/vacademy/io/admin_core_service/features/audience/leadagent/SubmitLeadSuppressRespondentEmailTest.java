package vacademy.io.admin_core_service.features.audience.leadagent;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.annotation.Autowired;
import vacademy.io.admin_core_service.features.audience.dto.SubmitLeadRequestDTO;
import vacademy.io.admin_core_service.features.audience.entity.Audience;
import vacademy.io.admin_core_service.features.audience.entity.AudienceResponse;
import vacademy.io.admin_core_service.features.audience.repository.AudienceRepository;
import vacademy.io.admin_core_service.features.audience.repository.AudienceResponseRepository;
import vacademy.io.admin_core_service.features.audience.service.AudienceService;
import vacademy.io.admin_core_service.features.audience.service.LeadDeduplicationService;
import vacademy.io.admin_core_service.features.auth_service.service.AuthService;
import vacademy.io.admin_core_service.features.notification_service.service.NotificationService;
import vacademy.io.admin_core_service.features.workflow.entity.WorkflowTrigger;
import vacademy.io.admin_core_service.features.workflow.service.WorkflowTriggerService;
import vacademy.io.common.auth.dto.UserDTO;
import vacademy.io.common.notification.dto.GenericEmailRequest;

import java.lang.reflect.Field;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * SubmitLeadRequestDTO.suppressRespondentEmail (set by Lead Agent intake) drops only the
 * respondent "thank you" email: the AUDIENCE_LEAD_SUBMISSION workflow still fires and the
 * to_notify admin alert still goes out. Without the flag nothing changes.
 */
class SubmitLeadSuppressRespondentEmailTest {

    private AudienceService service;
    private WorkflowTriggerService workflows;
    private NotificationService notifications;

    @BeforeEach
    void setUp() throws Exception {
        service = new AudienceService();
        for (Field f : AudienceService.class.getDeclaredFields()) {
            if (f.isAnnotationPresent(Autowired.class) && !f.getType().isPrimitive()) {
                f.setAccessible(true);
                f.set(service, mock(f.getType()));
            }
        }
        workflows = (WorkflowTriggerService) get("workflowTriggerService");
        notifications = (NotificationService) get("notificationService");

        Audience audience = new Audience();
        audience.setId("aud-1");
        audience.setInstituteId("inst-1");
        audience.setStatus("ACTIVE");
        audience.setCampaignName("Outbound");
        audience.setToNotify("sales@vacademy.io");
        when(((AudienceRepository) get("audienceRepository")).findById("aud-1")).thenReturn(Optional.of(audience));

        UserDTO created = new UserDTO();
        created.setId("user-new");
        created.setEmail("founder@acme.in");
        created.setFullName("Aditya Patel");
        when(((AuthService) get("authService")).createUserFromAuthService(any(), eq("inst-1"), anyBoolean()))
                .thenReturn(created);
        when(((LeadDeduplicationService) get("leadDeduplicationService")).checkDuplicate(any(), any(), any(), any()))
                .thenReturn(Optional.empty());
        when(((AudienceResponseRepository) get("audienceResponseRepository")).save(any(AudienceResponse.class)))
                .thenAnswer(inv -> {
                    AudienceResponse r = inv.getArgument(0);
                    r.setId("resp-new");
                    return r;
                });
    }

    private Object get(String field) throws Exception {
        Field f = AudienceService.class.getDeclaredField(field);
        f.setAccessible(true);
        return f.get(service);
    }

    private String submit(boolean suppress) {
        UserDTO user = new UserDTO();
        user.setEmail("founder@acme.in");
        user.setFullName("Aditya Patel");
        user.setMobileNumber("+919009335533");
        return service.submitLead(SubmitLeadRequestDTO.builder()
                .audienceId("aud-1").sourceType("LEAD_AGENT").sourceId("acme.in")
                .userDTO(user).suppressRespondentEmail(suppress).build());
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> workflowContext() {
        ArgumentCaptor<Map<String, Object>> ctx = ArgumentCaptor.forClass(Map.class);
        verify(workflows).handleTriggerEvents(eq("AUDIENCE_LEAD_SUBMISSION"), eq("aud-1"), eq("inst-1"),
                ctx.capture());
        return ctx.getValue();
    }

    private List<String> mailedTo() {
        ArgumentCaptor<GenericEmailRequest> mail = ArgumentCaptor.forClass(GenericEmailRequest.class);
        verify(notifications, org.mockito.Mockito.atLeast(0)).sendGenericHtmlMailViaUnified(mail.capture(), anyString());
        return mail.getAllValues().stream().map(GenericEmailRequest::getTo).toList();
    }

    @Test
    void workflowPathStillFiresButCarriesNoRespondentEmail() {
        when(workflows.findByInstituteIdEventNameAndEventId("inst-1", "AUDIENCE_LEAD_SUBMISSION", "aud-1"))
                .thenReturn(Optional.of(new WorkflowTrigger()));

        assertThat(submit(true)).isEqualTo("resp-new");

        Map<String, Object> ctx = workflowContext();
        assertThat(ctx.get("sendRespondentEmail")).isEqualTo(false);
        assertThat((List<?>) ctx.get("respondentEmailRequests")).isEmpty();
        assertThat((List<?>) ctx.get("adminEmailRequests")).hasSize(1);
        // the workflow sends no admin email itself, so the to_notify alert goes out directly
        assertThat(mailedTo()).containsExactly("sales@vacademy.io");
    }

    @Test
    void workflowPathUnchangedWithoutTheFlag() {
        when(workflows.findByInstituteIdEventNameAndEventId("inst-1", "AUDIENCE_LEAD_SUBMISSION", "aud-1"))
                .thenReturn(Optional.of(new WorkflowTrigger()));

        submit(false);

        Map<String, Object> ctx = workflowContext();
        assertThat(ctx.get("sendRespondentEmail")).isEqualTo(true);
        assertThat((List<?>) ctx.get("respondentEmailRequests")).hasSize(1);
    }

    @Test
    void directPathSendsOnlyTheAdminAlert() {
        when(workflows.findByInstituteIdEventNameAndEventId(any(), any(), any())).thenReturn(Optional.empty());

        submit(true);

        assertThat(mailedTo()).containsExactly("sales@vacademy.io");
    }

    @Test
    void directPathStillThanksTheRespondentWithoutTheFlag() {
        when(workflows.findByInstituteIdEventNameAndEventId(any(), any(), any())).thenReturn(Optional.empty());

        submit(false);

        assertThat(mailedTo()).containsExactlyInAnyOrder("founder@acme.in", "sales@vacademy.io");
        verify(notifications, times(2)).sendGenericHtmlMailViaUnified(any(), anyString());
    }
}
