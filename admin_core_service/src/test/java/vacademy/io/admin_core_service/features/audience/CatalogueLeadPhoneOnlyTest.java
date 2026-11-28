package vacademy.io.admin_core_service.features.audience;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.util.ReflectionTestUtils;
import vacademy.io.admin_core_service.features.audience.dto.CatalogueLeadRequestDTO;
import vacademy.io.admin_core_service.features.audience.entity.Audience;
import vacademy.io.admin_core_service.features.audience.entity.AudienceResponse;
import vacademy.io.admin_core_service.features.audience.repository.AudienceRepository;
import vacademy.io.admin_core_service.features.audience.repository.AudienceResponseRepository;
import vacademy.io.admin_core_service.features.audience.service.AudienceService;
import vacademy.io.admin_core_service.features.audience.service.PlaceholderEmailService;
import vacademy.io.admin_core_service.features.auth_service.service.AuthService;
import vacademy.io.admin_core_service.features.common.entity.CustomFieldValues;
import vacademy.io.admin_core_service.features.common.repository.CustomFieldValuesRepository;
import vacademy.io.common.auth.dto.UserDTO;
import vacademy.io.common.exceptions.VacademyException;

import java.lang.reflect.Field;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/**
 * submitCatalogueLead with allowPhoneOnly (the Site Assistant contact card): a phone-only lead is
 * stored through the pipeline's existing placeholder identity for the auth user, while the lead row
 * itself carries no email; the public catalogue form (allowPhoneOnly=false) still requires one.
 */
class CatalogueLeadPhoneOnlyTest {

    private AudienceService service;
    private AudienceResponseRepository responses;
    private AuthService auth;
    private CustomFieldValuesRepository values;

    @BeforeEach
    void setUp() throws Exception {
        service = new AudienceService();
        for (Field f : AudienceService.class.getDeclaredFields()) {
            if (f.isAnnotationPresent(Autowired.class) && !f.getType().isPrimitive()) {
                f.setAccessible(true);
                f.set(service, mock(f.getType()));
            }
        }
        PlaceholderEmailService placeholders = new PlaceholderEmailService();
        ReflectionTestUtils.setField(placeholders, "placeholderEmailDomain", "vacademy.com");
        ReflectionTestUtils.setField(service, "placeholderEmailService", placeholders);

        responses = (AudienceResponseRepository) get("audienceResponseRepository");
        auth = (AuthService) get("authService");
        values = (CustomFieldValuesRepository) get("customFieldValuesRepository");

        Audience audience = new Audience();
        audience.setId("aud-1");
        audience.setInstituteId("inst-1");
        audience.setStatus("ACTIVE");
        audience.setCampaignName("Website enquiries");
        when(((AudienceRepository) get("audienceRepository")).findById("aud-1")).thenReturn(Optional.of(audience));

        UserDTO user = new UserDTO();
        user.setId("user-1");
        when(auth.createUserFromAuthService(any(), eq("inst-1"), anyBoolean())).thenReturn(user);
        when(responses.save(any(AudienceResponse.class))).thenAnswer(inv -> {
            AudienceResponse r = inv.getArgument(0);
            r.setId("3f2b8c4e-1a2b-4c3d-9e8f-001122334455");
            return r;
        });
    }

    private Object get(String field) throws Exception {
        Field f = AudienceService.class.getDeclaredField(field);
        f.setAccessible(true);
        return f.get(service);
    }

    private static CatalogueLeadRequestDTO lead(String email, String phone) {
        return CatalogueLeadRequestDTO.builder()
                .instituteId("inst-1").audienceId("aud-1").sourceType("SITE_ASSISTANT").sourceId("conv-1")
                .fullName("Raj Singh").email(email).mobileNumber(phone)
                .customFieldValues(Map.of("lead_kind", "SALES"))
                .build();
    }

    @Test
    @SuppressWarnings("unchecked")
    void phoneOnlyLeadIsStoredWithoutAnEmailOnTheLead() {
        String id = service.submitCatalogueLead(lead(null, "+91 79998 73846"), true);
        assertEquals("3f2b8c4e-1a2b-4c3d-9e8f-001122334455", id);

        ArgumentCaptor<UserDTO> user = ArgumentCaptor.forClass(UserDTO.class);
        verify(auth).createUserFromAuthService(user.capture(), eq("inst-1"), eq(false));
        // The pipeline's own placeholder (as Meta/Google webhook leads use), never a made-up address.
        assertEquals("rajsingh917999873846@vacademy.com", user.getValue().getEmail());
        assertEquals("+91 79998 73846", user.getValue().getMobileNumber());

        ArgumentCaptor<AudienceResponse> saved = ArgumentCaptor.forClass(AudienceResponse.class);
        verify(responses).save(saved.capture());
        assertNull(saved.getValue().getParentEmail());
        assertEquals("SITE_ASSISTANT", saved.getValue().getSourceType());
        assertEquals("conv-1", saved.getValue().getSourceId());

        ArgumentCaptor<List<CustomFieldValues>> stored = ArgumentCaptor.forClass(List.class);
        verify(values).saveAll(stored.capture());
        List<String> keys = new ArrayList<>();
        for (CustomFieldValues v : stored.getValue()) keys.add(v.getCustomFieldId());
        assertTrue(keys.contains("phone"));
        assertTrue(keys.contains("lead_kind"));
        assertFalse(keys.contains("email"), "no email custom field for a phone-only lead");
    }

    @Test
    void theCatalogueFormStillRequiresAnEmail() {
        assertThrows(VacademyException.class, () -> service.submitCatalogueLead(lead(null, "+91 79998 73846")));
        assertThrows(VacademyException.class, () -> service.submitCatalogueLead(lead(null, null), true));
        verifyNoInteractions(auth);
    }

    @Test
    void anEmailLeadKeepsItsRealEmail() {
        service.submitCatalogueLead(lead("raj@example.com", null), true);
        ArgumentCaptor<UserDTO> user = ArgumentCaptor.forClass(UserDTO.class);
        verify(auth).createUserFromAuthService(user.capture(), eq("inst-1"), eq(false));
        assertEquals("raj@example.com", user.getValue().getEmail());
        ArgumentCaptor<AudienceResponse> saved = ArgumentCaptor.forClass(AudienceResponse.class);
        verify(responses).save(saved.capture());
        assertEquals("raj@example.com", saved.getValue().getParentEmail());
    }
}
