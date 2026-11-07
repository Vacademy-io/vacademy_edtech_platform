package vacademy.io.admin_core_service.features.audience;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.annotation.Autowired;
import vacademy.io.admin_core_service.features.audience.dto.ProcessedFormDataDTO;
import vacademy.io.admin_core_service.features.audience.entity.Audience;
import vacademy.io.admin_core_service.features.audience.entity.AudienceResponse;
import vacademy.io.admin_core_service.features.audience.repository.AudienceRepository;
import vacademy.io.admin_core_service.features.audience.repository.AudienceResponseRepository;
import vacademy.io.admin_core_service.features.audience.service.AudienceService;
import vacademy.io.admin_core_service.features.audience.service.LeadDedupSettingService;
import vacademy.io.admin_core_service.features.audience.service.LeadDeduplicationService;
import vacademy.io.admin_core_service.features.auth_service.service.AuthService;
import vacademy.io.admin_core_service.features.utm_attribution.service.UtmAttributionService;
import vacademy.io.common.auth.dto.UserDTO;

import java.lang.reflect.Field;
import java.util.Map;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/**
 * submitLeadFromFormWebhook stores an ad-platform lead's campaign: the campaign id as
 * audience_response.source_id (it used to be the constant "<VENDOR>_WEBHOOK") and the
 * utm_* metadata as a utm_attribution row — while untagged webhooks (Zoho, Meta) keep
 * the old marker and write no UTM row.
 */
class WebhookLeadCampaignAttributionTest {

    private AudienceService service;
    private AudienceResponseRepository responses;
    private UtmAttributionService utm;

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
        utm = (UtmAttributionService) get("utmAttributionService");

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

    private AudienceResponse submit(Map<String, String> metadata, String provider) {
        service.submitLeadFromFormWebhook("aud-1", ProcessedFormDataDTO.builder()
                .email("asha@example.com")
                .fullName("Asha Rao")
                .phone("+919876543210")
                .formFields(Map.of("campaign_id", "21345678901"))
                .metadata(metadata)
                .build(), provider);
        ArgumentCaptor<AudienceResponse> saved = ArgumentCaptor.forClass(AudienceResponse.class);
        verify(responses).save(saved.capture());
        return saved.getValue();
    }

    @Test
    void googleLeadCarriesItsCampaign() {
        AudienceResponse saved = submit(Map.of(
                "platform_lead_id", "lead-abc",
                "source_id", "21345678901",
                "utm_source", "google",
                "utm_medium", "lead_form",
                "utm_campaign", "21345678901",
                "utm_content", "20000000002"), "GOOGLE_LEAD_ADS");

        assertEquals("21345678901", saved.getSourceId());
        assertEquals("GOOGLE_LEAD_ADS", saved.getSourceType());
        verify(utm).record("inst-1", "user-1", "asha@example.com", "+919876543210", "AUDIENCE", "aud-1",
                Map.of("utm_source", "google", "utm_medium", "lead_form",
                        "utm_campaign", "21345678901", "utm_content", "20000000002"));
    }

    private static final Map<String, String> SECOND_CAMPAIGN = Map.of(
            "platform_lead_id", "lead-2",
            "source_id", "22180441198",
            "utm_source", "google",
            "utm_medium", "lead_form",
            "utm_campaign", "22180441198");
    private static final Map<String, String> SECOND_CAMPAIGN_UTM = Map.of(
            "utm_source", "google", "utm_medium", "lead_form", "utm_campaign", "22180441198");

    private void submitOnly(Map<String, String> metadata) {
        service.submitLeadFromFormWebhook("aud-1", ProcessedFormDataDTO.builder()
                .email("asha@example.com")
                .fullName("Asha Rao")
                .phone("+919876543210")
                .formFields(Map.of())
                .metadata(metadata)
                .build(), "GOOGLE_LEAD_ADS");
    }

    /** One lead form, several campaigns: a person already in the audience who comes back
     *  through a second campaign gets no new lead row, but must still count for it. */
    @Test
    void repeatLeadThroughAnotherCampaignKeepsThatCampaign() {
        when(responses.existsByAudienceIdAndUserId("aud-1", "user-1")).thenReturn(true);

        submitOnly(SECOND_CAMPAIGN);

        verify(responses, never()).save(any(AudienceResponse.class));
        verify(utm).record("inst-1", "user-1", "asha@example.com", "+919876543210", "AUDIENCE", "aud-1",
                SECOND_CAMPAIGN_UTM);
    }

    @Test
    void leadRejectedByInstituteDedupStillKeepsItsCampaign() throws Exception {
        when(((LeadDeduplicationService) get("leadDeduplicationService"))
                .checkDuplicate(eq("inst-1"), eq("aud-1"), any(), any()))
                .thenReturn(Optional.of(new LeadDeduplicationService.DuplicateMatch(
                        LeadDedupSettingService.DedupAction.REJECT, "Duplicate lead", null)));

        submitOnly(SECOND_CAMPAIGN);

        verify(responses, never()).save(any(AudienceResponse.class));
        // No account is created on a REJECT, so the touch is keyed on the typed contact.
        verify(utm).record("inst-1", null, "asha@example.com", "+919876543210", "AUDIENCE", "aud-1",
                SECOND_CAMPAIGN_UTM);
    }

    @Test
    void untaggedWebhookKeepsTheOldMarkerAndWritesNoUtm() {
        AudienceResponse saved = submit(Map.of("platform_lead_id", "m-1", "is_test", "false"), "META_LEAD_ADS");

        assertEquals("META_LEAD_ADS_WEBHOOK", saved.getSourceId());
        verifyNoInteractions(utm);
    }

    @Test
    void nullMetadataIsTolerated() {
        AudienceResponse saved = submit(null, "ZOHO_FORMS");

        assertEquals("ZOHO_FORMS_WEBHOOK", saved.getSourceId());
        verifyNoInteractions(utm);
    }
}
