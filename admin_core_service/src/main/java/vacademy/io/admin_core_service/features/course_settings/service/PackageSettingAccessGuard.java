package vacademy.io.admin_core_service.features.course_settings.service;

import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;
import org.springframework.web.context.request.RequestAttributes;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;
import vacademy.io.admin_core_service.core.security.InstituteAccessValidator;
import vacademy.io.admin_core_service.features.packages.repository.PackageInstituteRepository;
import vacademy.io.admin_core_service.features.packages.repository.PackageRepository;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.ForbiddenException;
import vacademy.io.common.institute.entity.PackageEntity;

/**
 * Who may read or write a course's {@code package.course_setting} through
 * {@code /admin-core-service/package/setting/v1}. Every route there took only a package id and
 * checked nothing: any signed-in user could overwrite any course's settings (drip rules, tutor
 * mode, lead conversion, offline access) or read its LMS keys, which hold the Moodle web
 * service token and the WordPress application password copied from the institute.
 *
 * <p>The rule: the course must belong to the caller's {@code clientId} institute
 * ({@code package_institute} row), and the caller must be
 * <ul>
 *   <li>institute STAFF there ({@link InstituteAccessValidator#requireInstituteStaff}: no
 *       root-user bypass, learners refused), or</li>
 *   <li>the course's own creator ({@code created_by_user_id}). The admin dashboard lets a
 *       course's creator change tutor mode / offline / coming-soon on their own course (the
 *       AI copilot saves tutor mode right after creating it), and with
 *       {@code allowLearnersToCreateCourses} that creator can be a learner holding
 *       {@code [STUDENT, TEACHER]}, whom the staff test refuses.</li>
 * </ul>
 *
 * <p>Every caller is the admin dashboard, whose axios instance always sends {@code clientId}.
 */
@Component
public class PackageSettingAccessGuard {

    private final InstituteAccessValidator instituteAccessValidator;
    private final PackageRepository packageRepository;
    private final PackageInstituteRepository packageInstituteRepository;

    public PackageSettingAccessGuard(InstituteAccessValidator instituteAccessValidator,
                                     PackageRepository packageRepository,
                                     PackageInstituteRepository packageInstituteRepository) {
        this.instituteAccessValidator = instituteAccessValidator;
        this.packageRepository = packageRepository;
        this.packageInstituteRepository = packageInstituteRepository;
    }

    /** Throws (403) unless {@code user} may read or write the settings of {@code packageId}. */
    public void requireCanAccess(CustomUserDetails user, String packageId) {
        if (user == null || !StringUtils.hasText(user.getUserId())) {
            throw new ForbiddenException("Authentication required");
        }
        String instituteId = currentClientIdHeader();
        if (!StringUtils.hasText(instituteId)) {
            throw new ForbiddenException("Access denied: clientId header required");
        }
        requirePackageOfInstitute(packageId, instituteId);
        String creator = packageRepository.findById(packageId)
                .map(PackageEntity::getCreatedByUserId)
                .orElse(null);
        // Creator leg: still a member of that institute (auth_service mints the authorities
        // for the clientId institute only, so non-empty authorities prove membership there).
        if (user.getUserId().equals(creator)
                && user.getAuthorities() != null && !user.getAuthorities().isEmpty()) {
            return;
        }
        instituteAccessValidator.requireInstituteStaff(user, instituteId);
    }

    /**
     * Copying an institute's LMS config into a course: staff of that institute
     * ({@code clientId == instituteId}) and the course belongs to it.
     */
    public void requireCanApplyInstituteLms(CustomUserDetails user, String instituteId, String packageId) {
        instituteAccessValidator.requireInstituteStaff(user, instituteId);
        requirePackageOfInstitute(packageId, instituteId);
    }

    private void requirePackageOfInstitute(String packageId, String instituteId) {
        if (!StringUtils.hasText(packageId)
                || !packageInstituteRepository.existsLink(packageId, instituteId)) {
            throw new ForbiddenException("Access denied: course does not belong to institute " + instituteId);
        }
    }

    private static String currentClientIdHeader() {
        RequestAttributes attributes = RequestContextHolder.getRequestAttributes();
        if (attributes instanceof ServletRequestAttributes servletAttributes) {
            return servletAttributes.getRequest().getHeader("clientId");
        }
        return null;
    }
}
