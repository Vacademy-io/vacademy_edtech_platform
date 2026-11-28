package vacademy.io.notification_service.features.announcements;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentMatchers;
import org.mockito.Mockito;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
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

import static org.assertj.core.api.Assertions.assertThat;

/**
 * A read/dismiss receipt is for the person who posted the announcement, not for the other 92
 * learners who happen to share it. Guards the routing and the privacy property together.
 */
@SpringBootTest
@ActiveProfiles("test")
class MessageInteractionReceiptTest {

    private static final String CREATOR_ID = "admin-who-posted";
    private static final int RECIPIENTS = 20;

    @Autowired private AnnouncementEventService eventService;
    @Autowired private AnnouncementRepository announcementRepository;
    @Autowired private RecipientMessageRepository recipientMessageRepository;
    @Autowired private RichTextDataRepository richTextDataRepository;
    @MockBean private SSEConnectionManager connectionManager;

    private String announcementId;

    @BeforeEach
    void seed() {
        recipientMessageRepository.deleteAll();
        announcementRepository.deleteAll();

        // announcements.rich_text_id is a real FK, so the body has to exist first.
        RichTextData body = new RichTextData();
        body.setType("html");
        body.setContent("<p>Official update</p>");
        String richTextId = richTextDataRepository.save(body).getId();

        Announcement announcement = new Announcement();
        announcement.setTitle("Official update");
        announcement.setRichTextId(richTextId);
        announcement.setInstituteId("INST_1");
        announcement.setCreatedBy(CREATOR_ID);
        announcementId = announcementRepository.save(announcement).getId();

        List<RecipientMessage> rows = new ArrayList<>();
        for (int u = 0; u < RECIPIENTS; u++) {
            RecipientMessage rm = new RecipientMessage();
            rm.setAnnouncementId(announcementId);
            rm.setUserId("learner-" + u);
            rm.setModeType(ModeType.APP_OVERLAY);
            rm.setStatus(MessageStatus.DELIVERED);
            rows.add(rm);
        }
        recipientMessageRepository.saveAll(rows);
        Mockito.clearInvocations(connectionManager);
    }

    private AnnouncementEvent readEvent() {
        AnnouncementEvent event = AnnouncementEvent.builder()
                .type(EventType.MESSAGE_READ)
                .announcementId(announcementId)
                .build();
        event.setModeType(ModeType.APP_OVERLAY);
        return event;
    }

    @Test
    @DisplayName("receipt reaches the creator and nobody else")
    void receiptGoesOnlyToCreator() {
        eventService.sendToAnnouncementCreator(announcementId, readEvent());

        Mockito.verify(connectionManager)
                .sendToUser(ArgumentMatchers.eq(CREATOR_ID), ArgumentMatchers.any(AnnouncementEvent.class));
        Mockito.verify(connectionManager, Mockito.times(1))
                .sendToUser(ArgumentMatchers.anyString(), ArgumentMatchers.any(AnnouncementEvent.class));
    }

    @Test
    @DisplayName("creator is not a recipient, so the receipt only lands via the verified path")
    void creatorIsNotARecipient() {
        // If sendToAnnouncementCreator ever stops marking the id as verified, the membership filter
        // drops the event and receipts go silently missing. This is what makes that regression loud.
        assertThat(recipientMessageRepository.findByAnnouncementIdAndUserId(announcementId, CREATOR_ID))
                .isEmpty();
        assertThat(recipientMessageRepository.findDistinctUserIdsByAnnouncementId(announcementId))
                .hasSize(RECIPIENTS)
                .doesNotContain(CREATOR_ID);
    }

    @Test
    @DisplayName("a missing announcement is a no-op, not a failure")
    void missingAnnouncementIsSilent() {
        eventService.sendToAnnouncementCreator("does-not-exist", readEvent());

        Mockito.verify(connectionManager, Mockito.never())
                .sendToUser(ArgumentMatchers.anyString(), ArgumentMatchers.any(AnnouncementEvent.class));
    }
}
