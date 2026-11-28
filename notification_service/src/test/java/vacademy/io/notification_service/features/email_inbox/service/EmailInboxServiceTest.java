package vacademy.io.notification_service.features.email_inbox.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import vacademy.io.notification_service.features.announcements.service.EmailConfigurationService;
import vacademy.io.notification_service.features.email_inbox.dto.EmailConversationDTO;
import vacademy.io.notification_service.features.email_inbox.dto.EmailMessageDTO;
import vacademy.io.notification_service.features.notification_log.entity.NotificationLog;
import vacademy.io.notification_service.features.notification_log.repository.EmailAddressMappingRepository;
import vacademy.io.notification_service.features.notification_log.repository.NotificationLogRepository;
import vacademy.io.notification_service.features.email_inbox.dto.EmailReplyRequest;
import vacademy.io.notification_service.features.send.dto.UnifiedSendResponse;
import vacademy.io.notification_service.features.send.service.UnifiedSendService;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.stream.Collectors;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.when;

/**
 * The shapes the Email Inbox UI renders, built from real prod row patterns
 * (institute ca3c4734-..., counterparty shreyash@vidyayatan.com).
 */
@ExtendWith(MockitoExtension.class)
class EmailInboxServiceTest {

    private static final String INSTITUTE = "ca3c4734-7913-48a8-b116-f8f7e0c60eba";
    private static final String COUNTERPARTY = "shreyash@vidyayatan.com";
    private static final String INSTITUTE_ADDRESS = "hello@vidyayatan.com";
    private static final String TITLE = "shreyash@vidyayatan.com";
    private static final String PARENT_LOG_ID = "F9E8AD65-A66F-4A53-A97B-E855B48ABD26";
    private static final Instant T0 = Instant.parse("2026-09-14T07:34:00Z");

    @Mock NotificationLogRepository notificationLogRepository;
    @Mock EmailAddressMappingRepository emailAddressMappingRepository;
    @Mock EmailConfigurationService emailConfigurationService;
    @Mock UnifiedSendService unifiedSendService;

    private EmailInboxService service;

    @BeforeEach
    void setUp() {
        service = new EmailInboxService(notificationLogRepository, emailAddressMappingRepository,
                emailConfigurationService, unifiedSendService, new ObjectMapper());
    }

    private static NotificationLog row(String id, String type, String counterparty, String source, String body, Instant at) {
        NotificationLog nl = new NotificationLog();
        nl.setId(id);
        nl.setNotificationType(type);
        nl.setChannelId(counterparty);
        nl.setSource(source);
        nl.setBody(body);
        nl.setNotificationDate(at);
        nl.setSenderBusinessChannelId(INSTITUTE_ADDRESS);
        nl.setInstituteId(INSTITUTE);
        return nl;
    }

    private void stubMessages(String counterparty, List<NotificationLog> rows) {
        when(notificationLogRepository.findEmailMessagesForConversation(
                eq(counterparty), eq(INSTITUTE), isNull(), anyList(), isNull(), anyInt()))
                .thenReturn(rows);
    }

    private List<EmailMessageDTO> messages(String counterparty) {
        return service.getMessages(INSTITUTE, counterparty, null, 50, null, null);
    }

    @Test
    @DisplayName("announcement twin pair renders as ONE outgoing campaign card with the title as subject")
    void twinPairIsOneCampaignMessage() {
        NotificationLog unified = row("u1", "EMAIL", COUNTERPARTY, "unified-send",
                "<html><body><div style=\"display:none\">96 shreyash@vidyayatan.com&#847; &#8199; &#65279; &#847;</div>"
                        + "<p>Hello there</p></body></html>", T0.plusSeconds(2));
        NotificationLog announcement = row("a1", "EMAIL", COUNTERPARTY, "announcement-service", TITLE, T0);
        stubMessages(COUNTERPARTY, List.of(unified, announcement));

        List<EmailMessageDTO> out = messages(COUNTERPARTY);

        assertThat(out).hasSize(1);
        EmailMessageDTO m = out.get(0);
        assertThat(m.getId()).isEqualTo("u1");
        assertThat(m.getDirection()).isEqualTo("OUTGOING");
        assertThat(m.getOrigin()).isEqualTo("CAMPAIGN");
        assertThat(m.getSubject()).isEqualTo(TITLE);
        assertThat(m.getBody()).startsWith("<html>");
        assertThat(m.getBodyPreview()).isEqualTo("Hello there");
        assertThat(m.isSystem()).isFalse();
        assertThat(m.getInReplyToId()).isNull();
        assertThat(m.getSource()).isEqualTo("unified-send");
    }

    @Test
    void payloadSubjectWinsOverMergedTitle() {
        NotificationLog unified = row("u1", "EMAIL", COUNTERPARTY, "unified-send", "<p>Hi</p>", T0.plusSeconds(1));
        unified.setMessagePayload("{\"subject\":\"Batch starts Monday\"}");
        stubMessages(COUNTERPARTY, List.of(unified, row("a1", "EMAIL", COUNTERPARTY, "announcement-service", TITLE, T0)));

        List<EmailMessageDTO> out = messages(COUNTERPARTY);

        assertThat(out).hasSize(1);
        assertThat(out.get(0).getSubject()).isEqualTo("Batch starts Monday");
        assertThat(out.get(0).getOrigin()).isEqualTo("CAMPAIGN");
    }

    @Test
    void loneAnnouncementRowUsesItsBodyAsSubjectAndDropsBody() {
        stubMessages(COUNTERPARTY, List.of(row("a1", "EMAIL", COUNTERPARTY, "announcement-service", TITLE, T0)));

        List<EmailMessageDTO> out = messages(COUNTERPARTY);

        assertThat(out).hasSize(1);
        assertThat(out.get(0).getSubject()).isEqualTo(TITLE);
        assertThat(out.get(0).getBody()).isNull();
        assertThat(out.get(0).getBodyPreview()).isEqualTo(TITLE);
        assertThat(out.get(0).getOrigin()).isEqualTo("CAMPAIGN");
    }

    @Test
    @DisplayName("mailer-daemon bounce is INCOMING / BOUNCE / system")
    void bounceRow() {
        String daemon = "mailer-daemon@ap-south-1.amazonses.com";
        NotificationLog bounce = row("b1", "INBOUND_EMAIL", daemon, PARENT_LOG_ID,
                "Delivery Status Notification (Failure)", T0);
        bounce.setMessagePayload("{\"subject\":\"Delivery Status Notification (Failure)\",\"from\":\"" + daemon
                + "\",\"to\":\"" + INSTITUTE_ADDRESS + "\",\"body\":\"An error occurred while trying to deliver\",\"instituteId\":\""
                + INSTITUTE + "\"}");
        stubMessages(daemon, List.of(bounce));

        List<EmailMessageDTO> out = messages(daemon);

        assertThat(out).hasSize(1);
        EmailMessageDTO m = out.get(0);
        assertThat(m.getDirection()).isEqualTo("INCOMING");
        assertThat(m.getOrigin()).isEqualTo("BOUNCE");
        assertThat(m.isSystem()).isTrue();
        assertThat(m.getInReplyToId()).isEqualTo(PARENT_LOG_ID);
        assertThat(m.getSource()).isNull();
        assertThat(m.getBody()).isEqualTo("An error occurred while trying to deliver");
    }

    @Test
    @DisplayName("inbound reply linked to an outbound log: origin REPLY, UUID moves from source to inReplyToId")
    void inboundReplyRow() {
        NotificationLog reply = row("r1", "INBOUND_EMAIL", COUNTERPARTY, PARENT_LOG_ID, "Re: hello neeraj", T0);
        reply.setSenderName("Shreyash Jain");
        reply.setMessagePayload("{\"subject\":\"Re: hello neeraj\",\"from\":\"" + COUNTERPARTY + "\",\"to\":\""
                + INSTITUTE_ADDRESS + "\",\"body\":\"hello boss\\n\\nOn Mon wrote:\\n> hi\",\"instituteId\":\"" + INSTITUTE + "\"}");
        stubMessages(COUNTERPARTY, List.of(reply));

        List<EmailMessageDTO> out = messages(COUNTERPARTY);

        assertThat(out).hasSize(1);
        EmailMessageDTO m = out.get(0);
        assertThat(m.getDirection()).isEqualTo("INCOMING");
        assertThat(m.getOrigin()).isEqualTo("REPLY");
        assertThat(m.isSystem()).isFalse();
        assertThat(m.getSubject()).isEqualTo("Re: hello neeraj");
        assertThat(m.getInReplyToId()).isEqualTo(PARENT_LOG_ID);
        assertThat(m.getSource()).isNull();
        assertThat(m.getCounterpartyName()).isEqualTo("Shreyash Jain");
        assertThat(m.getBody()).startsWith("hello boss");
        assertThat(m.getBodyPreview()).isEqualTo("hello boss On Mon wrote: > hi");
    }

    @Test
    void unsolicitedInboundRowIsIncoming() {
        NotificationLog fresh = row("r2", "INBOUND_EMAIL", COUNTERPARTY, null, "Question", T0);
        fresh.setMessagePayload("{\"subject\":\"Question\",\"body\":\"Where is the class?\"}");
        stubMessages(COUNTERPARTY, List.of(fresh));

        EmailMessageDTO m = messages(COUNTERPARTY).get(0);

        assertThat(m.getOrigin()).isEqualTo("INCOMING");
        assertThat(m.getInReplyToId()).isNull();
        assertThat(m.getSource()).isNull();
    }

    @Test
    void otpRowIsOtp() {
        stubMessages(COUNTERPARTY, List.of(row("o1", "EMAIL", COUNTERPARTY, "OTP_SERVICE", "<p>Your OTP is 123456</p>", T0)));

        EmailMessageDTO m = messages(COUNTERPARTY).get(0);

        assertThat(m.getDirection()).isEqualTo("OUTGOING");
        assertThat(m.getOrigin()).isEqualTo("OTP");
        assertThat(m.getSubject()).isNull();
        assertThat(m.getBodyPreview()).isEqualTo("Your OTP is 123456");
    }

    @Test
    void otherOutboundOrigins() {
        NotificationLog inboxReply = row("x1", "EMAIL", COUNTERPARTY, "EMAIL_INBOX", "<p>Sure</p>", T0.plusSeconds(3));
        inboxReply.setMessagePayload("{\"subject\":\"Re: hello\"}");
        stubMessages(COUNTERPARTY, List.of(
                inboxReply,
                row("x2", "EMAIL", COUNTERPARTY, "ENGAGEMENT_ENGINE", "<p>Auto</p>", T0.plusSeconds(2)),
                row("x3", "EMAIL", COUNTERPARTY, "event:LEARNER_BATCH_ENROLLMENT", "<p>Welcome</p>", T0.plusSeconds(1)),
                row("x4", "EMAIL", COUNTERPARTY, "unified-send", "<p>Plain</p>", T0)));

        List<EmailMessageDTO> out = messages(COUNTERPARTY);

        assertThat(out).extracting(EmailMessageDTO::getOrigin)
                .containsExactly("INBOX_REPLY", "AUTOMATION", "AUTOMATION", "EMAIL");
        assertThat(out.get(0).getSubject()).isEqualTo("Re: hello");
        assertThat(out).allMatch(m -> !m.isSystem());
    }

    @Test
    @DisplayName("conversation row from a bounce is flagged system")
    void conversationFromBounceIsSystem() {
        String daemon = "mailer-daemon@ap-south-1.amazonses.com";
        NotificationLog bounce = row("b1", "INBOUND_EMAIL", daemon, PARENT_LOG_ID,
                "Delivery Status Notification (Failure)", T0);
        bounce.setMessagePayload("{\"subject\":\"Delivery Status Notification (Failure)\",\"body\":\"x\"}");
        when(notificationLogRepository.findEmailConversationsForInbox(eq(INSTITUTE), isNull(), anyList(), anyInt(), anyInt()))
                .thenReturn(List.of(bounce));
        when(notificationLogRepository.batchCountUnreadEmailMessages(any())).thenReturn(List.of());

        List<EmailConversationDTO> out = service.getConversations(INSTITUTE, 0, 30, null, null);

        assertThat(out).hasSize(1);
        assertThat(out.get(0).isSystem()).isTrue();
        assertThat(out.get(0).getLastMessageDirection()).isEqualTo("INCOMING");
        assertThat(out.get(0).getLastMessageSubject()).isEqualTo("Delivery Status Notification (Failure)");
        assertThat(out.get(0).getLastMessagePreview()).isEqualTo("Delivery Status Notification (Failure)");
    }

    @Test
    void conversationFromAnnouncementRowUsesTitleAsSubject() {
        NotificationLog announcement = row("a1", "EMAIL", COUNTERPARTY, "announcement-service", TITLE, T0);
        announcement.setSenderName("Shreyash Jain");
        when(notificationLogRepository.findEmailConversationsForInbox(eq(INSTITUTE), isNull(), anyList(), anyInt(), anyInt()))
                .thenReturn(List.of(announcement));
        when(notificationLogRepository.batchCountUnreadEmailMessages(any())).thenReturn(List.of());

        EmailConversationDTO c = service.getConversations(INSTITUTE, 0, 30, null, null).get(0);

        assertThat(c.isSystem()).isFalse();
        assertThat(c.getName()).isEqualTo("Shreyash Jain");
        assertThat(c.getLastMessageDirection()).isEqualTo("OUTGOING");
        assertThat(c.getLastMessageSubject()).isEqualTo(TITLE);
        assertThat(c.getLastMessagePreview()).isEqualTo(TITLE);
    }

    @Test
    void conversationFromHtmlRowWithoutSubjectGetsCleanPreview() {
        NotificationLog unified = row("u1", "EMAIL", COUNTERPARTY, "unified-send",
                "<div style=\"display:none\">96 x&#847; &#8199;</div><p>Hello&nbsp;there</p>", T0);
        when(notificationLogRepository.findEmailConversationsForInbox(eq(INSTITUTE), isNull(), anyList(), anyInt(), anyInt()))
                .thenReturn(List.of(unified));
        when(notificationLogRepository.batchCountUnreadEmailMessages(any())).thenReturn(List.of());

        EmailConversationDTO c = service.getConversations(INSTITUTE, 0, 30, null, null).get(0);

        assertThat(c.getLastMessageSubject()).isNull();
        assertThat(c.getLastMessagePreview()).isEqualTo("Hello there");
    }

    // ---- delivery state / plain-text previews / names --------------------------------------

    @Test
    @DisplayName("a FAILED announcement row (unsubscribed) is not presented as a delivered campaign")
    void failedAnnouncementRowCarriesDeliveryStatus() {
        NotificationLog failed = row("a1", "EMAIL", COUNTERPARTY, "announcement-service", "Welcome to the batch", T0);
        failed.setDeliveryStatus("FAILED");
        failed.setDeliveryErrorMessage("User unsubscribed from emails sent by hello@vidyayatan.com");
        stubMessages(COUNTERPARTY, List.of(failed));

        EmailMessageDTO m = messages(COUNTERPARTY).get(0);

        assertThat(m.getOrigin()).isEqualTo("CAMPAIGN");
        assertThat(m.getSubject()).isEqualTo("Welcome to the batch");
        assertThat(m.getDeliveryStatus()).isEqualTo("FAILED");
        assertThat(m.getDeliveryErrorMessage()).contains("unsubscribed");
    }

    @Test
    void successfulOutboundRowHasNoDeliveryStatus() {
        stubMessages(COUNTERPARTY, List.of(row("u1", "EMAIL", COUNTERPARTY, "unified-send", "<p>Hi</p>", T0)));

        EmailMessageDTO m = messages(COUNTERPARTY).get(0);

        assertThat(m.getDeliveryStatus()).isNull();
        assertThat(m.getDeliveryErrorMessage()).isNull();
    }

    @Test
    @DisplayName("inbound plain-text body keeps '<...>' spans in its preview")
    void inboundPlainTextPreviewKeepsAngleBrackets() {
        NotificationLog reply = row("r1", "INBOUND_EMAIL", COUNTERPARTY, PARENT_LOG_ID, "Re: price", T0);
        reply.setMessagePayload("{\"subject\":\"Re: price\",\"body\":\"Price is <500 but > 300, see <https://example.com/x>\"}");
        stubMessages(COUNTERPARTY, List.of(reply));

        EmailMessageDTO m = messages(COUNTERPARTY).get(0);

        assertThat(m.getBodyPreview()).isEqualTo("Price is <500 but > 300, see <https://example.com/x>");
    }

    @Test
    void subjectWithBracketedTokenSurvivesInPreviews() {
        NotificationLog ann = row("a1", "EMAIL", COUNTERPARTY, "announcement-service", "Reminder: <Batch A> starts Monday", T0);
        stubMessages(COUNTERPARTY, List.of(ann));
        when(notificationLogRepository.findEmailConversationsForInbox(eq(INSTITUTE), isNull(), anyList(), anyInt(), anyInt()))
                .thenReturn(List.of(ann));
        when(notificationLogRepository.batchCountUnreadEmailMessages(any())).thenReturn(List.of());

        assertThat(messages(COUNTERPARTY).get(0).getBodyPreview()).isEqualTo("Reminder: <Batch A> starts Monday");
        assertThat(service.getConversations(INSTITUTE, 0, 30, null, null).get(0).getLastMessagePreview())
                .isEqualTo("Reminder: <Batch A> starts Monday");
    }

    @Test
    @DisplayName("conversation whose latest row is the institute's reply still shows the person's name")
    void conversationNameFallsBackToLatestInboundSenderName() {
        NotificationLog reply = row("x1", "EMAIL", COUNTERPARTY, "EMAIL_INBOX", "<p>Sure</p>", T0.plusSeconds(60));
        when(notificationLogRepository.findEmailConversationsForInbox(eq(INSTITUTE), isNull(), anyList(), anyInt(), anyInt()))
                .thenReturn(List.of(reply));
        when(notificationLogRepository.batchCountUnreadEmailMessages(any())).thenReturn(List.of());
        when(notificationLogRepository.findLatestInboundSenderNames(eq(INSTITUTE), eq(List.of(COUNTERPARTY))))
                .thenReturn(List.<Object[]>of(new Object[]{COUNTERPARTY, "Neeraj Hariyale"}));

        EmailConversationDTO c = service.getConversations(INSTITUTE, 0, 30, null, null).get(0);

        assertThat(c.getName()).isEqualTo("Neeraj Hariyale");
        assertThat(c.getLastMessageDirection()).isEqualTo("OUTGOING");
    }

    // ---- paging: merged pages stay full and never split a twin pair -------------------------

    /** A campaign every 5 minutes: announcement row at T, its HTML twin 2 s later (prod order). */
    private List<NotificationLog> campaignHistory(int campaigns) {
        List<NotificationLog> all = new ArrayList<>();
        for (int i = 0; i < campaigns; i++) {
            Instant at = T0.minusSeconds(300L * i);
            all.add(row("u" + i, "EMAIL", COUNTERPARTY, "unified-send", "<p>Body " + i + "</p>", at.plusSeconds(2)));
            all.add(row("a" + i, "EMAIL", COUNTERPARTY, "announcement-service", "Campaign " + i, at));
        }
        all.sort(Comparator.comparing(NotificationLog::getNotificationDate).reversed());
        return all;
    }

    /** Fake repo over an in-memory history: honours cursor (strictly older), limit and window. */
    private void stubHistory(List<NotificationLog> history) {
        when(notificationLogRepository.findEmailMessagesForConversation(
                eq(COUNTERPARTY), eq(INSTITUTE), isNull(), anyList(), any(), anyInt()))
                .thenAnswer(inv -> {
                    String cursor = inv.getArgument(4);
                    int limit = inv.getArgument(5);
                    Instant before = cursor == null ? null : Instant.parse(cursor);
                    return history.stream()
                            .filter(nl -> before == null || nl.getNotificationDate().isBefore(before))
                            .limit(limit)
                            .collect(Collectors.toList());
                });
        // Only consulted when a cursor is present (page 2+) — lenient so first-page tests stay strict elsewhere.
        lenient().when(notificationLogRepository.findOutboundEmailsInWindow(
                eq(COUNTERPARTY), eq(INSTITUTE), isNull(), anyString(), anyString(), anyInt()))
                .thenAnswer(inv -> {
                    Instant from = Instant.parse(inv.getArgument(3));
                    Instant to = Instant.parse(inv.getArgument(4));
                    return history.stream()
                            .filter(nl -> "EMAIL".equals(nl.getNotificationType()))
                            .filter(nl -> !nl.getNotificationDate().isBefore(from) && !nl.getNotificationDate().isAfter(to))
                            .collect(Collectors.toList());
                });
    }

    @Test
    @DisplayName("a page of merged twins is still exactly `limit` long, so the FE keeps offering older history")
    void mergedPageStaysFull() {
        stubHistory(campaignHistory(30));

        List<EmailMessageDTO> page = service.getMessages(INSTITUTE, COUNTERPARTY, null, 10, null, null);

        assertThat(page).hasSize(10);
        assertThat(page).extracting(EmailMessageDTO::getId)
                .containsExactly("u0", "u1", "u2", "u3", "u4", "u5", "u6", "u7", "u8", "u9");
        assertThat(page).allMatch(m -> "CAMPAIGN".equals(m.getOrigin()));
        assertThat(page).extracting(EmailMessageDTO::getSubject).doesNotContainNull();
    }

    @Test
    @DisplayName("paging with the FE's cursor (oldest shown timestamp) never re-shows a twin as a title-only card")
    void nextPageDoesNotDuplicateTheAnnouncementHalfOfAPair() {
        stubHistory(campaignHistory(30));

        List<EmailMessageDTO> page1 = service.getMessages(INSTITUTE, COUNTERPARTY, null, 10, null, null);
        // The FE uses the oldest entry's timestamp as the next cursor; that entry is u9 (T-45min+2s),
        // whose announcement twin a9 (T-45min) is OLDER than the cursor and would be re-fetched.
        String cursor = page1.get(page1.size() - 1).getTimestamp().toString();
        List<EmailMessageDTO> page2 = service.getMessages(INSTITUTE, COUNTERPARTY, cursor, 10, null, null);

        assertThat(page2).hasSize(10);
        assertThat(page2).extracting(EmailMessageDTO::getId)
                .containsExactly("u10", "u11", "u12", "u13", "u14", "u15", "u16", "u17", "u18", "u19");
        assertThat(page2).extracting(EmailMessageDTO::getId).doesNotContain("a9");
        assertThat(page2).allMatch(m -> m.getSubject() != null && m.getBody() != null);
    }

    @Test
    void lastPageIsShortAndCompleteWhenHistoryRunsOut() {
        stubHistory(campaignHistory(7));

        List<EmailMessageDTO> page = service.getMessages(INSTITUTE, COUNTERPARTY, null, 10, null, null);

        assertThat(page).hasSize(7);
        assertThat(page).extracting(EmailMessageDTO::getSubject)
                .containsExactly("Campaign 0", "Campaign 1", "Campaign 2", "Campaign 3", "Campaign 4", "Campaign 5", "Campaign 6");
    }

    // ---- reply: the send result decides what the UI is told --------------------------------

    private EmailReplyRequest reply() {
        EmailReplyRequest req = new EmailReplyRequest();
        req.setInstituteId(INSTITUTE);
        req.setToEmail(COUNTERPARTY);
        req.setSubject("Re: hello");
        req.setBody("<p>Sure</p>");
        return req;
    }

    private void stubSendResult(boolean success, String status, String error) {
        when(emailConfigurationService.getInstituteConfiguredFromAddresses(INSTITUTE)).thenReturn(List.of(INSTITUTE_ADDRESS));
        when(unifiedSendService.routeSync(any())).thenReturn(UnifiedSendResponse.builder()
                .total(1).accepted(success ? 1 : 0).failed(success ? 0 : 1)
                .results(List.of(UnifiedSendResponse.RecipientResult.builder()
                        .email(COUNTERPARTY).success(success).status(status).error(error).build()))
                .build());
    }

    @Test
    void acceptedReplyIsSent() {
        stubSendResult(true, "SENT", null);

        EmailMessageDTO m = service.sendReply(reply());

        assertThat(m.getOrigin()).isEqualTo("INBOX_REPLY");
        assertThat(m.getDeliveryStatus()).isEqualTo("SENT");
        assertThat(m.getInstituteAddress()).isEqualTo(INSTITUTE_ADDRESS);
    }

    @Test
    void deferredReplyIsReportedAsDeferred() {
        stubSendResult(true, "DEFERRED", "Daily cap reached for this sender - queued for the next window");

        assertThat(service.sendReply(reply()).getDeliveryStatus()).isEqualTo("DEFERRED");
    }

    @Test
    @DisplayName("a blocklisted recipient is a 422, not a 'sent' bubble that vanishes on refresh")
    void blockedRecipientIsRejected() {
        stubSendResult(false, "SKIPPED_BLOCKED", "Recipient address is blocklisted (bounced)");

        assertThatThrownBy(() -> service.sendReply(reply()))
                .isInstanceOf(ResponseStatusException.class)
                .satisfies(e -> assertThat(((ResponseStatusException) e).getStatusCode()).isEqualTo(HttpStatus.UNPROCESSABLE_ENTITY))
                .hasMessageContaining("blocklisted");
    }

    @Test
    void providerFailureIsABadGateway() {
        stubSendResult(false, "FAILED", "SMTP connection refused");

        assertThatThrownBy(() -> service.sendReply(reply()))
                .isInstanceOf(ResponseStatusException.class)
                .satisfies(e -> assertThat(((ResponseStatusException) e).getStatusCode()).isEqualTo(HttpStatus.BAD_GATEWAY))
                .hasMessageContaining("SMTP connection refused");
    }
}
