package vacademy.io.admin_core_service.features.commerce.pos.service;

import org.junit.jupiter.api.Test;
import org.springframework.transaction.PlatformTransactionManager;
import vacademy.io.admin_core_service.features.commerce.order.entity.CommerceOrder;
import vacademy.io.admin_core_service.features.commerce.order.repository.CommerceOrderRepository;
import vacademy.io.admin_core_service.features.commerce.pos.dto.PosDtos;
import vacademy.io.admin_core_service.features.commerce.pos.repository.PosReadRepository;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.InvalidRequestException;
import vacademy.io.common.exceptions.VacademyException;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * The till's bill lookup: one search text read as an order or document number, a phone (stored
 * spelling) or a piece code; the session guard first; the sale detail of an order of the
 * institute only. Also the top-level {@code discount_reason} of a sale body.
 */
class PosSaleLookupServiceTest {

    private static final String INST = "inst-1";

    private final PosAccess access = mock(PosAccess.class);
    private final PosReadRepository reads = mock(PosReadRepository.class);
    private final PosReceiptService receipts = mock(PosReceiptService.class);
    private final CommerceOrderRepository orders = mock(CommerceOrderRepository.class);
    private final PosSaleLookupService service = new PosSaleLookupService(access, reads, receipts, orders,
            mock(PlatformTransactionManager.class));
    private final CustomUserDetails cashier = mock(CustomUserDetails.class);

    @Test
    void theQueryIsReadAsANumberAPhoneAndAPieceCode() {
        PosDtos.SaleRow row = new PosDtos.SaleRow("o-1", "ORD-000101", "POS", "DELIVERED", "R1/0007",
                LocalDate.of(2026, 11, 18), "Store", new BigDecimal("1350.00"), "Walk-in", "3210", null, List.of("CASH"));
        when(reads.lookupSales(eq(INST), anyString(), any(), anyString(), anyInt())).thenReturn(List.of(row));

        assertEquals(List.of(row), service.lookup(cashier, INST, "s-1", " 98765 43210 ").sales());
        verify(access).session(cashier, INST, "s-1");
        verify(reads).lookupSales(INST, "98765 43210", "919876543210", "98765 43210", 10);

        service.lookup(cashier, INST, "s-1", "pab12cd34e");
        verify(reads).lookupSales(INST, "pab12cd34e", null, "PAB12CD34E", 10);

        service.lookup(cashier, INST, "s-1", "ORD-000101");
        verify(reads).lookupSales(INST, "ORD-000101", null, "ORD-000101", 10);
    }

    @Test
    void anEmptyOrLongQueryIsRefusedAfterTheGuard() {
        assertThrows(InvalidRequestException.class, () -> service.lookup(cashier, INST, "s-1", "  "));
        assertThrows(InvalidRequestException.class, () -> service.lookup(cashier, INST, "s-1", "x".repeat(65)));
        verify(reads, never()).lookupSales(any(), any(), any(), any(), anyInt());
        assertNull(PosSaleLookupService.phoneOf("R1/0007"));
        assertEquals("919876543210", PosSaleLookupService.phoneOf("+91 98765-43210"));
    }

    @Test
    void theDetailIsOfAnOrderOfTheInstituteOnly() {
        when(orders.findByIdAndInstituteId("o-1", INST)).thenReturn(Optional.of(new CommerceOrder()));
        when(orders.findByIdAndInstituteId("o-other", INST)).thenReturn(Optional.empty());
        PosDtos.SaleDetail detail = new PosDtos.SaleDetail("o-1", "ORD-000101", "POS", "DELIVERED", "s-1", "r-1",
                "loc-1", null, null, List.of(), null, List.of(), null, List.of(), List.of());
        when(receipts.saleDetail(cashier, INST, "o-1")).thenReturn(detail);
        assertEquals(detail, service.detail(cashier, INST, "o-1", "s-1"));
        VacademyException e = assertThrows(VacademyException.class, () -> service.detail(cashier, INST, "o-other",
                "s-1"));
        assertTrue(e.getMessage().startsWith("ORDER_NOT_FOUND"), e.getMessage());
        verify(receipts, never()).saleDetail(cashier, INST, "o-other");
    }

    @Test
    void aBillWithLineDiscountsOnlyCarriesItsReasonAtTheTopLevel() {
        PosDtos.SaleLine discounted = new PosDtos.SaleLine("l1", "ps-1", 1, null, new BigDecimal("20.00"),
                new BigDecimal("450.00"));
        List<PosDtos.Tender> cash = List.of(new PosDtos.Tender("CASH", new BigDecimal("430.00"), null, null));
        PosDtos.SaleRequest without = new PosDtos.SaleRequest("pos-key-00001", "s-1", List.of(discounted), null, null,
                cash, null, null, null, null, null);
        InvalidRequestException e = assertThrows(InvalidRequestException.class, () -> PosSaleService.validate(
                without, PosSaleService.Kind.SALE, LocalDate.of(2026, 11, 18)));
        assertTrue(e.getMessage().contains("discount_reason"), e.getMessage());

        PosDtos.SaleRequest with = new PosDtos.SaleRequest("pos-key-00001", "s-1", List.of(discounted), null, null,
                cash, null, null, null, null, null, "Shop-soiled");
        assertEquals("Shop-soiled", PosSaleService.validate(with, PosSaleService.Kind.SALE,
                LocalDate.of(2026, 11, 18)).discountReason());
        // The bill discount's own reason wins when both are sent.
        PosDtos.SaleRequest both = new PosDtos.SaleRequest("pos-key-00001", "s-1", List.of(discounted),
                new PosDtos.BillDiscount("AMOUNT", new BigDecimal("10.00"), "Regular customer"), null, cash, null,
                null, null, null, null, "Shop-soiled");
        assertEquals("Regular customer", PosSaleService.validate(both, PosSaleService.Kind.QUOTE,
                LocalDate.of(2026, 11, 18)).discountReason());
        // The reason is part of the request hash (the PIN is not).
        assertTrue(!vacademy.io.admin_core_service.features.commerce.common.request.CommerceRequestGuard.hash(
                "POS_SALE", with.withoutApproval()).equals(vacademy.io.admin_core_service.features.commerce.common
                .request.CommerceRequestGuard.hash("POS_SALE", without.withoutApproval())));
    }
}
