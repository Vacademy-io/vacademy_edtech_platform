package vacademy.io.admin_core_service.features.commerce.notify;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.web.client.HttpClientErrorException;
import org.springframework.web.client.ResourceAccessException;
import vacademy.io.admin_core_service.features.auth_service.service.AuthService;
import vacademy.io.admin_core_service.features.commerce.audit.CommerceAuditService;
import vacademy.io.admin_core_service.features.commerce.notify.repository.CommerceNotificationStore;
import vacademy.io.admin_core_service.features.commerce.order.checkout.CheckoutException;
import vacademy.io.admin_core_service.features.commerce.order.checkout.CommerceOrderAccessTokens;
import vacademy.io.admin_core_service.features.commerce.order.checkout.CommerceOrderLinkService;
import vacademy.io.admin_core_service.features.commerce.order.desk.CommerceOrderDeskService;
import vacademy.io.admin_core_service.features.commerce.order.dto.CheckoutDtos;
import vacademy.io.admin_core_service.features.commerce.otp.CommerceRateLimiter;
import vacademy.io.admin_core_service.features.commerce.security.CommerceAccessGuard;
import vacademy.io.admin_core_service.features.commerce.security.CommerceSetupAccess;
import vacademy.io.admin_core_service.features.workflow.entity.Workflow;
import vacademy.io.admin_core_service.features.workflow.entity.WorkflowExecution;
import vacademy.io.admin_core_service.features.workflow.entity.WorkflowTrigger;
import vacademy.io.admin_core_service.features.workflow.repository.WorkflowTriggerRepository;
import vacademy.io.admin_core_service.features.workflow.service.IdempotencyService;
import vacademy.io.admin_core_service.features.workflow.service.WorkflowEngineService;
import vacademy.io.admin_core_service.features.workflow.service.WorkflowTriggerService;
import vacademy.io.admin_core_service.features.workflow.service.idempotency.IdempotencyStrategyFactory;
import vacademy.io.admin_core_service.features.workflow.util.WorkflowSubjectResolver;
import vacademy.io.common.auth.dto.UserDTO;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.net.ConnectException;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyMap;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * No buyer's contact, name, token or link reaches a log line of commerce or the workflow engine:
 * the planner, the sender (every channel, a provider refusal that quotes the number and the
 * address, an unreachable platform, a workflow), a staff member's test message, the link
 * exchange, and the workflow engine run with a buyer's context. Every formatted message, raw
 * pattern, argument and exception message is checked.
 */
class CommerceNotificationLogHygieneTest {

    private static final String PHONE_DIGITS = "919876543210";
    private static final Pattern EMAIL_ADDRESS = Pattern.compile("[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\\.[A-Za-z0-9.-]+");
    private static final Pattern TOKEN = Pattern.compile("(?<![A-Za-z0-9])[lsv]1\\.[A-Za-z0-9_-]{8,}");

    private static void assertClean(LogCapture logs, String... secrets) {
        List<String> texts = logs.everything();
        assertFalse(texts.isEmpty(), "the run logged something to check");
        for (String text : texts) {
            if (text == null) {
                continue;
            }
            for (int i = 0; i + 6 <= PHONE_DIGITS.length(); i++) {
                assertFalse(text.contains(PHONE_DIGITS.substring(i, i + 6)), "phone digits in: " + text);
            }
            assertFalse(EMAIL_ADDRESS.matcher(text).find(), "an e-mail address in: " + text);
            assertFalse(text.contains("Asha") || text.contains("Verma"), "a name in: " + text);
            assertFalse(TOKEN.matcher(text).find(), "a token in: " + text);
            assertFalse(text.contains("l1.") || text.contains("v1."), "a token prefix in: " + text);
            assertFalse(text.contains("https://") || text.contains("#l=") || text.contains("shop.example.com"),
                    "a link in: " + text);
            for (String secret : secrets) {
                assertFalse(secret != null && !secret.isEmpty() && text.contains(secret), "a value in: " + text);
            }
        }
    }

    @Test
    void thePlannerAndTheSenderLogIdsAndCodesOnly() {
        DispatcherFixture f = new DispatcherFixture();
        f.order.customerPhone = "+91 98765 43210";
        f.order.put();
        try (LogCapture logs = LogCapture.of(LogCapture.COMMERCE, LogCapture.WORKFLOW)) {
            // Every channel sent.
            f.event("ORDER_CONFIRMED", "");
            f.dispatcher.dispatchOrder(DispatcherFixture.INST, DispatcherFixture.ORDER);
            // A provider refusal quoting the number and the address.
            f.answer = request -> DispatcherFixture.sentAnswer("FAILED", false, null,
                    "Recipient 919876543210 / asha.verma@example.com (Asha Verma) refused");
            f.event("ORDER_SHIPPED", "ship-1");
            f.dispatcher.dispatchOrder(DispatcherFixture.INST, DispatcherFixture.ORDER);
            // An unreachable platform whose message names the address.
            f.answer = request -> {
                throw new ResourceAccessException("I/O error for asha.verma@example.com",
                        new ConnectException("refused 919876543210"));
            };
            f.event("ORDER_DELIVERED", "ship-1");
            f.dispatcher.dispatchOrder(DispatcherFixture.INST, DispatcherFixture.ORDER);
            // A refusal of the request itself.
            f.answer = request -> {
                throw new HttpClientErrorException(HttpStatus.BAD_REQUEST, "bad phone 919876543210");
            };
            f.event("ORDER_RTO", "ship-1");
            f.dispatcher.dispatchOrder(DispatcherFixture.INST, DispatcherFixture.ORDER);
            // A workflow standing in, which fails.
            when(f.workflowService.hasActiveWorkflow(anyString(), anyString(), anyString())).thenReturn(true);
            when(f.workflowService.handleTriggerEvents(anyString(), anyString(), anyString(), anyMap()))
                    .thenThrow(new IllegalStateException("could not mail asha.verma@example.com"));
            f.event("ORDER_CANCELLED", "");
            f.dispatcher.dispatchOrder(DispatcherFixture.INST, DispatcherFixture.ORDER);
            // A workflow lookup error, a lost claim, the job.
            when(f.workflowService.hasActiveWorkflow(anyString(), anyString(), anyString()))
                    .thenThrow(new IllegalStateException("lookup for 919876543210"));
            f.event("RETURN_APPROVED", "ret-1");
            new CommerceNotificationJob(f.store, f.dispatcher).runOnce();
            assertTrue(f.sent.size() >= 4);
            assertTrue(logs.messages().stream().anyMatch(m -> m.contains("COMMERCE_ALERT")));
            assertClean(logs);
        }
    }

    @Test
    void aTestMessageLogsNoContact() {
        CommerceSetupAccess setupAccess = mock(CommerceSetupAccess.class);
        CommerceRateLimiter rateLimiter = mock(CommerceRateLimiter.class);
        when(rateLimiter.allow(anyString(), anyString(), anyString(), any(Duration.class), anyInt())).thenReturn(true);
        AuthService authService = mock(AuthService.class);
        UserDTO me = new UserDTO();
        me.setId("staff-1");
        me.setEmail("asha.verma@example.com");
        me.setMobileNumber("9876543210");
        me.setFullName("Asha Verma");
        when(authService.getUsersFromAuthServiceByUserIds(List.of("staff-1"))).thenReturn(List.of(me));
        DispatcherFixture f = new DispatcherFixture();
        f.answer = request -> {
            if ("WHATSAPP".equals(request.getChannel())) {
                throw new IllegalStateException("refused 919876543210");
            }
            return DispatcherFixture.sentAnswer("SENT", true, "m-1", null);
        };
        CommerceAuditService audit = mock(CommerceAuditService.class);
        org.mockito.Mockito.doThrow(new IllegalStateException("audit for asha.verma@example.com")).when(audit)
                .record(anyString(), anyString(), any(), anyString(), anyString(), any(), any(), any(), any());
        CommerceNotificationTestSendService service = new CommerceNotificationTestSendService(setupAccess,
                rateLimiter, authService, f.settings, f.templates, f.shopSettings, f.store,
                new CommerceNotificationMessages(new CommerceNotificationEmailRenderer()), f.notificationService,
                audit, new ObjectMapper());
        CustomUserDetails user = mock(CustomUserDetails.class);
        when(user.getUserId()).thenReturn("staff-1");
        try (LogCapture logs = LogCapture.of(LogCapture.COMMERCE, LogCapture.WORKFLOW)) {
            for (String trigger : List.of("ORDER_CONFIRMED", "ORDER_SHIPPED", "REFUND_PROCESSED")) {
                try {
                    service.send(user, DispatcherFixture.INST, new ObjectMapper().readTree(
                            "{\"trigger\":\"" + trigger + "\",\"locale\":\"hi\",\"channels\":[\"EMAIL\",\"WHATSAPP\"]}"));
                } catch (Exception e) {
                    throw new AssertionError(e);
                }
            }
            when(authService.getUsersFromAuthServiceByUserIds(anyList()))
                    .thenThrow(new IllegalStateException("auth down for asha.verma@example.com"));
            assertThrows(RuntimeException.class, () -> service.send(user, DispatcherFixture.INST,
                    new ObjectMapper().readTree("{\"trigger\":\"ORDER_RTO\",\"locale\":\"en\"}")));
            assertTrue(f.sent.size() >= 3);
            assertClean(logs);
        }
    }

    @Test
    void theLinkExchangeLogsNoTokenAndNoContact() {
        DispatcherFixture f = new DispatcherFixture();
        CommerceOrderAccessTokens access = new CommerceOrderAccessTokens("order-token-secret-for-tests");
        CommerceOrderLinkService links = new CommerceOrderLinkService(f.linkTokens, access, f.store,
                mock(CommerceOrderDeskService.class), mock(CommerceAccessGuard.class),
                mock(CommerceAuditService.class), mock(PlatformTransactionManager.class));
        String good = f.linkTokens.issue(DispatcherFixture.INST, DispatcherFixture.ORDER, 0, "OC", Duration.ofDays(14));
        String revoked = f.linkTokens.issue(DispatcherFixture.INST, DispatcherFixture.ORDER, 9, "OC",
                Duration.ofDays(14));
        try (LogCapture logs = LogCapture.of(LogCapture.COMMERCE, LogCapture.WORKFLOW)) {
            CheckoutDtos.OrderLinkExchange answer = links.exchange(DispatcherFixture.INST, good);
            assertThrows(CheckoutException.class, () -> links.exchange(DispatcherFixture.INST, revoked));
            assertThrows(CheckoutException.class, () -> links.exchange("inst-2", good));
            assertThrows(CheckoutException.class, () -> links.exchange(DispatcherFixture.INST, good + "x"));
            f.store.anonymised.put("cust-1", true);
            assertThrows(CheckoutException.class, () -> links.exchange(DispatcherFixture.INST, good));
            assertClean(logs, good, answer.getOrderAccessToken(), good.split("\\.")[1]);
        }
    }

    @Test
    void theWorkflowEngineLogsTheKeysOfABuyersContextNotItsValues() {
        DispatcherFixture f = new DispatcherFixture();
        var row = new CommerceNotificationStore.DeliveryRow("d-1", "e-1", DispatcherFixture.INST,
                DispatcherFixture.ORDER, "ORDER_CONFIRMED", "", "WORKFLOW", "en", "SENDING", null, 1, false);
        Map<String, Object> context = f.dispatcher.workflowContext(row, f.dispatcher.context(row, true));
        assertTrue(context.containsKey("customerPhone") && context.containsKey("customerEmail")
                && context.containsKey("orderLink"));

        WorkflowTriggerService engine = new WorkflowTriggerService();
        WorkflowTriggerRepository repository = mock(WorkflowTriggerRepository.class);
        Workflow workflow = new Workflow();
        workflow.setId("wf-1");
        WorkflowTrigger trigger = new WorkflowTrigger();
        trigger.setId("tr-1");
        trigger.setWorkflow(workflow);
        trigger.setTriggerEventName("ORDER_CONFIRMED");
        when(repository.findSpecificTriggers(anyString(), anyString(), anyString(), anyList())).thenReturn(List.of());
        when(repository.findGlobalTriggers(anyString(), anyString(), anyList())).thenReturn(List.of(trigger));
        IdempotencyStrategyFactory keys = mock(IdempotencyStrategyFactory.class);
        when(keys.generateKey(any(), anyString(), anyString(), anyMap())).thenReturn("key-1");
        IdempotencyService idempotency = mock(IdempotencyService.class);
        WorkflowExecution execution = new WorkflowExecution();
        execution.setId("ex-1");
        when(idempotency.markAsProcessingForTrigger(anyString(), anyString(), anyString())).thenReturn(execution);
        WorkflowEngineService runner = mock(WorkflowEngineService.class);
        when(runner.run(anyString(), anyMap())).thenReturn(Map.of());
        ReflectionTestUtils.setField(engine, "workflowTriggerRepository", repository);
        ReflectionTestUtils.setField(engine, "idempotencyStrategyFactory", keys);
        ReflectionTestUtils.setField(engine, "idempotencyService", idempotency);
        ReflectionTestUtils.setField(engine, "workflowEngineService", runner);
        ReflectionTestUtils.setField(engine, "workflowSubjectResolver", mock(WorkflowSubjectResolver.class));

        try (LogCapture logs = LogCapture.of(LogCapture.COMMERCE, LogCapture.WORKFLOW)) {
            engine.handleTriggerEvents("ORDER_CONFIRMED", DispatcherFixture.ORDER, DispatcherFixture.INST, context);
            assertTrue(logs.messages().stream().anyMatch(m -> m.startsWith("Seed context prepared")),
                    logs.messages().toString());
            assertClean(logs, String.valueOf(context.get("orderLink")));
        }
    }
}
