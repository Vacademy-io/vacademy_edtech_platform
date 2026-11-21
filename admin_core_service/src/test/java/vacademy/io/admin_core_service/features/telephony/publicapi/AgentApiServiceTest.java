package vacademy.io.admin_core_service.features.telephony.publicapi;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.jdbc.core.namedparam.SqlParameterSource;
import vacademy.io.admin_core_service.features.institute.setting_history.InstituteSettingWriter;
import vacademy.io.admin_core_service.features.institute_api.service.InstituteApiAuditWriter;
import vacademy.io.admin_core_service.features.telephony.core.AiAgentService;
import vacademy.io.admin_core_service.features.telephony.core.AiAgentSpeechWarmer;
import vacademy.io.admin_core_service.features.telephony.core.AiCallingSettingsMutator;
import vacademy.io.admin_core_service.features.telephony.core.AiCallingSettingsService;
import vacademy.io.admin_core_service.features.telephony.core.TtsModelPricingAnnotator;
import vacademy.io.admin_core_service.features.telephony.core.dto.AiCallingSettingsPojo;
import vacademy.io.admin_core_service.features.telephony.persistence.entity.AiAgent;
import vacademy.io.admin_core_service.features.telephony.persistence.repository.AiAgentRepository;
import vacademy.io.admin_core_service.features.telephony.queue.repository.AiCallQueueItemRepository;

import java.util.*;
import java.util.function.Consumer;
import java.util.function.Supplier;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/**
 * Agent management through the API, with the REAL AiAgentService underneath (only storage is
 * mocked), so what a PATCH saves is exactly what AiAgentService stores.
 */
class AgentApiServiceTest {

    private static final String INST = "inst-1";
    private static final AiCallingApiAuth.Principal P =
            new AiCallingApiAuth.Principal(INST, "key-1", List.of("calls:read", "agents:manage"));
    private static final ObjectMapper JSON = new ObjectMapper();

    private AiAgentRepository repo;
    private AiCallQueueItemRepository queue;
    private AiCallingSettingsService settingsService;
    private AiCallingSettingsMutator mutator;
    private NamedParameterJdbcTemplate jdbc;
    private AiAgentService agentService;
    private AgentApiService service;
    private AiCallingSettingsPojo settings;
    private final Map<String, AiAgent> store = new LinkedHashMap<>();

    @BeforeEach
    @SuppressWarnings("unchecked")
    void setUp() {
        repo = mock(AiAgentRepository.class);
        queue = mock(AiCallQueueItemRepository.class);
        settingsService = mock(AiCallingSettingsService.class);
        mutator = mock(AiCallingSettingsMutator.class);
        jdbc = mock(NamedParameterJdbcTemplate.class);
        agentService = new AiAgentService(repo, mock(AiAgentSpeechWarmer.class), queue, mutator);
        ApiIdempotencyStore idempotency = mock(ApiIdempotencyStore.class);
        when(idempotency.run(any(), any(), any(), any(), any(), any(), any())).thenAnswer(i -> {
            ApiIdempotencyStore.Created c = ((Supplier<ApiIdempotencyStore.Created>) i.getArgument(5)).get();
            return new ApiIdempotencyStore.Outcome(c.body(), false, c.created());
        });
        TtsModelPricingAnnotator pricing = mock(TtsModelPricingAnnotator.class);
        when(pricing.annotate(anyList())).thenAnswer(i -> i.getArgument(0));
        service = new AgentApiService(repo, agentService, settingsService, mutator, queue, jdbc, idempotency,
                mock(InstituteApiAuditWriter.class), pricing);
        settings = new AiCallingSettingsPojo();
        settings.setProvider("VACADEMY_AI");
        when(settingsService.get(INST)).thenReturn(settings);
        when(repo.findByIdAndInstituteId(anyString(), anyString())).thenAnswer(i -> {
            AiAgent a = store.get((String) i.getArgument(0));
            return a != null && a.getInstituteId().equals(i.getArgument(1)) ? Optional.of(a) : Optional.empty();
        });
        when(repo.save(any(AiAgent.class))).thenAnswer(i -> {
            AiAgent a = i.getArgument(0);
            if (a.getId() == null) a.setId("a-new");
            store.put(a.getId(), a);
            return a;
        });
        when(repo.findIdNameEnabledByInstituteId(INST)).thenAnswer(i -> store.values().stream()
                .filter(a -> a.getInstituteId().equals(INST))
                .map(a -> new Object[]{a.getId(), a.getName(), a.getEnabled()}).toList());
        when(jdbc.queryForList(anyString(), any(SqlParameterSource.class))).thenReturn(List.of());
        when(jdbc.queryForObject(contains("booking_page"), any(SqlParameterSource.class), eq(Long.class))).thenReturn(0L);
        store.put("a-1", AiAgent.builder().id("a-1").instituteId(INST).name("Riya").enabled(true).direction("OUTBOUND")
                .language("hinglish").ttsModel("google").voice("hi-IN-Chirp3-HD-Kore").openingLine("Hi {{name}}!")
                .systemPrompt("You are Riya from {{institute_name}}.").maxCallMinutes(8).pace(1.1)
                .speechCacheMode("FIXED")
                .sendRules("[{\"id\":\"r1\",\"label\":\"Brochure\",\"actionType\":\"SEND\",\"channel\":\"EMAIL\","
                        + "\"messageBody\":\"Here it is\",\"when\":{\"disposition\":\"INTERESTED\"}}]")
                .build());
        store.put("x-1", AiAgent.builder().id("x-1").instituteId("inst-2").name("Theirs").enabled(true)
                .direction("BOTH").build());
    }

    private static JsonNode json(String s) {
        try {
            return JSON.readTree(s);
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    private static AiCallingApiException fails(Runnable r) {
        return assertThrows(AiCallingApiException.class, r::run);
    }

    // ── Read ─────────────────────────────────────────────────────────────────────

    @Test
    void getReturnsTheWholeConfigurationSnakeCase() {
        settings.setDefaultCampaignId("a-1");
        Map<String, Object> a = service.getAgent(P, "a-1");
        assertEquals("outbound", a.get("direction"));
        assertEquals(true, a.get("is_default"));
        assertEquals("fixed", a.get("speech_cache_mode"));
        assertEquals(List.of("institute_name"), a.get("variables"));
        assertEquals(true, a.get("uses_contact_name"));
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> rules = (List<Map<String, Object>>) a.get("send_rules");
        assertEquals("EMAIL", rules.get(0).get("channel"));
        assertEquals("Here it is", rules.get(0).get("message_body"));
    }

    @Test
    void aCallsReadKeySeesASummaryWithoutTheScriptOrStaffNumbers() {
        AiCallingApiAuth.Principal reader = new AiCallingApiAuth.Principal(INST, "key-r", List.of("calls:read"));
        Map<String, Object> a = service.getAgent(reader, "a-1");
        for (String hidden : List.of("system_prompt", "handoff_numbers", "send_rules", "booking_page_id")) {
            assertFalse(a.containsKey(hidden), hidden);
        }
        assertEquals("summary", a.get("configuration"));
        assertEquals("Hi {{name}}!", a.get("opening_line"));
        assertEquals("full", service.getAgent(P, "a-1").get("configuration"));
        assertTrue(service.getAgent(P, "a-1").containsKey("system_prompt"));
    }

    @Test
    void aStaleIfMatchIs409AndNothingIsSaved() {
        store.get("a-1").setUpdatedAt(java.sql.Timestamp.from(java.time.Instant.parse("2026-10-19T10:15:00.123456Z")));
        when(repo.claimVersion(eq("a-1"), any())).thenReturn(0);
        AiCallingApiException e = fails(() -> service.patchAgent(P, "a-1", json("{\"pace\":1.0}"),
                "\"2026-10-19T10:00:00Z\""));
        assertEquals("version_conflict", e.getCode());
        assertEquals("2026-10-19T10:15:00.123456Z", e.getDetails().get("current_updated_at"));
        verify(repo, never()).save(any());
    }

    @Test
    void aCurrentVersionSavesAndNoVersionKeepsLastWriteWins() {
        when(repo.claimVersion(eq("a-1"), any())).thenReturn(1);
        service.patchAgent(P, "a-1", json("{\"pace\":1.0,\"expected_updated_at\":\"2026-10-19T10:15:00.123456Z\"}"), null);
        verify(repo).claimVersion("a-1", java.sql.Timestamp.from(java.time.Instant.parse("2026-10-19T10:15:00.123456Z")));
        assertEquals(1.0, store.get("a-1").getPace());
        service.patchAgent(P, "a-1", json("{\"pace\":1.2}"), null);
        verify(repo, times(1)).claimVersion(any(), any());
        assertEquals("invalid_request", fails(() -> service.patchAgent(P, "a-1", json("{\"pace\":1.0}"), "yesterday")).getCode());
    }

    @Test
    void anotherInstitutesAgentIsNotFound() {
        assertEquals("agent_not_found", fails(() -> service.getAgent(P, "x-1")).getCode());
        assertEquals("agent_not_found", fails(() -> service.patchAgent(P, "x-1", json("{\"pace\":1.0}"))).getCode());
        assertEquals("agent_not_found", fails(() -> service.deleteAgent(P, "x-1")).getCode());
    }

    // ── Create ───────────────────────────────────────────────────────────────────

    @Test
    void createNeedsNamePromptAndOpeningLine() {
        AiCallingApiException e = fails(() -> service.createAgent(P, json("{\"name\":\"New\"}"), null));
        @SuppressWarnings("unchecked")
        List<Map<String, String>> errors = (List<Map<String, String>>) e.getDetails().get("errors");
        assertEquals(List.of("system_prompt", "opening_line"), errors.stream().map(x -> x.get("field")).toList());
    }

    @Test
    void createWithDefaultsUsesTheDefaultEngineAndItsDefaultVoice() {
        ApiIdempotencyStore.Outcome out = service.createAgent(P,
                json("{\"name\":\"Kabir\",\"system_prompt\":\"Be brief.\",\"opening_line\":\"Hello!\"}"), "k1");
        assertTrue(out.created());
        AiAgent saved = store.get("a-new");
        assertEquals("google", saved.getTtsModel());
        assertEquals("hi-IN-Chirp3-HD-Achird", saved.getVoice());
        assertEquals("OUTBOUND", saved.getDirection());
        assertTrue(saved.getEnabled());
        verify(mutator).update(eq(INST), any(), argThat(a -> "api:key-1".equals(a.userId())));
    }

    @Test
    void anUnknownVoiceIs422WithTheValidOnes() {
        AiCallingApiException e = fails(() -> service.createAgent(P, json("{\"name\":\"K\",\"system_prompt\":\"x\","
                + "\"opening_line\":\"y\",\"tts_model\":\"sarvam\",\"voice\":\"hi-IN-Chirp3-HD-Kore\"}"), null));
        assertEquals(HttpStatus.UNPROCESSABLE_ENTITY, e.getStatus());
        assertEquals("invalid_voice", e.getCode());
        @SuppressWarnings("unchecked")
        List<String> valid = (List<String>) e.getDetails().get("valid_voices");
        assertTrue(valid.contains("priya"));
        assertFalse(store.containsKey("a-new"));
    }

    @Test
    void anUnknownEngineOrLanguageIs422() {
        assertEquals("unsupported_tts_model", fails(() -> service.createAgent(P, json("{\"name\":\"K\","
                + "\"system_prompt\":\"x\",\"opening_line\":\"y\",\"tts_model\":\"silk muga\"}"), null)).getCode());
        assertEquals("unsupported_language", fails(() -> service.createAgent(P, json("{\"name\":\"K\","
                + "\"system_prompt\":\"x\",\"opening_line\":\"y\",\"language\":\"klingon\"}"), null)).getCode());
        assertEquals("voice_language_mismatch", fails(() -> service.createAgent(P, json("{\"name\":\"K\","
                + "\"system_prompt\":\"x\",\"opening_line\":\"y\",\"language\":\"hindi\",\"tts_model\":\"deepgram\"}"),
                null)).getCode());
    }

    @Test
    void numbersMinutesAndRangesAreCheckedNotClamped() {
        AiCallingApiException e = fails(() -> service.createAgent(P, json("{\"name\":\"K\",\"system_prompt\":\"x\","
                + "\"opening_line\":\"y\",\"handoff_numbers\":[\"98765\"],\"max_call_minutes\":45,\"pace\":3.0,"
                + "\"direction\":\"sideways\"}"), null));
        @SuppressWarnings("unchecked")
        List<Map<String, String>> errors = (List<Map<String, String>>) e.getDetails().get("errors");
        assertEquals(Set.of("direction", "handoff_numbers", "max_call_minutes", "pace"),
                new HashSet<>(errors.stream().map(x -> x.get("field")).toList()));
    }

    @Test
    void aBookingPageOfAnotherInstituteIsRefused() {
        assertEquals("booking_page_not_found", fails(() -> service.createAgent(P, json("{\"name\":\"K\","
                + "\"system_prompt\":\"x\",\"opening_line\":\"y\",\"booking_page_id\":\"bp-9\"}"), null)).getCode());
    }

    @Test
    void aDuplicateNameIgnoringCaseIs409() {
        assertEquals("agent_name_taken", fails(() -> service.createAgent(P, json("{\"name\":\"riya\","
                + "\"system_prompt\":\"x\",\"opening_line\":\"y\"}"), null)).getCode());
        // Another institute's agent of the same name is no conflict.
        service.createAgent(P, json("{\"name\":\"Theirs\",\"system_prompt\":\"x\",\"opening_line\":\"y\"}"), null);
        assertTrue(store.containsKey("a-new"));
    }

    // ── Patch ────────────────────────────────────────────────────────────────────

    @Test
    void patchChangesOnlyWhatWasSent() {
        Map<String, Object> out = service.patchAgent(P, "a-1", json("{\"opening_line\":\"Namaste {{name}}\"}"));
        AiAgent a = store.get("a-1");
        assertEquals("Namaste {{name}}", a.getOpeningLine());
        assertEquals("You are Riya from {{institute_name}}.", a.getSystemPrompt());
        assertEquals("google", a.getTtsModel());
        assertEquals("hi-IN-Chirp3-HD-Kore", a.getVoice());
        assertEquals("hinglish", a.getLanguage());
        assertEquals(8, a.getMaxCallMinutes());
        assertEquals(1.1, a.getPace());
        assertEquals("FIXED", a.getSpeechCacheMode());
        assertNotNull(a.getSendRules());
        assertTrue(a.getSendRules().contains("Brochure"));
        assertEquals("Namaste {{name}}", out.get("opening_line"));
        assertFalse(out.containsKey("waiting_calls_canceled"));
    }

    @Test
    void patchCanClearNullableFields() {
        service.patchAgent(P, "a-1", json("{\"max_call_minutes\":null,\"pace\":null,\"language\":null,\"send_rules\":[]}"));
        AiAgent a = store.get("a-1");
        assertNull(a.getMaxCallMinutes());
        assertNull(a.getPace());
        assertNull(a.getLanguage());
        assertNull(a.getSendRules());
    }

    @Test
    void switchingEngineNeedsAVoiceOfThatEngine() {
        assertEquals("invalid_voice", fails(() -> service.patchAgent(P, "a-1", json("{\"tts_model\":\"sarvam\"}"))).getCode());
        assertEquals("google", store.get("a-1").getTtsModel());
        service.patchAgent(P, "a-1", json("{\"tts_model\":\"sarvam\",\"voice\":\"Priya\"}"));
        assertEquals("sarvam", store.get("a-1").getTtsModel());
        assertEquals("priya", store.get("a-1").getVoice());
    }

    @Test
    void speechCacheModeIsReadOnly() {
        service.patchAgent(P, "a-1", json("{\"speech_cache_mode\":\"fixed\",\"pace\":1.0}"));
        assertEquals("speech_cache_mode", ((List<Map<String, String>>) fails(() -> service.patchAgent(P, "a-1",
                json("{\"speech_cache_mode\":\"full\"}"))).getDetails().get("errors")).get(0).get("field"));
    }

    @Test
    void renamingOntoAnotherAgentIs409ButKeepingTheNameIsFine() {
        store.put("a-2", AiAgent.builder().id("a-2").instituteId(INST).name("Kabir").enabled(true).direction("BOTH")
                .ttsModel("google").voice("hi-IN-Chirp3-HD-Achird").build());
        assertEquals("agent_name_taken", fails(() -> service.patchAgent(P, "a-1", json("{\"name\":\"KABIR\"}"))).getCode());
        service.patchAgent(P, "a-1", json("{\"name\":\"Riya\"}"));
    }

    @Test
    void sendRulesAreSnakeCaseAndStillValidated() {
        service.patchAgent(P, "a-1", json("{\"send_rules\":[{\"label\":\"Fees\",\"action_type\":\"SEND\","
                + "\"channel\":\"EMAIL\",\"message_body\":\"Fee sheet\",\"when\":{\"meeting_requested\":true}}]}"));
        assertTrue(store.get("a-1").getSendRules().contains("\"messageBody\":\"Fee sheet\""));
        AiCallingApiException e = fails(() -> service.patchAgent(P, "a-1", json("{\"send_rules\":[{\"label\":\"x\","
                + "\"action_type\":\"SEND\",\"channel\":\"WHATSAPP\",\"when\":{\"disposition\":\"X\"}}]}")));
        assertEquals("invalid_agent", e.getCode());
    }

    // ── Enable / disable ─────────────────────────────────────────────────────────

    @Test
    void disablingCancelsWaitingCallsAndWarnsAboutTheDefault() {
        settings.setDefaultCampaignId("a-1");
        when(queue.cancelQueuedForAgent(INST, "a-1", "Riya", "The AI agent was turned off, so this call was not placed."))
                .thenReturn(7);
        Map<String, Object> out = service.setEnabled(P, "a-1", false);
        assertEquals(false, out.get("enabled"));
        assertEquals(7, out.get("waiting_calls_canceled"));
        @SuppressWarnings("unchecked")
        List<Map<String, String>> warnings = (List<Map<String, String>>) out.get("warnings");
        assertEquals("default_agent_disabled", warnings.get(0).get("code"));
        // Again: no second save; a sweep of anything new.
        when(queue.cancelQueuedForAgent(anyString(), anyString(), anyString(), anyString())).thenReturn(0);
        assertEquals(0, service.setEnabled(P, "a-1", false).get("waiting_calls_canceled"));
        verify(repo, times(1)).save(any());
    }

    @Test
    void enablingAnEnabledAgentIsANoOp() {
        service.setEnabled(P, "a-1", true);
        verify(repo, never()).save(any());
    }

    // ── Delete ───────────────────────────────────────────────────────────────────

    @Test
    void anAgentInUseCannotBeDeletedAndSaysWhere() {
        settings.setDefaultCampaignId("Riya");
        when(jdbc.queryForList(contains("ivr_node"), any(SqlParameterSource.class))).thenReturn(List.of(
                new HashMap<>(Map.of("menu_id", "m-1", "menu_name", "Main", "menu_enabled", true, "step_id", "n-1"))));
        Map<String, Object> wf = new HashMap<>();
        wf.put("workflow_id", "w-1");
        wf.put("workflow_name", "Nurture");
        wf.put("workflow_status", "ACTIVE");
        wf.put("node_id", "nt-1");
        wf.put("node_name", "Call");
        wf.put("config_json", "{\"campaignName\":\"riya\"}");
        Map<String, Object> other = new HashMap<>(wf);
        other.put("config_json", "{\"campaignId\":\"someone-else\"}");
        when(jdbc.queryForList(contains("node_template"), any(SqlParameterSource.class))).thenReturn(List.of(wf, other));
        when(queue.countWaitingForAgent(INST, "a-1", "Riya")).thenReturn(2L);

        AiCallingApiException e = fails(() -> service.deleteAgent(P, "a-1"));
        assertEquals("agent_in_use", e.getCode());
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> used = (List<Map<String, Object>>) e.getDetails().get("used_by");
        assertEquals(List.of("default_agent", "ivr_step", "workflow", "waiting_calls"),
                used.stream().map(u -> u.get("type")).toList());
        assertEquals("w-1", used.get(2).get("workflow_id"));
        verify(repo, never()).delete(any());
    }

    @Test
    void anUnusedAgentIsDeleted() {
        Map<String, Object> out = service.deleteAgent(P, "a-1");
        assertEquals(true, out.get("deleted"));
        verify(repo).delete(store.get("a-1"));
    }

    @Test
    void workflowReferencesMatchByIdOrName() {
        AiAgent a = store.get("a-1");
        assertTrue(AgentApiService.referencesAgent("{\"campaignId\":\"a-1\"}", a));
        assertTrue(AgentApiService.referencesAgent("{\"campaignName\":\" RIYA \"}", a));
        assertFalse(AgentApiService.referencesAgent("{\"campaignName\":\"Riyaz\"}", a));
        assertFalse(AgentApiService.referencesAgent("not json", a));
        assertFalse(AgentApiService.referencesAgent(null, a));
    }

    // ── Default agent ────────────────────────────────────────────────────────────

    @Test
    @SuppressWarnings("unchecked")
    void settingTheDefaultWritesOnlyThatFieldAsTheApiActor() {
        service.setDefaultAgent(P, "a-1");
        ArgumentCaptor<Consumer<ObjectNode>> change = ArgumentCaptor.forClass(Consumer.class);
        ArgumentCaptor<InstituteSettingWriter.Actor> actor = ArgumentCaptor.forClass(InstituteSettingWriter.Actor.class);
        verify(mutator).update(eq(INST), change.capture(), actor.capture());
        ObjectNode data = JSON.createObjectNode();
        data.put("provider", "VACADEMY_AI");
        data.putArray("campaigns");
        change.getValue().accept(data);
        assertEquals("a-1", data.get("defaultCampaignId").asText());
        assertEquals("VACADEMY_AI", data.get("provider").asText());
        assertEquals("api:key-1", actor.getValue().userId());
    }

    @Test
    void theDefaultMustBeAnEnabledOutboundAgentOfThisAccountOnVacademyAi() {
        assertEquals("agent_not_found", fails(() -> service.setDefaultAgent(P, "x-1")).getCode());
        store.get("a-1").setEnabled(false);
        assertEquals("agent_disabled", fails(() -> service.setDefaultAgent(P, "a-1")).getCode());
        store.get("a-1").setEnabled(true);
        store.get("a-1").setDirection("INBOUND");
        assertEquals("agent_inbound_only", fails(() -> service.setDefaultAgent(P, "a-1")).getCode());
        store.get("a-1").setDirection("BOTH");
        settings.setProvider("AAVTAAR");
        assertEquals("ai_provider_not_supported", fails(() -> service.setDefaultAgent(P, "a-1")).getCode());
        verify(mutator, never()).update(any(), any(), any());
    }

    @Test
    void theDefaultResolvesAnIdOrAName() {
        settings.setDefaultCampaignId("riya");
        assertEquals("a-1", service.getDefaultAgent(P).get("agent_id"));
        settings.setDefaultCampaignId("aavtaar-123");
        assertNull(service.getDefaultAgent(P).get("agent"));
    }

    // ── Voices ───────────────────────────────────────────────────────────────────

    @Test
    @SuppressWarnings("unchecked")
    void voicesListEveryEngineWithItsVoicesAndLanguages() {
        Map<String, Object> out = service.voices();
        List<Map<String, Object>> engines = (List<Map<String, Object>>) out.get("data");
        Map<String, Object> deepgram = engines.stream().filter(e -> "deepgram".equals(e.get("id"))).findFirst().orElseThrow();
        assertEquals(List.of("english"), deepgram.get("languages"));
        List<Map<String, Object>> voices = (List<Map<String, Object>>) deepgram.get("voices");
        assertFalse(voices.isEmpty());
        assertNotNull(voices.get(0).get("gender"));
        assertTrue(engines.stream().allMatch(e -> e.containsKey("pricing")));
    }

    @Test
    void languageNormalisation() {
        assertEquals("hinglish", AgentApiService.normaliseLanguage(" Hinglish "));
        assertEquals("hi-IN", AgentApiService.normaliseLanguage("hi-in"));
        assertEquals("ta", AgentApiService.normaliseLanguage("TA"));
        assertThrows(AiCallingApiException.class, () -> AgentApiService.normaliseLanguage("xx-IN"));
    }
}
