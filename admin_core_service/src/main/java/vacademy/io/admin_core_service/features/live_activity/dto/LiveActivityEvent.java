package vacademy.io.admin_core_service.features.live_activity.dto;

import com.fasterxml.jackson.annotation.JsonInclude;
import lombok.Builder;
import lombok.Value;
import lombok.extern.jackson.Jacksonized;
import vacademy.io.admin_core_service.features.live_activity.enums.LiveActivityAction;
import vacademy.io.admin_core_service.features.live_activity.enums.LiveActivityActorType;
import vacademy.io.admin_core_service.features.live_activity.enums.LiveActivityCategory;

import java.util.Map;

/**
 * The wire and in-process shape of one activity event. Immutable, provider-neutral, and
 * modelled on {@code telephony/spi/dto/NormalizedCallEvent}.
 *
 * <p>This is what producers build and what the browser receives over SSE -- one shape end
 * to end, so a row tailed from the table and a freshly recorded event are indistinguishable
 * to the client.
 */
@Value
@Builder
@Jacksonized
@JsonInclude(JsonInclude.Include.NON_NULL)
public class LiveActivityEvent {

    // @Jacksonized is load-bearing, not decoration. @Value leaves no no-arg constructor, so
    // without it Jackson cannot rebuild this type -- and the listener deserializes every
    // cross-replica notification straight back into it, so the failure would appear at
    // runtime as a silently dead feed rather than at compile time.

    String eventId;
    String instituteId;
    long occurredAtEpochMillis;

    LiveActivityCategory category;
    LiveActivityAction action;
    LiveActivityActorType actorType;

    /**
     * Deterministic, derived from the business fact. See {@code LiveActivityDedupeKeys} --
     * putting a timestamp or a UUID in here silently disables duplicate protection.
     */
    String dedupeKey;

    String subjectName;
    String subjectEmail;
    String subjectMobile;
    String subjectId;

    /** enrollInviteId / audienceResponseId / callLogId / paymentLogId. */
    String entityId;

    String counsellorUserId;
    String counsellorName;

    Map<String, Object> payload;
}
