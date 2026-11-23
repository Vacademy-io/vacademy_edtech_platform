package vacademy.io.admin_core_service.features.commerce.pos.service;

import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import vacademy.io.admin_core_service.features.commerce.pos.entity.PosRegister;
import vacademy.io.admin_core_service.features.commerce.pos.entity.PosSession;
import vacademy.io.admin_core_service.features.commerce.pos.repository.PosRegisterRepository;
import vacademy.io.admin_core_service.features.commerce.pos.repository.PosSessionRepository;
import vacademy.io.admin_core_service.features.commerce.security.CommerceAccessDeniedException;
import vacademy.io.admin_core_service.features.commerce.security.CommerceAccessGuard;
import vacademy.io.admin_core_service.features.commerce.security.CommerceFeature;
import vacademy.io.admin_core_service.features.commerce.security.CommerceRole;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.VacademyException;

import java.util.Set;

/**
 * Who may do what at the counter. Every route needs the feature {@code commerce.pos} and goes
 * through {@link CommerceAccessGuard} (membership, feature, role, location); never through the
 * general staff check. A register or session is read with the institute in the WHERE, so the id
 * of another institute is a 404 before the guard says anything else.
 */
@Component
public class PosAccess {

    /** At the till: a cashier or a store manager (an ADMIN passes every role check). */
    public static final Set<CommerceRole> TILL = Set.of(CommerceRole.POS_CASHIER, CommerceRole.STORE_MANAGER);
    public static final Set<CommerceRole> MANAGER = Set.of(CommerceRole.STORE_MANAGER);
    /** Empty: only an institute ADMIN passes. */
    public static final Set<CommerceRole> ADMIN_ONLY = Set.of();

    public static final String REGISTER_NOT_FOUND = "REGISTER_NOT_FOUND";
    public static final String SESSION_NOT_FOUND = "SESSION_NOT_FOUND";
    public static final String SESSION_NOT_YOURS = "SESSION_NOT_YOURS";

    private final CommerceAccessGuard guard;
    private final PosRegisterRepository registerRepository;
    private final PosSessionRepository sessionRepository;
    private final TransactionTemplate readOnly;

    public PosAccess(CommerceAccessGuard guard, PosRegisterRepository registerRepository,
                     PosSessionRepository sessionRepository, PlatformTransactionManager transactionManager) {
        this.guard = guard;
        this.registerRepository = registerRepository;
        this.sessionRepository = sessionRepository;
        this.readOnly = new TransactionTemplate(transactionManager);
        this.readOnly.setReadOnly(true);
    }

    /** ADMIN, or a store manager. */
    public static boolean isManager(CustomUserDetails user) {
        return isAdmin(user) || CommerceAccessGuard.rolesOf(user).contains(CommerceRole.STORE_MANAGER);
    }

    public static boolean isAdmin(CustomUserDetails user) {
        if (user == null || user.getAuthorities() == null) {
            return false;
        }
        return user.getAuthorities().stream().anyMatch(a -> a != null && a.getAuthority() != null
                && "ADMIN".equalsIgnoreCase(a.getAuthority().trim()));
    }

    /** Membership, feature and role, with no location (institute-wide reads and the settings). */
    public void require(CustomUserDetails user, String instituteId, Set<CommerceRole> roles) {
        guard.require(user, instituteId, CommerceFeature.POS, roles);
    }

    /** Membership, feature, role and the location (an ADMIN skips the location). */
    public void requireAt(CustomUserDetails user, String instituteId, Set<CommerceRole> roles, String locationId) {
        guard.require(user, instituteId, CommerceFeature.POS, roles, locationId);
    }

    /** The register of this institute (404 otherwise), then {@code roles} at its location. */
    public PosRegister register(CustomUserDetails user, String instituteId, String registerId, Set<CommerceRole> roles) {
        PosRegister register = readRegister(instituteId, registerId);
        requireAt(user, instituteId, roles, register.getLocationId());
        return register;
    }

    /** The register of this institute, read now; 404 REGISTER_NOT_FOUND otherwise. No access check. */
    public PosRegister readRegister(String instituteId, String registerId) {
        PosRegister register = registerId == null || registerId.isBlank() ? null
                : readOnly.execute(status -> registerRepository.findByInstituteIdAndId(instituteId, registerId.trim())
                .orElse(null));
        if (register == null) {
            throw new VacademyException(HttpStatus.NOT_FOUND, REGISTER_NOT_FOUND + ": no such register");
        }
        return register;
    }

    /**
     * The session of this institute (404 otherwise), TILL at its location, and for anyone who is
     * not a manager or ADMIN: the session is their own (403 SESSION_NOT_YOURS).
     */
    public PosSession session(CustomUserDetails user, String instituteId, String sessionId) {
        PosSession session = readSession(instituteId, sessionId);
        requireAt(user, instituteId, TILL, session.getLocationId());
        requireOwnerOrManager(user, session);
        return session;
    }

    /** The session of this institute, read now; 404 SESSION_NOT_FOUND otherwise. No access check. */
    public PosSession readSession(String instituteId, String sessionId) {
        PosSession session = sessionId == null || sessionId.isBlank() ? null
                : readOnly.execute(status -> sessionRepository.findByInstituteIdAndId(instituteId, sessionId.trim())
                .orElse(null));
        if (session == null) {
            throw new VacademyException(HttpStatus.NOT_FOUND, SESSION_NOT_FOUND + ": no such counter session");
        }
        return session;
    }

    /** 403 SESSION_NOT_YOURS unless the caller is a manager, an ADMIN or the session's cashier. */
    public static void requireOwnerOrManager(CustomUserDetails user, PosSession session) {
        if (!isManager(user) && !isOwner(user, session)) {
            throw new CommerceAccessDeniedException(SESSION_NOT_YOURS,
                    "this counter was opened by someone else");
        }
    }

    /** 403 SESSION_NOT_YOURS unless the caller is the session's cashier (selling needs one's own drawer). */
    public static void requireOwner(CustomUserDetails user, PosSession session) {
        if (!isOwner(user, session)) {
            throw new CommerceAccessDeniedException(SESSION_NOT_YOURS,
                    "this counter was opened by someone else");
        }
    }

    public static boolean isOwner(CustomUserDetails user, PosSession session) {
        return user != null && user.getUserId() != null && user.getUserId().equals(session.getCashierUserId());
    }
}
