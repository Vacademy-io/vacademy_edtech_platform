package vacademy.io.admin_core_service.features.packages.service;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.commerce.catalogue.repository.CommerceProductRepository;
import vacademy.io.admin_core_service.features.commerce.catalogue.repository.CommerceVariantRepository;
import vacademy.io.admin_core_service.features.commerce.common.CommerceLegacyGuard;
import vacademy.io.admin_core_service.features.enroll_invite.service.DefaultEnrollInviteService;
import vacademy.io.admin_core_service.features.faculty.service.FacultyService;
import vacademy.io.admin_core_service.features.institute_learner.repository.StudentSessionInstituteGroupMappingRepository;
import vacademy.io.admin_core_service.features.learner_invitation.services.LearnerInvitationService;
import vacademy.io.admin_core_service.features.packages.repository.PackageSessionRepository;
import vacademy.io.admin_core_service.features.packages.repository.PackageSessionRepository.StockInfoProjection;
import vacademy.io.admin_core_service.features.stock_hold.service.StockHoldService;
import vacademy.io.common.exceptions.VacademyException;
import vacademy.io.common.institute.entity.PackageEntity;
import vacademy.io.common.institute.entity.session.PackageSession;

import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** The legacy seat writers leave a shop product's sellable quantity alone. */
class PackageSessionServiceProductStockTest {

    private PackageSessionRepository repository;
    private PackageSessionService service;
    private final CommerceProductRepository products = mock(CommerceProductRepository.class);
    private final CommerceVariantRepository variants = mock(CommerceVariantRepository.class);

    @BeforeEach
    void setUp() {
        repository = mock(PackageSessionRepository.class);
        service = new PackageSessionService(repository, mock(FacultyService.class),
                mock(LearnerInvitationService.class), mock(DefaultEnrollInviteService.class),
                mock(StudentSessionInstituteGroupMappingRepository.class), mock(StockHoldService.class),
                new CommerceLegacyGuard(products, variants));
        when(products.existsByPackageId("pkg-product")).thenReturn(true);
        when(variants.existsByPackageSessionId("ps-product")).thenReturn(true);
        stock("ps-product", "PRODUCT");
        // A bulk-created course typed PRODUCT: no commerce rows, so it stays a course.
        stock("ps-product-course", "PRODUCT");
        stock("ps-course", "COURSE");
        stock("ps-untyped", null);
    }

    private void stock(String id, String packageType) {
        StockInfoProjection info = mock(StockInfoProjection.class);
        when(info.getPackageSessionId()).thenReturn(id);
        when(info.getPackageType()).thenReturn(packageType);
        when(info.getMaxSeats()).thenReturn(10);
        when(info.getAvailableSlots()).thenReturn(4);
        when(repository.findStockInfoByIds(List.of(id))).thenReturn(List.of(info));
    }

    @Test
    void capacityUpdateRefusesAProduct() {
        PackageEntity product = new PackageEntity();
        product.setId("pkg-product");
        product.setPackageType("PRODUCT");
        PackageSession variant = new PackageSession();
        variant.setId("ps-product");
        variant.setPackageEntity(product);
        variant.setMaxSeats(10);
        variant.setAvailableSlots(4);
        when(repository.findById("ps-product")).thenReturn(Optional.of(variant));

        VacademyException refused = assertThrows(VacademyException.class,
                () -> service.updateInventory("ps-product", 50, 50));

        assertEquals(400, refused.getStatus().value());
        assertEquals(Integer.valueOf(4), variant.getAvailableSlots());
        verify(repository, never()).save(any());
    }

    @Test
    void reserveAndReleaseRefuseAProduct() {
        assertThrows(VacademyException.class, () -> service.reserveSlot("ps-product"));
        assertThrows(VacademyException.class, () -> service.releaseSlot("ps-product"));
        verify(repository, never()).takeAvailableSlots(anyString(), anyInt());
        verify(repository, never()).giveBackAvailableSlots(anyString(), anyInt());
    }

    @Test
    void reserveAndReleaseStillWorkForACourse() {
        when(repository.takeAvailableSlots("ps-course", 1)).thenReturn(1);
        for (String id : List.of("ps-course", "ps-untyped")) {
            assertDoesNotThrow(() -> service.releaseSlot(id));
            verify(repository).giveBackAvailableSlots(id, 1);
        }
        assertDoesNotThrow(() -> service.reserveSlot("ps-course"));
        verify(repository).takeAvailableSlots("ps-course", 1);
    }

    @Test
    void theGiveBackOnDeassignSkipsAProductWithoutThrowing() {
        assertDoesNotThrow(() -> service.incrementAvailability("ps-product", 1));
        verify(repository, never()).giveBackAvailableSlots(anyString(), anyInt());

        when(repository.giveBackAvailableSlots("ps-course", 1)).thenReturn(1);
        service.incrementAvailability("ps-course", 1);
        verify(repository).giveBackAvailableSlots("ps-course", 1);
    }

    @Test
    void theDecrementOnAssignSkipsAProductWithoutThrowing() {
        // The statement itself leaves a product row alone, so it reports nothing taken.
        when(repository.decrementAvailableSlotsClamped("ps-product", 1)).thenReturn(0);
        assertDoesNotThrow(() -> service.decrementAvailability("ps-product", 1));
    }

    @Test
    void aCourseTypedProductWithNoCommerceRowsKeepsItsSeatCounting() {
        when(repository.decrementAvailableSlotsClamped("ps-product-course", 1)).thenReturn(1);
        when(repository.takeAvailableSlots("ps-product-course", 1)).thenReturn(1);

        service.decrementAvailability("ps-product-course", 1);
        org.junit.jupiter.api.Assertions.assertDoesNotThrow(() -> service.reserveSlot("ps-product-course"));

        verify(repository).takeAvailableSlots("ps-product-course", 1);
    }
}
