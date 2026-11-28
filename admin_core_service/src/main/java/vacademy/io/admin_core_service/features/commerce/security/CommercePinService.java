package vacademy.io.admin_core_service.features.commerce.security;

import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.admin_core_service.features.commerce.security.entity.CommerceStaffPin;
import vacademy.io.admin_core_service.features.commerce.security.repository.CommerceStaffPinRepository;
import vacademy.io.common.exceptions.InvalidRequestException;

import java.util.regex.Pattern;

/**
 * Manager approval PIN: personal, stored hashed, locked after five
 * wrong tries, each lock longer than the last. There is no "verify" endpoint that returns a reusable token; {@link #verify}
 * is called by the action that the PIN approves.
 */
@Service
public class CommercePinService {

    /**
     * BCrypt, held here and not taken from the Spring context, so the PIN hash never depends
     * on the encoder the service is configured with.
     */
    static final PasswordEncoder ENCODER = new BCryptPasswordEncoder();

    private static final Pattern PIN_FORMAT = Pattern.compile("\\d{6,8}");

    private final CommerceStaffPinRepository pinRepository;
    private final CommercePinAttemptService attemptService;

    public CommercePinService(CommerceStaffPinRepository pinRepository,
                              CommercePinAttemptService attemptService) {
        this.pinRepository = pinRepository;
        this.attemptService = attemptService;
    }

    /** Sets or replaces the user's PIN in this institute and clears any lock. */
    @Transactional
    public void setPin(String instituteId, String userId, String rawPin) {
        if (rawPin == null || !PIN_FORMAT.matcher(rawPin).matches()) {
            throw new InvalidRequestException("PIN must be 6 to 8 digits");
        }
        if (isTrivial(rawPin)) {
            throw new InvalidRequestException("PIN is too easy to guess: avoid one repeated digit and runs such as 123456");
        }
        CommerceStaffPin pin = pinRepository.findByInstituteIdAndUserId(instituteId, userId).orElseGet(() -> {
            CommerceStaffPin created = new CommerceStaffPin();
            created.setInstituteId(instituteId);
            created.setUserId(userId);
            return created;
        });
        pin.setPinHash(ENCODER.encode(rawPin));
        pin.setFailedAttempts(0);
        pin.setLockedUntil(null);
        pin.setLockCount(0);
        pinRepository.save(pin);
    }

    /** One digit repeated, or a run that goes up or down by one each step. */
    static boolean isTrivial(String pin) {
        boolean same = true;
        boolean up = true;
        boolean down = true;
        for (int i = 1; i < pin.length(); i++) {
            int step = pin.charAt(i) - pin.charAt(i - 1);
            same &= step == 0;
            up &= step == 1;
            down &= step == -1;
        }
        return same || up || down;
    }

    public boolean hasPin(String instituteId, String userId) {
        return pinRepository.findByInstituteIdAndUserId(instituteId, userId).isPresent();
    }

    /**
     * Passes only when {@code rawPin} is the PIN of {@code approverUserId} in this institute.
     * Throws 403 {@code PIN_INVALID} or {@code PIN_LOCKED}. The try is counted in its own
     * transaction, so the count survives the roll-back of the caller's action.
     */
    public void verify(String instituteId, String approverUserId, String rawPin) {
        if (instituteId == null || instituteId.isBlank() || approverUserId == null || approverUserId.isBlank()) {
            throw new CommerceAccessDeniedException(CommerceAccessDeniedException.PIN_INVALID, "wrong PIN");
        }
        CommercePinAttemptService.Outcome outcome = attemptService.check(instituteId, approverUserId, rawPin);
        if (outcome == CommercePinAttemptService.Outcome.LOCKED) {
            throw new CommerceAccessDeniedException(CommerceAccessDeniedException.PIN_LOCKED,
                    "too many wrong tries; this PIN is locked for a while");
        }
        if (outcome != CommercePinAttemptService.Outcome.OK) {
            throw new CommerceAccessDeniedException(CommerceAccessDeniedException.PIN_INVALID, "wrong PIN");
        }
    }
}
