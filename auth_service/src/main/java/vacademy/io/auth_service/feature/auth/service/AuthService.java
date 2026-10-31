package vacademy.io.auth_service.feature.auth.service;

import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpMethod;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;
import org.springframework.web.client.RestTemplate;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import vacademy.io.auth_service.feature.admin_core_service.dto.InstituteSignupPolicy;
import vacademy.io.auth_service.feature.admin_core_service.service.InstitutePolicyService;
import vacademy.io.auth_service.feature.auth.dto.JwtResponseDto;
import vacademy.io.auth_service.feature.auth.dto.RegisterRequest;
import vacademy.io.auth_service.feature.institute.InstituteInfoDTO;
import vacademy.io.auth_service.feature.institute.InstituteInternalService;
import vacademy.io.auth_service.feature.institute.service.InstituteSettingsService;
import vacademy.io.auth_service.feature.notification.constants.NotificationConstant;
import vacademy.io.auth_service.feature.notification.service.NotificationEmailBody;
import vacademy.io.auth_service.feature.notification.service.NotificationService;
import vacademy.io.auth_service.feature.user.repository.PermissionRepository;
import vacademy.io.auth_service.feature.util.UsernameGenerator;
import vacademy.io.common.auth.dto.BackfillCreatedPairDTO;
import vacademy.io.common.auth.dto.BackfillParentItemDTO;
import vacademy.io.common.auth.dto.BackfillParentsResultDTO;
import vacademy.io.common.auth.dto.UserDTO;
import vacademy.io.common.auth.entity.*;
import vacademy.io.common.auth.enums.UserRoleStatus;
import vacademy.io.common.auth.repository.RoleRepository;
import vacademy.io.common.auth.repository.UserPermissionRepository;
import vacademy.io.common.auth.repository.UserRepository;
import vacademy.io.common.core.utils.TextSanitizer;
import vacademy.io.common.auth.repository.UserRoleRepository;
import vacademy.io.common.auth.service.JwtService;
import vacademy.io.common.auth.service.RefreshTokenService;
import vacademy.io.common.core.internal_api_wrapper.InternalClientUtils;
import vacademy.io.common.exceptions.VacademyException;
import vacademy.io.common.notification.dto.GenericEmailRequest;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

@Service
@Slf4j
public class AuthService {
    @Autowired
    UserRepository userRepository;
    @Autowired
    JwtService jwtService;
    @Autowired
    RefreshTokenService refreshTokenService;
    @Autowired
    RestTemplate restTemplate;
    @Autowired
    RoleRepository roleRepository;
    @Autowired
    PermissionRepository permissionRepository;
    @Value("${admin.core.service.base_url}")
    private String adminCoreServiceBaseUrl;
    @Autowired
    private NotificationService notificationService;
    @Autowired
    private UserPermissionRepository userPermissionRepository;
    @Autowired
    private UserRoleRepository userRoleRepository;
    @Autowired
    private InstituteInternalService instituteInternalService;
    @Autowired
    private InstituteSettingsService instituteSettingsService;
    @Autowired
    private InstitutePolicyService institutePolicyService;
    @Value("${default.learner.portal.url}")
    private String defaultLearnerPortalUrl;

    private static final String STUDENT_ROLE = "STUDENT";

    /**
     * Whether the credential email being composed is going to a learner, which decides between the
     * learner portal and the admin portal for its "Access Your Account" link.
     *
     * <p>Scanning only {@code rolesBeingAdded} is not enough: that set holds the roles this call is
     * <em>adding</em>, and for a user who is already enrolled in the institute every role is skipped
     * as a duplicate, leaving it empty. A learner re-enrolling — or getting their credentials after
     * a payment confirms — was then classed as staff and emailed the admin portal. Only that
     * no-signal case consults the roles the user already holds; a non-empty set is still trusted as
     * given, so inviting someone as staff keeps linking the admin portal even if they also study here.
     */
    private boolean isLearnerRecipient(User user, String instituteId, Set<UserRole> rolesBeingAdded) {
        if (rolesBeingAdded != null && !rolesBeingAdded.isEmpty()) {
            for (UserRole userRole : rolesBeingAdded) {
                if (userRole.getRole() != null && STUDENT_ROLE.equals(userRole.getRole().getName())) {
                    return true;
                }
            }
            return false;
        }
        if (user == null || !StringUtils.hasText(user.getId()) || !StringUtils.hasText(instituteId)) {
            return false;
        }
        return userRoleRepository.existsByUserIdAndInstituteIdAndRoleName(user.getId(), instituteId, STUDENT_ROLE);
    }

    /**
     * Makes a configured portal URL safe to drop straight into an email href.
     *
     * <p>Two shapes arrive broken. Institutes store the portal as a bare host
     * ({@code learner.shikshanation.com}) far more often than as a full origin, and a schemeless
     * href is a <em>relative</em> link — mail clients resolve it against their own domain, so the
     * button goes nowhere. And a URL that reached us percent-encoded (an over-encoded
     * {@code loginUrl} query param) must be decoded before it is linked, or the href reads
     * {@code https%3A%2F%2F…}.
     */
    private String normalizePortalUrl(String url) {
        if (!StringUtils.hasText(url)) {
            return url;
        }
        String normalized = url.trim();
        // Only decode when the encoding is the scheme separator itself — a genuine URL never has one.
        if (normalized.toLowerCase().contains("%3a%2f%2f")) {
            try {
                normalized = java.net.URLDecoder.decode(normalized, java.nio.charset.StandardCharsets.UTF_8).trim();
            } catch (Exception e) {
                log.warn("Could not decode over-encoded portal URL '{}': {}", url, e.getMessage());
            }
        }
        if (!normalized.toLowerCase().startsWith("http://") && !normalized.toLowerCase().startsWith("https://")) {
            normalized = "https://" + normalized;
        }
        while (normalized.endsWith("/")) {
            normalized = normalized.substring(0, normalized.length() - 1);
        }
        return normalized;
    }

    @Transactional
    public User createUser(RegisterRequest registerRequest, Set<UserRole> roles) {
        boolean isAlreadyPresent = false;
        // cleanIdentifier() first: an email pasted with an invisible character (ZWSP,
        // BOM, NBSP) would otherwise be stored verbatim AND used as the dedupe key,
        // so the account is created unfindable and the learner can never log in.
        // The User entity repeats this on persist; doing it here keeps the lookup
        // below matching what actually gets written.
        String normalizedEmail = TextSanitizer.cleanIdentifier(registerRequest.getEmail());
        normalizedEmail = normalizedEmail != null ? normalizedEmail.toLowerCase() : null;
        registerRequest.setEmail(normalizedEmail);
        registerRequest.setFullName(TextSanitizer.clean(registerRequest.getFullName()));
        Optional<User> optionalUser = userRepository.findFirstByEmailOrderByCreatedAtDesc(normalizedEmail);
        User user;
        if (optionalUser.isPresent()) {
            isAlreadyPresent = true;
            user = optionalUser.get();
        } else {
            user = User.builder()
                    .fullName(registerRequest.getFullName())
                    .username(registerRequest.getUserName())
                    .email(normalizedEmail)
                    .password(registerRequest.getPassword())
                    .isRootUser(true)
                    .build();
            user = userRepository.save(user); // Save first to get the ID
        }
        // Assign the user to each UserRole
        for (UserRole role : roles) {
            role.setUser(user);
        }
        user.setRoles(roles); // Now set the roles
        user = userRepository.save(user); // Save again with roles
        if (isAlreadyPresent) {
            sendKeepingCredentialsWelcomeMailToUser(user, registerRequest.getInstitute().getId(), roles);
        } else {
            sendWelcomeMailToUser(user, registerRequest.getInstitute().getId(), roles);
        }
        return user;
    }

    @Transactional
    public User createUser(UserDTO registerRequest, String instituteId, boolean sendWelcomeMail) {
        // cleanIdentifier() first: an email pasted with an invisible character (ZWSP,
        // BOM, NBSP) would otherwise be stored verbatim AND used as the dedupe key,
        // so the account is created unfindable and the learner can never log in.
        // The User entity repeats this on persist; doing it here keeps the lookup
        // below matching what actually gets written.
        String normalizedEmail = TextSanitizer.cleanIdentifier(registerRequest.getEmail());
        normalizedEmail = normalizedEmail != null ? normalizedEmail.toLowerCase() : null;
        registerRequest.setEmail(normalizedEmail);
        registerRequest.setUsername(TextSanitizer.cleanIdentifier(registerRequest.getUsername()));
        registerRequest.setFullName(TextSanitizer.clean(registerRequest.getFullName()));
        Optional<User> optionalUser = Optional.empty();

        if (StringUtils.hasText(registerRequest.getMobileNumber())) {
            registerRequest.setMobileNumber(registerRequest.getMobileNumber().replaceAll("[^0-9]", ""));
        }

        String userIdentifier = instituteSettingsService.getUserIdentifier(instituteId);

        // Bug 3 fix: when PHONE is the identifier, use phone as the sole lookup key —
        // do NOT fall back to email/username, which would silently merge unrelated users.
        boolean usePhoneAsIdentifier = "PHONE".equalsIgnoreCase(userIdentifier)
                && StringUtils.hasText(registerRequest.getMobileNumber());

        if (usePhoneAsIdentifier) {
            // Prefer the account that ALREADY belongs to this institute, exactly as phone
            // login does (AuthManager ~L731). A number routinely fronts several accounts —
            // at SuchBliss one number has fourteen — and resolving blind-latest here sent the
            // enrolment to an account the learner was not signed into: login picked the one
            // holding a role here, enrolment created the plan on the newest one, and the
            // learner's own dashboard stayed empty while their membership lived elsewhere.
            // Identity resolution has to agree between logging in and enrolling, or the two
            // halves of the same person drift apart.
            if (StringUtils.hasText(instituteId)) {
                optionalUser = userRepository.findLatestUserByMobileNumberAndInstitute(
                        registerRequest.getMobileNumber(), instituteId);
            }
            if (optionalUser.isEmpty()) {
                optionalUser = userRepository.findLatestUserByMobileNumber(registerRequest.getMobileNumber());
            }
        }

        if (!usePhoneAsIdentifier && optionalUser.isEmpty() && StringUtils.hasText(normalizedEmail)) {
            optionalUser = userRepository.findFirstByEmailOrderByCreatedAtDesc(normalizedEmail);
        }

        if (!usePhoneAsIdentifier && optionalUser.isEmpty() && StringUtils.hasText(registerRequest.getUsername())) {
            optionalUser = userRepository.findByUsername(registerRequest.getUsername());
        }

        boolean isAlreadyPresent = optionalUser.isPresent();
        User user;
        if (isAlreadyPresent) {
            user = optionalUser.get();
            // Bug 2 fix: only fill in fields the existing user does not already have —
            // never clobber existing profile data with new registration input.
            if (StringUtils.hasText(normalizedEmail) && !StringUtils.hasText(user.getEmail()))
                user.setEmail(normalizedEmail);
            if (StringUtils.hasText(registerRequest.getFullName()) && !StringUtils.hasText(user.getFullName()))
                user.setFullName(registerRequest.getFullName());
            if (StringUtils.hasText(registerRequest.getAddressLine()) && !StringUtils.hasText(user.getAddressLine()))
                user.setAddressLine(registerRequest.getAddressLine());
            if (StringUtils.hasText(registerRequest.getCity()) && !StringUtils.hasText(user.getCity()))
                user.setCity(registerRequest.getCity());
            if (StringUtils.hasText(registerRequest.getPinCode()) && !StringUtils.hasText(user.getPinCode()))
                user.setPinCode(registerRequest.getPinCode());
            if (StringUtils.hasText(registerRequest.getMobileNumber()) && !StringUtils.hasText(user.getMobileNumber()))
                user.setMobileNumber(registerRequest.getMobileNumber());
            if (registerRequest.getDateOfBirth() != null && user.getDateOfBirth() == null)
                user.setDateOfBirth(registerRequest.getDateOfBirth());
            if (StringUtils.hasText(registerRequest.getGender()) && !StringUtils.hasText(user.getGender()))
                user.setGender(registerRequest.getGender());
            if (StringUtils.hasText(registerRequest.getProfilePicFileId()) && !StringUtils.hasText(user.getProfilePicFileId()))
                user.setProfilePicFileId(registerRequest.getProfilePicFileId());
            if (StringUtils.hasText(registerRequest.getLinkedParentId()) && !StringUtils.hasText(user.getLinkedParentId()))
                user.setLinkedParentId(registerRequest.getLinkedParentId());
            if (!user.isRootUser())
                user.setRootUser(true);
            user = userRepository.save(user);
        } else {
            String fromStrategy = usernameFromInstituteStrategy(registerRequest, instituteId, false);
            if (fromStrategy != null) {
                registerRequest.setUsername(ensureUniqueUsername(fromStrategy));
            }
            if (!StringUtils.hasText(registerRequest.getUsername())) {
                // A generated name can collide with an existing one; that used to fail
                // the whole enrollment on the unique constraint.
                registerRequest.setUsername(ensureUniqueUsername(
                        UsernameGenerator.generateUsername(registerRequest.getFullName())));
            }
            if (!StringUtils.hasText(registerRequest.getPassword())) {
                registerRequest.setPassword(UsernameGenerator.generatePassword(8));
            }
            user = User.builder()
                    .fullName(registerRequest.getFullName())
                    .username(registerRequest.getUsername())
                    .email(normalizedEmail)
                    .password(registerRequest.getPassword())
                    .addressLine(registerRequest.getAddressLine())
                    .city(registerRequest.getCity())
                    .pinCode(registerRequest.getPinCode())
                    .mobileNumber(registerRequest.getMobileNumber())
                    .dateOfBirth(registerRequest.getDateOfBirth())
                    .gender(registerRequest.getGender())
                    .profilePicFileId(registerRequest.getProfilePicFileId())
                    .linkedParentId(registerRequest.getLinkedParentId())
                    .isRootUser(true)
                    .build();
            user = userRepository.save(user);
        }
        List<Role> allRoles = getAllUserRoles(registerRequest.getRoles());
        Set<UserRole> userRoleSet = new HashSet<>();
        for (Role role : allRoles) {
            // Bug 4 fix: for existing users, skip roles that are already active to prevent
            // duplicate user_role rows (orphanRemoval=false means old rows are never deleted).
            if (isAlreadyPresent && userRoleRepository.existsByUserIdAndInstituteIdAndRoleName(user.getId(), instituteId, role.getName())) {
                continue;
            }
            UserRole userRole = new UserRole();
            userRole.setRole(role);
            userRole.setStatus(UserRoleStatus.ACTIVE.name());
            userRole.setInstituteId(instituteId);
            userRole.setUser(user);
            userRoleSet.add(userRole);
        }
        if (isAlreadyPresent) {
            // Save only the new roles directly; do not replace the existing collection.
            userRoleRepository.saveAll(userRoleSet);
        } else {
            user.setRoles(userRoleSet);
            user = userRepository.save(user);
        }
        if (sendWelcomeMail) {
            if (isAlreadyPresent) {
                sendKeepingCredentialsWelcomeMailToUser(user, instituteId, userRoleSet);
            } else {
                sendWelcomeMailToUser(user, instituteId, userRoleSet);
            }
        }
        return user;
    }

    /**
     * Username is the last dedupe key. A hit there is only the same person when nothing
     * on record says otherwise: generated usernames (4 letters + 4 characters) collide,
     * and learner signup sends the email prefix, so "john" from john@yahoo.com used to
     * land on the account of john@gmail.com. Refuse the match only on positive evidence —
     * both sides carry an email and they differ, or both carry a phone and they differ —
     * so an account that has no email yet still matches as before.
     */
    private Optional<User> findSamePersonByUsername(UserDTO registerRequest, String normalizedEmail) {
        String mobile = registerRequest.getMobileNumber();
        return userRepository.findByUsername(registerRequest.getUsername())
                .filter(existing -> !(StringUtils.hasText(normalizedEmail)
                        && StringUtils.hasText(existing.getEmail())
                        && !existing.getEmail().trim().equalsIgnoreCase(normalizedEmail)))
                .filter(existing -> {
                    String wanted = lastTenDigits(mobile);
                    String onRecord = lastTenDigits(existing.getMobileNumber());
                    return wanted.isEmpty() || onRecord.isEmpty() || wanted.equals(onRecord);
                });
    }

    // Stored numbers mix "+91 98765 43210", "919876543210" and "9876543210" for one phone.
    private static String lastTenDigits(String number) {
        String digits = number == null ? "" : number.replaceAll("[^0-9]", "");
        return digits.length() > 10 ? digits.substring(digits.length() - 10) : digits;
    }

    /**
     * Username for a NEW user taken from the institute's username strategy
     * (STUDENT_DISPLAY_SETTINGS.signup), or null to keep today's behaviour.
     *
     * <ul>
     *   <li>Learner signup: only the newer strategies (phone, customField) act here.
     *       "email" is already applied by LearnerAuthManager; random/manual are handled
     *       by the signup page itself.</li>
     *   <li>Everything else (admin add, CSV, invites, payments, forms): only when the
     *       institute switched on usernameApplyToAll, and not over a username an
     *       admin typed by hand unless usernameOverrideTyped is also on.</li>
     * </ul>
     * A missing value (no phone, field not filled) falls back to the old username.
     */
    private String usernameFromInstituteStrategy(UserDTO request, String instituteId, boolean selfSignup) {
        if (!StringUtils.hasText(instituteId) || !isLearnerRequest(request.getRoles())) {
            return null;
        }
        InstituteSignupPolicy policy;
        try {
            policy = institutePolicyService.fetchSignupPolicyCached(instituteId);
        } catch (Exception e) {
            log.warn("Username strategy lookup failed for institute {}: {}", instituteId, e.getMessage());
            return null;
        }
        if (policy == null || !StringUtils.hasText(policy.getUserNameStrategy())) {
            return null;
        }
        String strategy = policy.getUserNameStrategy().trim();
        boolean valueStrategy = "phone".equalsIgnoreCase(strategy) || "customField".equalsIgnoreCase(strategy);
        if (selfSignup ? !valueStrategy : !policy.isUsernameApplyToAll()) {
            return null;
        }
        if (Boolean.TRUE.equals(request.getUsernameExplicit())
                && (!policy.isUsernameOverrideTyped() || "random".equalsIgnoreCase(strategy))) {
            return null;
        }

        String raw;
        if ("email".equalsIgnoreCase(strategy)) {
            raw = request.getEmail();
        } else if ("phone".equalsIgnoreCase(strategy)) {
            raw = request.getMobileNumber();
        } else if ("customField".equalsIgnoreCase(strategy)) {
            Map<String, String> values = request.getUsernameFieldValues();
            raw = values == null || !StringUtils.hasText(policy.getUsernameCustomFieldId())
                    ? null : values.get(policy.getUsernameCustomFieldId());
        } else if ("random".equalsIgnoreCase(strategy)) {
            raw = UsernameGenerator.generateUsername(request.getFullName());
        } else {
            return null; // manual: nothing to derive
        }

        String username = toUsernameValue(raw);
        if (username.isEmpty()) {
            return null;
        }
        if (valueStrategy && StringUtils.hasText(policy.getUsernamePrefix())) {
            // Keep the prefix's own trailing separator ("TTS-" → "tts-").
            String prefix = toUsernameValue(policy.getUsernamePrefix() + "x");
            username = prefix.substring(0, prefix.length() - 1) + username;
        }
        return username;
    }

    // The same create calls also make staff (FacultyService sends TEACHER / ADMIN) and
    // parents; the learner username strategy must leave those alone. Learner flows send
    // STUDENT, or no roles at all (the paid invite form).
    private static boolean isLearnerRequest(List<String> roles) {
        return roles == null || roles.isEmpty()
                || roles.stream().anyMatch(STUDENT_ROLE::equalsIgnoreCase);
    }

    // Lowercase, no spaces, and only characters that survive in a login form and in
    // the /live-class/<username> link: letters and digits in any script plus . _ @ + -
    private static String toUsernameValue(String raw) {
        String cleaned = TextSanitizer.cleanIdentifier(raw);
        if (!StringUtils.hasText(cleaned)) {
            return "";
        }
        return cleaned.toLowerCase()
                .replaceAll("\\s+", "")
                .replaceAll("[^\\p{L}\\p{N}._@+-]", "-")
                .replaceAll("-{2,}", "-")
                .replaceAll("^-|-$", "");
    }

    /**
     * users.username is unique across every institute. When the wanted name is already
     * taken by someone else, keep it readable and add a short suffix instead of failing
     * the enrollment on the constraint.
     */
    private String ensureUniqueUsername(String wanted) {
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

    private List<Role> getAllUserRoles(List<String> userRoles) {
        return roleRepository.findByNameIn(userRoles);
    }

    public JwtResponseDto generateJwtTokenForUser(User user, RefreshToken refreshToken, List<UserRole> userRoles) {
        List<String> userPermissions = userPermissionRepository.findByUserId(user.getId()).stream()
                .map(UserPermission::getPermissionId).toList();
        String accessToken = jwtService.generateToken(user, userRoles, userPermissions);
        // Return a JwtResponseDto with access token and refresh token
        return JwtResponseDto.builder()
                .accessToken(accessToken)
                .refreshToken(refreshToken.getToken())
                .build();
    }

    public void sendWelcomeMailToUser(User user, String instituteId, Set<UserRole> roles) {
        InstituteInfoDTO instituteInfoDTO = null;
        boolean isLearner = isLearnerRecipient(user, instituteId, roles);
        String instituteName = "Vacademy"; // Default fallback
        String theme = "#E67E22";
        String loginUrl = "https://dash.vacademy.io";
        if (StringUtils.hasText(instituteId)) {
            instituteInfoDTO = instituteInternalService.getInstituteByInstituteId(instituteId);
            if (instituteInfoDTO.getInstituteName() != null)
                instituteName = instituteInfoDTO.getInstituteName();
            if (instituteInfoDTO.getInstituteThemeCode() != null)
                theme = instituteInfoDTO.getInstituteThemeCode();
            if (isLearner) {
                // hasText, not != null: two institutes store the column as "" and a bare null-check
                // let that through, emailing learners an empty href instead of the platform default.
                if (StringUtils.hasText(instituteInfoDTO.getLearnerPortalUrl()))
                    loginUrl = instituteInfoDTO.getLearnerPortalUrl();
                else
                    loginUrl = defaultLearnerPortalUrl;
            } else if (StringUtils.hasText(instituteInfoDTO.getAdminPortalUrl())) {
                loginUrl = instituteInfoDTO.getAdminPortalUrl();
            }
        }
        GenericEmailRequest genericEmailRequest = new GenericEmailRequest();
        genericEmailRequest.setTo(user.getEmail());
        genericEmailRequest.setBody(NotificationEmailBody.createWelcomeEmailBody(instituteName, user.getFullName(),
                user.getUsername(), user.getPassword(), normalizePortalUrl(loginUrl), theme));
        genericEmailRequest.setSubject("Welcome to " + instituteName);
        notificationService.sendGenericHtmlMailViaUnified(genericEmailRequest, instituteId);
    }

    public void sendKeepingCredentialsWelcomeMailToUser(User user, String instituteId, Set<UserRole> roles) {
        if (user == null || user.getEmail() == null) {
            throw new IllegalArgumentException("User or user email must not be null");
        }
        InstituteInfoDTO instituteInfoDTO = null;
        boolean isLearner = isLearnerRecipient(user, instituteId, roles);
        String instituteName = "Vacademy"; // Default fallback
        String theme = "#E67E22";
        String loginUrl = "https://dash.vacademy.io";
        if (StringUtils.hasText(instituteId)) {
            instituteInfoDTO = instituteInternalService.getInstituteByInstituteId(instituteId);
            if (instituteInfoDTO.getInstituteName() != null)
                instituteName = instituteInfoDTO.getInstituteName();
            if (instituteInfoDTO.getInstituteThemeCode() != null)
                theme = instituteInfoDTO.getInstituteThemeCode();
            if (isLearner) {
                // hasText, not != null: two institutes store the column as "" and a bare null-check
                // let that through, emailing learners an empty href instead of the platform default.
                if (StringUtils.hasText(instituteInfoDTO.getLearnerPortalUrl()))
                    loginUrl = instituteInfoDTO.getLearnerPortalUrl();
                else
                    loginUrl = defaultLearnerPortalUrl;
            } else if (StringUtils.hasText(instituteInfoDTO.getAdminPortalUrl())) {
                loginUrl = instituteInfoDTO.getAdminPortalUrl();
            }
        }
        String fullName = user.getFullName() != null ? user.getFullName() : "User";
        String username = user.getUsername() != null ? user.getUsername() : "N/A";
        String password = user.getPassword() != null ? user.getPassword() : "N/A"; // You might want to avoid sending
        // passwords in email
        String body = NotificationEmailBody.createCredentialsFoundEmailBody(
                instituteName,
                fullName,
                username,
                password,
                normalizePortalUrl(loginUrl),
                theme);
        GenericEmailRequest emailRequest = new GenericEmailRequest();
        emailRequest.setTo(user.getEmail());
        emailRequest.setSubject("Welcome to " + instituteName);
        emailRequest.setBody(body);
        notificationService.sendGenericHtmlMailViaUnified(emailRequest, instituteId);
    }

    @Transactional
    public List<UserDTO> createMultipleUsers(List<UserDTO> userDTOs, String instituteId, boolean isNotify) {
        if (userDTOs == null || userDTOs.isEmpty()) {
            throw new IllegalArgumentException("User DTOs list cannot be null or empty");
        }

        if (userDTOs.size() != 2) {
            throw new IllegalArgumentException("Expected exactly 2 users (parent and child)");
        }

        UserDTO parentDTO = userDTOs.get(0);
        UserDTO childDTO = userDTOs.get(1);

        User parentUser = createUser(parentDTO, instituteId, isNotify);
        parentUser.setIsParent(true);
        parentUser = userRepository.save(parentUser);

        User childUser = createUser(childDTO, instituteId, isNotify);
        childUser.setLinkedParentId(parentUser.getId());
        childUser = userRepository.save(childUser);

        UserDTO parentResponseDTO = convertToUserDto(parentUser);
        parentResponseDTO.setPassword(parentUser.getPassword());
        UserDTO childResponseDTO = convertToUserDto(childUser);
        childResponseDTO.setPassword(childUser.getPassword());

        return List.of(parentResponseDTO, childResponseDTO);
    }

    private UserDTO convertToUserDto(User user) {
        UserDTO childResponseDTO = new UserDTO();
        childResponseDTO.setId(user.getId());
        childResponseDTO.setFullName(user.getFullName());
        childResponseDTO.setEmail(user.getEmail());
        childResponseDTO.setUsername(user.getUsername());
        childResponseDTO.setMobileNumber(user.getMobileNumber());
        childResponseDTO.setAddressLine(user.getAddressLine());
        childResponseDTO.setCity(user.getCity());
        childResponseDTO.setPinCode(user.getPinCode());
        childResponseDTO.setGender(user.getGender());
        childResponseDTO.setDateOfBirth(user.getDateOfBirth());
        childResponseDTO.setProfilePicFileId(user.getProfilePicFileId());
        childResponseDTO.setIsParent(user.getIsParent());
        childResponseDTO.setLinkedParentId(user.getLinkedParentId());
        return childResponseDTO;

    }

    /**
     * Finds the latest user by mobile number, handling various formats.
     * Supports: +917999742868, 7999742868, 917999742868, or any country code.
     * 
     * @param mobileNumber the phone number in any format
     * @return Optional containing UserDTO if found, empty otherwise
     */
    public Optional<UserDTO> getUserByMobileNumber(String mobileNumber) {
        if (mobileNumber == null || mobileNumber.trim().isEmpty()) {
            return Optional.empty();
        }

        // Remove all non-digit characters
        String digitsOnly = mobileNumber.replaceAll("[^0-9]", "");

        if (digitsOnly.isEmpty()) {
            return Optional.empty();
        }

        Optional<User> userOpt = userRepository.findLatestUserByMobileNumber(digitsOnly);
        return userOpt.map(this::convertToUserDto);
    }

    /**
     * Creates a user for learner enrollment with specialized email templates.
     * Uses different templates than the regular createUser method.
     */
    @Transactional
    public User createUserForLearnerEnrollment(UserDTO registerRequest, String instituteId, boolean sendWelcomeMail) {
        return createUserForLearnerEnrollment(registerRequest, instituteId, sendWelcomeMail, null);
    }

    @Transactional
    public User createUserForLearnerEnrollment(UserDTO registerRequest, String instituteId, boolean sendWelcomeMail, String overrideLoginUrl) {
        return createUserForLearnerEnrollment(registerRequest, instituteId, sendWelcomeMail, overrideLoginUrl, false);
    }

    /**
     * Public learner signup (POST /learner/v1/register). The username here is the
     * learner's own email prefix, a generated name or whatever they typed — never a
     * reference to an account the caller is entitled to — so a username hit is only
     * accepted when nothing on record contradicts it, and a taken name gets a suffix.
     * Admin and internal callers keep the plain username match: they pass a known
     * learner's username on purpose (re-enroll, CSV by username).
     */
    @Transactional
    public User createUserForLearnerSelfSignup(UserDTO registerRequest, String instituteId, boolean sendWelcomeMail) {
        return createUserForLearnerEnrollment(registerRequest, instituteId, sendWelcomeMail, null, true);
    }

    private User createUserForLearnerEnrollment(UserDTO registerRequest, String instituteId, boolean sendWelcomeMail,
                                                String overrideLoginUrl, boolean selfSignup) {
        boolean callerChoseUsername = StringUtils.hasText(registerRequest.getUsername());
        // cleanIdentifier() first: an email pasted with an invisible character (ZWSP,
        // BOM, NBSP) would otherwise be stored verbatim AND used as the dedupe key,
        // so the account is created unfindable and the learner can never log in.
        // The User entity repeats this on persist; doing it here keeps the lookup
        // below matching what actually gets written.
        String normalizedEmail = TextSanitizer.cleanIdentifier(registerRequest.getEmail());
        normalizedEmail = normalizedEmail != null ? normalizedEmail.toLowerCase() : null;
        registerRequest.setEmail(normalizedEmail);
        registerRequest.setUsername(TextSanitizer.cleanIdentifier(registerRequest.getUsername()));
        registerRequest.setFullName(TextSanitizer.clean(registerRequest.getFullName()));
        Optional<User> optionalUser = Optional.empty();

        if (StringUtils.hasText(registerRequest.getMobileNumber())) {
            registerRequest.setMobileNumber(registerRequest.getMobileNumber().replaceAll("[^0-9]", ""));
        }

        String userIdentifier = instituteSettingsService.getUserIdentifier(instituteId);

        // Bug 3 fix: when PHONE is the identifier, use phone as the sole lookup key —
        // do NOT fall back to email/username, which would silently merge unrelated users.
        boolean usePhoneAsIdentifier = "PHONE".equalsIgnoreCase(userIdentifier)
                && StringUtils.hasText(registerRequest.getMobileNumber());

        if (usePhoneAsIdentifier) {
            // Prefer the account that ALREADY belongs to this institute, exactly as phone
            // login does (AuthManager ~L731). A number routinely fronts several accounts —
            // at SuchBliss one number has fourteen — and resolving blind-latest here sent the
            // enrolment to an account the learner was not signed into: login picked the one
            // holding a role here, enrolment created the plan on the newest one, and the
            // learner's own dashboard stayed empty while their membership lived elsewhere.
            // Identity resolution has to agree between logging in and enrolling, or the two
            // halves of the same person drift apart.
            if (StringUtils.hasText(instituteId)) {
                optionalUser = userRepository.findLatestUserByMobileNumberAndInstitute(
                        registerRequest.getMobileNumber(), instituteId);
            }
            if (optionalUser.isEmpty()) {
                optionalUser = userRepository.findLatestUserByMobileNumber(registerRequest.getMobileNumber());
            }
        }

        if (!usePhoneAsIdentifier && optionalUser.isEmpty() && StringUtils.hasText(normalizedEmail)) {
            optionalUser = userRepository.findFirstByEmailOrderByCreatedAtDesc(normalizedEmail);
        }

        if (!usePhoneAsIdentifier && optionalUser.isEmpty() && StringUtils.hasText(registerRequest.getUsername())) {
            optionalUser = selfSignup
                    ? findSamePersonByUsername(registerRequest, normalizedEmail)
                    : userRepository.findByUsername(registerRequest.getUsername());
        }

        boolean isAlreadyPresent = optionalUser.isPresent();
        User user;
        if (isAlreadyPresent) {
            user = optionalUser.get();
            // Bug 2 fix: only fill in fields the existing user does not already have —
            // never clobber existing profile data with new registration input.
            if (StringUtils.hasText(normalizedEmail) && !StringUtils.hasText(user.getEmail()))
                user.setEmail(normalizedEmail);
            if (StringUtils.hasText(registerRequest.getFullName()) && !StringUtils.hasText(user.getFullName()))
                user.setFullName(registerRequest.getFullName());
            if (StringUtils.hasText(registerRequest.getAddressLine()) && !StringUtils.hasText(user.getAddressLine()))
                user.setAddressLine(registerRequest.getAddressLine());
            if (StringUtils.hasText(registerRequest.getCity()) && !StringUtils.hasText(user.getCity()))
                user.setCity(registerRequest.getCity());
            if (StringUtils.hasText(registerRequest.getPinCode()) && !StringUtils.hasText(user.getPinCode()))
                user.setPinCode(registerRequest.getPinCode());
            if (StringUtils.hasText(registerRequest.getMobileNumber()) && !StringUtils.hasText(user.getMobileNumber()))
                user.setMobileNumber(registerRequest.getMobileNumber());
            if (registerRequest.getDateOfBirth() != null && user.getDateOfBirth() == null)
                user.setDateOfBirth(registerRequest.getDateOfBirth());
            if (StringUtils.hasText(registerRequest.getGender()) && !StringUtils.hasText(user.getGender()))
                user.setGender(registerRequest.getGender());
            if (StringUtils.hasText(registerRequest.getProfilePicFileId()) && !StringUtils.hasText(user.getProfilePicFileId()))
                user.setProfilePicFileId(registerRequest.getProfilePicFileId());
            if (StringUtils.hasText(registerRequest.getLinkedParentId()) && !StringUtils.hasText(user.getLinkedParentId()))
                user.setLinkedParentId(registerRequest.getLinkedParentId());
            if (!user.isRootUser())
                user.setRootUser(true);
            user = userRepository.save(user);
        } else {
            String fromStrategy = usernameFromInstituteStrategy(registerRequest, instituteId, selfSignup);
            if (fromStrategy != null) {
                registerRequest.setUsername(ensureUniqueUsername(fromStrategy));
            }
            if (!StringUtils.hasText(registerRequest.getUsername())) {
                registerRequest.setUsername(UsernameGenerator.generateUsername(registerRequest.getFullName()));
            }
            if (selfSignup || !callerChoseUsername) {
                registerRequest.setUsername(ensureUniqueUsername(registerRequest.getUsername()));
            }
            if (!StringUtils.hasText(registerRequest.getPassword())) {
                registerRequest.setPassword(UsernameGenerator.generatePassword(8));
            }
            user = User.builder()
                    .fullName(registerRequest.getFullName())
                    .username(registerRequest.getUsername())
                    .email(normalizedEmail)
                    .password(registerRequest.getPassword())
                    .addressLine(registerRequest.getAddressLine())
                    .city(registerRequest.getCity())
                    .pinCode(registerRequest.getPinCode())
                    .mobileNumber(registerRequest.getMobileNumber())
                    .dateOfBirth(registerRequest.getDateOfBirth())
                    .gender(registerRequest.getGender())
                    .profilePicFileId(registerRequest.getProfilePicFileId())
                    .linkedParentId(registerRequest.getLinkedParentId())
                    .isRootUser(true)
                    .build();
            user = userRepository.save(user);
        }
        List<Role> allRoles = getAllUserRoles(registerRequest.getRoles());
        Set<UserRole> userRoleSet = new HashSet<>();
        for (Role role : allRoles) {
            // Bug 4 fix: for existing users, skip roles that are already active to prevent
            // duplicate user_role rows (orphanRemoval=false means old rows are never deleted).
            if (isAlreadyPresent && userRoleRepository.existsByUserIdAndInstituteIdAndRoleName(user.getId(), instituteId, role.getName())) {
                continue;
            }
            UserRole userRole = new UserRole();
            userRole.setRole(role);
            userRole.setStatus(UserRoleStatus.ACTIVE.name());
            userRole.setInstituteId(instituteId);
            userRole.setUser(user);
            userRoleSet.add(userRole);
        }
        if (isAlreadyPresent) {
            // Save only the new roles directly; do not replace the existing collection.
            userRoleRepository.saveAll(userRoleSet);
        } else {
            user.setRoles(userRoleSet);
            user = userRepository.save(user);
        }
        if (sendWelcomeMail) {
            // Welcome email is a side-effect: its failure must NEVER roll back the
            // user creation. The enclosing @Transactional would otherwise mark the
            // transaction rollback-only on any thrown exception, deleting the new
            // user (and on the existing-user branch, undoing any patched fields /
            // newly assigned roles). Catch everything here and log instead.
            try {
                if (isAlreadyPresent) {
                    sendLearnerEnrollmentExistingUserEmail(user, instituteId, userRoleSet, overrideLoginUrl);
                } else {
                    sendLearnerEnrollmentNewUserEmail(user, instituteId, userRoleSet, overrideLoginUrl);
                }
            } catch (Exception e) {
                log.error("Welcome email failed for userId={}, instituteId={}: {}",
                        user.getId(), instituteId, e.getMessage(), e);
            }
        }
        return user;
    }

    /**
     * Sends enrollment email to a NEW learner.
     */
    public void sendLearnerEnrollmentNewUserEmail(User user, String instituteId, Set<UserRole> roles) {
        sendLearnerEnrollmentNewUserEmail(user, instituteId, roles, null);
    }

    public void sendLearnerEnrollmentNewUserEmail(User user, String instituteId, Set<UserRole> roles, String overrideLoginUrl) {
        if (user == null) {
            log.warn("sendLearnerEnrollmentNewUserEmail called with null user; skipping send.");
            return;
        }
        // For phone-only institutes (USER_IDENTIFIER=PHONE) the learner may have
        // no email on record. Don't attempt the email send; the unified pipeline
        // would receive recipient.email=null and either fail or silently drop it.
        // TODO: add SMS/WhatsApp credential delivery for phone-only learners.
        if (!StringUtils.hasText(user.getEmail())) {
            log.warn("Skipping new-learner welcome email for userId={} (no email on file).",
                    user.getId());
            return;
        }
        InstituteInfoDTO instituteInfoDTO = null;
        // Never guess "staff" from an empty set of added roles — see isLearnerRecipient.
        boolean isLearner = isLearnerRecipient(user, instituteId, roles);
        String instituteName = "Vacademy";
        String theme = "#E67E22";
        String loginUrl = "https://dash.vacademy.io";
        if (StringUtils.hasText(instituteId)) {
            instituteInfoDTO = instituteInternalService.getInstituteByInstituteId(instituteId);
            if (instituteInfoDTO.getInstituteName() != null)
                instituteName = instituteInfoDTO.getInstituteName();
            if (instituteInfoDTO.getInstituteThemeCode() != null)
                theme = instituteInfoDTO.getInstituteThemeCode();
            if (isLearner) {
                // hasText, not != null: two institutes store the column as "" and a bare null-check
                // let that through, emailing learners an empty href instead of the platform default.
                if (StringUtils.hasText(instituteInfoDTO.getLearnerPortalUrl()))
                    loginUrl = instituteInfoDTO.getLearnerPortalUrl();
                else
                    loginUrl = defaultLearnerPortalUrl;
            } else if (StringUtils.hasText(instituteInfoDTO.getAdminPortalUrl())) {
                loginUrl = instituteInfoDTO.getAdminPortalUrl();
            }
        }
        // Package-level overrideLoginUrl takes priority over institute settings
        if (StringUtils.hasText(overrideLoginUrl)) {
            loginUrl = overrideLoginUrl;
        }
        GenericEmailRequest genericEmailRequest = new GenericEmailRequest();
        genericEmailRequest.setTo(user.getEmail());
        genericEmailRequest.setBody(NotificationEmailBody.createLearnerEnrollmentNewUserEmailBody(
                instituteName, user.getFullName(),
                user.getUsername(), user.getPassword(), normalizePortalUrl(loginUrl), theme));
        genericEmailRequest.setSubject("Course Enrollment - " + instituteName);
        // Names the event so institute-configured CC/BCC copies can match this send.
        genericEmailRequest.setService(NotificationConstant.EVENT_LEARNER_ENROLL);
        notificationService.sendGenericHtmlMailViaUnified(genericEmailRequest, instituteId);
    }

    /**
     * Sends enrollment email to an EXISTING learner with retained credentials.
     */
    public void sendLearnerEnrollmentExistingUserEmail(User user, String instituteId, Set<UserRole> roles) {
        sendLearnerEnrollmentExistingUserEmail(user, instituteId, roles, null);
    }

    public void sendLearnerEnrollmentExistingUserEmail(User user, String instituteId, Set<UserRole> roles, String overrideLoginUrl) {
        if (user == null) {
            log.warn("sendLearnerEnrollmentExistingUserEmail called with null user; skipping send.");
            return;
        }
        // Same rationale as the new-user path: phone-identifier institutes may
        // have learners with no email — skip instead of throwing so the caller's
        // transaction is not marked rollback-only.
        // TODO: add SMS/WhatsApp credential delivery for phone-only learners.
        if (!StringUtils.hasText(user.getEmail())) {
            log.warn("Skipping existing-learner welcome email for userId={} (no email on file).",
                    user.getId());
            return;
        }
        InstituteInfoDTO instituteInfoDTO = null;
        // An already-enrolled learner adds no new roles, so `roles` is empty here almost every
        // time — see isLearnerRecipient. This is the path that was emailing learners the admin portal.
        boolean isLearner = isLearnerRecipient(user, instituteId, roles);
        String instituteName = "Vacademy";
        String theme = "#E67E22";
        String loginUrl = "https://dash.vacademy.io";
        if (StringUtils.hasText(instituteId)) {
            instituteInfoDTO = instituteInternalService.getInstituteByInstituteId(instituteId);
            if (instituteInfoDTO.getInstituteName() != null)
                instituteName = instituteInfoDTO.getInstituteName();
            if (instituteInfoDTO.getInstituteThemeCode() != null)
                theme = instituteInfoDTO.getInstituteThemeCode();
            if (isLearner) {
                // hasText, not != null: two institutes store the column as "" and a bare null-check
                // let that through, emailing learners an empty href instead of the platform default.
                if (StringUtils.hasText(instituteInfoDTO.getLearnerPortalUrl()))
                    loginUrl = instituteInfoDTO.getLearnerPortalUrl();
                else
                    loginUrl = defaultLearnerPortalUrl;
            } else if (StringUtils.hasText(instituteInfoDTO.getAdminPortalUrl())) {
                loginUrl = instituteInfoDTO.getAdminPortalUrl();
            }
        }
        // Package-level overrideLoginUrl takes priority over institute settings
        if (StringUtils.hasText(overrideLoginUrl)) {
            loginUrl = overrideLoginUrl;
        }
        String fullName = user.getFullName() != null ? user.getFullName() : "User";
        String username = user.getUsername() != null ? user.getUsername() : "N/A";
        String password = user.getPassword() != null ? user.getPassword() : "N/A";
        String body = NotificationEmailBody.createLearnerEnrollmentExistingUserEmailBody(
                instituteName,
                fullName,
                username,
                password,
                normalizePortalUrl(loginUrl),
                theme);
        GenericEmailRequest emailRequest = new GenericEmailRequest();
        emailRequest.setTo(user.getEmail());
        emailRequest.setSubject("Course Enrollment - " + instituteName);
        emailRequest.setBody(body);
        // Names the event so institute-configured CC/BCC copies can match this send.
        emailRequest.setService(NotificationConstant.EVENT_LEARNER_ENROLL);
        notificationService.sendGenericHtmlMailViaUnified(emailRequest, instituteId);
    }

    /**
     * Links two EXISTING users as parent and child. Back-fill only: never
     * overwrites a linked_parent_id the child already has.
     */
    @Transactional
    public void linkParentChild(String parentUserId, String studentUserId) {
        if (!StringUtils.hasText(parentUserId) || !StringUtils.hasText(studentUserId)) {
            throw new VacademyException("parentUserId and studentUserId are required");
        }
        User parent = userRepository.findById(parentUserId)
                .orElseThrow(() -> new VacademyException("Parent user not found: " + parentUserId));
        User student = userRepository.findById(studentUserId)
                .orElseThrow(() -> new VacademyException("Student user not found: " + studentUserId));

        if (!Boolean.TRUE.equals(parent.getIsParent())) {
            parent.setIsParent(true);
            userRepository.save(parent);
        }
        if (!StringUtils.hasText(student.getLinkedParentId())) {
            student.setLinkedParentId(parentUserId);
            userRepository.save(student);
        }
    }

    /**
     * All children linked to a single parent (supports the multi-child case,
     * unlike {@link #createMultipleUsers} / users-with-children which assumes
     * one child per parent).
     */
    public List<UserDTO> getChildrenOfParent(String parentUserId) {
        if (!StringUtils.hasText(parentUserId)) {
            return List.of();
        }
        return userRepository.findByLinkedParentIdIn(List.of(parentUserId)).stream()
                .map(this::convertToUserDto)
                .toList();
    }

    /**
     * Institute-wide backfill: for each item whose child does not already have
     * a linked parent, creates a synthetic parent user and links it. Re-checks
     * each child's linked_parent_id at write time so re-running the backfill is
     * idempotent even if the caller's snapshot is stale.
     *
     * <p>
     * Does not send any credential notification itself — the caller
     * (admin_core_service) owns that via its configurable template system, using
     * the full guardian/student details returned in {@code createdPairs}.
     */
    @Transactional
    public BackfillParentsResultDTO backfillParents(List<BackfillParentItemDTO> items, String instituteId) {
        List<BackfillParentItemDTO> safeItems = items != null ? items : List.of();
        int created = 0;
        int skipped = 0;
        List<BackfillCreatedPairDTO> createdPairs = new ArrayList<>();
        for (BackfillParentItemDTO item : safeItems) {
            Optional<User> childOpt = userRepository.findById(item.getChildUserId());
            if (childOpt.isEmpty()) {
                skipped++;
                continue;
            }
            User child = childOpt.get();
            if (StringUtils.hasText(child.getLinkedParentId()) || Boolean.TRUE.equals(child.getIsParent())) {
                skipped++;
                continue;
            }

            UserDTO parentDTO = new UserDTO();
            parentDTO.setFullName(item.getParentFullName());
            parentDTO.setEmail(item.getParentEmail());
            parentDTO.setRoles(List.of("PARENT"));

            User parentUser = createUser(parentDTO, instituteId, false);
            parentUser.setIsParent(true);
            parentUser = userRepository.save(parentUser);

            child.setLinkedParentId(parentUser.getId());
            userRepository.save(child);
            created++;
            createdPairs.add(BackfillCreatedPairDTO.builder()
                    .childUserId(child.getId())
                    .parentUserId(parentUser.getId())
                    .studentFullName(child.getFullName())
                    .studentEmail(child.getEmail())
                    .guardianFullName(parentUser.getFullName())
                    .guardianUsername(parentUser.getUsername())
                    .guardianEmail(parentUser.getEmail())
                    .guardianPassword(parentUser.getPassword())
                    .build());
        }
        return BackfillParentsResultDTO.builder()
                .totalRequested(safeItems.size())
                .created(created)
                .skipped(skipped)
                .createdPairs(createdPairs)
                .build();
    }
}