package vacademy.io.auth_service.feature.user.service;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;
import lombok.extern.slf4j.Slf4j;
import vacademy.io.auth_service.feature.auth.constants.AuthConstants;
import vacademy.io.auth_service.feature.institute.InstituteInfoDTO;
import vacademy.io.auth_service.feature.institute.InstituteInternalService;
import vacademy.io.auth_service.feature.notification.dto.NotificationDTO;
import vacademy.io.auth_service.feature.notification.dto.NotificationToUserDTO;
import vacademy.io.auth_service.feature.notification.enums.NotificationSource;
import vacademy.io.auth_service.feature.notification.service.NotificationEmailBody;
import vacademy.io.auth_service.feature.notification.service.NotificationService;
import vacademy.io.auth_service.feature.notification.dto.unified.UnifiedSendResponse;
import vacademy.io.auth_service.feature.user.dto.CredentialShareResult;
import vacademy.io.common.auth.dto.UserCredentials;
import vacademy.io.common.auth.dto.UserDTO;
import vacademy.io.common.auth.entity.User;
import vacademy.io.common.auth.entity.UserRole;
import vacademy.io.common.auth.enums.PortalsEnum;
import vacademy.io.common.auth.enums.UserRoleStatus;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.auth.repository.UserRepository;
import vacademy.io.common.exceptions.VacademyException;
import vacademy.io.common.institute.InstituteChoice;
import vacademy.io.common.institute.OriginInstituteResolver;
import vacademy.io.common.notification.dto.GenericEmailRequest;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;

@Slf4j
@Service
public class UserOperationService {

    /** Brand-neutral colour used only when an institute has no theme code of its own. */
    private static final String NEUTRAL_THEME_COLOR = "#333333";

    @Autowired
    private UserRepository userRepository;

    @Autowired
    private InstituteInternalService instituteInternalService;

    @Autowired
    private NotificationService notificationService;

    @Autowired
    private vacademy.io.auth_service.feature.admin_core_service.service.InstitutePolicyService institutePolicyService;

    @Autowired
    private UserCredentialUpdateService userCredentialUpdateService;

    @Autowired
    private OriginInstituteResolver originInstituteResolver;

    /**
     * Shares credentials and reports what happened, per learner.
     *
     * <p>Returns counts rather than a sentence because every branch below is a 200: asking for
     * learners who do not exist, or who have no email/username/password on file, mails nobody
     * and used to be indistinguishable from a batch that went out in full.
     */
    public CredentialShareResult shareUserPasswords(List<String> userIds, CustomUserDetails userDetails) {
        return shareUserPasswords(userIds, userDetails != null ? userDetails.getUserId() : "auth-service");
    }

    public CredentialShareResult shareUserPasswords(List<String> userIds, String sourceId) {
        int requested = userIds == null ? 0 : userIds.size();
        if (requested == 0) {
            return CredentialShareResult.builder()
                    .sent(0).failed(0)
                    .message("Invalid input: userIds is missing").build();
        }

        List<User> users = userRepository.findUserDetailsByIds(userIds);
        if (users == null || users.isEmpty()) {
            return CredentialShareResult.builder()
                    .sent(0).failed(requested)
                    .message("No valid users found").build();
        }

        return sendUserPasswords(users, sourceId, requested);
    }

    /**
     * Plain-sentence reply kept for the internal route, whose callers fire and forget.
     */
    public String sendUserPasswords(List<String> userIds) {
        return shareUserPasswords(userIds, "auth-service").getMessage();
    }

    private CredentialShareResult sendUserPasswords(List<User> users, String sourceId, int requested) {
        if (users == null || users.isEmpty() || sourceId == null || sourceId.isBlank()) {
            return CredentialShareResult.builder()
                    .sent(0).failed(requested)
                    .message("Invalid data for sending passwords").build();
        }

        // One sender address covers the whole batch, so pick it from every recipient's institutes
        // rather than from whichever user happens to sort first: an admin sending credentials from
        // their institute's portal should have that institute's address win even if the first user
        // in the list also belongs to another one.
        String instituteId = originInstituteResolver.chooseInstituteIdFor(
                users.stream()
                        .filter(u -> u.getRoles() != null)
                        .flatMap(u -> u.getRoles().stream())
                        .map(UserRole::getInstituteId)
                        .toList());

        InstituteInfoDTO institute = loadInstituteQuietly(instituteId);
        Map<String, String> loginUrls = resolveLoginUrls(
                users.stream().map(User::getId).filter(id -> id != null).toList(), instituteId, institute);

        NotificationDTO notificationDTO = new NotificationDTO();
        notificationDTO.setBody(NotificationEmailBody.sendUserPasswords(senderNameOf(institute)));
        notificationDTO.setSubject("Login credentials!!");
        notificationDTO.setSource(NotificationSource.USER_CREDENTIALS.name());
        notificationDTO.setSourceId(sourceId);
        notificationDTO.setNotificationType("EMAIL");

        List<NotificationToUserDTO> notifyUsers = new ArrayList<>();

        for (User user : users) {
            if (user.getId() == null || user.getEmail() == null || user.getUsername() == null || user.getPassword() == null) {
                continue;
            }

            NotificationToUserDTO notification = new NotificationToUserDTO();
            notification.setUserId(user.getId());
            notification.setChannelId(user.getEmail());
            notification.setPlaceholders(Map.of(
                    "username", user.getUsername(),
                    "password", user.getPassword(),
                    "login_url", loginUrls.get(user.getId())
            ));
            notifyUsers.add(notification);
        }

        if (notifyUsers.isEmpty()) {
            return CredentialShareResult.builder()
                    .sent(0).failed(requested)
                    .message("No valid users to notify — the selected learners have no email, "
                            + "username or password on file.").build();
        }

        notificationDTO.setUsers(notifyUsers);
        // The unified send reports per-recipient acceptance. Discarding it is what let a batch
        // that every recipient rejected still answer "Notification sent successfully".
        UnifiedSendResponse response = notificationService.sendEmailViaUnified(notificationDTO, instituteId);
        int accepted = response != null ? response.getAccepted() : notifyUsers.size();
        int skipped = requested - notifyUsers.size();
        int failed = requested - accepted;

        StringBuilder message = new StringBuilder();
        if (accepted == 0) {
            message.append("Nothing was sent.");
        } else if (failed == 0) {
            message.append("Notification sent successfully.");
        } else {
            message.append("Notification sent to ").append(accepted).append(" of ").append(requested).append(".");
        }
        if (skipped > 0) {
            message.append(" Skipped ").append(skipped)
                    .append(" with no email, username or password on file.");
        }

        return CredentialShareResult.builder()
                .sent(accepted).failed(Math.max(0, failed)).message(message.toString()).build();
    }

    /**
     * Re-sends ONE user's current login details, branded for {@code instituteId} and pointing
     * at {@code loginUrl}.
     *
     * <p>Exists for the Manage VLEs "Share credentials" action. The enrollment path is not
     * reusable for a re-send: it re-runs role assignment on the user, and its mail announces a
     * course enrollment. The send-passwords batch above is reusable but unbranded and links to
     * the learner portal — wrong for a channel-partner admin, who signs in to the admin portal.
     * This method mutates nothing: it reads the user, renders the mail, and reports whether the
     * notification service accepted it.
     *
     * <p>Nothing in the mail is a platform constant. Name, colour and sign-in link all come from
     * the institute record (or the caller's {@code loginUrl}); when the institute cannot be
     * loaded, or has no portal configured, the send fails and says so rather than going out
     * under someone else's branding.
     *
     * @param loginUrl portal the recipient signs in to; blank falls back to the institute's
     *                 admin portal, then its learner portal
     */
    public CredentialShareResult resendLoginDetails(String userId, String instituteId, String loginUrl) {
        if (userId == null || userId.isBlank()) {
            return CredentialShareResult.builder()
                    .sent(0).failed(0).message("Invalid input: userId is missing").build();
        }
        if (instituteId == null || instituteId.isBlank()) {
            return CredentialShareResult.builder()
                    .sent(0).failed(1).message("Invalid input: instituteId is missing").build();
        }
        Optional<User> optionalUser = userRepository.findById(userId);
        if (optionalUser.isEmpty()) {
            return CredentialShareResult.builder()
                    .sent(0).failed(1).message("No user found for id " + userId).build();
        }
        User user = optionalUser.get();
        if (user.getEmail() == null || user.getEmail().isBlank()
                || user.getUsername() == null || user.getPassword() == null) {
            return CredentialShareResult.builder()
                    .sent(0).failed(1)
                    .message("This user has no email, username or password on file, so there is "
                            + "nothing to send.").build();
        }

        InstituteInfoDTO institute;
        try {
            institute = instituteInternalService.getInstituteByInstituteId(instituteId);
        } catch (Exception e) {
            log.warn("Could not load institute {} for the login-details mail: {}", instituteId, e.getMessage());
            institute = null;
        }
        if (institute == null || institute.getInstituteName() == null || institute.getInstituteName().isBlank()) {
            return CredentialShareResult.builder()
                    .sent(0).failed(1)
                    .message("Could not load the institute's details to brand the email. Please try again.")
                    .build();
        }

        String portal = firstNonBlank(loginUrl, institute.getAdminPortalUrl(), institute.getLearnerPortalUrl());
        if (portal == null) {
            return CredentialShareResult.builder()
                    .sent(0).failed(1)
                    .message("The institute has no portal URL configured, so the email would have no "
                            + "sign-in link. Set the admin portal URL in institute settings and retry.")
                    .build();
        }
        // Colour is cosmetic: an institute without a theme code gets a neutral charcoal rather
        // than a refused send. Everything the recipient reads still comes from the institute.
        String theme = firstNonBlank(institute.getInstituteThemeCode(), NEUTRAL_THEME_COLOR);
        String recipientName = firstNonBlank(user.getFullName(), user.getUsername());

        GenericEmailRequest emailRequest = new GenericEmailRequest();
        emailRequest.setTo(user.getEmail());
        emailRequest.setSubject("Your login details - " + institute.getInstituteName());
        emailRequest.setBody(NotificationEmailBody.createLoginDetailsEmailBody(
                institute.getInstituteName(),
                recipientName,
                user.getUsername(),
                user.getPassword(),
                normalizePortalUrl(portal),
                theme));
        // Same source name as the batch send, so the mail lands in the same inbox/log bucket.
        emailRequest.setService(NotificationSource.USER_CREDENTIALS.name());

        UnifiedSendResponse response;
        try {
            response = notificationService.sendGenericHtmlMailViaUnified(emailRequest, instituteId);
        } catch (Exception e) {
            // A notification-service outage is a failed send, not a server error for the admin.
            log.error("Login-details mail failed for userId={}, instituteId={}: {}", userId, instituteId, e.getMessage());
            return CredentialShareResult.builder()
                    .sent(0).failed(1)
                    .message("The email could not be sent right now. Please try again in a moment.")
                    .build();
        }
        boolean accepted = response != null && response.getAccepted() > 0;
        return CredentialShareResult.builder()
                .sent(accepted ? 1 : 0)
                .failed(accepted ? 0 : 1)
                .message(accepted
                        ? "Login details sent to " + user.getEmail() + "."
                        : "The notification service did not accept the email for " + user.getEmail() + ".")
                .build();
    }

    /**
     * userId -> the link a credential email should send each learner to: the LMS site their
     * courses are connected to (that is where the new password was mirrored, and where they
     * actually study), else the institute's learner portal, else the platform default.
     * Every requested id gets an entry.
     */
    private Map<String, String> resolveLoginUrls(List<String> userIds, String instituteId, InstituteInfoDTO institute) {
        Map<String, String> lms = institutePolicyService.fetchLmsLoginUrls(userIds, instituteId);
        String portal = institute != null ? firstNonBlank(institute.getLearnerPortalUrl()) : null;
        String fallback = portal != null ? normalizePortalUrl(portal) + "/login" : NotificationEmailBody.LEARNER_LOGIN_URL;
        Map<String, String> urls = new java.util.HashMap<>();
        for (String id : userIds) {
            String site = lms.get(id);
            urls.put(id, site != null && !site.isBlank() ? site : fallback);
        }
        return urls;
    }

    /** Best-effort: branding and the portal fallback are cosmetic, so a failed load must not block the email. */
    private InstituteInfoDTO loadInstituteQuietly(String instituteId) {
        if (instituteId == null || instituteId.isBlank()) return null;
        try {
            return instituteInternalService.getInstituteByInstituteId(instituteId);
        } catch (Exception e) {
            log.warn("Could not load institute {} for the credentials mail: {}", instituteId, e.getMessage());
            return null;
        }
    }

    /** The name the email is signed with; it used to read "auth-service". */
    private static String senderNameOf(InstituteInfoDTO institute) {
        String name = institute != null ? firstNonBlank(institute.getInstituteName()) : null;
        return name != null ? name : "Vacademy";
    }

    private static String firstNonBlank(String... values) {
        for (String v : values) {
            if (v != null && !v.isBlank()) return v.trim();
        }
        return null;
    }

    /** Portals are stored bare ("admin.example.org") as often as with a scheme; mail links need one. */
    private static String normalizePortalUrl(String url) {
        String normalized = url.trim();
        if (!normalized.toLowerCase().startsWith("http://") && !normalized.toLowerCase().startsWith("https://")) {
            normalized = "https://" + normalized;
        }
        while (normalized.endsWith("/")) {
            normalized = normalized.substring(0, normalized.length() - 1);
        }
        return normalized;
    }

    /**
     * Admin-initiated credential change (Learner list → Portal Access → Edit).
     *
     * <p>Delegates the write to {@link UserCredentialUpdateService} so it takes
     * exactly the same path as the learner's own change: uniqueness is checked
     * up front, the old username's auth-cache entries are evicted, and the
     * rename fans out to {@code student.username} plus the four
     * assessment-database copies. This method used to set username and password
     * directly on the entity and tell nobody, which left every one of those
     * copies stale.
     */
    public String updateUserPassword(UserCredentials userCredentials, CustomUserDetails userDetails) {
        User user = userCredentialUpdateService.updateCredentials(
                userCredentials.getUserId(),
                userCredentials.getUsername(),
                userCredentials.getPassword());
        sendPasswordToUser(user);
        // Mirror the new password to any WordPress LMS the learner's courses are
        // connected to (async, best-effort — never blocks/fails the password change).
        institutePolicyService.syncLmsPassword(user.getId(), user.getEmail(), user.getPassword());
        return "Password updated successfully";
    }

    @Async
    public String sendPasswordToUser(User user) {
        // Carries the user's new password. Reached by self-invocation, so despite @Async this
        // runs on the request thread and the host can disambiguate a multi-institute user;
        // if it ever does run async the choice degrades to the first role, as before.
        String instituteId = InstituteChoice.forUser(originInstituteResolver, user);
        InstituteInfoDTO institute = loadInstituteQuietly(instituteId);
        String loginUrl = resolveLoginUrls(List.of(user.getId()), instituteId, institute).get(user.getId());

        String emailBody = NotificationEmailBody.sendUpdatedUserPasswords(
                senderNameOf(institute), user.getFullName(), user.getUsername(), user.getPassword(), loginUrl);

        GenericEmailRequest genericEmailRequest = new GenericEmailRequest();
        genericEmailRequest.setTo(user.getEmail());
        genericEmailRequest.setSubject("Your Updated Account Credentials for Accessing the App");
        genericEmailRequest.setBody(emailBody);

        if (!notificationService.sendGenericHtmlMailViaUnifiedAsBoolean(genericEmailRequest, instituteId)) {
            throw new VacademyException("Email not sent");
        }

        return "Email sent successfully";
    }

    public UserDTO findUserByEmail(String email){
        Optional<User>optionalUser = userRepository.findFirstByEmailOrderByCreatedAtDesc(email);
        if (optionalUser.isEmpty()){
            return null;
        }
        User user = optionalUser.get();
        UserDTO userDTO = new UserDTO(user);
        userDTO.setUsername(user.getUsername());
        userDTO.setPassword(user.getPassword());
        return userDTO;
    }

    public Optional<UserDTO> findByUserName(String username,
                                            String instituteId,
                                            String portal) {

        Optional<User> optionalUser = userRepository.findByUsername(username);
        if (optionalUser.isEmpty()) {
            return Optional.empty();
        }

        User user = optionalUser.get();

        // Get allowed statuses and roles based on portal
        List<String> allowedStatuses = getAllowedStatuses(portal);
        List<String> allowedRoleNames = getValidRoleNames(portal);

        // instituteId is OPTIONAL. Usernames are globally unique — findByUsername above
        // returns at most one user — so the portal's role + status already identify a
        // legitimate learner without it. Requiring it locked out every institute on a
        // shared domain: with no institute_domain_routing row the caller has no id to
        // send, and a valid learner got a 404 on their own join link. When an id IS
        // supplied it still scopes the match, so single-tenant callers are unchanged.
        boolean instituteScoped = instituteId != null && !instituteId.isBlank();
        boolean hasValidRole = user.getRoles() != null && user.getRoles().stream()
                .anyMatch(ur ->
                        (!instituteScoped
                                || (ur.getInstituteId() != null && ur.getInstituteId().equals(instituteId)))
                                && ur.getStatus() != null && allowedStatuses.contains(ur.getStatus())
                                && ur.getRole() != null && allowedRoleNames.contains(ur.getRole().getName())
                );

        if (hasValidRole) {
            return Optional.of(new UserDTO(user));
        } else {
            return Optional.empty();
        }
    }

    private List<String> getAllowedStatuses(String portal) {
        // You can extend this if portal-specific statuses are needed
        return List.of(UserRoleStatus.ACTIVE.name(), UserRoleStatus.INVITED.name());
    }

    private List<String> getValidRoleNames(String portal) {
        if (portal == null) {
            return List.of(); // empty list if portal is null
        }

        if (portal.equalsIgnoreCase(PortalsEnum.ADMIN.name())) {
            return AuthConstants.VALID_ROLES_FOR_ADMIN_PORTAL;
        } else if (portal.equalsIgnoreCase(PortalsEnum.LEARNER.name())) {
            return AuthConstants.VALID_ROLES_FOR_STUDENT_PORTAL;
        } else {
            return List.of(); // empty list for unknown portals
        }
    }
}
