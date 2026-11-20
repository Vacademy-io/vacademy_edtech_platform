package vacademy.io.admin_core_service.features.product_config.service;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import vacademy.io.admin_core_service.features.audience.entity.Audience;
import vacademy.io.admin_core_service.features.audience.service.AudienceService;
import vacademy.io.admin_core_service.features.audience.service.AutoLeadListProvisioner;
import vacademy.io.admin_core_service.features.auth_service.service.AuthService;
import vacademy.io.admin_core_service.features.product_config.dto.ProductSettingsDTO;
import vacademy.io.admin_core_service.features.product_config.dto.SignupEventDTO;
import vacademy.io.admin_core_service.features.utm_attribution.service.UtmAttributionService;
import vacademy.io.common.auth.dto.UserDTO;
import vacademy.io.common.exceptions.VacademyException;

import java.sql.Timestamp;
import java.time.LocalDateTime;
import java.util.HashMap;
import java.util.List;
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
    private final AuthService authService = mock(AuthService.class);
    private final UtmAttributionService utmAttribution = mock(UtmAttributionService.class);
    private final ProductDemoLeadService service =
            new ProductDemoLeadService(products, provisioner, audienceService, jdbc, authService, utmAttribution);
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
        // No utm tags on the visit: nothing goes to the UTM record.
        verifyNoInteractions(utmAttribution);
    }

    @Test
    @SuppressWarnings("unchecked")
    void theVisitsUtmGoesToTheCrmUtmRecordOfTheLeadsUser() {
        when(jdbc.query(contains("audience_response"), any(RowMapper.class), eq("lead-1"), eq("list-1")))
                .thenReturn(List.of("user-9"));
        SignupEventDTO event = demo();
        event.setSource("website");
        event.setUtmSource(" instagram ");
        event.setUtmCampaign("launch");
        event.setUtmMedium(" ");
        assertEquals("lead-1", service.capture("evalezy", event));
        ArgumentCaptor<Map<String, String>> values = ArgumentCaptor.forClass(Map.class);
        verify(audienceService).submitLeadToAutoList(any(), any(), any(), any(), values.capture(), any(), any());
        // The Source field keeps the page; the tags go to the UTM record, keyed to the lead's user.
        assertEquals("website", values.getValue().get("f-Source"));
        verify(utmAttribution).record(CRM, "user-9", "asha@school.in", "919876543210", "AUDIENCE", "list-1",
                Map.of("utm_source", "instagram", "utm_campaign", "launch"));
    }

    @Test
    @SuppressWarnings("unchecked")
    void aRepeatSignUpTiesTheUtmToTheEmail() {
        when(audienceService.submitLeadToAutoList(any(), any(), any(), any(), any(), any(), any()))
                .thenReturn("You are already captured as a lead for this campaign");
        SignupEventDTO event = demo();
        event.setUtmSource("linkedin");
        service.capture("evalezy", event);
        // A sentence is not a lead id: no lookup is run for it.
        verify(jdbc, never()).query(contains("audience_response"), any(RowMapper.class), any(), any());
        verify(utmAttribution).record(CRM, null, "asha@school.in", "919876543210", "AUDIENCE", "list-1",
                Map.of("utm_source", "linkedin"));
    }

    @Test
    @SuppressWarnings("unchecked")
    void aUtmFailureLeavesTheCapturedLeadAsItIs() {
        when(jdbc.query(contains("audience_response"), any(RowMapper.class), any(), any()))
                .thenThrow(new RuntimeException("db down"));
        when(utmAttribution.record(any(), any(), any(), any(), any(), any(), any()))
                .thenThrow(new RuntimeException("tx failed"));
        SignupEventDTO event = demo();
        event.setUtmSource("instagram");
        assertEquals("lead-1", service.capture("evalezy", event));
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

    private Map<String, Object> institute(String email, String leadTag) {
        Map<String, Object> row = new HashMap<>();
        row.put("name", "Sunrise Academy");
        row.put("email", email);
        row.put("mobile_number", "910000000000");
        row.put("lead_tag", leadTag);
        row.put("demo_expires_at", Timestamp.valueOf(LocalDateTime.of(2026, 11, 22, 10, 6)));
        return row;
    }

    @Test
    void backfillAddsEarlierSignUpsFromTheInstituteAndItsOwner() {
        when(jdbc.queryForList(anyString(), eq("ws-9"), eq("evalezy")))
                .thenReturn(List.of(institute("owner@academy.in", "FREE_TRIAL")));
        UserDTO other = UserDTO.builder().fullName("Second Admin").email("x@academy.in").build();
        UserDTO owner = UserDTO.builder().fullName("Meera Rao").email("OWNER@academy.in")
                .mobileNumber("919999999999").build();
        when(authService.getUsersByInstituteAndRoles("ws-9", List.of("ADMIN"))).thenReturn(List.of(other, owner));

        List<Map<String, String>> out = service.backfill("evalezy", List.of("ws-9", " ws-9 "));

        assertEquals(1, out.size());
        assertEquals("lead-1", out.get(0).get("result"));
        assertEquals("owner@academy.in", out.get(0).get("email"));
        @SuppressWarnings("unchecked")
        ArgumentCaptor<Map<String, String>> values = ArgumentCaptor.forClass(Map.class);
        verify(audienceService).submitLeadToAutoList(eq(list), eq("Meera Rao"), eq("owner@academy.in"),
                eq("919999999999"), values.capture(), eq("PRODUCT_SIGNUP"), eq("ws-9"));
        assertEquals("ws-9", values.getValue().get("f-Workspace Id"));
        assertEquals("22 Nov 2026", values.getValue().get("f-Trial Ends"));
        assertEquals("Trial sign-up (added later)", values.getValue().get("f-Sign-up Method"));
        assertNull(values.getValue().get("f-Source"));
    }

    @Test
    void backfillFallsBackToTheInstituteWhenAuthHasNoOwner() {
        when(jdbc.queryForList(anyString(), eq("ws-9"), eq("evalezy")))
                .thenReturn(List.of(institute("owner@academy.in", "LEAD")));
        when(authService.getUsersByInstituteAndRoles(anyString(), any())).thenReturn(List.of());

        service.backfill("evalezy", List.of("ws-9"));

        @SuppressWarnings("unchecked")
        ArgumentCaptor<Map<String, String>> values = ArgumentCaptor.forClass(Map.class);
        verify(audienceService).submitLeadToAutoList(eq(list), eq("Sunrise Academy"), eq("owner@academy.in"),
                eq("910000000000"), values.capture(), eq("PRODUCT_SIGNUP"), eq("ws-9"));
        assertEquals("Buy (added later)", values.getValue().get("f-Sign-up Method"));
    }

    @Test
    void backfillLabelsAPaidOrManagedAccountAsASignUp() {
        when(jdbc.queryForList(anyString(), eq("ws-9"), eq("evalezy")))
                .thenReturn(List.of(institute("owner@academy.in", "PROD")));
        when(authService.getUsersByInstituteAndRoles(anyString(), any())).thenReturn(List.of());

        service.backfill("evalezy", List.of("ws-9"));

        @SuppressWarnings("unchecked")
        ArgumentCaptor<Map<String, String>> values = ArgumentCaptor.forClass(Map.class);
        verify(audienceService).submitLeadToAutoList(eq(list), any(), any(), any(), values.capture(),
                eq("PRODUCT_SIGNUP"), eq("ws-9"));
        assertEquals("Sign-up (added later)", values.getValue().get("f-Sign-up Method"));
    }

    @Test
    void backfillSkipsInstitutesOfOtherProducts() {
        when(jdbc.queryForList(anyString(), eq("other-ws"), eq("evalezy"))).thenReturn(List.of());

        List<Map<String, String>> out = service.backfill("evalezy", List.of("other-ws"));

        assertEquals("not a evalezy sign-up", out.get(0).get("result"));
        verifyNoInteractions(audienceService);
    }

    @Test
    void backfillNeedsIdsAndCapsTheBatch() {
        assertThrows(VacademyException.class, () -> service.backfill("evalezy", List.of()));
        assertThrows(VacademyException.class, () -> service.backfill("evalezy", null));
        List<String> tooMany = new java.util.ArrayList<>();
        for (int i = 0; i <= ProductDemoLeadService.MAX_BACKFILL; i++) tooMany.add("ws-" + i);
        assertThrows(VacademyException.class, () -> service.backfill("evalezy", tooMany));
        verifyNoInteractions(audienceService);
    }
}
