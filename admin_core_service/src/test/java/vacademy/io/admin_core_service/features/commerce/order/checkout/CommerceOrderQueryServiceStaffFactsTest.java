package vacademy.io.admin_core_service.features.commerce.order.checkout;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.data.domain.PageImpl;
import org.springframework.transaction.PlatformTransactionManager;
import vacademy.io.admin_core_service.features.commerce.customer.CommerceShopperSessions;
import vacademy.io.admin_core_service.features.commerce.customer.service.CommerceCustomerService;
import vacademy.io.admin_core_service.features.commerce.order.dto.StaffOrderDtos;
import vacademy.io.admin_core_service.features.commerce.order.entity.CommerceOrder;
import vacademy.io.admin_core_service.features.commerce.order.entity.CommerceOrderLine;
import vacademy.io.admin_core_service.features.commerce.order.payment.CommercePaymentConfirmService;
import vacademy.io.admin_core_service.features.commerce.order.repository.CommerceOrderLineRepository;
import vacademy.io.admin_core_service.features.commerce.order.repository.CommerceOrderRepository;
import vacademy.io.admin_core_service.features.commerce.order.repository.CommerceOrderStatusHistoryRepository;
import vacademy.io.admin_core_service.features.commerce.order.repository.CommerceOrderTenderRepository;
import vacademy.io.admin_core_service.features.commerce.shipment.entity.CommerceShipment;
import vacademy.io.admin_core_service.features.commerce.shipment.entity.CommerceShipmentLine;
import vacademy.io.admin_core_service.features.commerce.shipment.repository.CommerceShipmentLineRepository;
import vacademy.io.admin_core_service.features.commerce.shipment.repository.CommerceShipmentRepository;
import vacademy.io.admin_core_service.features.commerce.stock.repository.CommercePieceRepository;
import vacademy.io.admin_core_service.features.commerce.stock.repository.StockVariantRepository;

import java.math.BigDecimal;
import java.time.Clock;
import java.time.LocalDateTime;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/**
 * The staff order detail tells the pack station each item line's stock mode and policy, names the
 * packed pieces by id beside their codes, and the row carries the COD amount (WP-34, B1). Without
 * the variant repository the detail still answers, with no stock fields.
 */
class CommerceOrderQueryServiceStaffFactsTest {

    private static final String INST = "inst-1";

    private CommerceOrderRepository orders;
    private CommerceOrderLineRepository lines;
    private CommerceShipmentRepository shipments;
    private CommerceShipmentLineRepository shipmentLines;
    private CommercePieceRepository pieces;
    private StockVariantRepository variants;
    private CommerceOrderQueryService service;
    private CommerceOrder order;

    @BeforeEach
    void setUp() {
        orders = mock(CommerceOrderRepository.class);
        lines = mock(CommerceOrderLineRepository.class);
        shipments = mock(CommerceShipmentRepository.class);
        shipmentLines = mock(CommerceShipmentLineRepository.class);
        pieces = mock(CommercePieceRepository.class);
        variants = mock(StockVariantRepository.class);
        order = new CommerceOrder();
        order.setId("o1");
        order.setInstituteId(INST);
        order.setOrderNumber("SH-000200");
        order.setStatus("PACKED");
        order.setPaymentStatus("UNPAID");
        order.setPaymentMethod("COD");
        order.setChannel("ONLINE");
        order.setCurrency("INR");
        order.setTotal(new BigDecimal("2140.00"));
        order.setCodAmount(new BigDecimal("2140.00"));
        order.setCreatedAt(LocalDateTime.of(2026, 11, 16, 9, 0));
        when(orders.findByIdAndInstituteId("o1", INST)).thenReturn(Optional.of(order));
        when(lines.findByOrderIdOrderByLineNoAsc("o1")).thenReturn(List.of(
                line("l1", 1, CommerceOrderLine.TYPE_ITEM, "ps-scarf", 2),
                line("l2", 2, CommerceOrderLine.TYPE_ITEM, "ps-bottle", 3),
                line("l3", 3, CommerceOrderLine.TYPE_SHIPPING, null, 1),
                line("l4", 4, CommerceOrderLine.TYPE_ITEM, "ps-gone", 1)));
        service = new CommerceOrderQueryService(orders, lines, mock(CommerceOrderTenderRepository.class),
                mock(CommerceOrderStatusHistoryRepository.class), mock(CommerceCustomerService.class),
                new CommerceOrderAccessTokens("unit-test-signing-key", Clock.systemUTC()), mock(VerifiedPhones.class),
                mock(CommerceShopperSessions.class), mock(CommercePaymentConfirmService.class), new ObjectMapper(),
                mock(PlatformTransactionManager.class), shipments, shipmentLines, pieces);
    }

    private static CommerceOrderLine line(String id, int no, String type, String packageSessionId, int quantity) {
        CommerceOrderLine line = new CommerceOrderLine();
        line.setId(id);
        line.setOrderId("o1");
        line.setLineNo(no);
        line.setLineType(type);
        line.setPackageSessionId(packageSessionId);
        line.setQuantity(quantity);
        line.setQtyScale(1);
        line.setNameSnapshot(id.equals("l1") ? "Cotton scarf" : "Steel bottle");
        return line;
    }

    private static StockVariantRepository.VariantFacts facts(String packageSessionId, String mode, String policy) {
        StockVariantRepository.VariantFacts facts = mock(StockVariantRepository.VariantFacts.class);
        when(facts.getPackageSessionId()).thenReturn(packageSessionId);
        when(facts.getStockMode()).thenReturn(mode);
        when(facts.getStockPolicy()).thenReturn(policy);
        return facts;
    }

    private static CommercePieceRepository.PieceRow piece(String id, String code) {
        CommercePieceRepository.PieceRow row = mock(CommercePieceRepository.PieceRow.class);
        when(row.getId()).thenReturn(id);
        when(row.getCode()).thenReturn(code);
        return row;
    }

    private void factsOfTheShop() {
        StockVariantRepository.VariantFacts scarf = facts("ps-scarf", "PIECE", "TRACKED");
        StockVariantRepository.VariantFacts bottle = facts("ps-bottle", "QUANTITY", "UNTRACKED");
        when(variants.findFactsIn(eq(INST), any())).thenReturn(List.of(scarf, bottle));
        service.setVariantRepository(variants);
    }

    private void oneShipment(String status) {
        CommerceShipment shipment = new CommerceShipment();
        shipment.setId("s1");
        shipment.setOrderId("o1");
        shipment.setStatus(status);
        when(shipments.findByOrderIdOrderByCreatedAtAsc("o1")).thenReturn(List.of(shipment));
        CommerceShipmentLine scarf = new CommerceShipmentLine();
        scarf.setId("sl1");
        scarf.setShipmentId("s1");
        scarf.setOrderLineId("l1");
        scarf.setQuantity(2);
        CommerceShipmentLine bottle = new CommerceShipmentLine();
        bottle.setId("sl2");
        bottle.setShipmentId("s1");
        bottle.setOrderLineId("l2");
        bottle.setQuantity(3);
        when(shipmentLines.findByShipmentIdIn(List.of("s1"))).thenReturn(List.of(scarf, bottle));
        List<CommercePieceRepository.PieceRow> packed = List.of(piece("pc-1", "CS-0001"), piece("pc-2", "CS-0002"));
        when(pieces.findRowsByOrderLine(INST, "l1")).thenReturn(packed);
        when(pieces.findRowsByOrderLine(INST, "l2")).thenReturn(List.of());
    }

    @Test
    @SuppressWarnings("unchecked")
    void aPieceTrackedLineAndAQuantityLineCarryTheirStockFactsFromOneQuery() {
        factsOfTheShop();

        StaffOrderDtos.StaffOrderDetail detail = service.staffDetail(INST, "o1");

        StaffOrderDtos.StaffOrderLine scarf = detail.getLines().get(0);
        assertEquals("PIECE", scarf.getStockMode());
        assertEquals("TRACKED", scarf.getStockPolicy());
        StaffOrderDtos.StaffOrderLine bottle = detail.getLines().get(1);
        assertEquals("QUANTITY", bottle.getStockMode());
        assertEquals("UNTRACKED", bottle.getStockPolicy());
        org.mockito.ArgumentCaptor<Collection<String>> asked = org.mockito.ArgumentCaptor.forClass(Collection.class);
        verify(variants, org.mockito.Mockito.times(1)).findFactsIn(eq(INST), asked.capture());
        assertEquals(Set.of("ps-scarf", "ps-bottle", "ps-gone"), Set.copyOf(asked.getValue()),
                "item lines only, each package session once");
    }

    @Test
    void aShippingLineAndAVariantNoLongerInTheShopHaveNoStockFacts() {
        factsOfTheShop();

        StaffOrderDtos.StaffOrderDetail detail = service.staffDetail(INST, "o1");

        assertNull(detail.getLines().get(2).getStockMode(), "shipping line");
        assertNull(detail.getLines().get(2).getStockPolicy());
        assertNull(detail.getLines().get(3).getStockMode(), "unknown variant");
        assertNull(detail.getLines().get(3).getStockPolicy());
    }

    @Test
    void theLiveShipmentNamesThePiecesByIdInTheOrderOfTheirCodes() {
        factsOfTheShop();
        oneShipment("PACKED");

        StaffOrderDtos.StaffShipmentLine scarf = service.staffDetail(INST, "o1").getShipments().get(0).getLines().get(0);

        assertEquals(List.of("CS-0001", "CS-0002"), scarf.getPieceCodes());
        assertEquals(List.of("pc-1", "pc-2"), scarf.getPieceIds());
        assertEquals(scarf.getQuantity(), scarf.getPieceIds().size());
        StaffOrderDtos.StaffShipmentLine bottle = service.staffDetail(INST, "o1").getShipments().get(0).getLines().get(1);
        assertNull(bottle.getPieceCodes(), "a quantity line has no pieces");
        assertNull(bottle.getPieceIds());
    }

    @Test
    void aCancelledShipmentNamesNoPieces() {
        factsOfTheShop();
        oneShipment("CANCELLED");

        StaffOrderDtos.StaffShipmentLine scarf = service.staffDetail(INST, "o1").getShipments().get(0).getLines().get(0);

        assertNull(scarf.getPieceCodes());
        assertNull(scarf.getPieceIds());
    }

    @Test
    void withoutTheVariantRepositoryTheDetailStillAnswersWithoutStockFacts() {
        oneShipment("PACKED");

        StaffOrderDtos.StaffOrderDetail detail = service.staffDetail(INST, "o1");

        assertEquals(4, detail.getLines().size());
        for (StaffOrderDtos.StaffOrderLine line : detail.getLines()) {
            assertNull(line.getStockMode());
            assertNull(line.getStockPolicy());
        }
        assertEquals(List.of("pc-1", "pc-2"), detail.getShipments().get(0).getLines().get(0).getPieceIds());
        verifyNoInteractions(variants);
    }

    @Test
    void theRowCarriesTheCodAmountOnTheDetailAndTheList() {
        factsOfTheShop();
        assertEquals(new BigDecimal("2140.00"), service.staffDetail(INST, "o1").getOrder().getCodAmount());

        when(orders.staffSearch(eq(INST), any(), any(), any(), any(), any(), any(), any(), any(), any(), any(), any()))
                .thenReturn(new PageImpl<>(List.of(order)));
        StaffOrderDtos.StaffOrderPage page = service.staffList(INST, null, null, 0, 20);
        assertEquals(new BigDecimal("2140.00"), page.getOrders().get(0).getCodAmount());
        verify(variants, org.mockito.Mockito.times(1)).findFactsIn(anyString(), any());
    }

    @Test
    void theNewFieldsAreSnakeCaseAndLeftOutWhenNull() throws Exception {
        ObjectMapper json = new ObjectMapper();
        JsonNode line = json.valueToTree(StaffOrderDtos.StaffOrderLine.builder().id("l1").stockMode("PIECE")
                .stockPolicy("TRACKED").build());
        assertEquals("PIECE", line.get("stock_mode").asText());
        assertEquals("TRACKED", line.get("stock_policy").asText());
        JsonNode shipmentLine = json.valueToTree(StaffOrderDtos.StaffShipmentLine.builder().id("sl1")
                .pieceCodes(List.of("CS-0001")).pieceIds(List.of("pc-1")).build());
        assertEquals("pc-1", shipmentLine.get("piece_ids").get(0).asText());
        JsonNode row = json.valueToTree(StaffOrderDtos.StaffOrderRow.builder().id("o1")
                .codAmount(new BigDecimal("2140.00")).build());
        assertEquals(0, new BigDecimal("2140.00").compareTo(row.get("cod_amount").decimalValue()));

        JsonNode bareLine = json.valueToTree(StaffOrderDtos.StaffOrderLine.builder().id("l3").build());
        assertFalse(bareLine.has("stock_mode"));
        assertFalse(bareLine.has("stock_policy"));
        assertFalse(json.valueToTree(StaffOrderDtos.StaffShipmentLine.builder().id("sl1").build()).has("piece_ids"));
        assertFalse(json.valueToTree(StaffOrderDtos.StaffOrderRow.builder().id("o1").build()).has("cod_amount"));
        assertTrue(json.writeValueAsString(StaffOrderDtos.StaffOrderRow.builder().id("o1")
                .codAmount(new BigDecimal("2140.00")).build()).contains("\"cod_amount\":2140.00"));
    }
}
