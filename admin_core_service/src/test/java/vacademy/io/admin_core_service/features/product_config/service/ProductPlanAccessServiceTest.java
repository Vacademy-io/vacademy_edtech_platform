package vacademy.io.admin_core_service.features.product_config.service;

import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.product_config.dto.ProductPlanAccessDTO;
import vacademy.io.admin_core_service.features.product_config.dto.ProductPlanDTO;

import java.sql.Timestamp;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

class ProductPlanAccessServiceTest {

    private static final Instant NOW = Instant.parse("2026-11-14T10:00:00Z");
    private static final List<ProductPlanDTO> PLANS = List.of(
            ProductPlanDTO.builder().key("starter").name("Starter").priceInr(5000).credits(100).users(1).build(),
            ProductPlanDTO.builder().key("team").name("Team").priceInr(20000).credits(2000).users(15).build());

    private static ProductPlanAccessService.InstituteRow trial(Instant ends) {
        return new ProductPlanAccessService.InstituteRow("evalezy", "FREE_TRIAL", Timestamp.from(ends));
    }

    @Test
    void aTrialIsForOneTeacher() {
        ProductPlanAccessDTO a = ProductPlanAccessService.decide("evalezy", trial(NOW.plus(2, ChronoUnit.DAYS)),
                null, PLANS, 12, null, NOW);
        assertEquals(ProductPlanAccessDTO.STATUS_TRIAL, a.getStatus());
        assertEquals(1, a.getSeatLimit());
        assertFalse(a.isTrialExpired());
        assertEquals(2, a.getPlans().size());
    }

    @Test
    void aLapsedTrialSaysSo() {
        ProductPlanAccessDTO a = ProductPlanAccessService.decide("evalezy", trial(NOW.minus(1, ChronoUnit.HOURS)),
                null, PLANS, 12, null, NOW);
        assertTrue(a.isTrialExpired());
    }

    @Test
    void theTeamPlanGivesItsUsers() {
        ProductPlanAccessDTO a = ProductPlanAccessService.decide("evalezy", trial(NOW.minus(5, ChronoUnit.DAYS)),
                new ProductPlanAccessService.LivePlan("evalezy_team", Timestamp.from(NOW.plus(365, ChronoUnit.DAYS))),
                PLANS, 12, null, NOW);
        assertEquals(ProductPlanAccessDTO.STATUS_PLAN, a.getStatus());
        assertEquals("team", a.getPlanKey());
        assertEquals(15, a.getSeatLimit());
        assertEquals(2000, a.getPlanCredits());
        assertNotNull(a.getPlanEndsAt());
    }

    @Test
    void theStarterPlanIsOneUser() {
        ProductPlanAccessDTO a = ProductPlanAccessService.decide("evalezy", trial(NOW),
                new ProductPlanAccessService.LivePlan("evalezy_starter", null), PLANS, 12, null, NOW);
        assertEquals("starter", a.getPlanKey());
        assertEquals(1, a.getSeatLimit());
    }

    @Test
    void aWorkspaceWeSetUpByHandIsNotLimited() {
        ProductPlanAccessDTO a = ProductPlanAccessService.decide("evalezy",
                new ProductPlanAccessService.InstituteRow("evalezy", "PROD", null),
                new ProductPlanAccessService.LivePlan("ai_pro", null), PLANS, 12, null, NOW);
        assertEquals(ProductPlanAccessDTO.STATUS_MANAGED, a.getStatus());
        assertNull(a.getSeatLimit());
    }
}
