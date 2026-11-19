package vacademy.io.admin_core_service.features.commerce.notify;

import ch.qos.logback.classic.Level;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.client.HttpClientErrorException;
import org.springframework.web.client.HttpServerErrorException;
import org.springframework.web.client.ResourceAccessException;
import vacademy.io.admin_core_service.features.commerce.notify.entity.CommerceNotificationSetting;
import vacademy.io.admin_core_service.features.commerce.order.checkout.CommerceOrderLinkTokens;
import vacademy.io.admin_core_service.features.commerce.security.CommerceAccessGuard;
import vacademy.io.admin_core_service.features.commerce.security.CommerceFeature;
import vacademy.io.admin_core_service.features.notification.dto.UnifiedSendRequest;
import vacademy.io.admin_core_service.features.notification.dto.UnifiedSendResponse;
import vacademy.io.admin_core_service.features.workflow.service.TriggerContextKeyRegistry;
import vacademy.io.common.exceptions.VacademyException;

import java.math.BigDecimal;
import java.net.ConnectException;
import java.net.SocketTimeoutException;
import java.net.UnknownHostException;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyMap;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * The sender (§5.2–5.4, §6.2–6.3): WhatsApp only to a proved phone through an approved template
 * and with a link; email only to a deliverable address; the exact request each channel sends;
 * every answer of the send API mapped (retry on an unreachable platform, never a second send
 * when the outcome is unknown); only the claimer sends; a lost claim is never resent; and no
 * send ever happens inside a transaction.
 */
class CommerceNotificationSenderTest {

    private final DispatcherFixture f = new DispatcherFixture();

    /** A due delivery of a planned event on one channel. */
    private String due(DispatcherFixture fx, String trigger, String ref, String channel) {
        String eventId = fx.planned(trigger, ref);
        String id = fx.delivery(eventId, channel);
        assertNotNull(id, trigger + " has no " + channel + " row");
        return id;
    }

    private String due(String trigger, String channel) {
        return due(f, trigger, "", channel);
    }

    private CommerceNotificationDispatcher.Result send(String deliveryId) {
        return f.dispatcher.send(deliveryId);
    }

    private void answer(UnifiedSendResponse response) {
        f.answer = request -> response;
    }

    private void fail(RuntimeException e) {
        f.answer = request -> {
            throw e;
        };
    }

    // ================================================================== WhatsApp rules

    @Test
    void whatsAppGoesOnlyToAPhoneThatWasProved() {
        f.order.phoneVerified = false;
        f.order.channel = "ONLINE";
        f.order.put();
        String id = due("ORDER_CONFIRMED", "WHATSAPP");
        assertEquals(CommerceNotificationDispatcher.Result.SKIPPED, send(id));
        assertEquals("SKIPPED", f.row(id).status);
        assertEquals("PHONE_NOT_VERIFIED", f.row(id).errorCode);
        assertEquals("••••••3210", f.row(id).recipientMasked);
        assertTrue(f.row(id).recipientHash.matches("[0-9a-f]{64}"));
        assertTrue(f.sent.isEmpty());

        for (String staffChannel : List.of("ADMIN", "POS")) {
            DispatcherFixture g = new DispatcherFixture();
            g.order.phoneVerified = false;
            g.order.channel = staffChannel;
            g.order.put();
            String staff = due(g, "ORDER_CONFIRMED", "", "WHATSAPP");
            assertEquals(CommerceNotificationDispatcher.Result.SENT, g.dispatcher.send(staff), staffChannel);
            assertEquals(1, g.sent.size());
        }
    }

    @Test
    void noUsablePhoneIsSkipped() {
        for (String phone : new String[] {null, "", "12", "not a phone"}) {
            DispatcherFixture g = new DispatcherFixture();
            g.order.customerPhone = phone;
            g.order.put();
            String id = due(g, "ORDER_SHIPPED", "ship-1", "WHATSAPP");
            assertEquals(CommerceNotificationDispatcher.Result.SKIPPED, g.dispatcher.send(id));
            assertEquals("NO_PHONE", g.row(id).errorCode, String.valueOf(phone));
            assertTrue(g.sent.isEmpty());
        }
    }

    @Test
    void whatsAppNeedsAnApprovedTemplateInTheMessagesOwnLanguage() {
        for (String status : List.of("PENDING", "REJECTED", "DRAFT", "MISSING", "UNKNOWN")) {
            DispatcherFixture g = new DispatcherFixture();
            when(g.templates.status(anyString(), anyString(), anyString())).thenReturn(status);
            String id = due(g, "ORDER_SHIPPED", "ship-1", "WHATSAPP");
            assertEquals(CommerceNotificationDispatcher.Result.SKIPPED, g.dispatcher.send(id), status);
            assertEquals("TEMPLATE_NOT_APPROVED", g.row(id).errorCode, status);
            assertTrue(g.sent.isEmpty(), status);
            verify(g.templates).status(DispatcherFixture.INST, "commerce_order_shipped", "en");
        }

        // A Hindi order asks for the Hindi template only; a shop's own template name is the one asked for.
        f.order.locale = "hi";
        f.order.put();
        CommerceNotificationSetting s = f.setting("ORDER_DELIVERED");
        s.setWhatsappTemplateName("shop_delivered_v2");
        when(f.templates.status(DispatcherFixture.INST, "shop_delivered_v2", "hi"))
                .thenReturn(CommerceWhatsAppTemplateStatus.APPROVED);
        when(f.templates.status(DispatcherFixture.INST, "shop_delivered_v2", "en")).thenReturn("MISSING");
        String id = due(f, "ORDER_DELIVERED", "ship-1", "WHATSAPP");
        assertEquals(CommerceNotificationDispatcher.Result.SENT, send(id));
        assertEquals("shop_delivered_v2", f.sent.get(0).getTemplateName());
        assertEquals("hi", f.sent.get(0).getLanguageCode());
        verify(f.templates, never()).status(anyString(), anyString(), eq("en"));
    }

    @Test
    void withoutALinkBaseOrALinkSecretWhatsAppIsSkippedAndTheEmailGoesWithoutALink() {
        when(f.shopSettings.linkBase(anyString(), any())).thenReturn(null);
        String whatsapp = due("ORDER_CONFIRMED", "WHATSAPP");
        String email = f.delivery(f.store.deliveries.get(whatsapp).eventId, "EMAIL");
        assertEquals(CommerceNotificationDispatcher.Result.SKIPPED, send(whatsapp));
        assertEquals("NO_SHOP_URL", f.row(whatsapp).errorCode);
        assertEquals(CommerceNotificationDispatcher.Result.SENT, send(email));
        String html = f.sent.get(0).getOptions().getEmailBody();
        assertFalse(html.contains("<a ") || html.contains("order#l=") || html.contains("See your order"), html);

        DispatcherFixture noSecret = new DispatcherFixture(true, "");
        String w = due(noSecret, "ORDER_CONFIRMED", "", "WHATSAPP");
        assertEquals(CommerceNotificationDispatcher.Result.SKIPPED, noSecret.dispatcher.send(w));
        assertEquals("NO_SHOP_URL", noSecret.row(w).errorCode);
        String e = noSecret.delivery(noSecret.store.deliveries.get(w).eventId, "EMAIL");
        assertEquals(CommerceNotificationDispatcher.Result.SENT, noSecret.dispatcher.send(e));
        assertFalse(noSecret.sent.get(0).getOptions().getEmailBody().contains("order#l="));
    }

    // ================================================================== email rules

    @Test
    void anAddressThatCannotBeWrittenToIsSkipped() {
        for (String email : new String[] {"b-1f2e3d@buyer.invalid", "Someone@Example.INVALID", "", "   ", null,
                "not-an-email", "a@b", "two@@example.com"}) {
            DispatcherFixture g = new DispatcherFixture();
            g.order.customerEmail = email;
            g.order.put();
            String id = due(g, "ORDER_CANCELLED", "", "EMAIL");
            assertEquals(CommerceNotificationDispatcher.Result.SKIPPED, g.dispatcher.send(id), String.valueOf(email));
            assertEquals("NO_EMAIL", g.row(id).errorCode, String.valueOf(email));
            assertTrue(g.sent.isEmpty());
        }
    }

    // ================================================================== the requests

    @Test
    void theWhatsAppRequestIsExactlyWhatTheContractSays() {
        f.order.customerPhone = "+91 98765 43210";
        f.order.linkEpoch = 4;
        f.order.put();
        String id = due("ORDER_CONFIRMED", "WHATSAPP");
        Instant before = Instant.now();
        assertEquals(CommerceNotificationDispatcher.Result.SENT, send(id));

        assertEquals(1, f.sent.size());
        UnifiedSendRequest r = f.sent.get(0);
        assertEquals(DispatcherFixture.INST, r.getInstituteId());
        assertEquals("WHATSAPP", r.getChannel());
        assertEquals("commerce_order_confirmed", r.getTemplateName());
        assertEquals("en", r.getLanguageCode());
        assertEquals(1, r.getRecipients().size());
        UnifiedSendRequest.Recipient to = r.getRecipients().get(0);
        assertEquals("919876543210", to.getPhone());
        assertEquals("user-1", to.getUserId());
        assertNull(to.getEmail());
        assertEquals(CommerceNotificationTrigger.ORDER_CONFIRMED.variables(), List.copyOf(to.getVariables().keySet()));
        assertEquals("Asha Verma", to.getVariables().get("customer_name"));
        assertEquals("Example Shop", to.getVariables().get("shop_name"));
        assertEquals("SH-000123", to.getVariables().get("order_number"));
        assertEquals("₹1,499", to.getVariables().get("order_total"));
        String link = to.getVariables().get("order_link");
        assertTrue(link.startsWith(DispatcherFixture.LINK_BASE + "/order#l=l1."), link);
        CommerceOrderLinkTokens.Read read = f.linkTokens.verify(DispatcherFixture.INST,
                link.substring(link.indexOf("#l=") + 3));
        assertEquals(CommerceOrderLinkTokens.Status.VALID, read.status());
        assertEquals(DispatcherFixture.ORDER, read.orderId());
        assertEquals(4, read.linkEpoch());
        assertEquals("OC", read.triggerTag());
        Duration life = Duration.between(before, read.expiresAt());
        assertTrue(life.compareTo(Duration.ofDays(14).minusMinutes(1)) > 0
                && life.compareTo(Duration.ofDays(14).plusMinutes(1)) < 0, "the shop's 14 days: " + life);
        UnifiedSendRequest.SendOptions o = r.getOptions();
        assertEquals("COMMERCE_ORDER", o.getSource());
        assertEquals(id, o.getSourceId());
        assertEquals("COMMERCE", o.getOriginType());
        assertEquals("ORDER_CONFIRMED", o.getOriginName());
        assertNull(o.getFromEmail());
        assertNull(o.getCc());
        assertNull(o.getEmailBody());

        InMemoryNotificationStore.Delivery row = f.row(id);
        assertEquals("SENT", row.status);
        assertTrue(row.sent);
        assertEquals("wamid-1", row.providerMessageId);
        assertEquals("••••••3210", row.recipientMasked);
        assertEquals(f.dispatcher.recipientHash("919876543210"), row.recipientHash);
    }

    @Test
    void theEmailRequestIsExactlyWhatTheContractSays() {
        f.order.customerEmail = "  Asha.Verma@Example.com ";
        f.order.put();
        f.store.lines.put(DispatcherFixture.ORDER, List.of(Map.of("name_snapshot", "Cotton Kurta",
                "variant_label", "Blue / M", "quantity", 1, "line_total", new BigDecimal("1499.00"))));
        String id = due("ORDER_CONFIRMED", "EMAIL");
        assertEquals(CommerceNotificationDispatcher.Result.SENT, send(id));

        UnifiedSendRequest r = f.sent.get(0);
        assertEquals("EMAIL", r.getChannel());
        assertEquals(DispatcherFixture.INST, r.getInstituteId());
        assertNull(r.getTemplateName());
        assertEquals(1, r.getRecipients().size());
        assertEquals("Asha.Verma@Example.com", r.getRecipients().get(0).getEmail());
        assertEquals("user-1", r.getRecipients().get(0).getUserId());
        assertNull(r.getRecipients().get(0).getPhone());
        UnifiedSendRequest.SendOptions o = r.getOptions();
        assertEquals("Order SH-000123 confirmed", o.getEmailSubject());
        assertEquals("UTILITY_EMAIL", o.getEmailType());
        assertEquals("COMMERCE_ORDER", o.getSource());
        assertEquals(id, o.getSourceId());
        assertNull(o.getFromEmail());
        assertNull(o.getFromName());
        assertNull(o.getCc());
        assertNull(o.getCcMode());
        String html = o.getEmailBody();
        assertFalse(html.contains("{{") || html.contains("}}"), html);
        assertTrue(html.startsWith("<!DOCTYPE html><html lang=\"en\">"));
        assertTrue(html.contains("Cotton Kurta") && html.contains("₹1,499"), html);
        assertTrue(html.contains("href=\"" + DispatcherFixture.LINK_BASE + "/order#l=l1."), html);
        assertEquals("A•••@Example.com", f.row(id).recipientMasked);
        assertEquals(f.dispatcher.recipientHash("asha.verma@example.com"), f.row(id).recipientHash);
    }

    /** A measured line's quantity reads in metres ("2.5 m"), a counted line keeps its count. */
    @Test
    void theEmailItemQuantityIsInDisplayUnits() {
        f.order.customerEmail = "buyer@example.com";
        f.order.put();
        f.store.lines.put(DispatcherFixture.ORDER, List.of(
                Map.of("name_snapshot", "Cotton cloth", "variant_label", "White", "quantity", 25, "qty_scale", 10,
                        "unit", "MTR", "line_total", new BigDecimal("308.50")),
                Map.of("name_snapshot", "Steel bottle", "variant_label", "Plain", "quantity", 2, "qty_scale", 1,
                        "unit", "PCS", "line_total", new BigDecimal("500.00"))));
        String id = due("ORDER_CONFIRMED", "EMAIL");
        assertEquals(CommerceNotificationDispatcher.Result.SENT, send(id));

        String html = f.sent.get(0).getOptions().getEmailBody();
        assertTrue(html.contains(">2.5 m<"), html);
        assertFalse(html.contains(">25<"), "not the stored base units");
        assertTrue(html.contains(">2<"), html);
        assertEquals("2.5 m", CommerceNotificationDispatcher.itemQuantity(Map.of("quantity", 25, "qty_scale", 10,
                "unit", "MTR")));
        assertEquals("2", CommerceNotificationDispatcher.itemQuantity(Map.of("quantity", 2, "qty_scale", 1,
                "unit", "PCS")));
        assertEquals("3", CommerceNotificationDispatcher.itemQuantity(Map.of("quantity", 3)),
                "a row without the scale prints as before");
    }

    // ================================================================== answers (§6.3)

    private String sendOne(UnifiedSendResponse response) {
        answer(response);
        String id = due("ORDER_SHIPPED", "EMAIL");
        send(id);
        return id;
    }

    @Test
    void sentAndQueuedAreSent() {
        String sent = sendOne(DispatcherFixture.sentAnswer("SENT", true, "msg-77", null));
        assertEquals("SENT", f.row(sent).status);
        assertNull(f.row(sent).errorCode);
        assertEquals("msg-77", f.row(sent).providerMessageId);

        DispatcherFixture g = new DispatcherFixture();
        g.answer = request -> DispatcherFixture.sentAnswer("QUEUED", true, null, null);
        String queued = due(g, "ORDER_SHIPPED", "ship-1", "EMAIL");
        assertEquals(CommerceNotificationDispatcher.Result.SENT, g.dispatcher.send(queued));
        assertEquals("SENT", g.row(queued).status);
        assertEquals("QUEUED_BY_PLATFORM", g.row(queued).errorCode);

        DispatcherFixture h = new DispatcherFixture();
        h.answer = request -> DispatcherFixture.sentAnswer(null, true, "msg-9", null);
        String bare = due(h, "ORDER_SHIPPED", "ship-1", "EMAIL");
        assertEquals(CommerceNotificationDispatcher.Result.SENT, h.dispatcher.send(bare));
        assertEquals("msg-9", h.row(bare).providerMessageId);
    }

    @Test
    void unsubscribedNoCreditsAndProviderRefusals() {
        String unsubscribed = sendOne(DispatcherFixture.sentAnswer("SKIPPED_UNSUBSCRIBED", false, null, null));
        assertEquals("SKIPPED", f.row(unsubscribed).status);
        assertEquals("UNSUBSCRIBED", f.row(unsubscribed).errorCode);

        DispatcherFixture g = new DispatcherFixture();
        g.answer = request -> DispatcherFixture.sentAnswer("BLOCKED_NO_CREDITS", false, null, "no credits");
        String noCredits = due(g, "ORDER_SHIPPED", "ship-1", "EMAIL");
        assertEquals(CommerceNotificationDispatcher.Result.FAILED, g.dispatcher.send(noCredits));
        assertEquals("NO_CREDITS", g.row(noCredits).errorCode);
        assertEquals(1, g.sent.size(), "no retry");

        DispatcherFixture h = new DispatcherFixture();
        h.answer = request -> DispatcherFixture.sentAnswer("FAILED", false, null,
                "(#131026) Message undeliverable to 919876543210 for asha.verma@example.com");
        String refused = due(h, "ORDER_SHIPPED", "ship-1", "WHATSAPP");
        assertEquals(CommerceNotificationDispatcher.Result.FAILED, h.dispatcher.send(refused));
        assertEquals("PROVIDER_REJECTED", h.row(refused).errorCode);
        assertEquals("(##) Message undeliverable to # for [email]", h.row(refused).errorDetail);
    }

    @Test
    void anEmptyOrUnreadableAnswerIsUnknownAndAlerted() {
        List<UnifiedSendResponse> unreadable = new java.util.ArrayList<>();
        unreadable.add(null);
        unreadable.add(UnifiedSendResponse.builder().build());
        unreadable.add(UnifiedSendResponse.builder().results(List.of()).build());
        unreadable.add(DispatcherFixture.sentAnswer(null, false, null, null));
        unreadable.add(DispatcherFixture.sentAnswer("SOMETHING_NEW", false, null, null));
        for (UnifiedSendResponse response : unreadable) {
            DispatcherFixture g = new DispatcherFixture();
            g.answer = request -> response;
            String id = due(g, "ORDER_SHIPPED", "ship-1", "EMAIL");
            try (LogCapture logs = LogCapture.of(LogCapture.COMMERCE)) {
                assertEquals(CommerceNotificationDispatcher.Result.UNKNOWN, g.dispatcher.send(id));
                assertTrue(logs.messages().contains("COMMERCE_ALERT notification_failed institute=inst-1 "
                        + "order=order-1 trigger=ORDER_SHIPPED channel=EMAIL code=ANSWER_UNREADABLE"), logs.messages()
                        .toString());
            }
            assertEquals("UNKNOWN", g.row(id).status);
            assertEquals("ANSWER_UNREADABLE", g.row(id).errorCode);
        }
        DispatcherFixture g = new DispatcherFixture();
        g.answer = request -> {
            throw new VacademyException("Error parsing unified send response: x");
        };
        String id = due(g, "ORDER_SHIPPED", "ship-1", "EMAIL");
        assertEquals(CommerceNotificationDispatcher.Result.UNKNOWN, g.dispatcher.send(id));
        assertEquals("ANSWER_UNREADABLE", g.row(id).errorCode);
    }

    @Test
    void anUnreachablePlatformIsRetriedAfter1_5_15_60MinutesThenGivenUp() {
        fail(new ResourceAccessException("I/O error", new ConnectException("Connection refused")));
        String id = due("ORDER_SHIPPED", "EMAIL");
        int[] waits = {1, 5, 15, 60};
        for (int attempt = 1; attempt <= 4; attempt++) {
            assertEquals(CommerceNotificationDispatcher.Result.RETRY, send(id), "attempt " + attempt);
            InMemoryNotificationStore.Delivery row = f.row(id);
            assertEquals("PENDING", row.status);
            assertEquals(attempt, row.attempts);
            assertEquals(waits[attempt - 1], row.dueInMinutes);
            assertEquals("PLATFORM_UNREACHABLE", row.errorCode);
            // Not due before its time.
            assertEquals(CommerceNotificationDispatcher.Result.NOT_CLAIMED, send(id));
            row.dueInMinutes = 0;
        }
        try (LogCapture logs = LogCapture.of(LogCapture.COMMERCE)) {
            assertEquals(CommerceNotificationDispatcher.Result.FAILED, send(id));
            assertTrue(logs.messages().stream().anyMatch(m -> m.startsWith("COMMERCE_ALERT notification_failed")
                    && m.endsWith("code=RETRIES_EXHAUSTED")));
        }
        assertEquals("FAILED", f.row(id).status);
        assertEquals("RETRIES_EXHAUSTED", f.row(id).errorCode);
        assertEquals(5, f.row(id).attempts);
        assertEquals(List.of(1, 5, 15, 60), f.row(id).retryMinutes);
        assertEquals(5, f.sent.size());

        DispatcherFixture g = new DispatcherFixture();
        g.answer = request -> {
            throw new ResourceAccessException("I/O error", new UnknownHostException("notification-service"));
        };
        String other = due(g, "ORDER_SHIPPED", "ship-1", "EMAIL");
        assertEquals(CommerceNotificationDispatcher.Result.RETRY, g.dispatcher.send(other));
    }

    @Test
    void aReadTimeoutOrAnyOther5xxIsUnknownAndNeverSentAgain() {
        List<RuntimeException> unknown = List.of(
                new ResourceAccessException("Read timed out", new SocketTimeoutException("Read timed out")),
                new ResourceAccessException("I/O error"),
                new HttpServerErrorException(HttpStatus.INTERNAL_SERVER_ERROR),
                new HttpServerErrorException(HttpStatus.BAD_GATEWAY),
                new HttpServerErrorException(HttpStatus.GATEWAY_TIMEOUT),
                new IllegalStateException("something of ours"));
        for (RuntimeException e : unknown) {
            DispatcherFixture g = new DispatcherFixture();
            g.answer = request -> {
                throw e;
            };
            String id = due(g, "ORDER_SHIPPED", "ship-1", "WHATSAPP");
            assertEquals(CommerceNotificationDispatcher.Result.UNKNOWN, g.dispatcher.send(id), e.toString());
            assertEquals("UNKNOWN", g.row(id).status);
            assertEquals("OUTCOME_UNKNOWN", g.row(id).errorCode, e.toString());
            // Never again: the job finds nothing to send.
            assertEquals(CommerceNotificationDispatcher.Result.NOT_CLAIMED, g.dispatcher.send(id));
            g.dispatcher.dispatchOrder(DispatcherFixture.INST, DispatcherFixture.ORDER);
            assertEquals(1, g.sent.stream().filter(r -> "WHATSAPP".equals(r.getChannel())).count(), e.toString());
            assertEquals("UNKNOWN", g.row(id).status);
        }
    }

    @Test
    void a503IsRetriedAndA4xxIsRefused() {
        fail(new HttpServerErrorException(HttpStatus.SERVICE_UNAVAILABLE));
        String unavailable = due("ORDER_SHIPPED", "EMAIL");
        assertEquals(CommerceNotificationDispatcher.Result.RETRY, send(unavailable));
        assertEquals("PLATFORM_UNAVAILABLE", f.row(unavailable).errorCode);
        assertEquals(1, f.row(unavailable).dueInMinutes);

        for (HttpStatus status : List.of(HttpStatus.BAD_REQUEST, HttpStatus.UNAUTHORIZED, HttpStatus.NOT_FOUND,
                HttpStatus.TOO_MANY_REQUESTS)) {
            DispatcherFixture g = new DispatcherFixture();
            g.answer = request -> {
                throw new HttpClientErrorException(status);
            };
            String id = due(g, "ORDER_SHIPPED", "ship-1", "EMAIL");
            assertEquals(CommerceNotificationDispatcher.Result.FAILED, g.dispatcher.send(id), status.toString());
            assertEquals("REQUEST_REFUSED", g.row(id).errorCode);
        }
    }

    @Test
    void noAlertForWhatWentOutOrWasSkipped() {
        try (LogCapture logs = LogCapture.of(LogCapture.COMMERCE)) {
            send(due("ORDER_SHIPPED", "EMAIL"));
            f.order.phoneVerified = false;
            f.order.put();
            send(due(f, "ORDER_DELIVERED", "ship-1", "WHATSAPP"));
            assertFalse(logs.messages().stream().anyMatch(m -> m.contains("COMMERCE_ALERT")), logs.messages()
                    .toString());
            assertTrue(logs.events().stream().noneMatch(e -> e.getLevel() == Level.ERROR));
        }
    }

    // ================================================================== claims

    @Test
    void onlyTheClaimerSends() {
        String id = due("ORDER_SHIPPED", "EMAIL");
        f.store.loseClaims = true;
        assertEquals(CommerceNotificationDispatcher.Result.NOT_CLAIMED, send(id));
        assertEquals("PENDING", f.row(id).status);
        f.store.loseClaims = false;

        f.row(id).dueInMinutes = 3;
        assertEquals(CommerceNotificationDispatcher.Result.NOT_CLAIMED, send(id));
        f.row(id).dueInMinutes = 0;

        f.row(id).status = "SENDING";
        assertEquals(CommerceNotificationDispatcher.Result.NOT_CLAIMED, send(id));
        assertEquals(CommerceNotificationDispatcher.Result.NOT_CLAIMED, send("dl-404"));
        assertTrue(f.sent.isEmpty());
        verify(f.notificationService, never()).sendUnified(any());
    }

    @Test
    void aClaimLeftSendingTooLongBecomesUnknownAndIsNeverResent() {
        String lost = due("ORDER_SHIPPED", "EMAIL");
        String recent = f.delivery(f.store.deliveries.get(lost).eventId, "WHATSAPP");
        f.row(lost).status = "SENDING";
        f.row(lost).claimedMinutesAgo = 11;
        f.row(recent).status = "SENDING";
        f.row(recent).claimedMinutesAgo = 4;
        try (LogCapture logs = LogCapture.of(LogCapture.COMMERCE)) {
            assertEquals(1, f.dispatcher.reapLostClaims(100));
            assertTrue(logs.messages().contains("COMMERCE_ALERT notification_failed institute=inst-1 order=order-1 "
                    + "trigger=ORDER_SHIPPED channel=EMAIL code=CLAIM_LOST"), logs.messages().toString());
        }
        assertEquals("UNKNOWN", f.row(lost).status);
        assertEquals("CLAIM_LOST", f.row(lost).errorCode);
        assertEquals("SENDING", f.row(recent).status);
        assertEquals(CommerceNotificationDispatcher.Result.NOT_CLAIMED, send(lost));
        assertTrue(f.sent.isEmpty());
    }

    @Test
    void aCodMessageWhoseCallWasAnsweredIsNotSent() {
        f.order.status = "COD_PENDING_CONFIRMATION";
        f.order.put();
        String id = due("COD_CONFIRMATION_NEEDED", "EMAIL");
        f.order.status = "CONFIRMED";
        f.order.put();
        assertEquals(CommerceNotificationDispatcher.Result.SKIPPED, send(id));
        assertEquals("STALE", f.row(id).errorCode);
        assertTrue(f.sent.isEmpty());
    }

    // ================================================================== transactions

    @Test
    void theSendApiIsNeverCalledInsideATransaction() {
        String id = due("ORDER_CONFIRMED", "EMAIL");
        // Inside a caller's transaction the sender refuses before claiming.
        FakeTransactions outer = new FakeTransactions();
        assertThrows(IllegalStateException.class, () -> new TransactionTemplate(outer).executeWithoutResult(
                status -> f.dispatcher.send(id)));
        assertThrows(IllegalStateException.class, () -> new TransactionTemplate(outer).executeWithoutResult(
                status -> f.dispatcher.reapLostClaims(10)));
        assertEquals("PENDING", f.row(id).status);
        assertTrue(f.sent.isEmpty());

        // On its own it reads in short transactions and calls with none open (the mock checks).
        int before = f.transactions.begun;
        assertEquals(CommerceNotificationDispatcher.Result.SENT, send(id));
        assertTrue(f.transactions.begun > before, "the reads ran in transactions of their own");
        assertEquals(1, f.sent.size());
        assertFalse(TransactionSynchronizationManager.isActualTransactionActive());
    }

    // ================================================================== workflow

    @Test
    void anActiveWorkflowGetsTheContextOutsideATransactionAndItsOutcome() {
        when(f.workflowService.hasActiveWorkflow(anyString(), anyString(), anyString())).thenReturn(true);
        f.store.shipments.put(DispatcherFixture.ORDER + "|ship-1", Map.of("carrier_name", "India Post",
                "tracking_number", "EZ123456789IN"));
        @SuppressWarnings("unchecked")
        Map<String, Object>[] seen = new Map[1];
        doAnswer(call -> {
            assertFalse(TransactionSynchronizationManager.isActualTransactionActive());
            seen[0] = call.getArgument(3);
            return Map.of();
        }).when(f.workflowService).handleTriggerEvents(eq("ORDER_SHIPPED"), eq(DispatcherFixture.ORDER),
                eq(DispatcherFixture.INST), anyMap());
        String id = due(f, "ORDER_SHIPPED", "ship-1", "WORKFLOW");

        assertEquals(CommerceNotificationDispatcher.Result.SENT, send(id));
        Map<String, Object> ctx = seen[0];
        assertEquals(DispatcherFixture.ORDER, ctx.get("orderId"));
        assertEquals("SH-000123", ctx.get("orderNumber"));
        assertEquals("ORDER_SHIPPED", ctx.get("trigger"));
        assertEquals("919876543210", ctx.get("customerPhone"));
        assertEquals(DispatcherFixture.EMAIL, ctx.get("customerEmail"));
        assertEquals("ship-1", ctx.get("shipmentId"));
        assertEquals("India Post", ctx.get("courier"));
        assertEquals("EZ123456789IN", ctx.get("trackingNumber"));
        assertTrue(String.valueOf(ctx.get("orderLink")).startsWith(DispatcherFixture.LINK_BASE + "/order#l=l1."));
        assertTrue(f.sent.isEmpty(), "the defaults are not sent as well");

        DispatcherFixture g = new DispatcherFixture();
        when(g.workflowService.hasActiveWorkflow(anyString(), anyString(), anyString())).thenReturn(true);
        when(g.workflowService.handleTriggerEvents(anyString(), anyString(), anyString(), anyMap()))
                .thenThrow(new IllegalStateException("engine failed"));
        String failed = due(g, "ORDER_CANCELLED", "", "WORKFLOW");
        assertEquals(CommerceNotificationDispatcher.Result.FAILED, g.dispatcher.send(failed));
        assertEquals("WORKFLOW_ERROR", g.row(failed).errorCode);
        assertEquals(CommerceNotificationDispatcher.Result.NOT_CLAIMED, g.dispatcher.send(failed), "no retry");
    }

    @Test
    void theWorkflowContextHoldsOnlyKeysTheRegistryKnowsAndContactsOnlyWhenUsable() {
        TriggerContextKeyRegistry registry = new TriggerContextKeyRegistry(null);
        f.store.refunds.put(DispatcherFixture.ORDER + "|r-1", Map.of("method", "UPI", "amount",
                new BigDecimal("500.00")));
        f.store.returns.put(DispatcherFixture.ORDER + "|ret-1", Map.of("return_number", "R-000045"));
        for (CommerceNotificationTrigger trigger : CommerceNotificationTrigger.values()) {
            String ref = switch (trigger) {
                case ORDER_SHIPPED, ORDER_DELIVERED, ORDER_RTO -> "ship-1";
                case RETURN_APPROVED -> "ret-1";
                case REFUND_PROCESSED -> "r-1";
                default -> "";
            };
            var row = new vacademy.io.admin_core_service.features.commerce.notify.repository.CommerceNotificationStore
                    .DeliveryRow("d-1", "e-1", DispatcherFixture.INST, DispatcherFixture.ORDER, trigger.name(), ref,
                    "WORKFLOW", "en", "SENDING", null, 1, false);
            CommerceNotificationDispatcher.Context c = f.dispatcher.context(row, true);
            Map<String, Object> ctx = f.dispatcher.workflowContext(row, c);
            Set<String> known = registry.emittedKeys(trigger.name());
            assertNotNull(known, trigger.name());
            assertTrue(known.containsAll(ctx.keySet()), trigger + ": " + ctx.keySet() + " not in " + known);
        }

        f.order.phoneVerified = false;
        f.order.customerEmail = "b-1@buyer.invalid";
        f.order.userId = null;
        f.order.put();
        var row = new vacademy.io.admin_core_service.features.commerce.notify.repository.CommerceNotificationStore
                .DeliveryRow("d-2", "e-2", DispatcherFixture.INST, DispatcherFixture.ORDER, "ORDER_CONFIRMED", "",
                "WORKFLOW", "en", "SENDING", null, 1, false);
        Map<String, Object> ctx = f.dispatcher.workflowContext(row, f.dispatcher.context(row, false));
        assertFalse(ctx.containsKey("customerPhone"));
        assertFalse(ctx.containsKey("customerEmail"));
        assertFalse(ctx.containsKey("userId"));
        assertFalse(ctx.containsKey("orderLink"));
    }

    // ================================================================== rules read again at send time

    @Test
    void commerceSwitchedOffAfterPlanningSkipsTheMessageForGoodWithoutAnAlert() {
        String id = due("ORDER_SHIPPED", "EMAIL");
        when(f.accessGuard.featureState(DispatcherFixture.INST, CommerceFeature.ORDERS))
                .thenReturn(CommerceAccessGuard.FeatureState.OFF);
        try (LogCapture logs = LogCapture.of(LogCapture.COMMERCE)) {
            assertEquals(CommerceNotificationDispatcher.Result.SKIPPED, send(id));
            assertFalse(logs.messages().stream().anyMatch(m -> m.contains("COMMERCE_ALERT")), logs.messages()
                    .toString());
        }
        assertEquals("SKIPPED", f.row(id).status);
        assertEquals("COMMERCE_OFF", f.row(id).errorCode);
        assertTrue(f.sent.isEmpty());
        // Turned on again: the message stays skipped, never sent late.
        when(f.accessGuard.featureState(DispatcherFixture.INST, CommerceFeature.ORDERS))
                .thenReturn(CommerceAccessGuard.FeatureState.ON);
        assertEquals(CommerceNotificationDispatcher.Result.NOT_CLAIMED, send(id));
        verify(f.notificationService, never()).sendUnified(any());
    }

    @Test
    void anUnknownFeatureAtSendTimeGoesBackToPendingForFiveMinutesWithoutCountingAnAttempt() {
        String id = due("ORDER_SHIPPED", "WHATSAPP");
        when(f.accessGuard.featureState(anyString(), any())).thenReturn(CommerceAccessGuard.FeatureState.UNKNOWN);
        try (LogCapture logs = LogCapture.of(LogCapture.COMMERCE)) {
            assertEquals(CommerceNotificationDispatcher.Result.RETRY, send(id));
            assertFalse(logs.messages().stream().anyMatch(m -> m.contains("COMMERCE_ALERT")), logs.messages()
                    .toString());
        }
        assertEquals("PENDING", f.row(id).status);
        assertEquals("FEATURE_UNKNOWN", f.row(id).errorCode);
        assertEquals(5, f.row(id).dueInMinutes);
        assertEquals(0, f.row(id).attempts);
        assertTrue(f.sent.isEmpty());
        // Not due before then.
        assertEquals(CommerceNotificationDispatcher.Result.NOT_CLAIMED, send(id));

        // A null answer is treated the same way.
        f.row(id).dueInMinutes = 0;
        when(f.accessGuard.featureState(anyString(), any())).thenReturn(null);
        assertEquals(CommerceNotificationDispatcher.Result.RETRY, send(id));
        assertEquals(0, f.row(id).attempts);

        // Readable and on again: sent once, as the first attempt.
        f.row(id).dueInMinutes = 0;
        when(f.accessGuard.featureState(anyString(), any())).thenReturn(CommerceAccessGuard.FeatureState.ON);
        assertEquals(CommerceNotificationDispatcher.Result.SENT, send(id));
        assertEquals(1, f.row(id).attempts);
        assertEquals(1, f.sent.size());
    }

    @Test
    void theBillOfAPosSaleIsCheckedAgainstThePosFeatureAtSendTime() {
        f.order.channel = "POS";
        f.order.put();
        String id = due("POS_BILL_ISSUED", "EMAIL");
        when(f.accessGuard.featureState(DispatcherFixture.INST, CommerceFeature.POS))
                .thenReturn(CommerceAccessGuard.FeatureState.OFF);
        assertEquals(CommerceNotificationDispatcher.Result.SKIPPED, send(id));
        assertEquals("COMMERCE_OFF", f.row(id).errorCode);
        assertTrue(f.sent.isEmpty());
    }

    @Test
    void onlyAUtilityTemplateGoesOutOnWhatsApp() {
        for (String category : new String[] {"MARKETING", "AUTHENTICATION", null}) {
            DispatcherFixture g = new DispatcherFixture();
            when(g.templates.category(anyString(), anyString(), anyString())).thenReturn(category);
            String whatsapp = due(g, "ORDER_SHIPPED", "ship-1", "WHATSAPP");
            String email = g.delivery(g.store.deliveries.get(whatsapp).eventId, "EMAIL");
            try (LogCapture logs = LogCapture.of(LogCapture.COMMERCE)) {
                assertEquals(CommerceNotificationDispatcher.Result.SKIPPED, g.dispatcher.send(whatsapp),
                        String.valueOf(category));
                assertFalse(logs.messages().stream().anyMatch(m -> m.contains("COMMERCE_ALERT")));
            }
            assertEquals("TEMPLATE_NOT_UTILITY", g.row(whatsapp).errorCode);
            assertTrue(g.sent.isEmpty(), String.valueOf(category));
            // The e-mail of the same message still goes.
            assertEquals(CommerceNotificationDispatcher.Result.SENT, g.dispatcher.send(email));
        }
        DispatcherFixture utility = new DispatcherFixture();
        when(utility.templates.category(anyString(), anyString(), anyString())).thenReturn("utility");
        String id = due(utility, "ORDER_SHIPPED", "ship-1", "WHATSAPP");
        assertEquals(CommerceNotificationDispatcher.Result.SENT, utility.dispatcher.send(id));
    }

    @Test
    void aBlockedAddressIsSkippedWithoutAnAlert() {
        try (LogCapture logs = LogCapture.of(LogCapture.COMMERCE)) {
            String id = sendOne(DispatcherFixture.sentAnswer("SKIPPED_BLOCKED", false, null, "address bounced"));
            assertEquals("SKIPPED", f.row(id).status);
            assertEquals("ADDRESS_BLOCKED", f.row(id).errorCode);
            assertNull(f.row(id).errorDetail);
            assertFalse(logs.messages().stream().anyMatch(m -> m.contains("COMMERCE_ALERT")), logs.messages()
                    .toString());
            assertTrue(logs.events().stream().noneMatch(e -> e.getLevel() == Level.ERROR));
        }
        assertEquals(1, f.sent.size(), "never retried");
    }
}
