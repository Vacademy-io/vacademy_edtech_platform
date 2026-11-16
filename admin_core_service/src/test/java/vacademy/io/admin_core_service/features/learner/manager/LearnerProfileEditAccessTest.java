package vacademy.io.admin_core_service.features.learner.manager;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;
import vacademy.io.admin_core_service.features.auth_service.service.AuthService;
import vacademy.io.admin_core_service.features.common.dto.request.CustomFieldValueDto;
import vacademy.io.admin_core_service.features.common.service.CustomFieldValueService;
import vacademy.io.admin_core_service.features.institute_learner.repository.InstituteStudentRepository;
import vacademy.io.admin_core_service.features.learner.dto.LearnerDetailsEditDTO;
import vacademy.io.admin_core_service.features.learner.dto.LearnerProfileUpdateRequestDTO;
import vacademy.io.admin_core_service.features.learner.service.LearnerProfileEditGuard;
import vacademy.io.admin_core_service.features.learner.service.LearnerService;
import vacademy.io.common.auth.dto.UserDTO;
import vacademy.io.common.auth.dto.UserServiceDTO;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.VacademyException;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;

/**
 * The learner profile routes check who is editing before anything is written: the target is the
 * one the request names, the check runs against it, and a refused edit changes nothing.
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class LearnerProfileEditAccessTest {

    @Mock
    private LearnerService learnerService;
    @Mock
    private AuthService authService;
    @Mock
    private CustomFieldValueService customFieldValueService;
    @Mock
    private LearnerProfileEditGuard learnerProfileEditGuard;

    @InjectMocks
    private LearnerProfileUpdateManager manager;

    private static CustomUserDetails caller(String userId) {
        UserServiceDTO dto = new UserServiceDTO();
        dto.setUserId(userId);
        dto.setUsername(userId);
        dto.setFullName("Caller");
        dto.setAuthorities(List.of("STUDENT"));
        return new CustomUserDetails(dto);
    }

    private static LearnerProfileUpdateRequestDTO profileOf(String targetUserId) {
        LearnerProfileUpdateRequestDTO request = new LearnerProfileUpdateRequestDTO();
        request.setUserDetails(UserDTO.builder().id(targetUserId).email("x@example.com").mobileNumber("9000000001").build());
        return request;
    }

    private static CustomFieldValueDto field(String sourceId) {
        CustomFieldValueDto value = new CustomFieldValueDto();
        value.setCustomFieldId("cf-1");
        value.setSourceType("USER");
        value.setSourceId(sourceId);
        value.setValue("v");
        return value;
    }

    @Test
    void refusedProfileEditWritesNothing() {
        CustomUserDetails caller = caller("learner-2");
        doThrow(new VacademyException("refused")).when(learnerProfileEditGuard)
                .requireCanEdit(eq(caller), eq("learner-1"), any());

        assertThrows(VacademyException.class, () -> manager.updateLearnerProfile(profileOf("learner-1"), caller));

        verifyNoInteractions(authService, learnerService, customFieldValueService);
    }

    @Test
    void allowedProfileEditIsCheckedAgainstTheNamedLearner() {
        CustomUserDetails caller = caller("admin-1");
        LearnerProfileUpdateRequestDTO request = profileOf("learner-1");

        manager.updateLearnerProfile(request, caller);

        verify(learnerProfileEditGuard).requireCanEdit(caller, "learner-1", request.getUserDetails());
        verify(authService).updateUser(request.getUserDetails(), "learner-1");
    }

    @Test
    void ownProfileWithoutAnIdIsCheckedAgainstTheCaller() {
        CustomUserDetails caller = caller("learner-1");
        LearnerProfileUpdateRequestDTO request = new LearnerProfileUpdateRequestDTO();
        request.setUserDetails(UserDTO.builder().fullName("Asha").build());

        manager.updateLearnerProfile(request, caller);

        verify(learnerProfileEditGuard).requireCanEdit(caller, "learner-1", request.getUserDetails());
    }

    @Test
    void customFieldValuesOfAnotherUserAreRefused() {
        LearnerProfileUpdateRequestDTO request = profileOf("learner-1");
        request.setCustomFieldValues(List.of(field("learner-1"), field("learner-9")));

        VacademyException e = assertThrows(VacademyException.class,
                () -> manager.updateLearnerProfile(request, caller("admin-1")));

        assertEquals(403, e.getStatus().value());
        verify(authService, never()).updateUser(any(), anyString());
        verify(customFieldValueService, never()).upsertCustomFieldValues(any());
    }

    @Test
    void refusedLearnerDetailsEditWritesNothing() {
        LearnerService service = new LearnerService();
        LearnerProfileEditGuard guard = mock(LearnerProfileEditGuard.class);
        InstituteStudentRepository repository = mock(InstituteStudentRepository.class);
        AuthService auth = mock(AuthService.class);
        org.springframework.test.util.ReflectionTestUtils.setField(service, "learnerProfileEditGuard", guard);
        org.springframework.test.util.ReflectionTestUtils.setField(service, "instituteStudentRepository", repository);
        org.springframework.test.util.ReflectionTestUtils.setField(service, "authService", auth);
        CustomUserDetails caller = caller("learner-2");
        doThrow(new VacademyException("refused")).when(guard).requireCanEdit(eq(caller), eq("learner-1"), any());

        LearnerDetailsEditDTO edit = new LearnerDetailsEditDTO();
        edit.setUserId("learner-1");
        edit.setEmail("other@example.com");
        edit.setContactNumber("9000000001");

        assertThrows(VacademyException.class, () -> service.editLearnerDetails(edit, caller));

        verifyNoInteractions(repository, auth);
    }
}
