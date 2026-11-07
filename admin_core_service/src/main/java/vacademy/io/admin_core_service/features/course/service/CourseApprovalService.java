package vacademy.io.admin_core_service.features.course.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.Pageable;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.admin_core_service.features.chapter.entity.Chapter;
import vacademy.io.admin_core_service.features.chapter.entity.ChapterPackageSessionMapping;
import vacademy.io.admin_core_service.features.chapter.repository.ChapterPackageSessionMappingRepository;
import vacademy.io.admin_core_service.features.chapter.repository.ChapterRepository;
import vacademy.io.admin_core_service.features.chapter.service.ChapterManager;
import vacademy.io.admin_core_service.features.common.enums.StatusEnum;
import vacademy.io.admin_core_service.features.course.dto.TeacherCourseDetailDTO;
import vacademy.io.admin_core_service.features.course_knowledge.service.ContentIndexMarker;
import vacademy.io.admin_core_service.features.enroll_invite.enums.EnrollInviteTag;
import vacademy.io.admin_core_service.features.enroll_invite.repository.EnrollInviteRepository;
import vacademy.io.admin_core_service.features.enroll_invite.service.DefaultEnrollInviteService;
import vacademy.io.admin_core_service.features.enroll_invite.service.EnrollInviteService;
import vacademy.io.admin_core_service.features.enroll_invite.service.PackageSessionEnrollInviteToPaymentOptionService;
import vacademy.io.admin_core_service.features.faculty.repository.FacultySubjectPackageSessionMappingRepository;
import vacademy.io.admin_core_service.features.faculty.entity.FacultySubjectPackageSessionMapping;
import vacademy.io.admin_core_service.features.module.entity.ModuleChapterMapping;
import vacademy.io.admin_core_service.features.module.entity.SubjectModuleMapping;
import vacademy.io.admin_core_service.features.module.repository.ModuleChapterMappingRepository;
import vacademy.io.admin_core_service.features.module.repository.ModuleRepository;
import vacademy.io.admin_core_service.features.module.repository.SubjectModuleMappingRepository;
import vacademy.io.admin_core_service.features.module.service.ModuleManager;
import vacademy.io.admin_core_service.features.packages.enums.PackageStatusEnum;
import vacademy.io.admin_core_service.features.packages.enums.PackageSessionStatusEnum;
import vacademy.io.admin_core_service.features.packages.repository.PackageRepository;
import vacademy.io.admin_core_service.features.packages.repository.PackageSessionRepository;
import vacademy.io.admin_core_service.features.packages.repository.PackageInstituteRepository;
import vacademy.io.admin_core_service.features.packages.service.PackagePageContentService;
import vacademy.io.admin_core_service.features.institute.repository.InstituteRepository;
import vacademy.io.admin_core_service.features.slide.entity.Slide;
import vacademy.io.admin_core_service.features.slide.repository.SlideRepository;
import vacademy.io.admin_core_service.features.slide.service.SlideService;
import vacademy.io.admin_core_service.features.subject.entity.SubjectPackageSession;
import vacademy.io.admin_core_service.features.subject.repository.SubjectPackageSessionRepository;
import vacademy.io.admin_core_service.features.subject.repository.SubjectRepository;
import vacademy.io.admin_core_service.features.subject.service.SubjectService;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.VacademyException;
import vacademy.io.common.institute.entity.PackageEntity;
import vacademy.io.common.institute.entity.PackageInstitute;
import vacademy.io.common.institute.entity.Institute;
import vacademy.io.common.institute.entity.module.Module;
import vacademy.io.common.institute.entity.session.PackageSession;
import vacademy.io.common.institute.entity.student.Subject;
import vacademy.io.admin_core_service.features.chapter.entity.ChapterToSlides;
import vacademy.io.admin_core_service.features.chapter.repository.ChapterToSlidesRepository;

import java.util.*;
import java.util.stream.Collectors;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.core.type.TypeReference;

@Slf4j
@Service
@RequiredArgsConstructor
public class CourseApprovalService {

    private final PackageRepository packageRepository;
    private final PackageSessionRepository packageSessionRepository;
    private final SubjectRepository subjectRepository;
    private final ModuleRepository moduleRepository;
    private final ChapterRepository chapterRepository;
    private final SlideRepository slideRepository;
    private final SubjectPackageSessionRepository subjectPackageSessionRepository;
    private final SubjectModuleMappingRepository subjectModuleMappingRepository;
    private final ModuleChapterMappingRepository moduleChapterMappingRepository;
    private final ChapterPackageSessionMappingRepository chapterPackageSessionMappingRepository;
    private final FacultySubjectPackageSessionMappingRepository facultySubjectPackageSessionMappingRepository;
    private final ChapterManager chapterManager;
    private final ModuleManager moduleManager;
    private final SlideService slideService;
    private final SubjectService subjectService;
    private final ChapterToSlidesRepository chapterToSlidesRepository;    private final PackageInstituteRepository packageInstituteRepository;
    private final InstituteRepository instituteRepository;
    private final DefaultEnrollInviteService defaultEnrollInviteService;
    private final ObjectMapper objectMapper = new ObjectMapper();
    private final EnrollInviteService enrollInviteService;
    private final PackagePageContentService packagePageContentService;
    private final ContentIndexMarker contentIndexMarker;
    /**
     * Create a temporary copy of a published course for teacher editing
     */
    @Transactional
    public String createEditableCopy(String originalCourseId, CustomUserDetails teacher) {
        PackageEntity originalPackage = packageRepository.findById(originalCourseId)
                .orElseThrow(() -> new VacademyException("Original course not found"));

        if (!PackageStatusEnum.ACTIVE.name().equals(originalPackage.getStatus())) {
            throw new VacademyException("Can only create editable copies of published courses");
        }

        // Create temp package copy
        PackageEntity tempPackage = copyPackageEntity(originalPackage, teacher.getUserId());
        tempPackage = packageRepository.save(tempPackage);

        // Copy entire course hierarchy
        copyEntireCourseHierarchy(originalPackage, tempPackage, teacher.getUserId());

        // Copy package-institute linkages
        copyPackageInstituteLinkages(originalPackage, tempPackage);

        // Course page content (FAQs, mode) lives in its own table, not on the package row
        packagePageContentService.copy(originalPackage.getId(), tempPackage.getId());

        appendAuditLog(tempPackage, "ADD", teacher.getUserId(),
                "Created editable copy from original " + originalCourseId, null);
        log.info("Created editable copy {} for original course {} by teacher {}", 
                tempPackage.getId(), originalCourseId, teacher.getUserId());
        
        return tempPackage.getId();
    }

    /**
     * Submit teacher's course for admin review
     */
    @Transactional
    public String submitForReview(String courseId, CustomUserDetails teacher) {
        PackageEntity course = packageRepository.findById(courseId)
                .orElseThrow(() -> new VacademyException("Course not found"));

        if (!PackageStatusEnum.DRAFT.name().equals(course.getStatus())) {
            throw new VacademyException("Only draft courses can be submitted for review");
        }

        if (!teacher.getUserId().equals(course.getCreatedByUserId())) {
            throw new VacademyException("Only the course creator can submit for review");
        }

        course.setStatus(PackageStatusEnum.IN_REVIEW.name());
        packageRepository.save(course);
        appendAuditLog(course, "SUBMIT", teacher.getUserId(), "Submitted course for review", null);

        log.info("Course {} submitted for review by teacher {}", courseId, teacher.getUserId());
        return "Course submitted for review successfully";
    }

    /**
     * Teacher publishes their own DRAFT course directly, skipping the
     * IN_REVIEW -> admin-approve step. Used when the role's display settings
     * have "Require approval before publishing" switched off. Runs the same
     * publish / merge logic as admin approval, with the teacher as the actor.
     */
    @Transactional
    public String publishByTeacher(String courseId, CustomUserDetails teacher) {
        PackageEntity course = packageRepository.findById(courseId)
                .orElseThrow(() -> new VacademyException("Course not found"));

        if (!PackageStatusEnum.DRAFT.name().equals(course.getStatus())) {
            throw new VacademyException("Only draft courses can be published");
        }

        if (!teacher.getUserId().equals(course.getCreatedByUserId())) {
            throw new VacademyException("Only the course creator can publish this course");
        }

        validateCourseContent(course);
        PackageInstitute packageInstitute = packageInstituteRepository.findTopByPackageEntity_IdOrderByCreatedAtDesc(courseId).orElse(null);
        String result;
        if (course.getOriginalCourseId() != null) {
            // Editable copy of a published course - merge changes back
            result = mergeChangesIntoOriginal(course, packageInstitute);
            deleteTempCourse(course);
        } else {
            // Brand-new course - publish as active
            result = publishNewCourse(course, packageInstitute);
        }

        log.info("Course {} published directly by teacher {}", courseId, teacher.getUserId());
        appendAuditLog(course, "SELF_PUBLISH", teacher.getUserId(), "Published course without admin review", null);
        return result;
    }

    /**
     * Withdraw course from review back to draft
     */
    @Transactional
    public String withdrawFromReview(String courseId, CustomUserDetails teacher) {
        PackageEntity course = packageRepository.findById(courseId)
                .orElseThrow(() -> new VacademyException("Course not found"));

        if (!PackageStatusEnum.IN_REVIEW.name().equals(course.getStatus())) {
            throw new VacademyException("Only courses in review can be withdrawn");
        }

        if (!teacher.getUserId().equals(course.getCreatedByUserId())) {
            throw new VacademyException("Only the course creator can withdraw from review");
        }

        course.setStatus(PackageStatusEnum.DRAFT.name());
        packageRepository.save(course);
        appendAuditLog(course, "WITHDRAW", teacher.getUserId(), "Withdrew course from review", null);

        log.info("Course {} withdrawn from review by teacher {}", courseId, teacher.getUserId());
        return "Course withdrawn from review successfully";
    }

    /**
     * Admin approves a course - merges changes into original or creates new
     */
    @Transactional
    public String approveCourse(String tempCourseId, CustomUserDetails admin) {
        return approveCourse(tempCourseId, admin, null);
    }

    /**
     * Admin approves a course with optional comment
     */
    @Transactional
    public String approveCourse(String tempCourseId, CustomUserDetails admin, String comment) {
        PackageEntity tempCourse = packageRepository.findById(tempCourseId)
                .orElseThrow(() -> new VacademyException("Course not found"));

        validateCourseForApproval(tempCourse);
        PackageInstitute packageInstitute = packageInstituteRepository.findTopByPackageEntity_IdOrderByCreatedAtDesc(tempCourseId).orElse(null);
        String result;
        if (tempCourse.getOriginalCourseId() != null) {
            // Editing existing course - merge changes
            result = mergeChangesIntoOriginal(tempCourse,packageInstitute);
              // Clean up temp course
            deleteTempCourse(tempCourse);
        } else {
            // New course - publish as active
            result = publishNewCourse(tempCourse,packageInstitute);
        }
      

        log.info("Course {} approved by admin {}", tempCourseId, admin.getId());
        appendAuditLog(tempCourse, "APPROVE", admin.getUserId(), "Approved course", comment);
        return result;
    }

    /**
     * Admin rejects a course
     */
    @Transactional
    public String rejectCourse(String tempCourseId, String reason, CustomUserDetails admin) {
        PackageEntity tempCourse = packageRepository.findById(tempCourseId)
                .orElseThrow(() -> new VacademyException("Course not found"));

        validateCourseForApproval(tempCourse);

        tempCourse.setStatus(PackageStatusEnum.DRAFT.name());
        packageRepository.save(tempCourse);

        log.info("Course {} rejected by admin {} with reason: {}", tempCourseId, admin.getId(), reason);
        appendAuditLog(tempCourse, "REJECT", admin.getUserId(), "Rejected course", reason);
        return "Course rejected and sent back to draft";
    }

    /**
     * Get teacher's courses with enhanced logic:
     * 1. Courses created by the teacher (created_by_user_id = teacherId)
     * 2. Courses where teacher is assigned as faculty to any package session
     * 
     * This provides a comprehensive view of all courses the teacher is involved with
     */
    public List<PackageEntity> getTeacherCourses(String teacherId) {
        List<String> packageStatuses = Arrays.asList(
            PackageStatusEnum.DRAFT.name(), 
            PackageStatusEnum.IN_REVIEW.name(), 
            PackageStatusEnum.ACTIVE.name()
        );
        
        List<String> facultyMappingStatuses = Arrays.asList(
            "ACTIVE"  // Only consider active faculty assignments
        );
        
        return packageRepository.findTeacherPackagesByCreatedOrFacultyAssignment(
            teacherId, 
            packageStatuses, 
            facultyMappingStatuses
        );
    }

    /**
     * Enhanced method to get teacher's courses with detailed relationship information
     * Returns additional metadata about how the teacher is related to each course
     */
    public List<Map<String, Object>> getTeacherCoursesWithDetails(String teacherId) {
        List<String> packageStatuses = Arrays.asList(
            PackageStatusEnum.DRAFT.name(), 
            PackageStatusEnum.IN_REVIEW.name(), 
            PackageStatusEnum.ACTIVE.name()
        );
        
        List<String> facultyMappingStatuses = Arrays.asList(
            "ACTIVE"  // Only consider active faculty assignments
        );
        
        return packageRepository.findTeacherPackagesWithRelationshipDetails(
            teacherId, 
            packageStatuses, 
            facultyMappingStatuses
        );
    }
    
    /**
     * Get teacher's courses with structured DTO response including relationship details
     */
    public List<TeacherCourseDetailDTO> getTeacherCoursesAsDTO(String teacherId) {
        List<Map<String, Object>> rawResults = getTeacherCoursesWithDetails(teacherId);
        
        return rawResults.stream()
            .map(TeacherCourseDetailDTO::fromDatabaseResult)
            .collect(Collectors.toList());
    }

    /**
     * V2: Enhanced method to get teacher's courses with detailed relationship information
     * Includes DELETED filter and pagination support
     */
    public Page<Map<String, Object>> getTeacherCoursesWithDetailsV2(String teacherId, Pageable pageable) {
        List<String> packageStatuses = Arrays.asList(
            PackageStatusEnum.DRAFT.name(), 
            PackageStatusEnum.IN_REVIEW.name(), 
            PackageStatusEnum.ACTIVE.name()
        );
        
        List<String> facultyMappingStatuses = Arrays.asList(
            "ACTIVE"  // Only consider active faculty assignments
        );
        
        return packageRepository.findTeacherPackagesWithRelationshipDetailsV2(
                teacherId,
                packageStatuses,
                facultyMappingStatuses,
                pageable);
    }
    
    /**
     * V2: Get teacher's courses with structured DTO response including relationship details
     * Includes DELETED filter and pagination support
     */
    public Page<TeacherCourseDetailDTO> getTeacherCoursesAsDTOV2(String teacherId, Pageable pageable) {
        Page<Map<String, Object>> rawResults = getTeacherCoursesWithDetailsV2(teacherId, pageable);
        
        List<TeacherCourseDetailDTO> dtoList = rawResults.getContent().stream()
            .map(TeacherCourseDetailDTO::fromDatabaseResult)
            .collect(Collectors.toList());
        
        return new PageImpl<>(
            dtoList,
            rawResults.getPageable(),
            rawResults.getTotalElements()
        );
    }

    /**
     * Get courses pending admin review
     */
    public List<PackageEntity> getCoursesForReview(String instituteId) {
        return packageRepository.findByStatusAndInstitute(PackageStatusEnum.IN_REVIEW.name(), instituteId);
    }

    /**
     * Check if teacher can edit a specific course
     */
    public boolean canTeacherEditCourse(String courseId, String teacherId) {
        try {
            PackageEntity course = packageRepository.findById(courseId).orElse(null);
            if (course == null) {
                return false;
            }
            return PackageStatusEnum.DRAFT.name().equals(course.getStatus()) 
                    && teacherId.equals(course.getCreatedByUserId());
        } catch (Exception e) {
            log.error("Error checking teacher edit permissions for course {}: {}", courseId, e.getMessage());
            return false;
        }
    }

    /**
     * Validate course before approval
     */
    private void validateCourseForApproval(PackageEntity course) {
        if (course == null) {
            throw new VacademyException("Course cannot be null");
        }
        
        if (!PackageStatusEnum.IN_REVIEW.name().equals(course.getStatus())) {
            throw new VacademyException("Only courses in review can be approved or rejected");
        }
        
        if (course.getCreatedByUserId() == null) {
            throw new VacademyException("Course must have a creator");
        }
        
        // Validate course content exists
        validateCourseContent(course);
        
        log.info("Course {} passed validation for approval", course.getId());
    }

    /**
     * Validate that course has required content
     */
    private void validateCourseContent(PackageEntity course) {
        try {
            List<PackageSession> packageSessions = packageSessionRepository.findByPackageEntityId(course.getId());
            if (packageSessions.isEmpty()) {
                throw new VacademyException("Course must have at least one package session");
            }
            
            // Check if course has subjects
            boolean hasContent = false;
            for (PackageSession session : packageSessions) {
                List<Subject> subjects = subjectRepository.findDistinctSubjectsByPackageSessionId(session.getId());
                if (!subjects.isEmpty()) {
                    hasContent = true;
                    break;
                }
            }
            
            if (!hasContent) {
                log.warn("Course {} has no subjects but approval proceeding", course.getId());
            }
            
        } catch (Exception e) {
            log.error("Error validating course content for {}: {}", course.getId(), e.getMessage());
            // Continue with approval even if content validation fails
        }
    }

    /**
     * Validate teacher permissions for course operations
     */
    private void validateTeacherPermissions(String courseId, String teacherId, String operation) {
        PackageEntity course = packageRepository.findById(courseId)
                .orElseThrow(() -> new VacademyException("Course not found"));
        
        if (!teacherId.equals(course.getCreatedByUserId())) {
            throw new VacademyException("You don't have permission to " + operation + " this course");
        }
        
        if (PackageStatusEnum.IN_REVIEW.name().equals(course.getStatus()) && !"withdraw".equals(operation)) {
            throw new VacademyException("Cannot " + operation + " course while it's under review");
        }
    }

    /**
     * Validate course for submission to review
     */
    private void validateCourseForReview(PackageEntity course) {
        if (course == null) {
            throw new VacademyException("Course cannot be null");
        }
        
        if (!PackageStatusEnum.DRAFT.name().equals(course.getStatus())) {
            throw new VacademyException("Only draft courses can be submitted for review");
        }
        
        // Validate course has minimum required content
        validateMinimumCourseContent(course);
    }

    /**
     * Validate course has minimum required content for review
     */
    private void validateMinimumCourseContent(PackageEntity course) {
        if (course.getPackageName() == null || course.getPackageName().trim().isEmpty()) {
            throw new VacademyException("Course must have a name");
        }
        
        List<PackageSession> packageSessions = packageSessionRepository.findByPackageEntityId(course.getId());
        if (packageSessions.isEmpty()) {
            throw new VacademyException("Course must have at least one level and session");
        }
        
        // Check for at least one subject with content
        boolean hasSubjectWithContent = false;
        for (PackageSession session : packageSessions) {
            List<Subject> subjects = subjectRepository.findDistinctSubjectsByPackageSessionId(session.getId());
            for (Subject subject : subjects) {
                List<SubjectModuleMapping> modules = subjectModuleMappingRepository.findBySubjectId(subject.getId());
                if (!modules.isEmpty()) {
                    hasSubjectWithContent = true;
                    break;
                }
            }
            if (hasSubjectWithContent) break;
        }
        
        if (!hasSubjectWithContent) {
            throw new VacademyException("Course must have at least one subject with modules before submission");
        }
    }

    /**
     * Validate parameters for copy operations
     */
    private void validateCopyParameters(String originalCourseId, String teacherId) {
        if (originalCourseId == null || originalCourseId.trim().isEmpty()) {
            throw new VacademyException("Original course ID cannot be empty");
        }
        
        if (teacherId == null || teacherId.trim().isEmpty()) {
            throw new VacademyException("Teacher ID cannot be empty");
        }
        
        PackageEntity originalCourse = packageRepository.findById(originalCourseId)
                .orElseThrow(() -> new VacademyException("Original course not found"));
        
        if (!PackageStatusEnum.ACTIVE.name().equals(originalCourse.getStatus())) {
            throw new VacademyException("Can only create copies of published courses");
        }
    }

    /**
     * Enhanced error handling for copy operations
     */
    @Transactional
    public String createEditableCopyWithValidation(String originalCourseId, CustomUserDetails teacher) {
        try {
            validateCopyParameters(originalCourseId, teacher.getUserId());
            return createEditableCopy(originalCourseId, teacher);
        } catch (VacademyException e) {
            log.error("Validation failed for creating editable copy: {}", e.getMessage());
            throw e;
        } catch (Exception e) {
            log.error("Unexpected error creating editable copy of course {}: {}", originalCourseId, e.getMessage());
            throw new VacademyException("Failed to create editable copy: " + e.getMessage());
        }
    }

    /**
     * Enhanced error handling for submission
     */
    @Transactional
    public String submitForReviewWithValidation(String courseId, CustomUserDetails teacher) {
        try {
            PackageEntity course = packageRepository.findById(courseId)
                    .orElseThrow(() -> new VacademyException("Course not found"));
            
            validateTeacherPermissions(courseId, teacher.getUserId(), "submit");
            validateCourseForReview(course);
            
            return submitForReview(courseId, teacher);
        } catch (VacademyException e) {
            log.error("Validation failed for submitting course {}: {}", courseId, e.getMessage());
            throw e;
        } catch (Exception e) {
            log.error("Unexpected error submitting course {} for review: {}", courseId, e.getMessage());
            throw new VacademyException("Failed to submit course for review: " + e.getMessage());
        }
    }

    /**
     * Enhanced error handling for approval
     */
    @Transactional
    public String approveCourseWithValidation(String tempCourseId, CustomUserDetails admin) {
        try {
            PackageEntity tempCourse = packageRepository.findById(tempCourseId)
                    .orElseThrow(() -> new VacademyException("Course not found"));

            validateCourseForApproval(tempCourse);

            return approveCourse(tempCourseId, admin, null);
        } catch (VacademyException e) {
            log.error("Validation failed for approving course {}: {}", tempCourseId, e.getMessage());
            throw e;
        } catch (Exception e) {
            log.error("Unexpected error approving course {}: {}", tempCourseId, e.getMessage());
            throw new VacademyException("Failed to approve course: " + e.getMessage());
        }
    }

    /**
     * Enhanced error handling for approval with optional comment
     */
    @Transactional
    public String approveCourseWithValidation(String tempCourseId, CustomUserDetails admin, String comment) {
        try {
            PackageEntity tempCourse = packageRepository.findById(tempCourseId)
                    .orElseThrow(() -> new VacademyException("Course not found"));

            validateCourseForApproval(tempCourse);

            return approveCourse(tempCourseId, admin, comment);
        } catch (VacademyException e) {
            log.error("Validation failed for approving course {}: {}", tempCourseId, e.getMessage());
            throw e;
        } catch (Exception e) {
            log.error("Unexpected error approving course {}: {}", tempCourseId, e.getMessage());
            throw new VacademyException("Failed to approve course: " + e.getMessage());
        }
    }

    /**
     * Enhanced error handling for rejection
     */
    @Transactional
    public String rejectCourseWithValidation(String tempCourseId, String reason, CustomUserDetails admin) {
        try {
            if (reason == null || reason.trim().isEmpty()) {
                throw new VacademyException("Rejection reason is required");
            }
            
            if (reason.length() > 1000) {
                throw new VacademyException("Rejection reason cannot exceed 1000 characters");
            }
            
            return rejectCourse(tempCourseId, reason, admin);
        } catch (VacademyException e) {
            log.error("Validation failed for rejecting course {}: {}", tempCourseId, e.getMessage());
            throw e;
        } catch (Exception e) {
            log.error("Unexpected error rejecting course {}: {}", tempCourseId, e.getMessage());
            throw new VacademyException("Failed to reject course: " + e.getMessage());
        }
    }

    /**
     * Validate and get teacher courses with error handling
     */
    public List<PackageEntity> getTeacherCoursesWithValidation(String teacherId) {
        try {
            if (teacherId == null || teacherId.trim().isEmpty()) {
                throw new VacademyException("Teacher ID cannot be empty");
            }
            
            return getTeacherCourses(teacherId);
        } catch (Exception e) {
            log.error("Error getting teacher courses for {}: {}", teacherId, e.getMessage());
            return new ArrayList<>(); // Return empty list instead of throwing exception
        }
    }

    /**
     * Validate course copying prerequisites
     */
    private void validateCopyingPrerequisites(PackageEntity originalPackage, String teacherId) {
        // Check if teacher already has a draft copy of this course
        List<PackageEntity> existingCopies = packageRepository.findByOriginalCourseIdAndCreatedByUserIdAndStatus(
                originalPackage.getId(), teacherId, PackageStatusEnum.DRAFT.name());
        
        if (!existingCopies.isEmpty()) {
            throw new VacademyException("You already have a draft copy of this course. Please complete or delete the existing copy first.");
        }
        
        // Check if there's already a copy in review
        List<PackageEntity> reviewCopies = packageRepository.findByOriginalCourseIdAndCreatedByUserIdAndStatus(
                originalPackage.getId(), teacherId, PackageStatusEnum.IN_REVIEW.name());
        
        if (!reviewCopies.isEmpty()) {
            throw new VacademyException("You already have a copy of this course under review. Please wait for approval or withdraw the existing submission.");
        }
    }

    /**
     * Public method to validate teacher permissions for controllers
     */
    public void validateTeacherCoursePermissions(String courseId, String teacherId, String operation) {
        validateTeacherPermissions(courseId, teacherId, operation);
    }

    /**
     * Get course history and lineage for admin review
     */
    public CourseApprovalHistory getCourseApprovalHistory(String courseId) {
        PackageEntity course = packageRepository.findById(courseId)
                .orElseThrow(() -> new VacademyException("Course not found"));
        
        CourseApprovalHistory history = new CourseApprovalHistory();
        history.setCourseId(courseId);
        history.setCourseName(course.getPackageName());
        history.setStatus(course.getStatus());
        history.setCreatedByUserId(course.getCreatedByUserId());
        history.setOriginalCourseId(course.getOriginalCourseId());
        history.setVersionNumber(course.getVersionNumber());
        
        // If this is an edit of an existing course, get original course details
        if (course.getOriginalCourseId() != null) {
            PackageEntity originalCourse = packageRepository.findById(course.getOriginalCourseId()).orElse(null);
            if (originalCourse != null) {
                history.setOriginalCourseName(originalCourse.getPackageName());
                history.setOriginalCourseStatus(originalCourse.getStatus());
            }
        }
        
        try {
            String logs = course.getCourseAuditLogs();
            if (logs != null && !logs.trim().isEmpty()) {
                List<Map<String, Object>> parsed = objectMapper.readValue(logs, new TypeReference<List<Map<String, Object>>>(){});
                history.setAuditLogs(parsed);
            } else {
                history.setAuditLogs(Collections.emptyList());
            }
        } catch (Exception e) {
            log.error("Failed to parse audit logs for course {}: {}", courseId, e.getMessage());
            history.setAuditLogs(Collections.emptyList());
        }

        return history;
    }

    // Private helper methods

    private PackageEntity copyPackageEntity(PackageEntity original, String teacherId) {
        PackageEntity copy = new PackageEntity();
        copy.setPackageName(original.getPackageName());
        copy.setThumbnailFileId(original.getThumbnailFileId());
        copy.setStatus(PackageStatusEnum.DRAFT.name());
        copy.setIsCoursePublishedToCatalaouge(original.getIsCoursePublishedToCatalaouge());
        copy.setCoursePreviewImageMediaId(original.getCoursePreviewImageMediaId());
        copy.setCourseBannerMediaId(original.getCourseBannerMediaId());
        copy.setCourseMediaId(original.getCourseMediaId());
        copy.setWhyLearn(original.getWhyLearn());
        copy.setWhoShouldLearn(original.getWhoShouldLearn());
        copy.setAboutTheCourse(original.getAboutTheCourse());
        copy.setTags(original.getTags());
        copy.setCourseDepth(original.getCourseDepth());
        copy.setCourseHtmlDescription(original.getCourseHtmlDescription());
        copy.setOriginalCourseId(original.getId());
        copy.setCreatedByUserId(teacherId);
        copy.setVersionNumber(1);
        return copy;
    }

    /**
     * Copy entire course hierarchy: PackageSession → Subject → Module → Chapter → Slide
     */
    private void copyEntireCourseHierarchy(PackageEntity originalPackage, PackageEntity tempPackage, String teacherId) {
        // Get all package sessions for original package
        List<PackageSession> originalPackageSessions = packageSessionRepository.findByPackageEntityId(originalPackage.getId());
        
        for (PackageSession originalPackageSession : originalPackageSessions) {
            // Copy package session
            PackageSession tempPackageSession = copyPackageSession(originalPackageSession, tempPackage);
            tempPackageSession = packageSessionRepository.save(tempPackageSession);

            // Copy all subjects and their hierarchy for this package session
            copyContentHierarchy(originalPackageSession, tempPackageSession, teacherId);
            
            // Copy faculty assignments
            copyFacultyAssignments(originalPackageSession, tempPackageSession);
        }
    }

    private PackageSession copyPackageSession(PackageSession original, PackageEntity tempPackage) {
        PackageSession copy = new PackageSession();
        copy.setLevel(original.getLevel());
        copy.setSession(original.getSession());
        copy.setPackageEntity(tempPackage);
        copy.setGroup(original.getGroup());
        copy.setStartTime(original.getStartTime());
        copy.setStatus(original.getStatus());
        return copy;
    }

    /**
     * Copy content hierarchy using existing copy mechanisms
     */
    private void copyContentHierarchy(PackageSession originalPackageSession, PackageSession tempPackageSession, String teacherId) {
        // Get all subjects for the original package session
        List<Subject> originalSubjects = subjectRepository.findDistinctSubjectsByPackageSessionId(originalPackageSession.getId());
        
        for (Subject originalSubject : originalSubjects) {
            // Copy subject with parent_id tracking
            Subject tempSubject = copySubjectWithParentId(originalSubject, teacherId);
            tempSubject = subjectRepository.save(tempSubject);

            // Create subject-package session mapping
            SubjectPackageSession tempMapping = new SubjectPackageSession(tempSubject, tempPackageSession, 0);
            subjectPackageSessionRepository.save(tempMapping);

            // Copy modules for this subject using existing mechanism
            copyModulesForSubject(originalSubject, tempSubject, originalPackageSession, tempPackageSession, teacherId);
        }
    }

    private Subject copySubjectWithParentId(Subject original, String teacherId) {
        Subject copy = new Subject();
        copy.setSubjectName(original.getSubjectName());
        copy.setSubjectCode(original.getSubjectCode());
        copy.setCredit(original.getCredit());
        copy.setThumbnailId(original.getThumbnailId());
        copy.setStatus(original.getStatus());
        copy.setParentId(original.getId()); // Track original subject
        copy.setCreatedByUserId(teacherId);
        return copy;
    }

    private void copyModulesForSubject(Subject originalSubject, Subject tempSubject, 
                                       PackageSession originalPackageSession, PackageSession tempPackageSession, String teacherId) {
        // Get all modules for the subject using the correct repository method
        List<SubjectModuleMapping> originalMappings = subjectModuleMappingRepository.findBySubjectId(originalSubject.getId());
        
        for (SubjectModuleMapping originalMapping : originalMappings) {
            Module originalModule = originalMapping.getModule();
            
            // Copy module with parent_id tracking
            Module tempModule = copyModuleWithParentId(originalModule, teacherId);
            tempModule = moduleRepository.save(tempModule);

            // Create subject-module mapping
            SubjectModuleMapping tempSubjectModuleMapping = new SubjectModuleMapping(tempSubject, tempModule, 0);
            subjectModuleMappingRepository.save(tempSubjectModuleMapping);

            // Copy chapters for this module
            copyChaptersForModule(originalModule, tempModule, originalPackageSession, tempPackageSession, teacherId);
        }
    }

    private Module copyModuleWithParentId(Module original, String teacherId) {
        Module copy = new Module();
        copy.setModuleName(original.getModuleName());
        copy.setStatus(original.getStatus());
        copy.setDescription(original.getDescription());
        copy.setThumbnailId(original.getThumbnailId());
        copy.setParentId(original.getId()); // Track original module
        copy.setCreatedByUserId(teacherId);
        return copy;
    }

    private void copyChaptersForModule(Module originalModule, Module tempModule, 
                                       PackageSession originalPackageSession, PackageSession tempPackageSession, String teacherId) {
        // Use existing ChapterManager copy mechanism with enhancement for parent_id
        List<Chapter> originalChapters = moduleChapterMappingRepository.findChaptersByModuleIdAndStatusNotDeleted(
                originalModule.getId(), originalPackageSession.getId());
        
        for (Chapter originalChapter : originalChapters) {
            // Copy chapter with parent_id tracking
            Chapter tempChapter = copyChapterWithParentId(originalChapter, teacherId);
            tempChapter = chapterRepository.save(tempChapter);

            // Create module-chapter mapping
            ModuleChapterMapping tempMapping = new ModuleChapterMapping(tempChapter, tempModule);
            moduleChapterMappingRepository.save(tempMapping);

            // Create chapter-package session mapping
            Optional<ChapterPackageSessionMapping> originalChapterMapping = 
                    chapterPackageSessionMappingRepository.findByChapterIdAndPackageSessionIdAndStatusNotDeleted(
                            originalChapter.getId(), originalPackageSession.getId());
            
            if (originalChapterMapping.isPresent()) {
                ChapterPackageSessionMapping tempChapterMapping = new ChapterPackageSessionMapping(
                        tempChapter, tempPackageSession, originalChapterMapping.get().getChapterOrder());
                chapterPackageSessionMappingRepository.save(tempChapterMapping);
            }

            // Copy slides for this chapter with enhanced parent_id tracking
            copySlidesForChapterWithParentId(originalChapter, tempChapter, teacherId);
        }
    }

    private Chapter copyChapterWithParentId(Chapter original, String teacherId) {
        Chapter copy = new Chapter();
        copy.setChapterName(original.getChapterName());
        copy.setDescription(original.getDescription());
        copy.setFileId(original.getFileId());
        copy.setStatus(original.getStatus());
        copy.setParentId(original.getId()); // Track original chapter
        copy.setCreatedByUserId(teacherId);
        return copy;
    }

    /**
     * Enhanced slide copying with parent_id tracking
     */
    private void copySlidesForChapterWithParentId(Chapter originalChapter, Chapter tempChapter, String teacherId) {
        // This is similar to SlideService.copySlidesOfChapter but adds parent_id tracking
        List<ChapterToSlides> originalChapterToSlides = chapterToSlidesRepository.findByChapterId(originalChapter.getId());
        List<Slide> newSlides = new ArrayList<>();
        List<ChapterToSlides> newChapterToSlides = new ArrayList<>();

        // First, create new Slide instances with parent_id tracking
        for (ChapterToSlides chapterToSlide : originalChapterToSlides) {
            Slide originalSlide = chapterToSlide.getSlide();
            Slide newSlide = new Slide();
            newSlide.setId(UUID.randomUUID().toString()); // Generate unique ID
            newSlide.setTitle(originalSlide.getTitle());
            newSlide.setStatus(originalSlide.getStatus());
            newSlide.setImageFileId(originalSlide.getImageFileId());
            newSlide.setSourceType(originalSlide.getSourceType());
            newSlide.setDescription(originalSlide.getDescription());
            newSlide.setParentId(originalSlide.getId()); // Track original slide
            newSlide.setCreatedByUserId(teacherId);
            newSlides.add(newSlide);
        }

        // Save slides to make sure they are managed entities
        List<Slide> persistedSlides = slideRepository.saveAll(newSlides);

        // Now, process dependent entities (DocumentSlide/VideoSlide/etc.) with proper copying
        for (int i = 0; i < originalChapterToSlides.size(); i++) {
            Slide originalSlide = originalChapterToSlides.get(i).getSlide();
            Slide newSlide = persistedSlides.get(i);

            String newSourceId = copySlideSource(originalSlide, teacherId);
            newSlide.setSourceId(newSourceId);

            // Create ChapterToSlides mapping
            newChapterToSlides.add(new ChapterToSlides(tempChapter, newSlide, 
                    originalChapterToSlides.get(i).getSlideOrder(), 
                    originalChapterToSlides.get(i).getStatus()));
        }

        // Update slides with source IDs and save ChapterToSlides
        slideRepository.saveAll(persistedSlides);
        chapterToSlidesRepository.saveAll(newChapterToSlides);
        contentIndexMarker.markChapter(tempChapter.getId(), "COURSE_EDIT_COPY");
        
        log.info("Copied {} slides from chapter {} to chapter {}", 
                newSlides.size(), originalChapter.getId(), tempChapter.getId());
    }

    /**
     * Copy slide source (DocumentSlide, VideoSlide, etc.) based on slide type
     */
    private String copySlideSource(Slide originalSlide, String teacherId) {
        String sourceType = originalSlide.getSourceType();
        String originalSourceId = originalSlide.getSourceId();

        switch (sourceType.toUpperCase()) {
            case "DOCUMENT":
                return copyDocumentSlide(originalSourceId, teacherId);
            case "VIDEO":
                return copyVideoSlide(originalSourceId, teacherId);
            case "QUESTION":
                return copyQuestionSlide(originalSourceId, teacherId);
            case "ASSIGNMENT":
                return copyAssignmentSlide(originalSourceId, teacherId);
            case "QUIZ":
                return copyQuizSlide(originalSourceId, teacherId);
            default:
                log.warn("Unknown slide type: {}, copying source ID as-is", sourceType);
                return originalSourceId;
        }
    }

    private String copyDocumentSlide(String originalSourceId, String teacherId) {
        // This would need access to DocumentSlideRepository - for now, return original
        log.info("Copying document slide: {}", originalSourceId);
        return originalSourceId; // TODO: Implement document slide copying
    }

    private String copyVideoSlide(String originalSourceId, String teacherId) {
        // This would need access to VideoSlideRepository - for now, return original
        log.info("Copying video slide: {}", originalSourceId);
        return originalSourceId; // TODO: Implement video slide copying
    }

    private String copyQuestionSlide(String originalSourceId, String teacherId) {
        // This would need access to QuestionSlideRepository - for now, return original
        log.info("Copying question slide: {}", originalSourceId);
        return originalSourceId; // TODO: Implement question slide copying
    }

    private String copyAssignmentSlide(String originalSourceId, String teacherId) {
        // This would need access to AssignmentSlideRepository - for now, return original
        log.info("Copying assignment slide: {}", originalSourceId);
        return originalSourceId; // TODO: Implement assignment slide copying
    }

    private String copyQuizSlide(String originalSourceId, String teacherId) {
        // This would need access to QuizSlideRepository - for now, return original
        log.info("Copying quiz slide: {}", originalSourceId);
        return originalSourceId; // TODO: Implement quiz slide copying
    }

    private void copyFacultyAssignments(PackageSession originalPackageSession, PackageSession tempPackageSession) {
        // Faculty assignments use packageSessionId string field
        List<FacultySubjectPackageSessionMapping> originalAssignments = 
                facultySubjectPackageSessionMappingRepository.findByPackageSessionId(originalPackageSession.getId());
        
        List<FacultySubjectPackageSessionMapping> tempAssignments = new ArrayList<>();
        for (FacultySubjectPackageSessionMapping original : originalAssignments) {
            FacultySubjectPackageSessionMapping copy = new FacultySubjectPackageSessionMapping();
            copy.setUserId(original.getUserId());
            copy.setPackageSessionId(tempPackageSession.getId()); // Use string ID
            copy.setSubjectId(original.getSubjectId()); // Keep same subject reference
            copy.setName(original.getName());
            copy.setStatus(original.getStatus());
            copy.setRoleLabel(original.getRoleLabel());
            // Carry the access/linkage fields across verbatim. Dropping suborg_id in particular
            // would turn a sub-org access grant into a row indistinguishable from a real teacher
            // of the temp package session, which is exactly what the faculty listings filter on.
            copy.setUserType(original.getUserType());
            copy.setTypeId(original.getTypeId());
            copy.setAccessType(original.getAccessType());
            copy.setAccessPermission(original.getAccessPermission());
            copy.setLinkageType(original.getLinkageType());
            copy.setSuborgId(original.getSuborgId());
            // A package-session-scoped grant must point at the copy, not the original, or the
            // temp row would hand back access to the original session. Other access types
            // (Package, EnrollInvite) are unaffected by the session copy and carry over as-is.
            if (originalPackageSession.getId().equals(original.getAccessId())) {
                copy.setAccessId(tempPackageSession.getId());
            } else {
                copy.setAccessId(original.getAccessId());
            }
            tempAssignments.add(copy);
        }
        facultySubjectPackageSessionMappingRepository.saveAll(tempAssignments);
        
        log.info("Copied {} faculty assignments from {} to {}", 
                tempAssignments.size(), originalPackageSession.getId(), tempPackageSession.getId());
    }    /**
     * Merge changes from temp course into original published course
     */
    private String mergeChangesIntoOriginal(PackageEntity tempCourse,PackageInstitute packageInstitute) {
        PackageEntity originalCourse = packageRepository.findById(tempCourse.getOriginalCourseId())
                .orElseThrow(() -> new VacademyException("Original course not found"));

        // Update original course with changes from temp course
        updatePackageFields(originalCourse, tempCourse);
        packageRepository.save(originalCourse);
        // Course page content (FAQs, mode) is merged like the other package fields: temp wins
        packagePageContentService.copy(tempCourse.getId(), originalCourse.getId());

        // Merge hierarchy changes (subjects, modules, chapters, slides)
        mergeHierarchyChanges(tempCourse, originalCourse);

        // Copy any new package-institute linkages from temp to original
        copyPackageInstituteLinkages(tempCourse, originalCourse);

        // Create default enroll invites for all package sessions (handles new and existing)
        createDefaultEnrollInvitesForCourse(originalCourse,packageInstitute);

        appendAuditLog(originalCourse, "UPDATE", tempCourse.getCreatedByUserId(),
                "Merged changes from temp course " + tempCourse.getId(), null);

        return "Changes merged into original course successfully";
    }

    private void updatePackageFields(PackageEntity original, PackageEntity temp) {
        original.setPackageName(temp.getPackageName());
        original.setThumbnailFileId(temp.getThumbnailFileId());
        original.setIsCoursePublishedToCatalaouge(temp.getIsCoursePublishedToCatalaouge());
        original.setCoursePreviewImageMediaId(temp.getCoursePreviewImageMediaId());
        original.setCourseBannerMediaId(temp.getCourseBannerMediaId());
        original.setCourseMediaId(temp.getCourseMediaId());
        original.setWhyLearn(temp.getWhyLearn());
        original.setWhoShouldLearn(temp.getWhoShouldLearn());
        original.setAboutTheCourse(temp.getAboutTheCourse());
        original.setTags(temp.getTags());
        original.setCourseDepth(temp.getCourseDepth());
        original.setCourseHtmlDescription(temp.getCourseHtmlDescription());
    }

    /**
     * Smart merge logic: Update existing entities, add new ones, handle deletions
     * Process each unique subject only once to avoid duplication across multiple sessions
     */
    private void mergeHierarchyChanges(PackageEntity tempCourse, PackageEntity originalCourse) {
        List<PackageSession> tempPackageSessions = packageSessionRepository.findByPackageEntityId(tempCourse.getId());
        List<PackageSession> originalPackageSessions = packageSessionRepository.findByPackageEntityId(originalCourse.getId());

        // Step 1: Process unique subjects (avoiding duplication)
        mergeUniqueSubjects(tempPackageSessions, originalPackageSessions);
        
        // Step 2: Handle session-specific mappings and deletions
        handleSessionMappingsAndDeletions(tempPackageSessions, originalPackageSessions);
    }

    /**
     * Process each unique subject only once to avoid duplication
     */
    private void mergeUniqueSubjects(List<PackageSession> tempPackageSessions, List<PackageSession> originalPackageSessions) {
        // Collect all unique subjects from all temp sessions
        Map<String, Subject> uniqueTempSubjects = new HashMap<>();
        Map<String, PackageSession> subjectToTempSession = new HashMap<>();
        Map<String, PackageSession> subjectToOriginalSession = new HashMap<>();
        
        // Build maps of unique subjects and their session contexts
        for (PackageSession tempSession : tempPackageSessions) {
            PackageSession correspondingOriginalSession = findCorrespondingPackageSession(tempSession, originalPackageSessions);
            if (correspondingOriginalSession != null) {
                List<Subject> tempSubjects = subjectRepository.findDistinctSubjectsByPackageSessionId(tempSession.getId());
                
                for (Subject tempSubject : tempSubjects) {
                    String subjectKey = tempSubject.getParentId() != null ? tempSubject.getParentId() : tempSubject.getId();
                    if (!uniqueTempSubjects.containsKey(subjectKey)) {
                        uniqueTempSubjects.put(subjectKey, tempSubject);
                        subjectToTempSession.put(subjectKey, tempSession);
                        subjectToOriginalSession.put(subjectKey, correspondingOriginalSession);
                    }
                }
            }
        }
        
        // Process each unique subject only once
        for (Map.Entry<String, Subject> entry : uniqueTempSubjects.entrySet()) {
            String subjectKey = entry.getKey();
            Subject tempSubject = entry.getValue();
            PackageSession tempSession = subjectToTempSession.get(subjectKey);
            PackageSession originalSession = subjectToOriginalSession.get(subjectKey);
            
            if (tempSubject.getParentId() != null) {
                // This is an updated subject - merge changes
                mergeSubjectChanges(tempSubject, tempSession, originalSession);
            } else {
                // This is a new subject - add to original
                addNewSubjectToOriginal(tempSubject, tempSession, originalSession);
            }
        }
        
        log.info("Processed {} unique subjects across {} temp sessions", 
                uniqueTempSubjects.size(), tempPackageSessions.size());
    }

    /**
     * Handle session-specific mappings and deleted subjects
     */
    private void handleSessionMappingsAndDeletions(List<PackageSession> tempPackageSessions, List<PackageSession> originalPackageSessions) {
        for (PackageSession tempSession : tempPackageSessions) {
            PackageSession correspondingOriginalSession = findCorrespondingPackageSession(tempSession, originalPackageSessions);
            if (correspondingOriginalSession != null) {
                // Handle deleted subjects (subjects in original but not in temp)
                handleDeletedSubjects(tempSession, correspondingOriginalSession);
                
                // Ensure subject-package session mappings are properly maintained
                ensureSubjectSessionMappings(tempSession, correspondingOriginalSession);
            }
        }
    }

    /**
     * Ensure subject-package session mappings are properly maintained for new subjects
     */
    private void ensureSubjectSessionMappings(PackageSession tempSession, PackageSession originalSession) {
        List<Subject> tempSubjects = subjectRepository.findDistinctSubjectsByPackageSessionId(tempSession.getId());
        
        for (Subject tempSubject : tempSubjects) {
            if (tempSubject.getParentId() == null) {
                // This is a new subject - find the corresponding original subject and ensure mapping
                Optional<Subject> originalSubjectOpt = subjectPackageSessionRepository.findSubjectByNameAndPackageSessionId(
                        tempSubject.getSubjectName(), originalSession.getId());
                
                if (originalSubjectOpt.isPresent()) {
                    Subject originalSubject = originalSubjectOpt.get();
                    // Check if mapping already exists
                    Optional<SubjectPackageSession> existingMapping = subjectPackageSessionRepository
                            .findBySubjectIdAndPackageSessionId(originalSubject.getId(), originalSession.getId());
                    
                    if (existingMapping.isEmpty()) {
                        // Create the missing mapping
                        SubjectPackageSession newMapping = new SubjectPackageSession(originalSubject, originalSession, 0);
                        subjectPackageSessionRepository.save(newMapping);
                        log.info("Created missing subject-session mapping for subject {} in session {}", 
                                originalSubject.getSubjectName(), originalSession.getId());
                    }
                }
            }
        }
    }

    private PackageSession findCorrespondingPackageSession(PackageSession tempSession, List<PackageSession> originalSessions) {
        // Find original session by level and session IDs
        return originalSessions.stream()
                .filter(orig -> orig.getLevel().getId().equals(tempSession.getLevel().getId()) &&
                               orig.getSession().getId().equals(tempSession.getSession().getId()))
                .findFirst()
                .orElse(null);
    }

    private void mergeSubjectChanges(Subject tempSubject, PackageSession tempSession, PackageSession originalSession) {
        // Find original subject by parent_id
        Subject originalSubject = subjectRepository.findById(tempSubject.getParentId())
                .orElse(null);
        
        if (originalSubject != null) {
            // Update original subject with temp subject's changes
            originalSubject.setSubjectName(tempSubject.getSubjectName());
            originalSubject.setSubjectCode(tempSubject.getSubjectCode());
            originalSubject.setCredit(tempSubject.getCredit());
            originalSubject.setThumbnailId(tempSubject.getThumbnailId());
            subjectRepository.save(originalSubject);
            
            // Merge modules, chapters, and slides with correct session context
            mergeModulesForSubject(tempSubject, originalSubject, tempSession, originalSession);
        }
    }

    private void mergeModulesForSubject(Subject tempSubject, Subject originalSubject, PackageSession tempSession, PackageSession originalSession) {
        List<SubjectModuleMapping> tempMappings = subjectModuleMappingRepository.findBySubjectId(tempSubject.getId());
        
        for (SubjectModuleMapping tempMapping : tempMappings) {
            Module tempModule = tempMapping.getModule();
            
            if (tempModule.getParentId() != null) {
                // Update existing module
                Module originalModule = moduleRepository.findById(tempModule.getParentId()).orElse(null);
                if (originalModule != null) {
                    originalModule.setModuleName(tempModule.getModuleName());
                    originalModule.setDescription(tempModule.getDescription());
                    originalModule.setThumbnailId(tempModule.getThumbnailId());
                    moduleRepository.save(originalModule);
                    
                    // Merge chapters for this module
                    mergeChaptersForModule(tempModule, originalModule, tempSession, originalSession);
                }
            } else {
                // Add new module to original subject
                addNewModuleToOriginalSubject(tempModule, originalSubject, tempSession, originalSession);
            }
        }
    }

    private void mergeChaptersForModule(Module tempModule, Module originalModule, PackageSession tempSession, PackageSession originalSession) {
        List<ModuleChapterMapping> tempMappings = moduleChapterMappingRepository.findByModuleId(tempModule.getId());
        
        for (ModuleChapterMapping tempMapping : tempMappings) {
            Chapter tempChapter = tempMapping.getChapter();
            
            if (tempChapter.getParentId() != null) {
                // Update existing chapter
                Chapter originalChapter = chapterRepository.findById(tempChapter.getParentId()).orElse(null);
                if (originalChapter != null) {
                    originalChapter.setChapterName(tempChapter.getChapterName());
                    originalChapter.setDescription(tempChapter.getDescription());
                    originalChapter.setFileId(tempChapter.getFileId());
                    chapterRepository.save(originalChapter);
                    
                    // Merge slides for this chapter
                    mergeSlidesForChapter(tempChapter, originalChapter, tempSession, originalSession);
                }
            } else {
                // Add new chapter to original module
                addNewChapterToOriginalModule(tempChapter, originalModule, tempSession, originalSession);
            }
        }
    }

    private void mergeSlidesForChapter(Chapter tempChapter, Chapter originalChapter, PackageSession tempSession, PackageSession originalSession) {
        // Enhanced slide merging logic with parent_id tracking
        List<ChapterToSlides> tempSlides = chapterToSlidesRepository.findByChapterId(tempChapter.getId());
        
        for (ChapterToSlides tempChapterToSlide : tempSlides) {
            Slide tempSlide = tempChapterToSlide.getSlide();
            
            if (tempSlide.getParentId() != null) {
                // Update existing slide
                Slide originalSlide = slideRepository.findById(tempSlide.getParentId()).orElse(null);
                if (originalSlide != null) {
                    originalSlide.setTitle(tempSlide.getTitle());
                    originalSlide.setDescription(tempSlide.getDescription());
                    originalSlide.setImageFileId(tempSlide.getImageFileId());
                    originalSlide.setStatus(tempSlide.getStatus());
                    slideRepository.save(originalSlide);
                    
                    // Update slide source content based on type
                    mergeSlideSource(tempSlide, originalSlide);
                    contentIndexMarker.mark(originalSlide.getId(), originalChapter.getId(), "COURSE_APPROVAL_MERGE");
                }
            } else {
                // Add new slide to original chapter
                addNewSlideToOriginalChapter(tempSlide, originalChapter);
            }
        }
        
        log.info("Merged slides from temp chapter {} to original chapter {}", 
                tempChapter.getId(), originalChapter.getId());
    }

    private void mergeSlideSource(Slide tempSlide, Slide originalSlide) {
        String sourceType = tempSlide.getSourceType();
        log.info("Merging {} slide source from {} to {}", 
                sourceType, tempSlide.getId(), originalSlide.getId());
        // TODO: Implement specific slide source merging based on type
    }

    private void addNewSubjectToOriginal(Subject tempSubject, PackageSession tempSession, PackageSession originalSession) {
        // Create new subject in original course
        Subject newSubject = new Subject();
        newSubject.setSubjectName(tempSubject.getSubjectName());
        newSubject.setSubjectCode(tempSubject.getSubjectCode());
        newSubject.setCredit(tempSubject.getCredit());
        newSubject.setThumbnailId(tempSubject.getThumbnailId());
        newSubject.setStatus(tempSubject.getStatus());
        newSubject = subjectRepository.save(newSubject);
        
        // Create subject-package session mapping
        SubjectPackageSession mapping = new SubjectPackageSession(newSubject, originalSession, 0);
        subjectPackageSessionRepository.save(mapping);

        // Copy all modules, chapters, and slides from temp subject to new subject
        copyModulesFromTempToNewSubject(tempSubject, newSubject, tempSession, originalSession);
        
        log.info("Added new subject {} to original package session {} with {} modules", 
                newSubject.getSubjectName(), originalSession.getId(),
                                 subjectModuleMappingRepository.findBySubjectId(newSubject.getId()).size());
    }

    private void copyModulesFromTempToNewSubject(Subject tempSubject, Subject newSubject, PackageSession tempSession, PackageSession originalSession) {
        // Get all modules from the temp subject
        List<SubjectModuleMapping> tempModuleMappings = subjectModuleMappingRepository.findBySubjectId(tempSubject.getId());
        
        for (SubjectModuleMapping tempMapping : tempModuleMappings) {
            Module tempModule = tempMapping.getModule();
            
            // Create new module for the new subject
            Module newModule = new Module();
            newModule.setModuleName(tempModule.getModuleName());
            newModule.setDescription(tempModule.getDescription());
            newModule.setThumbnailId(tempModule.getThumbnailId());
            newModule.setStatus(tempModule.getStatus());
            // Don't set parentId since this is a new module in the original course
            newModule = moduleRepository.save(newModule);

            // Create subject-module mapping for the new subject
            SubjectModuleMapping newMapping = new SubjectModuleMapping(newSubject, newModule, 0);
            subjectModuleMappingRepository.save(newMapping);

            // Copy all chapters from temp module to new module
            copyChaptersFromTempToNewModule(tempModule, newModule, tempSession, originalSession);
        }

        log.info("Copied {} modules from temp subject {} to new subject {}", 
                tempModuleMappings.size(), tempSubject.getId(), newSubject.getId());
    }

    private void addNewModuleToOriginalSubject(Module tempModule, Subject originalSubject, PackageSession tempSession, PackageSession originalSession) {
        // Create new module in original subject
        Module newModule = new Module();
        newModule.setModuleName(tempModule.getModuleName());
        newModule.setDescription(tempModule.getDescription());
        newModule.setThumbnailId(tempModule.getThumbnailId());
        newModule.setStatus(tempModule.getStatus());
        newModule = moduleRepository.save(newModule);
        
        // Create subject-module mapping
        SubjectModuleMapping mapping = new SubjectModuleMapping(originalSubject, newModule, 0);
        subjectModuleMappingRepository.save(mapping);

        // Copy all chapters from temp module to new module
        copyChaptersFromTempToNewModule(tempModule, newModule, tempSession, originalSession);
        
        log.info("Added new module {} to original subject {} with {} chapters", 
                newModule.getModuleName(), originalSubject.getId(), 
                moduleChapterMappingRepository.findByModuleId(newModule.getId()).size());
    }

    private void copyChaptersFromTempToNewModule(Module tempModule, Module newModule, PackageSession tempSession, PackageSession originalSession) {
        // Get all chapters from the temp module
        List<ModuleChapterMapping> tempChapterMappings = moduleChapterMappingRepository.findByModuleId(tempModule.getId());
        
        for (ModuleChapterMapping tempMapping : tempChapterMappings) {
            Chapter tempChapter = tempMapping.getChapter();
            
            // Create new chapter for the new module
            Chapter newChapter = new Chapter();
            newChapter.setChapterName(tempChapter.getChapterName());
            newChapter.setDescription(tempChapter.getDescription());
            newChapter.setFileId(tempChapter.getFileId());
            newChapter.setStatus(tempChapter.getStatus());
            // Don't set parentId since this is a new chapter in the original course
            newChapter = chapterRepository.save(newChapter);

            // Create module-chapter mapping for the new module
            ModuleChapterMapping newMapping = new ModuleChapterMapping(newChapter, newModule);
            moduleChapterMappingRepository.save(newMapping);

            // Create chapter-package session mapping if temp chapter has one
            Optional<ChapterPackageSessionMapping> tempChapterSessionMapping = 
                    chapterPackageSessionMappingRepository.findByChapterIdAndPackageSessionIdAndStatusNotDeleted(
                            tempChapter.getId(), tempSession != null ? tempSession.getId() : null);
            
            if (tempChapterSessionMapping.isPresent() && originalSession != null) {
                ChapterPackageSessionMapping newChapterSessionMapping = new ChapterPackageSessionMapping(
                        newChapter, originalSession, tempChapterSessionMapping.get().getChapterOrder());
                chapterPackageSessionMappingRepository.save(newChapterSessionMapping);
            }

            // Copy slides for this chapter
            copyNewSlidesForChapter(tempChapter, newChapter);
        }
        
        log.info("Copied {} chapters from temp module {} to new module {}", 
                tempChapterMappings.size(), tempModule.getId(), newModule.getId());
    }

    private void copyNewSlidesForChapter(Chapter tempChapter, Chapter newChapter) {
        List<ChapterToSlides> tempChapterToSlides = chapterToSlidesRepository.findByChapterId(tempChapter.getId());
        List<Slide> newSlides = new ArrayList<>();
        List<ChapterToSlides> newChapterToSlides = new ArrayList<>();

        // Create new Slide instances
        for (ChapterToSlides tempChapterToSlide : tempChapterToSlides) {
            Slide tempSlide = tempChapterToSlide.getSlide();
            Slide newSlide = new Slide();
            newSlide.setId(UUID.randomUUID().toString()); // Generate unique ID
            newSlide.setTitle(tempSlide.getTitle());
            newSlide.setStatus(tempSlide.getStatus());
            newSlide.setImageFileId(tempSlide.getImageFileId());
            newSlide.setSourceType(tempSlide.getSourceType());
            newSlide.setDescription(tempSlide.getDescription());
            newSlide.setSourceId(tempSlide.getSourceId()); // Copy source reference
            // Don't set parentId since this is a new slide in the original course
            newSlides.add(newSlide);
        }

        // Save slides
        List<Slide> persistedSlides = slideRepository.saveAll(newSlides);

        // Create ChapterToSlides mappings
        for (int i = 0; i < tempChapterToSlides.size(); i++) {
            newChapterToSlides.add(new ChapterToSlides(newChapter, persistedSlides.get(i), 
                    tempChapterToSlides.get(i).getSlideOrder(), 
                    tempChapterToSlides.get(i).getStatus()));
        }

        // Save ChapterToSlides mappings
        chapterToSlidesRepository.saveAll(newChapterToSlides);
        contentIndexMarker.markChapter(newChapter.getId(), "COURSE_APPROVAL_NEW_CHAPTER");
        
        log.info("Copied {} slides from temp chapter {} to new chapter {}", 
                newSlides.size(), tempChapter.getId(), newChapter.getId());
    }

    private void addNewChapterToOriginalModule(Chapter tempChapter, Module originalModule, PackageSession tempSession, PackageSession originalSession) {
        // Create new chapter in original module
        Chapter newChapter = new Chapter();
        newChapter.setChapterName(tempChapter.getChapterName());
        newChapter.setDescription(tempChapter.getDescription());
        newChapter.setFileId(tempChapter.getFileId());
        newChapter.setStatus(tempChapter.getStatus());
        newChapter = chapterRepository.save(newChapter);
        
        // Create module-chapter mapping
        ModuleChapterMapping mapping = new ModuleChapterMapping(newChapter, originalModule);
        moduleChapterMappingRepository.save(mapping);
        
        // Create chapter-package session mapping if needed
        if (originalSession != null) {
            ChapterPackageSessionMapping chapterSessionMapping = new ChapterPackageSessionMapping(
                    newChapter, originalSession, null); // Order can be set later if needed
            chapterPackageSessionMappingRepository.save(chapterSessionMapping);
        }
        
        // Copy slides for this chapter
        copyNewSlidesForChapter(tempChapter, newChapter);
        
        log.info("Added new chapter {} to original module {}", 
                newChapter.getChapterName(), originalModule.getId());
    }

    private void addNewSlideToOriginalChapter(Slide tempSlide, Chapter originalChapter) {
        // Create new slide in original chapter
        Slide newSlide = new Slide();
        newSlide.setId(UUID.randomUUID().toString()); // Generate unique ID
        newSlide.setTitle(tempSlide.getTitle());
        newSlide.setDescription(tempSlide.getDescription());
        newSlide.setImageFileId(tempSlide.getImageFileId());
        newSlide.setSourceType(tempSlide.getSourceType());
        newSlide.setSourceId(tempSlide.getSourceId()); // Copy source reference
        newSlide.setStatus(tempSlide.getStatus());
        newSlide = slideRepository.save(newSlide);
        
        // Create chapter-to-slides mapping
        ChapterToSlides mapping = new ChapterToSlides(originalChapter, newSlide, null, tempSlide.getStatus());
        chapterToSlidesRepository.save(mapping);
        contentIndexMarker.mark(newSlide.getId(), originalChapter.getId(), "COURSE_APPROVAL_NEW_SLIDE");
        
        log.info("Added new slide {} to original chapter {}", 
                newSlide.getTitle(), originalChapter.getId());
    }

    private void handleDeletedSubjects(PackageSession tempSession, PackageSession originalSession) {
        // Find subjects that exist in original but not in temp (deleted subjects)
        List<Subject> originalSubjects = subjectRepository.findDistinctSubjectsByPackageSessionId(originalSession.getId());
        List<Subject> tempSubjects = subjectRepository.findDistinctSubjectsByPackageSessionId(tempSession.getId());
        
        Set<String> tempSubjectParentIds = tempSubjects.stream()
                .map(Subject::getParentId)
                .filter(Objects::nonNull)
                .collect(Collectors.toSet());
        
        for (Subject originalSubject : originalSubjects) {
            if (!tempSubjectParentIds.contains(originalSubject.getId())) {
                // This subject was deleted in temp course - mark as deleted in original
                log.info("Subject {} was deleted, marking as deleted in original", originalSubject.getId());
                // TODO: Implement soft deletion according to business rules
            }
        }
    }    private String publishNewCourse(PackageEntity tempCourse,PackageInstitute packageInstitute) {
        tempCourse.setStatus(PackageStatusEnum.ACTIVE.name());
        tempCourse.setOriginalCourseId(null); // Clear temp relationship
        packageRepository.save(tempCourse);
        
        // Create default enroll invites for all package sessions
        createDefaultEnrollInvitesForCourse(tempCourse,packageInstitute);
        
        appendAuditLog(tempCourse, "PUBLISH", tempCourse.getCreatedByUserId(), "Published new course", null);
        return "New course published successfully";
    }

    private void deleteTempCourse(PackageEntity tempCourse) {
        tempCourse.setStatus(PackageStatusEnum.DELETED.name());
        packageRepository.save(tempCourse);
        appendAuditLog(tempCourse, "DELETE_TEMP", tempCourse.getCreatedByUserId(), "Deleted temporary course after merge", null);
    }

    /**
     * Append an audit event into package.course_audit_logs as JSON array.
     * Event schema: { timestamp, actorUserId, action, message, comment }
     */
    private void appendAuditLog(PackageEntity pkg, String action, String actorUserId, String message, String comment) {
        try {
            List<Map<String, Object>> events;
            String existing = pkg.getCourseAuditLogs();
            if (existing == null || existing.trim().isEmpty()) {
                events = new ArrayList<>();
            } else {
                events = objectMapper.readValue(existing, new TypeReference<List<Map<String, Object>>>(){});
            }
            Map<String, Object> evt = new LinkedHashMap<>();
            evt.put("timestamp", new Date().getTime());
            evt.put("actorUserId", actorUserId);
            evt.put("action", action);
            evt.put("message", message);
            if (comment != null && !comment.isEmpty()) {
                evt.put("comment", comment);
            }
            events.add(evt);
            String updatedJson = objectMapper.writeValueAsString(events);
            pkg.setCourseAuditLogs(updatedJson);
            packageRepository.save(pkg);
        } catch (Exception e) {
            log.error("Failed to append audit log for package {} action {}: {}", pkg.getId(), action, e.getMessage());
        }
    }

    /**
     * Copy package-institute linkages from source package to target package
     */
    private void copyPackageInstituteLinkages(PackageEntity sourcePackage, PackageEntity targetPackage) {
        try {
            // Use a more efficient approach by querying with native SQL
            // This method will find all package-institute linkages for the source package
            List<PackageInstitute> sourceLinkages = findPackageInstituteLinkagesByPackageId(sourcePackage.getId());

            // Create corresponding linkages for the target package
            List<PackageInstitute> targetLinkages = new ArrayList<>();
            for (PackageInstitute sourceLinkage : sourceLinkages) {
                // Check if linkage already exists to avoid duplicates
                Optional<PackageInstitute> existingLinkage = packageInstituteRepository
                        .findByPackageIdAndInstituteId(targetPackage.getId(), sourceLinkage.getInstituteEntity().getId());
                
                if (existingLinkage.isEmpty()) {
                    PackageInstitute targetLinkage = new PackageInstitute();
                    targetLinkage.setPackageEntity(targetPackage);
                    targetLinkage.setInstituteEntity(sourceLinkage.getInstituteEntity());
                    targetLinkage.setGroupEntity(sourceLinkage.getGroupEntity()); // Copy group association if exists
                    targetLinkages.add(targetLinkage);
                }
            }

            // Save all target linkages
            if (!targetLinkages.isEmpty()) {
                packageInstituteRepository.saveAll(targetLinkages);
                log.info("Copied {} package-institute linkages from {} to {}", 
                        targetLinkages.size(), sourcePackage.getId(), targetPackage.getId());
            } else {
                log.info("No new package-institute linkages to copy from {} to {}", 
                        sourcePackage.getId(), targetPackage.getId());
            }
        } catch (Exception e) {
            log.error("Error copying package-institute linkages from {} to {}: {}", 
                    sourcePackage.getId(), targetPackage.getId(), e.getMessage());
            // Continue with course creation even if linkage copying fails
        }
    }

    /**
     * Find all package-institute linkages for a specific package
     */
    private List<PackageInstitute> findPackageInstituteLinkagesByPackageId(String packageId) {
        // Use a more efficient approach - we can filter from all linkages or use the existing repository method
        // For now, using the existing findAll and filter approach, but this could be optimized with a custom query
        return packageInstituteRepository.findAll()
                .stream()
                .filter(pi -> pi.getPackageEntity().getId().equals(packageId))
                .collect(Collectors.toList());
    }

    // Inner class for course approval history
    public static class CourseApprovalHistory {
        private String courseId;
        private String courseName;
        private String status;
        private String createdByUserId;
        private String originalCourseId;
        private String originalCourseName;
        private String originalCourseStatus;
        private Integer versionNumber;
        private List<Map<String, Object>> auditLogs;

        // Getters and setters
        public String getCourseId() { return courseId; }
        public void setCourseId(String courseId) { this.courseId = courseId; }
        
        public String getCourseName() { return courseName; }
        public void setCourseName(String courseName) { this.courseName = courseName; }
        
        public String getStatus() { return status; }
        public void setStatus(String status) { this.status = status; }
        
        public String getCreatedByUserId() { return createdByUserId; }
        public void setCreatedByUserId(String createdByUserId) { this.createdByUserId = createdByUserId; }
        
        public String getOriginalCourseId() { return originalCourseId; }
        public void setOriginalCourseId(String originalCourseId) { this.originalCourseId = originalCourseId; }
        
        public String getOriginalCourseName() { return originalCourseName; }
        public void setOriginalCourseName(String originalCourseName) { this.originalCourseName = originalCourseName; }
        
        public String getOriginalCourseStatus() { return originalCourseStatus; }
        public void setOriginalCourseStatus(String originalCourseStatus) { this.originalCourseStatus = originalCourseStatus; }
        
        public Integer getVersionNumber() { return versionNumber; }
        public void setVersionNumber(Integer versionNumber) { this.versionNumber = versionNumber; }

        public List<Map<String, Object>> getAuditLogs() { return auditLogs; }
        public void setAuditLogs(List<Map<String, Object>> auditLogs) { this.auditLogs = auditLogs; }
    }    /**
     * Create default enroll invites for all ACTIVE package sessions of a course
     * This method checks if a default enroll invite already exists before creating a new one
     */

    @Async
    private void createDefaultEnrollInvitesForCourse(PackageEntity course,PackageInstitute packageInstitute) {
        if (packageInstitute == null){
            return;
        }
        String instituteId = packageInstitute.getInstituteEntity().getId();
        try {
            // Get all ACTIVE package sessions for the course
            List<PackageSession> packageSessions = packageSessionRepository.findByPackageEntityId(course.getId());
            for(PackageSession packageSession : packageSessions){
                if (!packageSession.getStatus().equalsIgnoreCase(PackageSessionStatusEnum.ACTIVE.name())){
                    continue;
                }
                if (!checkDefaultEnrollInviteExists(packageSession.getId())){
                    defaultEnrollInviteService.createDefaultEnrollInvite(packageSession, instituteId);
                }
            }

        } catch (Exception e) {
            // Log error but don't fail the course approval process
            log.error("Error creating default enroll invites for course {}: {}", 
                    course.getId(), e.getMessage(), e);
        }
    }
    
    /**
     * Check if a default enroll invite already exists for a package session
     * Uses the repository method to find active default enroll invites
     */
    private boolean checkDefaultEnrollInviteExists(String packageSessionId) {
        try {
            // Try to find existing default enroll invite using the repository method
            // This uses the same logic as EnrollInviteService.findDefaultEnrollInviteByPackageSessionId
            enrollInviteService.findDefaultEnrollInviteByPackageSessionId(
                    packageSessionId);
            
            // If we reach here, the invite exists
            return true;
            
        } catch (Exception e) {
            // If exception is thrown, it means the invite doesn't exist
            return false;
        }
    }
}