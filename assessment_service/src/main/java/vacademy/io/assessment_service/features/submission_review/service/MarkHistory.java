package vacademy.io.assessment_service.features.submission_review.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import vacademy.io.assessment_service.features.assessment.entity.StudentAttempt;
import vacademy.io.assessment_service.features.submission_review.entity.MarkEvent;
import vacademy.io.assessment_service.features.submission_review.model.ActorType;
import vacademy.io.assessment_service.features.submission_review.model.MarkEventType;
import vacademy.io.assessment_service.features.submission_review.repository.MarkEventRepository;

import java.util.Collection;
import java.util.Date;
import java.util.List;
import java.util.Map;

/** Writes mark_event rows (spec 8.2). Append-only; nothing here ever updates a row. */
@Slf4j
@Component
public class MarkHistory {

    private static final ObjectMapper JSON = new ObjectMapper();

    private final MarkEventRepository repository;

    public MarkHistory(MarkEventRepository repository) {
        this.repository = repository;
    }

    /** The common fields of an event on this attempt. */
    public MarkEvent.MarkEventBuilder base(StudentAttempt attempt, MarkEventType type, ActorType actorType,
                                           String actorUserId, boolean afterRelease) {
        String instituteId = attempt.getRegistration() != null ? attempt.getRegistration().getInstituteId() : null;
        String assessmentId = attempt.getRegistration() != null && attempt.getRegistration().getAssessment() != null
                ? attempt.getRegistration().getAssessment().getId() : null;
        return MarkEvent.builder()
                .instituteId(instituteId == null ? "" : instituteId)
                .assessmentId(assessmentId == null ? "" : assessmentId)
                .attemptId(attempt.getId())
                .eventType(type.name())
                .actorType(actorType.name())
                .actorUserId(actorUserId)
                .afterRelease(afterRelease)
                .createdAt(new Date());
    }

    /** One submission-level event (no question). */
    public MarkEvent submissionEvent(StudentAttempt attempt, MarkEventType type, ActorType actorType,
                                     String actorUserId, boolean afterRelease, Map<String, ?> payload,
                                     String reason) {
        return save(base(attempt, type, actorType, actorUserId, afterRelease)
                .payloadJson(json(payload)).reason(reason).build());
    }

    public MarkEvent save(MarkEvent event) {
        if (event.getCreatedAt() == null) event.setCreatedAt(new Date());
        return repository.save(event);
    }

    public void saveAll(Collection<MarkEvent> events) {
        if (events == null || events.isEmpty()) return;
        // Distinct, increasing timestamps keep the order they were written in (base() stamps
        // each event when it is built, so events of one loop share a millisecond; History is
        // ordered by created_at and the ids are random UUIDs).
        long t = System.currentTimeMillis();
        for (MarkEvent e : events) {
            e.setCreatedAt(new Date(t++));
        }
        repository.saveAll(List.copyOf(events));
    }

    public static String json(Object payload) {
        if (payload == null) return null;
        try {
            return JSON.writeValueAsString(payload);
        } catch (Exception e) {
            log.warn("[submission-review] unserialisable event payload: {}", e.getMessage());
            return null;
        }
    }
}
