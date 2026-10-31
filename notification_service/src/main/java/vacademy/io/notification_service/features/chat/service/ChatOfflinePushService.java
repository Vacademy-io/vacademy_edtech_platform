package vacademy.io.notification_service.features.chat.service;

import jakarta.annotation.PreDestroy;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;
import vacademy.io.notification_service.features.announcements.dto.AnnouncementEvent;
import vacademy.io.notification_service.features.announcements.enums.EventType;
import vacademy.io.notification_service.features.chat.dto.ChatMessagePayload;
import vacademy.io.notification_service.features.chat.dto.ChatMessageResponse;
import vacademy.io.notification_service.features.chat.enums.ChatConversationType;
import vacademy.io.notification_service.features.chat.entity.ChatMessage;
import vacademy.io.notification_service.features.chat.event.ChatFanoutEvent;
import vacademy.io.notification_service.features.chat.repository.ChatConversationMemberRepository;
import vacademy.io.notification_service.features.chat.repository.ChatMessageRepository;
import vacademy.io.notification_service.features.firebase_notifications.service.PushNotificationService;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.Executor;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.stream.Collectors;

/**
 * FCM push for chat: every member who hasn't READ a new message a few seconds after it was sent gets a push.
 *
 * <p>"Read" is the member's {@code last_read_seq}. The web/app chat screen marks a message read the moment
 * it arrives in the conversation that is currently open (ChatScreen / BatchChatPanel), and its SSE stream is
 * closed while the tab/app is backgrounded. So after the grace period the still-unread members are exactly
 * the ones NOT looking at this conversation — on another page, another conversation, a hidden tab or with
 * the app closed. This replaced an "is the user connected over SSE at all" check, which suppressed the push
 * for anyone with chat open anywhere (and, being pod-local, was wrong across replicas); the read cursor is in
 * the DB, so it is correct whichever pod handled the send.</p>
 *
 * <p>Scope: DIRECT, BATCH_GROUP and COMMUNITY. Recipients come from active, unmuted member rows — for
 * COMMUNITY that's users who have opened chat at least once (ChatScreen provisions the row on mount), not
 * every account in the institute. DIRECT and BATCH_GROUP push every unread message; COMMUNITY pushes only
 * to members who were caught up before the message (one push until they read), so a busy channel does
 * not flood phones. Community fan-outs run on their own executor so they never delay DM/batch pushes. The
 * sender is excluded. A message deleted during the grace window is not pushed. Read-receipt events never
 * push.</p>
 */
@Component
@Slf4j
public class ChatOfflinePushService {

    private final PushNotificationService pushNotificationService;
    private final ChatConversationMemberRepository memberRepo;
    private final ChatMessageRepository messageRepo;
    private final Executor chatPushExecutor;
    private final Executor communityPushExecutor;

    /** Only waits out the grace period, then hands the FCM work to chatPushExecutor — never blocks on I/O. */
    private final ScheduledExecutorService graceScheduler = Executors.newSingleThreadScheduledExecutor(r -> {
        Thread t = new Thread(r, "chat-push-grace");
        t.setDaemon(true);
        return t;
    });

    public ChatOfflinePushService(PushNotificationService pushNotificationService,
                                  ChatConversationMemberRepository memberRepo,
                                  ChatMessageRepository messageRepo,
                                  @Qualifier("chatPushExecutor") Executor chatPushExecutor,
                                  @Qualifier("chatCommunityPushExecutor") Executor communityPushExecutor) {
        this.pushNotificationService = pushNotificationService;
        this.memberRepo = memberRepo;
        this.messageRepo = messageRepo;
        this.chatPushExecutor = chatPushExecutor;
        this.communityPushExecutor = communityPushExecutor;
    }

    private static final int PREVIEW_MAX = 140;

    /**
     * How long a recipient has to read the message live (i.e. have that conversation open) before we push.
     * Covers SSE delivery + the client's markRead round-trip.
     */
    @Value("${chat.push.read-grace-ms:5000}")
    private long readGraceMs;

    /**
     * Cap on recipients for a single BATCH_GROUP message push. Above this we skip the push to avoid a
     * notification storm + FCM cost blow-up on very large batches (per-user mute preferences are the proper
     * long-term fix). DIRECT is always pushed (1 recipient).
     */
    @Value("${chat.push.batch.max-recipients:200}")
    private int batchPushMaxRecipients;

    /** Same storm guard for COMMUNITY, whose member list is the whole active chat population. */
    @Value("${chat.push.community.max-recipients:500}")
    private int communityPushMaxRecipients;

    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void onChatFanout(ChatFanoutEvent e) {
        try {
            AnnouncementEvent event = e.getEvent();
            if (event == null || event.getType() != EventType.CHAT_MESSAGE) {
                return; // only new messages — not CHAT_READ
            }
            if (!(event.getData() instanceof ChatMessagePayload payload) || payload.getMessage() == null
                    || payload.getConversationId() == null) {
                return;
            }
            if (Boolean.TRUE.equals(payload.getMessage().getIsDeleted())) {
                return; // a delete also fans out a CHAT_MESSAGE — never push a tombstone
            }
            Executor executor = ChatConversationType.COMMUNITY.name().equals(e.getConversationType())
                    ? communityPushExecutor : chatPushExecutor;
            graceScheduler.schedule(() -> executor.execute(() -> pushUnread(e, payload)),
                    readGraceMs, TimeUnit.MILLISECONDS);
        } catch (Exception ex) {
            log.warn("Chat push scheduling failed for institute {}: {}", e.getInstituteId(), ex.getMessage());
        }
    }

    private void pushUnread(ChatFanoutEvent e, ChatMessagePayload payload) {
        try {
            ChatMessageResponse msg = payload.getMessage();
            // Deleted during the grace window (by the sender or a moderator): don't push its text.
            if (msg.getId() != null && messageRepo.findById(msg.getId())
                    .map(m -> Boolean.TRUE.equals(m.getIsDeleted())).orElse(true)) {
                return;
            }
            boolean community = ChatConversationType.COMMUNITY.name().equals(e.getConversationType());
            String senderId = msg.getSenderId();
            List<String> members;
            if (msg.getSeq() != null) {
                // COMMUNITY: only members who had read everything before this message (one push until they
                // read). "Everything" = up to the previous LIVE message; deleted ones are never shown, so they
                // must not hold anyone back.
                long minReadSeq = !community ? -1L
                        : messageRepo.findFirstByConversationIdAndSeqLessThanAndIsDeletedFalseOrderBySeqDesc(
                                        payload.getConversationId(), msg.getSeq())
                                .map(ChatMessage::getSeq).orElse(-1L);
                members = memberRepo.findMemberIdsToNotify(payload.getConversationId(), msg.getSeq(), minReadSeq);
            } else {
                members = memberRepo.findActiveMemberIds(payload.getConversationId());
            }
            List<String> recipients = members.stream()
                    .filter(id -> !id.equals(senderId))
                    .collect(Collectors.toList());
            if (recipients.isEmpty()) {
                return;
            }
            int cap = community ? communityPushMaxRecipients : batchPushMaxRecipients;
            if (recipients.size() > cap) {
                // Storm guard: a very large batch/community would fan a push to hundreds of devices per message.
                log.info("Skipping chat push ({}): {} unread recipients exceeds cap {}",
                        e.getConversationType(), recipients.size(), cap);
                return;
            }

            String title = (msg.getSenderName() != null && !msg.getSenderName().isBlank())
                    ? msg.getSenderName() : "New message";
            if (community) {
                title = title + " · Community"; // otherwise it reads like a DM from the sender
            }
            String body = previewOf(msg);

            Map<String, String> data = new HashMap<>();
            data.put("type", "chat");
            data.put("action", "open_conversation");
            data.put("conversationId", payload.getConversationId());
            if (msg.getId() != null) {
                data.put("messageId", msg.getId());
            }

            // PushNotificationService no-ops gracefully when an institute has no Firebase configured
            // or a user has no active token, and auto-deactivates dead tokens.
            pushNotificationService.sendNotificationToUsers(e.getInstituteId(), recipients, title, body, data);
        } catch (Exception ex) {
            log.warn("Chat push failed for institute {}: {}", e.getInstituteId(), ex.getMessage());
        }
    }

    /**
     * Let pushes still waiting out their grace window run on shutdown (a rolling deploy would otherwise drop
     * every message committed in the last few seconds). ScheduledThreadPoolExecutor runs already-delayed tasks
     * after shutdown() by default; the push executors outlive this bean (it depends on them).
     */
    @PreDestroy
    void shutdown() {
        graceScheduler.shutdown();
        try {
            if (!graceScheduler.awaitTermination(readGraceMs + 2000, TimeUnit.MILLISECONDS)) {
                graceScheduler.shutdownNow();
            }
        } catch (InterruptedException ie) {
            graceScheduler.shutdownNow();
            Thread.currentThread().interrupt();
        }
    }

    private String previewOf(ChatMessageResponse msg) {
        if (msg.getContent() != null && !msg.getContent().isBlank()) {
            String t = msg.getContent().trim();
            return t.length() > PREVIEW_MAX ? t.substring(0, PREVIEW_MAX) + "…" : t;
        }
        return switch (msg.getContentType() == null ? "TEXT" : msg.getContentType().toUpperCase()) {
            case "IMAGE" -> "📷 Photo";
            case "FILE" -> "📎 Attachment";
            default -> "New message";
        };
    }
}
