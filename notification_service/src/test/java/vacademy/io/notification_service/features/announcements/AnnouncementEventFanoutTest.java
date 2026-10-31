package vacademy.io.notification_service.features.announcements;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentMatchers;
import org.mockito.Mockito;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.boot.test.mock.mockito.SpyBean;
import org.springframework.test.context.ActiveProfiles;
import vacademy.io.notification_service.features.announcements.dto.AnnouncementEvent;
import vacademy.io.notification_service.features.announcements.entity.Announcement;
import vacademy.io.notification_service.features.announcements.entity.RecipientMessage;
import vacademy.io.notification_service.features.announcements.entity.RichTextData;
import vacademy.io.notification_service.features.announcements.enums.EventType;
import vacademy.io.notification_service.features.announcements.enums.MessageStatus;
import vacademy.io.notification_service.features.announcements.enums.ModeType;
import vacademy.io.notification_service.features.announcements.repository.AnnouncementRepository;
import vacademy.io.notification_service.features.announcements.repository.RecipientMessageRepository;
import vacademy.io.notification_service.features.announcements.repository.RichTextDataRepository;
import vacademy.io.notification_service.features.announcements.service.AnnouncementEventService;
import vacademy.io.notification_service.features.announcements.service.SSEConnectionManager;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Guards the SSE fan-out against the N+1 that made a single dismiss take 14s in production.
 *
 * <p>Shape taken from the worst real announcement: 1116 recipient_messages rows across only 93
 * distinct users, because a row is written per delivery rather than per user.
 */
@SpringBootTest
@ActiveProfiles("test")
class AnnouncementEventFanoutTest {

    private static final int USERS = 93;
    private static final int ROWS_PER_USER = 12;

    @Autowired private AnnouncementEventService eventService;
    @Autowired private AnnouncementRepository announcementRepository;
    @Autowired private RichTextDataRepository richTextDataRepository;
    @SpyBean private RecipientMessageRepository recipientMessageRepository;
    @MockBean private SSEConnectionManager connectionManager;

    private String announcementId;
    private String seededMessageId;

    @BeforeEach
    void seed() {
        recipientMessageRepository.deleteAll();
        announcementRepository.deleteAll();

        // Ids are @UuidGenerator-assigned, so let the provider set them and read them back.
        RichTextData body = new RichTextData();
        body.setType("html");
        body.setContent("<p>fan-out fixture</p>");
        body = richTextDataRepository.saveAndFlush(body);

        Announcement announcement = new Announcement();
        announcement.setTitle("Fan-out fixture");
        announcement.setRichTextId(body.getId());
        announcement.setInstituteId("inst-fanout-test");
        announcement.setCreatedBy("admin-fanout-test");
        announcementId = announcementRepository.saveAndFlush(announcement).getId();

        List<RecipientMessage> rows = new ArrayList<>();
        for (int u = 0; u < USERS; u++) {
            for (int r = 0; r < ROWS_PER_USER; r++) {
                RecipientMessage rm = new RecipientMessage();
                rm.setAnnouncementId(announcementId);
                rm.setUserId("user-" + u);
                rm.setModeType(ModeType.APP_OVERLAY);
                rm.setStatus(MessageStatus.DELIVERED);
                rows.add(rm);
            }
        }
        seededMessageId = recipientMessageRepository.saveAll(rows).get(0).getId();
        Mockito.clearInvocations(recipientMessageRepository);
    }

    private AnnouncementEvent dismissEvent() {
        AnnouncementEvent event = AnnouncementEvent.builder()
                .type(EventType.MESSAGE_DISMISSED)
                .announcementId(announcementId)
                .data(Map.of("recipientMessageId", seededMessageId))
                .build();
        event.setModeType(ModeType.APP_OVERLAY);
        return event;
    }

    @Test
    @DisplayName("distinct-user projection collapses per-delivery rows to one id per user")
    void projectionReturnsDistinctUsers() {
        assertThat(recipientMessageRepository.findByAnnouncementId(announcementId))
                .hasSize(USERS * ROWS_PER_USER);
        assertThat(recipientMessageRepository.findDistinctUserIdsByAnnouncementId(announcementId))
                .hasSize(USERS)
                .doesNotHaveDuplicates();
    }

    @Test
    @DisplayName("dismiss fan-out issues no per-user membership query and delivers once per user")
    void fanoutIsNotNPlusOne() {
        eventService.sendToMessageRecipients(seededMessageId, dismissEvent());

        // The N+1: one membership lookup per row in the list being iterated.
        Mockito.verify(recipientMessageRepository, Mockito.never())
                .findByAnnouncementIdAndUserId(ArgumentMatchers.anyString(), ArgumentMatchers.anyString());

        // Entity hydration of every delivery row, only to read user_id off it.
        Mockito.verify(recipientMessageRepository, Mockito.never())
                .findByAnnouncementId(ArgumentMatchers.anyString());

        // Each user is sent the event exactly once, not once per delivery row.
        Mockito.verify(connectionManager, Mockito.times(USERS))
                .sendToUser(ArgumentMatchers.anyString(), ArgumentMatchers.any(AnnouncementEvent.class));
        for (int u = 0; u < USERS; u++) {
            Mockito.verify(connectionManager).sendToUser(
                    ArgumentMatchers.eq("user-" + u), ArgumentMatchers.any(AnnouncementEvent.class));
        }
    }

    @Test
    @DisplayName("announcement fan-out is deduplicated the same way")
    void announcementFanoutIsDeduplicated() {
        AnnouncementEvent event = AnnouncementEvent.builder()
                .type(EventType.ANNOUNCEMENT_UPDATED)
                .announcementId(announcementId)
                .build();

        eventService.sendToAnnouncementRecipients(announcementId, event);

        Mockito.verify(recipientMessageRepository, Mockito.never())
                .findByAnnouncementIdAndUserId(ArgumentMatchers.anyString(), ArgumentMatchers.anyString());
        Mockito.verify(connectionManager, Mockito.times(USERS))
                .sendToUser(ArgumentMatchers.anyString(), ArgumentMatchers.any(AnnouncementEvent.class));
    }

    @Test
    @DisplayName("an unproven user id is still membership-checked and filtered out")
    void unverifiedUserIdsStillChecked() {
        AnnouncementEvent event = AnnouncementEvent.builder()
                .type(EventType.ANNOUNCEMENT_UPDATED)
                .announcementId(announcementId)
                .build();

        // Public entry point used by PushNotificationController: ids come from a request body, so
        // membership is unproven and must still be verified per user.
        eventService.sendToUsers(List.of("user-0", "stranger"), event);

        Mockito.verify(recipientMessageRepository)
                .findByAnnouncementIdAndUserId(announcementId, "user-0");
        Mockito.verify(recipientMessageRepository)
                .findByAnnouncementIdAndUserId(announcementId, "stranger");
        Mockito.verify(connectionManager)
                .sendToUser(ArgumentMatchers.eq("user-0"), ArgumentMatchers.any(AnnouncementEvent.class));
        Mockito.verify(connectionManager, Mockito.never())
                .sendToUser(ArgumentMatchers.eq("stranger"), ArgumentMatchers.any(AnnouncementEvent.class));
    }
}
