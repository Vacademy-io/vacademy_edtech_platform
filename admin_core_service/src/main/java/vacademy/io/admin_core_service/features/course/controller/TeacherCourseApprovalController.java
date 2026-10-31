package vacademy.io.admin_core_service.features.course.controller;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import vacademy.io.admin_core_service.config.cache.ClientCacheable;
import vacademy.io.admin_core_service.config.cache.CacheScope;
import vacademy.io.admin_core_service.features.course.dto.TeacherCourseDetailDTO;
import vacademy.io.admin_core_service.features.course.service.CourseApprovalService;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.VacademyException;
import vacademy.io.common.institute.entity.PackageEntity;

import java.util.ArrayList;
import java.util.List;

@RestController
@RequestMapping("/admin-core-service/teacher/course-approval/v1")
@RequiredArgsConstructor
@Slf4j
public class TeacherCourseApprovalController {

    private final CourseApprovalService courseApprovalService;

    /**
     * Get teacher's own courses (draft, in review, published)
     */
    @GetMapping("/my-courses")
    public ResponseEntity<List<PackageEntity>> getTeacherCourses(@RequestAttribute("user") CustomUserDetails teacher) {
        List<PackageEntity> courses = courseApprovalService.getTeacherCoursesWithValidation(teacher.getUserId());
        return ResponseEntity.ok(courses);
    }

    /**
     * Enhanced endpoint that provides detailed information about teacher's relationship to each course
     * Returns structured data with relationship metadata like whether teacher is creator or faculty-assigned, 
     * number of assignments, and assigned subjects
     */
    @GetMapping("/my-courses/detailed")
    public ResponseEntity<List<TeacherCourseDetailDTO>> getTeacherCoursesWithDetails(@RequestAttribute("user") CustomUserDetails teacher) {
        try {
            List<TeacherCourseDetailDTO> coursesWithDetails = courseApprovalService.getTeacherCoursesAsDTO(teacher.getUserId());
            return ResponseEntity.ok(coursesWithDetails);
        } catch (Exception e) {
            log.error("Error getting teacher courses with details for {}: {}", teacher.getUserId(), e.getMessage());
            return ResponseEntity.ok(new ArrayList<>()); // Return empty list on error
        }
    }

    /**
     * V2: Enhanced endpoint that provides detailed information about teacher's relationship to each course
     * Returns structured data with relationship metadata like whether teacher is creator or faculty-assigned, 
     * number of assignments, and assigned subjects
     * Includes DELETED filter and pagination support
     */
    @GetMapping("/my-courses/detailed/v2")
    @ClientCacheable(maxAgeSeconds = 120, scope = CacheScope.PRIVATE, varyHeaders = {"X-User-Id"})
    public ResponseEntity<Page<TeacherCourseDetailDTO>> getTeacherCoursesWithDetailsV2(
            @RequestAttribute("user") CustomUserDetails teacher,
            Pageable pageable) {
        try {
            Page<TeacherCourseDetailDTO> coursesWithDetails = courseApprovalService
                    .getTeacherCoursesAsDTOV2(teacher.getUserId(), pageable);
            return ResponseEntity.ok(coursesWithDetails);
        } catch (VacademyException e) {
            log.error("Validation error getting teacher courses with details for {}: {}", teacher.getUserId(), e.getMessage());
            return ResponseEntity.badRequest().build();
        } catch (Exception e) {
            log.error("Unexpected error getting teacher courses with details for {}: {}", teacher.getUserId(), e.getMessage(), e);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).build();
        }
    }

    /**
     * Create an editable copy of a published course
     */
    @PostMapping("/create-editable-copy")
    public ResponseEntity<String> createEditableCopy(
            @RequestParam String originalCourseId,
            @RequestAttribute("user") CustomUserDetails teacher) {
        String tempCourseId = courseApprovalService.createEditableCopyWithValidation(originalCourseId, teacher);
        return ResponseEntity.ok("Editable copy created with ID: " + tempCourseId);
    }

    /**
     * Submit course for admin review
     */
    @PostMapping("/submit-for-review")
    public ResponseEntity<String> submitForReview(
            @RequestParam String courseId,
            @RequestAttribute("user") CustomUserDetails teacher) {
        String result = courseApprovalService.submitForReviewWithValidation(courseId, teacher);
        return ResponseEntity.ok(result);
    }

    /**
     * Publish own draft course directly (no admin review). The FE only offers
     * this when the role's "Require approval before publishing" toggle is off.
     */
    @PostMapping("/publish")
    public ResponseEntity<String> publishCourse(
            @RequestParam String courseId,
            @RequestAttribute("user") CustomUserDetails teacher) {
        String result = courseApprovalService.publishByTeacher(courseId, teacher);
        return ResponseEntity.ok(result);
    }

    /**
     * Withdraw course from review (return to draft)
     */
    @PostMapping("/withdraw-from-review")
    public ResponseEntity<String> withdrawFromReview(
            @RequestParam String courseId,
            @RequestAttribute("user") CustomUserDetails teacher) {
        try {
            String result = courseApprovalService.withdrawFromReview(courseId, teacher);
            return ResponseEntity.ok(result);
        } catch (Exception e) {
            return ResponseEntity.badRequest().body("Error: " + e.getMessage());
        }
    }

    /**
     * Check if teacher can edit a specific course
     */
    @GetMapping("/can-edit/{courseId}")
    public ResponseEntity<Boolean> canEditCourse(
            @PathVariable String courseId,
            @RequestAttribute("user") CustomUserDetails teacher) {
        boolean canEdit = courseApprovalService.canTeacherEditCourse(courseId, teacher.getUserId());
        return ResponseEntity.ok(canEdit);
    }

    /**
     * Get course approval history for teacher's own course
     */
    @GetMapping("/my-course-history/{courseId}")
    public ResponseEntity<Object> getMyCourseHistory(
            @PathVariable String courseId,
            @RequestAttribute("user") CustomUserDetails teacher) {
        try {
            // Validate teacher owns this course first
            courseApprovalService.validateTeacherCoursePermissions(courseId, teacher.getUserId(), "view");
            Object history = courseApprovalService.getCourseApprovalHistory(courseId);
            return ResponseEntity.ok(history);
        } catch (Exception e) {
            return ResponseEntity.badRequest().body("Error: " + e.getMessage());
        }
    }
} 