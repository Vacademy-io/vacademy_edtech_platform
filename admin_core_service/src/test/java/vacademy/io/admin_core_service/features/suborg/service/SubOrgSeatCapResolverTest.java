package vacademy.io.admin_core_service.features.suborg.service;

import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.enroll_invite.entity.EnrollInvite;
import vacademy.io.admin_core_service.features.enroll_invite.repository.EnrollInviteRepository;
import vacademy.io.admin_core_service.features.user_subscription.entity.PaymentPlan;

import java.sql.Timestamp;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class SubOrgSeatCapResolverTest {

    private final EnrollInviteRepository repository = mock(EnrollInviteRepository.class);
    private final SubOrgSeatCapResolver resolver = new SubOrgSeatCapResolver(repository);

    private static PaymentPlan plan(Integer memberCount) {
        PaymentPlan plan = new PaymentPlan();
        plan.setMemberCount(memberCount);
        return plan;
    }

    private static EnrollInvite invite(String status, long createdAt, String settingJson) {
        EnrollInvite invite = new EnrollInvite();
        invite.setStatus(status);
        invite.setCreatedAt(new Timestamp(createdAt));
        invite.setSettingJson(settingJson);
        return invite;
    }

    private static String setting(int memberCount) {
        return "{\"setting\":{\"SUB_ORG_SETTING\":{\"MEMBER_COUNT\":" + memberCount + "}}}";
    }

    @Test
    void settingBeatsSharedPlanValue() {
        assertEquals(500, resolver.resolve(List.of(invite("ACTIVE", 1, setting(500))), plan(1)));
    }

    @Test
    void fallsBackToPlanWhenNoSetting() {
        assertEquals(20, resolver.resolve(List.of(invite("ACTIVE", 1, null)), plan(20)));
    }

    @Test
    void nullWhenNothingConfigured() {
        assertNull(resolver.resolve(List.of(invite("ACTIVE", 1, null)), plan(null)));
        assertNull(resolver.resolve(List.of(), null));
    }

    @Test
    void prefersActiveInviteThenOldest() {
        assertEquals(30, resolver.resolve(List.of(
                invite("DELETED", 1, setting(10)),
                invite("ACTIVE", 3, setting(40)),
                invite("ACTIVE", 2, setting(30))), null));
    }

    @Test
    void malformedSettingFallsThrough() {
        assertEquals(7, resolver.resolve(List.of(
                invite("ACTIVE", 1, "not json"),
                invite("ACTIVE", 2, setting(7))), plan(1)));
    }

    @Test
    void loadsInvitesForTheSubOrg() {
        when(repository.findBySubOrgIdAndInstituteId(eq("sub"), eq("parent"), any()))
                .thenReturn(List.of(invite("ACTIVE", 1, setting(500))));
        assertEquals(500, resolver.resolve("sub", "parent", plan(1)));
    }

    @Test
    void blankIdsUsePlanWithoutQuerying() {
        assertEquals(5, resolver.resolve("sub", null, plan(5)));
    }
}
