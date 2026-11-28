package vacademy.io.admin_core_service.features.course.service;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import vacademy.io.admin_core_service.features.chapter.repository.ChapterPackageSessionMappingRepository;
import vacademy.io.admin_core_service.features.chapter.repository.ChapterRepository;
import vacademy.io.admin_core_service.features.chapter.repository.ChapterToSlidesRepository;
import vacademy.io.admin_core_service.features.chapter.service.ChapterManager;
import vacademy.io.admin_core_service.features.enroll_invite.service.DefaultEnrollInviteService;
import vacademy.io.admin_core_service.features.enroll_invite.service.EnrollInviteService;
import vacademy.io.admin_core_service.features.faculty.repository.FacultySubjectPackageSessionMappingRepository;
import vacademy.io.admin_core_service.features.institute.repository.InstituteRepository;
import vacademy.io.admin_core_service.features.module.repository.ModuleChapterMappingRepository;
import vacademy.io.admin_core_service.features.module.repository.ModuleRepository;
import vacademy.io.admin_core_service.features.module.repository.SubjectModuleMappingRepository;
import vacademy.io.admin_core_service.features.module.service.ModuleManager;
import vacademy.io.admin_core_service.features.packages.repository.PackageInstituteRepository;
import vacademy.io.admin_core_service.features.packages.repository.PackageRepository;
import vacademy.io.admin_core_service.features.packages.repository.PackageSessionRepository;
import vacademy.io.admin_core_service.features.slide.repository.SlideRepository;
import vacademy.io.admin_core_service.features.slide.service.SlideService;
import vacademy.io.admin_core_service.features.subject.repository.SubjectPackageSessionRepository;
import vacademy.io.admin_core_service.features.subject.repository.SubjectRepository;
import vacademy.io.admin_core_service.features.subject.service.SubjectService;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.VacademyException;
import vacademy.io.common.institute.entity.Institute;
import vacademy.io.common.institute.entity.PackageEntity;
import vacademy.io.common.institute.entity.PackageInstitute;
import vacademy.io.common.institute.entity.session.PackageSession;

import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.*;

/**
 * The path a course built over MCP (ai_service `course_edit`) takes to go live:
 * created DRAFT by the admin (no originalCourseId — it is NOT an editable copy),
 * `submit_for_review` → IN_REVIEW, then an admin approves it in the dashboard.
 */
@ExtendWith(MockitoExtension.class)
class CourseApprovalServiceNewCourseTest {

    @Mock private PackageRepository packageRepository;
    @Mock private PackageSessionRepository packageSessionRepository;
    @Mock private SubjectRepository subjectRepository;
    @Mock private ModuleRepository moduleRepository;
    @Mock private ChapterRepository chapterRepository;
    @Mock private SlideRepository slideRepository;
    @Mock private SubjectPackageSessionRepository subjectPackageSessionRepository;
    @Mock private SubjectModuleMappingRepository subjectModuleMappingRepository;
    @Mock private ModuleChapterMappingRepository moduleChapterMappingRepository;
    @Mock private ChapterPackageSessionMappingRepository chapterPackageSessionMappingRepository;
    @Mock private FacultySubjectPackageSessionMappingRepository facultySubjectPackageSessionMappingRepository;
    @Mock private ChapterManager chapterManager;
    @Mock private ModuleManager moduleManager;
    @Mock private SlideService slideService;
    @Mock private SubjectService subjectService;
    @Mock private ChapterToSlidesRepository chapterToSlidesRepository;
    @Mock private PackageInstituteRepository packageInstituteRepository;
    @Mock private InstituteRepository instituteRepository;
    @Mock private DefaultEnrollInviteService defaultEnrollInviteService;
    @Mock private EnrollInviteService enrollInviteService;

    @InjectMocks
    private CourseApprovalService service;

    private PackageEntity course;
    private PackageSession batch;
    private PackageInstitute packageInstitute;

    @BeforeEach
    void setUp() {
        course = new PackageEntity();
        course.setId("course-1");
        course.setPackageName("Plant Biology");
        course.setStatus("DRAFT");
        course.setCreatedByUserId("admin-1");
        course.setOriginalCourseId(null);

        batch = new PackageSession();
        batch.setId("ps-1");
        batch.setStatus("ACTIVE");

        Institute institute = new Institute();
        institute.setId("inst-1");
        packageInstitute = new PackageInstitute();
        packageInstitute.setPackageEntity(course);
        packageInstitute.setInstituteEntity(institute);
    }

    private static CustomUserDetails user(String id) {
        CustomUserDetails u = mock(CustomUserDetails.class);
        lenient().when(u.getUserId()).thenReturn(id);
        lenient().when(u.getId()).thenReturn(id);
        return u;
    }

    @Test
    @DisplayName("creator submits a brand-new DRAFT course → IN_REVIEW")
    void creatorSubmitsNewDraft() {
        when(packageRepository.findById("course-1")).thenReturn(Optional.of(course));

        String result = service.submitForReview("course-1", user("admin-1"));

        assertEquals("IN_REVIEW", course.getStatus());
        assertNotNull(course.getCourseAuditLogs());
        assertTrue(result.contains("submitted"));
        verify(packageRepository, atLeastOnce()).save(course);  // status, then the audit-log append
    }

    @Test
    @DisplayName("only the creator may submit, and only from DRAFT")
    void submitGuards() {
        when(packageRepository.findById("course-1")).thenReturn(Optional.of(course));
        assertThrows(VacademyException.class, () -> service.submitForReview("course-1", user("someone-else")));

        course.setStatus("ACTIVE");
        assertThrows(VacademyException.class, () -> service.submitForReview("course-1", user("admin-1")));
        verify(packageRepository, never()).save(any());
    }

    @Test
    @DisplayName("approving a NEW course (no originalCourseId) publishes it as ACTIVE and keeps its default invite")
    void approveNewCourseKeepsExistingDefaultInvite() {
        course.setStatus("IN_REVIEW");
        when(packageRepository.findById("course-1")).thenReturn(Optional.of(course));
        when(packageInstituteRepository.findTopByPackageEntity_IdOrderByCreatedAtDesc("course-1"))
                .thenReturn(Optional.of(packageInstitute));
        when(packageSessionRepository.findByPackageEntityId("course-1")).thenReturn(List.of(batch));
        // The MCP flow already made its own invite the DEFAULT one.
        when(enrollInviteService.findDefaultEnrollInviteByPackageSessionId("ps-1")).thenReturn(true);

        String result = service.approveCourseWithValidation("course-1", user("admin-2"), "looks good");

        assertEquals("New course published successfully", result);
        assertEquals("ACTIVE", course.getStatus());
        assertNull(course.getOriginalCourseId());
        verify(defaultEnrollInviteService, never()).createDefaultEnrollInvite(any(), any());
        // A new course is published in place — never deleted as a "temp copy".
        assertNotEquals("DELETED", course.getStatus());
    }

    @Test
    @DisplayName("approving a NEW course with no default invite creates one for each ACTIVE batch")
    void approveNewCourseCreatesMissingDefaultInvite() {
        course.setStatus("IN_REVIEW");
        PackageSession invited = new PackageSession();
        invited.setId("ps-invited");
        invited.setStatus("INVITED");
        when(packageRepository.findById("course-1")).thenReturn(Optional.of(course));
        when(packageInstituteRepository.findTopByPackageEntity_IdOrderByCreatedAtDesc("course-1"))
                .thenReturn(Optional.of(packageInstitute));
        when(packageSessionRepository.findByPackageEntityId("course-1")).thenReturn(List.of(batch, invited));
        when(enrollInviteService.findDefaultEnrollInviteByPackageSessionId("ps-1"))
                .thenThrow(new VacademyException("Default EnrollInvite not found"));

        service.approveCourseWithValidation("course-1", user("admin-2"), null);

        assertEquals("ACTIVE", course.getStatus());
        verify(defaultEnrollInviteService).createDefaultEnrollInvite(batch, "inst-1");
        verify(defaultEnrollInviteService, never()).createDefaultEnrollInvite(eq(invited), any());
    }

    @Test
    @DisplayName("a course that was never submitted cannot be approved")
    void approveRequiresInReview() {
        when(packageRepository.findById("course-1")).thenReturn(Optional.of(course)); // still DRAFT
        assertThrows(VacademyException.class,
                () -> service.approveCourseWithValidation("course-1", user("admin-2"), null));
        assertEquals("DRAFT", course.getStatus());
    }
}
