package vacademy.io.admin_core_service.features.product_config.service;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.jdbc.core.JdbcTemplate;
import vacademy.io.admin_core_service.features.audience.entity.Audience;
import vacademy.io.admin_core_service.features.audience.service.AudienceService;
import vacademy.io.admin_core_service.features.audience.service.AutoLeadListProvisioner;
import vacademy.io.admin_core_service.features.product_config.dto.ProductSettingsDTO;
import vacademy.io.admin_core_service.features.product_config.dto.SignupEventDTO;

import java.util.Map;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class ProductDemoLeadServiceTest {

    private static final String CRM = "crm-institute-1";

    private final PlatformProductService products = mock(PlatformProductService.class);
    private final AutoLeadListProvisioner provisioner = mock(AutoLeadListProvisioner.class);
    private final AudienceService audienceService = mock(AudienceService.class);
    private final JdbcTemplate jdbc = mock(JdbcTemplate.class);
    private final ProductDemoLeadService service =
            new ProductDemoLeadService(products, provisioner, audienceService, jdbc);
    private final Audience list = Audience.builder().id("list-1").instituteId(CRM).status("ACTIVE").build();

    private static ProductSettingsDTO evalezy(String crm) {
        return ProductSettingsDTO.builder().productKey("evalezy").displayName("Evalezy").demoLeadsInstituteId(crm).build();
    }

    private static SignupEventDTO demo() {
        return SignupEventDTO.builder().instituteId("ws-1").fullName("Asha Verma").email("asha@school.in")
                .phone("919876543210").method("Demo portal").trialEnds("17 Nov 2026").source("hero").build();
    }

    @BeforeEach
    void setUp() {
        when(products.find("evalezy")).thenReturn(Optional.of(evalezy(CRM)));
        when(jdbc.queryForObject(anyString(), eq(Integer.class), any())).thenReturn(1);
        when(provisioner.getOrCreateNamed(anyString(), anyString(), anyString(), anyString(), anyString())).thenReturn(list);
        when(provisioner.ensureField(anyString(), anyString(), anyString(), anyInt()))
                .thenAnswer(inv -> "f-" + inv.getArgument(2, String.class));
        when(audienceService.submitLeadToAutoList(any(), any(), any(), any(), any(), any(), any())).thenReturn("lead-1");
    }

    @Test
    void theListIsNamedForTheProduct() {
        assertEquals("Product Evalezy ( Instant - Demo )", ProductDemoLeadService.listName(evalezy(CRM)));
        ProductSettingsDTO named = evalezy(CRM);
        named.setDemoLeadsListName(" My list ");
        assertEquals("My list", ProductDemoLeadService.listName(named));
    }

    @Test
    void aDemoSignUpBecomesALeadInTheCrmList() {
        assertEquals("lead-1", service.capture("evalezy", demo()));
        verify(provisioner).getOrCreateNamed(eq(CRM), eq("Instant Demo"), eq("evalezy"),
                eq("Product Evalezy ( Instant - Demo )"), anyString());
        @SuppressWarnings("unchecked")
        ArgumentCaptor<Map<String, String>> values = ArgumentCaptor.forClass(Map.class);
        verify(audienceService).submitLeadToAutoList(eq(list), eq("Asha Verma"), eq("asha@school.in"),
                eq("919876543210"), values.capture(), eq("PRODUCT_DEMO"), eq("ws-1"));
        assertEquals("ws-1", values.getValue().get("f-Workspace Id"));
        assertEquals("17 Nov 2026", values.getValue().get("f-Trial Ends"));
        assertEquals("hero", values.getValue().get("f-Source"));
        assertEquals("Demo portal", values.getValue().get("f-Sign-up Method"));
    }

    @Test
    void anOrdinaryTrialSignUpIsALeadToo() {
        for (String method : new String[] {"Email OTP", "Google"}) {
            SignupEventDTO trial = demo();
            trial.setEmail(method.replace(" ", "") + "@school.in");
            trial.setMethod(method);
            assertEquals("lead-1", service.capture("evalezy", trial));
            @SuppressWarnings("unchecked")
            ArgumentCaptor<Map<String, String>> values = ArgumentCaptor.forClass(Map.class);
            verify(audienceService).submitLeadToAutoList(eq(list), eq("Asha Verma"), eq(trial.getEmail()),
                    eq("919876543210"), values.capture(), eq("PRODUCT_SIGNUP"), eq("ws-1"));
            assertEquals(method, values.getValue().get("f-Sign-up Method"));
        }
    }

    @Test
    void aSignUpWithoutEmailIsNotALead() {
        SignupEventDTO noEmail = demo();
        noEmail.setEmail(" ");
        assertNull(service.capture("evalezy", noEmail));
        verifyNoInteractions(audienceService);
    }

    @Test
    void noInstituteSetMeansNoLead() {
        when(products.find("evalezy")).thenReturn(Optional.of(evalezy(null)));
        assertNull(service.capture("evalezy", demo()));
        verifyNoInteractions(audienceService, provisioner);
    }

    @Test
    void aPausedListIsLeftAlone() {
        list.setStatus("PAUSED");
        assertNull(service.capture("evalezy", demo()));
        verifyNoInteractions(audienceService);
    }

    @Test
    void aFailureNeverReachesTheSignUp() {
        when(audienceService.submitLeadToAutoList(any(), any(), any(), any(), any(), any(), any()))
                .thenThrow(new RuntimeException("db down"));
        assertNull(service.capture("evalezy", demo()));
    }

    @Test
    void manySignUpsAllGoToTheSameList() {
        for (String email : new String[] {"a@school.in", "b@school.in", "c@school.in"}) {
            SignupEventDTO e = demo();
            e.setEmail(email);
            service.capture("evalezy", e);
        }
        // Always the one key (CRM institute, "Instant Demo", product), and always the same list.
        verify(provisioner, times(3)).getOrCreateNamed(eq(CRM), eq("Instant Demo"), eq("evalezy"),
                eq("Product Evalezy ( Instant - Demo )"), anyString());
        verify(audienceService, times(3)).submitLeadToAutoList(same(list), any(), any(), any(), any(),
                eq("PRODUCT_DEMO"), any());
    }
}
