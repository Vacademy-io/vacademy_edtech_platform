package vacademy.io.admin_core_service.features.telephony.controller;

import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import vacademy.io.admin_core_service.core.security.InstituteAccessValidator;
import vacademy.io.admin_core_service.features.telephony.core.AiCallService;
import vacademy.io.admin_core_service.features.telephony.core.dto.AiCallRequestDTO;
import vacademy.io.admin_core_service.features.telephony.core.dto.AiCallResponseDTO;
import vacademy.io.admin_core_service.features.telephony.enums.CallTrigger;
import vacademy.io.admin_core_service.features.telephony.queue.AiCallQueueDrainJob;
import vacademy.io.admin_core_service.features.telephony.queue.AiCallQueueService;
import vacademy.io.admin_core_service.features.telephony.queue.dto.AiCallQueueDTOs.EnqueueResult;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.util.Optional;

/**
 * Manual "Click to AI call" — a counsellor/admin triggers an AI call for a lead.
 * Authenticated (not in the webhook allow-list); the actor becomes the call's
 * counsellor_user_id. Workflow-driven AI calls bypass this controller and go through
 * {@code AiCallNodeDispatcher}.
 *
 * <p><b>The click always joins the queue; whether it waits there depends on the fleet.</b>
 * The call is written to {@code ai_call_queue} and then dialled immediately, on this
 * request thread, if a line is actually free and this institute has nothing already
 * waiting — which is the normal case. Then the response is exactly what it always was:
 * {@code dispatched = true} with a {@code callLogId}, and a phone rings.
 *
 * <p>Only when the fleet is busy, or this institute already has calls queued, does the
 * click take its turn at the back. That response says {@code status = "QUEUED"},
 * {@code dispatched = false}, and carries the position and ETA so the UI can say when
 * rather than pretending nothing happened. A UI that reads {@code dispatched} as "did it
 * work?" needs to treat QUEUED as accepted-but-waiting.
 *
 * <p>What a manual call keeps either way: {@link CallTrigger#MANUAL}, so the
 * already-assigned / daily-cap / duplicate throttles do not apply to it and the
 * institute's calling window does not hold it back. Credit exhaustion and a deleted lead
 * still error loudly on the spot, exactly as before, rather than becoming a silent
 * deferral — see {@code AiCallQueueDrainJob.dispatchNowIfLineFree}.
 */
@RestController
@RequestMapping("/admin-core-service/v1/telephony/ai-call")
@RequiredArgsConstructor
public class AiCallController {

    private final AiCallService aiCallService;
    private final AiCallQueueService queueService;
    private final AiCallQueueDrainJob drainJob;
    private final InstituteAccessValidator instituteAccessValidator;

    /** Rollback lever: false = dial inline, exactly as before the queue existed. */
    @Value("${telephony.ai.queue.enabled:true}")
    private boolean queueEnabled;

    @PostMapping("/connect")
    public ResponseEntity<AiCallResponseDTO> connect(
            @RequestBody AiCallRequestDTO req,
            @RequestAttribute("user") CustomUserDetails user) {
        // Guard: this places a PAID AI call charged to req.instituteId — verify the caller
        // is staff of that institute (else a member of one tenant could spend another's
        // credits / dial another's lead by passing a foreign instituteId). No root bypass:
        // learners are root users too.
        instituteAccessValidator.requireInstituteStaff(user, req.getInstituteId());
        String actorUserId = user == null ? null : user.getUserId();

        if (!queueEnabled) {
            return ResponseEntity.ok(aiCallService.placeCall(req, actorUserId, CallTrigger.MANUAL));
        }

        EnqueueResult result = queueService.enqueue(req, CallTrigger.MANUAL,
                AiCallQueueService.SOURCE_MANUAL, null, actorUserId);

        // Fast path: with a free line and nothing of this institute's already waiting,
        // dial here and now so the counsellor gets a ringing phone and the old response
        // rather than a queue position for a call that would have gone out two seconds
        // later anyway. Returns empty when the fleet is busy, and the item simply waits.
        if (result.getQueueItemId() != null) {
            Optional<AiCallResponseDTO> dialled =
                    drainJob.dispatchNowIfLineFree(result.getQueueItemId());
            if (dialled.isPresent()) return ResponseEntity.ok(dialled.get());
        }

        return ResponseEntity.ok(AiCallResponseDTO.builder()
                .status("QUEUED")
                .dispatched(false)
                .providerMessage(result.getMessage())
                .queueItemId(result.getQueueItemId())
                .queuePosition(result.getAheadInLane())
                .queueEtaMinutes(result.getEtaMinutes())
                .build());
    }
}
