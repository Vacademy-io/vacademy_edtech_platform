package vacademy.io.admin_core_service.features.telephony.publicapi;

import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.admin_core_service.features.telephony.core.CallLifecycleTxOps;
import vacademy.io.admin_core_service.features.telephony.core.CallOrchestrator;
import vacademy.io.admin_core_service.features.telephony.publicapi.entity.HumanCallApiCall;
import vacademy.io.admin_core_service.features.telephony.publicapi.repository.HumanCallApiCallRepository;

import java.time.Instant;
import java.util.Optional;

/**
 * Reserves a human call: the live-call checks and the inserts that make the call visible
 * to those checks, in ONE transaction under two advisory locks — the counsellor's and the
 * number's (per institute). Without it, two clicks a moment apart (no Idempotency-Key)
 * both passed "counsellor not on a call" before either had inserted its call row, and the
 * counsellor's phone rang twice.
 *
 * <p>Inside the transaction: lock counsellor, lock number (always in that order, so two
 * reservations can never deadlock), re-check the Idempotency-Key (a retry that waited on
 * the lock must get the first call, not "counsellor busy"), the guards, the API row, the
 * INITIATED telephony_call_log row (CallLifecycleTxOps joins this transaction) and the link
 * between them. Commit releases the locks; the next request then sees the INITIATED row.
 *
 * <p>Outside it, by design: everything slow and external. The auth_service lookups run
 * before, and the provider dial ({@link CallOrchestrator#dispatchPrepared}) after — a
 * locked transaction must never wait on an HTTP call.
 *
 * <p>Not covered: the dashboard's Call button takes no lock, so a dashboard click and an
 * API call for the same counsellor at the same instant can still both go out.
 */
@Service
@RequiredArgsConstructor
public class HumanCallReservation {

    private final HumanCallApiCallRepository callRepository;
    private final HumanCallGuards guards;
    private final CallLifecycleTxOps callTx;

    /** A reservation, or the call an earlier request with the same Idempotency-Key made. */
    public record Reserved(HumanCallApiCall call, CallOrchestrator.Prepared prepared, HumanCallApiCall prior) {
    }

    @Transactional
    public Reserved reserve(HumanCallApiCall row, String providerType, int perNumberCap,
                            CallLifecycleTxOps.DialTarget target, String responseId) {
        String instituteId = row.getInstituteId();
        callRepository.advisoryXactLock(counsellorLockKey(instituteId, row.getCounsellorUserId()));
        callRepository.advisoryXactLock(numberLockKey(instituteId, row.getPhoneNumber()));
        if (row.getIdempotencyKey() != null) {
            Optional<HumanCallApiCall> prior =
                    callRepository.findByInstituteIdAndIdempotencyKey(instituteId, row.getIdempotencyKey());
            if (prior.isPresent()) return new Reserved(null, null, prior.get());
        }
        Instant now = Instant.now();
        guards.requireCounsellorFree(instituteId, row.getCounsellorUserId(), providerType);
        guards.requireNumberAllowed(instituteId, row.getPhoneNumber(), now, perNumberCap);
        HumanCallApiCall saved = callRepository.saveAndFlush(row);
        CallOrchestrator.Prepared prepared =
                callTx.prepareAndPersistForCounsellor(instituteId, row.getCounsellorUserId(), target);
        callRepository.setDialed(saved.getId(), prepared.callLogId(), providerType, responseId);
        return new Reserved(saved, prepared, null);
    }

    static String counsellorLockKey(String instituteId, String counsellorUserId) {
        return "human-call:counsellor:" + instituteId + ":" + counsellorUserId;
    }

    static String numberLockKey(String instituteId, String phone) {
        String last10 = HumanCallGuards.last10(phone);
        return "human-call:number:" + instituteId + ":" + (last10 == null ? phone : last10);
    }
}
