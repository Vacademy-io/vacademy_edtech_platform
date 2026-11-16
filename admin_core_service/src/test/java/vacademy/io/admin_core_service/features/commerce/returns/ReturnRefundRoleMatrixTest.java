package vacademy.io.admin_core_service.features.commerce.returns;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;
import vacademy.io.admin_core_service.features.capabilities.service.CapabilityResolver;
import vacademy.io.admin_core_service.features.commerce.document.repository.CommerceCreditNoteRepository;
import vacademy.io.admin_core_service.features.commerce.document.service.CommerceCreditNoteService;
import vacademy.io.admin_core_service.features.commerce.order.repository.CommerceOrderLineRepository;
import vacademy.io.admin_core_service.features.commerce.returns.controller.CommerceRefundController;
import vacademy.io.admin_core_service.features.commerce.returns.controller.CommerceReturnController;
import vacademy.io.admin_core_service.features.commerce.returns.dto.RefundDtos;
import vacademy.io.admin_core_service.features.commerce.returns.dto.ReturnDtos;
import vacademy.io.admin_core_service.features.commerce.returns.entity.CommerceRefund;
import vacademy.io.admin_core_service.features.commerce.returns.policy.CommerceReturnSettings;
import vacademy.io.admin_core_service.features.commerce.returns.repository.CommerceReturnLineRepository;
import vacademy.io.admin_core_service.features.commerce.returns.service.CommerceReturnDueService;
import vacademy.io.admin_core_service.features.commerce.returns.service.CommerceReturnService;
import vacademy.io.admin_core_service.features.commerce.security.CommerceAccessDeniedException;
import vacademy.io.admin_core_service.features.commerce.security.CommerceAccessGuard;
import vacademy.io.admin_core_service.features.commerce.security.repository.CommerceStaffLocationRepository;
import vacademy.io.admin_core_service.features.commerce.shipment.repository.CommerceShipmentLineRepository;
import vacademy.io.admin_core_service.features.commerce.shipment.repository.CommerceShipmentRepository;
import vacademy.io.admin_core_service.features.commerce.stock.repository.CommercePieceRepository;
import vacademy.io.admin_core_service.features.commerce.stock.repository.StockLocationRepository;
import vacademy.io.admin_core_service.features.commerce.stock.repository.StockVariantRepository;
import vacademy.io.admin_core_service.features.commerce.stock.service.CommerceCounterService;
import vacademy.io.admin_core_service.features.commerce.stock.service.StockLedgerService;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.math.BigDecimal;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.function.BiConsumer;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;
import static vacademy.io.admin_core_service.features.commerce.returns.RefundFixture.INST;
import static vacademy.io.admin_core_service.features.commerce.returns.RefundFixture.LOC;
import static vacademy.io.admin_core_service.features.commerce.returns.RefundFixture.ORDER;

/**
 * Who may call each return and refund route, through the controllers and the real commerce
 * guard: ADMIN, store manager (M), warehouse staff (W), accountant (Ac), cashier, a learner,
 * another institute's admin and a shopper with no staff role. "403" is the guard's refusal;
 * "ok" means the caller got past it (whatever the service answered next).
 */
@SuppressWarnings("unchecked")
class ReturnRefundRoleMatrixTest {

    private static final List<String> CALLERS = List.of("ADMIN", "M", "W", "Ac", "cashier", "learner",
            "other-institute admin", "shopper");

    private CommerceAccessGuard guard;

    @BeforeEach
    void setUp() {
        CapabilityResolver capabilities = mock(CapabilityResolver.class);
        when(capabilities.isFeatureGranted(eq(INST), anyString())).thenReturn(true);
        CommerceStaffLocationRepository staffLocations = mock(CommerceStaffLocationRepository.class);
        when(staffLocations.existsByInstituteIdAndUserIdAndLocationId(INST, "user-1", LOC)).thenReturn(true);
        guard = new CommerceAccessGuard(capabilities, staffLocations);
    }

    @AfterEach
    void tearDown() {
        RequestContextHolder.resetRequestAttributes();
    }

    private static CustomUserDetails caller(String who) {
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.addHeader("clientId", who.equals("other-institute admin") ? "inst-2" : INST);
        RequestContextHolder.setRequestAttributes(new ServletRequestAttributes(request));
        return switch (who) {
            case "ADMIN", "other-institute admin" -> RefundFixture.user("ADMIN");
            case "M" -> RefundFixture.user("COMMERCE_STORE_MANAGER");
            case "W" -> RefundFixture.user("COMMERCE_WAREHOUSE_STAFF");
            case "Ac" -> RefundFixture.user("COMMERCE_ACCOUNTANT");
            case "cashier" -> RefundFixture.user("COMMERCE_POS_CASHIER");
            case "learner" -> RefundFixture.user("STUDENT");
            default -> RefundFixture.user();
        };
    }

    private record Routes(CommerceReturnController returns, CommerceRefundController refunds) {
    }

    private Routes routes() {
        RefundFixture f = new RefundFixture(guard);
        f.received("ret-1", "100.00", "100.00");
        CommerceRefund pending = f.pendingGateway("10.00");
        pending.setId("refund-x");
        ObjectProvider<vacademy.io.admin_core_service.features.commerce.shipment.service.CommerceShipmentService> none =
                mock(ObjectProvider.class);
        CommerceReturnService returns = new CommerceReturnService(f.desk, f.service,
                new CommerceReturnDueService(f.returnRepository, f.refundRepository, f.orderRepository, f.desk),
                f.returnRepository, mock(CommerceReturnLineRepository.class), f.refundRepository, f.orderRepository,
                mock(CommerceOrderLineRepository.class), mock(StockLocationRepository.class),
                mock(CommerceShipmentRepository.class), mock(CommerceShipmentLineRepository.class),
                mock(CommercePieceRepository.class), mock(StockVariantRepository.class), mock(StockLedgerService.class),
                mock(CommerceCreditNoteService.class), mock(CommerceCreditNoteRepository.class),
                mock(CommerceCounterService.class), mock(CommerceReturnSettings.class), f.requestGuard, guard,
                f.auditService, f.events, none, f.clock, new ObjectMapper(), f.transactionManager);
        return new Routes(new CommerceReturnController(returns), new CommerceRefundController(f.service));
    }

    private Map<String, String> matrix(BiConsumer<Routes, CustomUserDetails> call) {
        Map<String, String> out = new LinkedHashMap<>();
        for (String who : CALLERS) {
            CustomUserDetails user = caller(who);
            Routes routes = routes();
            try {
                call.accept(routes, user);
                out.put(who, "ok");
            } catch (CommerceAccessDeniedException e) {
                out.put(who, "403");
            } catch (RuntimeException e) {
                out.put(who, "ok");
            }
        }
        return out;
    }

    private static Map<String, String> allowed(String... who) {
        Set<String> ok = Set.of(who);
        Map<String, String> out = new LinkedHashMap<>();
        for (String c : CALLERS) {
            out.put(c, c.equals("ADMIN") || ok.contains(c) ? "ok" : "403");
        }
        return out;
    }

    private static ReturnDtos.CreateReturnRequest createBody() {
        return ReturnDtos.CreateReturnRequest.builder().clientRequestId("return-key-1").orderId(ORDER)
                .reason("DEFECTIVE").lines(List.of(ReturnDtos.LineRequest.builder().orderLineId("l1").quantity(1)
                        .build())).build();
    }

    @Test
    void returnRoutes() {
        assertEquals(allowed("M"), matrix((r, u) -> r.returns().preview(INST, createBody(), u)), "preview");
        assertEquals(allowed("M"), matrix((r, u) -> r.returns().create(INST, createBody(), u)), "create");
        assertEquals(allowed("M"), matrix((r, u) -> r.returns().approve("ret-1", INST, ReturnDtos.ApproveRequest
                .builder().clientRequestId("approve-key-1").fromStatus("REQUESTED").build(), u)), "approve");
        assertEquals(allowed("M"), matrix((r, u) -> r.returns().reject("ret-1", INST, ReturnDtos.RejectRequest
                .builder().clientRequestId("reject-key-1").fromStatus("REQUESTED").reason("r").build(), u)), "reject");
        assertEquals(allowed("M", "W"), matrix((r, u) -> r.returns().receive("ret-1", INST, ReturnDtos.ReceiveRequest
                .builder().clientRequestId("receive-key-1").fromStatus("APPROVED").lines(List.of(ReturnDtos
                        .ReceiveLine.builder().orderLineId("l1").condition("RESALEABLE").quantity(1).build()))
                .build(), u)), "receive");
        assertEquals(allowed("M", "W", "Ac"), matrix((r, u) -> r.returns().list(INST, null, null, null, null, 0, 20,
                u)), "list");
        assertEquals(allowed("M", "W", "Ac"), matrix((r, u) -> r.returns().get("ret-1", INST, u)), "get");
    }

    @Test
    void refundRoutes() {
        assertEquals(allowed("M"), matrix((r, u) -> r.refunds().create(INST, RefundDtos.CreateRefundRequest.builder()
                .clientRequestId("refund-key-1").orderId(ORDER).amount(new BigDecimal("1.00")).method("CASH")
                .reason("r").build(), u)), "create");
        assertEquals(allowed("M"), matrix((r, u) -> r.refunds().recordPayout("refund-x", INST, RefundDtos
                .PayoutRequest.builder().clientRequestId("payout-key-1").reference("UTR").build(), u)), "payout");
        assertEquals(allowed("M"), matrix((r, u) -> r.refunds().cancel("refund-x", INST, RefundDtos.CancelRequest
                .builder().clientRequestId("cancel-key-1").reason("r").build(), u)), "cancel");
        assertEquals(allowed("M"), matrix((r, u) -> r.refunds().check("refund-x", INST, RefundDtos.CheckRequest
                .builder().clientRequestId("check-key-1").build(), u)), "check");
        assertEquals(allowed("M", "Ac"), matrix((r, u) -> r.refunds().list(INST, null, null, null, null, null, 0, 20,
                u)), "list");
        assertEquals(allowed("M", "Ac"), matrix((r, u) -> r.refunds().get("refund-x", INST, u)), "get");
    }
}
