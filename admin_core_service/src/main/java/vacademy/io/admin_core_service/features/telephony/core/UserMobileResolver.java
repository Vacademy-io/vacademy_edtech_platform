package vacademy.io.admin_core_service.features.telephony.core;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import vacademy.io.admin_core_service.features.auth_service.service.AuthService;
import vacademy.io.common.auth.dto.UserDTO;

import java.util.List;
import java.util.Optional;

/**
 * Resolves a user's mobile number for the telephony flow.
 *
 * Goes through the existing {@link AuthService#getUsersFromAuthServiceByUserIds}
 * HTTP path — the {@code users} table physically lives in auth_service's
 * database, not admin_core_service's, so direct JPA against the shared
 * {@code UserRepository} fails locally (and is wrong even when it accidentally
 * works on shared-DB environments).
 *
 * The lookup is cached via auth_service's own response, plus the orchestrator
 * is the only caller in the hot path (once per /connect, not once per webhook),
 * so the cross-service HTTP cost is acceptable. If the call volume ever pushes
 * us to cache locally, this is the single place to add Caffeine.
 */
@Service
public class UserMobileResolver {

    private static final Logger log = LoggerFactory.getLogger(UserMobileResolver.class);

    @Autowired
    private AuthService authService;

    public Optional<String> findMobile(String userId) {
        if (userId == null || userId.isBlank()) return Optional.empty();
        try {
            List<UserDTO> users = authService.getUsersFromAuthServiceByUserIds(List.of(userId));
            if (users == null || users.isEmpty()) return Optional.empty();
            String mobile = users.get(0).getMobileNumber();
            if (mobile == null || mobile.isBlank()) return Optional.empty();
            return Optional.of(mobile);
        } catch (Exception e) {
            log.warn("auth_service lookup failed for userId {}", userId, e);
            return Optional.empty();
        }
    }

    /**
     * Verified-mobile lookup. For now this is the same as findMobile because
     * auth_service doesn't expose a separate verified flag. When it does, gate
     * on it here without touching callers.
     */
    public Optional<String> findVerifiedMobile(String userId) {
        return findMobile(userId);
    }

    /**
     * Same lookup, but a FAILED lookup propagates instead of being flattened
     * into "no mobile on file".
     *
     * <p>{@link #findMobile} catches everything and returns empty, which suits
     * the dial path (it is about to fail anyway with a clear message). It does
     * NOT suit the pre-flight readiness probe behind the Call button: there,
     * empty means "disable this person's button and tell them to add a mobile
     * number", and an auth_service blip would say that to a counsellor whose
     * number is sitting right there in their profile. Letting the exception out
     * lets the probe's caller fail OPEN and leave the button alone.
     */
    public Optional<String> findVerifiedMobileStrict(String userId) {
        if (userId == null || userId.isBlank()) return Optional.empty();
        List<UserDTO> users = authService.getUsersFromAuthServiceByUserIds(List.of(userId));
        if (users == null || users.isEmpty()) return Optional.empty();
        String mobile = users.get(0).getMobileNumber();
        return (mobile == null || mobile.isBlank()) ? Optional.empty() : Optional.of(mobile);
    }

    /**
     * The user's stored gender as {@code "MALE"}/{@code "FEMALE"} when set on the
     * auth record, else empty. Used to tell the AI voice bot how to address the lead
     * (honorific + Hindi second-person agreement). Form leads usually have no gender
     * stored, so callers fall back to a name-based guess ({@link NameGender}).
     */
    public Optional<String> findGender(String userId) {
        if (userId == null || userId.isBlank()) return Optional.empty();
        try {
            List<UserDTO> users = authService.getUsersFromAuthServiceByUserIds(List.of(userId));
            if (users == null || users.isEmpty()) return Optional.empty();
            String g = users.get(0).getGender();
            if (g == null) return Optional.empty();
            g = g.trim().toUpperCase();
            return (g.equals("MALE") || g.equals("FEMALE")) ? Optional.of(g) : Optional.empty();
        } catch (Exception e) {
            log.warn("auth_service gender lookup failed for userId {}", userId, e);
            return Optional.empty();
        }
    }

    /**
     * Display name for a user (full_name preferred, falls back to email then
     * username). Used by the timeline event "by X" line on call recordings.
     */
    public Optional<String> findDisplayName(String userId) {
        if (userId == null || userId.isBlank()) return Optional.empty();
        try {
            List<UserDTO> users = authService.getUsersFromAuthServiceByUserIds(List.of(userId));
            if (users == null || users.isEmpty()) return Optional.empty();
            UserDTO u = users.get(0);
            if (u.getFullName() != null && !u.getFullName().isBlank()) {
                return Optional.of(u.getFullName());
            }
            if (u.getEmail() != null && !u.getEmail().isBlank()) {
                return Optional.of(u.getEmail());
            }
            if (u.getUsername() != null && !u.getUsername().isBlank()) {
                return Optional.of(u.getUsername());
            }
            return Optional.empty();
        } catch (Exception e) {
            log.warn("auth_service display-name lookup failed for userId {}", userId, e);
            return Optional.empty();
        }
    }
}
