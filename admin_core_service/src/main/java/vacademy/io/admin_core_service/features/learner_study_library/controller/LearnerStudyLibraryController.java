package vacademy.io.admin_core_service.features.learner_study_library.controller;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import vacademy.io.admin_core_service.features.learner_study_library.dto.LearnerChapterSlidesDTO;
import vacademy.io.admin_core_service.features.learner_study_library.dto.LearnerModuleDTOWithDetails;
import vacademy.io.admin_core_service.features.learner_study_library.dto.LearnerSlidesDetailDTO;
import vacademy.io.admin_core_service.features.learner_study_library.dto.LearnerSubjectProjection;
import vacademy.io.admin_core_service.features.learner_study_library.service.LearnerContentAccessGuard;
import vacademy.io.admin_core_service.features.learner_study_library.service.LearnerStudyLibraryService;
import vacademy.io.admin_core_service.features.slide.dto.SlideDetailProjection;
import vacademy.io.admin_core_service.features.study_library.dto.ChapterDTOWithDetails;
import vacademy.io.admin_core_service.features.study_library.dto.ModuleDTOWithDetails;
import vacademy.io.admin_core_service.features.study_library.service.StudyLibraryService;
import vacademy.io.admin_core_service.features.translation.dto.AvailableLanguagesResponseDTO;
import vacademy.io.admin_core_service.features.translation.service.ContentTranslationService;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.admin_core_service.config.cache.ClientCacheable;
import vacademy.io.admin_core_service.config.cache.CacheScope;

import java.util.List;

@RestController
@RequestMapping("/admin-core-service/v1/learner-study-library")
public class LearnerStudyLibraryController {
    @Autowired
    private LearnerStudyLibraryService learnerStudyLibraryService;

    @Autowired
    private StudyLibraryService studyLibraryService;

    @Autowired
    private ContentTranslationService contentTranslationService;

    /** Enrollment check for learners; off unless learner.content.enrollment-guard.enabled. */
    @Autowired
    private LearnerContentAccessGuard contentAccessGuard;

    @GetMapping("/init-details")
    @ClientCacheable(maxAgeSeconds = 0, scope = CacheScope.NO_STORE, varyHeaders = {"X-User-Id", "X-Package-Session-Id", "Accept-Language"})
    public ResponseEntity<List<LearnerSubjectProjection>> getLearnerStudyLibraryInitDetails(
            @RequestParam String packageSessionId,
            @RequestAttribute("user") CustomUserDetails user) {
        contentAccessGuard.requireEnrolled(user, packageSessionId);
        return ResponseEntity.ok(learnerStudyLibraryService.getSubjectsByPackageSessionId(packageSessionId, user));
    }

    @GetMapping("/modules-with-chapters")
    @ClientCacheable(maxAgeSeconds = 0, scope = CacheScope.NO_STORE, varyHeaders = {"X-User-Id", "X-Package-Session-Id", "Accept-Language"})
    public ResponseEntity<List<LearnerModuleDTOWithDetails>> modulesWithChapters(@RequestParam("subjectId") String subjectId, @RequestParam("packageSessionId") String packageSessionId, @RequestAttribute("user") CustomUserDetails user) {
        contentAccessGuard.requireEnrolled(user, packageSessionId);
        return ResponseEntity.ok(learnerStudyLibraryService.getModulesDetailsWithChapters(subjectId, packageSessionId, user));
    }

    @GetMapping("/get-slides/{chapterId}")
    @ClientCacheable(maxAgeSeconds = 0, scope = CacheScope.NO_STORE, varyHeaders = {"X-User-Id", "Accept-Language"})
    public ResponseEntity<List<SlideDetailProjection>> getSlidesByChapterId(@PathVariable String chapterId, @RequestAttribute("user") CustomUserDetails user) {
        return ResponseEntity.ok(learnerStudyLibraryService.getSlidesByChapterId(chapterId, user));
    }

    @GetMapping("/slides")
    @ClientCacheable(maxAgeSeconds = 0, scope = CacheScope.NO_STORE, varyHeaders = {"X-User-Id", "Accept-Language"})
    public ResponseEntity<List<LearnerSlidesDetailDTO>> getLearnerSlidesByChapterId(@RequestParam String chapterId, @RequestAttribute("user") CustomUserDetails user) {
        return ResponseEntity.ok(learnerStudyLibraryService.getLearnerSlides(chapterId, user));
    }

    /**
     * Bulk form of {@code /slides}: learner slides for every chapter of the
     * package session in one round trip, grouped per chapter. Replaces the
     * per-chapter request storm the course-details page used to fire (one GET
     * per chapter — hundreds on large courses).
     */
    @GetMapping("/slides-by-package-session")
    @ClientCacheable(maxAgeSeconds = 0, scope = CacheScope.NO_STORE, varyHeaders = {"X-User-Id", "X-Package-Session-Id", "Accept-Language"})
    public ResponseEntity<List<LearnerChapterSlidesDTO>> getLearnerSlidesByPackageSession(@RequestParam String packageSessionId, @RequestAttribute("user") CustomUserDetails user) {
        contentAccessGuard.requireEnrolled(user, packageSessionId);
        return ResponseEntity.ok(learnerStudyLibraryService.getLearnerSlidesByPackageSession(packageSessionId, user));
    }

    /**
     * Locales with learner-visible translated content for the package session
     * (from content_translation_coverage; empty list when none). Additive,
     * backward-compatible — lets the learner app offer a language picker.
     */
    @GetMapping("/available-languages")
    public ResponseEntity<AvailableLanguagesResponseDTO> getAvailableLanguages(
            @RequestParam String packageSessionId,
            @RequestAttribute("user") CustomUserDetails user) {
        return ResponseEntity.ok(new AvailableLanguagesResponseDTO(
                packageSessionId, contentTranslationService.getAvailableLanguages(packageSessionId)));
    }

    @GetMapping("/chapters-with-slides")
    public ResponseEntity<List<ChapterDTOWithDetails>>getChaptersWithSlides(@RequestParam("moduleId") String subjectId, @RequestParam("packageSessionId") String packageSessionId) {
        return ResponseEntity.ok(studyLibraryService.getChaptersWithSlides(subjectId, packageSessionId, null));
    }

    @GetMapping("/modules-chapters-slides")
    public ResponseEntity<List<LearnerModuleDTOWithDetails>>getModuleChapterSlides(@RequestParam("subjectId") String subjectId, @RequestParam("packageSessionId") String packageSessionId,@RequestAttribute("user")CustomUserDetails userDetails) {
        contentAccessGuard.requireEnrolled(userDetails, packageSessionId);
        return ResponseEntity.ok(learnerStudyLibraryService.getModulesDetailsWithChaptersAndSlides(subjectId, packageSessionId, userDetails));
    }

}
