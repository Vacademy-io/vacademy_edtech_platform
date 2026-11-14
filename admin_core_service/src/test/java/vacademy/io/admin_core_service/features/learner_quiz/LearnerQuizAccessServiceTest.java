package vacademy.io.admin_core_service.features.learner_quiz;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;
import vacademy.io.admin_core_service.core.security.InstituteAccessValidator;
import vacademy.io.admin_core_service.features.learner_quiz.repository.LearnerQuizAttemptRepository;
import vacademy.io.admin_core_service.features.learner_quiz.repository.LearnerQuizAttemptRepository.SlideMembershipRow;
import vacademy.io.admin_core_service.features.learner_quiz.service.LearnerQuizAccessService;
import vacademy.io.common.auth.dto.UserServiceDTO;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.ForbiddenException;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class LearnerQuizAccessServiceTest {

    private final LearnerQuizAttemptRepository repository = mock(LearnerQuizAttemptRepository.class);
    private final LearnerQuizAccessService service =
            new LearnerQuizAccessService(repository, new InstituteAccessValidator());

    @AfterEach
    void clearRequest() {
        RequestContextHolder.resetRequestAttributes();
    }

    private static CustomUserDetails user(boolean root, String... authorities) {
        UserServiceDTO dto = new UserServiceDTO();
        dto.setUserId("u1");
        dto.setUsername("u");
        dto.setRootUser(root);
        dto.setAuthorities(List.of(authorities));
        return new CustomUserDetails(dto);
    }

    private static SlideMembershipRow membership(String institute, String session, String chapter) {
        return new SlideMembershipRow() {
            public String getInstituteId() { return institute; }
            public String getPackageSessionId() { return session; }
            public String getChapterId() { return chapter; }
        };
    }

    private static void clientId(String id) {
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.addHeader("clientId", id);
        RequestContextHolder.setRequestAttributes(new ServletRequestAttributes(request));
    }

    @Test
    @DisplayName("a learner with a live membership passes, on the batch the request names")
    void liveMembership() {
        when(repository.findLiveMemberships("u1", "s")).thenReturn(List.of(membership("i1", "ps1", "c1"),
                membership("i1", "ps2", "c2")));
        LearnerQuizAccessService.Access access = service.requireAccess(user(true, "STUDENT"), "s", "i1", "ps2", "c2");
        assertThat(access.instituteId()).isEqualTo("i1");
        assertThat(access.packageSessionId()).isEqualTo("ps2");
        assertThat(access.chapterId()).isEqualTo("c2");
    }

    @Test
    @DisplayName("a batch the learner is not in is not taken from the request")
    void requestedBatchIsNotTrusted() {
        when(repository.findLiveMemberships("u1", "s")).thenReturn(List.of(membership("i1", "ps1", "c1")));
        LearnerQuizAccessService.Access access = service.requireAccess(user(false, "STUDENT"), "s", "i1", "ps9", "c9");
        assertThat(access.packageSessionId()).isEqualTo("ps1");
        assertThat(access.chapterId()).isEqualTo("c1");
    }

    @Test
    @DisplayName("the root flag grants nothing")
    void rootFlagIsNotAccess() {
        when(repository.findLiveMemberships("u1", "s")).thenReturn(List.of());
        when(repository.findInstitutesOfSlide("s")).thenReturn(List.of("i1"));
        clientId("i1");
        assertThatThrownBy(() -> service.requireAccess(user(true, "STUDENT"), "s", "i1", null, null))
                .isInstanceOf(ForbiddenException.class).hasMessage(LearnerQuizAccessService.NOT_ENROLLED);
    }

    @Test
    void rootWithNoAuthoritiesAndNoHeaderIsRefused() {
        when(repository.findLiveMemberships("u1", "s")).thenReturn(List.of());
        assertThatThrownBy(() -> service.requireAccess(user(true), "s", null, null, null))
                .isInstanceOf(ForbiddenException.class);
    }

    @Test
    @DisplayName("staff of the institute that owns the course may preview")
    void staffPreview() {
        when(repository.findLiveMemberships("u1", "s")).thenReturn(List.of());
        when(repository.findInstitutesOfSlide("s")).thenReturn(List.of("i1"));
        clientId("i1");
        LearnerQuizAccessService.Access access = service.requireAccess(user(false, "ADMIN"), "s", "i1", "ps", "c");
        assertThat(access.instituteId()).isEqualTo("i1");
    }

    @Test
    @DisplayName("staff of another institute are refused")
    void staffOfAnotherInstitute() {
        when(repository.findLiveMemberships("u1", "s")).thenReturn(List.of());
        when(repository.findInstitutesOfSlide("s")).thenReturn(List.of("i2"));
        clientId("i1");
        assertThatThrownBy(() -> service.requireAccess(user(false, "ADMIN"), "s", "i1", null, null))
                .isInstanceOf(ForbiddenException.class);
    }

    @Test
    @DisplayName("a learner who also carries TEACHER is still a learner")
    void learnerWithTeacherAuthority() {
        when(repository.findLiveMemberships("u1", "s")).thenReturn(List.of());
        when(repository.findInstitutesOfSlide("s")).thenReturn(List.of("i1"));
        clientId("i1");
        assertThatThrownBy(() -> service.requireAccess(user(false, "STUDENT", "TEACHER"), "s", "i1", null, null))
                .isInstanceOf(ForbiddenException.class);
    }

    @Test
    void noUserIsRefused() {
        assertThatThrownBy(() -> service.requireAccess(null, "s", "i1", null, null))
                .isInstanceOf(ForbiddenException.class);
    }
}
