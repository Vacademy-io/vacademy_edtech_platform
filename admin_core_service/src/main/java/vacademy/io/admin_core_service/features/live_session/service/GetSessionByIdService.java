package vacademy.io.admin_core_service.features.live_session.service;

import jakarta.persistence.EntityNotFoundException;
import lombok.Data;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import vacademy.io.admin_core_service.features.common.repository.CustomFieldRepository;
import vacademy.io.admin_core_service.features.live_session.dto.GetSessionByIdResponseDTO;
import vacademy.io.admin_core_service.features.live_session.dto.GetSessionDetailsBySessionIdResponseDTO;
import vacademy.io.admin_core_service.features.live_session.dto.NotificationQueryDTO;
import vacademy.io.admin_core_service.features.live_session.dto.ScheduleDTO;
import vacademy.io.admin_core_service.features.live_session.entity.LiveSession;
import vacademy.io.admin_core_service.features.live_session.entity.LiveSessionParticipants;
import vacademy.io.admin_core_service.features.live_session.repository.*;
import vacademy.io.admin_core_service.features.packages.repository.PackageSessionRepository;

import java.time.Duration;
import java.time.LocalTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

@Service
@RequiredArgsConstructor
public class GetSessionByIdService {

    @Autowired
    private final SessionScheduleRepository scheduleRepository;

    @Autowired
    private final ScheduleNotificationRepository notificationRepository;

    @Autowired
    private final SessionGuestRegistrationRepository sessionGuestRegistrationRepository;
    @Autowired
    private final LiveSessionParticipantRepository liveSessionParticipantRepository;
    @Autowired
    private final CustomFieldRepository customFieldRepository;
    @Autowired
    private final LiveSessionRepository liveSessionRepository;
    @Autowired
    private final PackageSessionRepository packageSessionRepository;

    @Autowired
    private final LiveSessionPaymentService liveSessionPaymentService;

    @Autowired
    private final LiveSessionInstructorService instructorService;

    @Data
    public static class SessionDetailsResponse {
        private GetSessionByIdResponseDTO schedule;
        private GetSessionByIdResponseDTO.NotificationConfigResponse notifications;
        // Paid live sessions: current fee config so the admin edit wizard can prefill it.
        private vacademy.io.admin_core_service.features.live_session.dto.LiveSessionPaymentConfigDTO paymentConfig;
        // Public-registration OTP verification toggles, for edit-wizard prefill.
        private Boolean requireEmailVerification;
        private Boolean requirePhoneVerification;
        // WhatsApp template used for the phone-verification OTP (null = default).
        private String whatsappOtpTemplateName;
        // "Save registrants to audience list(s)" config, for edit-wizard prefill.
        private vacademy.io.admin_core_service.features.live_session.dto.LiveSessionAudiencePushConfigDTO audiencePushConfig;
        /**
         * Instructors / presenters, for edit-wizard prefill (V524). Falls back
         * to the creator for sessions scheduled before instructors existed, so
         * the picker is never empty on an old session.
         */
        private java.util.List<vacademy.io.admin_core_service.features.live_session.dto.LiveSessionInstructorDTO> instructors;
    }

    public SessionDetailsResponse getFullSessionDetails(String sessionId) {
        GetSessionByIdResponseDTO schedule = getScheduleDetails(sessionId);
        GetSessionByIdResponseDTO.NotificationConfigResponse notifications = getNotificationDetails(sessionId);

        SessionDetailsResponse response = new SessionDetailsResponse();
        response.setSchedule(schedule);
        response.setNotifications(notifications);
        liveSessionPaymentService.findActivePlan(sessionId).ifPresent(plan -> response.setPaymentConfig(
                vacademy.io.admin_core_service.features.live_session.dto.LiveSessionPaymentConfigDTO.builder()
                        .enabled(true)
                        .price(plan.getActualPrice())
                        .currency(plan.getCurrency())
                        .vendor(liveSessionPaymentService.getConfiguredVendor(sessionId).orElse(null))
                        .build()));
        liveSessionRepository.findById(sessionId).ifPresent(session -> {
            response.setInstructors(instructorService.getInstructorDetails(session));
            response.setRequireEmailVerification(session.getRequireEmailVerification());
            response.setRequirePhoneVerification(session.getRequirePhoneVerification());
            response.setWhatsappOtpTemplateName(session.getWhatsappOtpTemplateName());
            if (session.getAudiencePushConfigJson() != null && !session.getAudiencePushConfigJson().isBlank()) {
                try {
                    response.setAudiencePushConfig(new com.fasterxml.jackson.databind.ObjectMapper().readValue(
                            session.getAudiencePushConfigJson(),
                            vacademy.io.admin_core_service.features.live_session.dto.LiveSessionAudiencePushConfigDTO.class));
                } catch (Exception e) {
                    System.err.println("Error deserializing audiencePushConfigJson: " + e.getMessage());
                }
            }
        });
        return response;
    }

    public GetSessionByIdResponseDTO getScheduleDetails(String sessionId) {
        List<ScheduleDTO> schedules = scheduleRepository.findSchedulesBySessionId(sessionId);
        List<LiveSessionParticipants> participants = liveSessionParticipantRepository.findBySessionId(sessionId);

        List<GetSessionByIdResponseDTO.ScheduleItem> addedSchedules = new ArrayList<>();
        ScheduleDTO first = null;
        ScheduleDTO last = null;

        if (!schedules.isEmpty()) {
            first = schedules.get(0);
            last = schedules.get(schedules.size() - 1);

            for (ScheduleDTO schedule : schedules) {
                GetSessionByIdResponseDTO.ScheduleItem item = new GetSessionByIdResponseDTO.ScheduleItem();
                LocalTime startTime = schedule.getScheduleStartTime();
                LocalTime lastEntryTime = schedule.getScheduleLastEntryTime();

                long durationMinutes = Duration.between(startTime, lastEntryTime).toMinutes();

                item.setId(schedule.getScheduleId());
                item.setDay(schedule.getMeetingDate().getDayOfWeek().name().toLowerCase());
                item.setStartTime(schedule.getScheduleStartTime().toString());
                item.setDuration(String.valueOf(durationMinutes)); // or durationMinutes if preferred
                item.setLink(schedule.getCustomMeetingLink());
                item.setDefaultClassLink(schedule.getDefaultClassLink());
                item.setDefaultClassName(schedule.getDefaultClassName());
                item.setMeetingDate(schedule.getMeetingDate());
                item.setTimezone(schedule.getTimezone());
                item.setDailyAttendance(schedule.getDailyAttendance());
                item.setProviderRecordingsJson(schedule.getProviderRecordingsJson());
                item.setLinkType(schedule.getLinkType());
                item.setProviderHostUrl(schedule.getProviderHostUrl());
                addedSchedules.add(item);
            }
        }

        List<String> packageSessionIds = new ArrayList<>();
        for (LiveSessionParticipants participant : participants) {
            if ("BATCH".equals(participant.getSourceType())) {
                packageSessionIds.add(participant.getSourceId());
            }
        }

        GetSessionByIdResponseDTO dto = new GetSessionByIdResponseDTO();

        if (first != null) {
            dto.setSessionId(first.getSessionId());
            dto.setInstituteId(first.getInstituteId());
            dto.setTitle(first.getSessionTitle());
            dto.setSubject(first.getSubject());
            dto.setDescriptionHtml(first.getDescriptionHtml());
            dto.setDefaultMeetLink(first.getDefaultMeetLink());
            dto.setStartTime(first.getSessionStartTime());
            dto.setLastEntryTime(first.getLastEntryTime());
            dto.setDefaultClassLink(first.getDefaultClassLink());
            dto.setDefaultClassName(first.getDefaultClassName());
            dto.setDefaultClassLinkType(first.getDefaultClassLinkType());
            dto.setLinkType(first.getLinkType());

            dto.setLearnerButtonConfig(deserializeLearnerButtonConfig(first.getLearnerButtonConfig()));

            dto.setJoinLink(first.getRegistrationFormLinkForPublicSessions());
            dto.setRecurrenceType(first.getRecurrenceType());
            dto.setAccessType(first.getAccessLevel());
            dto.setWaitingRoomTime(first.getWaitingRoomTime() != null ? first.getWaitingRoomTime().toString() : null);
            dto.setWaitingRoomType(first.getWaitingRoomType());
            dto.setThumbnailFileId(first.getThumbnailFileId());
            dto.setBackgroundScoreFileId(first.getBackgroundScoreFileId());
            dto.setCoverFileId(first.getCoverFileId());
            dto.setAllowRewind(first.getAllowRewind());
            dto.setAllowPlayPause(first.getAllowPlayPause());
            dto.setSessionStreamingServiceType(first.getSessionStreamingServiceType());
            dto.setTimezone(first.getTimezone());
        }

        if (last != null) {
            dto.setSessionEndDate(last.getMeetingDate());
        }

        dto.setAddedSchedules(addedSchedules);
        dto.setPackageSessionIds(packageSessionIds);

        // Resolve package session details (package name, level name, session name)
        if (!packageSessionIds.isEmpty()) {
            List<PackageSessionRepository.PackageSessionDetailProjection> details =
                    packageSessionRepository.findPackageSessionDetailsByIds(packageSessionIds);
            List<GetSessionByIdResponseDTO.PackageSessionDetail> detailDTOs = new ArrayList<>();
            for (var d : details) {
                GetSessionByIdResponseDTO.PackageSessionDetail detail = new GetSessionByIdResponseDTO.PackageSessionDetail();
                detail.setPackageSessionId(d.getPackageSessionId());
                detail.setPackageName(d.getPackageName());
                detail.setLevelName(d.getLevelName());
                detail.setSessionName(d.getSessionName());
                detailDTOs.add(detail);
            }
            dto.setPackageSessionDetails(detailDTOs);
        }

        // Load BBB config from LiveSession entity if available
        if (first != null && first.getSessionId() != null) {
            liveSessionRepository.findById(first.getSessionId()).ifPresent(liveSession -> {
                dto.setShowToLearners(liveSession.getShowToLearners());
                if (liveSession.getBbbConfigJson() != null && !liveSession.getBbbConfigJson().isBlank()) {
                    try {
                        Map<String, Object> bbbCfg = new com.fasterxml.jackson.databind.ObjectMapper()
                                .readValue(liveSession.getBbbConfigJson(),
                                        new com.fasterxml.jackson.core.type.TypeReference<Map<String, Object>>() {
                                        });
                        dto.setBbbConfig(bbbCfg);
                    } catch (Exception e) {
                        System.err.println("Error deserializing bbbConfigJson: " + e.getMessage());
                    }
                }
                // Load feedback config
                if (liveSession.getFeedbackConfigJson() != null && !liveSession.getFeedbackConfigJson().isBlank()) {
                    try {
                        Object feedbackCfg = new com.fasterxml.jackson.databind.ObjectMapper()
                                .readValue(liveSession.getFeedbackConfigJson(), Object.class);
                        dto.setFeedbackConfig(feedbackCfg);
                    } catch (Exception e) {
                        System.err.println("Error deserializing feedbackConfigJson: " + e.getMessage());
                    }
                }
                // Load recording auto-link config (echoed back for edit-mode prefill)
                if (liveSession.getRecordingAutoLinkJson() != null && !liveSession.getRecordingAutoLinkJson().isBlank()) {
                    try {
                        vacademy.io.admin_core_service.features.live_session.dto.RecordingAutoLinkConfigDTO autoLinkCfg =
                                new com.fasterxml.jackson.databind.ObjectMapper().readValue(
                                        liveSession.getRecordingAutoLinkJson(),
                                        vacademy.io.admin_core_service.features.live_session.dto.RecordingAutoLinkConfigDTO.class);
                        dto.setRecordingAutoLinkConfig(autoLinkCfg);
                    } catch (Exception e) {
                        System.err.println("Error deserializing recordingAutoLinkJson: " + e.getMessage());
                    }
                }
            });
        }

        return dto;
    }

    public GetSessionByIdResponseDTO.NotificationConfigResponse getNotificationDetails(String sessionId) {

        List<NotificationQueryDTO> notifications = notificationRepository.findNotificationsBySessionId(sessionId);
        List<CustomFieldRepository.FlatFieldProjection> flatList = customFieldRepository
                .getSessionCustomFieldsBySessionId(sessionId);
        List<GetSessionByIdResponseDTO.NotificationAction> addedNotificationActions = new ArrayList<>();

        for (NotificationQueryDTO n : notifications) {
            GetSessionByIdResponseDTO.NotifyBy notifyBy = new GetSessionByIdResponseDTO.NotifyBy();
            notifyBy.setMail("EMAIL".equalsIgnoreCase(n.getChannel()) || "BOTH".equalsIgnoreCase(n.getChannel()));
            notifyBy.setWhatsapp(
                    "WHATSAPP".equalsIgnoreCase(n.getChannel()) || "BOTH".equalsIgnoreCase(n.getChannel()));

            GetSessionByIdResponseDTO.NotificationAction action = new GetSessionByIdResponseDTO.NotificationAction();
            action.setId(n.getNotificationId());
            action.setType(n.getType());
            action.setNotify(true);
            action.setTime(n.getTriggerTime());
            action.setNotifyBy(notifyBy);

            addedNotificationActions.add(action);
        }

        List<GetSessionByIdResponseDTO.Field> fields = new ArrayList<>();

        for (CustomFieldRepository.FlatFieldProjection item : flatList) {
            GetSessionByIdResponseDTO.Field field = new GetSessionByIdResponseDTO.Field();
            field.setId(item.getCustomFieldId());
            field.setLabel(item.getFieldName());
            field.setRequired(item.getIsMandatory());
            field.setType(item.getFieldType());
            field.setFormOrder(item.getFormOrder());
            field.setConfig(item.getConfig());
            fields.add(field);
        }

        GetSessionByIdResponseDTO.NotificationConfigResponse config = new GetSessionByIdResponseDTO.NotificationConfigResponse();
        config.setAddedNotificationActions(addedNotificationActions);
        config.setAddedFields(fields);

        return config;
    }

    public GetSessionDetailsBySessionIdResponseDTO getSessionByScheduleId(String scheduleId) {
        return scheduleRepository.findScheduleDetailsById(scheduleId)
                .map(p -> GetSessionDetailsBySessionIdResponseDTO.builder()
                        .sessionId(p.getSessionId())
                        .scheduleId(p.getScheduleId())
                        .instituteId(p.getInstituteId())
                        .sessionStartTime(p.getSessionStartTime())
                        .lastEntryTime(p.getLastEntryTime())
                        .accessLevel(p.getAccessLevel())
                        .meetingType(p.getMeetingType())
                        .linkType(p.getLinkType())
                        .sessionStreamingServiceType(p.getSessionStreamingServiceType())
                        .defaultMeetLink(p.getDefaultMeetLink())
                        .defaultClassLink(p.getDefaultClassLink())
                        .defaultClassLinkType(p.getDefaultClassLinkType())
                        .learnerButtonConfig(deserializeLearnerButtonConfig(p.getLearnerButtonConfig()))
                        .waitingRoomLink(p.getWaitingRoomLink())
                        .waitingRoomTime(p.getWaitingRoomTime())
                        .registrationFormLinkForPublicSessions(p.getRegistrationFormLinkForPublicSessions())
                        .createdByUserId(p.getCreatedByUserId())
                        .title(p.getTitle())
                        .descriptionHtml(p.getDescriptionHtml())
                        .notificationEmailMessage(p.getNotificationEmailMessage())
                        .attendanceEmailMessage(p.getAttendanceEmailMessage())
                        .coverFileId(p.getCoverFileId())
                        .subject(p.getSubject())
                        .thumbnailFileId(p.getThumbnailFileId()) // session-level
                        .scheduleThumbnailFileId(p.getScheduleThumbnailFileId()) // schedule-level
                        .allowPlayPause(p.getAllowPlayPause()) // session-level
                        .backgroundScoreFileId(p.getBackgroundScoreFileId())
                        .status(p.getStatus())
                        .recurrenceType(p.getRecurrenceType())
                        .recurrenceKey(p.getRecurrenceKey())
                        .meetingDate(p.getMeetingDate())
                        .scheduleStartTime(p.getScheduleStartTime())
                        .scheduleLastEntryTime(p.getScheduleLastEntryTime())
                        .customMeetingLink(p.getCustomMeetingLink())
                        .customWaitingRoomMediaId(p.getCustomWaitingRoomMediaId())
                        .allowRewind(p.getAllowRewind())
                        .timezone(p.getTimezone())
                        .providerHostUrl(p.getProviderHostUrl())
                        .providerMeetingId(p.getProviderMeetingId())
                        .build())
                .orElseThrow(() -> new EntityNotFoundException("Schedule not found"));
    }

    public GetSessionDetailsBySessionIdResponseDTO getSessionByScheduleIdForGuestUser(String scheduleId) {

        return scheduleRepository.findScheduleDetailsById(scheduleId)
                .map(p -> GetSessionDetailsBySessionIdResponseDTO.builder()
                        .sessionId(p.getSessionId())
                        .scheduleId(p.getScheduleId())
                        .instituteId(p.getInstituteId())
                        .sessionStartTime(p.getSessionStartTime())
                        .lastEntryTime(p.getLastEntryTime())
                        .accessLevel(p.getAccessLevel())
                        .meetingType(p.getMeetingType())
                        .linkType(p.getLinkType())
                        .sessionStreamingServiceType(p.getSessionStreamingServiceType())
                        .defaultMeetLink(p.getDefaultMeetLink())
                        .defaultClassLink(p.getDefaultClassLink())
                        .defaultClassLinkType(p.getDefaultClassLinkType())
                        .learnerButtonConfig(deserializeLearnerButtonConfig(p.getLearnerButtonConfig()))
                        .waitingRoomLink(p.getWaitingRoomLink())
                        .waitingRoomTime(p.getWaitingRoomTime())
                        .registrationFormLinkForPublicSessions(p.getRegistrationFormLinkForPublicSessions())
                        .createdByUserId(p.getCreatedByUserId())
                        .title(p.getTitle())
                        .descriptionHtml(p.getDescriptionHtml())
                        .notificationEmailMessage(p.getNotificationEmailMessage())
                        .attendanceEmailMessage(p.getAttendanceEmailMessage())
                        .coverFileId(p.getCoverFileId())
                        .subject(p.getSubject())
                        .thumbnailFileId(p.getThumbnailFileId()) // session-level
                        .scheduleThumbnailFileId(p.getScheduleThumbnailFileId()) // schedule-level
                        .allowPlayPause(p.getAllowPlayPause()) // session-level
                        .backgroundScoreFileId(p.getBackgroundScoreFileId())
                        .status(p.getStatus())
                        .recurrenceType(p.getRecurrenceType())
                        .recurrenceKey(p.getRecurrenceKey())
                        .meetingDate(p.getMeetingDate())
                        .scheduleStartTime(p.getScheduleStartTime())
                        .scheduleLastEntryTime(p.getScheduleLastEntryTime())
                        .customMeetingLink(p.getCustomMeetingLink())
                        .customWaitingRoomMediaId(p.getCustomWaitingRoomMediaId())
                        .allowRewind(p.getAllowRewind())
                        .timezone(p.getTimezone())
                        .providerHostUrl(p.getProviderHostUrl())
                        .providerMeetingId(p.getProviderMeetingId())
                        .build())
                .orElseThrow(() -> new EntityNotFoundException("Schedule not found"));
    }

    public String findEarliestSchedule(String sessionId) {
        return scheduleRepository.findEarliestScheduleIdBySessionId(sessionId);
    }

    /**
     * Untyped on purpose — the column holds either a single button object or a
     * list of them, and binding to the single-object DTO dropped every
     * multi-button session's config.
     */
    private Object deserializeLearnerButtonConfig(String json) {
        if (json == null || json.isBlank())
            return null;
        try {
            return new com.fasterxml.jackson.databind.ObjectMapper().readValue(json, Object.class);
        } catch (Exception e) {
            System.err.println("Error deserializing LearnerButtonConfig: " + e.getMessage());
            return null;
        }
    }
}
