package vacademy.io.admin_core_service.features.certificate.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.core.security.InstituteAccessValidator;
import vacademy.io.admin_core_service.features.auth_service.service.AuthService;
import vacademy.io.admin_core_service.features.certificate.dao.CertificateCriteriaDao;
import vacademy.io.admin_core_service.features.certificate.dao.CourseCertificateDao;
import vacademy.io.admin_core_service.features.certificate.dto.CertificateCriteriaDto;
import vacademy.io.admin_core_service.features.certificate.dto.CertificateEligibilityDto;
import vacademy.io.admin_core_service.features.certificate.dto.CertificateTestOptionDto;
import vacademy.io.admin_core_service.features.certificate.dto.CourseCertificateDashboardDto;
import vacademy.io.admin_core_service.features.certificate.dto.CourseCertificateLearnerDto;
import vacademy.io.admin_core_service.features.certificate.dto.CourseCertificateSettingDto;
import vacademy.io.admin_core_service.features.certificate.dto.CourseCertificateSettingsResponse;
import vacademy.io.admin_core_service.features.certificate.dto.ResolvedCertificateConfig;
import vacademy.io.admin_core_service.features.certificate.entity.IssuedCertificate;
import vacademy.io.admin_core_service.features.certificate.notification.CertificateIssuedNotificationService;
import vacademy.io.admin_core_service.features.certificate.repository.IssuedCertificateRepository;
import vacademy.io.admin_core_service.features.course_settings.service.PackageSettingService;
import vacademy.io.admin_core_service.features.institute.dto.CertificationGenerationRequest;
import vacademy.io.admin_core_service.features.institute.dto.settings.GenericSettingRequest;
import vacademy.io.admin_core_service.features.institute.enums.CertificateTypeEnum;
import vacademy.io.admin_core_service.features.institute.manager.InstituteCertificateManager;
import vacademy.io.admin_core_service.features.institute.repository.InstituteRepository;
import vacademy.io.admin_core_service.features.institute_learner.repository.StudentSessionInstituteGroupMappingRepository;
import vacademy.io.admin_core_service.features.media_service.service.MediaService;
import vacademy.io.common.auth.dto.UserDTO;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.VacademyException;
import vacademy.io.common.institute.entity.Institute;

import java.util.ArrayList;
import java.util.Date;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;

/**
 * Admin-facing certificate management for one course: settings, dashboard,
 * per-learner list and the row actions.
 *
 * <p>None of this existed before — the only certificate reads were learner- and
 * parent-scoped, so an admin had no way to see who had been issued what.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class CourseCertificateService {

    private final CertificateSettingsResolver certificateSettingsResolver;
    private final PackageSettingService packageSettingService;
    private final CourseCertificateDao courseCertificateDao;
    private final IssuedCertificateRepository issuedCertificateRepository;
    private final InstituteRepository instituteRepository;
    private final InstituteCertificateManager instituteCertificateManager;
    private final StudentSessionInstituteGroupMappingRepository mappingRepository;
    private final CertificateIssuedNotificationService notificationService;
    private final MediaService mediaService;
    private final AuthService authService;
    private final CertificateCriteriaEvaluator criteriaEvaluator;
    private final CertificateCriteriaDao criteriaDao;
    private final InstituteAccessValidator instituteAccessValidator;

    // ---------------------------------------------------------------- settings

    public CourseCertificateSettingsResponse getSettings(String instituteId, String packageId) {
        Institute institute = loadInstitute(instituteId);

        ResolvedCertificateConfig instituteOnly = certificateSettingsResolver.resolve(
                institute, null, CertificateTypeEnum.COURSE_COMPLETION.name());
        ResolvedCertificateConfig effective = certificateSettingsResolver.resolve(
                institute, packageId, CertificateTypeEnum.COURSE_COMPLETION.name());
        CourseCertificateSettingDto override = certificateSettingsResolver.getCourseOverride(packageId);

        return CourseCertificateSettingsResponse.builder()
                .effectiveEnabled(effective.isEnabled())
                .effectiveThresholdPercent(effective.getThresholdPercent())
                .instituteEnabled(instituteOnly.isEnabled())
                .instituteThresholdPercent(instituteOnly.getThresholdPercent())
                .courseOverride(override)
                .enabledOverriddenByCourse(effective.isEnabledOverriddenByCourse())
                .thresholdOverriddenByCourse(effective.isThresholdOverriddenByCourse())
                // True for either kind of course design: one of the institute's
                // saved templates, or HTML uploaded for this course alone.
                .hasCourseTemplate(effective.isTemplateOverriddenByCourse())
                .courseTemplateId(effective.getTemplateId())
                .build();
    }

    /**
     * Persist the per-course override. Stored through the existing
     * {@link PackageSettingService}, whose per-key upsert leaves the course's other
     * settings (LMS, drip, completion) untouched.
     */
    public void saveSettings(String instituteId, String packageId, CourseCertificateSettingDto request) {
        loadInstitute(instituteId);
        if (!StringUtils.hasText(packageId)) {
            throw new VacademyException("packageId is required");
        }
        if (request != null && request.getThresholdPercent() != null
                && (request.getThresholdPercent() < 0 || request.getThresholdPercent() > 100)) {
            throw new VacademyException("thresholdPercent must be between 0 and 100");
        }
        if (request != null) {
            validateCriteria(request.getCriteria());
        }
        packageSettingService.saveGenericSetting(
                packageId,
                CertificateSettingsResolver.CERTIFICATE_SETTING_KEY,
                GenericSettingRequest.builder()
                        .settingName("Certificate Setting")
                        .settingData(request)
                        .build());
    }

    // --------------------------------------------------------------- dashboard

    public CourseCertificateDashboardDto getDashboard(String instituteId, String packageSessionId, String packageId) {
        ResolvedCertificateConfig config = resolveConfig(instituteId, packageId, packageSessionId);
        CourseCertificateDashboardDto dashboard =
                courseCertificateDao.dashboard(packageSessionId, instituteId, config.getThresholdPercent());
        CertificateCriteriaDto criteria = config.getCriteria();
        dashboard.setCriteriaMode(CertificateCriteriaEvaluator.modeOf(criteria));
        if (!CertificateCriteriaEvaluator.requiresScore(criteria)) {
            return dashboard;
        }

        // Under a score rule "awaiting" and "near" cannot be counted in SQL - they
        // depend on graded quiz attempts and on assessment marks held in another
        // service - so judge every learner still without a certificate here.
        Map<String, Double> withoutCertificate = new LinkedHashMap<>();
        for (CourseCertificateLearnerDto row : courseCertificateDao.learnersUnpaged(packageSessionId, instituteId, null)) {
            if (!StringUtils.hasText(row.getCertificateNumber())) {
                withoutCertificate.put(row.getUserId(), row.getCompletionPercentage());
            }
        }
        long awaiting = 0;
        long near = 0;
        long awaitingResults = 0;
        for (CertificateEligibilityDto eligibility :
                criteriaEvaluator.evaluate(packageSessionId, config, withoutCertificate).values()) {
            if (eligibility.isEligible()) {
                awaiting++;
            } else if (isNear(eligibility)) {
                near++;
            }
            if (eligibility.getTestsAwaitingResult() > 0) {
                awaitingResults++;
            }
        }
        dashboard.setCompletedAwaitingCertificate(awaiting);
        dashboard.setNearThreshold(near);
        dashboard.setPassRule(CertificateCriteriaEvaluator.passRuleOf(criteria));
        dashboard.setTestsInRule(criteriaEvaluator.countTestsInRule(packageSessionId, criteria));
        dashboard.setLearnersAwaitingResults(awaitingResults);
        return dashboard;
    }

    public LearnerPage getLearners(String instituteId, String packageSessionId, String packageId,
                                   String search, String status, int page, int size) {
        ResolvedCertificateConfig config = resolveConfig(instituteId, packageId, packageSessionId);
        if (CertificateCriteriaEvaluator.requiresScore(config.getCriteria())) {
            return getLearnersUnderScoreRule(instituteId, packageSessionId, config, search, status, page, size);
        }
        int threshold = config.getThresholdPercent();
        List<CourseCertificateLearnerDto> rows =
                courseCertificateDao.learners(packageSessionId, instituteId, search, status, threshold, page, size);
        long total = courseCertificateDao.countLearners(packageSessionId, instituteId, search, status, threshold);

        resolveFileUrls(rows);

        int totalPages = size > 0 ? (int) Math.ceil((double) total / size) : 0;
        return new LearnerPage(rows, page, size, total, totalPages, page >= totalPages - 1);
    }

    /**
     * The learner table under a test-score rule: every matching learner is judged,
     * then filtered by status and paged in memory. A batch is tens to low thousands of
     * learners, and the judging is one grading pass plus one assessment-service call
     * for all of them, the same cost as the Quiz Results tab.
     */
    private LearnerPage getLearnersUnderScoreRule(String instituteId, String packageSessionId,
                                                  ResolvedCertificateConfig config, String search,
                                                  String status, int page, int size) {
        List<CourseCertificateLearnerDto> all =
                courseCertificateDao.learnersUnpaged(packageSessionId, instituteId, search);
        Map<String, Double> completion = new LinkedHashMap<>();
        for (CourseCertificateLearnerDto row : all) {
            completion.put(row.getUserId(), row.getCompletionPercentage());
        }
        Map<String, CertificateEligibilityDto> results =
                criteriaEvaluator.evaluate(packageSessionId, config, completion);

        String wanted = StringUtils.hasText(status) ? status.trim().toUpperCase(Locale.ROOT) : null;
        List<CourseCertificateLearnerDto> filtered = new ArrayList<>(all.size());
        for (CourseCertificateLearnerDto row : all) {
            CertificateEligibilityDto eligibility = results.get(row.getUserId());
            boolean issued = StringUtils.hasText(row.getCertificateNumber());
            row.setStatus(issued ? "GENERATED"
                    : (eligibility != null && eligibility.isEligible() ? "AWAITING" : "PENDING"));
            if (eligibility != null) {
                row.setTestsPassed(eligibility.getTestsPassed());
                row.setTestsTotal(eligibility.getTestsTotal());
                row.setTestsRequired(eligibility.getTestsRequired());
                row.setTestsAwaitingResult(eligibility.getTestsAwaitingResult());
                row.setAverageScorePercent(eligibility.getAverageScorePercent());
                row.setScoreMet(eligibility.isScoreMet());
            }
            boolean knownFilter = "GENERATED".equals(wanted) || "AWAITING".equals(wanted) || "PENDING".equals(wanted);
            if (!knownFilter || wanted.equals(row.getStatus())) {
                filtered.add(row);
            }
        }

        long total = filtered.size();
        int from = (int) Math.min(total, (long) Math.max(0, page) * Math.max(1, size));
        int to = (int) Math.min(total, (long) from + Math.max(1, size));
        List<CourseCertificateLearnerDto> rows = new ArrayList<>(filtered.subList(from, to));
        resolveFileUrls(rows);

        int totalPages = size > 0 ? (int) Math.ceil((double) total / size) : 0;
        return new LearnerPage(rows, page, size, total, totalPages, page >= totalPages - 1);
    }

    /**
     * Resolve a public URL per issued certificate so the table can preview and
     * download without a second round trip per row.
     */
    private void resolveFileUrls(List<CourseCertificateLearnerDto> rows) {
        rows.forEach(row -> {
            if (StringUtils.hasText(row.getFileId())) {
                try {
                    row.setFileId(mediaService.getFilePublicUrlById(row.getFileId()));
                } catch (Exception e) {
                    log.warn("Could not resolve certificate file url for {}", row.getFileId(), e);
                }
            }
        });
    }

    /**
     * "Near" under a score rule: one test short of the rule (or, for an average rule,
     * within 10 points of the bar), with progress met or within 10 points of it.
     */
    private static boolean isNear(CertificateEligibilityDto e) {
        if (e.getTestsTotal() == 0 || e.getScoreBlocker() != null) {
            return false;
        }
        boolean progressClose = !e.isProgressRequired() || e.isProgressMet()
                || (e.getCompletionPercentage() != null
                    && e.getCompletionPercentage() >= e.getThresholdPercent() - 10);
        if (!progressClose) {
            return false;
        }
        if (e.isScoreMet()) {
            return true;
        }
        if (CertificateCriteriaDto.RULE_AVERAGE.equals(e.getPassRule())) {
            return e.getAverageScorePercent() != null && e.getPassPercent() != null
                    && e.getAverageScorePercent() >= e.getPassPercent() - 10;
        }
        return e.getTestsRequired() != null && e.getTestsRequired() - e.getTestsPassed() == 1;
    }

    // ------------------------------------------------------------------ criteria

    /** Every quiz and assessment across the course's batches, for the settings picker. */
    public List<CertificateTestOptionDto> getCourseTests(CustomUserDetails user, String instituteId, String packageId) {
        instituteAccessValidator.requireInstituteStaff(user, instituteId);
        loadInstitute(instituteId);
        if (!StringUtils.hasText(packageId)) {
            throw new VacademyException("packageId is required");
        }
        return criteriaDao.findTests(criteriaDao.findPackageSessionIds(packageId));
    }

    /** One learner's standing against the rule, test by test, for the admin table. */
    public CertificateEligibilityDto getEligibility(CustomUserDetails user, String instituteId,
                                                    String packageSessionId, String userId) {
        // Another learner's marks: staff only. Learners read their own through
        // /certificate/learner/v1/eligibility, which takes the id from the token.
        instituteAccessValidator.requireInstituteStaff(user, instituteId);
        var mapping = mappingRepository.findByUserIdAndPackageSessionIdAndInstituteId(userId, packageSessionId, instituteId)
                .orElseThrow(() -> new VacademyException(HttpStatus.NOT_FOUND, "Learner is not enrolled in this batch"));
        ResolvedCertificateConfig config = resolveConfig(instituteId, null, packageSessionId);
        Double completion = criteriaDao.findCompletionPercentage(mapping.getUserId(), packageSessionId);
        return criteriaEvaluator.evaluateOne(packageSessionId, mapping.getUserId(), config, completion);
    }

    private void validateCriteria(CertificateCriteriaDto criteria) {
        if (criteria == null) {
            return;
        }
        if (criteria.getMode() != null
                && !CertificateCriteriaDto.MODES.contains(criteria.getMode().toUpperCase(Locale.ROOT))) {
            throw new VacademyException("criteria.mode must be one of " + CertificateCriteriaDto.MODES);
        }
        if (criteria.getTestScope() != null
                && !CertificateCriteriaDto.SCOPES.contains(criteria.getTestScope().toUpperCase(Locale.ROOT))) {
            throw new VacademyException("criteria.testScope must be one of " + CertificateCriteriaDto.SCOPES);
        }
        if (criteria.getPassRule() != null
                && !CertificateCriteriaDto.RULES.contains(criteria.getPassRule().toUpperCase(Locale.ROOT))) {
            throw new VacademyException("criteria.passRule must be one of " + CertificateCriteriaDto.RULES);
        }
        if (criteria.getTestTypes() != null) {
            for (String type : criteria.getTestTypes()) {
                if (type == null || !CertificateCriteriaDto.TYPES.contains(type.toUpperCase(Locale.ROOT))) {
                    throw new VacademyException("criteria.testTypes may only contain " + CertificateCriteriaDto.TYPES);
                }
            }
        }
        if (criteria.getPassPercent() != null && (criteria.getPassPercent() < 0 || criteria.getPassPercent() > 100)) {
            throw new VacademyException("criteria.passPercent must be between 0 and 100");
        }
        if (criteria.getMinTestsToPass() != null && criteria.getMinTestsToPass() < 1) {
            throw new VacademyException("criteria.minTestsToPass must be at least 1");
        }
        boolean custom = CertificateCriteriaDto.SCOPE_CUSTOM.equalsIgnoreCase(criteria.getTestScope());
        if (CertificateCriteriaEvaluator.requiresScore(criteria) && custom
                && isEmpty(criteria.getModuleIds()) && isEmpty(criteria.getChapterIds())
                && isEmpty(criteria.getSlideIds())) {
            throw new VacademyException("Pick at least one module, chapter or test for the certificate rule");
        }
    }

    /** Staff of this institute (no root-user bypass), without throwing. */
    private boolean isInstituteStaff(CustomUserDetails user, String instituteId) {
        if (user == null) {
            return false;
        }
        try {
            instituteAccessValidator.requireInstituteStaff(user, instituteId);
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    private static boolean isEmpty(List<String> values) {
        return values == null || values.stream().noneMatch(StringUtils::hasText);
    }

    // ----------------------------------------------------------------- actions

    /**
     * Issue or re-issue for one learner. Delegates to the same manager the learner
     * flow uses, so the eligibility gate, numbering and audit trail behave
     * identically no matter who triggered it.
     */
    public String issueForLearner(CustomUserDetails user, String instituteId, String packageSessionId,
                                  String userId, boolean regenerate, String courseName) {
        return issueForLearner(user, instituteId, packageSessionId, userId, regenerate, courseName, false);
    }

    /**
     * @param force "Issue anyway": issue even though the learner does not meet the
     *              course's rule (offline exam, special case). Certificates must still
     *              be switched on for the course.
     *
     * <p>Re-rendering a certificate the learner already holds also skips the rule: it
     * keeps the same number and date, so it is not a new award, and a rule that has
     * changed since (a quiz added to the course) must not block fixing a typo on it.
     */
    public String issueForLearner(CustomUserDetails user, String instituteId, String packageSessionId,
                                  String userId, boolean regenerate, String courseName, boolean force) {
        var mapping = mappingRepository.findByUserIdAndPackageSessionIdAndInstituteId(userId, packageSessionId, instituteId)
                .orElseThrow(() -> new VacademyException(HttpStatus.NOT_FOUND, "Learner is not enrolled in this batch"));
        // Skipping the rule is a staff decision. This controller is reachable with any
        // signed-in token, learners included, so check it here: without this a learner
        // could issue themselves a certificate with force=true. A non-staff caller keeps
        // exactly the behaviour this endpoint always had (the rule is checked).
        boolean staff = isInstituteStaff(user, instituteId);
        if (force && !staff) {
            throw new VacademyException(HttpStatus.FORBIDDEN,
                    "Only institute staff can issue a certificate past the course rule");
        }
        boolean alreadyIssued = StringUtils.hasText(mapping.getAutomatedCompletionCertificateFileId());
        boolean bypassCriteria = staff && (force || (regenerate && alreadyIssued));
        if (force) {
            log.info("Certificate issued past the course rule by {} for user {} in batch {}",
                    user != null ? user.getUserId() : null, userId, packageSessionId);
        }
        CertificationGenerationRequest request = CertificationGenerationRequest.builder()
                .completionDate(new Date())
                .courseName(courseName)
                .regenerate(regenerate)
                .build();
        return instituteCertificateManager
                .generateAutomatedCourseCompletionCertificate(user, userId, packageSessionId, instituteId, request,
                        bypassCriteria)
                .getBody();
    }

    /** Re-send the certificate email for an already-issued certificate. */
    public void resend(String instituteId, String certificateId) {
        IssuedCertificate certificate = issuedCertificateRepository.findById(certificateId)
                .filter(c -> instituteId.equals(c.getInstituteId()))
                .orElseThrow(() -> new VacademyException(HttpStatus.NOT_FOUND, "Certificate not found"));

        Institute institute = loadInstitute(instituteId);
        String studentName = resolveStudentName(certificate.getUserId());
        String url = StringUtils.hasText(certificate.getFileId())
                ? mediaService.getFilePublicUrlById(certificate.getFileId())
                : null;

        boolean sent = notificationService.notifyCertificateIssued(
                institute,
                certificate.getUserId(),
                studentName,
                certificate.getCourseName(),
                // The certificate number, not the media file id. The issuance path
                // passes the file id here, so the emailed {{CERTIFICATE_ID}} does
                // not match the number printed on the PDF.
                certificate.getCertificateId(),
                url);

        // Resend is an explicit admin action, so its outcome has to be truthful.
        // The notifier swallows failures internally (correct for the issuance
        // path, where a failed email must not block delivery), which meant this
        // endpoint returned 200 even when the learner had no email on file.
        if (!sent) {
            throw new VacademyException(HttpStatus.BAD_REQUEST,
                    "Could not send the certificate email — check the learner has an email address on file");
        }
    }

    // ----------------------------------------------------------------- helpers

    /**
     * The config in force for a batch. The tab sends packageId; when it is missing the
     * batch's own course is used, so the course override (and its rule) still applies
     * instead of silently falling back to the institute default.
     */
    private ResolvedCertificateConfig resolveConfig(String instituteId, String packageId, String packageSessionId) {
        Institute institute = loadInstitute(instituteId);
        String effectivePackageId = StringUtils.hasText(packageId) ? packageId
                : (StringUtils.hasText(packageSessionId) ? criteriaDao.findPackageId(packageSessionId) : null);
        return certificateSettingsResolver
                .resolve(institute, effectivePackageId, CertificateTypeEnum.COURSE_COMPLETION.name());
    }

    private Institute loadInstitute(String instituteId) {
        return instituteRepository.findById(instituteId)
                .orElseThrow(() -> new VacademyException(HttpStatus.NOT_FOUND, "Institute not found"));
    }

    private String resolveStudentName(String userId) {
        try {
            List<UserDTO> users = authService.getUsersFromAuthServiceByUserIds(List.of(userId));
            if (users != null && !users.isEmpty()) {
                return Optional.ofNullable(users.get(0).getFullName()).orElse("");
            }
        } catch (Exception e) {
            log.warn("Could not resolve learner name for {}", userId, e);
        }
        return "";
    }

    /** Page envelope matching the shape the admin tables already consume. */
    public record LearnerPage(List<CourseCertificateLearnerDto> content,
                              int pageNo,
                              int pageSize,
                              long totalElements,
                              int totalPages,
                              boolean last) {
    }
}
