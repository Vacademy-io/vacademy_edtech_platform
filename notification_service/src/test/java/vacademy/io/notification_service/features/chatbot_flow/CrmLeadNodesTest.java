package vacademy.io.notification_service.features.chatbot_flow;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import vacademy.io.notification_service.features.chatbot_flow.engine.FlowExecutionContext;
import vacademy.io.notification_service.features.chatbot_flow.engine.NodeExecutionResult;
import vacademy.io.notification_service.features.chatbot_flow.engine.executors.AskFieldNodeExecutor;
import vacademy.io.notification_service.features.chatbot_flow.engine.executors.CrmLeadCheckNodeExecutor;
import vacademy.io.notification_service.features.chatbot_flow.engine.executors.CrmLeadNodeSupport;
import vacademy.io.notification_service.features.chatbot_flow.engine.executors.SaveToCrmNodeExecutor;
import vacademy.io.notification_service.features.chatbot_flow.engine.provider.ChatbotMessageProvider;
import vacademy.io.notification_service.features.chatbot_flow.entity.ChatbotFlowNode;
import vacademy.io.notification_service.features.chatbot_flow.entity.ChatbotFlowSession;
import vacademy.io.notification_service.features.chatbot_flow.enums.EscalationReason;
import vacademy.io.notification_service.features.chatbot_flow.repository.ChatbotFlowRepository;
import vacademy.io.notification_service.features.chatbot_flow.service.ChatbotEscalationService;
import vacademy.io.notification_service.features.chatbot_flow.service.WhatsAppFlowLeadClient;
import vacademy.io.notification_service.features.notification_log.repository.NotificationLogRepository;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyMap;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * The three CRM chatbot nodes that turn a WhatsApp conversation into a CRM lead:
 * CRM_LEAD_CHECK, ASK_FIELD and SAVE_TO_CRM. Real executors and support; the provider,
 * admin-core client and escalation service are mocks.
 */
class CrmLeadNodesTest {

    private static final String INSTITUTE = "inst-1";
    private static final String PHONE = "447911123456";
    private static final String FIELD_ID = "cf-year";

    private final ObjectMapper objectMapper = new ObjectMapper();
    private ChatbotMessageProvider provider;
    private WhatsAppFlowLeadClient leadClient;
    private ChatbotEscalationService escalationService;
    private CrmLeadNodeSupport support;

    @BeforeEach
    void setUp() {
        provider = mock(ChatbotMessageProvider.class);
        when(provider.supports(anyString())).thenReturn(true);
        when(provider.sendText(anyString(), anyString(), anyString(), any())).thenReturn("wamid.text");
        when(provider.sendInteractive(anyString(), anyMap(), anyString(), any())).thenReturn("wamid.interactive");
        leadClient = mock(WhatsAppFlowLeadClient.class);
        escalationService = mock(ChatbotEscalationService.class);
        ChatbotFlowRepository flowRepository = mock(ChatbotFlowRepository.class);
        when(flowRepository.findById(anyString())).thenReturn(Optional.empty());
        NotificationLogRepository logRepository = mock(NotificationLogRepository.class);
        when(logRepository.findLatestWhatsAppSenderName(anyString(), anyString())).thenReturn(List.of("Asha"));
        support = new CrmLeadNodeSupport(objectMapper, List.of(provider), flowRepository, logRepository,
                escalationService);
    }

    private FlowExecutionContext context(String text) {
        return FlowExecutionContext.builder()
                .instituteId(INSTITUTE)
                .phoneNumber(PHONE)
                .channelType("WHATSAPP_META")
                .messageText(text)
                .build();
    }

    private FlowExecutionContext reply(String text, String buttonId) {
        FlowExecutionContext ctx = context(text);
        ctx.setButtonId(buttonId);
        ctx.setReplyToWaitingNode(true);
        return ctx;
    }

    private ChatbotFlowNode node(String type, Map<String, Object> config) throws Exception {
        return ChatbotFlowNode.builder().id("node-" + type).flowId("flow-1").nodeType(type)
                .config(objectMapper.writeValueAsString(config)).build();
    }

    private ChatbotFlowSession session(Map<String, Object> ctx) throws Exception {
        return ChatbotFlowSession.builder().id("sess-1").flowId("flow-1").instituteId(INSTITUTE)
                .userPhone(PHONE).context(objectMapper.writeValueAsString(ctx)).build();
    }

    private static List<Map<String, Object>> options(String... labels) {
        List<Map<String, Object>> list = new ArrayList<>();
        for (String l : labels) list.add(Map.of("value", l.toUpperCase().replace(' ', '_'), "label", l));
        return list;
    }

    private static Map<String, Object> dropdown(List<Map<String, Object>> options) {
        Map<String, Object> config = new HashMap<>();
        config.put("fieldSource", "CUSTOM_FIELD");
        config.put("customFieldId", FIELD_ID);
        config.put("fieldName", "Year Group");
        config.put("fieldType", "dropdown");
        config.put("options", options);
        config.put("question", "Which year is your child in?");
        config.put("maxRetries", 2);
        return config;
    }

    // ==================== ASK_FIELD ====================

    @Nested
    @DisplayName("ASK_FIELD")
    class AskField {

        private AskFieldNodeExecutor executor() {
            return new AskFieldNodeExecutor(support, leadClient, objectMapper);
        }

        @Test
        @DisplayName("3 options → reply buttons, then waits for the answer")
        void threeOptionsAreButtons() throws Exception {
            FlowExecutionContext ctx = context("enquiry");
            NodeExecutionResult result = executor().execute(
                    node("ASK_FIELD", dropdown(options("Year 4", "Year 5", "Year 6"))), session(Map.of()), "enquiry", ctx);

            assertThat(result.isSuccess()).isTrue();
            assertThat(result.isWaitForInput()).isTrue();
            @SuppressWarnings("unchecked")
            ArgumentCaptor<Map<String, Object>> payload = ArgumentCaptor.forClass(Map.class);
            verify(provider).sendInteractive(eq(PHONE), payload.capture(), eq(INSTITUTE), any());
            assertThat(payload.getValue().get("interactiveType")).isEqualTo("button");
            assertThat((List<?>) payload.getValue().get("buttons")).hasSize(3);
            assertThat(ctx.getLastSentBody()).startsWith("Which year is your child in?");
            assertThat(ctx.getLastProviderMessageId()).isEqualTo("wamid.interactive");
        }

        @Test
        @DisplayName("4–10 options → a WhatsApp list")
        void upToTenOptionsAreAList() throws Exception {
            executor().execute(node("ASK_FIELD", dropdown(options("A", "B", "C", "D", "E"))),
                    session(Map.of()), "x", context("x"));
            @SuppressWarnings("unchecked")
            ArgumentCaptor<Map<String, Object>> payload = ArgumentCaptor.forClass(Map.class);
            verify(provider).sendInteractive(eq(PHONE), payload.capture(), eq(INSTITUTE), any());
            assertThat(payload.getValue().get("interactiveType")).isEqualTo("list");
        }

        @Test
        @DisplayName("More than 10 options, or multi-select → numbered text")
        void manyOptionsAreNumberedText() throws Exception {
            String[] labels = new String[12];
            for (int i = 0; i < 12; i++) labels[i] = "School " + (i + 1);
            executor().execute(node("ASK_FIELD", dropdown(options(labels))), session(Map.of()), "x", context("x"));
            ArgumentCaptor<String> text = ArgumentCaptor.forClass(String.class);
            verify(provider).sendText(eq(PHONE), text.capture(), eq(INSTITUTE), any());
            assertThat(text.getValue()).contains("1. School 1").contains("12. School 12");

            Map<String, Object> multi = dropdown(options("A", "B"));
            multi.put("fieldType", "multi_select");
            executor().execute(node("ASK_FIELD", multi), session(Map.of()), "x", context("x"));
            verify(provider, never()).sendInteractive(anyString(), anyMap(), anyString(), any());
        }

        @Test
        @DisplayName("Tapped button → option value saved to the session and to the lead straight away")
        void buttonAnswerIsSavedNow() throws Exception {
            when(leadClient.save(anyMap())).thenReturn(Map.of("result", "NEW"));
            Map<String, Object> sessionCtx = Map.of(
                    CrmLeadNodeSupport.KEY_RESPONSE_ID, "resp-1", CrmLeadNodeSupport.KEY_RESULT, "NEW");

            NodeExecutionResult result = executor().execute(
                    node("ASK_FIELD", dropdown(options("Year 4", "Year 5", "Year 6"))),
                    session(sessionCtx), "Year 5", reply("Year 5", "opt_1"));

            assertThat(result.isSuccess()).isTrue();
            assertThat(result.isWaitForInput()).isFalse();
            assertThat(result.getOutputVariables().get(CrmLeadNodeSupport.KEY_FIELDS))
                    .isEqualTo(Map.of(FIELD_ID, "YEAR_5"));
            @SuppressWarnings("unchecked")
            ArgumentCaptor<Map<String, Object>> request = ArgumentCaptor.forClass(Map.class);
            verify(leadClient).save(request.capture());
            assertThat(request.getValue())
                    .containsEntry("responseId", "resp-1")
                    .containsEntry("overwrite", true)
                    .containsEntry("complete", false)
                    .containsEntry("fieldValues", Map.of(FIELD_ID, "YEAR_5"));
            // Accepting an answer sends nothing.
            verify(provider, never()).sendText(anyString(), anyString(), anyString(), any());
        }

        @Test
        @DisplayName("Typed number or label matches an option; no lead id yet → nothing sent to admin-core")
        void typedAnswerMatchesOption() throws Exception {
            AskFieldNodeExecutor ex = executor();
            NodeExecutionResult byNumber = ex.execute(node("ASK_FIELD", dropdown(options("Year 4", "Year 5"))),
                    session(Map.of()), "2", reply("2", null));
            assertThat(byNumber.getOutputVariables().get(CrmLeadNodeSupport.KEY_FIELDS))
                    .isEqualTo(Map.of(FIELD_ID, "YEAR_5"));

            NodeExecutionResult byLabel = ex.execute(node("ASK_FIELD", dropdown(options("Year 4", "Year 5"))),
                    session(Map.of()), "year 4", reply("year 4", null));
            assertThat(byLabel.getOutputVariables().get(CrmLeadNodeSupport.KEY_FIELDS))
                    .isEqualTo(Map.of(FIELD_ID, "YEAR_4"));
            verify(leadClient, never()).save(anyMap());
        }

        @Test
        @DisplayName("Invalid answer → retry message + question again; after maxRetries the field is skipped")
        void invalidAnswerRetriesThenMovesOn() throws Exception {
            Map<String, Object> config = dropdown(options("Year 4", "Year 5"));
            config.put("retryMessage", "Please pick one of the options.");

            NodeExecutionResult first = executor().execute(node("ASK_FIELD", config), session(Map.of()),
                    "banana", reply("banana", null));
            assertThat(first.isWaitForInput()).isTrue();
            assertThat(first.getOutputVariables()).containsEntry("__ask_retry_node-ASK_FIELD", 1);
            @SuppressWarnings("unchecked")
            ArgumentCaptor<Map<String, Object>> payload = ArgumentCaptor.forClass(Map.class);
            verify(provider).sendInteractive(eq(PHONE), payload.capture(), eq(INSTITUTE), any());
            assertThat(payload.getValue().get("body").toString()).startsWith("Please pick one of the options.");

            NodeExecutionResult giveUp = executor().execute(node("ASK_FIELD", config),
                    session(Map.of("__ask_retry_node-ASK_FIELD", 2)), "banana", reply("banana", null));
            assertThat(giveUp.isSuccess()).isTrue();
            assertThat(giveUp.isWaitForInput()).isFalse();
            assertThat(giveUp.getOutputVariables()).doesNotContainKey(CrmLeadNodeSupport.KEY_FIELDS);
        }

        @Test
        @DisplayName("Multi-select answers are stored as a JSON array of option values")
        void multiSelectStoredAsJsonArray() throws Exception {
            Map<String, Object> config = dropdown(options("CSSE", "KEGS", "CCHS"));
            config.put("fieldType", "multi_select");
            NodeExecutionResult result = executor().execute(node("ASK_FIELD", config), session(Map.of()),
                    "1, 3", reply("1, 3", null));
            assertThat(result.getOutputVariables().get(CrmLeadNodeSupport.KEY_FIELDS))
                    .isEqualTo(Map.of(FIELD_ID, "[\"CSSE\",\"CCHS\"]"));
        }

        @Test
        @DisplayName("Free-text fields are validated by type")
        void typedFieldsAreValidated() throws Exception {
            Map<String, Object> email = new HashMap<>(Map.of("fieldSource", "SYSTEM_FIELD", "systemField", "email"));
            assertThat(executor().execute(node("ASK_FIELD", email), session(Map.of()), "not-an-email",
                    reply("not-an-email", null)).isWaitForInput()).isTrue();
            NodeExecutionResult ok = executor().execute(node("ASK_FIELD", email), session(Map.of()),
                    "asha@example.com", reply("asha@example.com", null));
            assertThat(ok.getOutputVariables().get(CrmLeadNodeSupport.KEY_SYSTEM))
                    .isEqualTo(Map.of("email", "asha@example.com"));

            Map<String, Object> date = new HashMap<>(Map.of("fieldSource", "CUSTOM_FIELD",
                    "customFieldId", "cf-dob", "fieldType", "date", "fieldName", "Date of birth"));
            NodeExecutionResult dob = executor().execute(node("ASK_FIELD", date), session(Map.of()),
                    "28/09/2016", reply("28/09/2016", null));
            assertThat(dob.getOutputVariables().get(CrmLeadNodeSupport.KEY_FIELDS))
                    .isEqualTo(Map.of("cf-dob", "2016-09-28"));
        }

        @Test
        @DisplayName("Checkbox → Yes / No buttons, stored as true / false like the lead form")
        void checkboxStoredAsTrueFalse() throws Exception {
            Map<String, Object> config = new HashMap<>(Map.of("fieldSource", "CUSTOM_FIELD",
                    "customFieldId", "cf-consent", "fieldType", "checkbox", "fieldName", "Consent"));
            NodeExecutionResult result = executor().execute(node("ASK_FIELD", config), session(Map.of()),
                    "yes", reply("yes", null));
            assertThat(result.getOutputVariables().get(CrmLeadNodeSupport.KEY_FIELDS))
                    .isEqualTo(Map.of("cf-consent", "true"));
        }

        @Test
        @DisplayName("Skip is accepted only when allowed, and records nothing")
        void skip() throws Exception {
            Map<String, Object> config = dropdown(options("Year 4", "Year 5"));
            config.put("allowSkip", true);
            NodeExecutionResult result = executor().execute(node("ASK_FIELD", config), session(Map.of()),
                    "Skip", reply("Skip", "skip"));
            assertThat(result.isWaitForInput()).isFalse();
            assertThat(result.getOutputVariables()).doesNotContainKey(CrmLeadNodeSupport.KEY_FIELDS);
        }

        @Test
        @DisplayName("A node with no field picked is skipped instead of stranding the chat")
        void unconfiguredNodeIsSkipped() throws Exception {
            NodeExecutionResult result = executor().execute(node("ASK_FIELD", Map.of()), session(Map.of()),
                    "x", context("x"));
            assertThat(result.isSuccess()).isTrue();
            assertThat(result.isWaitForInput()).isFalse();
            verify(provider, never()).sendText(anyString(), anyString(), anyString(), any());
        }
    }

    // ==================== CRM_LEAD_CHECK ====================

    @Nested
    @DisplayName("CRM_LEAD_CHECK")
    class LeadCheck {

        private CrmLeadCheckNodeExecutor executor() {
            return new CrmLeadCheckNodeExecutor(support, leadClient);
        }

        @Test
        @DisplayName("Existing lead → EXISTING (strict), welcome-back message, team alerted, user linked")
        void existingLead() throws Exception {
            when(leadClient.check(anyMap())).thenReturn(Map.of(
                    "result", "EXISTING", "responseId", "resp-9", "userId", "user-9"));
            ChatbotFlowSession session = session(Map.of());
            FlowExecutionContext ctx = context("Hi, enquiry");

            NodeExecutionResult result = executor().execute(node("CRM_LEAD_CHECK",
                    Map.of("existingMessage", "Welcome back!", "notifyTeam", true)), session, "Hi, enquiry", ctx);

            assertThat(result.getSelectedBranchId()).isEqualTo("EXISTING");
            assertThat(result.isStrictBranch()).isTrue();
            assertThat(result.getOutputVariables())
                    .containsEntry(CrmLeadNodeSupport.KEY_RESPONSE_ID, "resp-9")
                    .containsEntry(CrmLeadNodeSupport.KEY_RESULT, "EXISTING");
            assertThat(session.getUserId()).isEqualTo("user-9");
            assertThat(ctx.getUserId()).isEqualTo("user-9");
            verify(provider).sendText(PHONE, "Welcome back!", INSTITUTE, null);
            assertThat(ctx.getLastSentBody()).isEqualTo("Welcome back!");
            ArgumentCaptor<ChatbotEscalationService.EscalationRequest> esc =
                    ArgumentCaptor.forClass(ChatbotEscalationService.EscalationRequest.class);
            verify(escalationService).raise(esc.capture());
            assertThat(esc.getValue().getReason()).isEqualTo(EscalationReason.EXISTING_LEAD);
            assertThat(esc.getValue().getUserName()).isEqualTo("Asha");

            @SuppressWarnings("unchecked")
            ArgumentCaptor<Map<String, Object>> request = ArgumentCaptor.forClass(Map.class);
            verify(leadClient).check(request.capture());
            assertThat(request.getValue())
                    .containsEntry("phone", PHONE)
                    .containsEntry("name", "Asha")
                    .containsEntry("messageText", "Hi, enquiry");
        }

        @Test
        @DisplayName("New lead → NEW, no message, no alert")
        void newLead() throws Exception {
            when(leadClient.check(anyMap())).thenReturn(Map.of("result", "NEW", "responseId", "resp-1"));
            NodeExecutionResult result = executor().execute(node("CRM_LEAD_CHECK",
                    Map.of("existingMessage", "Welcome back!")), session(Map.of()), "hi", context("hi"));
            assertThat(result.getSelectedBranchId()).isEqualTo("NEW");
            verify(provider, never()).sendText(anyString(), anyString(), anyString(), any());
            verify(escalationService, never()).raise(any());
        }

        @Test
        @DisplayName("admin-core down → carry on as NEW with lead_result UNKNOWN")
        void lookupFailureContinuesAsNew() throws Exception {
            when(leadClient.check(anyMap())).thenThrow(new IllegalStateException("503"));
            NodeExecutionResult result = executor().execute(node("CRM_LEAD_CHECK", Map.of()),
                    session(Map.of()), "hi", context("hi"));
            assertThat(result.isSuccess()).isTrue();
            assertThat(result.getSelectedBranchId()).isEqualTo("NEW");
            assertThat(result.getOutputVariables()).containsEntry(CrmLeadNodeSupport.KEY_RESULT, "UNKNOWN");
            verify(escalationService, never()).raise(any());
        }

        @Test
        @DisplayName("notifyTeam=false → no alert for an existing lead")
        void noAlertWhenDisabled() throws Exception {
            when(leadClient.check(anyMap())).thenReturn(Map.of("result", "EXISTING", "responseId", "resp-9"));
            executor().execute(node("CRM_LEAD_CHECK", Map.of("notifyTeam", false)), session(Map.of()),
                    "hi", context("hi"));
            verify(escalationService, never()).raise(any());
        }
    }

    // ==================== SAVE_TO_CRM ====================

    @Nested
    @DisplayName("SAVE_TO_CRM")
    class SaveToCrm {

        private SaveToCrmNodeExecutor executor() {
            return new SaveToCrmNodeExecutor(support, leadClient);
        }

        private Map<String, Object> collected() {
            Map<String, Object> ctx = new HashMap<>();
            ctx.put(CrmLeadNodeSupport.KEY_RESPONSE_ID, "resp-1");
            ctx.put(CrmLeadNodeSupport.KEY_RESULT, "NEW");
            ctx.put(CrmLeadNodeSupport.KEY_FIELDS, Map.of(FIELD_ID, "YEAR_5"));
            ctx.put(CrmLeadNodeSupport.KEY_FIELD_LABELS, Map.of(FIELD_ID, "Year Group"));
            ctx.put(CrmLeadNodeSupport.KEY_SYSTEM, Map.of("full_name", "Asha Patel"));
            return ctx;
        }

        @Test
        @DisplayName("Sends every collected answer with complete + fireWorkflow + status")
        void sendsEverything() throws Exception {
            when(leadClient.save(anyMap())).thenReturn(Map.of("result", "NEW", "responseId", "resp-1"));
            NodeExecutionResult result = executor().execute(node("SAVE_TO_CRM",
                    Map.of("statusKey", "NEW_ENQUIRY", "successMessage", "Thanks!")), session(collected()),
                    "Online", context("Online"));

            assertThat(result.isSuccess()).isTrue();
            @SuppressWarnings("unchecked")
            ArgumentCaptor<Map<String, Object>> request = ArgumentCaptor.forClass(Map.class);
            verify(leadClient).save(request.capture());
            assertThat(request.getValue())
                    .containsEntry("responseId", "resp-1")
                    .containsEntry("overwrite", true)
                    .containsEntry("complete", true)
                    .containsEntry("fireWorkflow", true)
                    .containsEntry("statusKey", "NEW_ENQUIRY")
                    .containsEntry("fullName", "Asha Patel")
                    .containsEntry("fieldValues", Map.of(FIELD_ID, "YEAR_5"));
            verify(provider).sendText(PHONE, "Thanks!", INSTITUTE, null);
        }

        @Test
        @DisplayName("fireWorkflows=false → admin-core is told not to run the lead workflows")
        void workflowsCanBeTurnedOff() throws Exception {
            when(leadClient.save(anyMap())).thenReturn(Map.of("result", "NEW", "responseId", "resp-1"));
            executor().execute(node("SAVE_TO_CRM", Map.of("fireWorkflows", false)), session(collected()),
                    "Online", context("Online"));
            @SuppressWarnings("unchecked")
            ArgumentCaptor<Map<String, Object>> request = ArgumentCaptor.forClass(Map.class);
            verify(leadClient).save(request.capture());
            assertThat(request.getValue()).containsEntry("fireWorkflow", false).containsEntry("complete", true);
        }

        @Test
        @DisplayName("admin-core down → team alerted with the answers, the user still thanked")
        void failureAlertsTeamWithAnswers() throws Exception {
            when(leadClient.save(anyMap())).thenThrow(new IllegalStateException("503"));
            NodeExecutionResult result = executor().execute(node("SAVE_TO_CRM",
                    Map.of("successMessage", "Thanks!")), session(collected()), "Online", context("Online"));

            assertThat(result.isSuccess()).isTrue();
            ArgumentCaptor<ChatbotEscalationService.EscalationRequest> esc =
                    ArgumentCaptor.forClass(ChatbotEscalationService.EscalationRequest.class);
            verify(escalationService).raise(esc.capture());
            assertThat(esc.getValue().getReason()).isEqualTo(EscalationReason.CRM_SAVE_FAILED);
            assertThat(esc.getValue().getUserMessage())
                    .contains("Name: Asha Patel").contains("Year Group: YEAR_5");
            verify(provider).sendText(PHONE, "Thanks!", INSTITUTE, null);
        }
    }
}
