package vacademy.io.auth_service.feature.user.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import vacademy.io.auth_service.feature.institute.InstituteInfoDTO;
import vacademy.io.auth_service.feature.institute.InstituteInternalService;
import vacademy.io.auth_service.feature.notification.constants.NotificationConstant;
import vacademy.io.auth_service.feature.notification.service.NotificationService;
import vacademy.io.auth_service.feature.user.dto.InvitedUserDTO;
import vacademy.io.auth_service.feature.user.dto.ModifyUserRolesDTO;
import vacademy.io.auth_service.feature.user.util.RandomCredentialGenerator;
import vacademy.io.common.auth.dto.UserDTO;
import vacademy.io.common.auth.entity.User;
import vacademy.io.common.auth.entity.UserRole;
import vacademy.io.common.auth.enums.UserRoleStatus;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.auth.repository.UserRoleRepository;
import vacademy.io.common.auth.service.UserRoleService;
import vacademy.io.common.auth.service.UserService;
import vacademy.io.common.exceptions.VacademyException;
import vacademy.io.common.notification.dto.GenericEmailRequest;

import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Optional;
import java.util.Set;

/**
 * Adding people to an institute's team — the dashboard invite, bulk import, faculty-to-batch,
 * sub-org team members and every other caller of the invite endpoints.
 *
 * <p>A member is ACTIVE the moment they are added (no "accept on first sign-in" step): ACTIVE
 * is what counsellor lists, telephony, pools, CRM assignment, reports and notifications read.
 * The welcome email still carries the login details of a NEW account. An email that already
 * has an account on the platform gets the roles added and a "you've been added" note without
 * any password — their stored password is theirs.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class InviteUserService {
    private static final String DEFAULT_ADMIN_LOGIN_URL = "https://dash.vacademy.io/login";

    static final String DISABLED_HERE_MESSAGE =
            "This person is disabled in your institute — use Enable on the Members tab";

    private static final Set<String> PAUSED_STATUSES = Set.of(UserRoleStatus.DISABLED.name(), "INACTIVE");

    /**
     * An account created within this long of its first role row here counts as created by this
     * institute's invite (the user row and the role row are written by the same request).
     */
    private static final java.time.Duration CREATED_HERE_TOLERANCE = java.time.Duration.ofMinutes(10);

    /** Rows that still hold a role in an institute (paused ones included); everything else was removed. */
    private static final Set<String> LIVE_STATUSES = Set.of(UserRoleStatus.ACTIVE.name(),
            UserRoleStatus.INVITED.name(), UserRoleStatus.DISABLED.name(), "INACTIVE");

    private final UserService userService;
    private final RoleService roleService;
    private final NotificationService notificationService;
    private final UserRoleRepository userRoleRepository;

    @Autowired
    private InstituteInternalService instituteInternalService;

    public InvitedUserDTO inviteUser(UserDTO userDTO, String instituteId) {
        if (!StringUtils.hasText(instituteId)) {
            throw new VacademyException(HttpStatus.BAD_REQUEST, "instituteId is required");
        }
        Optional<User> existing = userService.findExistingUserByEmail(userDTO.getEmail());
        if (existing.isPresent()) {
            return addExistingAccount(existing.get(), userDTO, instituteId);
        }

        setRandomCredentials(userDTO);
        userDTO.setRootUser(true);
        User user = userService.createNewUserFromUserDto(userDTO);
        userDTO.setId(user.getId());
        RoleService.RoleGrant grant = roleService.grantActiveRoles(user, instituteId, userDTO.getRoles());
        logUnusualGrant(grant, user.getId(), instituteId);
        sendWelcomeEmail(userDTO, rolesForEmail(grant, userDTO.getRoles()), instituteId);
        return InvitedUserDTO.of(userDTO, false);
    }

    /**
     * The email already belongs to an account (another institute's member, a learner, or an
     * earlier invite): add the roles here, ACTIVE, and tell them to sign in with the login they
     * have. The response never carries their stored password.
     */
    private InvitedUserDTO addExistingAccount(User user, UserDTO request, String instituteId) {
        refuseIfDisabledHere(user, request.getRoles(), instituteId);
        RoleService.RoleGrant grant = roleService.grantActiveRoles(user, instituteId, request.getRoles());
        logUnusualGrant(grant, user.getId(), instituteId);
        if (grant.changed()) {
            sendExistingAccountEmail(user, rolesForEmail(grant, request.getRoles()), instituteId, true);
        }
        UserDTO response = new UserDTO();
        response.setId(user.getId());
        response.setUsername(user.getUsername());
        response.setEmail(user.getEmail());
        response.setFullName(user.getFullName());
        response.setMobileNumber(user.getMobileNumber());
        response.setRoles(request.getRoles());
        response.setRootUser(user.isRootUser());
        response.setPassword(null);
        InvitedUserDTO invited = InvitedUserDTO.of(response, true);
        // Nothing to add: every requested role was already active here, and no email went out.
        invited.setAlreadyMember(!grant.changed() && !grant.alreadyActive().isEmpty());
        return invited;
    }

    /**
     * An invite must not quietly bring back someone an admin switched off here: if the member
     * is disabled in this institute (paused rows and no live one), or any requested role is
     * paused here, nothing is written and the dashboard gets a 409 it can show. Turning them
     * back on is "Enable access" on the Members tab.
     */
    private void refuseIfDisabledHere(User user, List<String> requestedRoles, String instituteId) {
        Set<String> requested = new LinkedHashSet<>(distinct(requestedRoles));
        boolean live = false;
        boolean paused = false;
        boolean requestedRolePaused = false;
        for (UserRole ur : userRoleRepository.findByUser(user)) {
            if (!instituteId.equals(ur.getInstituteId()) || ur.getRole() == null) {
                continue;
            }
            if (UserRoleService.grantsAccess(ur)) {
                live = true;
            } else if (PAUSED_STATUSES.contains(ur.getStatus())) {
                paused = true;
                if (requested.contains(ur.getRole().getName())) {
                    requestedRolePaused = true;
                }
            }
        }
        if (requestedRolePaused || (paused && !live)) {
            throw new VacademyException(HttpStatus.CONFLICT, DISABLED_HERE_MESSAGE);
        }
    }

    /**
     * "Resend login details" from the Teams page, for a member of {@code instituteId}. Branded
     * as, and listing only the roles held in, that institute. Login details are included only
     * while the member has never signed in; after that it is a sign-in reminder without the
     * password.
     */
    public String resendInvitation(String userId, String instituteId, CustomUserDetails userDetails) {
        if (!StringUtils.hasText(instituteId)) {
            throw new VacademyException(HttpStatus.BAD_REQUEST, "instituteId is required");
        }
        User user = userService.getUserById(userId);
        List<String> roles = accessRoleNamesIn(user, instituteId);
        if (roles.isEmpty()) {
            throw new VacademyException(HttpStatus.BAD_REQUEST,
                    "This member has no active role in this institute — enable their access first");
        }
        boolean withCredentials = sendLoginDetails(user, roles, instituteId);
        return withCredentials ? "Login details sent" : "Sign-in reminder sent";
    }

    public String updateInvitationUser(UserDTO userDTO, String instituteId, CustomUserDetails userDetails) {
        if (!StringUtils.hasText(instituteId)) {
            throw new VacademyException(HttpStatus.BAD_REQUEST, "instituteId is required");
        }
        if (userDTO.getRoles() != null && distinct(userDTO.getRoles()).isEmpty()) {
            throw new VacademyException(HttpStatus.BAD_REQUEST, "Keep at least one role");
        }
        User user = updateUserDetails(userDTO);
        if (userDTO.getRoles() != null) {
            updateUserRoles(user, distinct(userDTO.getRoles()), instituteId, userDetails);
        }
        List<String> roles = accessRoleNamesIn(user, instituteId);
        if (!roles.isEmpty()) {
            sendLoginDetails(user, roles, instituteId);
        }
        return "Details updated successfully!!!";
    }

    private void setRandomCredentials(UserDTO userDTO) {
        userDTO.setPassword(RandomCredentialGenerator.generateRandomPassword());
        userDTO.setUsername(RandomCredentialGenerator.generateRandomUsername(userDTO.getFullName()));
    }

    private User updateUserDetails(UserDTO userDTO) {
        User user = userService.getUserById(userDTO.getId());
        if (isValid(userDTO.getFullName())) user.setFullName(userDTO.getFullName());
        if (isValid(userDTO.getEmail())) user.setEmail(userDTO.getEmail());
        userService.updateUser(user);
        return user;
    }

    /**
     * Applies the edited role list to THIS institute as a diff: roles newly picked are granted
     * ACTIVE, roles no longer picked are removed here, and roles kept keep their status. (It
     * used to delete every role and re-add the set as INVITED, which demoted ACTIVE members.)
     */
    private void updateUserRoles(User user, List<String> requested, String instituteId,
                                 CustomUserDetails userDetails) {
        Set<String> current = new LinkedHashSet<>();
        for (UserRole ur : userRoleRepository.findByUser(user)) {
            if (instituteId.equals(ur.getInstituteId()) && ur.getRole() != null && ur.getRole().getName() != null
                    && LIVE_STATUSES.contains(ur.getStatus())) {
                current.add(ur.getRole().getName());
            }
        }
        List<String> toRemove = current.stream().filter(name -> !requested.contains(name)).toList();
        List<String> toAdd = requested.stream().filter(name -> !current.contains(name)).toList();
        if (!toRemove.isEmpty()) {
            roleService.removeRolesFromUser(createModifyRolesDTO(user.getId(), instituteId, toRemove), userDetails);
        }
        if (!toAdd.isEmpty()) {
            logUnusualGrant(roleService.grantActiveRoles(user, instituteId, toAdd), user.getId(), instituteId);
        }
    }

    /** @return true when the email carried the username and password */
    private boolean sendLoginDetails(User user, List<String> roles, String instituteId) {
        if (mayResendGeneratedCredentials(user, instituteId)) {
            InstituteBranding branding = resolveBranding(instituteId, "login details", user.getId());
            GenericEmailRequest emailRequest = createEmailRequest(
                    user.getEmail(), InviteUserEmailBody.reminderSubject(branding.name()),
                    InviteUserEmailBody.createReminderEmail(
                            user.getFullName(), user.getUsername(), user.getPassword(), roles,
                            branding.theme(), branding.name(), branding.loginUrl())
            );
            notificationService.sendGenericHtmlMailViaUnified(emailRequest, instituteId);
            return true;
        }
        sendExistingAccountEmail(user, roles, instituteId, false);
        return false;
    }

    /**
     * The stored password is mailed again only for an account THIS institute created whose
     * generated credentials have never been used. Which institute created an account is not
     * recorded, so: it has never signed in, it holds no role row (any status) in any other
     * institute, and it was created together with its first role row here (not earlier — an
     * older account existed before this institute added it). Anything else — a shared account,
     * one that signed in (the password may be its own now), one that predates this institute —
     * gets the sign-in reminder without the password.
     */
    boolean mayResendGeneratedCredentials(User user, String instituteId) {
        if (user.getLastLoginTime() != null || !StringUtils.hasText(user.getPassword())
                || user.getPassword().startsWith("$2")) { // a bcrypt hash, not a password
            return false;
        }
        java.time.LocalDateTime firstRowHere = null;
        for (UserRole ur : userRoleRepository.findByUser(user)) {
            if (!instituteId.equals(ur.getInstituteId())) {
                return false; // shared with another institute (or a legacy global row)
            }
            if (ur.getCreatedAt() != null && (firstRowHere == null || ur.getCreatedAt().isBefore(firstRowHere))) {
                firstRowHere = ur.getCreatedAt();
            }
        }
        if (user.getCreatedAt() != null && firstRowHere != null) {
            java.time.LocalDateTime accountCreated = user.getCreatedAt().toLocalDateTime();
            if (accountCreated.isBefore(firstRowHere.minus(CREATED_HERE_TOLERANCE))) {
                return false; // the account existed before this institute added it
            }
        }
        return true;
    }

    private void sendWelcomeEmail(UserDTO userDTO, List<String> roles, String instituteId) {
        InstituteBranding branding = resolveBranding(instituteId, "welcome", userDTO.getId());
        GenericEmailRequest emailRequest = createEmailRequest(
                userDTO.getEmail(), InviteUserEmailBody.inviteSubject(branding.name()),
                InviteUserEmailBody.createInviteUserEmail(
                        userDTO.getFullName(), userDTO.getUsername(), userDTO.getPassword(), roles,
                        branding.theme(), branding.name(), branding.loginUrl())
        );
        notificationService.sendGenericHtmlMailViaUnified(emailRequest, instituteId);
    }

    private void sendExistingAccountEmail(User user, List<String> roles, String instituteId, boolean justAdded) {
        InstituteBranding branding = resolveBranding(instituteId, "added to team", user.getId());
        GenericEmailRequest emailRequest = createEmailRequest(
                user.getEmail(), InviteUserEmailBody.existingAccountSubject(branding.name(), justAdded),
                InviteUserEmailBody.createExistingAccountEmail(
                        user.getFullName(), user.getUsername(), roles,
                        branding.theme(), branding.name(), branding.loginUrl(), justAdded)
        );
        notificationService.sendGenericHtmlMailViaUnified(emailRequest, instituteId);
    }

    /** Names of the roles the user can use in {@code instituteId} (ACTIVE / INVITED rows), in order. */
    private List<String> accessRoleNamesIn(User user, String instituteId) {
        Set<String> names = new LinkedHashSet<>();
        for (UserRole ur : userRoleRepository.findByUser(user)) {
            if (instituteId.equals(ur.getInstituteId()) && ur.getRole() != null && ur.getRole().getName() != null
                    && UserRoleService.grantsAccess(ur)) {
                names.add(ur.getRole().getName());
            }
        }
        return new ArrayList<>(names);
    }

    /** The roles the email names: the ones this grant resolved, or the request as written. */
    private static List<String> rolesForEmail(RoleService.RoleGrant grant, List<String> requested) {
        Set<String> names = new LinkedHashSet<>();
        names.addAll(grant.added());
        names.addAll(grant.activated());
        names.addAll(grant.alreadyActive());
        return names.isEmpty() ? distinct(requested) : new ArrayList<>(names);
    }

    private static void logUnusualGrant(RoleService.RoleGrant grant, String userId, String instituteId) {
        if (!grant.unknown().isEmpty()) {
            log.warn("Invite for user {} in institute {}: unknown role(s) {} were not granted",
                    userId, instituteId, grant.unknown());
        }
        if (!grant.paused().isEmpty()) {
            log.info("Invite for user {} in institute {}: role(s) {} are disabled there and stay disabled",
                    userId, instituteId, grant.paused());
        }
    }

    private static List<String> distinct(List<String> names) {
        if (names == null) {
            return List.of();
        }
        Set<String> out = new LinkedHashSet<>();
        for (String n : names) {
            // Exact names, as the admin-grant guard compares them: trimming here would let
            // "ADMIN " pass the guard and then resolve to the ADMIN role.
            if (n != null && !n.isBlank()) {
                out.add(n);
            }
        }
        return new ArrayList<>(out);
    }

    /** What the email signs off as, links to, and colours its accents with. */
    private record InstituteBranding(String name, String theme, String loginUrl) {}

    // Sign off and link as the sending institute. A branding lookup failure must not block
    // the invite itself — the user row and roles are already written by the time we get
    // here — so it falls back to the platform defaults the template used to hardcode.
    private InstituteBranding resolveBranding(String instituteId, String purpose, String userId) {
        String instituteName = "Vacademy";
        String theme = null; // template substitutes its own default for null/unknown codes
        String adminLoginUrl = DEFAULT_ADMIN_LOGIN_URL;
        if (StringUtils.hasText(instituteId) && instituteInternalService != null) {
            try {
                InstituteInfoDTO instituteInfoDTO = instituteInternalService.getInstituteByInstituteId(instituteId);
                if (instituteInfoDTO != null) {
                    if (StringUtils.hasText(instituteInfoDTO.getInstituteName()))
                        instituteName = instituteInfoDTO.getInstituteName();
                    if (StringUtils.hasText(instituteInfoDTO.getInstituteThemeCode()))
                        theme = instituteInfoDTO.getInstituteThemeCode();
                    if (StringUtils.hasText(instituteInfoDTO.getAdminPortalUrl()))
                        adminLoginUrl = toLoginUrl(instituteInfoDTO.getAdminPortalUrl());
                }
            } catch (Exception e) {
                log.warn("Institute branding lookup failed for {} (user {}, institute {}): {}",
                        purpose, userId, instituteId, e.getMessage());
            }
        }
        return new InstituteBranding(instituteName, theme, adminLoginUrl);
    }

    // admin_portal_base_url is stored scheme-less for some institutes ("admin.shikshanation.com");
    // a scheme-less href is a relative link in every mail client, so normalise before use.
    private static String toLoginUrl(String adminPortalUrl) {
        String base = adminPortalUrl.trim();
        if (!base.matches("(?i)^https?://.*")) {
            base = "https://" + base;
        }
        while (base.endsWith("/")) {
            base = base.substring(0, base.length() - 1);
        }
        return base + "/login";
    }

    private ModifyUserRolesDTO createModifyRolesDTO(String userId, String instituteId, List<String> roles) {
        ModifyUserRolesDTO modifyUserRolesDTO = new ModifyUserRolesDTO();
        modifyUserRolesDTO.setUserId(userId);
        modifyUserRolesDTO.setInstituteId(instituteId);
        modifyUserRolesDTO.setRoles(roles);
        return modifyUserRolesDTO;
    }

    private GenericEmailRequest createEmailRequest(String to, String subject, String body) {
        GenericEmailRequest emailRequest = new GenericEmailRequest();
        emailRequest.setTo(to);
        emailRequest.setSubject(subject);
        emailRequest.setBody(body);
        // Names the event so institute-configured CC/BCC copies can match it. Shared by the
        // welcome, the "login details" resend and the existing-account note — an institute
        // copying team invites wants all of them.
        emailRequest.setService(NotificationConstant.EVENT_TEAM_INVITE);
        return emailRequest;
    }

    private boolean isValid(String value) {
        return value != null && !value.isEmpty();
    }
}
