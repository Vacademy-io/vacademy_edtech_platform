package vacademy.io.admin_core_service.features.course.service;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;
import vacademy.io.admin_core_service.features.commerce.common.CommerceLegacyGuard;
import vacademy.io.admin_core_service.features.course.dto.AddCourseDTO;
import vacademy.io.admin_core_service.features.course.dto.CopyCourseContentResponse;
import vacademy.io.admin_core_service.features.course.dto.duplicate.DuplicateCourseResponse;
import vacademy.io.admin_core_service.features.level.dto.AddLevelWithSessionDTO;
import vacademy.io.admin_core_service.features.packages.repository.PackageInstituteRepository;
import vacademy.io.admin_core_service.features.packages.repository.PackageRepository;
import vacademy.io.admin_core_service.features.packages.repository.PackageSessionRepository;
import vacademy.io.admin_core_service.features.packages.service.PackagePageContentService;
import vacademy.io.admin_core_service.features.session.dto.AddNewSessionDTO;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.VacademyException;
import vacademy.io.common.institute.entity.Group;
import vacademy.io.common.institute.entity.Level;
import vacademy.io.common.institute.entity.PackageEntity;
import vacademy.io.common.institute.entity.session.PackageSession;
import vacademy.io.common.institute.entity.session.Session;

import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.*;

/**
 * One-click "Duplicate course": the new course goes through the create-course path with the
 * source's details and batches, every batch's content is copied as a SEPARATE (VALUE) copy into
 * its twin, and people / money / invites / catalogue publishing never come along.
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class CourseDuplicateServiceTest {

    private static final String INSTITUTE = "inst-1";
    private static final String SOURCE_ID = "course-src";
    private static final String NEW_ID = "course-new";

    @Mock private PackageRepository packageRepository;
    @Mock private PackageSessionRepository packageSessionRepository;
    @Mock private PackageInstituteRepository packageInstituteRepository;
    @Mock private PackagePageContentService packagePageContentService;
    @Mock private CourseService courseService;
    @Mock private CourseContentCopyService courseContentCopyService;
    @Mock private CommerceLegacyGuard commerceLegacyGuard;

    @InjectMocks private CourseDuplicateService service;

    private CustomUserDetails user;
    private PackageEntity source;
    private PackageEntity created;

    @BeforeEach
    void setUp() {
        user = mock(CustomUserDetails.class);
        when(user.getUserId()).thenReturn("admin-1");

        source = new PackageEntity();
        source.setId(SOURCE_ID);
        source.setPackageName("Accounts 101");
        source.setStatus("ACTIVE");
        source.setThumbnailFileId("thumb");
        source.setCoursePreviewImageMediaId("preview");
        source.setCourseBannerMediaId("banner");
        source.setCourseMediaId("media");
        source.setWhyLearn("<p>why</p>");
        source.setWhoShouldLearn("<p>who</p>");
        source.setAboutTheCourse("<p>about</p>");
        source.setCourseHtmlDescription("<p>desc</p>");
        source.setTags("finance, exam ,,cbe");
        source.setCourseDepth(5);
        source.setCourseSetting("{\"setting\":{}}");
        source.setDripConditionJson("{\"rules\":[]}");
        source.setIsCoursePublishedToCatalaouge(true);
        source.setVersionNumber(7);
        source.setOriginalCourseId("some-original");
        source.setCreatedByUserId("someone-else");

        created = new PackageEntity();
        created.setId(NEW_ID);
        created.setPackageName("Accounts 101 (Copy)");

        when(packageRepository.findById(SOURCE_ID)).thenReturn(Optional.of(source));
        when(packageRepository.findById(NEW_ID)).thenReturn(Optional.of(created));
        when(packageInstituteRepository.existsLink(SOURCE_ID, INSTITUTE)).thenReturn(true);
        when(packagePageContentService.getContentJson(SOURCE_ID)).thenReturn("{\"v\":1,\"faqs\":[]}");
        when(courseService.addCourse(any(AddCourseDTO.class), eq(user), eq(INSTITUTE))).thenReturn(NEW_ID);
        when(courseContentCopyService.copy(anyString(), anyList(), anyString(), any()))
                .thenAnswer(inv -> CopyCourseContentResponse.builder()
                        .copiedSubjects(1).copiedModules(2).copiedChapters(3).copiedSlides(4)
                        .warnings(new ArrayList<>()).build());
    }

    private static Session session(String id, String name) {
        return new Session(id, name, "ACTIVE", new Date(0));
    }

    private static Level level(String id, String name) {
        Level l = new Level();
        l.setId(id);
        l.setLevelName(name);
        return l;
    }

    private static PackageSession batch(String id, Session s, Level l, String name, String status,
                                        String parentId, long createdAtMillis) {
        PackageSession ps = new PackageSession();
        ps.setId(id);
        ps.setSession(s);
        ps.setLevel(l);
        ps.setName(name);
        ps.setStatus(status);
        ps.setParentId(parentId);
        ps.setCreatedAt(new Date(createdAtMillis));
        ps.setStartTime(new Date(createdAtMillis + 1000));
        return ps;
    }

    @Test
    @DisplayName("creates the course through the create path with the source's details, not its people or money")
    void createPayloadCopiesDetailsOnly() {
        Session s = session("sess-1", "2026");
        Level l = level("lvl-1", "Class 11");
        when(packageSessionRepository.findByPackageEntityId(SOURCE_ID))
                .thenReturn(List.of(batch("src-a", s, l, null, "ACTIVE", null, 1)));
        when(packageSessionRepository.findByPackageEntityId(NEW_ID))
                .thenReturn(List.of(batch("new-a", s, l, null, "ACTIVE", null, 2)));

        service.duplicate(INSTITUTE, SOURCE_ID, null, user);

        ArgumentCaptor<AddCourseDTO> captor = ArgumentCaptor.forClass(AddCourseDTO.class);
        verify(courseService).addCourse(captor.capture(), eq(user), eq(INSTITUTE));
        AddCourseDTO dto = captor.getValue();

        assertTrue(dto.getNewCourse());
        assertTrue(dto.getForceNewCourse(), "must never merge into a same-named course");
        assertEquals("Accounts 101 (Copy)", dto.getCourseName());
        assertEquals("thumb", dto.getThumbnailFileId());
        assertEquals("preview", dto.getCoursePreviewImageMediaId());
        assertEquals("banner", dto.getCourseBannerMediaId());
        assertEquals("media", dto.getCourseMediaId());
        assertEquals("<p>why</p>", dto.getWhyLearnHtml());
        assertEquals("<p>who</p>", dto.getWhoShouldLearnHtml());
        assertEquals("<p>about</p>", dto.getAboutTheCourseHtml());
        assertEquals("<p>desc</p>", dto.getCourseHtmlDescription());
        assertEquals(List.of("finance", "exam", "cbe"), dto.getTags());
        assertEquals(5, dto.getCourseDepth());
        assertEquals("{\"setting\":{}}", dto.getCourseSetting());
        assertEquals("{\"v\":1,\"faqs\":[]}", dto.getCoursePageJson());

        // Fresh-course defaults, not the source's state.
        assertNull(dto.getStatus(), "status left to the create path (ACTIVE for a new course)");
        assertNull(dto.getVersionNumber());
        assertNull(dto.getOriginalCourseId(), "not a teacher-approval editable copy");
        assertEquals("admin-1", dto.getCreatedByUserId());
        assertFalse(dto.getIsCoursePublishedToCatalaouge(), "a copy starts unpublished");
        assertNull(dto.getAddFacultyToCourse(), "teachers are not copied");

        // Batches: same session + level, existing rows reused (not new levels / sessions).
        assertTrue(dto.getContainLevels());
        assertEquals(1, dto.getSessions().size());
        AddNewSessionDTO sessionDto = dto.getSessions().get(0);
        assertEquals("sess-1", sessionDto.getId());
        assertFalse(sessionDto.isNewSession());
        assertEquals(1, sessionDto.getLevels().size());
        AddLevelWithSessionDTO levelDto = sessionDto.getLevels().get(0);
        assertEquals("lvl-1", levelDto.getId());
        assertFalse(levelDto.getNewLevel());
        assertNull(levelDto.getAddFacultyToCourse());

        // Course-wide drip rules copied onto the new package row.
        assertEquals("{\"rules\":[]}", created.getDripConditionJson());
        verify(commerceLegacyGuard).refuseProduct(source, "duplicate");
    }

    @Test
    @DisplayName("copies every batch's content as a separate copy into its own twin, and skips invited / deleted rows")
    void copiesEachBatchByValueIntoItsTwin() {
        Session s1 = session("sess-1", "2026");
        Session s2 = session("sess-2", "2027");
        Level l1 = level("lvl-1", "Class 11");
        Level l2 = level("lvl-2", "Class 12");
        Group g = new Group();
        g.setId("grp-1");

        PackageSession srcA = batch("src-a", s1, l1, null, "ACTIVE", null, 1);
        srcA.setGroup(g);
        PackageSession srcB = batch("src-b", s1, l2, "Evening", "HIDDEN", null, 2);
        PackageSession srcC = batch("src-c", s2, l1, null, "ACTIVE", null, 3);
        PackageSession invited = batch("src-inv", session("INVITED", "INVITED"), level("INVITED", "INVITED"),
                null, "INVITED", null, 0);
        PackageSession deleted = batch("src-del", s2, l2, null, "DELETED", null, 4);
        when(packageSessionRepository.findByPackageEntityId(SOURCE_ID))
                .thenReturn(List.of(srcC, invited, deleted, srcB, srcA));

        // The create path returns the new batches in some other order, plus its own INVITED row.
        PackageSession newC = batch("new-c", s2, l1, null, "ACTIVE", null, 10);
        PackageSession newB = batch("new-b", s1, l2, "Evening", "ACTIVE", null, 11);
        PackageSession newA = batch("new-a", s1, l1, null, "ACTIVE", null, 12);
        PackageSession newInvited = batch("new-inv", session("INVITED", "INVITED"), level("INVITED", "INVITED"),
                null, "INVITED", null, 9);
        when(packageSessionRepository.findByPackageEntityId(NEW_ID))
                .thenReturn(List.of(newInvited, newC, newB, newA));

        DuplicateCourseResponse res = service.duplicate(INSTITUTE, SOURCE_ID, "  Accounts 2027  ", user);

        ArgumentCaptor<AddCourseDTO> captor = ArgumentCaptor.forClass(AddCourseDTO.class);
        verify(courseService).addCourse(captor.capture(), any(), any());
        AddCourseDTO dto = captor.getValue();
        assertEquals("Accounts 2027", dto.getCourseName());
        assertEquals(2, dto.getSessions().size(), "one entry per source session");
        assertEquals("sess-1", dto.getSessions().get(0).getId());
        assertEquals(List.of("lvl-1", "lvl-2"),
                dto.getSessions().get(0).getLevels().stream().map(AddLevelWithSessionDTO::getId).toList());
        assertEquals("grp-1", dto.getSessions().get(0).getLevels().get(0).getGroup().getId());
        assertFalse(dto.getSessions().get(0).getLevels().get(0).getGroup().isNewGroup());
        assertEquals("Evening", dto.getSessions().get(0).getLevels().get(1).getBatchName());

        verify(courseContentCopyService).copy("src-a", List.of("new-a"), "VALUE", "admin-1");
        verify(courseContentCopyService).copy("src-b", List.of("new-b"), "VALUE", "admin-1");
        verify(courseContentCopyService).copy("src-c", List.of("new-c"), "VALUE", "admin-1");
        verify(courseContentCopyService, never()).copy(eq("src-inv"), anyList(), anyString(), any());
        verify(courseContentCopyService, never()).copy(eq("src-del"), anyList(), anyString(), any());
        verify(courseContentCopyService, never()).copy(anyString(), anyList(), eq("REFERENCE"), any());

        // Batch state mirrors the source (hidden stays hidden, start date kept).
        assertEquals("HIDDEN", newB.getStatus());
        assertEquals(srcB.getStartTime(), newB.getStartTime());

        assertEquals(NEW_ID, res.getCourseId());
        assertEquals("Accounts 101 (Copy)", res.getCourseName(), "name read back from the saved row");
        assertEquals(3, res.getBatchesCopied());
        assertEquals(3, res.getCopiedSubjects());
        assertEquals(12, res.getCopiedSlides());
        assertEquals("sess-1", res.getSessionId(), "opens on the first (oldest) source batch's twin");
        assertEquals("lvl-1", res.getLevelId());
        assertTrue(res.getWarnings().isEmpty());
    }

    @Test
    @DisplayName("sub-batches are recreated as subgroups of their parent and paired through the parent")
    void subBatchesFollowTheirParent() {
        Session s = session("sess-1", "2026");
        Level l = level("lvl-1", "Class 11");
        PackageSession parent = batch("src-p", s, l, null, "ACTIVE", null, 1);
        parent.setIsParent(true);
        PackageSession childA = batch("src-ca", s, l, "Section A", "ACTIVE", "src-p", 2);
        PackageSession childB = batch("src-cb", s, l, "Section B", "ACTIVE", "src-p", 3);
        when(packageSessionRepository.findByPackageEntityId(SOURCE_ID))
                .thenReturn(List.of(childB, parent, childA));

        PackageSession newParent = batch("new-p", s, l, null, "ACTIVE", null, 10);
        PackageSession newCa = batch("new-ca", s, l, "Section A", "ACTIVE", "new-p", 11);
        PackageSession newCb = batch("new-cb", s, l, "Section B", "ACTIVE", "new-p", 12);
        when(packageSessionRepository.findByPackageEntityId(NEW_ID))
                .thenReturn(List.of(newCb, newCa, newParent));

        DuplicateCourseResponse res = service.duplicate(INSTITUTE, SOURCE_ID, null, user);

        ArgumentCaptor<AddCourseDTO> captor = ArgumentCaptor.forClass(AddCourseDTO.class);
        verify(courseService).addCourse(captor.capture(), any(), any());
        List<AddLevelWithSessionDTO> levels = captor.getValue().getSessions().get(0).getLevels();
        assertEquals(1, levels.size(), "children are not separate top-level batches");
        assertEquals(List.of("Section A", "Section B"),
                levels.get(0).getSubgroups().stream().map(sg -> sg.getName()).toList());

        verify(courseContentCopyService).copy("src-p", List.of("new-p"), "VALUE", "admin-1");
        verify(courseContentCopyService).copy("src-ca", List.of("new-ca"), "VALUE", "admin-1");
        verify(courseContentCopyService).copy("src-cb", List.of("new-cb"), "VALUE", "admin-1");
        assertEquals(3, res.getBatchesCopied());
    }

    @Test
    @DisplayName("a source batch with no twin is reported, not silently dropped")
    void unmatchedBatchIsWarned() {
        Session s = session("sess-1", "2026");
        Level l = level("lvl-1", "Class 11");
        when(packageSessionRepository.findByPackageEntityId(SOURCE_ID))
                .thenReturn(List.of(batch("src-a", s, l, null, "ACTIVE", null, 1),
                        batch("src-b", s, level("lvl-2", "Class 12"), null, "ACTIVE", null, 2)));
        when(packageSessionRepository.findByPackageEntityId(NEW_ID))
                .thenReturn(List.of(batch("new-a", s, l, null, "ACTIVE", null, 10)));

        DuplicateCourseResponse res = service.duplicate(INSTITUTE, SOURCE_ID, null, user);

        assertEquals(1, res.getBatchesCopied());
        assertEquals(1, res.getWarnings().size());
        assertTrue(res.getWarnings().get(0).contains("Class 12"));
    }

    @Test
    @DisplayName("a course with no batches still duplicates, on the default batch the create path makes")
    void noBatchesUsesDefaultCreatePath() {
        when(packageSessionRepository.findByPackageEntityId(SOURCE_ID)).thenReturn(List.of());
        when(packageSessionRepository.findByPackageEntityId(NEW_ID)).thenReturn(
                List.of(batch("new-d", session("DEFAULT", "DEFAULT"), level("DEFAULT", "DEFAULT"), null,
                        "ACTIVE", null, 1)));

        DuplicateCourseResponse res = service.duplicate(INSTITUTE, SOURCE_ID, "", user);

        ArgumentCaptor<AddCourseDTO> captor = ArgumentCaptor.forClass(AddCourseDTO.class);
        verify(courseService).addCourse(captor.capture(), any(), any());
        assertFalse(captor.getValue().getContainLevels());
        verify(courseContentCopyService, never()).copy(anyString(), anyList(), anyString(), any());
        assertEquals("DEFAULT", res.getSessionId());
        assertEquals(0, res.getBatchesCopied());
    }

    @Test
    @DisplayName("refuses a course of another institute, and a deleted course, before writing anything")
    void refusesForeignOrDeletedCourse() {
        when(packageInstituteRepository.existsLink(SOURCE_ID, "other-inst")).thenReturn(false);
        assertThrows(VacademyException.class, () -> service.duplicate("other-inst", SOURCE_ID, null, user));

        source.setStatus("DELETED");
        assertThrows(VacademyException.class, () -> service.duplicate(INSTITUTE, SOURCE_ID, null, user));

        when(packageRepository.findById("missing")).thenReturn(Optional.empty());
        assertThrows(VacademyException.class, () -> service.duplicate(INSTITUTE, "missing", null, user));

        verify(courseService, never()).addCourse(any(), any(), any());
        verify(courseContentCopyService, never()).copy(anyString(), anyList(), anyString(), any());
    }

    @Test
    @DisplayName("refuses a commerce product before writing anything")
    void refusesCommerceProduct() {
        doThrow(new VacademyException("refused")).when(commerceLegacyGuard).refuseProduct(source, "duplicate");
        assertThrows(VacademyException.class, () -> service.duplicate(INSTITUTE, SOURCE_ID, null, user));
        verify(courseService, never()).addCourse(any(), any(), any());
    }

    @Test
    @DisplayName("default name is '<name> (Copy)', and long names are capped to the column size")
    void nameRules() {
        assertEquals("Maths (Copy)", CourseDuplicateService.resolveName(null, "Maths"));
        assertEquals("Maths (Copy)", CourseDuplicateService.resolveName("   ", " Maths "));
        assertEquals("New", CourseDuplicateService.resolveName(" New ", "Maths"));
        assertEquals("Course (Copy)", CourseDuplicateService.resolveName(null, null));
        String longName = "x".repeat(300);
        assertEquals(255, CourseDuplicateService.resolveName(longName, "Maths").length());
    }
}
