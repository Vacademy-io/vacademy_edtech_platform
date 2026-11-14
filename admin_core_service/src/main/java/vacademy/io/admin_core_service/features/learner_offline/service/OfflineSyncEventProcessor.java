package vacademy.io.admin_core_service.features.learner_offline.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.admin_core_service.features.learner_offline.dto.OfflineSyncEventRequestDTO;
import vacademy.io.admin_core_service.features.learner_offline.dto.OfflineSyncEventResultDTO;
import vacademy.io.admin_core_service.features.learner_offline.entity.OfflineSyncDiscrepancy;
import vacademy.io.admin_core_service.features.learner_offline.enums.OfflineSyncEventStatus;
import vacademy.io.admin_core_service.features.learner_offline.repository.OfflineSyncDiscrepancyRepository;
import vacademy.io.admin_core_service.features.learner_offline.repository.OfflineSyncEventRepository;
import vacademy.io.admin_core_service.features.learner_tracking.dto.ActivityLogDTO;
import vacademy.io.admin_core_service.features.learner_tracking.service.AssignmentSlideActivityLogService;
import vacademy.io.admin_core_service.features.learner_tracking.service.LearnerTrackingService;
import vacademy.io.admin_core_service.features.learner_tracking.service.QuestionSlideActivityLogService;
import vacademy.io.admin_core_service.features.learner_tracking.service.QuizSlideActivityLogService;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.sql.Timestamp;
import java.util.List;
import java.util.UUID;

/**
 * Per-event replay in its own REQUIRES_NEW transaction (offline plan, Part
 * A4 step 3). This is a SEPARATE bean (not a private method on
 * OfflineSyncService) on purpose: Spring's @Transactional only takes effect
 * on calls that go through the proxy, and OfflineSyncService.processBatch
 * needs to call this once per event from a plain Java loop -- a self-call
 * would silently run in the caller's transaction and defeat the whole
 * "one event's failure can't roll back another's ACCEPTED row" guarantee.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class OfflineSyncEventProcessor {

    private final OfflineSyncEventRepository offlineSyncEventRepository;
    private final OfflineSyncDiscrepancyRepository offlineSyncDiscrepancyRepository;
    private final OfflineQuizRescoringService offlineQuizRescoringService;
    private final OfflineDownloadStateService offlineDownloadStateService;
    private final LearnerTrackingService learnerTrackingService;
    private final QuestionSlideActivityLogService questionSlideActivityLogService;
    private final QuizSlideActivityLogService quizSlideActivityLogService;
    private final AssignmentSlideActivityLogService assignmentSlideActivityLogService;
    /**
     * Unknown properties must NOT fail an offline event.
     *
     * The online tracking controllers deserialize the very same payloads through Spring Boot's
     * auto-configured mapper, which disables FAIL_ON_UNKNOWN_PROPERTIES; a hand-rolled
     * {@code new ObjectMapper()} keeps Jackson's default (fail), so payloads the live endpoint
     * accepts were rejected here. That is how every queued QUESTION event died on the extra
     * {@code question_name} field the learner app sends — the answer was captured offline,
     * retried forever, and never landed.
     *
     * It also matters for version skew: a queued event can be days old, or written by a newer
     * app build than the server. Tolerating extra fields keeps an outdated payload syncable
     * instead of permanently stuck.
     */
    private final ObjectMapper objectMapper = new ObjectMapper()
            .configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public OfflineSyncEventResultDTO process(OfflineSyncEventRequestDTO event, String deviceId,
            CustomUserDetails user) {
        Timestamp clientTs = event.getClientTs() != null ? new Timestamp(event.getClientTs()) : null;
        int inserted = offlineSyncEventRepository.insertIfAbsent(event.getClientEventId(), deviceId,
                user.getUserId(), event.getSeq(), clientTs, event.getEventType(), event.getSlideId(),
                event.getPackageSessionId());

        if (inserted == 0) {
            // Row already existed. Only a previously-FAILED row is retried; an
            // already-ACCEPTED row means this clientEventId was already fully
            // dispatched, so re-dispatching would double-count the activity.
            String existingStatus = offlineSyncEventRepository.findByClientEventId(event.getClientEventId())
                    .map(vacademy.io.admin_core_service.features.learner_offline.entity.OfflineSyncEvent::getStatus)
                    .orElse(null);
            if (!"FAILED".equals(existingStatus)) {
                return OfflineSyncEventResultDTO.of(event.getClientEventId(), OfflineSyncEventStatus.DUPLICATE);
            }
        }

        try {
            dispatch(event, deviceId, user);
            if (inserted == 0) {
                offlineSyncEventRepository.markAccepted(event.getClientEventId());
            }
            return OfflineSyncEventResultDTO.of(event.getClientEventId(), OfflineSyncEventStatus.ACCEPTED);
        } catch (Exception e) {
            log.warn("offline-sync: dispatch failed for clientEventId={} eventType={}: {}",
                    event.getClientEventId(), event.getEventType(), e.getMessage());
            offlineSyncEventRepository.markFailed(event.getClientEventId(), errorCode(e));
            return new OfflineSyncEventResultDTO(event.getClientEventId(), OfflineSyncEventStatus.FAILED,
                    errorCode(e));
        }
    }

    private String errorCode(Exception e) {
        String msg = e.getClass().getSimpleName();
        return msg.length() > 64 ? msg.substring(0, 64) : msg;
    }

    private void dispatch(OfflineSyncEventRequestDTO event, String deviceId, CustomUserDetails user) {
        if ("DOWNLOAD_STATE".equals(event.getEventType())) {
            dispatchDownloadState(event, deviceId, user);
            return;
        }

        ActivityLogDTO dto = event.getPayload() == null ? new ActivityLogDTO()
                : objectMapper.convertValue(event.getPayload(), ActivityLogDTO.class);
        dto.setOfflineReplay(true);
        dto.setSuppressPositionOps(isStale(deviceId, event));

        String slideId = event.getSlideId();
        String chapterId = event.getChapterId();
        String moduleId = event.getModuleId();
        String subjectId = event.getSubjectId();
        String packageSessionId = event.getPackageSessionId();
        String userId = user.getUserId();

        switch (event.getEventType()) {
            case "DOCUMENT" -> learnerTrackingService.addOrUpdateDocumentActivityLog(dto, slideId, chapterId,
                    packageSessionId, moduleId, subjectId, user);
            case "VIDEO" -> learnerTrackingService.addOrUpdateVideoActivityLog(dto, slideId, chapterId, moduleId,
                    subjectId, packageSessionId, user);
            case "HTML_VIDEO" -> learnerTrackingService.addOrUpdateHtmlVideoActivityLog(dto, slideId, chapterId,
                    moduleId, subjectId, packageSessionId, user);
            case "AUDIO" -> learnerTrackingService.addOrUpdateAudioActivityLog(dto, slideId, chapterId, moduleId,
                    subjectId, packageSessionId, user);
            case "QUESTION" -> dispatchQuestion(event, dto, userId, user);
            case "QUIZ" -> dispatchQuiz(event, dto, userId, user);
            case "ASSIGNMENT" -> assignmentSlideActivityLogService.addOrUpdateAssignmentSlideSlideActivityLog(dto,
                    slideId, chapterId, moduleId, subjectId, packageSessionId, userId, user);
            default -> throw new IllegalArgumentException("Unknown offline event_type: " + event.getEventType());
        }
    }

    private boolean isStale(String deviceId, OfflineSyncEventRequestDTO event) {
        if (event.getSlideId() == null || event.getClientTs() == null) {
            return false;
        }
        if (!("VIDEO".equals(event.getEventType()) || "DOCUMENT".equals(event.getEventType())
                || "HTML_VIDEO".equals(event.getEventType()))) {
            return false;
        }
        Timestamp maxAccepted = offlineSyncEventRepository.findMaxAcceptedClientTs(deviceId, event.getSlideId());
        return maxAccepted != null && event.getClientTs() < maxAccepted.getTime();
    }

    private void dispatchQuestion(OfflineSyncEventRequestDTO event, ActivityLogDTO dto, String userId,
            CustomUserDetails user) {
        List<OfflineQuizRescoringService.OfflineDiscrepancyRecord> discrepancies = offlineQuizRescoringService
                .rescoreQuestion(event.getSlideId(), dto.getQuestionSlides());
        String activityId = questionSlideActivityLogService.addOrUpdateQuestionSlideActivityLog(dto,
                event.getSlideId(), event.getChapterId(), event.getPackageSessionId(), event.getModuleId(),
                event.getSubjectId(), userId, user);
        saveDiscrepancies(discrepancies, event, activityId, userId);
    }

    private void dispatchQuiz(OfflineSyncEventRequestDTO event, ActivityLogDTO dto, String userId,
            CustomUserDetails user) {
        // A device only ever queues an attempt with answers in it, so an empty one records nothing.
        if (dto.getQuizSides() == null || dto.getQuizSides().isEmpty()) {
            log.info("offline-sync: nothing recorded for empty quiz event {}", event.getClientEventId());
            return;
        }
        quizSlideActivityLogService.requireLegacySubmitAllowed(dto, event.getSlideId(), user, null);
        List<OfflineQuizRescoringService.OfflineDiscrepancyRecord> discrepancies = offlineQuizRescoringService
                .rescoreQuiz(dto.getQuizSides());
        String activityId = quizSlideActivityLogService.addOrUpdateQuizSlideActivityLog(dto, event.getSlideId(),
                event.getChapterId(), event.getModuleId(), event.getSubjectId(), event.getPackageSessionId(), userId,
                user);
        saveDiscrepancies(discrepancies, event, activityId, userId);
    }

    private void saveDiscrepancies(List<OfflineQuizRescoringService.OfflineDiscrepancyRecord> discrepancies,
            OfflineSyncEventRequestDTO event, String activityId, String userId) {
        for (OfflineQuizRescoringService.OfflineDiscrepancyRecord rec : discrepancies) {
            OfflineSyncDiscrepancy row = new OfflineSyncDiscrepancy();
            row.setId(UUID.randomUUID().toString());
            row.setClientEventId(event.getClientEventId());
            row.setActivityId(activityId);
            row.setUserId(userId);
            row.setSlideId(event.getSlideId());
            row.setPackageSessionId(event.getPackageSessionId());
            row.setQuestionId(rec.questionId());
            row.setField(rec.field());
            row.setClientValue(rec.clientValue());
            row.setServerValue(rec.serverValue());
            row.setStatus("OPEN");
            offlineSyncDiscrepancyRepository.save(row);
        }
    }

    private void dispatchDownloadState(OfflineSyncEventRequestDTO event, String deviceId, CustomUserDetails user) {
        JsonNode payload = event.getPayload();
        String status = payload != null && payload.has("status") ? payload.get("status").asText() : "DOWNLOADED";
        offlineDownloadStateService.upsert(deviceId, user.getUserId(), event.getPackageSessionId(),
                event.getSlideId(), status, event.getClientTs());
    }
}
