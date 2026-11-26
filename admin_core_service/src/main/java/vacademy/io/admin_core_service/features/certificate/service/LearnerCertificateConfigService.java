package vacademy.io.admin_core_service.features.certificate.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import vacademy.io.admin_core_service.features.certificate.dao.CertificateCriteriaDao;
import vacademy.io.admin_core_service.features.certificate.dto.CertificateCriteriaDto;
import vacademy.io.admin_core_service.features.certificate.dto.CertificateEligibilityDto;
import vacademy.io.admin_core_service.features.certificate.dto.LearnerCertificateConfigDto;
import vacademy.io.admin_core_service.features.certificate.dto.ResolvedCertificateConfig;
import vacademy.io.admin_core_service.features.institute.enums.CertificateTypeEnum;
import vacademy.io.admin_core_service.features.institute.repository.InstituteRepository;
import vacademy.io.admin_core_service.features.institute_learner.repository.StudentSessionInstituteGroupMappingRepository;
import vacademy.io.admin_core_service.features.packages.repository.PackageSessionRepository;
import vacademy.io.common.institute.entity.Institute;
import vacademy.io.common.institute.entity.PackageEntity;
import vacademy.io.common.institute.entity.session.PackageSession;

import java.util.Optional;

/**
 * Resolves the certificate config a learner client needs for one batch.
 *
 * <p>A batch belongs to a course, and course settings can override the institute
 * default, so the batch id has to be walked up to its package before resolving.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class LearnerCertificateConfigService {

    private final CertificateSettingsResolver certificateSettingsResolver;
    private final InstituteRepository instituteRepository;
    private final PackageSessionRepository packageSessionRepository;
    private final CertificateCriteriaEvaluator certificateCriteriaEvaluator;
    private final CertificateCriteriaDao certificateCriteriaDao;
    private final StudentSessionInstituteGroupMappingRepository mappingRepository;

    public LearnerCertificateConfigDto resolveForBatch(String instituteId, String packageSessionId) {
        return resolveForBatch(instituteId, packageSessionId, null);
    }

    /** @param userId the calling learner, for {@code certificateIssued}; null skips that lookup */
    public LearnerCertificateConfigDto resolveForBatch(String instituteId, String packageSessionId, String userId) {
        Optional<Institute> institute = instituteRepository.findById(instituteId);
        if (institute.isEmpty()) {
            // Unknown institute: report disabled rather than 404. The client uses
            // this purely to decide whether to attempt issuance, and the issue
            // endpoint enforces the real gate regardless.
            return LearnerCertificateConfigDto.builder()
                    .enabled(false)
                    .thresholdPercent(CertificateSettingsResolver.DEFAULT_THRESHOLD_PERCENT)
                    .criteriaMode(CertificateCriteriaDto.MODE_PROGRESS)
                    .build();
        }

        String packageId = resolvePackageId(packageSessionId);
        ResolvedCertificateConfig config = certificateSettingsResolver.resolve(
                institute.get(), packageId, CertificateTypeEnum.COURSE_COMPLETION.name());

        boolean issued = userId != null && mappingRepository
                .findByUserIdAndPackageSessionIdAndInstituteId(userId, packageSessionId, instituteId)
                .map(m -> m.getAutomatedCompletionCertificateFileId() != null
                        && !m.getAutomatedCompletionCertificateFileId().isBlank())
                .orElse(false);

        return LearnerCertificateConfigDto.builder()
                .enabled(config.isEnabled())
                .thresholdPercent(config.getThresholdPercent())
                .criteriaMode(CertificateCriteriaEvaluator.modeOf(config.getCriteria()))
                .certificateIssued(issued)
                .build();
    }

    /**
     * The authenticated learner's standing against their course's certificate rule,
     * test by test. Disabled (not an error) for an unknown institute or a batch the
     * learner is not enrolled in, so a client can only ever see its own results.
     */
    public CertificateEligibilityDto eligibilityFor(String instituteId, String packageSessionId, String userId) {
        Optional<Institute> institute = instituteRepository.findById(instituteId);
        boolean enrolled = institute.isPresent() && mappingRepository
                .findByUserIdAndPackageSessionIdAndInstituteId(userId, packageSessionId, instituteId)
                .isPresent();
        if (!enrolled) {
            return CertificateEligibilityDto.builder()
                    .enabled(false)
                    .mode(CertificateCriteriaDto.MODE_PROGRESS)
                    .build();
        }
        ResolvedCertificateConfig config = certificateSettingsResolver.resolve(
                institute.get(), resolvePackageId(packageSessionId), CertificateTypeEnum.COURSE_COMPLETION.name());
        Double completion = certificateCriteriaDao.findCompletionPercentage(userId, packageSessionId);
        return certificateCriteriaEvaluator.evaluateOne(packageSessionId, userId, config, completion);
    }

    private String resolvePackageId(String packageSessionId) {
        try {
            return packageSessionRepository.findById(packageSessionId)
                    .map(PackageSession::getPackageEntity)
                    .map(PackageEntity::getId)
                    .orElse(null);
        } catch (Exception e) {
            log.warn("Could not resolve course for batch {}; falling back to institute defaults",
                    packageSessionId, e);
            return null;
        }
    }
}
