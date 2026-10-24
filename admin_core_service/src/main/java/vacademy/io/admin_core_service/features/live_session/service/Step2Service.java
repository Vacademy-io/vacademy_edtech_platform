package vacademy.io.admin_core_service.features.live_session.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.common.entity.CustomFields;
import vacademy.io.admin_core_service.features.common.entity.InstituteCustomField;
import vacademy.io.admin_core_service.features.common.enums.CustomFieldTypeEnum;
import vacademy.io.admin_core_service.features.common.repository.InstituteCustomFieldRepository;
import vacademy.io.admin_core_service.features.common.repository.CustomFieldRepository;
import vacademy.io.admin_core_service.features.common.service.InstituteCustomFiledService;
import vacademy.io.admin_core_service.features.live_session.dto.AttendanceCriteriaConfigDTO;
import vacademy.io.admin_core_service.features.live_session.dto.LiveSessionStep2RequestDTO;
import vacademy.io.admin_core_service.features.live_session.entity.*;
import vacademy.io.admin_core_service.features.live_session.enums.*;
import vacademy.io.admin_core_service.features.live_session.repository.*;
import vacademy.io.admin_core_service.features.live_session.constants.LiveClassEmailBody;
import vacademy.io.admin_core_service.features.institute_learner.repository.StudentSessionInstituteGroupMappingRepository;
import vacademy.io.admin_core_service.features.live_session.scheduler.LiveSessionNotificationProcessor;
import vacademy.io.admin_core_service.features.notification.dto.NotificationDTO;
import vacademy.io.admin_core_service.features.notification.dto.NotificationToUserDTO;
import vacademy.io.admin_core_service.features.notification_service.service.NotificationService;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.VacademyException;

import java.util.ArrayList;
import java.util.Map;
import java.util.UUID;
import java.util.List;

@Service
@lombok.extern.slf4j.Slf4j
public class Step2Service {

    @Autowired
    private AttendanceCriteriaService attendanceCriteriaService;

    @Autowired
    private LiveSessionRepository sessionRepository;

    @Autowired
    private SessionScheduleRepository scheduleRepository;

    @Autowired
    private ScheduleNotificationRepository scheduleNotificationRepository;

    @Autowired
    private LiveSessionParticipantRepository liveSessionParticipantRepository;

    @Autowired
    private CustomFieldRepository customFieldRepository;

    @Autowired
    private InstituteCustomFieldRepository instituteCustomFieldRepository;

    @Autowired
    private InstituteCustomFiledService instituteCustomFiledService;

    @Autowired
    private ObjectMapper objectMapper;

    @Autowired
    private StudentSessionInstituteGroupMappingRepository mappingRepository;

    @Autowired
    private NotificationService notificationService;

    @Autowired
    private LiveSessionNotificationProcessor liveSessionNotificationProcessor;

    @Autowired
    private LiveSessionNotificationConfigRepository notificationConfigRepository;

    @Autowired
    private vacademy.io.admin_core_service.features.common.util.CustomFieldKeyGenerator customFieldKeyGenerator;

    @Autowired
    private LiveSessionPaymentService liveSessionPaymentService;

    @Autowired
    private LiveSessionInstructorService instructorService;

    public Boolean step2AddService(LiveSessionStep2RequestDTO request, CustomUserDetails user) {
        LiveSession session = getSessionOrThrow(request.getSessionId());

        // Capture before any mutation: if the session is already LIVE, this Step2 call
        // is an edit of an existing live class (not the first publish from DRAFT).
        boolean isEdit = LiveSessionStatus.LIVE.name().equalsIgnoreCase(session.getStatus());

        updateSessionAccessLevel(session, request);
        linkParticipants(request);
        // Null means "client didn't send instructors" and is a no-op inside the
        // service, so pre-V524 clients keep the creator seeded at step 1.
        instructorService.syncInstructors(session.getId(), resolveInstructorUserIds(request, session));
        processNotificationActions(request, session.getId(), isEdit);
        processCustomFields(request, session);
        liveSessionPaymentService.upsertPaymentConfig(session, request.getPaymentConfig());
        processRecordingAutoLinkConfig(request, session);
        processAudiencePushConfig(request, session);
        processAttendanceCriteria(session, isEdit);

        session.setStatus(LiveSessionStatus.LIVE.name());
        sessionRepository.save(session);

        return true;
    }

    /**
     * The instructor id list to reconcile to: explicit ids, plus any
     * human-typed identifiers (email / username) resolved against the institute
     * directory.
     *
     * <p>Returns null — a no-op for the sync — when the client sent neither
     * field, which is what keeps pre-V524 clients unaffected. Unresolvable
     * identifiers are dropped with a log line here; the bulk endpoint resolves
     * them up front instead so it can report them per row.
     */
    private List<String> resolveInstructorUserIds(LiveSessionStep2RequestDTO request, LiveSession session) {
        List<String> explicitIds = request.getInstructorUserIds();
        List<String> identifiers = request.getInstructorIdentifiers();
        if (explicitIds == null && identifiers == null) {
            return null;
        }

        List<String> merged = new ArrayList<>();
        if (explicitIds != null) {
            merged.addAll(explicitIds);
        }
        if (identifiers != null && !identifiers.isEmpty()) {
            LiveSessionInstructorService.ResolvedIdentifiers resolved =
                    instructorService.resolveIdentifiers(session.getInstituteId(), identifiers);
            resolved.userIds().stream().filter(id -> !merged.contains(id)).forEach(merged::add);
            if (!resolved.unresolved().isEmpty()) {
                log.warn("live_session.instructors.unresolved sessionId={} identifiers={}",
                        session.getId(), resolved.unresolved());
            }
        }
        return merged;
    }

    private LiveSession getSessionOrThrow(String sessionId) {
        return sessionRepository.findById(sessionId)
                .orElseThrow(() -> new RuntimeException("Session not found"));
    }

    private void updateSessionAccessLevel(LiveSession session, LiveSessionStep2RequestDTO request) {
        session.setAccessLevel(request.getAccessType());
        if (LiveSessionAccessEnum.PUBLIC.name().equalsIgnoreCase(request.getAccessType())) {
            session.setRegistrationFormLinkForPublicSessions(request.getJoinLink());
        }
        // Null = older client that doesn't know these toggles; leave stored values.
        if (request.getRequireEmailVerification() != null) {
            session.setRequireEmailVerification(request.getRequireEmailVerification());
        }
        if (request.getRequirePhoneVerification() != null) {
            session.setRequirePhoneVerification(request.getRequirePhoneVerification());
        }
        if (request.getWhatsappOtpTemplateName() != null) {
            session.setWhatsappOtpTemplateName(
                    request.getWhatsappOtpTemplateName().isBlank()
                            ? null
                            : request.getWhatsappOtpTemplateName().trim());
        }
    }

    private void processNotificationActions(LiveSessionStep2RequestDTO request, String sessionId, boolean isEdit) {
        // Fetch all schedules for the session
        List<SessionSchedule> schedules = scheduleRepository.findBySessionId(sessionId);

        // Add
        if (request.getAddedNotificationActions() != null && schedules != null) {
            System.out.println("DEBUG: Found " + schedules.size() + " schedules for session " + sessionId);
            for (LiveSessionStep2RequestDTO.NotificationActionDTO dto : request.getAddedNotificationActions()) {
                // Handle ON_CREATE notification immediately
                if (dto.getType() == NotificationTypeEnum.ON_CREATE && dto.getNotify()) {
                    liveSessionNotificationProcessor.sendOnCreateNotification(sessionId, schedules);
                    continue;
                }
                // Handle ON_EDIT notification immediately — only fire on edit, never on first publish
                if (dto.getType() == NotificationTypeEnum.ON_EDIT && dto.getNotify()) {
                    if (isEdit) {
                        liveSessionNotificationProcessor.sendOnEditNotification(sessionId, schedules,
                                request.getOldMeetingDate(), request.getOldStartTime());
                    }
                    continue;
                }
                // Handle ATTENDANCE — event-driven, not time-based
                if (dto.getType() == NotificationTypeEnum.ATTENDANCE) {
                    saveAttendanceNotificationConfig(sessionId, dto);
                    continue;
                }
                for (SessionSchedule schedule : schedules) {
                    ScheduleNotification notification = mapToNotificationEntity(dto, sessionId);
                    notification.setTriggerTime(computeTriggerTime(dto, schedule));
                    notification.setScheduleId(schedule.getId());
                    scheduleNotificationRepository.save(notification);
                }
            }
        }

        // Update only metadata; do not change schedule linkage here
        if (request.getUpdatedNotificationActions() != null) {
            for (LiveSessionStep2RequestDTO.NotificationActionDTO dto : request.getUpdatedNotificationActions()) {
                ScheduleNotification existing = scheduleNotificationRepository.findById(dto.getId())
                        .orElseThrow(() -> new RuntimeException("Notification not found: " + dto.getId()));
                updateNotificationEntity(existing, dto);
                // recompute triggerTime requires schedule context; skip here to avoid mismatch
                scheduleNotificationRepository.save(existing);
            }
        }

        // Delete
        if (request.getDeletedNotificationActionIds() != null) {
            for (String id : request.getDeletedNotificationActionIds()) {
                scheduleNotificationRepository.deleteById(id);
            }
        }
    }

    private ScheduleNotification mapToNotificationEntity(LiveSessionStep2RequestDTO.NotificationActionDTO dto,
                                                         String sessionId) {
        int offset = dto.getType() == NotificationTypeEnum.BEFORE_LIVE
                ? extractMinutes(dto.getTime())
                : 0;

        return ScheduleNotification.builder()
                .id(UUID.randomUUID().toString())
                .sessionId(sessionId)
                .type(dto.getType().name())
                .status(dto.getNotify() ? NotificationStatusEnum.PENDING.name()
                        : NotificationStatusEnum.DISABLED.name())
                .channel(resolveChannel(dto.getNotifyBy()))
                .offsetMinutes(offset)
                .triggerTime(null)
                .build();
    }

    private java.time.LocalDateTime computeTriggerTime(LiveSessionStep2RequestDTO.NotificationActionDTO dto, SessionSchedule schedule) {
        // Get the session to access timezone
        LiveSession session = sessionRepository.findById(schedule.getSessionId())
                .orElseThrow(() -> new RuntimeException("Session not found: " + schedule.getSessionId()));

        // Use session timezone, fallback to system default if not set
        java.time.ZoneId sessionZone = session.getTimezone() != null
                ? java.time.ZoneId.of(session.getTimezone())
                : java.time.ZoneId.systemDefault();

        // schedule.meetingDate's runtime type can be either java.sql.Date
        // (when the entity is freshly persisted in the same transaction —
        // bulk creation reads it back from the L1 cache) or java.util.Date /
        // java.sql.Timestamp (when JPA loaded it from a DB column in a
        // separate request — single-class flow). java.sql.Date.toInstant()
        // throws UnsupportedOperationException with a null message, so we
        // route around it explicitly.
        java.util.Date md = schedule.getMeetingDate();
        java.time.LocalDate meetingLocalDate = (md instanceof java.sql.Date)
                ? ((java.sql.Date) md).toLocalDate()
                : md.toInstant().atZone(sessionZone).toLocalDate();
        java.time.LocalTime startLocalTime = schedule.getStartTime().toLocalTime();
        java.time.LocalTime lastEntryLocalTime = schedule.getLastEntryTime() != null ? schedule.getLastEntryTime().toLocalTime() : null;

        java.time.LocalDateTime startDateTime = java.time.LocalDateTime.of(meetingLocalDate, startLocalTime);
        java.time.LocalDateTime triggerTime;
        
        if (dto.getType() == NotificationTypeEnum.BEFORE_LIVE) {
            int minutes = extractMinutes(dto.getTime());
            triggerTime = startDateTime.minusMinutes(minutes);
        } else if (dto.getType() == NotificationTypeEnum.ON_LIVE) {
            triggerTime = startDateTime;
        } else if (dto.getType() == NotificationTypeEnum.POST) {
            if (lastEntryLocalTime != null) {
                triggerTime = java.time.LocalDateTime.of(meetingLocalDate, lastEntryLocalTime);
            } else {
                triggerTime = startDateTime; // fallback
            }
        } else if (dto.getType() == NotificationTypeEnum.ON_CREATE) {
            triggerTime = java.time.LocalDateTime.now(sessionZone);
        } else {
            return null;
        }
        
        // Convert from session timezone to UTC before storing
        return triggerTime.atZone(sessionZone).withZoneSameInstant(java.time.ZoneId.of("UTC")).toLocalDateTime();
    }

    private void updateNotificationEntity(ScheduleNotification notification,
                                          LiveSessionStep2RequestDTO.NotificationActionDTO dto) {
        notification.setType(dto.getType().name());
        notification.setChannel(resolveChannel(dto.getNotifyBy()));
        notification.setStatus(
                dto.getNotify() ? NotificationStatusEnum.PENDING.name() : NotificationStatusEnum.DISABLED.name());
        notification.setOffsetMinutes(dto.getType() == NotificationTypeEnum.BEFORE_LIVE
                ? extractMinutes(dto.getTime())
                : 0);
    }

    private String resolveChannel(LiveSessionStep2RequestDTO.NotifyBy notifyBy) {
        if (notifyBy == null) {
            return "EMAIL";
        }
        List<String> channels = new ArrayList<>();
        if (notifyBy.isMail()) channels.add("EMAIL");
        if (notifyBy.isWhatsapp()) channels.add("WHATSAPP");
        if (notifyBy.isPushNotification()) channels.add("PUSH_NOTIFICATION");
        if (notifyBy.isSystemNotification()) channels.add("SYSTEM_NOTIFICATION");
        return channels.isEmpty() ? "EMAIL" : String.join(",", channels);
    }

    private void saveAttendanceNotificationConfig(String sessionId, LiveSessionStep2RequestDTO.NotificationActionDTO dto) {
        String channels = resolveChannel(dto.getNotifyBy());
        // Upsert: update if exists, create if not
        LiveSessionNotificationConfig config = notificationConfigRepository
                .findBySessionIdAndNotificationType(sessionId, NotificationTypeEnum.ATTENDANCE.name())
                .orElse(LiveSessionNotificationConfig.builder()
                        .id(UUID.randomUUID().toString())
                        .sessionId(sessionId)
                        .notificationType(NotificationTypeEnum.ATTENDANCE.name())
                        .build());
        config.setChannels(channels);
        config.setEnabled(dto.getNotify());
        notificationConfigRepository.save(config);
    }

    private void linkParticipants(LiveSessionStep2RequestDTO request) {
        // Handle batch participants (existing functionality)
        if (request.getPackageSessionIds() != null) {
            for (String packageSessionId : request.getPackageSessionIds()) {
                // Check if participant already exists to prevent duplicates
                if (!liveSessionParticipantRepository.existsBySessionIdAndSourceTypeAndSourceId(
                        request.getSessionId(), 
                        LiveSessionParticipantsEnum.BATCH.name(), 
                        packageSessionId)) {
                    
                    LiveSessionParticipants participant = LiveSessionParticipants.builder()
                            .sessionId(request.getSessionId())
                            .sourceType(LiveSessionParticipantsEnum.BATCH.name())
                            .sourceId(packageSessionId)
                            .build();
                    liveSessionParticipantRepository.save(participant);
                }
            }
        }

        if (request.getDeletedPackageSessionIds() != null) {
            for (String deletedId : request.getDeletedPackageSessionIds()) {
                liveSessionParticipantRepository.deleteBySessionIdAndSourceId(
                        request.getSessionId(), deletedId);
            }
        }

        // Handle individual user participants (new functionality)
        if (request.getIndividualUserIds() != null) {
            for (String userId : request.getIndividualUserIds()) {
                // Check if participant already exists to prevent duplicates
                if (!liveSessionParticipantRepository.existsBySessionIdAndSourceTypeAndSourceId(
                        request.getSessionId(), 
                        LiveSessionParticipantsEnum.USER.name(), 
                        userId)) {
                    
                    LiveSessionParticipants participant = LiveSessionParticipants.builder()
                            .sessionId(request.getSessionId())
                            .sourceType(LiveSessionParticipantsEnum.USER.name())
                            .sourceId(userId)
                            .build();
                    liveSessionParticipantRepository.save(participant);
                }
            }
        }

        if (request.getDeletedIndividualUserIds() != null) {
            for (String deletedUserId : request.getDeletedIndividualUserIds()) {
                liveSessionParticipantRepository.deleteBySessionIdAndSourceId(
                        request.getSessionId(), deletedUserId);
            }
        }
    }

    private void processCustomFields(LiveSessionStep2RequestDTO request, LiveSession session) {
        // Preferred path (custom fields revamp): the frontend sends the FULL set
        // of custom fields the admin selected for this session as a single
        // `instituteCustomFields` array. Defer to the unified per-feature sync
        // which handles insert / reactivate / soft-delete in one call.
        if (request.getInstituteCustomFields() != null) {
            instituteCustomFiledService.syncFeatureCustomFields(
                    session.getInstituteId(),
                    CustomFieldTypeEnum.SESSION.name(),
                    session.getId(),
                    request.getInstituteCustomFields());
            return;
        }

        // Legacy path — kept for backward compatibility with older frontend
        // builds that still send addedFields / updatedFields / deletedFieldIds.
        // These have several known correctness bugs (no institute_id on the
        // mapping, hard-deletes that orphan answers, no reactivation). New
        // clients must use `instituteCustomFields` above.
        int index = 0;

        if (request.getAddedFields() != null) {
            for (LiveSessionStep2RequestDTO.CustomFieldDTO dto : request.getAddedFields()) {
                saveNewCustomField(dto, request.getSessionId(), session.getInstituteId(), index++);
            }
        }

        if (request.getUpdatedFields() != null) {
            for (LiveSessionStep2RequestDTO.CustomFieldDTO dto : request.getUpdatedFields()) {
                CustomFields existing = customFieldRepository.findById(dto.getId())
                        .orElseThrow(() -> new RuntimeException("Custom field not found: " + dto.getId()));

                existing.setFieldName(dto.getLabel());
                existing.setFieldKey(dto.getLabel().toLowerCase().replaceAll("\\s+", "_"));
                existing.setFieldType(dto.getType());
                existing.setIsMandatory(dto.isRequired());
                existing.setIsHidden(false);
                // Reordering an existing field arrives through this path, so ignoring the
                // order here made drag-and-drop a silent no-op on the learner form. Leave
                // the stored order alone when the client omits it.
                if (dto.getFormOrder() != null) {
                    existing.setFormOrder(dto.getFormOrder());
                }

                if (dto.getOptions() != null && !dto.getOptions().isEmpty()) {
                    existing.setConfig(mergeOptionsIntoConfig(existing.getConfig(), dto.getOptions()));
                }

                customFieldRepository.save(existing);
            }
        }

        if (request.getDeletedFieldIds() != null) {
            for (String id : request.getDeletedFieldIds()) {
                customFieldRepository.deleteById(id);
                instituteCustomFieldRepository.deleteByCustomFieldId(id);
            }
        }
    }

    /**
     * Writes the field's options without discarding the rest of its config. Configs come in two
     * shapes: a bare options array, and an object that holds options alongside other settings
     * ({@code maxLength}, default values, ...). Overwriting wholesale would drop those siblings,
     * so an object config keeps its other keys and only has "options" replaced. The stored shape
     * is never changed — readers already handle whichever one the field had.
     */
    private String mergeOptionsIntoConfig(String existingConfig,
            List<LiveSessionStep2RequestDTO.FieldOptionDTO> options) {
        try {
            if (StringUtils.hasText(existingConfig)) {
                JsonNode parsed = objectMapper.readTree(existingConfig);
                if (parsed.isObject()) {
                    ObjectNode merged = (ObjectNode) parsed;
                    merged.set("options", objectMapper.valueToTree(options));
                    // The legacy key would otherwise keep shadowing the freshly saved options.
                    merged.remove("coommaSepartedOptions");
                    return objectMapper.writeValueAsString(merged);
                }
            }
            return objectMapper.writeValueAsString(options);
        } catch (JsonProcessingException e) {
            throw new VacademyException(HttpStatus.BAD_REQUEST, "Failed to convert field options to JSON");
        }
    }

    private void saveNewCustomField(LiveSessionStep2RequestDTO.CustomFieldDTO dto, String sessionId, String instituteId, int index) {
        String fieldKey = customFieldKeyGenerator.generateFieldKey(dto.getLabel(), instituteId);
        String configJson = "{}";
        try {
            if (dto.getOptions() != null && !dto.getOptions().isEmpty()) {
                configJson = objectMapper.writeValueAsString(dto.getOptions());
            }
        } catch (JsonProcessingException e) {
            throw new VacademyException(HttpStatus.BAD_REQUEST, "Failed to convert field options to JSON");
        }

        CustomFields field = CustomFields.builder()
                .id(UUID.randomUUID().toString())
                .fieldKey(fieldKey)
                .fieldName(dto.getLabel())
                .fieldType(dto.getType())
                .defaultValue(null)
                .config(configJson)
                // The client's position wins: `index` only counts newly added fields, so on
                // its own it restarts at 0 and collides with the fields already stored.
                .formOrder(dto.getFormOrder() != null ? dto.getFormOrder() : index)
                .isMandatory(dto.isRequired())
                .isFilter(false)
                .isSortable(false)
                .isHidden(false)
                .build();

        CustomFields savedField = customFieldRepository.save(field);

        InstituteCustomField mapping = InstituteCustomField.builder()
                .id(UUID.randomUUID().toString())
                .instituteId(instituteId)
                .customFieldId(savedField.getId())
                .type("SESSION")
                .typeId(sessionId)
                .build();

        instituteCustomFieldRepository.save(mapping);
    }

    /**
     * Serializes the optional "auto-add recordings to course" config onto the
     * session, same JSON-column pattern as bbb_config_json/feedback_config_json
     * in Step1Service. Omitting the field on the request leaves the stored
     * config untouched (partial Step2 updates must not silently disable it).
     */
    /**
     * Stamps the institute's current minimum-attendance rule onto the class as
     * it is created, so the class is judged by the rule in force when it was
     * scheduled. Turning the institute setting on or off afterwards therefore
     * affects later classes only, and never re-decides attendance for a class
     * already scheduled or already taught.
     *
     * <p>Read here rather than sent by the scheduling form on purpose: if the
     * settings request had not resolved when the form initialised, the form
     * would post "disabled" and the class would silently be created with no rule.
     *
     * <p>Skipped on edit, so re-saving a class never rewrites its rule. Failures
     * are swallowed — a class must still be created even if the setting cannot
     * be read; it simply keeps today's behaviour.
     */
    private void processAttendanceCriteria(LiveSession session, boolean isEdit) {
        if (isEdit) {
            return;
        }
        try {
            AttendanceCriteriaConfigDTO config =
                    attendanceCriteriaService.resolveInstituteDefault(session.getInstituteId());
            session.setAttendanceCriteriaJson(
                    config.isActive() ? objectMapper.writeValueAsString(config) : null);
        } catch (Exception e) {
            log.warn("attendance_criteria.stamp_failed sessionId={}: {}", session.getId(), e.getMessage());
        }
    }

    private void processRecordingAutoLinkConfig(LiveSessionStep2RequestDTO request, LiveSession session) {
        if (request.getRecordingAutoLinkConfig() == null) {
            return;
        }
        try {
            session.setRecordingAutoLinkJson(objectMapper.writeValueAsString(request.getRecordingAutoLinkConfig()));
        } catch (JsonProcessingException e) {
            throw new VacademyException(HttpStatus.BAD_REQUEST, "Failed to convert recording_auto_link_config to JSON");
        }
    }

    /**
     * Serializes the optional "save registrants to audience list(s)" config onto
     * the session, same JSON-column pattern as recording_auto_link_json. Omitting
     * the field on the request leaves the stored config untouched. Blank/duplicate
     * audience ids are dropped; ownership of each id is enforced at push time
     * (the push resolves audiences by id + institute).
     */
    private void processAudiencePushConfig(LiveSessionStep2RequestDTO request, LiveSession session) {
        vacademy.io.admin_core_service.features.live_session.dto.LiveSessionAudiencePushConfigDTO config =
                request.getAudiencePushConfig();
        if (config == null) {
            return;
        }
        if (config.getAudienceIds() != null) {
            config.setAudienceIds(config.getAudienceIds().stream()
                    .filter(id -> id != null && !id.isBlank())
                    .map(String::trim)
                    .distinct()
                    .toList());
        }
        try {
            session.setAudiencePushConfigJson(objectMapper.writeValueAsString(config));
        } catch (JsonProcessingException e) {
            throw new VacademyException(HttpStatus.BAD_REQUEST, "Failed to convert audience_push_config to JSON");
        }
    }

    private int extractMinutes(String time) {
        try {
            return Integer.parseInt(time.replaceAll("[^\\d]", ""));
        } catch (Exception e) {
            return 0;
        }
    }
}