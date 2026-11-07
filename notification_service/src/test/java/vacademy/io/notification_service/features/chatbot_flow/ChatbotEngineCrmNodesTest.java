package vacademy.io.notification_service.features.chatbot_flow;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import vacademy.io.notification_service.features.chatbot_flow.engine.ChatbotFlowEngine;
import vacademy.io.notification_service.features.chatbot_flow.engine.ChatbotNodeExecutor;
import vacademy.io.notification_service.features.chatbot_flow.engine.FlowExecutionContext;
import vacademy.io.notification_service.features.chatbot_flow.engine.NodeExecutionResult;
import vacademy.io.notification_service.features.chatbot_flow.entity.ChatbotFlow;
import vacademy.io.notification_service.features.chatbot_flow.entity.ChatbotFlowEdge;
import vacademy.io.notification_service.features.chatbot_flow.entity.ChatbotFlowNode;
import vacademy.io.notification_service.features.chatbot_flow.entity.ChatbotFlowSession;
import vacademy.io.notification_service.features.chatbot_flow.repository.ChatbotDelayTaskRepository;
import vacademy.io.notification_service.features.chatbot_flow.repository.ChatbotFlowEdgeRepository;
import vacademy.io.notification_service.features.chatbot_flow.repository.ChatbotFlowNodeRepository;
import vacademy.io.notification_service.features.chatbot_flow.repository.ChatbotFlowRepository;
import vacademy.io.notification_service.features.chatbot_flow.repository.ChatbotFlowSessionRepository;
import vacademy.io.notification_service.features.chatbot_flow.service.UserLookupService;
import vacademy.io.notification_service.features.chatbot_flow.service.WhatsAppSendFailureService;
import vacademy.io.notification_service.features.notification_log.entity.NotificationLog;
import vacademy.io.notification_service.features.notification_log.repository.NotificationLogRepository;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Engine behaviour the CRM nodes rely on: strict branching for CRM_LEAD_CHECK, ASK_FIELD's
 * ask → wait → answer cycle, and Inbox logging of what a CRM node reports having sent.
 */
class ChatbotEngineCrmNodesTest {

    private static final String INSTITUTE = "inst-1";
    private static final String PHONE = "447911123456";
    private static final String CHANNEL = "WHATSAPP_META";

    private ChatbotFlowRepository flowRepository;
    private ChatbotFlowNodeRepository nodeRepository;
    private ChatbotFlowEdgeRepository edgeRepository;
    private ChatbotFlowSessionRepository sessionRepository;
    private NotificationLogRepository logRepository;
    private final Map<String, ChatbotFlowNode> nodes = new HashMap<>();
    private final Map<String, List<ChatbotFlowEdge>> edges = new HashMap<>();
    private final AtomicReference<ChatbotFlowSession> stored = new AtomicReference<>();

    @BeforeEach
    void setUp() {
        flowRepository = mock(ChatbotFlowRepository.class);
        nodeRepository = mock(ChatbotFlowNodeRepository.class);
        edgeRepository = mock(ChatbotFlowEdgeRepository.class);
        sessionRepository = mock(ChatbotFlowSessionRepository.class);
        logRepository = mock(NotificationLogRepository.class);

        ChatbotFlow flow = ChatbotFlow.builder().id("flow-1").instituteId(INSTITUTE).channelType(CHANNEL)
                .status("ACTIVE").name("Enquiry").build();
        when(flowRepository.findByInstituteIdAndChannelTypeAndStatus(anyString(), anyString(), anyString()))
                .thenReturn(List.of(flow));
        when(nodeRepository.findByFlowIdAndNodeType("flow-1", "TRIGGER"))
                .thenAnswer(inv -> List.of(nodes.get("trigger")));
        when(nodeRepository.findById(anyString()))
                .thenAnswer(inv -> Optional.ofNullable(nodes.get(inv.getArgument(0, String.class))));
        when(edgeRepository.findBySourceNodeIdOrderBySortOrder(anyString()))
                .thenAnswer(inv -> edges.getOrDefault(inv.getArgument(0, String.class), List.of()));
        when(sessionRepository.save(any(ChatbotFlowSession.class))).thenAnswer(inv -> {
            ChatbotFlowSession s = inv.getArgument(0);
            if (s.getId() == null) s.setId("sess-1");
            stored.set(s);
            return s;
        });
        when(sessionRepository.findFirstByInstituteIdAndUserPhoneAndStatusOrderByLastActivityAtDesc(
                anyString(), anyString(), eq("ACTIVE")))
                .thenAnswer(inv -> Optional.ofNullable(stored.get())
                        .filter(s -> "ACTIVE".equals(s.getStatus())));

        node("trigger", "TRIGGER");
    }

    private ChatbotFlowNode node(String id, String type) {
        ChatbotFlowNode n = ChatbotFlowNode.builder().id(id).flowId("flow-1").nodeType(type).name(id).config("{}").build();
        nodes.put(id, n);
        return n;
    }

    private void edge(String from, String to, String branchId) {
        ChatbotFlowEdge e = ChatbotFlowEdge.builder().id(from + "->" + to).flowId("flow-1")
                .sourceNodeId(from).targetNodeId(to)
                .conditionConfig(branchId == null ? null : "{\"branchId\":\"" + branchId + "\"}")
                .build();
        edges.computeIfAbsent(from, k -> new ArrayList<>()).add(e);
    }

    private static ChatbotNodeExecutor executor(String type, java.util.function.Function<FlowExecutionContext, NodeExecutionResult> body) {
        ChatbotNodeExecutor ex = mock(ChatbotNodeExecutor.class);
        when(ex.canHandle(anyString())).thenAnswer(inv -> type.equals(inv.getArgument(0)));
        when(ex.execute(any(), any(), any(), any())).thenAnswer(inv -> body.apply(inv.getArgument(3)));
        return ex;
    }

    private ChatbotFlowEngine engine(ChatbotNodeExecutor... executors) {
        UserLookupService lookup = mock(UserLookupService.class);
        return new ChatbotFlowEngine(flowRepository, nodeRepository, edgeRepository, sessionRepository,
                mock(ChatbotDelayTaskRepository.class), logRepository, List.of(executors), new ObjectMapper(),
                lookup, mock(WhatsAppSendFailureService.class));
    }

    private boolean send(ChatbotFlowEngine engine, String text) {
        return engine.handleIncomingMessage(INSTITUTE, CHANNEL, PHONE, text, "biz-1", "text", null, null, null);
    }

    private static ChatbotNodeExecutor trigger() {
        return executor("TRIGGER", ctx -> NodeExecutionResult.builder().success(true).build());
    }

    @Test
    @DisplayName("Strict branch with no matching edge ends the flow — an existing lead never falls into the questions")
    void strictBranchWithoutEdgeEndsFlow() {
        node("check", "CRM_LEAD_CHECK");
        node("ask", "SEND_MESSAGE");
        edge("trigger", "check", null);
        edge("check", "ask", "NEW"); // only the NEW output is connected

        ChatbotNodeExecutor check = executor("CRM_LEAD_CHECK", ctx -> NodeExecutionResult.builder()
                .success(true).selectedBranchId("EXISTING").strictBranch(true).build());
        ChatbotNodeExecutor next = executor("SEND_MESSAGE", ctx -> NodeExecutionResult.builder().success(true).build());

        assertThat(send(engine(trigger(), check, next), "enquiry")).isTrue();

        verify(next, never()).execute(any(), any(), any(), any());
        assertThat(stored.get().getStatus()).isEqualTo("COMPLETED");
    }

    @Test
    @DisplayName("Strict branch follows the matching edge")
    void strictBranchFollowsMatchingEdge() {
        node("check", "CRM_LEAD_CHECK");
        node("welcome", "SEND_MESSAGE");
        node("ask", "SEND_TEMPLATE");
        edge("trigger", "check", null);
        edge("check", "ask", "NEW");
        edge("check", "welcome", "EXISTING");

        ChatbotNodeExecutor check = executor("CRM_LEAD_CHECK", ctx -> NodeExecutionResult.builder()
                .success(true).selectedBranchId("EXISTING").strictBranch(true).build());
        ChatbotNodeExecutor welcome = executor("SEND_MESSAGE", ctx -> NodeExecutionResult.builder().success(true).build());
        ChatbotNodeExecutor ask = executor("SEND_TEMPLATE", ctx -> NodeExecutionResult.builder().success(true).build());

        send(engine(trigger(), check, welcome, ask), "enquiry");

        verify(welcome).execute(any(), any(), any(), any());
        verify(ask, never()).execute(any(), any(), any(), any());
    }

    @Test
    @DisplayName("ASK_FIELD: asks on arrival and waits; the reply comes back flagged, the next node runs unflagged")
    void askFieldWaitsThenAdvances() {
        node("ask", "ASK_FIELD");
        node("save", "SAVE_TO_CRM");
        edge("trigger", "ask", null);
        edge("ask", "save", null);

        List<Boolean> askFlags = new ArrayList<>();
        ChatbotNodeExecutor ask = executor("ASK_FIELD", ctx -> {
            askFlags.add(ctx.isReplyToWaitingNode());
            if (!ctx.isReplyToWaitingNode()) {
                ctx.setLastSentBody("Which year?");
                return NodeExecutionResult.builder().success(true).waitForInput(true).build();
            }
            return NodeExecutionResult.builder().success(true).build();
        });
        List<Boolean> saveFlags = new ArrayList<>();
        ChatbotNodeExecutor save = executor("SAVE_TO_CRM", ctx -> {
            saveFlags.add(ctx.isReplyToWaitingNode());
            return NodeExecutionResult.builder().success(true).build();
        });
        ChatbotFlowEngine engine = engine(trigger(), ask, save);

        send(engine, "enquiry");
        assertThat(askFlags).containsExactly(false);
        assertThat(saveFlags).isEmpty();
        assertThat(stored.get().getCurrentNodeId()).isEqualTo("ask");
        assertThat(stored.get().getStatus()).isEqualTo("ACTIVE");

        // The question was logged for the Inbox with the text the node reported.
        ArgumentCaptor<NotificationLog> logged = ArgumentCaptor.forClass(NotificationLog.class);
        verify(logRepository).save(logged.capture());
        assertThat(logged.getValue().getBody()).isEqualTo("Which year?");
        assertThat(logged.getValue().getSource()).isEqualTo("CHATBOT_FLOW");

        send(engine, "Year 5");
        assertThat(askFlags).containsExactly(false, true);
        assertThat(saveFlags).containsExactly(false);
        assertThat(stored.get().getStatus()).isEqualTo("COMPLETED");
        // Accepting the answer sent nothing, so no second Inbox row.
        verify(logRepository, times(1)).save(any(NotificationLog.class));
    }

    @Test
    @DisplayName("ASK_FIELD re-asking after a bad answer keeps the session on the node")
    void askFieldRetryStaysOnNode() {
        node("ask", "ASK_FIELD");
        node("save", "SAVE_TO_CRM");
        edge("trigger", "ask", null);
        edge("ask", "save", null);

        ChatbotNodeExecutor ask = executor("ASK_FIELD", ctx -> {
            ctx.setLastSentBody(ctx.isReplyToWaitingNode() ? "Sorry, try again. Which year?" : "Which year?");
            return NodeExecutionResult.builder().success(true).waitForInput(true).build();
        });
        ChatbotNodeExecutor save = executor("SAVE_TO_CRM", ctx -> NodeExecutionResult.builder().success(true).build());
        ChatbotFlowEngine engine = engine(trigger(), ask, save);

        send(engine, "enquiry");
        send(engine, "banana");

        verify(save, never()).execute(any(), any(), any(), any());
        assertThat(stored.get().getCurrentNodeId()).isEqualTo("ask");
        assertThat(stored.get().getStatus()).isEqualTo("ACTIVE");
        verify(logRepository, times(2)).save(any(NotificationLog.class));
    }
}
