package vacademy.io.notification_service.features.announcements;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentMatchers;
import org.mockito.Mockito;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.test.context.ActiveProfiles;
import vacademy.io.common.auth.entity.User;
import vacademy.io.notification_service.features.announcements.client.AuthServiceClient;
import vacademy.io.notification_service.features.announcements.dto.CreateAnnouncementRequest;
import vacademy.io.notification_service.features.announcements.entity.RecipientMessage;
import vacademy.io.notification_service.features.announcements.enums.MessageStatus;
import vacademy.io.notification_service.features.announcements.repository.RecipientMessageRepository;
import vacademy.io.notification_service.features.announcements.service.AnnouncementService;
import vacademy.io.notification_service.features.announcements.service.RecipientResolutionService;
import vacademy.io.notification_service.features.firebase_notifications.service.PushNotificationService;
import vacademy.io.notification_service.features.send.service.UnifiedSendService;
import vacademy.io.notification_service.service.EmailService;

import java.util.List;
import java.util.Map;
import java.util.stream.IntStream;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * An announcement with more recipients than one delivery batch must reach all of them.
 *
 * <p>Delivery used to page by page number over the PENDING rows. Each batch moves its rows out of
 * PENDING, so every next page skipped a page of rows. In prod a 3,113-recipient email sent 1,613
 * and left 1,500 PENDING. Here 12 recipients with a batch of 5 would have sent 7.
 */
@SpringBootTest(properties = "announcement.delivery.batch.size=5")
@ActiveProfiles("test")
class AnnouncementBatchedDeliveryTest {

    private static final int RECIPIENTS = 12;

    @Autowired private AnnouncementService announcementService;
    @Autowired private RecipientMessageRepository recipientMessageRepository;

    @MockBean private RecipientResolutionService recipientResolutionService;
    @MockBean private AuthServiceClient authServiceClient;
    @MockBean private UnifiedSendService unifiedSendService;
    @MockBean private EmailService emailService;
    @MockBean private PushNotificationService pushNotificationService;

    @Test
    @DisplayName("Email delivery reaches every recipient when they span several batches")
    void emailReachesEveryRecipientAcrossBatches() throws InterruptedException {
        List<String> userIds = IntStream.range(0, RECIPIENTS).mapToObj(i -> "USER_BATCH_" + i).toList();
        List<User> users = userIds.stream().map(id -> {
            User user = new User();
            user.setId(id);
            user.setEmail(id.toLowerCase() + "@example.com");
            return user;
        }).toList();
        Mockito.when(recipientResolutionService.resolveRecipientsToUsers(ArgumentMatchers.anyString()))
                .thenReturn(userIds);
        Mockito.when(authServiceClient.getUsersByIdsInBatches(ArgumentMatchers.anyList(), ArgumentMatchers.anyInt()))
                .thenAnswer(inv -> {
                    List<String> requested = inv.getArgument(0);
                    return users.stream().filter(u -> requested.contains(u.getId())).toList();
                });

        String announcementId = announcementService.createAnnouncement(buildRequest()).getId();

        // One row per recipient, written in a single batch by the create path. Every created_at is distinct,
        // because recipient lists page on created_at alone.
        assertThat(recipientMessageRepository.countByAnnouncementId(announcementId)).isEqualTo(RECIPIENTS);
        assertThat(recipientMessageRepository.findByAnnouncementId(announcementId))
                .extracting(RecipientMessage::getCreatedAt).doesNotHaveDuplicates();

        // Delivery runs async after the create transaction commits
        long deadline = System.currentTimeMillis() + 15_000;
        while (System.currentTimeMillis() < deadline
                && recipientMessageRepository.countByAnnouncementIdAndStatus(announcementId, MessageStatus.DELIVERED) < RECIPIENTS) {
            Thread.sleep(100);
        }

        List<RecipientMessage> rows = recipientMessageRepository.findByAnnouncementId(announcementId);
        assertThat(rows).extracting(RecipientMessage::getStatus).containsOnly(MessageStatus.DELIVERED);
        assertThat(rows).extracting(RecipientMessage::getUserId).containsExactlyInAnyOrderElementsOf(userIds);
        Mockito.verify(unifiedSendService, Mockito.times(RECIPIENTS)).routeSync(ArgumentMatchers.any());
    }

    private CreateAnnouncementRequest buildRequest() {
        CreateAnnouncementRequest req = new CreateAnnouncementRequest();
        req.setTitle("Batched Delivery");
        var content = new CreateAnnouncementRequest.RichTextDataRequest();
        content.setType("html");
        content.setContent("<b>Hello</b> {{user_name}}");
        req.setContent(content);
        req.setInstituteId("INST_BATCHED");
        req.setCreatedBy("CREATOR_BATCHED");
        req.setCreatedByRole("ADMIN");
        var recipient = new CreateAnnouncementRequest.RecipientRequest();
        recipient.setRecipientType("ROLE");
        recipient.setRecipientId("STUDENT");
        req.setRecipients(List.of(recipient));
        req.setModes(List.of(new CreateAnnouncementRequest.ModeRequest("SYSTEM_ALERT", Map.of("priority", "HIGH"))));

        var email = new CreateAnnouncementRequest.MediumRequest();
        email.setMediumType("EMAIL");
        email.setConfig(Map.of("subject", "Batched", "fromEmail", "noreply@example.com"));
        req.setMediums(List.of(email));
        return req;
    }
}
