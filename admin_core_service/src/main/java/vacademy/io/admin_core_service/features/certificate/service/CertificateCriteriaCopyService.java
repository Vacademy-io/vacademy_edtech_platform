package vacademy.io.admin_core_service.features.certificate.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.admin_core_service.features.certificate.dao.CertificateCriteriaDao;
import vacademy.io.admin_core_service.features.certificate.dao.CertificateCriteriaDao.CopyKind;
import vacademy.io.admin_core_service.features.certificate.dto.CertificateCriteriaDto;
import vacademy.io.admin_core_service.features.certificate.dto.CourseCertificateSettingDto;
import vacademy.io.admin_core_service.features.course_settings.service.PackageSettingService;
import vacademy.io.admin_core_service.features.institute.dto.settings.GenericSettingRequest;

import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;

/**
 * Keeps a course's certificate rule pointing at the right tests when the course is
 * duplicated.
 *
 * <p>A duplicate copies the course settings verbatim but gives every module, chapter and
 * slide a new id. A rule that picks specific modules, chapters or tests would then name
 * the ORIGINAL course's content, match nothing in the copy, and no learner of the copy
 * could ever earn the certificate. A whole-course rule names no ids and needs nothing.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class CertificateCriteriaCopyService {

    private final CertificateSettingsResolver certificateSettingsResolver;
    private final PackageSettingService packageSettingService;
    private final CertificateCriteriaDao criteriaDao;

    /**
     * Rewrite the duplicated course's picked ids to their copies inside that course. Ids
     * with no copy (content that was not carried over) are kept as they were, so nothing
     * the admin chose is silently dropped.
     *
     * <p>Called after the duplicate has committed, so it needs a transaction of its own
     * (REQUIRES_NEW): it must see the committed copies and must never be able to roll the
     * duplicate back.
     *
     * @return true when the stored rule was changed
     */
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public boolean remapAfterCourseCopy(String newPackageId) {
        CourseCertificateSettingDto override = certificateSettingsResolver.getCourseOverride(newPackageId);
        CertificateCriteriaDto criteria = override != null ? override.getCriteria() : null;
        if (criteria == null || !CertificateCriteriaDto.SCOPE_CUSTOM.equalsIgnoreCase(criteria.getTestScope())) {
            return false;
        }
        List<String> batches = criteriaDao.findPackageSessionIds(newPackageId);
        if (batches.isEmpty()) {
            return false;
        }
        List<String> modules = remap(criteria.getModuleIds(), CopyKind.MODULE, batches);
        List<String> chapters = remap(criteria.getChapterIds(), CopyKind.CHAPTER, batches);
        List<String> slides = remap(criteria.getSlideIds(), CopyKind.SLIDE, batches);
        if (same(modules, criteria.getModuleIds()) && same(chapters, criteria.getChapterIds())
                && same(slides, criteria.getSlideIds())) {
            return false;
        }
        criteria.setModuleIds(modules);
        criteria.setChapterIds(chapters);
        criteria.setSlideIds(slides);
        packageSettingService.saveGenericSetting(
                newPackageId,
                CertificateSettingsResolver.CERTIFICATE_SETTING_KEY,
                GenericSettingRequest.builder()
                        .settingName("Certificate Setting")
                        .settingData(override)
                        .build());
        log.info("Certificate rule of duplicated course {} now points at its own content", newPackageId);
        return true;
    }

    private List<String> remap(List<String> ids, CopyKind kind, List<String> batches) {
        if (ids == null || ids.isEmpty()) {
            return ids;
        }
        Map<String, List<String>> copies = criteriaDao.findCopies(kind, ids, batches);
        LinkedHashSet<String> out = new LinkedHashSet<>();
        for (String id : ids) {
            List<String> mapped = copies.get(id);
            if (mapped == null || mapped.isEmpty()) {
                out.add(id);
            } else {
                out.addAll(mapped);
            }
        }
        return new ArrayList<>(out);
    }

    private static boolean same(List<String> a, List<String> b) {
        return a == null ? b == null : a.equals(b);
    }
}
