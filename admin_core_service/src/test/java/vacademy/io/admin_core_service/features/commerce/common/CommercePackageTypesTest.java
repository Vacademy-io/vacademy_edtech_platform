package vacademy.io.admin_core_service.features.commerce.common;

import org.junit.jupiter.api.Test;
import vacademy.io.common.exceptions.VacademyException;

import java.util.Arrays;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class CommercePackageTypesTest {

    @Test
    void onlyProductIsCommerce() {
        assertTrue(CommercePackageTypes.isCommerce("PRODUCT"));
        assertTrue(CommercePackageTypes.isCommerce(" product "));
        assertFalse(CommercePackageTypes.isCommerce(null), "an untyped package is a course");
        assertFalse(CommercePackageTypes.isCommerce(""));
        assertFalse(CommercePackageTypes.isCommerce("COURSE"));
        assertFalse(CommercePackageTypes.isCommerce("MEMBERSHIP"));
        assertFalse(CommercePackageTypes.isCommerce("DELIVERY_CHARGE"));
    }

    @Test
    void sharedLevelAndSessionIdsAreRefusedInAnyCase() {
        for (String id : List.of("DEFAULT", "INVITED", "default", " Invited ")) {
            VacademyException refused = assertThrows(VacademyException.class,
                    () -> CommerceLegacyGuard.refuseSharedLevelOrSessionIds(List.of("level-1", id), "level"));
            assertEquals(400, refused.getStatus().value());
        }
        assertDoesNotThrow(() -> CommerceLegacyGuard.refuseSharedLevelOrSessionIds(
                Arrays.asList("level-1", null, "DEFAULT-2"), "level"));
        assertDoesNotThrow(() -> CommerceLegacyGuard.refuseSharedLevelOrSessionIds(null, "level"));
    }
}
