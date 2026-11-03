package vacademy.io.admin_core_service.features.user_subscription.service;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.enroll_invite.entity.EnrollInvite;
import vacademy.io.admin_core_service.features.enroll_invite.repository.EnrollInviteRepository;
import vacademy.io.admin_core_service.features.institute.service.InstituteTimezoneService;
import vacademy.io.admin_core_service.features.user_subscription.entity.UserPlan;

import java.time.LocalDate;
import java.time.ZoneId;
import java.util.Date;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class PaymentDateDefaultsTest {

    private static final ZoneId TOKYO = ZoneId.of("Asia/Tokyo");

    private final InstituteTimezoneService tz = mock(InstituteTimezoneService.class);
    private final EnrollInviteRepository invites = mock(EnrollInviteRepository.class);
    private final PaymentDateDefaults defaults = new PaymentDateDefaults(tz, invites);

    private static LocalDate day(Date d) {
        return d.toInstant().atZone(ZoneId.systemDefault()).toLocalDate();
    }

    @Test
    @DisplayName("today() is the institute's own calendar day, as midnight in the JVM zone")
    void todayUsesInstituteZone() {
        when(tz.getZone("inst-1")).thenReturn(TOKYO);

        Date d = defaults.today("inst-1");

        assertEquals(LocalDate.now(TOKYO), day(d));
        assertEquals(d, Date.from(day(d).atStartOfDay(ZoneId.systemDefault()).toInstant()));
    }

    @Test
    @DisplayName("no institute falls back to Asia/Kolkata")
    void todayWithoutInstitute() {
        assertEquals(LocalDate.now(InstituteTimezoneService.DEFAULT_ZONE), day(defaults.today(null)));
        verifyNoInteractions(tz);
    }

    @Test
    @DisplayName("a hand-recorded payment defaults to the plan's institute day")
    void manualUsesPlanInstitute() {
        EnrollInvite invite = new EnrollInvite();
        invite.setInstituteId("inst-1");
        when(invites.findById("inv-1")).thenReturn(Optional.of(invite));
        when(tz.getZone("inst-1")).thenReturn(TOKYO);
        UserPlan plan = new UserPlan();
        plan.setEnrollInviteId("inv-1");

        assertEquals(LocalDate.now(TOKYO), day(defaults.defaultFor("MANUAL", plan)));
        assertEquals(LocalDate.now(TOKYO), day(defaults.defaultFor("offline", plan)));
    }

    @Test
    @DisplayName("a gateway payment keeps the current instant, as before")
    void gatewayKeepsNow() {
        long before = System.currentTimeMillis();
        Date d = defaults.defaultFor("RAZORPAY", new UserPlan());
        assertTrue(d.getTime() >= before && d.getTime() <= System.currentTimeMillis());
        verifyNoInteractions(invites, tz);
    }

    @Test
    @DisplayName("isHandRecorded covers MANUAL and OFFLINE only")
    void handRecordedVendors() {
        assertTrue(PaymentDateDefaults.isHandRecorded("MANUAL"));
        assertTrue(PaymentDateDefaults.isHandRecorded("OFFLINE"));
        assertFalse(PaymentDateDefaults.isHandRecorded("RAZORPAY"));
        assertFalse(PaymentDateDefaults.isHandRecorded(null));
    }
}
