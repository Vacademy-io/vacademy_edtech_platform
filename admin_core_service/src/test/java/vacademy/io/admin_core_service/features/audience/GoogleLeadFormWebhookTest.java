package vacademy.io.admin_core_service.features.audience;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.http.ResponseEntity;
import org.springframework.test.util.ReflectionTestUtils;
import vacademy.io.admin_core_service.core.security.InstituteAccessValidator;
import vacademy.io.admin_core_service.features.audience.controller.MetaOAuthController;
import vacademy.io.admin_core_service.features.audience.dto.AdConnectorSetupRequest;
import vacademy.io.admin_core_service.features.audience.dto.ConnectorUpdateRequest;
import vacademy.io.admin_core_service.features.audience.dto.NormalizedLeadData;
import vacademy.io.admin_core_service.features.audience.dto.ProcessedFormDataDTO;
import vacademy.io.admin_core_service.features.audience.entity.Audience;
import vacademy.io.admin_core_service.features.audience.entity.FormWebhookConnector;
import vacademy.io.admin_core_service.features.audience.repository.AudienceRepository;
import vacademy.io.admin_core_service.features.audience.repository.FormWebhookConnectorRepository;
import vacademy.io.admin_core_service.features.audience.repository.AdCampaignRouteRepository;
import vacademy.io.admin_core_service.features.audience.service.AdCampaignRouteService;
import vacademy.io.admin_core_service.features.audience.service.AdPlatformWebhookService;
import vacademy.io.admin_core_service.features.audience.service.AudienceService;
import vacademy.io.admin_core_service.features.audience.service.LeadEnricher;
import vacademy.io.admin_core_service.features.audience.strategy.GoogleLeadFormStrategy;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.ForbiddenException;
import vacademy.io.common.exceptions.VacademyException;

import java.util.Map;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/**
 * Google Lead Form webhook + connector setup.
 *
 * Before this, the webhook answered 200 before looking at the key, ignored the
 * payload's google_key, saved Google's test leads as real leads, and dropped the
 * campaign id; and saving a connector matched the key across ALL institutes, so
 * anyone who saved another institute's key took over its connector and its leads.
 */
class GoogleLeadFormWebhookTest {

    private static final String KEY = "Zk3vQp9LmN2xR7tY4wB8cD1eF6gH0jKs";
    private static final String INSTITUTE = "inst-1";
    private static final String AUDIENCE = "aud-1";

    private final ObjectMapper mapper = new ObjectMapper();
    private final GoogleLeadFormStrategy strategy = new GoogleLeadFormStrategy(mapper);

    private static FormWebhookConnector connector() {
        FormWebhookConnector c = new FormWebhookConnector();
        c.setId("conn-1");
        c.setVendor("GOOGLE_LEAD_ADS");
        c.setVendorId(KEY);
        c.setInstituteId(INSTITUTE);
        c.setAudienceId(AUDIENCE);
        return c;
    }

    /** Google's documented payload shape: the ids are JSON integers, not strings. */
    private static String payload(String googleKey, boolean isTest) {
        return "{"
                + "\"lead_id\":\"lead-abc\","
                + (googleKey == null ? "" : "\"google_key\":\"" + googleKey + "\",")
                + "\"api_version\":\"1.0\","
                + "\"form_id\":40000000001,"
                + "\"campaign_id\":21345678901,"
                + "\"adgroup_id\":20000000002,"
                + "\"creative_id\":30000000003,"
                + "\"gcl_id\":\"gclid-xyz\","
                + "\"is_test\":" + isTest + ","
                + "\"user_column_data\":["
                + "{\"column_id\":\"FULL_NAME\",\"string_value\":\"Asha Rao\"},"
                + "{\"column_id\":\"EMAIL\",\"string_value\":\"asha@example.com\"},"
                + "{\"column_id\":\"PHONE_NUMBER\",\"string_value\":\"+919876543210\"}"
                + "]}";
    }

    @Nested
    @DisplayName("strategy: payload → lead")
    class Strategy {

        @Test
        void readsNumericCampaignIdAndBuildsUtm() {
            NormalizedLeadData lead = strategy.extractAndFetchLeads(payload(KEY, false), connector()).get(0);

            assertEquals("21345678901", lead.getCampaignId());
            assertEquals("lead-abc", lead.getPlatformLeadId());
            assertEquals("asha@example.com", lead.getEmail());
            assertEquals(Map.of(
                    "utm_source", "google",
                    "utm_medium", "lead_form",
                    "utm_campaign", "21345678901",
                    "utm_content", "20000000002"), lead.getUtmParams());
            assertEquals("40000000001", lead.getFields().get("form_id"));
            assertEquals("gclid-xyz", lead.getFields().get("gcl_id"));
        }

        @Test
        void adContextSurvivesADiscardingFieldMapping() {
            FormWebhookConnector c = connector();
            c.setFieldMappingJson("{\"mappings\":[{\"platform_key\":\"email\",\"target\":\"STANDARD:email\"}],"
                    + "\"unmapped_field_action\":\"DISCARD\"}");

            Map<String, String> fields = strategy.extractAndFetchLeads(payload(KEY, false), c).get(0).getFields();

            assertEquals("21345678901", fields.get("campaign_id"));
            assertNull(fields.get("full_name"), "unmapped form answers are still discarded");
        }

        @Test
        void zeroIdsAndMissingCampaignMeanNoAttribution() {
            String body = "{\"lead_id\":\"l\",\"campaign_id\":0,\"asset_group_id\":0,\"user_column_data\":[]}";
            NormalizedLeadData lead = strategy.extractAndFetchLeads(body, connector()).get(0);

            assertNull(lead.getCampaignId());
            assertTrue(lead.getUtmParams().isEmpty());
            assertFalse(lead.getFields().containsKey("asset_group_id"));
        }

        @Test
        void googleKeyMustBePresentAndEqual() throws Exception {
            assertTrue(strategy.googleKeyMatches(mapper.readTree(payload(KEY, false)), KEY));
            assertFalse(strategy.googleKeyMatches(mapper.readTree(payload("wrong", false)), KEY));
            assertFalse(strategy.googleKeyMatches(mapper.readTree(payload(null, false)), KEY));
        }
    }

    @Nested
    @DisplayName("webhook: status tells Google the truth")
    class Webhook {

        private AdPlatformWebhookService service;
        private FormWebhookConnectorRepository repo;
        private AudienceService audienceService;
        private AdCampaignRouteService routes;

        @BeforeEach
        void setUp() {
            service = new AdPlatformWebhookService();
            repo = mock(FormWebhookConnectorRepository.class);
            audienceService = mock(AudienceService.class);
            routes = mock(AdCampaignRouteService.class);
            when(routes.decide(any(), any())).thenReturn(new AdCampaignRouteService.RouteDecision(null, null));
            ReflectionTestUtils.setField(service, "campaignRouteService", routes);
            ReflectionTestUtils.setField(service, "connectorRepository", repo);
            ReflectionTestUtils.setField(service, "audienceService", audienceService);
            ReflectionTestUtils.setField(service, "objectMapper", mapper);
            ReflectionTestUtils.setField(service, "googleLeadFormStrategy", strategy);
            ReflectionTestUtils.setField(service, "leadEnricher", mock(LeadEnricher.class));
            when(repo.findFirstByVendorAndVendorIdAndIsActiveTrueOrderByUpdatedAtDesc("GOOGLE_LEAD_ADS", KEY))
                    .thenReturn(Optional.of(connector()));
        }

        @Test
        void unknownKeyIs404AndNotRetried() {
            assertEquals(404, service.handleGoogleWebhook("nope", payload("nope", false)).status());
            verifyNoInteractions(audienceService);
            verify(repo, never()).updateDeliveryStatus(any(), any(), any(), any());
        }

        @Test
        void unreadableBodyIs400() {
            assertEquals(400, service.handleGoogleWebhook(KEY, "not json").status());
            assertEquals(400, service.handleGoogleWebhook(KEY, "[1,2]").status());
        }

        @Test
        void wrongOrMissingGoogleKeyIs401() {
            assertEquals(401, service.handleGoogleWebhook(KEY, payload("someone-elses-key", false)).status());
            assertEquals(401, service.handleGoogleWebhook(KEY, payload(null, false)).status());
            verifyNoInteractions(audienceService);
            // The admin's Setup & status view says why Google's test failed.
            verify(repo, times(2)).updateDeliveryStatus(eq("conn-1"), any(), eq("ACTION_REQUIRED"),
                    contains("Key on the Google Ads lead form does not match"));
        }

        @Test
        void testLeadIsAcknowledgedButNotSaved() {
            assertEquals(200, service.handleGoogleWebhook(KEY, payload(KEY, true)).status());
            verifyNoInteractions(audienceService);
            verify(repo).updateDeliveryStatus(eq("conn-1"), any(), eq("ACTIVE"), isNull());
        }

        @Test
        void aFailedStatusWriteDoesNotChangeTheAnswer() {
            doThrow(new RuntimeException("db down")).when(repo).updateDeliveryStatus(any(), any(), any(), any());

            assertEquals(200, service.handleGoogleWebhook(KEY, payload(KEY, true)).status());
        }

        @Test
        void realLeadIsSavedWithCampaignAttribution() {
            assertEquals(200, service.handleGoogleWebhook(KEY, payload(KEY, false)).status());

            ArgumentCaptor<ProcessedFormDataDTO> data = ArgumentCaptor.forClass(ProcessedFormDataDTO.class);
            verify(audienceService).submitLeadFromFormWebhook(eq(AUDIENCE), data.capture(), eq("GOOGLE_LEAD_ADS"));
            Map<String, String> metadata = data.getValue().getMetadata();
            assertEquals("21345678901", metadata.get("source_id"));
            assertEquals("google", metadata.get("utm_source"));
            assertEquals("lead_form", metadata.get("utm_medium"));
            assertEquals("21345678901", metadata.get("utm_campaign"));
            assertEquals("lead-abc", metadata.get("platform_lead_id"));
            assertEquals("21345678901", data.getValue().getFormFields().get("campaign_id"));
            verify(repo).updateDeliveryStatus(eq("conn-1"), any(), eq("ACTIVE"), isNull());
        }

        /** One lead form, several campaigns: a mapped campaign's lead goes to its own list. */
        @Test
        void mappedCampaignLeadGoesToItsList() {
            when(routes.decide(any(), eq("21345678901")))
                    .thenReturn(new AdCampaignRouteService.RouteDecision("aud-pune-mbbs", null));

            assertEquals(200, service.handleGoogleWebhook(KEY, payload(KEY, false)).status());

            verify(audienceService).submitLeadFromFormWebhook(eq("aud-pune-mbbs"), any(), eq("GOOGLE_LEAD_ADS"));
            verify(routes).recordLead(any(), eq("21345678901"));
            verify(repo).updateDeliveryStatus(eq("conn-1"), any(), eq("ACTIVE"), isNull());
        }

        /** A campaign routed to a deleted/inactive list still lands (catch-all), and the admin is told. */
        @Test
        void campaignRoutedToADeadListFallsBackAndFlagsTheConnector() {
            when(routes.decide(any(), eq("21345678901")))
                    .thenReturn(new AdCampaignRouteService.RouteDecision(null, "aud-deleted"));

            assertEquals(200, service.handleGoogleWebhook(KEY, payload(KEY, false)).status());

            verify(audienceService).submitLeadFromFormWebhook(eq(AUDIENCE), any(), eq("GOOGLE_LEAD_ADS"));
            verify(repo).updateDeliveryStatus(eq("conn-1"), any(), eq("ACTION_REQUIRED"),
                    contains("Campaign 21345678901 is routed to a list that was deleted"));
        }

        @Test
        void autoListsOffNeverTouchesTheCampaignsList() {
            service.handleGoogleWebhook(KEY, payload(KEY, false));
            verify(routes, never()).ensureAutoList(any(), any());
            verify(audienceService).submitLeadFromFormWebhook(eq(AUDIENCE), any(), eq("GOOGLE_LEAD_ADS"));
        }

        /** Auto lists on: the campaign's list is made before routing, and a failure there never loses the lead. */
        @Test
        void aFailedAutoListStillSavesTheLeadToTheCatchAll() {
            when(routes.autoCreatesLists(any())).thenReturn(true);
            doThrow(new RuntimeException("db down")).when(routes).ensureAutoList(any(), any());

            assertEquals(200, service.handleGoogleWebhook(KEY, payload(KEY, false)).status());

            verify(routes).ensureAutoList(any(), eq("21345678901"));
            verify(audienceService).submitLeadFromFormWebhook(eq(AUDIENCE), any(), eq("GOOGLE_LEAD_ADS"));
            verify(routes).recordLead(any(), eq("21345678901"));
        }

        @Test
        void aFailedLeadIsNotCountedForItsCampaign() {
            when(audienceService.submitLeadFromFormWebhook(any(), any(), any()))
                    .thenThrow(new VacademyException("boom"));

            service.handleGoogleWebhook(KEY, payload(KEY, false));

            verify(routes, never()).recordLead(any(), any());
        }

        @Test
        void ingestFailureIs500SoGoogleRetries() {
            when(audienceService.submitLeadFromFormWebhook(any(), any(), any()))
                    .thenThrow(new VacademyException("Audience campaign is not active"));

            assertEquals(500, service.handleGoogleWebhook(KEY, payload(KEY, false)).status());
            verify(repo).updateDeliveryStatus(eq("conn-1"), any(), eq("ACTION_REQUIRED"),
                    eq("Google delivered a lead but it could not be saved: Audience campaign is not active. "
                            + "Google will retry."));
        }
    }

    @Nested
    @DisplayName("connector save: key + tenant scope")
    class Save {

        private MetaOAuthController controller;
        private FormWebhookConnectorRepository repo;
        private AudienceRepository audiences;
        private InstituteAccessValidator validator;
        private AdPlatformWebhookService webhookService;
        private final CustomUserDetails user = new CustomUserDetails();

        @BeforeEach
        void setUp() {
            repo = mock(FormWebhookConnectorRepository.class);
            audiences = mock(AudienceRepository.class);
            validator = mock(InstituteAccessValidator.class);
            webhookService = mock(AdPlatformWebhookService.class);
            controller = new MetaOAuthController(null, webhookService, null, null, repo, null, null,
                    mapper, validator, audiences, mock(AdCampaignRouteService.class),
                    mock(AdCampaignRouteRepository.class));
            Audience own = new Audience();
            own.setId(AUDIENCE);
            own.setInstituteId(INSTITUTE);
            when(audiences.findById(AUDIENCE)).thenReturn(Optional.of(own));
            when(webhookService.saveConnector(any(), isNull())).thenAnswer(inv -> {
                FormWebhookConnector c = inv.getArgument(0);
                c.setId("conn-new");
                return c;
            });
        }

        private AdConnectorSetupRequest request(String googleKey) {
            AdConnectorSetupRequest r = new AdConnectorSetupRequest();
            r.setInstituteId(INSTITUTE);
            r.setAudienceId(AUDIENCE);
            r.setGoogleKey(googleKey);
            return r;
        }

        @Test
        void generatesAStrongKeyWhenNoneIsGiven() {
            ResponseEntity<Map<String, String>> res = controller.saveGoogleConnector(request(null), user);

            String key = res.getBody().get("google_key");
            assertTrue(key.matches("^[A-Za-z0-9_-]{32}$"), key);
            assertEquals("/admin-core-service/api/v1/webhook/google/" + key, res.getBody().get("webhook_url"));
            ArgumentCaptor<FormWebhookConnector> saved = ArgumentCaptor.forClass(FormWebhookConnector.class);
            verify(webhookService).saveConnector(saved.capture(), isNull());
            assertEquals(key, saved.getValue().getVendorId());
            assertEquals(key, saved.getValue().getPlatformFormId());
            verify(validator).requireInstituteStaff(user, INSTITUTE);
        }

        @Test
        void storesTheNameTheListShowsInsteadOfTheKey() {
            AdConnectorSetupRequest r = request(null);
            r.setPlatformFormName("  Admissions lead form  ");

            controller.saveGoogleConnector(r, user);

            ArgumentCaptor<FormWebhookConnector> saved = ArgumentCaptor.forClass(FormWebhookConnector.class);
            verify(webhookService).saveConnector(saved.capture(), isNull());
            assertEquals("Admissions lead form", saved.getValue().getPlatformFormName());
        }

        @Test
        void renamingAConnectorLeavesItsDefaultsAlone() {
            FormWebhookConnector ours = connector();
            ours.setDefaultValuesJson("{\"center name\":\"Wakad\"}");
            when(repo.findById("conn-1")).thenReturn(Optional.of(ours));
            when(repo.save(any())).thenAnswer(inv -> inv.getArgument(0));
            ConnectorUpdateRequest rename = new ConnectorUpdateRequest();
            rename.setPlatformFormName("Pune campaigns form");

            controller.updateConnector("conn-1", rename, user);

            assertEquals("Pune campaigns form", ours.getPlatformFormName());
            assertEquals("{\"center name\":\"Wakad\"}", ours.getDefaultValuesJson());
            verify(validator).requireInstituteStaff(user, INSTITUTE);
        }

        @Test
        void rejectsAGuessableKey() {
            assertEquals(400, controller.saveGoogleConnector(request("my-leads-abc123"), user).getStatusCode().value());
            verify(webhookService, never()).saveConnector(any(), any());
        }

        @Test
        void anotherInstitutesKeyIsNotTakenOver() {
            FormWebhookConnector theirs = connector();
            theirs.setInstituteId("inst-OTHER");
            when(repo.findByVendorAndVendorId("GOOGLE_LEAD_ADS", KEY)).thenReturn(Optional.of(theirs));

            assertEquals(409, controller.saveGoogleConnector(request(KEY), user).getStatusCode().value());
            verify(webhookService, never()).saveConnector(any(), any());
            assertEquals("inst-OTHER", theirs.getInstituteId(), "their connector is untouched");
        }

        @Test
        void callerOutsideTheInstituteIsRefusedBeforeAnyWrite() {
            doThrow(new ForbiddenException("Access denied")).when(validator).requireInstituteStaff(user, INSTITUTE);

            assertThrows(ForbiddenException.class, () -> controller.saveGoogleConnector(request(null), user));
            verify(webhookService, never()).saveConnector(any(), any());
        }

        @Test
        void audienceFromAnotherInstituteIsRefused() {
            Audience foreign = new Audience();
            foreign.setId("aud-foreign");
            foreign.setInstituteId("inst-OTHER");
            when(audiences.findById("aud-foreign")).thenReturn(Optional.of(foreign));
            AdConnectorSetupRequest r = request(null);
            r.setRoutingRulesJson("{\"rules\":[{\"priority\":1,\"conditions\":[],"
                    + "\"target_audience_id\":\"aud-foreign\"}]}");

            assertThrows(VacademyException.class, () -> controller.saveGoogleConnector(r, user));
            verify(webhookService, never()).saveConnector(any(), any());
        }

        @Test
        void listingAnotherInstitutesConnectorsIsRefused() {
            doThrow(new ForbiddenException("Access denied")).when(validator).requireInstituteStaff(user, "inst-OTHER");

            assertThrows(ForbiddenException.class, () -> controller.listConnectors("inst-OTHER", false, user));
            verify(repo, never()).findByInstituteIdAndIsActiveTrue(any());
        }

        @Test
        void disconnectingAnotherInstitutesConnectorIsRefused() {
            FormWebhookConnector theirs = connector();
            theirs.setInstituteId("inst-OTHER");
            theirs.setIsActive(true);
            when(repo.findById("conn-1")).thenReturn(Optional.of(theirs));
            doThrow(new ForbiddenException("Access denied")).when(validator).requireInstituteStaff(user, "inst-OTHER");

            assertThrows(ForbiddenException.class, () -> controller.deactivateConnector("conn-1", user));
            verify(repo, never()).save(any());
            assertTrue(theirs.getIsActive());
        }
    }
}
