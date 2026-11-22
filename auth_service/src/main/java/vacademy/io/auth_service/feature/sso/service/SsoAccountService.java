package vacademy.io.auth_service.feature.sso.service;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;
import vacademy.io.auth_service.feature.sso.entity.InstituteSsoConnection;
import vacademy.io.auth_service.feature.sso.entity.UserSsoIdentity;
import vacademy.io.auth_service.feature.sso.repository.UserSsoIdentityRepository;
import vacademy.io.auth_service.feature.util.UsernameGenerator;
import vacademy.io.common.auth.entity.Role;
import vacademy.io.common.auth.entity.User;
import vacademy.io.common.auth.entity.UserRole;
import vacademy.io.common.auth.enums.UserRoleStatus;
import vacademy.io.common.auth.repository.RoleRepository;
import vacademy.io.common.auth.repository.UserRepository;
import vacademy.io.common.auth.repository.UserRoleRepository;
import vacademy.io.common.auth.util.SuperAdminAuthUtil;

import java.util.Date;
import java.util.List;
import java.util.Locale;
import java.util.Optional;
import java.util.UUID;

/**
 * Turns a provider-vouched person into one of our learners in the connection's institute.
 *
 * <p>Accounts here are shared across institutes and found by email elsewhere, while a partner's
 * provider is trusted only for its own institute. So:
 * <ol>
 *   <li>the provider's permanent id (connection + subject) is the key, never the email;</li>
 *   <li>an existing account is linked by email only when it is a plain learner of THIS institute
 *       and nowhere else, the email is in the connection's domains, and the provider vouched for
 *       the email (email_verified, or the admin's "trust provider email" switch);</li>
 *   <li>otherwise a separate account is created for this institute.</li>
 * </ol>
 * A learner the institute switched off here (role DISABLED / DELETED) stays off.
 */
@Service
public class SsoAccountService {

    private static final Logger log = LoggerFactory.getLogger(SsoAccountService.class);
    static final String STUDENT = "STUDENT";
    static final String SOURCE_TYPE = "SSO";

    private final UserSsoIdentityRepository identityRepository;
    private final UserRepository userRepository;
    private final UserRoleRepository userRoleRepository;
    private final RoleRepository roleRepository;

    public SsoAccountService(UserSsoIdentityRepository identityRepository, UserRepository userRepository,
                             UserRoleRepository userRoleRepository, RoleRepository roleRepository) {
        this.identityRepository = identityRepository;
        this.userRepository = userRepository;
        this.userRoleRepository = userRoleRepository;
        this.roleRepository = roleRepository;
    }

    /** The account and identity this sign-in resolved to. */
    public record Resolved(User user, UserSsoIdentity identity, boolean createdAccount, boolean linkedExisting) {
    }

    @Transactional
    public Resolved resolve(InstituteSsoConnection connection, SsoClaims claims) {
        String instituteId = connection.getInstituteId();
        String issuer = OidcProviderClient.normaliseIssuer(connection.getIssuer());
        Optional<UserSsoIdentity> known = identityRepository.findByConnectionIdAndIssuerAndSubject(
                connection.getId(), issuer, claims.subject());
        if (known.isPresent()) {
            UserSsoIdentity identity = known.get();
            Optional<User> user = userRepository.findById(identity.getUserId());
            if (user.isPresent()) {
                ensureLearnerRole(user.get(), instituteId, connection.getId());
                refreshProfile(user.get(), claims);
                return new Resolved(user.get(), identity, false, false);
            }
            log.warn("SSO identity {} points at a missing user {}; relinking", identity.getId(), identity.getUserId());
            identityRepository.delete(identity);
            identityRepository.flush();
        }

        User user = null;
        boolean linked = false;
        String linkable = linkableExistingUser(connection, claims);
        if (linkable != null) {
            user = userRepository.findById(linkable).orElse(null);
            linked = user != null;
        }
        boolean created = false;
        if (user == null) {
            user = createAccount(connection, claims);
            created = true;
        }
        ensureLearnerRole(user, instituteId, connection.getId());
        if (linked) {
            refreshProfile(user, claims);
        }
        UserSsoIdentity identity = identityRepository.save(UserSsoIdentity.builder()
                .connectionId(connection.getId())
                .instituteId(instituteId)
                .issuer(issuer)
                .subject(claims.subject())
                .userId(user.getId())
                .email(claims.email())
                .updatedAt(new Date())
                .build());
        log.info("SSO {} user {} for institute {} (connection {})", created ? "created" : "linked",
                user.getId(), instituteId, connection.getId());
        return new Resolved(user, identity, created, linked);
    }

    /** The one existing account this sign-in may take over by email, or null. */
    String linkableExistingUser(InstituteSsoConnection connection, SsoClaims claims) {
        if (!StringUtils.hasText(claims.email())) {
            return null;
        }
        boolean vouched = Boolean.TRUE.equals(claims.emailVerified())
                || (claims.emailVerified() == null && connection.isTrustProviderEmail());
        if (!vouched || !SsoEmailDomains.covers(SsoEmailDomains.parse(connection.getEmailDomains()), claims.email())) {
            return null;
        }
        String found = null;
        for (String userId : identityRepository.findUserIdsByEmail(claims.email().toLowerCase(Locale.ROOT))) {
            if (!isPlainLearnerOnlyOf(userId, connection.getInstituteId())) {
                continue;
            }
            if (identityRepository.existsByConnectionIdAndUserId(connection.getId(), userId)) {
                continue; // already belongs to another person at this provider
            }
            if (found != null) {
                log.info("SSO: several learner accounts in institute {} share {}; creating a new one",
                        connection.getInstituteId(), claims.email());
                return null;
            }
            found = userId;
        }
        return found;
    }

    /** Learner role rows only, all in this institute, and not platform staff. */
    boolean isPlainLearnerOnlyOf(String userId, String instituteId) {
        if (SuperAdminAuthUtil.isSuperAdminUserId(userId)) {
            return false;
        }
        List<Object[]> rows = identityRepository.findRoleRowsOfUser(userId);
        if (rows.isEmpty()) {
            return false;
        }
        for (Object[] row : rows) {
            String rowInstitute = row[0] == null ? null : row[0].toString();
            String roleName = row[1] == null ? null : row[1].toString();
            String status = row[2] == null ? null : row[2].toString();
            if (!instituteId.equals(rowInstitute) || !STUDENT.equalsIgnoreCase(roleName)) {
                return false;
            }
            if (UserRoleStatus.DISABLED.name().equalsIgnoreCase(status)) {
                return false;
            }
        }
        return true;
    }

    /**
     * Refuses the sign-in unless the account is a plain learner of this institute and nowhere
     * else. The token minted afterwards carries every role the account holds, so an account that
     * later gained a role in another institute (or a staff role) must not be reachable through
     * one institute's provider.
     *
     * @throws SsoFailure account_conflict
     */
    public void assertOnlyLearnerHere(User user, String instituteId) {
        if (!isPlainLearnerOnlyOf(user.getId(), instituteId)) {
            throw new SsoFailure("account_conflict",
                    "This account also has access outside this institute, so it cannot use this institute's sign-in");
        }
    }

    /**
     * A new account for this institute. Accounts elsewhere are found by email (newest first), so
     * the email goes on the account only when the provider vouched for it and no other account
     * already uses it; otherwise the account has no email and the address lives on the identity
     * and the institute's learner record. The phone never goes on the account (unverified).
     */
    private User createAccount(InstituteSsoConnection connection, SsoClaims claims) {
        String base = claims.email() != null ? claims.email().substring(0, claims.email().indexOf('@'))
                : UsernameGenerator.generateUsername(claims.fullName());
        base = base.replaceAll("[^A-Za-z0-9._-]", "");
        if (base.length() < 3) {
            base = UsernameGenerator.generateUsername(claims.fullName());
        }
        boolean vouched = Boolean.TRUE.equals(claims.emailVerified())
                || (claims.emailVerified() == null && connection.isTrustProviderEmail());
        boolean emailFree = claims.email() != null
                && identityRepository.findUserIdsByEmail(claims.email().toLowerCase(Locale.ROOT)).isEmpty();
        User user = User.builder()
                .fullName(claims.fullName())
                .username(uniqueUsername(base.toLowerCase(Locale.ROOT)))
                .email(vouched && emailFree ? claims.email() : null)
                .password(UsernameGenerator.generatePassword(12))
                .isRootUser(true)
                .build();
        return userRepository.save(user);
    }

    private String uniqueUsername(String wanted) {
        if (userRepository.findByUsername(wanted).isEmpty()) {
            return wanted;
        }
        for (int attempt = 0; attempt < 10; attempt++) {
            String candidate = wanted + "_" + UsernameGenerator.randomSuffix(4);
            if (userRepository.findByUsername(candidate).isEmpty()) {
                return candidate;
            }
        }
        return wanted + "_" + UUID.randomUUID().toString().replace("-", "").substring(0, 8);
    }

    /**
     * Gives the user an ACTIVE learner role here, unless the institute switched them off.
     *
     * @throws SsoFailure account_disabled when the institute disabled or deleted the learner
     */
    void ensureLearnerRole(User user, String instituteId, String connectionId) {
        boolean hasActive = false;
        boolean switchedOff = false;
        for (Object[] row : identityRepository.findRoleRowsOfUser(user.getId())) {
            if (!instituteId.equals(row[0] == null ? null : row[0].toString())
                    || !STUDENT.equalsIgnoreCase(row[1] == null ? null : row[1].toString())) {
                continue;
            }
            String status = row[2] == null ? "" : row[2].toString();
            if (UserRoleStatus.ACTIVE.name().equalsIgnoreCase(status)) {
                hasActive = true;
            } else if (UserRoleStatus.DISABLED.name().equalsIgnoreCase(status)
                    || UserRoleStatus.DELETED.name().equalsIgnoreCase(status)) {
                switchedOff = true;
            }
        }
        if (hasActive) {
            return;
        }
        if (switchedOff) {
            throw new SsoFailure("account_disabled", "This learner was deactivated by the institute");
        }
        Role student = studentRole();
        UserRole role = new UserRole();
        role.setUser(user);
        role.setRole(student);
        role.setInstituteId(instituteId);
        role.setStatus(UserRoleStatus.ACTIVE.name());
        role.setSourceType(SOURCE_TYPE);
        role.setSourceId(connectionId);
        userRoleRepository.save(role);
    }

    private Role studentRole() {
        List<Role> roles = roleRepository.findByNameIn(List.of(STUDENT));
        return roles.stream().filter(r -> r.getInstituteId() == null).findFirst()
                .orElseGet(() -> roles.stream().findFirst()
                        .orElseThrow(() -> new IllegalStateException("STUDENT role missing")));
    }

    /**
     * The name follows the provider. Email and phone do not: other sign-in methods find accounts
     * by them, so they are never taken from a provider onto a shared account.
     */
    private void refreshProfile(User user, SsoClaims claims) {
        if (StringUtils.hasText(claims.fullName()) && !claims.fullName().equals(user.getFullName())) {
            user.setFullName(claims.fullName());
            userRepository.save(user);
        }
    }

    /** Digits of a phone number, or null when too short to be one. */
    static String digitsOrNull(String phone) {
        if (phone == null) {
            return null;
        }
        String digits = phone.replaceAll("[^0-9]", "");
        return digits.length() < 6 ? null : digits;
    }
}
