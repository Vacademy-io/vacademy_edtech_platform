package vacademy.io.admin_core_service.features.commerce.common;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.commerce.catalogue.repository.CommerceProductRepository;
import vacademy.io.admin_core_service.features.commerce.catalogue.repository.CommerceVariantRepository;
import vacademy.io.common.exceptions.VacademyException;
import vacademy.io.common.institute.entity.PackageEntity;

import java.util.Arrays;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/** A shop product is a package with a commerce_product row; the type PRODUCT alone is not enough. */
class CommerceLegacyGuardTest {

    private CommerceProductRepository products;
    private CommerceVariantRepository variants;
    private CommerceLegacyGuard guard;

    @BeforeEach
    void setUp() {
        products = mock(CommerceProductRepository.class);
        variants = mock(CommerceVariantRepository.class);
        guard = new CommerceLegacyGuard(products, variants);
        when(products.existsByPackageId("pkg-shop")).thenReturn(true);
        when(variants.existsByPackageSessionId("ps-variant")).thenReturn(true);
    }

    private static PackageEntity pkg(String id, String type) {
        PackageEntity entity = new PackageEntity();
        entity.setId(id);
        entity.setPackageType(type);
        return entity;
    }

    @Test
    void aProductIsRefusedWith400() {
        assertTrue(guard.isProduct(pkg("pkg-shop", "PRODUCT")));
        VacademyException refused = assertThrows(VacademyException.class,
                () -> guard.refuseProduct(pkg("pkg-shop", "PRODUCT"), "add a level"));
        assertEquals(400, refused.getStatus().value());
    }

    @Test
    void aBulkCreatedCourseTypedProductStaysACourse() {
        // BulkCourseService can write package_type PRODUCT; such a course has no commerce rows.
        assertFalse(guard.isProduct(pkg("pkg-bulk-course", "PRODUCT")));
        assertDoesNotThrow(() -> guard.refuseProduct(pkg("pkg-bulk-course", "PRODUCT"), "add a level"));
        assertFalse(guard.isVariantSession("ps-bulk-batch", "PRODUCT"));
        assertDoesNotThrow(() -> guard.refuseVariantSession("ps-bulk-batch", "PRODUCT", "release a slot"));
    }

    @Test
    void otherTypesAreNeverLookedUp() {
        assertFalse(guard.isProduct(pkg("pkg-shop", "COURSE")));
        assertFalse(guard.isProduct(pkg("pkg-shop", null)));
        assertFalse(guard.isProduct(null));
        assertFalse(guard.isVariantSession("ps-variant", "COURSE"));
        assertFalse(guard.isVariantSession("ps-variant", null));
        verify(products, never()).existsByPackageId(anyString());
    }

    @Test
    void variantSessionsInvitesAndLinksAreRefused() {
        assertTrue(guard.isVariantSession("ps-variant", "PRODUCT"));
        assertThrows(VacademyException.class, () -> guard.refuseVariantSession("ps-variant", "delete it"));

        when(variants.findVariantSessionIdsIn(List.of("ps-1", "ps-variant"))).thenReturn(List.of("ps-variant"));
        assertThrows(VacademyException.class,
                () -> guard.refuseVariantSessions(Arrays.asList("ps-1", null, " ps-variant ", "ps-1"), "delete it"));
        assertDoesNotThrow(() -> guard.refuseVariantSessions(List.of("ps-1"), "delete it"));

        when(variants.findCommerceInviteIdsIn(List.of("inv-shop"))).thenReturn(List.of("inv-shop"));
        assertThrows(VacademyException.class, () -> guard.refuseCommerceInvites(List.of("inv-shop"), "delete it"));
        assertDoesNotThrow(() -> guard.refuseCommerceInvites(List.of("inv-course"), "delete it"));

        when(variants.findVariantLinkIdsIn(List.of("link-shop"))).thenReturn(List.of("link-shop"));
        assertThrows(VacademyException.class, () -> guard.refuseVariantLinks(List.of("link-shop"), "change it"));
    }

    @Test
    void emptyListsReadNothing() {
        guard.refuseVariantSessions(null, "x");
        guard.refuseVariantSessions(Arrays.asList(null, " "), "x");
        guard.refuseCommerceInvites(List.of(), "x");
        guard.refuseVariantLinks(null, "x");
        verifyNoInteractions(variants);
    }
}
