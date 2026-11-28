package vacademy.io.admin_core_service.features.telephony.core.dto;

import lombok.Builder;
import lombok.Data;

/**
 * Result of placing an AI call. {@code callLogId} is our correlation id
 * (telephony_call_log.id) — the same id Aavtaar echoes back in metadata on the
 * end-of-call webhook.
 *
 * <p>Since the AI call queue, a request may be ACCEPTED without a call having gone out
 * yet: the fleet carries a fixed number of simultaneous calls, so a click can land in
 * line behind other work. Those responses come back with {@code status = "QUEUED"},
 * {@code dispatched = false}, and the three queue fields below populated. The fields are
 * additive — a dial that goes out immediately looks exactly as it always did, with the
 * queue fields null.
 */
@Data
@Builder
public class AiCallResponseDTO {
    private String callLogId;
    private String status;
    /** True only when a provider accepted a real dial. A queued call is NOT dispatched. */
    private boolean dispatched;
    private String providerMessage;

    /** Set when the request was queued: the {@code ai_call_queue} row that now owns it. */
    private String queueItemId;
    /** Calls ahead of this one in this institute's lane. 0 = next up. */
    private Long queuePosition;
    /** Rough wait before this call goes out, in minutes. */
    private Long queueEtaMinutes;
}
