package vacademy.io.admin_core_service.features.audience;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.web.reactive.function.client.ClientRequest;
import org.springframework.web.reactive.function.client.ClientResponse;
import org.springframework.web.reactive.function.client.WebClient;
import reactor.core.publisher.Mono;
import vacademy.io.admin_core_service.features.audience.dto.NormalizedLeadData;
import vacademy.io.admin_core_service.features.audience.dto.ProcessedFormDataDTO;
import vacademy.io.admin_core_service.features.audience.entity.Audience;
import vacademy.io.admin_core_service.features.audience.entity.AudienceResponse;
import vacademy.io.admin_core_service.features.audience.entity.FormWebhookConnector;
import vacademy.io.admin_core_service.features.audience.repository.AudienceRepository;
import vacademy.io.admin_core_service.features.audience.repository.AudienceResponseRepository;
import vacademy.io.admin_core_service.features.audience.repository.FormWebhookConnectorRepository;
import vacademy.io.admin_core_service.features.audience.service.AdPlatformWebhookService;
import vacademy.io.admin_core_service.features.audience.service.AudienceService;
import vacademy.io.admin_core_service.features.audience.service.LeadEnricher;
import vacademy.io.admin_core_service.features.audience.service.TokenEncryptionService;
import vacademy.io.admin_core_service.features.audience.strategy.AdPlatformStrategy;
import vacademy.io.admin_core_service.features.audience.strategy.GoogleLeadFormStrategy;
import vacademy.io.admin_core_service.features.audience.strategy.MetaLeadAdsStrategy;
import vacademy.io.admin_core_service.features.auth_service.service.AuthService;
import vacademy.io.common.auth.dto.UserDTO;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.lang.reflect.Field;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.function.Function;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/**
 * The ad a lead came from reaches the lead row: campaign, ad set, ad and form ids (and
 * the names Meta returns) travel from the Meta leadgen webhook and Graph lead read, or
 * from the Google lead form payload, through the webhook metadata into the
 * audience_response ad_* columns.
 */
class AdLeadAttributionTest {

    private static final String APP_SECRET = "test-app-secret";
    private static final String FORM_ID = "444444444444";

    private final ObjectMapper mapper = new ObjectMapper();

    /** Meta's documented leadgen webhook shape; Meta sends the ids as JSON numbers. */
    private static String metaWebhook(String leadgenId, String adId, String adgroupId) {
        return "{\"object\":\"page\",\"entry\":[{\"id\":\"153125381133\",\"time\":1438292065,"
                + "\"changes\":[{\"field\":\"leadgen\",\"value\":{"
                + "\"leadgen_id\":" + leadgenId + ","
                + "\"page_id\":153125381133,"
                + "\"form_id\":" + FORM_ID + ","
                + "\"adgroup_id\":" + adgroupId + ","
                + "\"ad_id\":" + adId + ","
                + "\"created_time\":1440120384}}]}]}";
    }

    /** A Graph lead read: the answers plus whatever ad fields Meta chose to return. */
    private static String graphLead(String extra) {
        return "{\"id\":\"123123123123\",\"created_time\":\"2026-11-10T09:30:00+0000\","
                + "\"field_data\":["
                + "{\"name\":\"full_name\",\"values\":[\"Test Lead\"]},"
                + "{\"name\":\"email\",\"values\":[\"lead@example.com\"]},"
                + "{\"name\":\"phone_number\",\"values\":[\"+919876543210\"]}]"
                + (extra.isEmpty() ? "" : "," + extra) + "}";
    }

    private static final String GRAPH_AD_FIELDS = "\"ad_id\":\"120200000000000001\","
            + "\"ad_name\":\"Carousel - NEET crash course\","
            + "\"adset_id\":\"120200000000000002\","
            + "\"adset_name\":\"Students 17-19 - Pune\","
            + "\"campaign_id\":\"120200000000000003\","
            + "\"campaign_name\":\"NEET 2027 leads\","
            + "\"form_id\":\"" + FORM_ID + "\"";

    private static final String GRAPH_REFUSAL = "{\"error\":{\"message\":\"(#100) Tried accessing a field that "
            + "needs another permission\",\"type\":\"OAuthException\",\"code\":100}}";

    /** Answers Graph reads from a function of the request URL; records every URL asked for. */
    private static final class FakeGraph {
        final List<String> urls = new ArrayList<>();
        final Function<String, ClientResponse> answer;

        FakeGraph(Function<String, ClientResponse> answer) {
            this.answer = answer;
        }

        Mono<ClientResponse> exchange(ClientRequest request) {
            String url = request.url().toString();
            urls.add(url);
            return Mono.just(answer.apply(url));
        }
    }

    private static ClientResponse json(HttpStatus status, String body) {
        return ClientResponse.create(status)
                .header(HttpHeaders.CONTENT_TYPE, MediaType.APPLICATION_JSON_VALUE)
                .body(body)
                .build();
    }

    private static boolean asksForAdFields(String url) {
        return url.contains("campaign_name");
    }

    private MetaLeadAdsStrategy metaStrategy(FakeGraph graph) {
        TokenEncryptionService tokens = mock(TokenEncryptionService.class);
        when(tokens.decrypt(any())).thenReturn("page-token");
        MetaLeadAdsStrategy strategy = new MetaLeadAdsStrategy(
                WebClient.builder().exchangeFunction(graph::exchange), mapper, tokens);
        ReflectionTestUtils.setField(strategy, "appSecret", APP_SECRET);
        ReflectionTestUtils.invokeMethod(strategy, "initWebClient");
        return strategy;
    }

    private static FormWebhookConnector metaConnector(String id) {
        FormWebhookConnector c = new FormWebhookConnector();
        c.setId(id);
        c.setVendor("META_LEAD_ADS");
        c.setInstituteId("inst-1");
        c.setAudienceId("aud-1");
        c.setPlatformFormId(FORM_ID);
        c.setOauthAccessTokenEnc("enc");
        return c;
    }

    @Nested
    @DisplayName("Meta: webhook + Graph read → lead")
    class MetaStrategy {

        @Test
        void graphAdFieldsAreReadWithTheLead() {
            FakeGraph graph = new FakeGraph(url -> json(HttpStatus.OK, graphLead(GRAPH_AD_FIELDS)));
            NormalizedLeadData lead = metaStrategy(graph).extractAndFetchLeads(
                    metaWebhook("123123123123", "12312312312", "12312312399"), metaConnector("conn-1")).get(0);

            assertEquals(1, graph.urls.size());
            assertTrue(asksForAdFields(graph.urls.get(0)));
            assertEquals("120200000000000003", lead.getAdCampaignId());
            assertEquals("NEET 2027 leads", lead.getAdCampaignName());
            assertEquals("120200000000000002", lead.getAdSetId());
            assertEquals("Students 17-19 - Pune", lead.getAdSetName());
            // Graph's own values win over the webhook's for the same id.
            assertEquals("120200000000000001", lead.getAdId());
            assertEquals("Carousel - NEET crash course", lead.getAdName());
            assertEquals(FORM_ID, lead.getAdFormId());
            assertEquals("lead@example.com", lead.getEmail());
            assertEquals("919876543210", lead.getPhone());
        }

        @Test
        void refusedAdFieldsFallBackToThePlainReadAndTheWebhookIds() {
            FakeGraph graph = new FakeGraph(url -> asksForAdFields(url)
                    ? json(HttpStatus.BAD_REQUEST, GRAPH_REFUSAL)
                    : json(HttpStatus.OK, graphLead("")));
            MetaLeadAdsStrategy strategy = metaStrategy(graph);
            FormWebhookConnector connector = metaConnector("conn-2");

            NormalizedLeadData lead = strategy.extractAndFetchLeads(
                    metaWebhook("123123123123", "12312312312", "12312312399"), connector).get(0);

            assertEquals(2, graph.urls.size());
            assertTrue(asksForAdFields(graph.urls.get(0)));
            assertFalse(asksForAdFields(graph.urls.get(1)));
            assertTrue(graph.urls.get(1).contains("fields=field_data,created_time,ad_id,form_id"));
            assertEquals("12312312312", lead.getAdId());
            assertEquals("12312312399", lead.getAdSetId());
            assertEquals(FORM_ID, lead.getAdFormId());
            assertNull(lead.getAdCampaignId());
            assertNull(lead.getAdCampaignName());
            assertEquals("lead@example.com", lead.getEmail());

            // The connector is remembered: the next lead is read once, without the ad fields.
            strategy.extractAndFetchLeads(metaWebhook("123123123124", "12312312312", "12312312399"), connector);
            assertEquals(3, graph.urls.size());
            assertFalse(asksForAdFields(graph.urls.get(2)));
        }

        @Test
        void aFailingPlainReadLosesNothingAndKeepsAskingForAdFields() {
            FakeGraph graph = new FakeGraph(url -> json(HttpStatus.BAD_REQUEST,
                    "{\"error\":{\"message\":\"Error validating access token\",\"code\":190}}"));
            MetaLeadAdsStrategy strategy = metaStrategy(graph);
            FormWebhookConnector connector = metaConnector("conn-3");

            assertTrue(strategy.extractAndFetchLeads(
                    metaWebhook("123123123123", "1", "2"), connector).isEmpty());
            strategy.extractAndFetchLeads(metaWebhook("123123123124", "1", "2"), connector);

            assertEquals(4, graph.urls.size());
            assertTrue(asksForAdFields(graph.urls.get(2)), "a token error is not taken as a field refusal");
        }

        @Test
        void serverErrorsAreNotRetried() {
            FakeGraph graph = new FakeGraph(url -> json(HttpStatus.INTERNAL_SERVER_ERROR, "{}"));

            assertTrue(metaStrategy(graph).extractAndFetchLeads(
                    metaWebhook("123123123123", "1", "2"), metaConnector("conn-4")).isEmpty());
            assertEquals(1, graph.urls.size());
        }

        @Test
        void organicLeadWithZeroIdsHasNoAd() {
            FakeGraph graph = new FakeGraph(url -> json(HttpStatus.OK, graphLead("\"form_id\":\"" + FORM_ID + "\"")));
            NormalizedLeadData lead = metaStrategy(graph).extractAndFetchLeads(
                    metaWebhook("123123123123", "0", "0"), metaConnector("conn-5")).get(0);

            assertNull(lead.getAdId());
            assertNull(lead.getAdSetId());
            assertNull(lead.getAdCampaignId());
            assertEquals(FORM_ID, lead.getAdFormId());
        }

        @Test
        void pollerReadsAdFieldsAndFallsBackOnTheFirstPage() {
            String page = "{\"data\":[" + graphLead(GRAPH_AD_FIELDS) + "],\"paging\":{}}";
            FakeGraph graph = new FakeGraph(url -> json(HttpStatus.OK, page));
            MetaLeadAdsStrategy.LeadPullResult pulled = metaStrategy(graph).fetchLeadsSince(
                    metaConnector("conn-6"), 1_700_000_000L, 5);
            assertEquals(1, pulled.leads().size());
            assertEquals("120200000000000003", pulled.leads().get(0).getAdCampaignId());
            assertTrue(asksForAdFields(graph.urls.get(0)));

            String plainPage = "{\"data\":[" + graphLead("\"ad_id\":\"55\",\"form_id\":\"" + FORM_ID + "\"")
                    + "],\"paging\":{}}";
            FakeGraph refusing = new FakeGraph(url -> asksForAdFields(url)
                    ? json(HttpStatus.BAD_REQUEST, GRAPH_REFUSAL)
                    : json(HttpStatus.OK, plainPage));
            pulled = metaStrategy(refusing).fetchLeadsSince(metaConnector("conn-7"), 1_700_000_000L, 5);
            assertEquals(1, pulled.leads().size());
            assertEquals("55", pulled.leads().get(0).getAdId());
            assertNull(pulled.leads().get(0).getAdCampaignId());
            assertEquals(2, refusing.urls.size());
            assertTrue(refusing.urls.get(1).contains("filtering="), "the plain read keeps the time filter");
        }
    }

    @Nested
    @DisplayName("Meta: signed webhook → AudienceService metadata")
    class MetaWebhook {

        @Test
        void signedWebhookPassesTheAdIdsOn() throws Exception {
            FakeGraph graph = new FakeGraph(url -> json(HttpStatus.OK, graphLead(GRAPH_AD_FIELDS)));
            MetaLeadAdsStrategy strategy = metaStrategy(graph);
            AdPlatformWebhookService service = new AdPlatformWebhookService();
            FormWebhookConnectorRepository repo = mock(FormWebhookConnectorRepository.class);
            AudienceService audienceService = mock(AudienceService.class);
            when(repo.findByPlatformFormIdAndVendorAndIsActiveTrue(FORM_ID, "META_LEAD_ADS"))
                    .thenReturn(Optional.of(metaConnector("conn-8")));
            ReflectionTestUtils.setField(service, "strategies", List.<AdPlatformStrategy>of(strategy));
            ReflectionTestUtils.setField(service, "connectorRepository", repo);
            ReflectionTestUtils.setField(service, "audienceService", audienceService);
            ReflectionTestUtils.setField(service, "objectMapper", mapper);
            ReflectionTestUtils.setField(service, "leadEnricher", mock(LeadEnricher.class));
            ReflectionTestUtils.invokeMethod(service, "initStrategyMap");

            String body = metaWebhook("123123123123", "12312312312", "12312312399");
            service.handleMetaWebhookAsync(body, "sha256=" + hmac(body));

            ArgumentCaptor<ProcessedFormDataDTO> data = ArgumentCaptor.forClass(ProcessedFormDataDTO.class);
            verify(audienceService).submitLeadFromFormWebhook(eq("aud-1"), data.capture(), eq("META_LEAD_ADS"));
            Map<String, String> metadata = data.getValue().getMetadata();
            assertEquals("120200000000000003", metadata.get(AudienceService.AD_CAMPAIGN_ID));
            assertEquals("NEET 2027 leads", metadata.get(AudienceService.AD_CAMPAIGN_NAME));
            assertEquals("120200000000000002", metadata.get(AudienceService.AD_SET_ID));
            assertEquals("Students 17-19 - Pune", metadata.get(AudienceService.AD_SET_NAME));
            assertEquals("120200000000000001", metadata.get(AudienceService.AD_ID));
            assertEquals("Carousel - NEET crash course", metadata.get(AudienceService.AD_NAME));
            assertEquals(FORM_ID, metadata.get(AudienceService.AD_FORM_ID));
            // Meta leads keep their source_id marker and get no UTM touch.
            assertFalse(metadata.containsKey("source_id"));
            assertFalse(metadata.keySet().stream().anyMatch(k -> k.startsWith("utm_")));
        }

        private String hmac(String body) throws Exception {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(APP_SECRET.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
            StringBuilder hex = new StringBuilder();
            for (byte b : mac.doFinal(body.getBytes(StandardCharsets.UTF_8))) hex.append(String.format("%02x", b));
            return hex.toString();
        }
    }

    @Nested
    @DisplayName("Google: lead form payload → lead")
    class Google {

        private final GoogleLeadFormStrategy strategy = new GoogleLeadFormStrategy(mapper);

        private FormWebhookConnector connector() {
            FormWebhookConnector c = new FormWebhookConnector();
            c.setId("g-1");
            c.setVendor("GOOGLE_LEAD_ADS");
            c.setAudienceId("aud-1");
            return c;
        }

        @Test
        void campaignAdGroupCreativeAndFormAreKept() {
            String body = "{\"lead_id\":\"lead-abc\",\"api_version\":\"1.0\",\"form_id\":40000000001,"
                    + "\"campaign_id\":21345678901,\"adgroup_id\":20000000002,\"creative_id\":30000000003,"
                    + "\"is_test\":false,\"user_column_data\":[]}";
            NormalizedLeadData lead = strategy.extractAndFetchLeads(body, connector()).get(0);

            assertEquals("21345678901", lead.getAdCampaignId());
            assertEquals("20000000002", lead.getAdSetId());
            assertEquals("30000000003", lead.getAdId());
            assertEquals("40000000001", lead.getAdFormId());
            assertNull(lead.getAdCampaignName());
            // The existing readers are unchanged: source_id and the UTM touch.
            assertEquals("21345678901", lead.getCampaignId());
            assertEquals("20000000002", lead.getUtmParams().get("utm_content"));
        }

        @Test
        void performanceMaxAssetGroupStandsInForTheAdSet() {
            String body = "{\"lead_id\":\"l\",\"campaign_id\":21345678901,\"asset_group_id\":6000000001,"
                    + "\"user_column_data\":[]}";
            NormalizedLeadData lead = strategy.extractAndFetchLeads(body, connector()).get(0);

            assertEquals("6000000001", lead.getAdSetId());
            assertNull(lead.getAdId());
        }
    }

    @Nested
    @DisplayName("AudienceService: metadata → audience_response columns")
    class Save {

        private AudienceService service;
        private AudienceResponseRepository responses;

        @BeforeEach
        void setUp() throws Exception {
            service = new AudienceService();
            for (Field f : AudienceService.class.getDeclaredFields()) {
                if (f.isAnnotationPresent(Autowired.class) && !f.getType().isPrimitive()) {
                    f.setAccessible(true);
                    f.set(service, mock(f.getType()));
                }
            }
            responses = (AudienceResponseRepository) get("audienceResponseRepository");
            Audience audience = new Audience();
            audience.setId("aud-1");
            audience.setInstituteId("inst-1");
            audience.setStatus("ACTIVE");
            audience.setCampaignName("List");
            when(((AudienceRepository) get("audienceRepository")).findById("aud-1")).thenReturn(Optional.of(audience));
            UserDTO user = new UserDTO();
            user.setId("user-1");
            user.setEmail("lead@example.com");
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
                    .email("lead@example.com").fullName("Test Lead").phone("+919876543210")
                    .formFields(Map.of()).metadata(metadata).build(), provider);
            ArgumentCaptor<AudienceResponse> saved = ArgumentCaptor.forClass(AudienceResponse.class);
            verify(responses).save(saved.capture());
            return saved.getValue();
        }

        @Test
        void metaLeadStoresItsAdAndKeepsItsSourceMarker() {
            Map<String, String> metadata = new HashMap<>();
            metadata.put("platform_lead_id", "123123123123");
            metadata.put(AudienceService.AD_CAMPAIGN_ID, "120200000000000003");
            metadata.put(AudienceService.AD_CAMPAIGN_NAME, "NEET 2027 leads");
            metadata.put(AudienceService.AD_SET_ID, "120200000000000002");
            metadata.put(AudienceService.AD_SET_NAME, "Students 17-19 - Pune");
            metadata.put(AudienceService.AD_ID, "120200000000000001");
            metadata.put(AudienceService.AD_NAME, "x".repeat(300));
            metadata.put(AudienceService.AD_FORM_ID, FORM_ID);

            AudienceResponse saved = submit(metadata, "META_LEAD_ADS");

            assertEquals("META_LEAD_ADS_WEBHOOK", saved.getSourceId());
            assertEquals("120200000000000003", saved.getAdCampaignId());
            assertEquals("NEET 2027 leads", saved.getAdCampaignName());
            assertEquals("120200000000000002", saved.getAdSetId());
            assertEquals("Students 17-19 - Pune", saved.getAdSetName());
            assertEquals("120200000000000001", saved.getAdId());
            assertEquals(255, saved.getAdName().length(), "names are cut to the column length");
            assertEquals(FORM_ID, saved.getAdFormId());
        }

        @Test
        void otherWebhooksLeaveTheAdColumnsEmpty() {
            AudienceResponse saved = submit(Map.of("platform_lead_id", "z-1", "ad_set_id", "  "), "ZOHO_FORMS");

            assertNull(saved.getAdCampaignId());
            assertNull(saved.getAdSetId());
            assertNull(saved.getAdId());
            assertNull(saved.getAdFormId());
            assertEquals("ZOHO_FORMS_WEBHOOK", saved.getSourceId());
        }
    }
}
