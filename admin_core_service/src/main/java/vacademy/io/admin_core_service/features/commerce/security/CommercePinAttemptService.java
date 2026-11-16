package vacademy.io.admin_core_service.features.commerce.security;

import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.admin_core_service.features.commerce.audit.CommerceAuditService;
import vacademy.io.admin_core_service.features.commerce.security.entity.CommerceStaffPin;
import vacademy.io.admin_core_service.features.commerce.security.repository.CommerceStaffPinRepository;

import java.time.Clock;
import java.time.Duration;
import java.util.Date;
import java.util.Optional;

/**
 * Checks one PIN try and keeps the failure count. It runs in its own transaction: a wrong PIN
 * makes the caller's action roll back, and the count of wrong tries must not roll back with it.
 * The row lock makes parallel guesses queue, so each one is counted.
 */
@Slf4j
@Service
public class CommercePinAttemptService {

    public static final int MAX_FAILED_ATTEMPTS = 5;
    public static final Duration LOCK_DURATION = Duration.ofMinutes(15);
    public static final Duration SECOND_LOCK_DURATION = Duration.ofHours(1);
    /** From this lock on the PIN stays locked until its owner sets a new one. */
    public static final int LOCKS_BEFORE_PERMANENT = 3;
    private static final Duration PERMANENT = Duration.ofDays(36500);

    public enum Outcome {
        OK,
        /** Wrong PIN, or the user has no PIN. */
        INVALID,
        /** Locked before this try, or by it. */
        LOCKED
    }

    private final CommerceStaffPinRepository pinRepository;
    private final CommerceAuditService auditService;
    private Clock clock = Clock.systemUTC();

    public CommercePinAttemptService(CommerceStaffPinRepository pinRepository,
                                     CommerceAuditService auditService) {
        this.pinRepository = pinRepository;
        this.auditService = auditService;
    }

    void setClock(Clock clock) {
        this.clock = clock;
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public Outcome check(String instituteId, String userId, String rawPin) {
        Optional<CommerceStaffPin> found = pinRepository.findForUpdate(instituteId, userId);
        if (found.isEmpty()) {
            return Outcome.INVALID;
        }
        CommerceStaffPin pin = found.get();
        Date now = Date.from(clock.instant());
        if (pin.getLockedUntil() != null) {
            if (pin.getLockedUntil().after(now)) {
                return Outcome.LOCKED;
            }
            pin.setLockedUntil(null);
            pin.setFailedAttempts(0);
        }
        if (rawPin != null && CommercePinService.ENCODER.matches(rawPin, pin.getPinHash())) {
            pin.setFailedAttempts(0);
            pinRepository.save(pin);
            return Outcome.OK;
        }
        int failures = (pin.getFailedAttempts() == null ? 0 : pin.getFailedAttempts()) + 1;
        pin.setFailedAttempts(failures);
        if (failures >= MAX_FAILED_ATTEMPTS) {
            // The lock grows: 15 minutes, 1 hour, then until the owner sets a new PIN. A lock that
            // always ends after 15 minutes lets a patient guesser walk through every PIN.
            int locks = (pin.getLockCount() == null ? 0 : pin.getLockCount()) + 1;
            Duration lock = locks >= LOCKS_BEFORE_PERMANENT ? PERMANENT
                    : locks == 2 ? SECOND_LOCK_DURATION : LOCK_DURATION;
            pin.setLockCount(locks);
            pin.setLockedUntil(Date.from(clock.instant().plus(lock)));
            pinRepository.save(pin);
            log.warn("Commerce PIN locked after {} wrong tries (lock {}): institute {} user {}",
                    failures, locks, instituteId, userId);
            // Same transaction as the count, so the row survives the roll-back of the caller.
            auditService.record(instituteId, null, "PIN_LOCKED", "STAFF_PIN", userId,
                    "{\"lock_count\":" + locks + ",\"until_new_pin\":" + (locks >= LOCKS_BEFORE_PERMANENT) + "}");
            return Outcome.LOCKED;
        }
        pinRepository.save(pin);
        return Outcome.INVALID;
    }
}
