package vacademy.io.admin_core_service.features.learner_offline.service;

import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import vacademy.io.admin_core_service.features.institute_learner.repository.StudentSessionInstituteGroupMappingRepository;
import vacademy.io.admin_core_service.features.learner_offline.dto.*;
import vacademy.io.admin_core_service.features.learner_offline.entity.OfflineAccessRule;
import vacademy.io.admin_core_service.features.learner_offline.enums.OfflineDownloadReason;
import vacademy.io.admin_core_service.features.learner_study_library.dto.LearnerModuleDTOWithDetails;
import vacademy.io.admin_core_service.features.learner_study_library.dto.LearnerSlidesDetailDTO;
import vacademy.io.admin_core_service.features.learner_study_library.dto.LearnerSubjectProjection;
import vacademy.io.admin_core_service.features.learner_study_library.service.LearnerStudyLibraryService;
import vacademy.io.admin_core_service.features.chapter.dto.LearnerChapterDetailsDTO;
import vacademy.io.admin_core_service.features.media_service.service.MediaService;
import vacademy.io.admin_core_service.features.packages.repository.PackageSessionRepository;
import vacademy.io.admin_core_service.features.learner_offline.repository.OfflineAccessRuleRepository;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.VacademyException;
import vacademy.io.common.institute.entity.session.PackageSession;

import java.util.*;
import java.util.stream.Collectors;

/**
 * Builds the offline manifest (offline plan, Part A2): the learner tree
 * (subjects -> modules -> chapters -> slides) annotated with per-slide
 * downloadable/reason (permission resolver + S3-backed platform gate) and the
 * file assets/inline payloads a downloadable slide needs. Reuses the existing
 * learner-study-library tree services rather than re-querying the schema —
 * exactly the tree the learner app already renders online.
 */
@Service
@RequiredArgsConstructor
public class OfflineManifestService {

    private static final int MAX_ASSET_DETAILS_BATCH = 200;

    private final StudentSessionInstituteGroupMappingRepository studentSessionInstituteGroupMappingRepository;
    private final PackageSessionRepository packageSessionRepository;
    private final OfflineAccessRuleRepository offlineAccessRuleRepository;
    private final OfflineAccessRuleService offlineAccessRuleService;
    private final OfflineSettingService offlineSettingService;
    private final OfflineManifestVersionService offlineManifestVersionService;
    private final OfflineAssetExtractor offlineAssetExtractor;
    private final LearnerStudyLibraryService learnerStudyLibraryService;
    private final MediaService mediaService;

    /** Full manifest for a learner's device/app, with asset size+checksum filled in. */
    public OfflineManifestDTO buildManifest(String packageSessionId, CustomUserDetails learner) {
        return build(packageSessionId, learner, true, true);
    }

    /**
     * Admin preview of resolved offline availability for a whole package
     * session (admin "GET /effective" + the §7.4 non-downloadable-count
     * warning) — same tree + resolver pass as the learner manifest, but skips
     * the learner-enrollment check (the admin viewing it need not be enrolled)
     * and skips the asset size/checksum enrichment call (not needed for a
     * permission preview).
     */
    public OfflineManifestDTO buildManifestForAdminPreview(String packageSessionId) {
        OfflineManifestDTO manifest = build(packageSessionId, null, false, false);
        removeSlideContent(manifest);
        return manifest;
    }

    /** The preview only says what a learner could download. It never reads slide content. */
    public static void removeSlideContent(OfflineManifestDTO manifest) {
        for (OfflineManifestSubjectDTO subject : manifest.getSubjects()) {
            for (OfflineManifestModuleDTO module : subject.getModules()) {
                for (OfflineManifestChapterDTO chapter : module.getChapters()) {
                    chapter.getSlides().forEach(slide -> slide.setInlinePayload(null));
                }
            }
        }
    }

    /** fileIds the requesting learner may currently download for this package session. */
    public Set<String> getDownloadableFileIds(String packageSessionId, CustomUserDetails learner) {
        OfflineManifestDTO manifest = build(packageSessionId, learner, false, true);
        Set<String> fileIds = new HashSet<>();
        for (OfflineManifestSubjectDTO subject : manifest.getSubjects()) {
            for (OfflineManifestModuleDTO module : subject.getModules()) {
                for (OfflineManifestChapterDTO chapter : module.getChapters()) {
                    for (OfflineManifestSlideDTO slide : chapter.getSlides()) {
                        if (slide.isDownloadable() && slide.getAssets() != null) {
                            slide.getAssets().forEach(a -> fileIds.add(a.getFileId()));
                        }
                    }
                }
            }
        }
        return fileIds;
    }

    private OfflineManifestDTO build(String packageSessionId, CustomUserDetails learner, boolean enrichAssetDetails,
            boolean enforceEnrollment) {
        String instituteId;
        if (enforceEnrollment) {
            String userId = learner != null ? learner.getUserId() : null;
            var mapping = studentSessionInstituteGroupMappingRepository
                    .findByUserIdAndPackageSessionId(userId, packageSessionId)
                    .orElseThrow(() -> new VacademyException("Not enrolled in this package session"));
            if (mapping.getStatus() != null && !"ACTIVE".equalsIgnoreCase(mapping.getStatus())) {
                throw new VacademyException("Enrollment is not active for this package session");
            }
            instituteId = mapping.getInstitute() != null ? mapping.getInstitute().getId() : null;
        } else {
            instituteId = packageSessionRepository.findInstituteIdByPackageSessionId(packageSessionId).orElse(null);
        }
        // The tree/progress-overlay services need a non-null CustomUserDetails;
        // the admin preview path has no enrolled learner, so use an empty one
        // (progress fields come back null/0, which the manifest DTO ignores).
        CustomUserDetails treeUser = learner != null ? learner : new CustomUserDetails();

        PackageSession packageSession = packageSessionRepository.findById(packageSessionId)
                .orElseThrow(() -> new VacademyException("Package session not found: " + packageSessionId));
        String packageId = packageSession.getPackageEntity() != null ? packageSession.getPackageEntity().getId() : null;

        boolean instituteEnabled = offlineSettingService.isEnabled(instituteId);
        boolean courseDefault = offlineAccessRuleService.getCourseDefault(packageId);
        Map<String, Boolean> ruleMap = buildRuleMap(packageSessionId, packageId);

        Boolean packageAllow = ruleMap.get(key("PACKAGE", packageId));
        Boolean packageSessionAllow = ruleMap.get(key("PACKAGE_SESSION", packageSessionId));

        List<OfflineManifestSubjectDTO> subjectDTOs = new ArrayList<>();
        List<OfflineAssetRefDTO> allAssetRefs = new ArrayList<>();

        List<LearnerSubjectProjection> subjects = learnerStudyLibraryService
                .getSubjectsByPackageSessionId(packageSessionId, treeUser);
        for (LearnerSubjectProjection subject : subjects) {
            Boolean subjectAllow = ruleMap.get(key("SUBJECT", subject.getId()));

            OfflineManifestSubjectDTO subjectDTO = new OfflineManifestSubjectDTO();
            subjectDTO.setSubjectId(subject.getId());
            subjectDTO.setSubjectName(subject.getSubjectName());
            subjectDTO.setSubjectOrder(subject.getSubjectOrder());
            subjectDTO.setModules(new ArrayList<>());
            subjectDTOs.add(subjectDTO);

            List<LearnerModuleDTOWithDetails> modules = learnerStudyLibraryService
                    .getModulesDetailsWithChaptersAndSlides(subject.getId(), packageSessionId, treeUser);
            for (LearnerModuleDTOWithDetails module : modules) {
                String moduleId = module.getModule() != null ? module.getModule().getId() : null;
                Boolean moduleAllow = ruleMap.get(key("MODULE", moduleId));

                OfflineManifestModuleDTO moduleDTO = new OfflineManifestModuleDTO();
                moduleDTO.setModuleId(moduleId);
                moduleDTO.setModuleName(module.getModule() != null ? module.getModule().getModuleName() : null);
                moduleDTO.setModuleOrder(module.getModuleOrder());
                moduleDTO.setChapters(new ArrayList<>());
                subjectDTO.getModules().add(moduleDTO);

                List<LearnerChapterDetailsDTO> chapters = module.getChapters() == null ? List.of() : module.getChapters();
                for (LearnerChapterDetailsDTO chapter : chapters) {
                    Boolean chapterAllow = ruleMap.get(key("CHAPTER", chapter.getId()));

                    OfflineManifestChapterDTO chapterDTO = new OfflineManifestChapterDTO();
                    chapterDTO.setChapterId(chapter.getId());
                    chapterDTO.setChapterName(chapter.getChapterName());
                    chapterDTO.setChapterOrder(chapter.getChapterOrder());
                    chapterDTO.setSlides(new ArrayList<>());
                    moduleDTO.getChapters().add(chapterDTO);

                    List<LearnerSlidesDetailDTO> slides = chapter.getLearnerSlidesDetails() == null
                            ? List.of() : chapter.getLearnerSlidesDetails();
                    for (LearnerSlidesDetailDTO slide : slides) {
                        Boolean slideAllow = ruleMap.get(key("SLIDE", slide.getId()));
                        List<Boolean> chain = Arrays.asList(
                                packageAllow, packageSessionAllow, subjectAllow, moduleAllow, chapterAllow, slideAllow);
                        boolean permissionAllowed = OfflineAccessResolver.resolve(chain, courseDefault, instituteEnabled);

                        OfflineAssetExtractor.Extraction extraction = offlineAssetExtractor.extract(slide);
                        OfflineDownloadReason reason = offlineAssetExtractor.reasonFor(permissionAllowed, extraction.s3Backed);
                        boolean downloadable = reason == OfflineDownloadReason.ALLOWED;

                        OfflineManifestSlideDTO slideDTO = new OfflineManifestSlideDTO();
                        slideDTO.setSlideId(slide.getId());
                        slideDTO.setSlideType(slide.getSourceType());
                        slideDTO.setTitle(slide.getTitle());
                        slideDTO.setSlideOrder(slide.getSlideOrder());
                        slideDTO.setDownloadable(downloadable);
                        slideDTO.setReason(reason);
                        slideDTO.setKeyRef(null); // reserved DRM/server-key hook — always null in v1
                        if (downloadable) {
                            slideDTO.setInlinePayload(extraction.inlinePayload);
                            slideDTO.setAssets(extraction.assets);
                            allAssetRefs.addAll(extraction.assets);
                        } else {
                            slideDTO.setInlinePayload(null);
                            slideDTO.setAssets(List.of());
                        }
                        chapterDTO.getSlides().add(slideDTO);
                    }
                }
            }
        }

        if (enrichAssetDetails && !allAssetRefs.isEmpty()) {
            enrichAssetDetails(allAssetRefs);
        }

        OfflineManifestDTO manifest = new OfflineManifestDTO();
        manifest.setPackageSessionId(packageSessionId);
        manifest.setCourseName(packageSession.getPackageEntity() != null
                ? packageSession.getPackageEntity().getPackageName()
                : null);
        manifest.setManifestVersion(Math.max(1, offlineManifestVersionService.getVersion(packageSessionId)));
        var settingsPojo = offlineSettingService.get(instituteId);
        manifest.setSettings(new OfflineManifestSettingsDTO(settingsPojo.getRevalidationDays(), settingsPojo.getMaxDevices()));
        manifest.setSubjects(subjectDTOs);
        return manifest;
    }

    private void enrichAssetDetails(List<OfflineAssetRefDTO> allAssetRefs) {
        Map<String, List<OfflineAssetRefDTO>> byFileId = allAssetRefs.stream()
                .collect(Collectors.groupingBy(OfflineAssetRefDTO::getFileId));
        List<String> distinctIds = new ArrayList<>(byFileId.keySet());
        for (int i = 0; i < distinctIds.size(); i += MAX_ASSET_DETAILS_BATCH) {
            List<String> batch = distinctIds.subList(i, Math.min(i + MAX_ASSET_DETAILS_BATCH, distinctIds.size()));
            List<OfflineAssetDetailsResponseDTO> details = mediaService.getOfflineAssetDetails(batch);
            for (OfflineAssetDetailsResponseDTO d : details) {
                List<OfflineAssetRefDTO> refs = byFileId.get(d.getId());
                if (refs == null) continue;
                for (OfflineAssetRefDTO ref : refs) {
                    ref.setSizeBytes(d.getFileSize());
                    ref.setChecksum(d.getChecksum());
                    ref.setChecksumType(d.getChecksumType());
                }
            }
        }
    }

    private Map<String, Boolean> buildRuleMap(String packageSessionId, String packageId) {
        List<OfflineAccessRule> rules = offlineAccessRuleRepository.findAllForPackageSession(packageSessionId, packageId);
        Map<String, Boolean> map = new HashMap<>();
        for (OfflineAccessRule rule : rules) {
            map.put(key(rule.getSourceType().name(), rule.getSourceId()), rule.getAllow());
        }
        return map;
    }

    private String key(String sourceType, String sourceId) {
        return sourceType + ":" + sourceId;
    }
}
