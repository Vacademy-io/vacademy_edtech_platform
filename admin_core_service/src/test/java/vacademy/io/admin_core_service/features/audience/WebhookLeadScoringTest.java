package vacademy.io.admin_core_service.features.audience;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.InOrder;
import org.springframework.beans.factory.annotation.Autowired;
import vacademy.io.admin_core_service.features.audience.dto.ProcessedFormDataDTO;
import vacademy.io.admin_core_service.features.audience.entity.Audience;
import vacademy.io.admin_core_service.features.audience.entity.AudienceResponse;
import vacademy.io.admin_core_service.features.audience.repository.AudienceRepository;
import vacademy.io.admin_core_service.features.audience.repository.AudienceResponseRepository;
import vacademy.io.admin_core_service.features.audience.service.AudienceService;
import vacademy.io.admin_core_service.features.audience.service.LeadScoringService;
import vacademy.io.admin_core_service.features.auth_service.service.AuthService;
import vacademy.io.admin_core_service.features.counselor_pool.service.CounselorAssignmentService;
import vacademy.io.admin_core_service.features.workflow.service.WorkflowTriggerService;
import vacademy.io.common.auth.dto.UserDTO;

import java.lang.reflect.Field;
import java.util.Map;
import java.util.Optional;

import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/**
 * Ad-platform webhook leads (Meta, Google, Zoho) are scored on intake like every other
 * intake path. The score is what creates the lead profile, so without it a lead the pool
 * doesn't assign shows no status, interest level or owner. Scoring stays best-effort: a
 * failure must never drop the lead or skip assignment / workflows.
 */
class WebhookLeadScoringTest {

    private AudienceService service;
    private AudienceResponseRepository responses;
    private LeadScoringService scoring;
    private CounselorAssignmentService pool;
    private WorkflowTriggerService workflows;

    @BeforeEach
    void setUp() throws Exception {
        service = new AudienceService();
        // Every collaborator a Mockito mock; the submit path tolerates their defaults.
        for (Field f : AudienceService.class.getDeclaredFields()) {
            if (f.isAnnotationPresent(Autowired.class) && !f.getType().isPrimitive()) {
                f.setAccessible(true);
                f.set(service, mock(f.getType()));
            }
        }
        responses = (AudienceResponseRepository) get("audienceResponseRepository");
        scoring = (LeadScoringService) get("leadScoringService");
        pool = (CounselorAssignmentService) get("counselorAssignmentService");
        workflows = (WorkflowTriggerService) get("workflowTriggerService");

        Audience audience = new Audience();
        audience.setId("aud-1");
        audience.setInstituteId("inst-1");
        audience.setStatus("ACTIVE");
        audience.setCampaignName("NEET 2027");
        when(((AudienceRepository) get("audienceRepository")).findById("aud-1")).thenReturn(Optional.of(audience));

        UserDTO user = new UserDTO();
        user.setId("user-1");
        user.setEmail("asha@example.com");
        when(((AuthService) get("authService")).createUserFromAuthService(any(), eq("inst-1"), anyBoolean()))
                .thenReturn(user);
        when(responses.save(any(AudienceResponse.class))).thenAnswer(inv -> {
            AudienceResponse r = inv.getArgument(0);
            r.setId("resp-1");
            return r;
        });
    }

    private Object get(String field) throws Exception {
        Field f = AudienceService.class.getDeclaredField(field);
        f.setAccessible(true);
        return f.get(service);
    }

    private void submit(String provider) {
        service.submitLeadFromFormWebhook("aud-1", ProcessedFormDataDTO.builder()
                .email("asha@example.com")
                .fullName("Asha Rao")
                .phone("+919876543210")
                .formFields(Map.of())
                .metadata(Map.of("platform_lead_id", "lead-abc"))
                .build(), provider);
    }

    @Test
    void webhookLeadIsScoredBeforePoolAssignment() {
        submit("GOOGLE_LEAD_ADS");

        InOrder order = inOrder(scoring, pool);
        order.verify(scoring).calculateAndSaveScore("resp-1", "aud-1", "inst-1", "GOOGLE_LEAD_ADS", null);
        order.verify(pool).assignCounselorOnIntake("aud-1");
    }

    @Test
    void scoringFailureStillSavesAssignsAndTriggersWorkflows() {
        when(scoring.calculateAndSaveScore(any(), any(), any(), any(), any()))
                .thenThrow(new RuntimeException("scoring down"));

        submit("META_LEAD_ADS");

        verify(responses).save(any(AudienceResponse.class));
        verify(pool).assignCounselorOnIntake("aud-1");
        verify(workflows).handleTriggerEvents(eq("AUDIENCE_LEAD_SUBMISSION"), eq("aud-1"), eq("inst-1"), anyMap());
    }

    @Test
    void repeatSubmissionToTheSameListIsNotRescored() {
        when(responses.existsByAudienceIdAndUserId("aud-1", "user-1")).thenReturn(true);

        submit("GOOGLE_LEAD_ADS");

        verify(responses, never()).save(any(AudienceResponse.class));
        verifyNoInteractions(scoring);
    }
}
