package vacademy.io.admin_core_service.features.learner.controller;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InOrder;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;
import vacademy.io.admin_core_service.features.learner.service.AdditionalChargeValidator;
import vacademy.io.admin_core_service.features.learner.service.LearnerEnrollRequestService;
import vacademy.io.admin_core_service.features.learner.service.OpenLearnerEnrollService;
import vacademy.io.common.auth.dto.learner.LearnerEnrollRequestDTO;
import vacademy.io.common.auth.dto.learner.LearnerEnrollResponseDTO;
import vacademy.io.common.exceptions.InvalidRequestException;

import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyMap;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * The public v1 enroll endpoint checks a request (deposit due on a membership, rent picks) before
 * it enrolls anyone; a gateway's confirmation of a payment already taken is never re-checked.
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class LearnerEnrollRequestControllerTest {

    @Mock private LearnerEnrollRequestService learnerEnrollRequestService;
    @Mock private OpenLearnerEnrollService openLearnerEnrollService;
    @Mock private AdditionalChargeValidator additionalChargeValidator;
    @Mock private vacademy.io.admin_core_service.features.learner.service.PublicEnrollRoleGuard publicEnrollRoleGuard;
    @InjectMocks private LearnerEnrollRequestController controller;

    private final LearnerEnrollRequestDTO request = new LearnerEnrollRequestDTO();

    @Test
    void theRequestIsCheckedBeforeItEnrolls() {
        when(learnerEnrollRequestService.recordLearnerRequest(eq(request), anyMap()))
                .thenReturn(new LearnerEnrollResponseDTO());

        controller.enrollLearner(request);

        InOrder order = inOrder(additionalChargeValidator, learnerEnrollRequestService);
        order.verify(additionalChargeValidator).validateLegacyRentRequest(request);
        order.verify(learnerEnrollRequestService).recordLearnerRequest(eq(request), anyMap());
    }

    @Test
    void aRefusedRequestEnrollsNobody() {
        doThrow(new InvalidRequestException("SECURITY_DEPOSIT_MISSING: test"))
                .when(additionalChargeValidator).validateLegacyRentRequest(request);

        assertThrows(InvalidRequestException.class, () -> controller.enrollLearner(request));

        verify(learnerEnrollRequestService, never()).recordLearnerRequest(any(), anyMap());
    }

    @Test
    void aGatewayPaymentConfirmationIsNotRechecked() {
        when(learnerEnrollRequestService.isClientPaymentConfirmation(request)).thenReturn(true);
        when(learnerEnrollRequestService.recordLearnerRequest(eq(request), anyMap()))
                .thenReturn(new LearnerEnrollResponseDTO());

        controller.enrollLearner(request);

        verify(additionalChargeValidator, never()).validateLegacyRentRequest(any());
        verify(learnerEnrollRequestService).recordLearnerRequest(eq(request), anyMap());
    }
}
