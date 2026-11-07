package vacademy.io.assessment_service.features.proctoring.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.assessment_service.core.exception.VacademyException;
import vacademy.io.assessment_service.features.assessment.entity.Assessment;
import vacademy.io.assessment_service.features.assessment.entity.StudentAttempt;
import vacademy.io.assessment_service.features.learner_assessment.enums.AssessmentAttemptEnum;
import vacademy.io.assessment_service.features.assessment.repository.AssessmentRepository;
import vacademy.io.assessment_service.features.assessment.repository.StudentAttemptRepository;
import vacademy.io.assessment_service.features.proctoring.dto.AttemptProctorReviewDTO;
import vacademy.io.assessment_service.features.proctoring.dto.AttemptProctorSummaryDTO;
import vacademy.io.assessment_service.features.proctoring.dto.ProctorEventBatchRequest;
import vacademy.io.assessment_service.features.proctoring.dto.ProctorEventBatchResponse;
import vacademy.io.assessment_service.features.proctoring.dto.ProctorEventDTO;
import vacademy.io.assessment_service.features.proctoring.dto.ProctoringConfigDTO;
import vacademy.io.assessment_service.features.proctoring.entity.AttemptProctorEvent;
import vacademy.io.assessment_service.features.proctoring.enums.ProctorEventSeverity;
import vacademy.io.assessment_service.features.proctoring.repository.AttemptProctorEventRepository;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.ForbiddenException;

import java.util.ArrayList;
import java.util.Collection;
import java.util.Date;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

@Slf4j
@Service
public class ProctorEventService {

    /** One auto-save tick of a busy client is a handful of events; anything bigger is a bug or abuse. */
    static final int MAX_BATCH = 50;
    /** Per attempt. A 3-hour exam at a 30 s snapshot cadence is ~360 rows; this leaves room for flags. */
    static final int MAX_EVENTS_PER_ATTEMPT = 5000;
    static final int MAX_META_CHARS = 2000;

    private final AttemptProctorEventRepository eventRepository;
    private final StudentAttemptRepository studentAttemptRepository;
    private final AssessmentRepository assessmentRepository;
    private final ProctoringConfigService configService;
    private final ObjectMapper objectMapper = new ObjectMapper();

    public ProctorEventService(AttemptProctorEventRepository eventRepository,
                               StudentAttemptRepository studentAttemptRepository,
                               AssessmentRepository assessmentRepository,
                               ProctoringConfigService configService) {
        this.eventRepository = eventRepository;
        this.studentAttemptRepository = studentAttemptRepository;
        this.assessmentRepository = assessmentRepository;
        this.configService = configService;
    }

    // ---------------------------------------------------------------- learner

    public ProctoringConfigDTO configForLearner(String assessmentId) {
        return assessmentRepository.findById(assessmentId)
                .map(configService::effectiveConfig)
                .orElse(ProctoringConfigDTO.off());
    }

    /**
     * Store a batch from the learner's device. Only the attempt's owner may write
     * to it, only while it is open, and only if the assessment is actually
     * proctored -- a client cannot make an unproctored exam grow an evidence log.
     */
    @Transactional
    public ProctorEventBatchResponse record(CustomUserDetails user, String attemptId, ProctorEventBatchRequest request) {
        StudentAttempt attempt = studentAttemptRepository.findByIdWithRegistration(attemptId)
                .orElseThrow(() -> new VacademyException("Attempt not found"));
        String ownerId = attempt.getRegistration() == null ? null : attempt.getRegistration().getUserId();
        if (user == null || ownerId == null || !ownerId.equals(user.getUserId())) {
            throw new ForbiddenException("Not allowed to access this attempt");
        }
        if (AssessmentAttemptEnum.ENDED.name().equals(attempt.getStatus())) {
            // Late flushes after submit are normal (the client drains its queue on the
            // way out). Accept nothing, fail nothing.
            return new ProctorEventBatchResponse(0, eventRepository.countByAttemptIdAndSeverity(attemptId, ProctorEventSeverity.FLAG.name()));
        }
        Assessment assessment = attempt.getRegistration().getAssessment();
        ProctoringConfigDTO config = configService.effectiveConfig(assessment);
        if (!config.isEnabled()) {
            return new ProctorEventBatchResponse(0, 0);
        }

        List<ProctorEventDTO> incoming = request == null || request.getEvents() == null ? List.of() : request.getEvents();
        if (incoming.size() > MAX_BATCH) {
            incoming = incoming.subList(0, MAX_BATCH);
        }
        long existing = eventRepository.countByAttemptId(attemptId);
        List<AttemptProctorEvent> rows = new ArrayList<>();
        Date now = new Date();
        for (ProctorEventDTO dto : incoming) {
            if (existing + rows.size() >= MAX_EVENTS_PER_ATTEMPT) break;
            if (dto == null || dto.getEventType() == null || dto.getEventType().isBlank()) continue;
            String eventType = dto.getEventType().trim().toUpperCase();
            String evidence = dto.getEvidenceFileId();
            // Column widths; an oversized value is a bug or abuse, not worth a 500 for the whole batch.
            if (eventType.length() > 50) continue;
            if (evidence != null && (evidence.isBlank() || evidence.length() > 255)) evidence = null;
            rows.add(AttemptProctorEvent.builder()
                    .attemptId(attemptId)
                    .assessmentId(assessment.getId())
                    .userId(ownerId)
                    .eventType(eventType)
                    .severity(ProctorEventSeverity.fromString(dto.getSeverity()).name())
                    // A client clock that is wildly off must not put events in the future.
                    .occurredAt(dto.getOccurredAt() == null || dto.getOccurredAt().after(now) ? now : dto.getOccurredAt())
                    .evidenceFileId(evidence)
                    .meta(serializeMeta(dto.getMeta()))
                    .build());
        }
        if (!rows.isEmpty()) {
            eventRepository.saveAll(rows);
        }
        long flags = eventRepository.countByAttemptIdAndSeverity(attemptId, ProctorEventSeverity.FLAG.name());
        return new ProctorEventBatchResponse(rows.size(), flags);
    }

    // ----------------------------------------------------------------- admin

    /** Timeline for one attempt. Scoped to the caller's institute through the assessment. */
    public AttemptProctorReviewDTO review(String attemptId, String instituteId) {
        StudentAttempt attempt = studentAttemptRepository.findByIdWithRegistration(attemptId)
                .orElseThrow(() -> new VacademyException("Attempt not found"));
        Assessment assessment = attempt.getRegistration() == null ? null : attempt.getRegistration().getAssessment();
        if (assessment == null) throw new VacademyException("Attempt has no assessment");
        Optional<Assessment> scoped = assessmentRepository.findByAssessmentIdAndInstituteId(assessment.getId(), instituteId);
        if (scoped.isEmpty()) throw new ForbiddenException("Not allowed to access this attempt");

        List<AttemptProctorEvent> rows = eventRepository.findByAttemptIdOrderByOccurredAtAsc(attemptId);
        long flags = 0, warns = 0, snapshots = 0;
        Map<String, Long> byType = new LinkedHashMap<>();
        List<ProctorEventDTO> events = new ArrayList<>(rows.size());
        for (AttemptProctorEvent row : rows) {
            if (ProctorEventSeverity.FLAG.name().equals(row.getSeverity())) flags++;
            else if (ProctorEventSeverity.WARN.name().equals(row.getSeverity())) warns++;
            if ("SNAPSHOT".equals(row.getEventType())) snapshots++;
            byType.merge(row.getEventType(), 1L, Long::sum);
            events.add(toDto(row));
        }
        return AttemptProctorReviewDTO.builder()
                .attemptId(attemptId)
                .config(configService.effectiveConfig(assessment))
                .flagCount(flags)
                .warnCount(warns)
                .snapshotCount(snapshots)
                .countsByType(byType)
                .events(events)
                .build();
    }

    /** Flag/warn counts for a page of attempts. Attempts with no events are omitted. */
    public List<AttemptProctorSummaryDTO> summaries(String assessmentId, String instituteId, Collection<String> attemptIds) {
        if (assessmentRepository.findByAssessmentIdAndInstituteId(assessmentId, instituteId).isEmpty()) {
            throw new ForbiddenException("Not allowed to access this assessment");
        }
        if (attemptIds == null || attemptIds.isEmpty()) return List.of();
        Map<String, AttemptProctorSummaryDTO> out = new HashMap<>();
        for (Object[] row : eventRepository.countBySeverityForAttempts(attemptIds)) {
            String attemptId = (String) row[0];
            String severity = (String) row[1];
            long count = ((Number) row[2]).longValue();
            AttemptProctorSummaryDTO s = out.computeIfAbsent(attemptId, id -> new AttemptProctorSummaryDTO(id, 0, 0));
            if (ProctorEventSeverity.FLAG.name().equals(severity)) s.setFlagCount(count);
            else s.setWarnCount(count);
        }
        return new ArrayList<>(out.values());
    }

    // --------------------------------------------------------------- helpers

    private String serializeMeta(Map<String, Object> meta) {
        if (meta == null || meta.isEmpty()) return null;
        try {
            String json = objectMapper.writeValueAsString(meta);
            return json.length() > MAX_META_CHARS ? null : json;
        } catch (Exception e) {
            return null;
        }
    }

    @SuppressWarnings("unchecked")
    private ProctorEventDTO toDto(AttemptProctorEvent row) {
        Map<String, Object> meta = null;
        if (row.getMeta() != null) {
            try {
                meta = objectMapper.readValue(row.getMeta(), Map.class);
            } catch (Exception ignored) {
                // Unreadable meta is not worth failing a review page over.
            }
        }
        return ProctorEventDTO.builder()
                .id(row.getId())
                .eventType(row.getEventType())
                .severity(row.getSeverity())
                .occurredAt(row.getOccurredAt())
                .receivedAt(row.getReceivedAt())
                .evidenceFileId(row.getEvidenceFileId())
                .meta(meta)
                .build();
    }
}
