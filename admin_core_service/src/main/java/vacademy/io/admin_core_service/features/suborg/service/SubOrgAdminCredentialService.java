package vacademy.io.admin_core_service.features.suborg.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.auth_service.service.AuthService;
import vacademy.io.admin_core_service.features.institute.repository.InstituteRepository;
import vacademy.io.admin_core_service.features.institute.repository.InstituteSubOrgRepository;
import vacademy.io.admin_core_service.features.institute_learner.repository.StudentSessionInstituteGroupMappingRepository;
import vacademy.io.common.exceptions.VacademyException;
import vacademy.io.common.institute.entity.Institute;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Manage VLEs → row menu → "Share credentials".
 *
 * <p>A channel-partner admin's credential mail is gated by the same
 * {@code COURSE_SETTING.enrollmentNotifications.showSendCredentials} switch as learner
 * enrollments, so an institute that turned that off for learners silently ships its VLE admins
 * no password at all. This is the manual way out: re-send the admin's current login details on
 * demand, branded for the parent institute and linking to its admin portal (where a sub-org
 * admin actually signs in — the registration wizard's completion page sends them there too).
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class SubOrgAdminCredentialService {

    private final StudentSessionInstituteGroupMappingRepository ssigmRepository;
    private final InstituteSubOrgRepository instituteSubOrgRepository;
    private final InstituteRepository instituteRepository;
    private final AuthService authService;

    /**
     * @return {@code {sub_org_id, user_id, sent, failed, message}} — {@code sent}/{@code failed}
     *         and {@code message} are auth-service's own report of what it did
     */
    public Map<String, Object> resendAdminLoginDetails(String subOrgId, String parentInstituteId) {
        if (!StringUtils.hasText(subOrgId) || !StringUtils.hasText(parentInstituteId)) {
            throw new VacademyException(HttpStatus.BAD_REQUEST, "subOrgId and parentInstituteId are required");
        }
        // The controller's access check trusts the caller's parentInstituteId for the ADMIN test,
        // so pin the sub-org to that parent here: otherwise an admin of one institute could mail
        // another institute's channel-partner admin under the wrong branding and sign-in link.
        boolean linkedToParent = instituteSubOrgRepository
                .findByInstituteIdAndSuborgIdIn(parentInstituteId, List.of(subOrgId))
                .stream()
                .anyMatch(link -> subOrgId.equals(link.getSuborgId()));
        if (!linkedToParent) {
            throw new VacademyException(HttpStatus.NOT_FOUND,
                    "Sub-organization " + subOrgId + " does not belong to institute " + parentInstituteId);
        }

        // Same query the list uses to resolve the row's admin, so the mail goes to the person
        // the table shows in the Admin column.
        String adminUserId = null;
        for (Object[] row : ssigmRepository.findRootAdminBySubOrgIds(List.of(subOrgId))) {
            if (row != null && row.length > 1 && row[1] != null) {
                adminUserId = String.valueOf(row[1]);
                break;
            }
        }
        if (adminUserId == null) {
            throw new VacademyException(HttpStatus.NOT_FOUND,
                    "No active admin is enrolled for this sub-organization, so there is nobody to send credentials to.");
        }

        // The parent's portal, not the spawned sub-org institute's: sub-org rows inherit no
        // portal URLs of their own, and the parent's white-label admin domain is where the
        // admin logs in. Left null when unset — auth-service then falls back to the
        // parent's learner portal and refuses the send if that is missing too.
        String adminPortalUrl = instituteRepository.findById(parentInstituteId)
                .map(Institute::getAdminPortalBaseUrl)
                .filter(StringUtils::hasText)
                .map(String::trim)
                .orElse(null);

        Map<String, Object> reply = authService.resendLoginDetails(adminUserId, parentInstituteId, adminPortalUrl);
        log.info("Resent login details for sub-org {} admin {} (parent {}): {}",
                subOrgId, adminUserId, parentInstituteId, reply);

        Map<String, Object> out = new LinkedHashMap<>();
        out.put("sub_org_id", subOrgId);
        out.put("user_id", adminUserId);
        out.put("sent", reply != null ? reply.getOrDefault("sent", 0) : 0);
        out.put("failed", reply != null ? reply.getOrDefault("failed", 1) : 1);
        out.put("message", reply != null ? reply.get("message") : null);
        return out;
    }
}
