package vacademy.io.admin_core_service.features.live_activity.core;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import vacademy.io.admin_core_service.features.live_activity.dto.LiveActivityEvent;
import vacademy.io.admin_core_service.features.live_activity.dto.LiveActivityFeedItemDTO;
import vacademy.io.admin_core_service.features.live_activity.entity.UserLiveEvent;
import vacademy.io.admin_core_service.features.live_activity.enums.LiveActivityAction;
import vacademy.io.admin_core_service.features.live_activity.enums.LiveActivityActorType;
import vacademy.io.admin_core_service.features.live_activity.enums.LiveActivityCategory;

import java.util.Map;

/**
 * Row to event, and row to feed item.
 *
 * <p>Enum parsing is tolerant on purpose. Rows outlive code: a retention window of 90 days
 * spans plenty of deploys, and a row written by a newer version naming an action this build
 * has never heard of must still render in the history rather than throw on read.
 */
public final class LiveActivityEventMapper {

    private static final TypeReference<Map<String, Object>> PAYLOAD_TYPE =
            new TypeReference<>() {
            };

    private LiveActivityEventMapper() {
    }

    public static LiveActivityEvent toEvent(UserLiveEvent row, ObjectMapper objectMapper) {
        return LiveActivityEvent.builder()
                .eventId(row.getId())
                .instituteId(row.getInstituteId())
                .occurredAtEpochMillis(row.getOccurredAt() == null ? 0L : row.getOccurredAt().getTime())
                .category(parse(LiveActivityCategory.class, row.getCategory()))
                .action(parse(LiveActivityAction.class, row.getAction()))
                .actorType(parse(LiveActivityActorType.class, row.getActorType()))
                .dedupeKey(row.getDedupeKey())
                .subjectName(row.getSubjectName())
                .subjectEmail(row.getSubjectEmail())
                .subjectMobile(row.getSubjectMobile())
                .subjectId(row.getSubjectId())
                .entityId(row.getEntityId())
                .counsellorUserId(row.getCounsellorUserId())
                .counsellorName(row.getCounsellorName())
                .payload(readPayload(row.getPayload(), objectMapper))
                .build();
    }

    public static LiveActivityFeedItemDTO toFeedItem(UserLiveEvent row, ObjectMapper objectMapper) {
        return LiveActivityFeedItemDTO.builder()
                .eventId(row.getId())
                .instituteId(row.getInstituteId())
                .occurredAtEpochMillis(row.getOccurredAt() == null ? 0L : row.getOccurredAt().getTime())
                .category(row.getCategory())
                .action(row.getAction())
                .actorType(row.getActorType())
                .subjectName(row.getSubjectName())
                .subjectEmail(row.getSubjectEmail())
                .subjectMobile(row.getSubjectMobile())
                .subjectId(row.getSubjectId())
                .entityId(row.getEntityId())
                .counsellorUserId(row.getCounsellorUserId())
                .counsellorName(row.getCounsellorName())
                .payload(readPayload(row.getPayload(), objectMapper))
                .build();
    }

    private static Map<String, Object> readPayload(String json, ObjectMapper objectMapper) {
        if (json == null || json.isBlank()) {
            return null;
        }
        try {
            return objectMapper.readValue(json, PAYLOAD_TYPE);
        } catch (Exception e) {
            return null;
        }
    }

    private static <E extends Enum<E>> E parse(Class<E> type, String value) {
        if (value == null) {
            return null;
        }
        try {
            return Enum.valueOf(type, value);
        } catch (IllegalArgumentException e) {
            return null;
        }
    }
}
