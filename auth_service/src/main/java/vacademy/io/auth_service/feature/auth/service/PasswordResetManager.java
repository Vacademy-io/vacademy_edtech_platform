package vacademy.io.auth_service.feature.auth.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import vacademy.io.auth_service.feature.auth.constants.AuthConstants;
import vacademy.io.auth_service.feature.auth.enums.ClientNameEnum;
import vacademy.io.auth_service.feature.institute.InstituteInfoDTO;
import vacademy.io.auth_service.feature.institute.InstituteInternalService;
import vacademy.io.auth_service.feature.notification.service.NotificationEmailBody;
import vacademy.io.auth_service.feature.notification.service.NotificationService;
import vacademy.io.common.auth.entity.User;
import vacademy.io.common.auth.enums.UserRoleStatus;
import vacademy.io.common.auth.repository.UserRepository;
import vacademy.io.common.exceptions.VacademyException;
import vacademy.io.common.institute.InstituteChoice;
import vacademy.io.common.institute.OriginInstituteResolver;
import vacademy.io.common.notification.dto.GenericEmailRequest;

import java.util.List;
import java.util.Optional;
import java.util.concurrent.Callable;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Future;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.SynchronousQueue;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;

@Slf4j
@Service
@RequiredArgsConstructor
public class PasswordResetManager {

    private final UserRepository userRepository;
    private final NotificationService notificationService;
    private final OriginInstituteResolver originInstituteResolver;

    /** Brands the mail; not final, so the constructor is unchanged. */
    @Autowired(required = false)
    private InstituteInternalService instituteInternalService;

    /** LMS sign-in site for the learner button, same source the credential mails use; optional. */
    @Autowired(required = false)
    private vacademy.io.auth_service.feature.admin_core_service.service.InstitutePolicyService institutePolicyService;

    /**
     * The branding lookups (institute, LMS site) get a short budget each. The reset used to make
     * no admin_core call at all; a slow admin_core must not hold the request (internal calls
     * wait up to 30 s), so past the budget the mail goes out unbranded, as it did before.
     */
    private static final long LOOKUP_BUDGET_MS = 4000;

    /** Small and bounded: when every thread is busy the lookup is skipped, never queued. */
    private static final ExecutorService LOOKUPS = new ThreadPoolExecutor(0, 4, 30, TimeUnit.SECONDS,
            new SynchronousQueue<>(), r -> {
                Thread t = new Thread(r, "password-mail-lookup");
                t.setDaemon(true);
                return t;
            });

    public String sendPasswordToUser(String email,String clientName) {
        User user = null;
        if (clientName != null && clientName.equals(ClientNameEnum.ADMIN.name())) {
            Optional<User> userOptional = userRepository.findMostRecentUserByEmailAndRoleStatusAndRoleNames(email, List.of(UserRoleStatus.ACTIVE.name(),UserRoleStatus.INVITED.name()), AuthConstants.VALID_ROLES_FOR_ADMIN_PORTAL);
            if (userOptional.isEmpty()) {
                throw new VacademyException("User not found");
            }
            user = userOptional.get();
        }
        else{
            Optional<User> userOptional = userRepository.findMostRecentUserByEmailAndRoleStatusAndRoleNames(email, List.of(UserRoleStatus.ACTIVE.name(),UserRoleStatus.INVITED.name()), AuthConstants.VALID_ROLES_FOR_STUDENT_PORTAL);
            if (userOptional.isEmpty()) {
                throw new VacademyException("User not found");
            }
            user = userOptional.get();
        }
        // This mail carries the user's password, so the sender address matters: picking an
        // arbitrary role would mail one institute's learner from another institute's address.
        String instituteId = InstituteChoice.forUser(originInstituteResolver, user);

        // Signed, coloured and linked as the institute the mail is sent from. It used to sign
        // off "auth-service"; with no institute it signs "Team" and carries no login button.
        InstituteInfoDTO institute = loadInstituteQuietly(instituteId);
        boolean adminPortal = clientName != null && clientName.equals(ClientNameEnum.ADMIN.name());
        String instituteName = institute != null ? institute.getInstituteName() : null;
        String loginHref = adminPortal
                ? (institute == null ? null : portalHref(institute.getAdminPortalUrl()))
                : learnerLoginHref(user.getId(), instituteId, institute);
        String themeCode = institute != null ? institute.getInstituteThemeCode() : null;
        String emailBody = NotificationEmailBody.forgetPasswordEmailBody(instituteName, user.getFullName(),
                user.getUsername(), user.getPassword(), loginHref, themeCode);

        GenericEmailRequest genericEmailRequest = new GenericEmailRequest();
        genericEmailRequest.setTo(email);
        genericEmailRequest.setSubject("Your Account Credentials for Accessing the App"); // More intuitive subject
        genericEmailRequest.setBody(emailBody);

        if (!notificationService.sendGenericHtmlMailViaUnifiedAsBoolean(genericEmailRequest, instituteId)) {
            throw new VacademyException("Email not sent");
        }

        return "Email sent successfully";
    }

    /** Best-effort: branding is cosmetic, so a failed or slow load must not block the email. */
    private InstituteInfoDTO loadInstituteQuietly(String instituteId) {
        if (instituteInternalService == null || instituteId == null || instituteId.isBlank()) return null;
        return withinBudget(() -> instituteInternalService.getInstituteByInstituteId(instituteId),
                "institute lookup", instituteId);
    }

    /** The lookup's result, or null when it fails, is busy or takes longer than the budget. */
    private static <T> T withinBudget(Callable<T> lookup, String what, String instituteId) {
        Future<T> future;
        try {
            future = LOOKUPS.submit(lookup);
        } catch (RejectedExecutionException e) {
            log.warn("Password mail {} skipped for institute {}: lookups busy", what, instituteId);
            return null;
        }
        try {
            return future.get(LOOKUP_BUDGET_MS, TimeUnit.MILLISECONDS);
        } catch (TimeoutException e) {
            future.cancel(true);
            log.warn("Password mail {} for institute {} took over {} ms; sending without it", what, instituteId,
                    LOOKUP_BUDGET_MS);
            return null;
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return null;
        } catch (ExecutionException e) {
            Throwable cause = e.getCause() != null ? e.getCause() : e;
            log.warn("Password mail {} failed for institute {}: {}", what, instituteId, cause.getMessage());
            return null;
        }
    }

    /**
     * Where a learner signs in, resolved like the credential mails do: the connected LMS site
     * when the learner studies there, else the institute's learner portal login page. Null (no
     * button) when neither is known. Best-effort; the LMS lookup never throws.
     */
    private String learnerLoginHref(String userId, String instituteId, InstituteInfoDTO institute) {
        if (institutePolicyService != null && userId != null && instituteId != null && !instituteId.isBlank()) {
            java.util.Map<String, String> sites = withinBudget(
                    () -> institutePolicyService.fetchLmsLoginUrls(List.of(userId), instituteId),
                    "LMS login lookup", instituteId);
            String site = sites == null ? null : sites.get(userId);
            if (site != null && !site.isBlank()) return site.trim();
        }
        String portal = institute == null ? null : portalHref(institute.getLearnerPortalUrl());
        return portal == null ? null : portal + "/login";
    }

    /** Portals are stored bare ("learner.example.org") as often as with a scheme; mail links need one. Null when unset. */
    private static String portalHref(String url) {
        if (url == null || url.isBlank()) return null;
        String normalized = url.trim();
        if (!normalized.toLowerCase().startsWith("http://") && !normalized.toLowerCase().startsWith("https://")) {
            normalized = "https://" + normalized;
        }
        while (normalized.endsWith("/")) {
            normalized = normalized.substring(0, normalized.length() - 1);
        }
        return normalized;
    }
}
