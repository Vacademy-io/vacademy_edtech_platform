package vacademy.io.notification_service.features.announcements.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.notification_service.features.announcements.dto.*;
import vacademy.io.notification_service.features.announcements.entity.*;
import vacademy.io.notification_service.features.announcements.enums.*;
import vacademy.io.notification_service.features.announcements.exception.*;
import vacademy.io.notification_service.features.announcements.repository.*;
import vacademy.io.notification_service.features.notification_log.entity.NotificationLog;
import vacademy.io.notification_service.features.notification_log.repository.NotificationLogRepository;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.HashMap;

import java.util.stream.Collectors;

@Service
@RequiredArgsConstructor
@Slf4j
public class AnnouncementService {

    private final AnnouncementRepository announcementRepository;
    private final RichTextDataRepository richTextDataRepository;
    private final AnnouncementRecipientRepository recipientRepository;
    private final AnnouncementMediumRepository mediumRepository;
    private final ScheduledMessageRepository scheduledMessageRepository;
    private final RecipientMessageRepository recipientMessageRepository;
    private final MessageInteractionRepository messageInteractionRepository;
    private final MessageReplyRepository messageReplyRepository;
    private final NotificationLogRepository notificationLogRepository;
    
    // Mode-specific repositories
    private final AnnouncementSystemAlertRepository systemAlertRepository;
    private final AnnouncementDashboardPinRepository dashboardPinRepository;
    private final AnnouncementDMRepository dmRepository;
    private final AnnouncementStreamRepository streamRepository;
    private final AnnouncementResourceRepository resourceRepository;
    private final AnnouncementCommunityRepository communityRepository;
    private final AnnouncementTaskRepository taskRepository;
    private final AnnouncementAppOverlayRepository appOverlayRepository;

    private final AnnouncementSchedulingService schedulingService;
    private final AnnouncementProcessingService processingService;
    private final InstituteAnnouncementSettingsService instituteSettingsService;

    @Transactional
    public AnnouncementResponse createAnnouncement(CreateAnnouncementRequest request) {
        log.info("Creating announcement: {} for institute: {}", request.getTitle(), request.getInstituteId());
        
        try {
            // 1. Validate institute settings and user permissions
            validateAnnouncementPermissions(request);
            
            // 2. Create and save rich text data
            RichTextData richTextData = createRichTextData(request.getContent());
            richTextDataRepository.save(richTextData);
            
            // 3. Create and save announcement
            Announcement announcement = createAnnouncementEntity(request, richTextData.getId());
            announcementRepository.save(announcement);
            
            // 4. Save recipients (inclusions with normal IDs)
            saveRecipients(announcement.getId(), request.getRecipients(), false);
            
            // 4.5. Save exclusions (if provided - with "EXCLUDE:" prefix)
            if (request.getExclusions() != null && !request.getExclusions().isEmpty()) {
                saveRecipients(announcement.getId(), request.getExclusions(), true);
                log.info("Saved {} exclusion recipients for announcement: {}", 
                        request.getExclusions().size(), announcement.getId());
            }
            
            // 5. Save modes with specific settings
            saveModes(announcement.getId(), request.getModes());
            
            // 6. Save mediums
            saveMediums(announcement.getId(), request.getMediums());
            
            // 7. Approval flow + scheduling
            boolean approvalRequired = false;
            try {
                InstituteAnnouncementSettingsResponse settings = 
                    instituteSettingsService.getSettingsByInstituteId(request.getInstituteId());
                approvalRequired = Boolean.TRUE.equals(
                    settings != null && settings.getSettings() != null && settings.getSettings().getGeneral() != null
                        ? settings.getSettings().getGeneral().getAnnouncementApprovalRequired()
                        : Boolean.FALSE
                ) && (request.getCreatedByRole() == null || !"ADMIN".equalsIgnoreCase(request.getCreatedByRole()));
            } catch (Exception ex) {
                log.warn("Unable to resolve institute approval setting, defaulting to not required: {}", ex.getMessage());
            }

            if (approvalRequired) {
                announcement.setStatus(AnnouncementStatus.PENDING_APPROVAL);
                announcementRepository.save(announcement);
                log.info("Announcement {} set to PENDING_APPROVAL", announcement.getId());
                // We still persist any provided schedule, but will not activate delivery until approved
                if (request.getScheduling() != null) {
                    handleScheduling(announcement.getId(), request.getScheduling());
                }
            } else {
                // Proceed with immediate or scheduled delivery
                if (request.getScheduling() != null) {
                    handleScheduling(announcement.getId(), request.getScheduling());
                } else {
                    processingService.processAnnouncementDelivery(announcement.getId());
                }
            }
            
            log.info("Successfully created announcement with ID: {}", announcement.getId());
            return mapToAnnouncementResponse(announcement);
            
        } catch (Exception e) {
            log.error("Error creating announcement: {}", e.getMessage(), e);
            throw new AnnouncementException("Failed to create announcement: " + e.getMessage(), "CREATION_ERROR", e);
        }
    }


    @Transactional(readOnly = true)
    public AnnouncementResponse getAnnouncement(String announcementId) {
        if (announcementId == null || announcementId.trim().isEmpty()) {
            throw new ValidationException("Announcement ID cannot be null or empty");
        }
        
        try {
            Announcement announcement = announcementRepository.findById(announcementId)
                    .orElseThrow(() -> new AnnouncementNotFoundException(announcementId));
            
            return mapToAnnouncementResponse(announcement);
            
        } catch (AnnouncementNotFoundException e) {
            throw e;
        } catch (Exception e) {
            log.error("Error retrieving announcement: {}", announcementId, e);
            throw new AnnouncementException("Failed to retrieve announcement", "RETRIEVAL_ERROR", e);
        }
    }

    @Transactional(readOnly = true)
    public Page<AnnouncementResponse> getAnnouncementsByInstitute(String instituteId, Pageable pageable) {
        return announcementRepository.findByInstituteIdOrderByCreatedAtDesc(instituteId, pageable)
                .map(this::mapToListResponse);
    }

    @Transactional(readOnly = true)
    public Page<AnnouncementResponse> getAnnouncementsByInstituteAndStatus(String instituteId, 
                                                                          AnnouncementStatus status, 
                                                                          Pageable pageable) {
        return announcementRepository.findByInstituteIdAndStatusOrderByCreatedAtDesc(instituteId, status, pageable)
                .map(this::mapToListResponse);
    }

    @Transactional(readOnly = true)
    public Page<AnnouncementCalendarItem> getPlannedAnnouncements(String instituteId, LocalDateTime fromDate, LocalDateTime toDate, Pageable pageable) {
        return announcementRepository.findPlannedAnnouncements(instituteId, fromDate, toDate, pageable)
                .map(this::mapToCalendarItem);
    }

    @Transactional(readOnly = true)
    public Page<AnnouncementCalendarItem> getPastAnnouncements(String instituteId, LocalDateTime fromDate, LocalDateTime toDate, Pageable pageable) {
        return announcementRepository.findPastAnnouncements(instituteId, fromDate, toDate, pageable)
                .map(this::mapToCalendarItem);
    }

    /**
     * Update an existing announcement before it has been delivered.
     * Allowed only when status is DRAFT, PENDING_APPROVAL, or SCHEDULED with a future nextRunTime.
     * Replaces recipients, modes, mediums, and reschedules.
     */
    @Transactional
    public AnnouncementResponse updateAnnouncement(String announcementId, CreateAnnouncementRequest request) {
        if (announcementId == null || announcementId.isBlank()) {
            throw new ValidationException("Announcement ID is required");
        }

        Announcement announcement = announcementRepository.findById(announcementId)
                .orElseThrow(() -> new AnnouncementNotFoundException(announcementId));

        AnnouncementStatus status = announcement.getStatus();
        if (status == AnnouncementStatus.ACTIVE
                || status == AnnouncementStatus.INACTIVE
                || status == AnnouncementStatus.EXPIRED
                || status == AnnouncementStatus.REJECTED) {
            throw new ValidationException("Announcement in status " + status + " cannot be edited");
        }

        // If already scheduled, ensure the next run is still in the future
        if (status == AnnouncementStatus.SCHEDULED) {
            scheduledMessageRepository.findByAnnouncementIdAndIsActive(announcementId, true)
                    .ifPresent(sm -> {
                        LocalDateTime nextRun = sm.getNextRunTime();
                        if (nextRun != null && !nextRun.isAfter(LocalDateTime.now())) {
                            throw new ValidationException(
                                    "Send time has already passed; this announcement can no longer be edited");
                        }
                    });
        }

        try {
            // 1. Replace rich text content in place (keeps FK on announcements.rich_text_id stable)
            if (request.getContent() != null) {
                RichTextData rich = richTextDataRepository.findById(announcement.getRichTextId())
                        .orElseGet(RichTextData::new);
                rich.setType(request.getContent().getType());
                rich.setContent(request.getContent().getContent());
                richTextDataRepository.save(rich);
                if (announcement.getRichTextId() == null) {
                    announcement.setRichTextId(rich.getId());
                }
            }

            // 2. Update basic announcement fields
            if (request.getTitle() != null) {
                announcement.setTitle(request.getTitle());
            }
            if (request.getTimezone() != null) {
                announcement.setTimezone(request.getTimezone());
            } else if (request.getScheduling() != null && request.getScheduling().getTimezone() != null) {
                announcement.setTimezone(request.getScheduling().getTimezone());
            }
            announcement.setUpdatedAt(LocalDateTime.now());
            announcementRepository.save(announcement);

            // 3. Replace recipients, modes, mediums
            recipientRepository.deleteByAnnouncementId(announcementId);
            saveRecipients(announcementId, request.getRecipients(), false);
            if (request.getExclusions() != null && !request.getExclusions().isEmpty()) {
                saveRecipients(announcementId, request.getExclusions(), true);
            }

            deleteModeEntities(announcementId);
            saveModes(announcementId, request.getModes());

            mediumRepository.deleteByAnnouncementId(announcementId);
            saveMediums(announcementId, request.getMediums());

            // 4. Reschedule: cancel existing quartz job + scheduled_message, then re-create
            if (request.getScheduling() != null) {
                schedulingService.rescheduleAnnouncement(announcementId, request.getScheduling());

                // Re-align status with new schedule
                if (request.getScheduling().getScheduleType() == ScheduleType.IMMEDIATE) {
                    // IMMEDIATE means deliver now (unless still pending approval, which we leave alone)
                    if (status != AnnouncementStatus.PENDING_APPROVAL) {
                        processingService.processAnnouncementDelivery(announcementId);
                    }
                } else if (status == AnnouncementStatus.DRAFT) {
                    announcement.setStatus(AnnouncementStatus.SCHEDULED);
                    announcement.setUpdatedAt(LocalDateTime.now());
                    announcementRepository.save(announcement);
                }
            }

            log.info("Updated announcement: {}", announcementId);
            return mapToAnnouncementResponse(announcement);

        } catch (ValidationException e) {
            throw e;
        } catch (Exception e) {
            log.error("Error updating announcement {}: {}", announcementId, e.getMessage(), e);
            throw new AnnouncementException("Failed to update announcement: " + e.getMessage(), "UPDATE_ERROR", e);
        }
    }

    private void deleteModeEntities(String announcementId) {
        systemAlertRepository.deleteByAnnouncementId(announcementId);
        dashboardPinRepository.deleteByAnnouncementId(announcementId);
        dmRepository.deleteByAnnouncementId(announcementId);
        streamRepository.deleteByAnnouncementId(announcementId);
        resourceRepository.deleteByAnnouncementId(announcementId);
        communityRepository.deleteByAnnouncementId(announcementId);
        taskRepository.deleteByAnnouncementId(announcementId);
        appOverlayRepository.deleteByAnnouncementId(announcementId);
    }

    @Transactional
    public AnnouncementResponse updateAnnouncementStatus(String announcementId, AnnouncementStatus status) {
        Announcement announcement = announcementRepository.findById(announcementId)
                .orElseThrow(() -> new RuntimeException("Announcement not found: " + announcementId));
        
        announcement.setStatus(status);
        announcement.setUpdatedAt(LocalDateTime.now());
        announcementRepository.save(announcement);
        
        log.info("Updated announcement {} status to {}", announcementId, status);
        return mapToAnnouncementResponse(announcement);
    }

    /**
     * Submit announcement for approval (moves from DRAFT to PENDING_APPROVAL)
     */
    @Transactional
    public AnnouncementResponse submitForApproval(String announcementId, String submittedByRole) {
        Announcement announcement = announcementRepository.findById(announcementId)
                .orElseThrow(() -> new RuntimeException("Announcement not found: " + announcementId));

        if (announcement.getStatus() != AnnouncementStatus.DRAFT && announcement.getStatus() != AnnouncementStatus.REJECTED) {
            throw new ValidationException("Only DRAFT or REJECTED announcements can be submitted for approval");
        }
        if (submittedByRole == null || submittedByRole.isBlank()) {
            throw new ValidationException("submittedByRole is required");
        }

        announcement.setStatus(AnnouncementStatus.PENDING_APPROVAL);
        announcement.setUpdatedAt(LocalDateTime.now());
        announcementRepository.save(announcement);
        log.info("Announcement {} submitted for approval by role {}", announcementId, submittedByRole);
        return mapToAnnouncementResponse(announcement);
    }

    /**
     * Approve announcement (ADMIN only) and trigger delivery/scheduling
     */
    @Transactional
    public AnnouncementResponse approveAnnouncement(String announcementId, String approvedByRole) {
        Announcement announcement = announcementRepository.findById(announcementId)
                .orElseThrow(() -> new RuntimeException("Announcement not found: " + announcementId));

        if (announcement.getStatus() != AnnouncementStatus.PENDING_APPROVAL) {
            throw new ValidationException("Only PENDING_APPROVAL announcements can be approved");
        }
        if (approvedByRole == null || !"ADMIN".equalsIgnoreCase(approvedByRole)) {
            throw new ValidationException("Only ADMIN can approve announcements");
        }

        // After approval, deliver immediately or schedule
        if (scheduledMessageRepository.findByAnnouncementIdAndIsActive(announcementId, true).isEmpty()) {
            processingService.processAnnouncementDelivery(announcementId);
        } else {
            // If schedule exists, mark status to SCHEDULED and let scheduler fire later
            announcement.setStatus(AnnouncementStatus.SCHEDULED);
            announcement.setUpdatedAt(LocalDateTime.now());
            announcementRepository.save(announcement);
        }

        log.info("Announcement {} approved by {}", announcementId, approvedByRole);
        return mapToAnnouncementResponse(announcementRepository.findById(announcementId).orElseThrow());
    }

    /**
     * Reject announcement (ADMIN only) with reason (stored as INACTIVE for now)
     */
    @Transactional
    public AnnouncementResponse rejectAnnouncement(String announcementId, String rejectedByRole, String reason) {
        Announcement announcement = announcementRepository.findById(announcementId)
                .orElseThrow(() -> new RuntimeException("Announcement not found: " + announcementId));

        if (announcement.getStatus() != AnnouncementStatus.PENDING_APPROVAL) {
            throw new ValidationException("Only PENDING_APPROVAL announcements can be rejected");
        }
        if (rejectedByRole == null || !"ADMIN".equalsIgnoreCase(rejectedByRole)) {
            throw new ValidationException("Only ADMIN can reject announcements");
        }

        announcement.setStatus(AnnouncementStatus.REJECTED);
        announcement.setUpdatedAt(LocalDateTime.now());
        // Optionally persist reason in a future audit/log table
        announcementRepository.save(announcement);
        log.info("Announcement {} rejected by {}. Reason: {}", announcementId, rejectedByRole, reason);
        return mapToAnnouncementResponse(announcement);
    }

    @Transactional
    public void deleteAnnouncement(String announcementId) {
        if (!announcementRepository.existsById(announcementId)) {
            throw new RuntimeException("Announcement not found: " + announcementId);
        }
        
        announcementRepository.deleteById(announcementId);
        log.info("Deleted announcement: {}", announcementId);
    }

    @Transactional
    public void processAnnouncementDelivery(String announcementId) {
        // Delegate to processing service
        processingService.processAnnouncementDelivery(announcementId);
    }

    // Helper methods
    private RichTextData createRichTextData(CreateAnnouncementRequest.RichTextDataRequest request) {
        return new RichTextData(request.getType(), request.getContent());
    }

    private Announcement createAnnouncementEntity(CreateAnnouncementRequest request, String richTextId) {
        Announcement announcement = new Announcement();
        announcement.setTitle(request.getTitle());
        announcement.setRichTextId(richTextId);
        announcement.setInstituteId(request.getInstituteId());
        announcement.setCreatedBy(request.getCreatedBy());
        announcement.setCreatedByName(request.getCreatedByName());
        announcement.setCreatedByRole(request.getCreatedByRole());
        announcement.setTimezone(request.getTimezone() != null ? request.getTimezone() : "UTC");
        announcement.setEntity(request.getEntity());
        announcement.setEntityId(request.getEntityId());
        announcement.setStatus(AnnouncementStatus.DRAFT);
        return announcement;
    }

    private void saveRecipients(String announcementId, List<CreateAnnouncementRequest.RecipientRequest> recipients, boolean isExclusion) {
        if (recipients != null && !recipients.isEmpty()) {
            com.fasterxml.jackson.databind.ObjectMapper objectMapper = new com.fasterxml.jackson.databind.ObjectMapper();
            List<AnnouncementRecipient> recipientEntities = recipients.stream()
                    .map(r -> {
                        AnnouncementRecipient recipient = new AnnouncementRecipient();
                        recipient.setAnnouncementId(announcementId);
                        recipient.setRecipientType(RecipientType.valueOf(r.getRecipientType()));
                        
                        // Handle CUSTOM_FIELD_FILTER type - store filters as JSON
                        if ("CUSTOM_FIELD_FILTER".equals(r.getRecipientType())) {
                            try {
                                // Store filters as JSON in recipientName field
                                if (r.getCustomFieldFilters() == null || r.getCustomFieldFilters().isEmpty()) {
                                    log.warn("CUSTOM_FIELD_FILTER recipient has no filters provided");
                                    recipient.setRecipientName("ERROR");
                                } else {
                                    String filtersJson = objectMapper.writeValueAsString(r.getCustomFieldFilters());
                                    log.info("Serialized {} filters to JSON for CUSTOM_FIELD_FILTER: {}",
                                            r.getCustomFieldFilters().size(), filtersJson);
                                    recipient.setRecipientName(filtersJson);
                                }
                                // Use a placeholder ID or empty for CUSTOM_FIELD_FILTER
                                String recipientId = isExclusion ? "EXCLUDE:CUSTOM_FIELD_FILTER" : "CUSTOM_FIELD_FILTER";
                                recipient.setRecipientId(recipientId);
                            } catch (Exception e) {
                                log.error("Error serializing filters for CUSTOM_FIELD_FILTER recipient", e);
                                recipient.setRecipientId(isExclusion ? "EXCLUDE:CUSTOM_FIELD_FILTER" : "CUSTOM_FIELD_FILTER");
                                recipient.setRecipientName("ERROR");
                            }
                        } else {
                            // For inclusions, store exclusions as JSON in recipientName if present
                            if (!isExclusion && r.getExclusions() != null && !r.getExclusions().isEmpty()) {
                                try {
                                    String exclusionsJson = objectMapper.writeValueAsString(r.getExclusions());
                                    recipient.setRecipientName(exclusionsJson);
                                    log.info("SUCCESS: Stored {} exclusions as JSON for recipient {}: {}", r.getExclusions().size(), r.getRecipientId(), exclusionsJson);
                                } catch (Exception e) {
                                    log.error("Error serializing exclusions for recipient {}", r.getRecipientId(), e);
                                    recipient.setRecipientName(r.getRecipientName());
                                }
                            } else {
                                recipient.setRecipientName(r.getRecipientName());
                                log.debug("No exclusions for recipient {}, stored name: {}", r.getRecipientId(), r.getRecipientName());
                            }

                            // For other types and exclusions, prefix the recipientId with "EXCLUDE:"
                            String recipientId = isExclusion ? "EXCLUDE:" + r.getRecipientId() : r.getRecipientId();
                            recipient.setRecipientId(recipientId);
                        }
                        return recipient;
                    })
                    .collect(Collectors.toList());
            recipientRepository.saveAll(recipientEntities);
            log.debug("Saved {} {} for announcement: {}",
                    recipientEntities.size(),
                    isExclusion ? "exclusions" : "recipients",
                    announcementId);
        }
    }

    private void saveModes(String announcementId, List<CreateAnnouncementRequest.ModeRequest> modes) {
        if (modes != null && !modes.isEmpty()) {
            for (CreateAnnouncementRequest.ModeRequest modeRequest : modes) {
                ModeType modeType = ModeType.valueOf(modeRequest.getModeType());
                saveModeSpecificEntity(announcementId, modeType, modeRequest.getSettings());
            }
        }
    }

    private void saveModeSpecificEntity(String announcementId, ModeType modeType, Object settings) {
        log.debug("Creating mode-specific entity for announcement: {}, mode: {}", announcementId, modeType);
        
        @SuppressWarnings("unchecked")
        Map<String, Object> settingsMap = (Map<String, Object>) settings;
        
        try {
            switch (modeType) {
                case SYSTEM_ALERT:
                    createSystemAlertEntity(announcementId, settingsMap);
                    break;
                case DASHBOARD_PIN:
                    createDashboardPinEntity(announcementId, settingsMap);
                    break;
                case DM:
                    createDMEntity(announcementId, settingsMap);
                    break;
                case STREAM:
                    createStreamEntity(announcementId, settingsMap);
                    break;
                case RESOURCES:
                    createResourceEntity(announcementId, settingsMap);
                    break;
                case COMMUNITY:
                    createCommunityEntity(announcementId, settingsMap);
                    break;
                case TASKS:
                    createTaskEntity(announcementId, settingsMap);
                    break;
                case APP_OVERLAY:
                    createAppOverlayEntity(announcementId, settingsMap);
                    break;
                default:
                    log.warn("Unknown mode type: {}", modeType);
            }
        } catch (Exception e) {
            log.error("Error creating mode-specific entity for mode: {}", modeType, e);
            throw new RuntimeException("Failed to create mode-specific entity: " + e.getMessage(), e);
        }
    }

    private void saveMediums(String announcementId, List<CreateAnnouncementRequest.MediumRequest> mediums) {
        if (mediums != null && !mediums.isEmpty()) {
            List<AnnouncementMedium> mediumEntities = mediums.stream()
                    .map(m -> {
                        AnnouncementMedium medium = new AnnouncementMedium();
                        medium.setAnnouncementId(announcementId);
                        medium.setMediumType(MediumType.valueOf(m.getMediumType()));
                        medium.setMediumConfig(m.getConfig());
                        return medium;
                    })
                    .collect(Collectors.toList());
            mediumRepository.saveAll(mediumEntities);
        }
    }

    private void handleScheduling(String announcementId, CreateAnnouncementRequest.SchedulingRequest scheduling) {
        if (scheduling.getScheduleType() == ScheduleType.IMMEDIATE) {
            processingService.processAnnouncementDelivery(announcementId);
        } else {
            schedulingService.scheduleAnnouncement(announcementId, scheduling);
            // Without this the row stays DRAFT after a successful schedule, so the calendar
            // shows it as a draft even though Quartz will fire it. PENDING_APPROVAL must
            // win over SCHEDULED — the approval step is what releases delivery.
            announcementRepository.findById(announcementId).ifPresent(a -> {
                if (a.getStatus() == AnnouncementStatus.DRAFT) {
                    a.setStatus(AnnouncementStatus.SCHEDULED);
                    a.setUpdatedAt(LocalDateTime.now());
                    announcementRepository.save(a);
                }
            });
        }
    }

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

        log.debug("Found {} mode types for announcement: {}", modeTypes.size(), announcementId);
        return modeTypes;
    }

    private AnnouncementResponse mapToAnnouncementResponse(Announcement announcement) {
        return mapToAnnouncementResponse(announcement, true);
    }

    // List rows skip stats: the email part reads notification_log by source_id, which has no index,
    // so every row cost a full scan of that table. The history page loads stats per row on demand
    // from /{id}/stats instead.
    private AnnouncementResponse mapToListResponse(Announcement announcement) {
        return mapToAnnouncementResponse(announcement, false);
    }

    private AnnouncementResponse mapToAnnouncementResponse(Announcement announcement, boolean includeStats) {
        // Map entity to response DTO with all related data
        AnnouncementResponse response = new AnnouncementResponse();
        response.setId(announcement.getId());
        response.setTitle(announcement.getTitle());
        response.setInstituteId(announcement.getInstituteId());
        response.setCreatedBy(announcement.getCreatedBy());
        response.setCreatedByName(announcement.getCreatedByName());
        response.setCreatedByRole(announcement.getCreatedByRole());
        response.setStatus(announcement.getStatus());
        response.setTimezone(announcement.getTimezone());
        response.setCreatedAt(announcement.getCreatedAt());
        response.setUpdatedAt(announcement.getUpdatedAt());
        
        // Map rich text content
        if (announcement.getRichTextId() != null) {
            richTextDataRepository.findById(announcement.getRichTextId()).ifPresent(richTextData -> {
                AnnouncementResponse.RichTextDataResponse contentResponse = new AnnouncementResponse.RichTextDataResponse();
                contentResponse.setId(richTextData.getId());
                contentResponse.setType(richTextData.getType());
                contentResponse.setContent(richTextData.getContent());
                response.setContent(contentResponse);
            });
        }
        
        // Map recipients and exclusions (filter based on "EXCLUDE:" prefix)
        List<AnnouncementRecipient> allRecipients = recipientRepository.findByAnnouncementIdAndIsActive(announcement.getId(), true);
        
        // Inclusions: recipientId does NOT start with "EXCLUDE:"
        List<AnnouncementResponse.RecipientResponse> recipientResponses = allRecipients.stream()
                .filter(r -> !r.isExclusion())
                .map(recipient -> {
                    AnnouncementResponse.RecipientResponse recipientResponse = new AnnouncementResponse.RecipientResponse();
                    recipientResponse.setId(recipient.getId());
                    recipientResponse.setRecipientType(recipient.getRecipientType().name());
                    recipientResponse.setRecipientId(recipient.getRecipientId());
                    recipientResponse.setRecipientName(recipient.getRecipientName());
                    return recipientResponse;
                })
                .toList();
        response.setRecipients(recipientResponses);
        
        // Exclusions: recipientId starts with "EXCLUDE:"
        List<AnnouncementResponse.RecipientResponse> exclusionResponses = allRecipients.stream()
                .filter(AnnouncementRecipient::isExclusion)
                .map(exclusion -> {
                    AnnouncementResponse.RecipientResponse exclusionResponse = new AnnouncementResponse.RecipientResponse();
                    exclusionResponse.setId(exclusion.getId());
                    exclusionResponse.setRecipientType(exclusion.getRecipientType().name());
                    // Return actual recipient ID without prefix for API response
                    exclusionResponse.setRecipientId(exclusion.getActualRecipientId());
                    exclusionResponse.setRecipientName(exclusion.getRecipientName());
                    return exclusionResponse;
                })
                .toList();
        response.setExclusions(exclusionResponses);
        
        // Map modes with mode-specific settings
        List<ModeType> modeTypes = getModeTypesForAnnouncement(announcement.getId());
        List<AnnouncementResponse.ModeResponse> modeResponses = modeTypes.stream()
                .map(modeType -> {
                    AnnouncementResponse.ModeResponse modeResponse = new AnnouncementResponse.ModeResponse();
                    modeResponse.setModeType(modeType.name());
                    modeResponse.setIsActive(true);
                    
                    // Get mode-specific settings based on type
                    Object settings = getModeSpecificSettings(announcement.getId(), modeType);
                    modeResponse.setSettings(settings);
                    
                    return modeResponse;
                })
                .toList();
        response.setModes(modeResponses);
        
        // Map mediums
        List<AnnouncementMedium> mediums = mediumRepository.findByAnnouncementIdAndIsActive(announcement.getId(), true);
        List<AnnouncementResponse.MediumResponse> mediumResponses = mediums.stream()
                .map(medium -> {
                    AnnouncementResponse.MediumResponse mediumResponse = new AnnouncementResponse.MediumResponse();
                    mediumResponse.setId(medium.getId());
                    mediumResponse.setMediumType(medium.getMediumType().name());
                    mediumResponse.setConfig(medium.getMediumConfig());
                    mediumResponse.setIsActive(medium.getIsActive());
                    return mediumResponse;
                })
                .toList();
        response.setMediums(mediumResponses);
        
        // Map scheduling if exists
        scheduledMessageRepository.findByAnnouncementIdAndIsActive(announcement.getId(), true)
                .stream().findFirst().ifPresent(scheduledMessage -> {
                    AnnouncementResponse.SchedulingResponse schedulingResponse = new AnnouncementResponse.SchedulingResponse();
                    schedulingResponse.setId(scheduledMessage.getId());
                    schedulingResponse.setScheduleType(scheduledMessage.getScheduleType().name());
                    schedulingResponse.setCronExpression(scheduledMessage.getCronExpression());
                    schedulingResponse.setTimezone(scheduledMessage.getTimezone());
                    schedulingResponse.setStartDate(scheduledMessage.getStartDate());
                    schedulingResponse.setEndDate(scheduledMessage.getEndDate());
                    schedulingResponse.setNextRunTime(schedulingService.nextRunTimeInScheduleZone(scheduledMessage));
                    schedulingResponse.setLastRunTime(scheduledMessage.getLastRunTime());
                    schedulingResponse.setIsActive(scheduledMessage.getIsActive());
                    response.setScheduling(schedulingResponse);
                });
        
        // Map stats
        if (includeStats) {
            response.setStats(computeAnnouncementStats(announcement.getId()));
        }
        
        return response;
    }

    @Transactional(readOnly = true)
    public AnnouncementResponse.AnnouncementStatsResponse getAnnouncementStats(String announcementId) {
        return computeAnnouncementStats(announcementId);
    }

    /**
     * Per-recipient delivery + interaction state, for admin "who has seen this" analytics.
     */
    @Transactional(readOnly = true)
    public Page<AnnouncementRecipientInteractionResponse> getRecipientInteractions(
            String announcementId, ModeType modeType, Pageable pageable) {
        Page<RecipientMessage> messages = modeType != null
                ? recipientMessageRepository.findByAnnouncementIdAndModeTypeOrderByCreatedAtDesc(announcementId, modeType, pageable)
                : recipientMessageRepository.findByAnnouncementIdOrderByCreatedAtDesc(announcementId, pageable);

        return messages.map(rm -> {
            AnnouncementRecipientInteractionResponse row = new AnnouncementRecipientInteractionResponse();
            row.setRecipientMessageId(rm.getId());
            row.setUserId(rm.getUserId());
            row.setUserName(rm.getUserName());
            row.setModeType(rm.getModeType());
            row.setStatus(rm.getStatus());
            row.setDeliveredAt(rm.getDeliveredAt());
            messageInteractionRepository.findByRecipientMessageIdAndUserIdAndInteractionType(
                    rm.getId(), rm.getUserId(), InteractionType.READ)
                    .ifPresent(i -> row.setReadAt(i.getInteractionTime()));
            messageInteractionRepository.findByRecipientMessageIdAndUserIdAndInteractionType(
                    rm.getId(), rm.getUserId(), InteractionType.DISMISSED)
                    .ifPresent(i -> row.setDismissedAt(i.getInteractionTime()));
            return row;
        });
    }
    
    /**
     * Debug method to inspect email tracking data for an announcement
     * Returns detailed information about EMAIL logs and EMAIL_EVENT logs
     */
    @Transactional(readOnly = true)
    public Map<String, Object> debugEmailTracking(String announcementId) {
        Map<String, Object> debug = new HashMap<>();
        
        try {
            // 1. Find all EMAIL logs for this announcement
            List<NotificationLog> emailLogs = notificationLogRepository.findBySourceIdAndNotificationType(announcementId, "EMAIL");
            debug.put("totalEmailsSent", emailLogs.size());
            
            // Sample email logs
            List<Map<String, Object>> emailLogsSample = emailLogs.stream()
                .limit(5)
                .map(log -> {
                    Map<String, Object> logMap = new HashMap<>();
                    logMap.put("id", log.getId());
                    logMap.put("channelId", log.getChannelId());
                    logMap.put("userId", log.getUserId());
                    logMap.put("notificationDate", log.getNotificationDate());
                    logMap.put("bodyPreview", log.getBody() != null && log.getBody().length() > 50 
                        ? log.getBody().substring(0, 50) + "..." 
                        : log.getBody());
                    return logMap;
                })
                .collect(Collectors.toList());
            debug.put("emailLogsSample", emailLogsSample);
            
            if (emailLogs.isEmpty()) {
                debug.put("message", "No EMAIL logs found for this announcement");
                return debug;
            }
            
            // 2. Get all email log IDs
            List<String> emailLogIds = emailLogs.stream()
                .map(NotificationLog::getId)
                .collect(Collectors.toList());
            
            // 3. Find all EMAIL_EVENT logs
            List<NotificationLog> allEvents = notificationLogRepository.findEmailEventsBySourceIds(emailLogIds);
            debug.put("totalEmailEvents", allEvents.size());
            
            // Event breakdown by extracting event types
            Map<String, Long> eventTypeBreakdown = new HashMap<>();
            for (NotificationLog event : allEvents) {
                String eventType = extractEventTypeFromBody(event.getBody());
                eventTypeBreakdown.put(eventType, eventTypeBreakdown.getOrDefault(eventType, 0L) + 1);
            }
            debug.put("eventTypeBreakdown", eventTypeBreakdown);
            
            // Sample events with body parsing
            List<Map<String, Object>> eventsSample = allEvents.stream()
                .limit(10)
                .map(log -> {
                    Map<String, Object> logMap = new HashMap<>();
                    logMap.put("id", log.getId());
                    logMap.put("source", log.getSource());
                    logMap.put("sourceId", log.getSourceId());
                    logMap.put("channelId", log.getChannelId());
                    logMap.put("updatedAt", log.getUpdatedAt());
                    logMap.put("extractedEventType", extractEventTypeFromBody(log.getBody()));
                    logMap.put("bodyFirstLine", log.getBody() != null && log.getBody().contains("\n")
                        ? log.getBody().substring(0, log.getBody().indexOf("\n"))
                        : log.getBody());
                    return logMap;
                })
                .collect(Collectors.toList());
            debug.put("eventsSample", eventsSample);
            
            // 4. Get latest events using native query
            String[] emailLogIdsArray = emailLogIds.toArray(new String[0]);
            List<NotificationLog> latestEvents = notificationLogRepository.findLatestEmailEventsBySourceIdsNative(emailLogIdsArray);
            debug.put("emailsWithLatestEvent", latestEvents.size());
            debug.put("emailsWithoutEvents", emailLogs.size() - latestEvents.size());
            
            // Latest events breakdown
            Map<String, Long> latestEventTypeBreakdown = new HashMap<>();
            for (NotificationLog event : latestEvents) {
                String eventType = extractEventTypeFromBody(event.getBody());
                latestEventTypeBreakdown.put(eventType, latestEventTypeBreakdown.getOrDefault(eventType, 0L) + 1);
            }
            debug.put("latestEventTypeBreakdown", latestEventTypeBreakdown);
            
            // 5. Add helpful messages
            if (allEvents.isEmpty()) {
                debug.put("warning", "No EMAIL_EVENT logs found. Check if SES events are being received and processed.");
            }
            
            if (eventTypeBreakdown.containsKey("unknown")) {
                debug.put("warning", "Some events have 'unknown' type. Check event body format in notification_log table.");
            }
            
        } catch (Exception e) {
            log.error("Error in debugEmailTracking: {}", e.getMessage(), e);
            debug.put("error", e.getMessage());
        }
        
        return debug;
    }

    private AnnouncementResponse.AnnouncementStatsResponse computeAnnouncementStats(String announcementId) {
        AnnouncementResponse.AnnouncementStatsResponse stats = new AnnouncementResponse.AnnouncementStatsResponse();
        
        // Original stats from recipient_messages table
        long totalRecipients = recipientMessageRepository.countByAnnouncementId(announcementId);
        long deliveredCount = recipientMessageRepository.countByAnnouncementIdAndStatus(announcementId, MessageStatus.DELIVERED);
        long failedCount = recipientMessageRepository.countByAnnouncementIdAndStatus(announcementId, MessageStatus.FAILED);
        long readCount = messageInteractionRepository.countByAnnouncementIdAndInteractionType(announcementId, InteractionType.READ);
        long dismissedCount = messageInteractionRepository.countByAnnouncementIdAndInteractionType(announcementId, InteractionType.DISMISSED);

        stats.setTotalRecipients(totalRecipients);
        stats.setDeliveredCount(deliveredCount);
        stats.setFailedCount(failedCount);
        stats.setReadCount(readCount);
        stats.setDismissedCount(dismissedCount);

        if (totalRecipients > 0) {
            stats.setDeliveryRate((double) deliveredCount / totalRecipients * 100);
            stats.setReadRate((double) readCount / totalRecipients * 100);
            stats.setDismissRate((double) dismissedCount / totalRecipients * 100);
        } else {
            stats.setDeliveryRate(0.0);
            stats.setReadRate(0.0);
            stats.setDismissRate(0.0);
        }
        
        // Enhanced SES Email Event Stats from notification_log table
        try {
            // 1. Find all original EMAIL logs for this announcement
            List<NotificationLog> emailLogs = notificationLogRepository.findBySourceIdAndNotificationType(announcementId, "EMAIL");
            long emailsSent = emailLogs.size();
            stats.setEmailsSent(emailsSent);
            
            if (emailsSent > 0) {
                // 2. Get all email log IDs to query their events
                List<String> emailLogIds = emailLogs.stream()
                        .map(NotificationLog::getId)
                        .collect(Collectors.toList());
                
                // 3. Get latest event for each email using native query (more reliable for duplicates)
                String[] emailLogIdsArray = emailLogIds.toArray(new String[0]);
                List<NotificationLog> latestEvents = notificationLogRepository.findLatestEmailEventsBySourceIdsNative(emailLogIdsArray);
                
                // 4. Count events by extracting event type from body
                Map<String, Long> eventCounts = countEventsByType(latestEvents);
                
                // Log event breakdown for debugging
                log.debug("Event counts for announcement {}: {}", announcementId, eventCounts);
                
                long emailsSend = eventCounts.getOrDefault("send", 0L);
                long emailsDelivered = eventCounts.getOrDefault("delivery", 0L);
                long emailsOpened = eventCounts.getOrDefault("open", 0L);
                long emailsClicked = eventCounts.getOrDefault("click", 0L);
                long emailsBounced = eventCounts.getOrDefault("bounce", 0L);
                long emailsRejected = eventCounts.getOrDefault("reject", 0L);
                long emailsComplained = eventCounts.getOrDefault("complaint", 0L);
                long emailsPending = emailsSent - latestEvents.size(); // Emails without any event yet
                
                stats.setEmailsSend(emailsSend);
                stats.setEmailsDelivered(emailsDelivered);
                stats.setEmailsOpened(emailsOpened);
                stats.setEmailsClicked(emailsClicked);
                stats.setEmailsBounced(emailsBounced);
                stats.setEmailsRejected(emailsRejected);
                stats.setEmailsComplained(emailsComplained);
                stats.setEmailsPending(emailsPending);
                
                // Calculate enhanced rates
                stats.setEmailDeliveryRate(emailsSent > 0 ? (double) emailsDelivered / emailsSent * 100 : 0.0);
                stats.setEmailOpenRate(emailsDelivered > 0 ? (double) emailsOpened / emailsDelivered * 100 : 0.0);
                stats.setEmailClickRate(emailsDelivered > 0 ? (double) emailsClicked / emailsDelivered * 100 : 0.0);
                stats.setEmailBounceRate(emailsSent > 0 ? (double) emailsBounced / emailsSent * 100 : 0.0);
                stats.setEmailRejectRate(emailsSent > 0 ? (double) emailsRejected / emailsSent * 100 : 0.0);
                stats.setEmailComplaintRate(emailsSent > 0 ? (double) emailsComplained / emailsSent * 100 : 0.0);
            } else {
                // No emails sent yet, set all to 0
                stats.setEmailsSend(0L);
                stats.setEmailsDelivered(0L);
                stats.setEmailsOpened(0L);
                stats.setEmailsClicked(0L);
                stats.setEmailsBounced(0L);
                stats.setEmailsRejected(0L);
                stats.setEmailsComplained(0L);
                stats.setEmailsPending(0L);
                stats.setEmailDeliveryRate(0.0);
                stats.setEmailOpenRate(0.0);
                stats.setEmailClickRate(0.0);
                stats.setEmailBounceRate(0.0);
                stats.setEmailRejectRate(0.0);
                stats.setEmailComplaintRate(0.0);
            }
        } catch (Exception e) {
            log.error("Error computing SES email event stats for announcement {}: {}", announcementId, e.getMessage(), e);
            // Set default values if error occurs
            stats.setEmailsSent(0L);
            stats.setEmailsSend(0L);
            stats.setEmailsDelivered(0L);
            stats.setEmailsOpened(0L);
            stats.setEmailsClicked(0L);
            stats.setEmailsBounced(0L);
            stats.setEmailsRejected(0L);
            stats.setEmailsComplained(0L);
            stats.setEmailsPending(0L);
            stats.setEmailDeliveryRate(0.0);
            stats.setEmailOpenRate(0.0);
            stats.setEmailClickRate(0.0);
            stats.setEmailBounceRate(0.0);
            stats.setEmailRejectRate(0.0);
            stats.setEmailComplaintRate(0.0);
        }

        return stats;
    }
    
    /**
     * Helper method to extract event type from notification log body and count occurrences
     */
    private Map<String, Long> countEventsByType(List<NotificationLog> events) {
        Map<String, Long> counts = new HashMap<>();
        
        for (NotificationLog event : events) {
            String eventType = extractEventTypeFromBody(event.getBody());
            counts.put(eventType, counts.getOrDefault(eventType, 0L) + 1);
        }
        
        return counts;
    }
    
    /**
     * Extract event type from the notification log body
     * Body format: "Email Event: DELIVERY\n..." or "Email Event: OPEN\n..." etc.
     */
    private String extractEventTypeFromBody(String body) {
        if (body == null || body.isEmpty()) {
            return "unknown";
        }
        
        // The body format from EmailEventService.createEventDetailsBody is:
        // "Email Event: <EVENTTYPE>\n..."
        try {
            if (body.startsWith("Email Event: ")) {
                int endIndex = body.indexOf("\n");
                if (endIndex > 0) {
                    return body.substring("Email Event: ".length(), endIndex).trim().toLowerCase();
                } else {
                    return body.substring("Email Event: ".length()).trim().toLowerCase();
                }
            }
        } catch (Exception e) {
            log.warn("Error extracting event type from body: {}", body, e);
        }
        
        return "unknown";
    }

    private AnnouncementCalendarItem mapToCalendarItem(Announcement a) {
        AnnouncementCalendarItem item = new AnnouncementCalendarItem();
        item.setAnnouncementId(a.getId());
        item.setTitle(a.getTitle());
        item.setStatus(a.getStatus());
        item.setInstituteId(a.getInstituteId());
        item.setCreatedByRole(a.getCreatedByRole());
        item.setCreatedAt(a.getCreatedAt());
        item.setUpdatedAt(a.getUpdatedAt());

        // Modes summary
        List<ModeType> modeTypes = getModeTypesForAnnouncement(a.getId());
        item.setModeTypes(modeTypes.stream().map(Enum::name).toList());

        // Medium summary — what channels this is going out on (EMAIL / WHATSAPP / PUSH).
        item.setMediumTypes(
                mediumRepository.findByAnnouncementIdAndIsActive(a.getId(), true).stream()
                        .map(m -> m.getMediumType().name())
                        .toList()
        );

        // Scheduling summary (use first active schedule if present)
        scheduledMessageRepository.findByAnnouncementIdAndIsActive(a.getId(), true).ifPresent(sm -> {
            item.setScheduleType(sm.getScheduleType());
            item.setTimezone(sm.getTimezone());
            item.setStartDate(sm.getStartDate());
            item.setEndDate(sm.getEndDate());
            item.setNextRunTime(schedulingService.nextRunTimeInScheduleZone(sm));
            item.setLastRunTime(sm.getLastRunTime());
        });
        return item;
    }
    
    /**
     * Get mode-specific settings for an announcement
     */
    private Object getModeSpecificSettings(String announcementId, ModeType modeType) {
        try {
            switch (modeType) {
                case SYSTEM_ALERT:
                    return systemAlertRepository.findByAnnouncementIdAndIsActive(announcementId, true)
                            .stream().findFirst().map(this::mapSystemAlertSettings).orElse(null);
                case DASHBOARD_PIN:
                    return dashboardPinRepository.findByAnnouncementIdAndIsActive(announcementId, true)
                            .stream().findFirst().map(this::mapDashboardPinSettings).orElse(null);
                case DM:
                    return dmRepository.findByAnnouncementIdAndIsActive(announcementId, true)
                            .stream().findFirst().map(this::mapDMSettings).orElse(null);
                case STREAM:
                    return streamRepository.findByAnnouncementIdAndIsActive(announcementId, true)
                            .stream().findFirst().map(this::mapStreamSettings).orElse(null);
                case RESOURCES:
                    return resourceRepository.findByAnnouncementIdAndIsActive(announcementId, true)
                            .stream().findFirst().map(this::mapResourceSettings).orElse(null);
                case COMMUNITY:
                    return communityRepository.findByAnnouncementIdAndIsActive(announcementId, true)
                            .stream().findFirst().map(this::mapCommunitySettings).orElse(null);
                case TASKS:
                    return taskRepository.findByAnnouncementIdAndIsActive(announcementId, true)
                            .stream().findFirst().map(this::mapTaskSettings).orElse(null);
                case APP_OVERLAY:
                    return appOverlayRepository.findByAnnouncementIdAndIsActive(announcementId, true)
                            .stream().findFirst().map(this::mapAppOverlaySettings).orElse(null);
                default:
                    log.warn("Unknown mode type for settings retrieval: {}", modeType);
                    return null;
            }
        } catch (Exception e) {
            log.error("Error retrieving mode-specific settings for mode: {} and announcement: {}", 
                    modeType, announcementId, e);
            return null;
        }
    }

    private Map<String, Object> mapSystemAlertSettings(AnnouncementSystemAlert alert) {
        Map<String, Object> map = new java.util.LinkedHashMap<>();
        map.put("priority", alert.getPriority());
        map.put("isDismissible", alert.getIsDismissible());
        map.put("autoDismissAfterHours", alert.getAutoDismissAfterHours());
        map.put("showBadge", alert.getShowBadge());
        return map;
    }

    private Map<String, Object> mapDashboardPinSettings(AnnouncementDashboardPin pin) {
        Map<String, Object> map = new java.util.LinkedHashMap<>();
        map.put("pinDurationHours", pin.getPinDurationHours());
        map.put("priority", pin.getPriority());
        map.put("position", pin.getPosition());
        map.put("backgroundColor", pin.getBackgroundColor());
        map.put("isDismissible", pin.getIsDismissible());
        map.put("pinStartTime", pin.getPinStartTime());
        return map;
    }

    private Map<String, Object> mapDMSettings(AnnouncementDM dm) {
        Map<String, Object> map = new java.util.LinkedHashMap<>();
        map.put("isReplyAllowed", dm.getIsReplyAllowed());
        map.put("isForwardingAllowed", dm.getIsForwardingAllowed());
        map.put("messagePriority", dm.getMessagePriority());
        map.put("deliveryConfirmationRequired", dm.getDeliveryConfirmationRequired());
        return map;
    }

    private Map<String, Object> mapStreamSettings(AnnouncementStream stream) {
        Map<String, Object> map = new java.util.LinkedHashMap<>();
        map.put("packageSessionId", stream.getPackageSessionId());
        map.put("streamType", stream.getStreamType());
        map.put("isPinnedInStream", stream.getIsPinnedInStream());
        map.put("pinDurationHours", stream.getPinDurationHours());
        map.put("allowReactions", stream.getAllowReactions());
        map.put("allowComments", stream.getAllowComments());
        return map;
    }

    private Map<String, Object> mapResourceSettings(AnnouncementResource resource) {
        Map<String, Object> map = new java.util.LinkedHashMap<>();
        map.put("folderName", resource.getFolderName());
        map.put("category", resource.getCategory());
        map.put("subcategory", resource.getSubcategory());
        map.put("resourceType", resource.getResourceType());
        map.put("accessLevel", resource.getAccessLevel());
        map.put("isDownloadable", resource.getIsDownloadable());
        map.put("sortOrder", resource.getSortOrder());
        map.put("isFeatured", resource.getIsFeatured());
        return map;
    }

    private Map<String, Object> mapCommunitySettings(AnnouncementCommunity community) {
        Map<String, Object> map = new java.util.LinkedHashMap<>();
        map.put("communityType", community.getCommunityType());
        map.put("isPinned", community.getIsPinned());
        map.put("pinDurationHours", community.getPinDurationHours());
        map.put("allowReactions", community.getAllowReactions());
        map.put("allowComments", community.getAllowComments());
        map.put("allowSharing", community.getAllowSharing());
        map.put("isAnonymousAllowed", community.getIsAnonymousAllowed());
        map.put("moderationRequired", community.getModerationRequired());
        map.put("tags", community.getTags());
        return map;
    }

    private Map<String, Object> mapTaskSettings(AnnouncementTask task) {
        Map<String, Object> map = new java.util.LinkedHashMap<>();
        map.put("slideIds", task.getSlideIds());
        map.put("goLiveDateTime", task.getGoLiveDateTime());
        map.put("deadlineDateTime", task.getDeadlineDateTime());
        map.put("status", task.getStatus());
        map.put("taskTitle", task.getTaskTitle());
        map.put("taskDescription", task.getTaskDescription());
        map.put("estimatedDurationMinutes", task.getEstimatedDurationMinutes());
        map.put("maxAttempts", task.getMaxAttempts());
        map.put("isMandatory", task.getIsMandatory());
        map.put("autoStatusUpdate", task.getAutoStatusUpdate());
        map.put("reminderBeforeMinutes", task.getReminderBeforeMinutes());
        return map;
    }

    private Map<String, Object> mapAppOverlaySettings(AnnouncementAppOverlay overlay) {
        Map<String, Object> map = new java.util.LinkedHashMap<>();
        map.put("priority", overlay.getPriority());
        map.put("showUntil", overlay.getShowUntil());
        map.put("isDismissible", overlay.getIsDismissible());
        return map;
    }

    // Mode-specific entity creation methods with validation and defaults
    
    private void createSystemAlertEntity(String announcementId, Map<String, Object> settings) {
        AnnouncementSystemAlert alert = new AnnouncementSystemAlert();
        alert.setAnnouncementId(announcementId);
        
        // Map settings with validation and defaults
        alert.setPriority(getIntegerSetting(settings, "priority", 1, 1, 3));
        alert.setIsDismissible(getBooleanSetting(settings, "isDismissible", true));
        alert.setAutoDismissAfterHours(getIntegerSetting(settings, "autoDismissAfterHours", null, 1, 168)); // Max 1 week
        alert.setShowBadge(getBooleanSetting(settings, "showBadge", true));
        alert.setIsActive(true);
        
        systemAlertRepository.save(alert);
        log.debug("Created system alert entity for announcement: {}", announcementId);
    }
    
    private void createDashboardPinEntity(String announcementId, Map<String, Object> settings) {
        AnnouncementDashboardPin pin = new AnnouncementDashboardPin();
        pin.setAnnouncementId(announcementId);
        
        // Map settings with validation and defaults
        pin.setPinDurationHours(getIntegerSetting(settings, "pinDurationHours", 24, 1, 720)); // Max 30 days
        pin.setPriority(getIntegerSetting(settings, "priority", 1, 1, 10));
        pin.setPosition(getStringSetting(settings, "position", "top", List.of("top", "middle", "bottom")));
        pin.setBackgroundColor(getStringSetting(settings, "backgroundColor", null, null));
        pin.setIsDismissible(getBooleanSetting(settings, "isDismissible", true));
        pin.setPinStartTime(LocalDateTime.now());
        pin.setIsActive(true);
        
        dashboardPinRepository.save(pin);
        log.debug("Created dashboard pin entity for announcement: {}", announcementId);
    }
    
    private void createDMEntity(String announcementId, Map<String, Object> settings) {
        AnnouncementDM dm = new AnnouncementDM();
        dm.setAnnouncementId(announcementId);
        
        // Map settings with validation and defaults
        dm.setIsReplyAllowed(getBooleanSetting(settings, "isReplyAllowed", true));
        dm.setIsForwardingAllowed(getBooleanSetting(settings, "isForwardingAllowed", false));
        dm.setMessagePriority(getEnumSetting(settings, "messagePriority", MessagePriority.NORMAL, MessagePriority.class));
        dm.setDeliveryConfirmationRequired(getBooleanSetting(settings, "deliveryConfirmationRequired", false));
        dm.setIsActive(true);
        
        dmRepository.save(dm);
        log.debug("Created DM entity for announcement: {}", announcementId);
    }
    
    private void createStreamEntity(String announcementId, Map<String, Object> settings) {
        AnnouncementStream stream = new AnnouncementStream();
        stream.setAnnouncementId(announcementId);
        
        // Map settings with validation and defaults
        stream.setPackageSessionId(getStringSetting(settings, "packageSessionId", null, null));
        stream.setStreamType(getEnumSetting(settings, "streamType", StreamType.GENERAL, StreamType.class));
        stream.setIsPinnedInStream(getBooleanSetting(settings, "isPinnedInStream", false));
        stream.setPinDurationHours(getIntegerSetting(settings, "pinDurationHours", null, 1, 168)); // Max 1 week
        stream.setAllowReactions(getBooleanSetting(settings, "allowReactions", true));
        stream.setAllowComments(getBooleanSetting(settings, "allowComments", true));
        stream.setIsActive(true);
        
        streamRepository.save(stream);
        log.debug("Created stream entity for announcement: {}", announcementId);
    }
    
    private void createResourceEntity(String announcementId, Map<String, Object> settings) {
        AnnouncementResource resource = new AnnouncementResource();
        resource.setAnnouncementId(announcementId);
        
        // Map settings with validation and defaults - folderName is required for resources
        String folderName = getStringSetting(settings, "folderName", null, null);
        if (folderName == null || folderName.trim().isEmpty()) {
            throw new IllegalArgumentException("folderName is required for RESOURCES mode");
        }
        resource.setFolderName(folderName.trim());
        
        resource.setCategory(getStringSetting(settings, "category", null, null));
        resource.setSubcategory(getStringSetting(settings, "subcategory", null, null));
        resource.setResourceType(getEnumSetting(settings, "resourceType", ResourceType.ANNOUNCEMENT, ResourceType.class));
        resource.setAccessLevel(getEnumSetting(settings, "accessLevel", AccessLevel.ALL, AccessLevel.class));
        resource.setIsDownloadable(getBooleanSetting(settings, "isDownloadable", false));
        resource.setSortOrder(getIntegerSetting(settings, "sortOrder", 0, 0, 1000));
        resource.setIsFeatured(getBooleanSetting(settings, "isFeatured", false));
        // expiresAt can be null for no expiration
        resource.setIsActive(true);
        
        resourceRepository.save(resource);
        log.debug("Created resource entity for announcement: {} in folder: {}", announcementId, folderName);
    }
    
    private void createCommunityEntity(String announcementId, Map<String, Object> settings) {
        AnnouncementCommunity community = new AnnouncementCommunity();
        community.setAnnouncementId(announcementId);
        
        // Map settings with validation and defaults
        community.setCommunityType(getEnumSetting(settings, "communityType", CommunityType.GENERAL, CommunityType.class));
        community.setIsPinned(getBooleanSetting(settings, "isPinned", false));
        community.setPinDurationHours(getIntegerSetting(settings, "pinDurationHours", null, 1, 168)); // Max 1 week
        community.setAllowReactions(getBooleanSetting(settings, "allowReactions", true));
        community.setAllowComments(getBooleanSetting(settings, "allowComments", true));
        community.setAllowSharing(getBooleanSetting(settings, "allowSharing", true));
        community.setIsAnonymousAllowed(getBooleanSetting(settings, "isAnonymousAllowed", false));
        community.setModerationRequired(getBooleanSetting(settings, "moderationRequired", false));
        community.setTags(getStringSetting(settings, "tags", null, null));
        community.setIsActive(true);
        
        communityRepository.save(community);
        log.debug("Created community entity for announcement: {}", announcementId);
    }
    
    private void createTaskEntity(String announcementId, Map<String, Object> settings) {
        AnnouncementTask task = new AnnouncementTask();
        task.setAnnouncementId(announcementId);
        
        // Map settings with validation and defaults - slideIds, goLiveDateTime, and deadlineDateTime are required
        
        // Slide IDs - required
        Object slideIdsObj = settings.get("slideIds");
        if (slideIdsObj == null) {
            throw new IllegalArgumentException("slideIds is required for TASKS mode");
        }
        
        @SuppressWarnings("unchecked")
        List<String> slideIds = (List<String>) slideIdsObj;
        if (slideIds.isEmpty()) {
            throw new IllegalArgumentException("slideIds cannot be empty for TASKS mode");
        }
        task.setSlideIds(slideIds);
        
        // Go Live DateTime - required
        Object goLiveDateTimeObj = settings.get("goLiveDateTime");
        if (goLiveDateTimeObj == null) {
            throw new IllegalArgumentException("goLiveDateTime is required for TASKS mode");
        }
        
        LocalDateTime goLiveDateTime;
        if (goLiveDateTimeObj instanceof String) {
            try {
                goLiveDateTime = LocalDateTime.parse((String) goLiveDateTimeObj);
            } catch (Exception e) {
                throw new IllegalArgumentException("Invalid goLiveDateTime format. Expected ISO LocalDateTime format.");
            }
        } else if (goLiveDateTimeObj instanceof LocalDateTime) {
            goLiveDateTime = (LocalDateTime) goLiveDateTimeObj;
        } else {
            throw new IllegalArgumentException("Invalid goLiveDateTime type. Expected String or LocalDateTime.");
        }
        task.setGoLiveDateTime(goLiveDateTime);
        
        // Deadline DateTime - required
        Object deadlineDateTimeObj = settings.get("deadlineDateTime");
        if (deadlineDateTimeObj == null) {
            throw new IllegalArgumentException("deadlineDateTime is required for TASKS mode");
        }
        
        LocalDateTime deadlineDateTime;
        if (deadlineDateTimeObj instanceof String) {
            try {
                deadlineDateTime = LocalDateTime.parse((String) deadlineDateTimeObj);
            } catch (Exception e) {
                throw new IllegalArgumentException("Invalid deadlineDateTime format. Expected ISO LocalDateTime format.");
            }
        } else if (deadlineDateTimeObj instanceof LocalDateTime) {
            deadlineDateTime = (LocalDateTime) deadlineDateTimeObj;
        } else {
            throw new IllegalArgumentException("Invalid deadlineDateTime type. Expected String or LocalDateTime.");
        }
        task.setDeadlineDateTime(deadlineDateTime);
        
        // Validate that deadline is after go-live time
        if (deadlineDateTime.isBefore(goLiveDateTime)) {
            throw new IllegalArgumentException("deadlineDateTime must be after goLiveDateTime");
        }
        
        // Optional settings with defaults
        task.setStatus(getEnumSetting(settings, "status", TaskStatus.DRAFT, TaskStatus.class));
        task.setTaskTitle(getStringSetting(settings, "taskTitle", null, null));
        task.setTaskDescription(getStringSetting(settings, "taskDescription", null, null));
        task.setEstimatedDurationMinutes(getIntegerSetting(settings, "estimatedDurationMinutes", null, 1, 1440)); // Max 24 hours
        task.setMaxAttempts(getIntegerSetting(settings, "maxAttempts", null, 1, 10)); // Max 10 attempts
        task.setIsMandatory(getBooleanSetting(settings, "isMandatory", true));
        task.setAutoStatusUpdate(getBooleanSetting(settings, "autoStatusUpdate", true));
        task.setReminderBeforeMinutes(getIntegerSetting(settings, "reminderBeforeMinutes", null, 1, 1440)); // Max 24 hours before
        task.setIsActive(true);
        
        taskRepository.save(task);
        log.debug("Created task entity for announcement: {} with {} slides", announcementId, slideIds.size());
    }

    private void createAppOverlayEntity(String announcementId, Map<String, Object> settings) {
        AnnouncementAppOverlay overlay = new AnnouncementAppOverlay();
        overlay.setAnnouncementId(announcementId);

        overlay.setPriority(getIntegerSetting(settings, "priority", 1, 1, 10));
        overlay.setIsDismissible(getBooleanSetting(settings, "isDismissible", true));

        // Optional expiry after which the overlay stops appearing even if never dismissed
        Object showUntilObj = settings != null ? settings.get("showUntil") : null;
        if (showUntilObj instanceof LocalDateTime showUntil) {
            overlay.setShowUntil(showUntil);
        } else if (showUntilObj instanceof String showUntilStr && !showUntilStr.isBlank()) {
            try {
                overlay.setShowUntil(LocalDateTime.parse(showUntilStr));
            } catch (Exception e) {
                throw new IllegalArgumentException("Invalid showUntil format. Expected ISO LocalDateTime format.");
            }
        }
        overlay.setIsActive(true);

        appOverlayRepository.save(overlay);
        log.debug("Created app overlay entity for announcement: {}", announcementId);
    }

    // Helper methods for settings validation and defaults
    
    private Boolean getBooleanSetting(Map<String, Object> settings, String key, Boolean defaultValue) {
        if (settings == null || !settings.containsKey(key)) {
            return defaultValue;
        }
        Object value = settings.get(key);
        if (value instanceof Boolean) {
            return (Boolean) value;
        }
        if (value instanceof String) {
            return Boolean.parseBoolean((String) value);
        }
        return defaultValue;
    }
    
    private Integer getIntegerSetting(Map<String, Object> settings, String key, Integer defaultValue, Integer min, Integer max) {
        if (settings == null || !settings.containsKey(key)) {
            return defaultValue;
        }
        Object value = settings.get(key);
        Integer intValue = null;
        
        if (value instanceof Integer) {
            intValue = (Integer) value;
        } else if (value instanceof String) {
            try {
                intValue = Integer.parseInt((String) value);
            } catch (NumberFormatException e) {
                log.warn("Invalid integer value for {}: {}, using default: {}", key, value, defaultValue);
                return defaultValue;
            }
        }
        
        if (intValue != null) {
            if (min != null && intValue < min) {
                log.warn("Value {} for {} is below minimum {}, using minimum", intValue, key, min);
                return min;
            }
            if (max != null && intValue > max) {
                log.warn("Value {} for {} is above maximum {}, using maximum", intValue, key, max);
                return max;
            }
            return intValue;
        }
        
        return defaultValue;
    }
    
    private String getStringSetting(Map<String, Object> settings, String key, String defaultValue, List<String> allowedValues) {
        if (settings == null || !settings.containsKey(key)) {
            return defaultValue;
        }
        Object value = settings.get(key);
        if (value instanceof String) {
            String stringValue = (String) value;
            if (allowedValues != null && !allowedValues.contains(stringValue)) {
                log.warn("Invalid value {} for {}, using default: {}", stringValue, key, defaultValue);
                return defaultValue;
            }
            return stringValue;
        }
        return defaultValue;
    }
    
    private <T extends Enum<T>> T getEnumSetting(Map<String, Object> settings, String key, T defaultValue, Class<T> enumClass) {
        if (settings == null || !settings.containsKey(key)) {
            return defaultValue;
        }
        Object value = settings.get(key);
        if (value instanceof String) {
            try {
                return Enum.valueOf(enumClass, ((String) value).toUpperCase());
            } catch (IllegalArgumentException e) {
                log.warn("Invalid enum value {} for {}, using default: {}", value, key, defaultValue);
                return defaultValue;
            }
        }
        return defaultValue;
    }
    
    /**
     * Validate announcement permissions based on institute settings
     */
    private void validateAnnouncementPermissions(CreateAnnouncementRequest request) {
        String instituteId = request.getInstituteId();
        String createdByRole = request.getCreatedByRole();
        
        if (createdByRole == null || createdByRole.trim().isEmpty()) {
            log.warn("No creator role provided, skipping permission validation");
            return;
        }
        
        log.debug("Validating announcement permissions for role: {} in institute: {}", createdByRole, instituteId);
        
        // Check permissions for each mode
        for (CreateAnnouncementRequest.ModeRequest modeRequest : request.getModes()) {
            String modeType = modeRequest.getModeType();
            
            boolean canPerform = instituteSettingsService.canUserPerformAction(
                instituteId, 
                createdByRole, 
                "send", 
                modeType
            );
            
            if (!canPerform) {
                String errorMessage = String.format(
                    "User with role '%s' is not allowed to create announcements with mode '%s' in institute '%s'", 
                    createdByRole, modeType, instituteId
                );
                log.warn(errorMessage);
                throw new ValidationException(errorMessage);
            }
            
            log.debug("Permission granted for role: {} to use mode: {} in institute: {}", 
                    createdByRole, modeType, instituteId);
        }
        
        // Additional validations based on settings
        try {
            InstituteAnnouncementSettingsResponse settings = 
                instituteSettingsService.getSettingsByInstituteId(instituteId);
                
            validateGeneralSettings(request, settings, createdByRole);
            
        } catch (Exception e) {
            log.warn("Error validating general settings, proceeding with announcement creation: {}", e.getMessage());
            // Don't fail the announcement creation if settings validation fails
        }
    }
    
    /**
     * Validate general announcement settings
     */
    private void validateGeneralSettings(CreateAnnouncementRequest request, 
                                       InstituteAnnouncementSettingsResponse settings, 
                                       String createdByRole) {
        
        if (settings == null || settings.getSettings() == null || settings.getSettings().getGeneral() == null) {
            return;
        }
        
        InstituteAnnouncementSettingsResponse.GeneralSettings general = settings.getSettings().getGeneral();
        
        // Check if approval is required
        if (Boolean.TRUE.equals(general.getAnnouncementApprovalRequired()) && 
            !"ADMIN".equalsIgnoreCase(createdByRole)) {
            log.info("Announcement requires approval for role: {} in institute: {}", 
                    createdByRole, request.getInstituteId());
            // Note: In a real implementation, you might want to create the announcement 
            // with a "PENDING_APPROVAL" status instead of failing
        }
        
        // Check allowed mediums
        if (general.getAllowedMediums() != null && !general.getAllowedMediums().isEmpty()) {
            for (CreateAnnouncementRequest.MediumRequest mediumRequest : request.getMediums()) {
                String mediumType = mediumRequest.getMediumType();
                if (!general.getAllowedMediums().contains(mediumType)) {
                    String errorMessage = String.format(
                        "Medium type '%s' is not allowed in institute '%s'", 
                        mediumType, request.getInstituteId()
                    );
                    log.warn(errorMessage);
                    throw new ValidationException(errorMessage);
                }
            }
        }
        
        log.debug("General settings validation passed for institute: {}", request.getInstituteId());
    }
}