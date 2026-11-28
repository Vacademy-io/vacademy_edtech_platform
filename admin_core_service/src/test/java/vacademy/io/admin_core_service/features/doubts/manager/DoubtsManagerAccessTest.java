package vacademy.io.admin_core_service.features.doubts.manager;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.Spy;
import org.mockito.invocation.Invocation;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;
import vacademy.io.admin_core_service.core.security.InstituteAccessValidator;
import vacademy.io.admin_core_service.features.auth_service.service.AuthService;
import vacademy.io.admin_core_service.features.doubts.dtos.DoubtsDto;
import vacademy.io.admin_core_service.features.doubts.dtos.DoubtsRequestFilter;
import vacademy.io.admin_core_service.features.doubts.entity.DoubtAssignee;
import vacademy.io.admin_core_service.features.doubts.entity.Doubts;
import vacademy.io.admin_core_service.features.doubts.repository.DoubtsAssigneeRepository;
import vacademy.io.admin_core_service.features.doubts.service.DoubtService;
import vacademy.io.admin_core_service.features.doubts.service.DoubtStatusCatalog;
import vacademy.io.admin_core_service.features.faculty.entity.FacultySubjectPackageSessionMapping;
import vacademy.io.admin_core_service.features.faculty.repository.FacultySubjectPackageSessionMappingRepository;
import vacademy.io.admin_core_service.features.institute.service.setting.InstituteSettingService;
import vacademy.io.admin_core_service.features.slide.service.SlideMetaDataService;
import vacademy.io.admin_core_service.features.suborg.service.SubOrgStaffLookupService;
import vacademy.io.admin_core_service.features.workflow.service.WorkflowTriggerService;
import vacademy.io.common.auth.dto.UserServiceDTO;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.ForbiddenException;

import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mockingDetails;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Who may change ({@code doubts/create?doubtId=X}) or read ({@code GET /doubts/{id}},
 * {@code /{id}/activity}) an existing doubt. Both used to accept any logged-in caller for any
 * doubt id in any institute. Now:
 * <ul>
 *   <li>staff of the doubt's institute — anything (assign, resolve, delete, read);</li>
 *   <li>its author — edit text, resolve/reopen, delete, read; assignment changes are dropped;</li>
 *   <li>an assignee / faculty of its batch who is not institute staff — status changes and read,
 *       not text edits or delete;</li>
 *   <li>anyone else (another learner, staff of another institute) — 403.</li>
 * </ul>
 * And {@code get-all}: the whole-institute list only for staff of the institute asked for; others
 * (an admin naming another institute or none, a root-flagged account without roles) are scoped.
 * The real {@link InstituteAccessValidator} decides staff; the clientId header is set per test.
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class DoubtsManagerAccessTest {

    private static final String PS = "ps-1";
    private static final String INST = "inst-1";
    private static final String OTHER_INST = "inst-2";
    private static final String LEARNER = "learner-1";
    private static final String OTHER_LEARNER = "learner-2";
    private static final String ADMIN = "admin-1";
    private static final String ASSIGNEE = "teacher-1";
    private static final String DOUBT_ID = "doubt-1";
    private static final String REPLY_ID = "reply-1";

    @Mock private DoubtService doubtService;
    @Mock private FacultySubjectPackageSessionMappingRepository facultyMappingRepository;
    @Mock private InstituteSettingService instituteSettingService;
    @Mock private SlideMetaDataService slideMetaDataService;
    @Mock private DoubtNotificationService doubtNotificationService;
    @Mock private DoubtsAssigneeRepository doubtsAssigneeRepository;
    @Mock private AuthService authService;
    @Mock private WorkflowTriggerService workflowTriggerService;
    @Mock private SubOrgStaffLookupService subOrgStaffLookupService;
    @Spy private InstituteAccessValidator instituteAccessValidator = new InstituteAccessValidator();

    @InjectMocks private DoubtsManager manager;

    private Doubts doubt;

    @BeforeEach
    void wire() {
        clientIdHeader(INST);
        doubt = Doubts.builder()
                .id(DOUBT_ID).userId(LEARNER).source("SLIDE").sourceId("slide-1").type("DOUBT")
                .instituteId(INST).packageSessionId(PS).status("ACTIVE").htmlText("original").parentLevel(0)
                .build();
        when(doubtService.getDoubtById(DOUBT_ID)).thenReturn(Optional.of(doubt));
        when(doubtsAssigneeRepository.findByDoubtIdAndStatusNotIn(eq(DOUBT_ID), anyList()))
                .thenReturn(List.of(DoubtAssignee.builder().id("row-1").source("USER").sourceId(ASSIGNEE)
                        .status("ACTIVE").build()));
        when(doubtService.getStatusCatalog(INST)).thenReturn(DoubtStatusCatalog.defaults());
        when(doubtService.updateOrCreateDoubt(any(Doubts.class))).thenAnswer(inv -> inv.getArgument(0));
        when(doubtService.createDtoFromDoubts(anyList())).thenReturn(List.of(DoubtsDto.builder().id(DOUBT_ID).build()));
        when(facultyMappingRepository.findByUserId(any())).thenReturn(List.of());
    }

    @AfterEach
    void resetRequestContext() {
        RequestContextHolder.resetRequestAttributes();
    }

    private static void clientIdHeader(String instituteId) {
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.addHeader("clientId", instituteId);
        RequestContextHolder.setRequestAttributes(new ServletRequestAttributes(request));
    }

    private static CustomUserDetails principal(String userId, String... authorities) {
        UserServiceDTO dto = new UserServiceDTO();
        dto.setUserId(userId);
        dto.setUsername(userId);
        dto.setFullName(userId);
        dto.setRootUser(false);
        dto.setAuthorities(List.of(authorities));
        return new CustomUserDetails(dto);
    }

    /** What the learner app sends on resolve/delete: the doubt echoed back, assignee lists included. */
    private static DoubtsDto echo(String status) {
        return DoubtsDto.builder()
                .id(DOUBT_ID).userId(LEARNER).htmlText("original").status(status)
                .doubtAssigneeRequestUserIds(List.of("teacher-9"))
                .excludedAssigneeUserIds(List.of("teacher-8"))
                .build();
    }

    // ---------------------------------------------------------------- update

    @Test
    @DisplayName("update: the author (a learner) can resolve their own doubt; echoed assignee lists are dropped")
    void authorResolves() {
        manager.updateOrCreateDoubt(principal(LEARNER, "STUDENT"), DOUBT_ID, echo("RESOLVED"));
        assertEquals("RESOLVED", doubt.getStatus());
        verify(doubtService, never()).saveOrUpdateDoubtsAssignee(any());
    }

    @Test
    @DisplayName("update: the author can delete and edit their own doubt")
    void authorDeletesAndEdits() {
        manager.updateOrCreateDoubt(principal(LEARNER, "STUDENT"), DOUBT_ID,
                DoubtsDto.builder().htmlText("edited").status("DELETED").build());
        assertEquals("DELETED", doubt.getStatus());
        assertEquals("edited", doubt.getHtmlText());
    }

    @Test
    @DisplayName("update: another learner gets a 403 and nothing changes")
    void otherLearnerRefused() {
        assertThrows(ForbiddenException.class, () -> manager.updateOrCreateDoubt(
                principal(OTHER_LEARNER, "STUDENT"), DOUBT_ID, DoubtsDto.builder().status("DELETED").build()));
        assertEquals("ACTIVE", doubt.getStatus());
        verify(doubtService, never()).updateOrCreateDoubt(any(Doubts.class));
    }

    @Test
    @DisplayName("update: staff of the doubt's institute can assign and resolve")
    void staffAssignsAndResolves() {
        manager.updateOrCreateDoubt(principal(ADMIN, "ADMIN"), DOUBT_ID, DoubtsDto.builder()
                .status("RESOLVED").doubtAssigneeRequestUserIds(List.of("teacher-2")).build());
        assertEquals("RESOLVED", doubt.getStatus());
        verify(doubtService).saveOrUpdateDoubtsAssignee(anyList());
    }

    @Test
    @DisplayName("update: staff of ANOTHER institute gets a 403")
    void otherInstituteStaffRefused() {
        clientIdHeader(OTHER_INST);
        assertThrows(ForbiddenException.class, () -> manager.updateOrCreateDoubt(
                principal(ADMIN, "ADMIN"), DOUBT_ID, DoubtsDto.builder().status("DELETED").build()));
        assertEquals("ACTIVE", doubt.getStatus());
    }

    @Test
    @DisplayName("update: an assignee who isn't institute staff (STUDENT + TEACHER) can resolve but not edit text, assign or delete")
    void nonStaffAssigneeResolvesOnly() {
        CustomUserDetails assignee = principal(ASSIGNEE, "STUDENT", "TEACHER");
        manager.updateOrCreateDoubt(assignee, DOUBT_ID, DoubtsDto.builder()
                .status("RESOLVED").htmlText("rewritten").doubtAssigneeRequestUserIds(List.of("teacher-9")).build());
        assertEquals("RESOLVED", doubt.getStatus());
        assertEquals("original", doubt.getHtmlText());
        verify(doubtService, never()).saveOrUpdateDoubtsAssignee(any());

        assertThrows(ForbiddenException.class, () -> manager.updateOrCreateDoubt(
                assignee, DOUBT_ID, DoubtsDto.builder().status("DELETED").build()));
        assertEquals("RESOLVED", doubt.getStatus());
    }

    @Test
    @DisplayName("update: faculty of the doubt's batch (get-all already lists it for them) can resolve")
    void batchFacultyResolves() {
        FacultySubjectPackageSessionMapping mapping = new FacultySubjectPackageSessionMapping();
        mapping.setUserId("teacher-5");
        mapping.setPackageSessionId(PS);
        mapping.setStatus("ACTIVE");
        when(facultyMappingRepository.findByUserId("teacher-5")).thenReturn(List.of(mapping));

        manager.updateOrCreateDoubt(principal("teacher-5", "STUDENT", "TEACHER"), DOUBT_ID,
                DoubtsDto.builder().status("RESOLVED").build());
        assertEquals("RESOLVED", doubt.getStatus());
    }

    // ---------------------------------------------------------------- read

    @Test
    @DisplayName("read: author, institute staff and an assignee can open the doubt by id")
    void readAllowed() {
        assertEquals(200, manager.getDoubtById(principal(LEARNER, "STUDENT"), DOUBT_ID).getStatusCode().value());
        assertEquals(200, manager.getDoubtById(principal(ADMIN, "ADMIN"), DOUBT_ID).getStatusCode().value());
        clientIdHeader(OTHER_INST);
        assertEquals(200, manager.getDoubtById(principal(ASSIGNEE, "TEACHER"), DOUBT_ID).getStatusCode().value());
    }

    @Test
    @DisplayName("read: another learner and staff of another institute get a 403")
    void readRefused() {
        assertThrows(ForbiddenException.class,
                () -> manager.getDoubtById(principal(OTHER_LEARNER, "STUDENT"), DOUBT_ID));
        clientIdHeader(OTHER_INST);
        assertThrows(ForbiddenException.class,
                () -> manager.getDoubtById(principal(ADMIN, "ADMIN"), DOUBT_ID));
    }

    @Test
    @DisplayName("read: the learner who raised the thread can open a teacher's reply in it")
    void threadAuthorReadsReply() {
        Doubts reply = Doubts.builder().id(REPLY_ID).userId(ADMIN).parentId(DOUBT_ID).instituteId(INST)
                .status("ACTIVE").parentLevel(1).build();
        when(doubtService.getDoubtById(REPLY_ID)).thenReturn(Optional.of(reply));
        assertEquals(200, manager.getDoubtById(principal(LEARNER, "STUDENT"), REPLY_ID).getStatusCode().value());
        assertThrows(ForbiddenException.class,
                () -> manager.getDoubtById(principal(OTHER_LEARNER, "STUDENT"), REPLY_ID));
    }

    @Test
    @DisplayName("activity: staff of another institute gets a 403; an assignee (staff role) can read it")
    void activityScopedToInstitute() {
        when(doubtService.getActivity(DOUBT_ID)).thenReturn(List.of());
        clientIdHeader(OTHER_INST);
        assertThrows(ForbiddenException.class,
                () -> manager.getDoubtActivity(principal(ADMIN, "ADMIN"), DOUBT_ID));
        assertEquals(200, manager.getDoubtActivity(principal(ASSIGNEE, "TEACHER"), DOUBT_ID).getStatusCode().value());
    }

    // ---------------------------------------------------------------- list

    /** {institute_id, viewer_user_id} the list query ran with for this caller and body institute. */
    private String[] listedAs(CustomUserDetails caller, String instituteId) {
        DoubtsRequestFilter filter = new DoubtsRequestFilter();
        filter.setInstituteId(instituteId);
        manager.getAllDoubts(caller, filter, 0, 10);
        Invocation call = mockingDetails(doubtService).getInvocations().stream()
                .filter(i -> i.getMethod().getName().equals("getAllDoubtsWithFilter"))
                .reduce((first, last) -> last).orElse(null);
        return call == null ? null : new String[]{call.getArgument(10), call.getArgument(11)};
    }

    @Test
    @DisplayName("list: an admin of the institute sees the whole institute")
    void listAdminOwnInstitute() {
        assertArrayEquals(new String[]{INST, null}, listedAs(principal(ADMIN, "ADMIN"), INST));
    }

    @Test
    @DisplayName("list: an admin naming another institute, or none, only gets their own scoped view")
    void listAdminOtherInstituteScoped() {
        assertArrayEquals(new String[]{OTHER_INST, ADMIN}, listedAs(principal(ADMIN, "ADMIN"), OTHER_INST));
        assertArrayEquals(new String[]{null, ADMIN}, listedAs(principal(ADMIN, "ADMIN"), null));
        assertArrayEquals(new String[]{null, ADMIN}, listedAs(principal(ADMIN, "ADMIN"), " "));
    }

    @Test
    @DisplayName("list: a root-flagged account with no roles (every learner; spoofed clientId) is scoped")
    void listRootWithoutRolesScoped() {
        UserServiceDTO dto = new UserServiceDTO();
        dto.setUserId(LEARNER);
        dto.setUsername(LEARNER);
        dto.setRootUser(true);
        dto.setAuthorities(List.of());
        assertArrayEquals(new String[]{null, LEARNER}, listedAs(new CustomUserDetails(dto), null));
    }

    @Test
    @DisplayName("list: a learner stays scoped to their own doubts")
    void listLearnerScoped() {
        assertArrayEquals(new String[]{INST, LEARNER}, listedAs(principal(LEARNER, "STUDENT"), INST));
    }
}
