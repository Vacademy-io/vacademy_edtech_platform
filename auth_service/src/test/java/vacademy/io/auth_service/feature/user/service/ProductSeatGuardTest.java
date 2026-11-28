package vacademy.io.auth_service.feature.user.service;

import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

class ProductSeatGuardTest {

    @Test
    void onlyStaffTakeASeat() {
        assertFalse(ProductSeatGuard.needsSeat(List.of("STUDENT")));
        assertTrue(ProductSeatGuard.needsSeat(List.of("ADMIN")));
        assertTrue(ProductSeatGuard.needsSeat(List.of("STUDENT", "TEACHER")));
        assertTrue(ProductSeatGuard.needsSeat(null));
    }

    @Test
    void theMessageNamesThePlan() {
        assertEquals("The free trial is for one teacher. Buy a team plan to add teachers.",
                ProductSeatGuard.message(new ProductSeatGuard.Limit(1, null)));
        assertEquals("The Starter plan is for one teacher. Buy a team plan to add teachers.",
                ProductSeatGuard.message(new ProductSeatGuard.Limit(1, "Starter")));
        assertEquals("The Team plan allows 15 users. Remove a user to add another.",
                ProductSeatGuard.message(new ProductSeatGuard.Limit(15, "Team")));
    }
}
