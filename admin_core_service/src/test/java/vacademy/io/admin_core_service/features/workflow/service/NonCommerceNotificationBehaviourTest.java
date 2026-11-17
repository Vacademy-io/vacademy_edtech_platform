package vacademy.io.admin_core_service.features.workflow.service;

import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.transaction.support.TransactionTemplate;
import vacademy.io.admin_core_service.features.commerce.notify.CommerceNotificationOutbox;
import vacademy.io.admin_core_service.features.commerce.notify.FakeTransactions;
import vacademy.io.admin_core_service.features.commerce.notify.LogCapture;
import vacademy.io.admin_core_service.features.commerce.notify.repository.CommerceNotificationStore;
import vacademy.io.admin_core_service.features.commerce.order.desk.CommerceOrderEvents;
import vacademy.io.admin_core_service.features.notification.dto.MessageOrigin;
import vacademy.io.admin_core_service.features.notification.dto.UnifiedSendRequest;
import vacademy.io.admin_core_service.features.notification.dto.UnifiedSendResponse;
import vacademy.io.admin_core_service.features.notification.dto.WhatsappRequest;
import vacademy.io.admin_core_service.features.notification_service.service.NotificationService;

import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyMap;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doReturn;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.spy;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;

/**
 * What WP-33 touched outside the buyer's messages behaves as before: an order event the buyer
 * is not told about writes no outbox row and is published as it always was; the WhatsApp bridge
 * builds the same unified request (only its log line changed); and a non-commerce workflow event
 * still resolves its triggers and runs them with the same seed context.
 */
class NonCommerceNotificationBehaviourTest {

    // ================================================================== order events

    @Test
    void anOrderEventTheBuyerIsNotToldAboutWritesNoRowAndPublishesAsBefore() {
        CommerceNotificationStore store = mock(CommerceNotificationStore.class);
        FakeTransactions transactions = new FakeTransactions();
        ApplicationEventPublisher publisher = mock(ApplicationEventPublisher.class);
        CommerceOrderEvents events = new CommerceOrderEvents(publisher);
        events.setOutbox(new CommerceNotificationOutbox(store, transactions));
        CommerceOrderEvents.OrderEvent silent = new CommerceOrderEvents.OrderEvent(CommerceOrderEvents.ORDER_SHIPPED,
                "inst-1", "order-1", "SH-1", "ship-1", false);
        CommerceOrderEvents.OrderEvent other = new CommerceOrderEvents.OrderEvent("SHIPMENT_UNDONE", "inst-1",
                "order-1", "SH-1", "ship-1", true);

        // Inside a transaction: published after its commit, never before.
        new TransactionTemplate(transactions).executeWithoutResult(status -> {
            events.afterCommit(silent);
            events.afterCommit(other);
            verify(publisher, never()).publishEvent(any());
        });
        verify(publisher).publishEvent(silent);
        verify(publisher).publishEvent(other);
        assertEquals(1, transactions.committed, "no transaction of the outbox's own");

        // Without one: published at once.
        events.afterCommit(silent);
        verify(publisher, times(2)).publishEvent(silent);
        // A rolled-back change publishes nothing.
        new TransactionTemplate(transactions).executeWithoutResult(status -> {
            events.afterCommit(other);
            status.setRollbackOnly();
        });
        verify(publisher, times(1)).publishEvent(other);
        verifyNoInteractions(store);

        // Built by hand without an outbox (as older tests do): the same.
        ApplicationEventPublisher plain = mock(ApplicationEventPublisher.class);
        CommerceOrderEvents bare = new CommerceOrderEvents(plain);
        CommerceOrderEvents.OrderEvent told = new CommerceOrderEvents.OrderEvent(CommerceOrderEvents.ORDER_CONFIRMED,
                "inst-1", "order-1", "SH-1", null, true);
        bare.afterCommit(told);
        bare.afterCommit(null);
        verify(plain).publishEvent(told);
        // The six-field event of before still reads its shipment as before.
        assertEquals("ship-1", silent.shipmentId());
        assertFalse(silent.notifyCustomer());
    }

    // ================================================================== WhatsApp bridge

    @Test
    void theWhatsAppBridgeBuildsTheSameUnifiedRequestAsBefore() {
        NotificationService service = spy(new NotificationService());
        UnifiedSendResponse ok = UnifiedSendResponse.builder().status("COMPLETED").total(2).accepted(2).build();
        doReturn(ok).when(service).sendUnified(any());

        WhatsappRequest request = new WhatsappRequest();
        request.setTemplateName("welcome_learner");
        request.setHeaderType("image");
        Map<String, Map<String, String>> first = new LinkedHashMap<>();
        first.put("+91 98765-43210", Map.of("name", "Learner One"));
        Map<String, Map<String, String>> second = new LinkedHashMap<>();
        second.put("919876500001", Map.of("name", "Learner Two"));
        request.setUserDetails(List.of(first, second));
        request.setHeaderParams(Map.of("919876543210", Map.of("1", "https://img.example.com/a.png")));
        request.setButtonUrlParams(Map.of("919876543210", "course-7"));
        request.setButtonIndexParams(Map.of("919876543210", "1"));
        request.setHeaderVideoParams(Map.of("919876500001", "https://video.example.com/b.mp4"));

        UnifiedSendResponse answer;
        try (LogCapture logs = LogCapture.of("vacademy.io.admin_core_service.features.notification_service")) {
            answer = service.sendWhatsappViaUnified(request, "inst-1", new MessageOrigin("WORKFLOW", "wf-1",
                    "Welcome"));
            String line = logs.messages().stream().filter(m -> m.startsWith("sendWhatsappViaUnified:")).findFirst()
                    .orElseThrow();
            assertEquals("sendWhatsappViaUnified: template=welcome_learner, userDetails=2, headerParams=1, "
                    + "headerVideoParams=1, buttonUrlParams=1, buttonIndexParams=1, headerType=image", line);
            for (String text : logs.everything()) {
                assertFalse(text.contains("98765"), text);
            }
        }
        assertEquals(ok, answer);

        Map<String, String> firstVars = new HashMap<>();
        firstVars.put("name", "Learner One");
        firstVars.put("_headerUrl", "https://img.example.com/a.png");
        firstVars.put("_headerType", "image");
        firstVars.put("_buttonUrl", "course-7");
        firstVars.put("_buttonIndex", "1");
        Map<String, String> secondVars = new HashMap<>();
        secondVars.put("name", "Learner Two");
        secondVars.put("_headerUrl", "https://video.example.com/b.mp4");
        secondVars.put("_headerType", "video");
        UnifiedSendRequest expected = UnifiedSendRequest.builder()
                .instituteId("inst-1")
                .channel("WHATSAPP")
                .templateName("welcome_learner")
                .languageCode("en")
                .recipients(List.of(
                        UnifiedSendRequest.Recipient.builder().phone("919876543210").variables(firstVars).build(),
                        UnifiedSendRequest.Recipient.builder().phone("919876500001").variables(secondVars).build()))
                .options(UnifiedSendRequest.SendOptions.builder().source("whatsapp-bridge").headerType("image")
                        .originType("WORKFLOW").originId("wf-1").originName("Welcome").build())
                .build();
        ArgumentCaptor<UnifiedSendRequest> sent = ArgumentCaptor.forClass(UnifiedSendRequest.class);
        verify(service).sendUnified(sent.capture());
        assertEquals(expected, sent.getValue());

        // The two-argument form: no origin, the request's own language.
        WhatsappRequest plain = new WhatsappRequest();
        plain.setTemplateName("fee_reminder");
        plain.setLanguageCode("hi");
        plain.setUserDetails(List.of(Map.of("9876500002", Map.of("amount", "₹500"))));
        service.sendWhatsappViaUnified(plain, "inst-1");
        verify(service, times(2)).sendUnified(sent.capture());
        assertEquals(UnifiedSendRequest.builder().instituteId("inst-1").channel("WHATSAPP").templateName("fee_reminder")
                .languageCode("hi").recipients(List.of(UnifiedSendRequest.Recipient.builder().phone("9876500002")
                        .variables(Map.of("amount", "₹500")).build()))
                .options(UnifiedSendRequest.SendOptions.builder().source("whatsapp-bridge").build()).build(),
                sent.getValue());
    }

    // ================================================================== workflow engine

    @Test
    void aNonCommerceEventStillResolvesAndRunsItsTriggersAsBefore() {
        WorkflowTriggerServiceLogTest.Engine engine = new WorkflowTriggerServiceLogTest.Engine(
                "LEARNER_BATCH_ENROLLMENT");
        Map<String, Object> context = new HashMap<>(Map.of("userId", "user-1", "packageSessionId", "ps-1"));

        Map<String, Object> result = engine.service.handleTriggerEvents("LEARNER_BATCH_ENROLLMENT", "ps-1", "inst-1",
                context);

        assertEquals(Map.of("done", true), result);
        verify(engine.repository).findSpecificTriggers(eq("inst-1"), eq("ps-1"), eq("LEARNER_BATCH_ENROLLMENT"),
                eq(List.of("ACTIVE")));
        verify(engine.repository).findGlobalTriggers(eq("inst-1"), eq("LEARNER_BATCH_ENROLLMENT"),
                eq(List.of("ACTIVE")));
        verify(engine.keys).generateKey(engine.trigger, "LEARNER_BATCH_ENROLLMENT", "ps-1", context);
        verify(engine.idempotency).markAsProcessingForTrigger("key-1", "wf-1", "tr-1");
        @SuppressWarnings("unchecked")
        ArgumentCaptor<Map<String, Object>> seed = ArgumentCaptor.forClass(Map.class);
        verify(engine.runner).run(eq("wf-1"), seed.capture());
        Map<String, Object> s = seed.getValue();
        assertEquals("user-1", s.get("userId"));
        assertEquals("ps-1", s.get("packageSessionId"));
        assertEquals("LEARNER_BATCH_ENROLLMENT", s.get("triggerEvents"));
        assertEquals("tr-1", s.get("triggerId"));
        assertEquals("inst-1", s.get("instituteId"));
        assertEquals("ex-1", s.get("executionId"));
        assertEquals("ps-1", s.get("eventId"));
        assertEquals(Boolean.TRUE, s.get("isGlobalTrigger"));
        assertTrue(s.containsKey("triggerTime"));
        verify(engine.idempotency).markAsCompleted("key-1", Map.of("done", true));
        assertEquals(2, context.size(), "the caller's context is not changed");

        // A trigger attached to the entity takes priority over the institute-wide ones.
        WorkflowTriggerServiceLogTest.Engine specific = new WorkflowTriggerServiceLogTest.Engine("LIVE_SESSION_START");
        org.mockito.Mockito.when(specific.repository.findSpecificTriggers(anyString(), anyString(), anyString(),
                anyList())).thenReturn(List.of(specific.trigger));
        specific.service.handleTriggerEvents("LIVE_SESSION_START", "ls-1", "inst-1", Map.of("sessionId", "ls-1"));
        verify(specific.repository, never()).findGlobalTriggers(anyString(), anyString(), anyList());
        verify(specific.runner).run(eq("wf-1"), anyMap());
    }
}
