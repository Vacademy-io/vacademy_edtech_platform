package vacademy.io.notification_service.features.announcements.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.notification_service.features.announcements.entity.Announcement;
import vacademy.io.notification_service.features.announcements.entity.RecipientMessage;
import vacademy.io.notification_service.features.announcements.enums.AnnouncementStatus;
import vacademy.io.notification_service.features.announcements.enums.MediumType;
import vacademy.io.notification_service.features.announcements.enums.MessageStatus;
import vacademy.io.notification_service.features.announcements.enums.ModeType;
import vacademy.io.notification_service.features.announcements.repository.*;
import vacademy.io.notification_service.features.announcements.enums.EventType;
import vacademy.io.notification_service.features.announcements.dto.AnnouncementEvent;
import vacademy.io.notification_service.features.announcements.event.AnnouncementDeliveryEvent;

import java.util.ArrayList;

import java.time.LocalDateTime;
import java.time.temporal.ChronoUnit;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

@Service
@RequiredArgsConstructor
@Slf4j
public class AnnouncementProcessingService {

    private final AnnouncementRepository announcementRepository;
    private final RecipientMessageRepository recipientMessageRepository;
    private final AnnouncementMediumRepository announcementMediumRepository;
    private final RecipientResolutionService recipientResolutionService;
    private final AnnouncementEventService eventService;
    private final ApplicationEventPublisher eventPublisher;
    
    // Mode-specific repositories for checking configured modes
    private final AnnouncementSystemAlertRepository systemAlertRepository;
    private final AnnouncementDashboardPinRepository dashboardPinRepository;
    private final AnnouncementDMRepository dmRepository;
    private final AnnouncementStreamRepository streamRepository;
    private final AnnouncementResourceRepository resourceRepository;
    private final AnnouncementCommunityRepository communityRepository;
    private final AnnouncementTaskRepository taskRepository;
    private final AnnouncementAppOverlayRepository appOverlayRepository;

    /**
     * Process announcement delivery - called by both immediate and scheduled flows
     */
    @Transactional
    public void processAnnouncementDelivery(String announcementId) {
        log.info("Processing delivery for announcement: {}", announcementId);
        
        try {
            Announcement announcement = announcementRepository.findById(announcementId)
                    .orElseThrow(() -> new RuntimeException("Announcement not found: " + announcementId));
            
            // Block delivery if pending approval or rejected
            if (announcement.getStatus() == AnnouncementStatus.PENDING_APPROVAL ||
                announcement.getStatus() == AnnouncementStatus.REJECTED) {
                log.info("Announcement {} is {}. Skipping delivery.", announcementId, announcement.getStatus());
                return;
            }

            // Skip if already processed
            if (announcement.getStatus() == AnnouncementStatus.ACTIVE) {
                log.info("Announcement {} already processed, skipping", announcementId);
                return;
            }
            
            // 1. Resolve recipients to actual users
            List<String> userIds = recipientResolutionService.resolveRecipientsToUsers(announcementId);
            log.info("Resolved {} users for announcement: {}", userIds.size(), announcementId);
            
            if (userIds.isEmpty()) {
                log.warn("No users resolved for announcement: {}, marking as failed", announcementId);
                announcement.setStatus(AnnouncementStatus.INACTIVE);
                announcementRepository.save(announcement);
                return;
            }
            
            // 2. Create recipient messages for each mode
            createRecipientMessages(announcement, userIds);
            
            // 3. Publish event to trigger async delivery AFTER transaction commits
            eventPublisher.publishEvent(new AnnouncementDeliveryEvent(this, announcementId));

            // 3b. Emit SSE for new announcement to recipients
            try {
                AnnouncementEvent event = new AnnouncementEvent(EventType.NEW_ANNOUNCEMENT, announcementId, null);
                event.setModeType(ModeType.SYSTEM_ALERT);
                event.setInstituteId(announcement.getInstituteId());
                eventService.sendToAnnouncementRecipients(announcementId, event);
            } catch (Exception e) {
                log.warn("Failed to emit NEW_ANNOUNCEMENT SSE for {}", announcementId, e);
            }
            
            // 4. Update announcement status
            announcement.setStatus(AnnouncementStatus.ACTIVE);
            announcement.setUpdatedAt(LocalDateTime.now());
            announcementRepository.save(announcement);
            
            log.info("Successfully processed announcement delivery: {}", announcementId);
            
        } catch (Exception e) {
            log.error("Error processing announcement delivery: {}", announcementId, e);
            
            // Mark announcement as failed
            try {
                Announcement announcement = announcementRepository.findById(announcementId).orElse(null);
                if (announcement != null) {
                    announcement.setStatus(AnnouncementStatus.INACTIVE);
                    announcement.setUpdatedAt(LocalDateTime.now());
                    announcementRepository.save(announcement);
                }
            } catch (Exception ex) {
                log.error("Error updating announcement status to failed: {}", announcementId, ex);
            }
            
            throw new RuntimeException("Failed to process announcement delivery: " + e.getMessage(), e);
        }
    }

    /**
     * Process scheduled announcement - called by Quartz jobs
     */
    @Transactional
    public void processScheduledAnnouncement(String announcementId) {
        log.info("Processing scheduled announcement: {}", announcementId);
        
        try {
            // Use the same processing logic as immediate delivery
            processAnnouncementDelivery(announcementId);
            
        } catch (Exception e) {
            log.error("Error processing scheduled announcement: {}", announcementId, e);
            throw e; // Let the scheduler handle retry logic
        }
    }

    /**
     * Create recipient messages for each user and mode combination
     */
    private void createRecipientMessages(Announcement announcement, List<String> userIds) {
        log.debug("Creating recipient messages for announcement: {} with {} users", 
                announcement.getId(), userIds.size());
        
        // Get all modes configured for this announcement
        List<ModeType> modeTypes = getModeTypesForAnnouncement(announcement.getId());
        
        if (modeTypes.isEmpty()) {
            log.warn("No modes configured for announcement: {}, defaulting to SYSTEM_ALERT", announcement.getId());
            modeTypes = List.of(ModeType.SYSTEM_ALERT);
        }
        
        // Fetch active mediums once and create per-medium delivery records
        var activeMediums = announcementMediumRepository.findByAnnouncementIdAndIsActive(announcement.getId(), true);

        // Duplicate guard: load the pending rows ONCE. Re-querying them for every user x mode x medium
        // made this quadratic: 3,113 recipients took 122s, inside the admin's create request.
        Set<DeliveryKey> existing = new HashSet<>();
        for (RecipientMessage rm : recipientMessageRepository
                .findByAnnouncementIdAndStatus(announcement.getId(), MessageStatus.PENDING)) {
            existing.add(new DeliveryKey(rm.getUserId(), rm.getModeType(), rm.getMediumType()));
        }

        List<RecipientMessage> toCreate = new ArrayList<>();
        // Rows are built in a tight loop now, so now() per row would hand many rows the same microsecond.
        // Recipient lists and the learner feed page on created_at alone, and ties there let a row repeat or
        // vanish across pages. Stepping 1 microsecond per row keeps every timestamp distinct and in creation
        // order, as the old one-save-per-row loop did.
        LocalDateTime base = LocalDateTime.now();
        for (String userId : userIds) {
            for (ModeType modeType : modeTypes) {
                if (activeMediums.isEmpty()) {
                    // In-app-only delivery (SYSTEM_ALERT, DASHBOARD_PIN, etc.): the user sees this
                    // inside the app (bell / pinned widget) with no external send channel. Without
                    // this branch the triple-loop below produces zero rows, so the bell endpoint
                    // returns empty even though Announcement + mode entity exist. medium_type is
                    // nullable on recipient_message for exactly this case.
                    if (existing.add(new DeliveryKey(userId, modeType, null))) {
                        toCreate.add(newPendingMessage(announcement.getId(), userId, modeType, null,
                                base.plus(toCreate.size(), ChronoUnit.MICROS)));
                    }
                    continue;
                }
                for (var medium : activeMediums) {
                    // Avoid duplicates: skip if a pending row already exists for same user+mode+medium
                    if (existing.add(new DeliveryKey(userId, modeType, medium.getMediumType()))) {
                        toCreate.add(newPendingMessage(announcement.getId(), userId, modeType, medium.getMediumType(),
                                base.plus(toCreate.size(), ChronoUnit.MICROS)));
                    }
                }
            }
        }
        // Flush here so an insert failure surfaces in this method, as the old per-row saves did,
        // not later inside the SSE try/catch that only logs a warning
        recipientMessageRepository.saveAllAndFlush(toCreate);

        log.debug("Created {} recipient messages for {} users and {} modes", toCreate.size(), userIds.size(), modeTypes.size());
    }

    private record DeliveryKey(String userId, ModeType modeType, MediumType mediumType) {}

    private static RecipientMessage newPendingMessage(String announcementId, String userId, ModeType modeType,
                                                      MediumType mediumType, LocalDateTime createdAt) {
        RecipientMessage recipientMessage = new RecipientMessage();
        recipientMessage.setAnnouncementId(announcementId);
        recipientMessage.setUserId(userId);
        recipientMessage.setModeType(modeType);
        recipientMessage.setMediumType(mediumType);
        recipientMessage.setStatus(MessageStatus.PENDING);
        recipientMessage.setCreatedAt(createdAt);
        recipientMessage.setUpdatedAt(createdAt);
        return recipientMessage;
    }

    /**
     * Get mode types configured for an announcement by checking mode-specific tables
     */
    private List<ModeType> getModeTypesForAnnouncement(String announcementId) {
        List<ModeType> modeTypes = new ArrayList<>();
        
        // Check each mode-specific repository to see which modes are configured
        if (!systemAlertRepository.findByAnnouncementIdAndIsActive(announcementId, true).isEmpty()) {
            modeTypes.add(ModeType.SYSTEM_ALERT);
        }
        
        if (!dashboardPinRepository.findByAnnouncementIdAndIsActive(announcementId, true).isEmpty()) {
            modeTypes.add(ModeType.DASHBOARD_PIN);
        }
        
        if (!dmRepository.findByAnnouncementIdAndIsActive(announcementId, true).isEmpty()) {
            modeTypes.add(ModeType.DM);
        }
        
        if (!streamRepository.findByAnnouncementIdAndIsActive(announcementId, true).isEmpty()) {
            modeTypes.add(ModeType.STREAM);
        }
        
        if (!resourceRepository.findByAnnouncementIdAndIsActive(announcementId, true).isEmpty()) {
            modeTypes.add(ModeType.RESOURCES);
        }
        
        if (!communityRepository.findByAnnouncementIdAndIsActive(announcementId, true).isEmpty()) {
            modeTypes.add(ModeType.COMMUNITY);
        }
        
        if (!taskRepository.findByAnnouncementIdAndIsActive(announcementId, true).isEmpty()) {
            modeTypes.add(ModeType.TASKS);
        }

        if (!appOverlayRepository.findByAnnouncementIdAndIsActive(announcementId, true).isEmpty()) {
            modeTypes.add(ModeType.APP_OVERLAY);
        }

        // If no modes are configured, default to SYSTEM_ALERT
        if (modeTypes.isEmpty()) {
            log.warn("No modes configured for announcement: {}, defaulting to SYSTEM_ALERT", announcementId);
            modeTypes.add(ModeType.SYSTEM_ALERT);
        }
        
        log.debug("Found {} mode types for announcement: {}", modeTypes.size(), announcementId);
        return modeTypes;
    }

    /**
     * Get processing statistics for an announcement
     */
    @Transactional(readOnly = true)
    public ProcessingStats getProcessingStats(String announcementId) {
        List<RecipientMessage> messages = recipientMessageRepository.findByAnnouncementId(announcementId);
        
        long total = messages.size();
        long pending = messages.stream().mapToLong(m -> m.getStatus() == MessageStatus.PENDING ? 1 : 0).sum();
        long sent = messages.stream().mapToLong(m -> m.getStatus() == MessageStatus.SENT ? 1 : 0).sum();
        long delivered = messages.stream().mapToLong(m -> m.getStatus() == MessageStatus.DELIVERED ? 1 : 0).sum();
        long failed = messages.stream().mapToLong(m -> m.getStatus() == MessageStatus.FAILED ? 1 : 0).sum();
        long read = messages.stream().mapToLong(m -> m.getStatus() == MessageStatus.READ ? 1 : 0).sum();
        
        return new ProcessingStats(total, pending, sent, delivered, failed, read);
    }

    // Helper class for statistics
    public static class ProcessingStats {
        private final long total;
        private final long pending;
        private final long sent;
        private final long delivered;
        private final long failed;
        private final long read;
        
        public ProcessingStats(long total, long pending, long sent, long delivered, long failed, long read) {
            this.total = total;
            this.pending = pending;
            this.sent = sent;
            this.delivered = delivered;
            this.failed = failed;
            this.read = read;
        }
        
        // Getters
        public long getTotal() { return total; }
        public long getPending() { return pending; }
        public long getSent() { return sent; }
        public long getDelivered() { return delivered; }
        public long getFailed() { return failed; }
        public long getRead() { return read; }
        public double getDeliveryRate() { return total > 0 ? (double) delivered / total * 100 : 0; }
        public double getReadRate() { return delivered > 0 ? (double) read / delivered * 100 : 0; }
    }
}