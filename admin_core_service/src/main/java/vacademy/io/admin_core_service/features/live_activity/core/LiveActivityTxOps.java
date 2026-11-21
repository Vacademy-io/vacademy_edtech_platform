package vacademy.io.admin_core_service.features.live_activity.core;

import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.admin_core_service.features.live_activity.dto.LiveActivityEvent;
import vacademy.io.admin_core_service.features.live_activity.repository.UserLiveEventRepository;

import java.sql.Timestamp;
import java.util.UUID;

/**
 * The transactional half of recording an event, deliberately in its own bean.
 *
 * <p>This split is not stylistic. Spring's {@code @Transactional} is proxy-based, so a
 * self-invocation from a sibling method on the same class never goes through the proxy and
 * the annotation silently does nothing. That exact trap already produced a long-standing
 * false claim about the admin audit log being a transactional outbox, where the aspect's own
 * {@code @Transactional} was dead code for months. Keeping the annotated method on a
 * separate bean, as {@code CallLifecycleTxOps} and {@code RecordingTxOps} already do in the
 * telephony package, is what makes REQUIRES_NEW real.
 *
 * <p>REQUIRES_NEW matters here because the recorder is called from inside business
 * transactions. Without a genuinely separate transaction, a failed insert could mark the
 * caller rollback-only and take a payment or an enrolment down with it.
 */
@Component
@RequiredArgsConstructor
public class LiveActivityTxOps {

    private static final Logger log = LoggerFactory.getLogger(LiveActivityTxOps.class);

    private final UserLiveEventRepository repository;
    private final ObjectMapper objectMapper;

    /**
     * Insert-if-absent.
     *
     * @return the stamped event when this call actually wrote the row, or {@code null} when
     *         another replica, a retried webhook or a provider sibling event got there
     *         first. Callers publish only on a non-null return, so a duplicate never
     *         reaches a subscriber twice.
     */
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public LiveActivityEvent insertIfAbsent(LiveActivityEvent event) {
        long millis = event.getOccurredAtEpochMillis() > 0
                ? event.getOccurredAtEpochMillis()
                : System.currentTimeMillis();
        String id = event.getEventId() != null ? event.getEventId() : UUID.randomUUID().toString();

        int inserted = repository.insertIfAbsent(
                id,
                event.getInstituteId(),
                new Timestamp(millis),
                name(event.getCategory()),
                name(event.getAction()),
                name(event.getActorType()),
                event.getDedupeKey(),
                event.getSubjectName(),
                event.getSubjectEmail(),
                event.getSubjectMobile(),
                event.getSubjectId(),
                event.getEntityId(),
                event.getCounsellorUserId(),
                event.getCounsellorName(),
                serialisePayload(event));

        if (inserted == 0) {
            log.debug("live activity event already recorded, skipping: {}",
                    event.getDedupeKey());
            return null;
        }

        return stamp(event, id, millis);
    }

    private LiveActivityEvent stamp(LiveActivityEvent event, String id, long millis) {
        return LiveActivityEvent.builder()
                .eventId(id)
                .instituteId(event.getInstituteId())
                .occurredAtEpochMillis(millis)
                .category(event.getCategory())
                .action(event.getAction())
                .actorType(event.getActorType())
                .dedupeKey(event.getDedupeKey())
                .subjectName(event.getSubjectName())
                .subjectEmail(event.getSubjectEmail())
                .subjectMobile(event.getSubjectMobile())
                .subjectId(event.getSubjectId())
                .entityId(event.getEntityId())
                .counsellorUserId(event.getCounsellorUserId())
                .counsellorName(event.getCounsellorName())
                .payload(event.getPayload())
                .build();
    }

    private String serialisePayload(LiveActivityEvent event) {
        if (event.getPayload() == null || event.getPayload().isEmpty()) {
            return null;
        }
        try {
            return objectMapper.writeValueAsString(event.getPayload());
        } catch (Exception e) {
            log.warn("live activity payload serialisation failed for {}: {}",
                    event.getDedupeKey(), e.getMessage());
            return null;
        }
    }

    private static String name(Enum<?> value) {
        return value == null ? null : value.name();
    }
}
