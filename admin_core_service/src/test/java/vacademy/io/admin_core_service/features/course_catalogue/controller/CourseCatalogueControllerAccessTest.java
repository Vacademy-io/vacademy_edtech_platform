package vacademy.io.admin_core_service.features.course_catalogue.controller;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.function.Executable;
import org.springframework.http.HttpStatus;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;
import vacademy.io.admin_core_service.core.security.InstituteAccessValidator;
import vacademy.io.admin_core_service.features.course_catalogue.dtos.CatalogueRevisionDTOs.RevisionResponse;
import vacademy.io.admin_core_service.features.course_catalogue.dtos.CatalogueRevisionDTOs.SaveDraftRequest;
import vacademy.io.admin_core_service.features.course_catalogue.dtos.CourseCatalogueRequest;
import vacademy.io.admin_core_service.features.course_catalogue.entity.CatalogueInstituteMapping;
import vacademy.io.admin_core_service.features.course_catalogue.manager.CourseCatalogueManager;
import vacademy.io.admin_core_service.features.course_catalogue.repository.CatalogueInstituteMappingRepository;
import vacademy.io.admin_core_service.features.course_catalogue.service.CatalogueRevisionService;
import vacademy.io.common.auth.dto.UserServiceDTO;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.ForbiddenException;
import vacademy.io.common.exceptions.VacademyException;
import vacademy.io.common.institute.entity.Institute;

import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/**
 * The catalogue-id endpoints (update + revisions) only serve a caller who
 * belongs to the institute that owns the catalogue.
 */
class CourseCatalogueControllerAccessTest {

    private static final String CATALOGUE = "cat-a";
    private static final String OWNER = "inst-a";
    private static final String OTHER = "inst-b";

    private CatalogueRevisionService revisionService;
    private CourseCatalogueManager catalogueManager;
    private CourseCatalogueController controller;

    @BeforeEach
    void setUp() {
        revisionService = mock(CatalogueRevisionService.class);
        catalogueManager = mock(CourseCatalogueManager.class);
        CatalogueInstituteMappingRepository mappings = mock(CatalogueInstituteMappingRepository.class);
        Institute owner = new Institute();
        owner.setId(OWNER);
        when(mappings.findByCourseCatalogueId(CATALOGUE))
                .thenReturn(Optional.of(CatalogueInstituteMapping.builder().institute(owner).build()));
        when(mappings.findByCourseCatalogueId("missing")).thenReturn(Optional.empty());
        when(revisionService.catalogueIdOf("rev-1")).thenReturn(CATALOGUE);

        controller = new CourseCatalogueController();
        ReflectionTestUtils.setField(controller, "catalogueManager", catalogueManager);
        ReflectionTestUtils.setField(controller, "revisionService", revisionService);
        ReflectionTestUtils.setField(controller, "catalogueInstituteMappingRepository", mappings);
        ReflectionTestUtils.setField(controller, "instituteAccessValidator", new InstituteAccessValidator());
    }

    @AfterEach
    void tearDown() {
        RequestContextHolder.resetRequestAttributes();
    }

    /** A non-root admin signed in to the institute named by the clientId header. */
    private static CustomUserDetails adminOf(String instituteId) {
        return userOf(instituteId, false, "ADMIN");
    }

    /** A user signed in to the institute named by the clientId header. */
    private static CustomUserDetails userOf(String instituteId, boolean rootUser, String... authorities) {
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.addHeader("clientId", instituteId);
        RequestContextHolder.setRequestAttributes(new ServletRequestAttributes(request));
        UserServiceDTO dto = new UserServiceDTO();
        dto.setUserId("u-1");
        dto.setUsername("u-1");
        dto.setFullName("User");
        dto.setRootUser(rootUser);
        dto.setAuthorities(List.of(authorities));
        return new CustomUserDetails(dto);
    }

    private List<Executable> everyCatalogueEndpoint(CustomUserDetails user) {
        return List.of(
                () -> controller.updateCatalogue(user, CATALOGUE, new CourseCatalogueRequest()),
                () -> controller.getDraft(user, CATALOGUE),
                () -> controller.saveDraft(user, CATALOGUE, new SaveDraftRequest("{}", "MANUAL", null)),
                () -> controller.publishDraft(user, CATALOGUE, true, null, null),
                () -> controller.publishDraft(user, CATALOGUE, false, 3, "abc123"),
                () -> controller.discardDraft(user, CATALOGUE),
                () -> controller.getRevisionHistory(user, CATALOGUE),
                () -> controller.getRevision(user, "rev-1"));
    }

    @Test
    void otherInstituteIsRefusedOnEveryEndpoint() {
        CustomUserDetails outsider = adminOf(OTHER);
        for (Executable call : everyCatalogueEndpoint(outsider)) {
            assertThrows(ForbiddenException.class, call);
        }
        verifyNoInteractions(catalogueManager);
        verify(revisionService).catalogueIdOf("rev-1");
        verify(revisionService, never()).publish(any(), any(), anyBoolean(), any());
        verify(revisionService, never()).publish(any(), any(), anyBoolean(), any(), any());
    }

    @Test
    void owningInstituteIsServed() throws Throwable {
        when(revisionService.getDraft(CATALOGUE)).thenReturn(Optional.empty());
        when(revisionService.publish(CATALOGUE, "u-1", true, null)).thenReturn(new RevisionResponse());
        CustomUserDetails admin = adminOf(OWNER);
        for (Executable call : everyCatalogueEndpoint(admin)) {
            call.execute();
        }
        verify(revisionService).publish(CATALOGUE, "u-1", true, null);
        // The checked draft's hash reaches the service (MCP publish).
        verify(revisionService).publish(CATALOGUE, "u-1", false, 3, "abc123");
        verify(revisionService).discardDraft(CATALOGUE);
    }

    /**
     * Learners (and invited staff) are created as root users. A learner of
     * another institute, who can read any site's catalogue id from the public
     * by-tag endpoint, must not get through on the root flag.
     */
    @Test
    void rootFlaggedLearnerOfAnotherInstituteIsRefused() {
        for (Executable call : everyCatalogueEndpoint(userOf(OTHER, true, "STUDENT"))) {
            assertThrows(ForbiddenException.class, call);
        }
        // Even one naming the owner institute as clientId, with no role there.
        for (Executable call : everyCatalogueEndpoint(userOf(OWNER, true))) {
            assertThrows(ForbiddenException.class, call);
        }
        verifyNoInteractions(catalogueManager);
        verify(revisionService, never()).publish(any(), any(), anyBoolean(), any());
        verify(revisionService, never()).publish(any(), any(), anyBoolean(), any(), any());
        verify(revisionService, never()).discardDraft(any());
    }

    @Test
    void learnerOfTheOwningInstituteIsRefused() {
        for (Executable call : everyCatalogueEndpoint(userOf(OWNER, true, "STUDENT"))) {
            assertThrows(ForbiddenException.class, call);
        }
        verifyNoInteractions(catalogueManager);
    }

    @Test
    void rootFlaggedStaffOfTheOwningInstituteIsServed() throws Throwable {
        when(revisionService.getDraft(CATALOGUE)).thenReturn(Optional.empty());
        for (Executable call : everyCatalogueEndpoint(userOf(OWNER, true, "TEACHER"))) {
            call.execute();
        }
        verify(revisionService).discardDraft(CATALOGUE);
    }

    @Test
    void unknownCatalogueIs404() {
        VacademyException ex = assertThrows(VacademyException.class,
                () -> controller.publishDraft(adminOf(OWNER), "missing", false, null, null));
        assertEquals(HttpStatus.NOT_FOUND, ex.getStatus());
    }
}
