package vacademy.io.admin_core_service.features.faculty.service;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import vacademy.io.admin_core_service.features.auth_service.service.AuthService;
import vacademy.io.admin_core_service.features.course.dto.AddFacultyToCourseDTO;
import vacademy.io.admin_core_service.features.faculty.repository.FacultySubjectPackageSessionMappingRepository;
import vacademy.io.admin_core_service.features.subject.service.SubjectService;
import vacademy.io.common.auth.dto.UserDTO;
import vacademy.io.common.exceptions.VacademyException;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/**
 * Add Course -> Add Authors pushes the author's subtitle / description / photo onto the
 * user in auth_service. These pin down when that write happens and what it may change.
 */
@ExtendWith(MockitoExtension.class)
class FacultyServiceAuthorSyncTest {

    @Mock
    private FacultySubjectPackageSessionMappingRepository facultyRepository;
    @Mock
    private AuthService authService;
    @Mock
    private SubjectService subjectService;
    @InjectMocks
    private FacultyService facultyService;

    private static UserDTO user(String id, String photo, String subtitle, String description) {
        UserDTO user = new UserDTO();
        user.setId(id);
        user.setFullName("Author " + id);
        user.setProfilePicFileId(photo);
        user.setAuthorSubtitle(subtitle);
        user.setAuthorDescription(description);
        return user;
    }

    private static AddFacultyToCourseDTO author(UserDTO user) {
        AddFacultyToCourseDTO dto = new AddFacultyToCourseDTO();
        dto.setUser(user);
        dto.setNewUser(false);
        return dto;
    }

    private UserDTO capturedUpdate() {
        ArgumentCaptor<UserDTO> captor = ArgumentCaptor.forClass(UserDTO.class);
        verify(authService).updateUser(captor.capture(), eq("u1"));
        return captor.getValue();
    }

    @Test
    @DisplayName("a newly uploaded photo is saved onto the author, subtitle/description untouched")
    void newPhotoIsSaved() {
        when(authService.getUsersFromAuthServiceByUserIds(List.of("u1")))
                .thenReturn(List.of(user("u1", "old-photo", "PhD", "<p>bio</p>")));

        facultyService.addFacultyToBatch(List.of(author(user("u1", "new-photo", null, null))), "ps1", "inst1");

        UserDTO sent = capturedUpdate();
        assertEquals("new-photo", sent.getProfilePicFileId());
        assertEquals("PhD", sent.getAuthorSubtitle());
        assertEquals("<p>bio</p>", sent.getAuthorDescription());
        verify(facultyRepository).saveAll(anyList());
    }

    @Test
    @DisplayName("an unchanged photo alone does not write to auth_service")
    void unchangedPhotoSkipsUpdate() {
        when(authService.getUsersFromAuthServiceByUserIds(List.of("u1")))
                .thenReturn(List.of(user("u1", "same-photo", null, null)));

        facultyService.addFacultyToBatch(List.of(author(user("u1", "same-photo", null, null))), "ps1", "inst1");

        verify(authService, never()).updateUser(any(), any());
        verify(facultyRepository).saveAll(anyList());
    }

    @Test
    @DisplayName("no photo and no metadata makes no auth_service call at all (old behaviour)")
    void nothingToSyncMakesNoCall() {
        facultyService.addFacultyToBatch(List.of(author(user("u1", "", null, null))), "ps1", "inst1");

        verifyNoInteractions(authService);
        verify(facultyRepository).saveAll(anyList());
    }

    @Test
    @DisplayName("subtitle edit with a blank photo keeps the existing photo")
    void subtitleOnlyKeepsExistingPhoto() {
        when(authService.getUsersFromAuthServiceByUserIds(List.of("u1")))
                .thenReturn(List.of(user("u1", "keep-photo", "old", null)));

        facultyService.addFacultyToBatch(List.of(author(user("u1", "", "new subtitle", null))), "ps1", "inst1");

        UserDTO sent = capturedUpdate();
        assertEquals("keep-photo", sent.getProfilePicFileId());
        assertEquals("new subtitle", sent.getAuthorSubtitle());
    }

    @Test
    @DisplayName("an auth_service failure never blocks saving the course authors")
    void authFailureStillSavesMapping() {
        when(authService.getUsersFromAuthServiceByUserIds(List.of("u1")))
                .thenThrow(new VacademyException("auth down"));

        facultyService.addFacultyToBatch(List.of(author(user("u1", "new-photo", null, null))), "ps1", "inst1");

        verify(authService, never()).updateUser(any(), any());
        verify(facultyRepository).saveAll(anyList());
    }
}
