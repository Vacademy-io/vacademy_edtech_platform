package vacademy.io.admin_core_service.features.learner_study_library.controller;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import vacademy.io.admin_core_service.features.course.dto.CourseDTOWithDetails;
import vacademy.io.admin_core_service.features.learner_quiz.answerkey.AnswerKeySurface;
import vacademy.io.admin_core_service.features.learner_quiz.answerkey.WithoutAnswerKeys;
import vacademy.io.admin_core_service.features.learner_study_library.dto.LearnerModuleDTOWithDetails;
import vacademy.io.admin_core_service.features.learner_study_library.dto.LearnerSubjectProjection;
import vacademy.io.admin_core_service.features.learner_study_library.dto.PublicChapterOutlineDTO;
import vacademy.io.admin_core_service.features.learner_study_library.dto.PublicSlideOutlineDTO;
import vacademy.io.admin_core_service.features.learner_study_library.service.LearnerOpenStudyLibraryService;
import vacademy.io.admin_core_service.features.learner_study_library.util.PublicCourseInstructors;
import vacademy.io.admin_core_service.features.learner_study_library.util.PublicSlideOutlines;
import vacademy.io.admin_core_service.features.study_library.service.StudyLibraryService;
import vacademy.io.admin_core_service.config.cache.ClientCacheable;
import vacademy.io.admin_core_service.config.cache.CacheScope;

import java.util.List;

/**
 * Course structure for pages that need no login. Responses are publicly cacheable, so they hold
 * the outline only (see {@link PublicSlideOutlines}); slide content is served by the signed-in
 * learner endpoints.
 */
@RestController
@RequestMapping("/admin-core-service/open/v1/learner-study-library")
public class OpenLearnerStudyLibraryController {

    @Autowired
    private LearnerOpenStudyLibraryService learnerStudyLibraryService;

    @Autowired
    private StudyLibraryService studyLibraryService;

    @GetMapping("/init-details")
    @ClientCacheable(maxAgeSeconds = 120, scope = CacheScope.PUBLIC, varyHeaders = {"Accept-Language", "X-Package-Session-Id"})
    public ResponseEntity<List<LearnerSubjectProjection>> getLearnerStudyLibraryInitDetails(
        @RequestParam String packageSessionId) {
        return ResponseEntity.ok(learnerStudyLibraryService.getSubjectsByPackageSessionId(packageSessionId));
    }

    @GetMapping("/modules-with-chapters")
    @ClientCacheable(maxAgeSeconds = 120, scope = CacheScope.PUBLIC, varyHeaders = {"Accept-Language", "X-Package-Session-Id"})
    public ResponseEntity<List<LearnerModuleDTOWithDetails>> modulesWithChapters(@RequestParam("subjectId") String subjectId, @RequestParam("packageSessionId") String packageSessionId) {
        return ResponseEntity.ok(learnerStudyLibraryService.getModulesDetailsWithChapters(subjectId, packageSessionId));
    }


    @WithoutAnswerKeys(AnswerKeySurface.OPEN)
    @GetMapping("/slides")
    @ClientCacheable(maxAgeSeconds = 120, scope = CacheScope.PUBLIC, varyHeaders = {"Accept-Language"})
    public ResponseEntity<List<PublicSlideOutlineDTO>> getLearnerSlidesByChapterId(@RequestParam String chapterId) {
        return ResponseEntity.ok(PublicSlideOutlines.fromLearnerSlides(learnerStudyLibraryService.getLearnerSlides(chapterId)));
    }

    @GetMapping("/init")
    @ClientCacheable(maxAgeSeconds = 300, scope = CacheScope.PUBLIC, varyHeaders = {"Accept-Language"})
    public ResponseEntity<List<CourseDTOWithDetails>> initStudyLibrary(String instituteId) {
        return ResponseEntity.ok(PublicCourseInstructors.strip(studyLibraryService.getStudyLibraryInitDetails(instituteId)));
    }

    @GetMapping("/course-init")
    @ClientCacheable(maxAgeSeconds = 300, scope = CacheScope.PUBLIC, varyHeaders = {"Accept-Language"})
    public ResponseEntity<List<CourseDTOWithDetails>> initStudyLibrary(String courseId, String instituteId) {
        return ResponseEntity.ok(PublicCourseInstructors.strip(studyLibraryService.getCourseInitDetails(courseId, instituteId)));
    }

    @WithoutAnswerKeys(AnswerKeySurface.OPEN)
    @GetMapping("/chapters-with-slides")
    @ClientCacheable(maxAgeSeconds = 120, scope = CacheScope.PUBLIC, varyHeaders = {"Accept-Language", "X-Package-Session-Id"})
    public ResponseEntity<List<PublicChapterOutlineDTO>> getChaptersWithSlides(@RequestParam("moduleId") String subjectId, @RequestParam("packageSessionId") String packageSessionId) {
        return ResponseEntity.ok(PublicSlideOutlines.fromChapters(studyLibraryService.getChaptersWithSlides(subjectId, packageSessionId, null)));
    }
}
