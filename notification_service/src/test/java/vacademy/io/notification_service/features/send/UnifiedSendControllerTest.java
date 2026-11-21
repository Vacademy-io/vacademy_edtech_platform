package vacademy.io.notification_service.features.send;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.notification_service.features.announcements.security.AnnouncementAccessGuard;
import vacademy.io.notification_service.features.send.controller.UnifiedSendController;
import vacademy.io.notification_service.features.send.dto.UnifiedSendRequest;
import vacademy.io.notification_service.features.send.dto.UnifiedSendResponse;
import vacademy.io.notification_service.features.send.service.UnifiedSendService;

import java.util.List;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

/**
 * The unified send endpoint sends email and WhatsApp as the institute, so every route checks that
 * the caller is staff of that institute before anything is sent or read.
 */
class UnifiedSendControllerTest {

    private UnifiedSendService service;
    private AnnouncementAccessGuard guard;
    private UnifiedSendController controller;
    private final CustomUserDetails user = mock(CustomUserDetails.class);

    @BeforeEach
    void setUp() {
        service = mock(UnifiedSendService.class);
        guard = mock(AnnouncementAccessGuard.class);
        controller = new UnifiedSendController(service, guard);
    }

    private static UnifiedSendRequest request(String instituteId) {
        UnifiedSendRequest r = new UnifiedSendRequest();
        r.setInstituteId(instituteId);
        return r;
    }

    @Test
    void sendChecksStaffOfTheRequestInstituteFirst() {
        when(service.send(any())).thenReturn(UnifiedSendResponse.builder().build());

        controller.send(user, "inst-1", request("inst-1"));

        var order = inOrder(guard, service);
        order.verify(guard).requireStaff(user, "inst-1", "inst-1");
        order.verify(service).send(any());
    }

    @Test
    void rejectedCallerNeverSends() {
        doThrow(new ResponseStatusException(HttpStatus.FORBIDDEN, "INSTITUTE_MISMATCH"))
                .when(guard).requireStaff(user, "inst-1", "inst-2");

        assertThrows(ResponseStatusException.class, () -> controller.send(user, "inst-1", request("inst-2")));
        verify(service, never()).send(any());
    }

    @Test
    void batchStatusChecksTheBatchOwner() {
        when(service.getBatchInstituteId("b1")).thenReturn("inst-9");
        doThrow(new ResponseStatusException(HttpStatus.FORBIDDEN, "INSTITUTE_MISMATCH"))
                .when(guard).requireStaff(user, "inst-1", "inst-9");

        assertThrows(ResponseStatusException.class, () -> controller.getBatchStatus(user, "inst-1", "b1"));
        verify(service, never()).getBatchStatus(any());
    }

    @Test
    void deliveryStatusAndBatchListNeedStaff() {
        controller.getDeliveryStatus(user, "inst-1", List.of("m1"));
        controller.listBatches(user, "inst-1", "inst-1", 20);

        verify(guard, times(2)).requireStaff(user, "inst-1", "inst-1");
    }
}
