package vacademy.io.admin_core_service.features.commerce.returns;

import org.springframework.beans.factory.ObjectProvider;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.transaction.PlatformTransactionManager;
import vacademy.io.admin_core_service.features.commerce.audit.CommerceAuditService;
import vacademy.io.admin_core_service.features.commerce.common.request.CommerceRequestGuard;
import vacademy.io.admin_core_service.features.commerce.document.service.DocumentClock;
import vacademy.io.admin_core_service.features.commerce.order.desk.CommerceOrderDeskService;
import vacademy.io.admin_core_service.features.commerce.order.desk.CommerceOrderEvents;
import vacademy.io.admin_core_service.features.commerce.order.desk.CommerceSalesMoneyHook;
import vacademy.io.admin_core_service.features.commerce.order.entity.CommerceOrder;
import vacademy.io.admin_core_service.features.commerce.order.payment.CommerceGatewayOrder;
import vacademy.io.admin_core_service.features.commerce.order.payment.CommerceGatewayOrderRepository;
import vacademy.io.admin_core_service.features.commerce.order.payment.CommercePaymentExceptionRepository;
import vacademy.io.admin_core_service.features.commerce.order.payment.CommercePaymentGateway;
import vacademy.io.admin_core_service.features.commerce.order.repository.CommerceOrderRepository;
import vacademy.io.admin_core_service.features.commerce.returns.entity.CommerceRefund;
import vacademy.io.admin_core_service.features.commerce.returns.entity.CommerceReturn;
import vacademy.io.admin_core_service.features.commerce.returns.repository.CommerceRefundRepository;
import vacademy.io.admin_core_service.features.commerce.returns.repository.CommerceReturnRepository;
import vacademy.io.admin_core_service.features.commerce.returns.service.CommerceRefundExecutor;
import vacademy.io.admin_core_service.features.commerce.returns.service.CommerceRefundService;
import vacademy.io.admin_core_service.features.commerce.returns.service.CommerceReturnDueService;
import vacademy.io.admin_core_service.features.commerce.security.CommerceAccessGuard;
import vacademy.io.admin_core_service.features.commerce.stock.service.StockPeriodGuard;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.Optional;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.Consumer;
import java.util.function.Supplier;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.mock;

/**
 * The refund ledger over mocks: one paid prepaid order, its paying gateway row, and refund rows
 * kept in a list whose compare-and-set updates behave like the SQL ones. The request guard runs
 * the change directly; after-commit work runs at once.
 */
@SuppressWarnings("unchecked")
class RefundFixture {

    static final String INST = "inst-1";
    static final String ORDER = "order-1";
    static final String LOC = "loc-1";
    static final String PAYMENT = "pay_1";

    final CommerceOrderDeskService desk = mock(CommerceOrderDeskService.class);
    final CommerceOrderRepository orderRepository = mock(CommerceOrderRepository.class);
    final CommerceRefundRepository refundRepository = mock(CommerceRefundRepository.class);
    final CommerceReturnRepository returnRepository = mock(CommerceReturnRepository.class);
    final CommerceGatewayOrderRepository gatewayOrders = mock(CommerceGatewayOrderRepository.class);
    final CommercePaymentExceptionRepository exceptions = mock(CommercePaymentExceptionRepository.class);
    final CommerceReturnDueService dueService = mock(CommerceReturnDueService.class);
    final CommerceRequestGuard requestGuard = mock(CommerceRequestGuard.class);
    final CommerceAccessGuard accessGuard;
    final CommerceAuditService auditService = mock(CommerceAuditService.class);
    final CommerceOrderEvents events = mock(CommerceOrderEvents.class);
    final CommercePaymentGateway gateway = mock(CommercePaymentGateway.class);
    final DocumentClock clock = mock(DocumentClock.class);
    final ObjectProvider<StockPeriodGuard> periodGuard = mock(ObjectProvider.class);
    final ObjectProvider<CommerceRefundExecutor> executorProvider = mock(ObjectProvider.class);
    final CommerceRefundExecutor executor = mock(CommerceRefundExecutor.class);
    final PlatformTransactionManager transactionManager = mock(PlatformTransactionManager.class);
    final CommerceSalesMoneyHook moneyHook = mock(CommerceSalesMoneyHook.class);

    final CommerceRefundService service;
    final CommerceOrder order = new CommerceOrder();
    final CommerceGatewayOrder paying = new CommerceGatewayOrder();
    final List<CommerceRefund> refunds = new ArrayList<>();
    final List<CommerceReturn> returns = new ArrayList<>();
    final AtomicInteger ids = new AtomicInteger();
    final LocalDate today = LocalDate.of(2026, 11, 16);
    final List<String> eventTypes = new ArrayList<>();
    /** The third argument of each {@code desk.event} call: the shipment, return or refund it is about. */
    final List<String> eventRefs = new ArrayList<>();

    RefundFixture() {
        this(mock(CommerceAccessGuard.class));
    }

    /** With a real guard: the desk's {@code authorize} runs it as the desk does. */
    RefundFixture(CommerceAccessGuard guard) {
        this.accessGuard = guard;
        lenient().doAnswer(call -> {
            if (org.mockito.Mockito.mockingDetails(guard).isMock()) {
                return null;
            }
            guard.require(call.getArgument(0), call.getArgument(1),
                    vacademy.io.admin_core_service.features.commerce.security.CommerceFeature.ORDERS,
                    call.getArgument(3), call.getArgument(2));
            return null;
        }).when(desk).authorize(any(), anyString(), any(), any());
        service = new CommerceRefundService(desk, orderRepository, refundRepository, returnRepository, gatewayOrders,
                exceptions, dueService, requestGuard, accessGuard, auditService, events, gateway, clock, periodGuard,
                executorProvider, transactionManager);
        lenient().when(executorProvider.getIfAvailable()).thenReturn(executor);
        if (org.mockito.Mockito.mockingDetails(guard).isMock()) {
            lenient().when(guard.featureOn(anyString(), any())).thenReturn(true);
            lenient().when(guard.featureState(anyString(), any())).thenReturn(CommerceAccessGuard.FeatureState.ON);
        }
        lenient().when(clock.today(anyString())).thenReturn(today);
        lenient().when(requestGuard.run(any(), any(), any())).thenAnswer(call -> new CommerceRequestGuard.Outcome<>(
                ((Supplier<Object>) call.getArgument(1)).get(), false));

        order.setId(ORDER);
        order.setInstituteId(INST);
        order.setOrderNumber("ORD-000001");
        order.setStatus("DELIVERED");
        order.setChannel("ONLINE");
        order.setPaymentMethod("PREPAID");
        order.setPaymentStatus("PAID");
        order.setCurrency("INR");
        order.setFulfilmentLocationId(LOC);
        order.setTotal(new BigDecimal("1000.00"));
        order.setAmountPaid(new BigDecimal("1000.00"));
        order.setRefundDue(new BigDecimal("600.00"));
        order.setPrimaryPaymentLogId("log-1");
        lenient().when(desk.lockOrder(INST, ORDER)).thenReturn(order);
        lenient().when(desk.readOrder(INST, ORDER)).thenReturn(order);
        lenient().when(desk.event(anyString(), any(), any(), anyBoolean())).thenAnswer(call -> {
            eventTypes.add(call.getArgument(0));
            eventRefs.add(call.getArgument(2));
            // As the desk makes it: the ref is also the event's shipment id.
            return new CommerceOrderEvents.OrderEvent(call.getArgument(0), INST, ORDER, "ORD-000001",
                    call.getArgument(2), call.getArgument(3));
        });
        doAnswer(call -> {
            ((Consumer<CommerceSalesMoneyHook>) call.getArgument(0)).accept(moneyHook);
            return null;
        }).when(desk).afterCommitMoney(any());
        doAnswer(call -> {
            CommerceOrder o = call.getArgument(0);
            BigDecimal amount = call.getArgument(1);
            if (amount != null && amount.signum() > 0) {
                o.setRefundDue(o.getRefundDue().add(amount).min(o.getAmountPaid()));
            }
            return null;
        }).when(desk).raiseRefundDue(any(), any(), anyString(), any());

        paying.setId("g-1");
        paying.setInstituteId(INST);
        paying.setCommerceOrderId(ORDER);
        paying.setVendor("RAZORPAY");
        paying.setAmountMinor(100000L);
        paying.setCurrency("INR");
        paying.setGatewayPaymentId(PAYMENT);
        paying.setPaying(true);
        lenient().when(gatewayOrders.findFirstByCommerceOrderIdAndPayingTrue(ORDER)).thenAnswer(call ->
                Optional.ofNullable(paying.getPaying() ? paying : null));
        lenient().when(gatewayOrders.findPayingPaymentId(ORDER)).thenAnswer(call ->
                Optional.ofNullable(paying.getPaying() ? paying.getGatewayPaymentId() : null));

        lenient().when(refundRepository.saveAndFlush(any(CommerceRefund.class))).thenAnswer(call -> {
            CommerceRefund r = call.getArgument(0);
            if (r.getId() == null) {
                r.setId("refund-" + ids.incrementAndGet());
                refunds.add(r);
            }
            return r;
        });
        lenient().when(refundRepository.findById(anyString())).thenAnswer(call -> find(call.getArgument(0)));
        lenient().when(refundRepository.findByIdAndInstituteId(anyString(), eq(INST)))
                .thenAnswer(call -> find(call.getArgument(0)));
        lenient().when(refundRepository.findByInstituteIdAndIdempotencyKey(eq(INST), anyString())).thenAnswer(call ->
                refunds.stream().filter(r -> r.getIdempotencyKey().equals(call.getArgument(1))).findFirst());
        lenient().when(refundRepository.markProcessed(anyString(), any(), any(), any(), any(), any())).thenAnswer(call ->
                cas(call.getArgument(0), "PROCESSED", r -> {
                    r.setProcessedAt(call.getArgument(1));
                    if (call.getArgument(3) != null) {
                        r.setReference(call.getArgument(3));
                    }
                    if (call.getArgument(4) != null) {
                        r.setPaidOn(call.getArgument(4));
                    }
                }));
        lenient().when(refundRepository.markFailed(anyString(), any(), anyString(), any(), any(), any())).thenAnswer(
                call -> cas(call.getArgument(0), "FAILED", r -> r.setFailureCode(call.getArgument(2))));
        lenient().when(refundRepository.cancelPending(anyString(), any(), anyString(), any(), any())).thenAnswer(call -> {
            CommerceRefund r = find(call.getArgument(0)).orElse(null);
            if (r == null || !"PENDING".equals(r.getStatus())) {
                return 0;
            }
            r.setStatus("FAILED");
            r.setFailureCode(call.getArgument(2));
            return 1;
        });
        lenient().when(refundRepository.storeGatewayRefund(anyString(), anyString(), any(), any())).thenAnswer(call -> {
            CommerceRefund r = find(call.getArgument(0)).orElse(null);
            if (r == null || r.getGatewayRefundId() != null || !"IN_PROGRESS".equals(r.getStatus())) {
                return 0;
            }
            r.setGatewayRefundId(call.getArgument(1));
            r.setGatewayStatus(call.getArgument(2));
            return 1;
        });
        lenient().when(refundRepository.sumLiveOfReturn(anyString())).thenAnswer(call -> sum(call.getArgument(0),
                false));
        lenient().when(refundRepository.sumProcessedOfReturn(anyString())).thenAnswer(call -> sum(call.getArgument(0),
                true));
        lenient().when(refundRepository.sumLiveGatewayOfPayment(anyString(), anyString())).thenAnswer(call ->
                refunds.stream().filter(r -> "GATEWAY".equals(r.getMethod()) && !"FAILED".equals(r.getStatus())
                                && call.getArgument(1).equals(r.getGatewayPaymentId()))
                        .map(CommerceRefund::getAmount).reduce(BigDecimal.ZERO, BigDecimal::add));
        lenient().when(refundRepository.claim(anyString(), any(), any())).thenAnswer(call -> {
            CommerceRefund r = find(call.getArgument(0)).orElse(null);
            Date now = call.getArgument(1);
            if (r == null || !"PENDING".equals(r.getStatus()) || !"GATEWAY".equals(r.getMethod())
                    || (r.getNextPollAt() != null && r.getNextPollAt().after(now))) {
                return 0;
            }
            r.setStatus("IN_PROGRESS");
            r.setClaimedAt(now);
            r.setAttemptCount(r.getAttemptCount() + 1);
            r.setNextPollAt(call.getArgument(2));
            return 1;
        });
        lenient().when(returnRepository.findById(anyString())).thenAnswer(call -> returns.stream()
                .filter(r -> r.getId().equals(call.getArgument(0))).findFirst());
        lenient().when(returnRepository.findByIdAndInstituteId(anyString(), eq(INST))).thenAnswer(call ->
                returns.stream().filter(r -> r.getId().equals(call.getArgument(0))).findFirst());
        lenient().when(returnRepository.lockById(anyString())).thenAnswer(call -> returns.stream()
                .filter(r -> r.getId().equals(call.getArgument(0))).findFirst());
        lenient().when(orderRepository.findById(ORDER)).thenReturn(Optional.of(order));
    }

    Optional<CommerceRefund> find(String id) {
        return refunds.stream().filter(r -> r.getId().equals(id)).findFirst();
    }

    private int cas(String id, String to, Consumer<CommerceRefund> more) {
        CommerceRefund r = find(id).orElse(null);
        if (r == null || !("PENDING".equals(r.getStatus()) || "IN_PROGRESS".equals(r.getStatus()))) {
            return 0;
        }
        r.setStatus(to);
        more.accept(r);
        return 1;
    }

    private BigDecimal sum(String returnId, boolean processedOnly) {
        return refunds.stream().filter(r -> returnId.equals(r.getReturnId()))
                .filter(r -> processedOnly ? "PROCESSED".equals(r.getStatus()) : !"FAILED".equals(r.getStatus()))
                .map(CommerceRefund::getAmount).reduce(BigDecimal.ZERO, BigDecimal::add);
    }

    CommerceReturn received(String id, String creditTotal, String dueRaised) {
        CommerceReturn r = new CommerceReturn();
        r.setId(id);
        r.setInstituteId(INST);
        r.setOrderId(ORDER);
        r.setReturnNumber("RET-" + id);
        r.setStatus("RECEIVED");
        r.setLocationId(LOC);
        r.setCreditNoteId("cn-" + id);
        r.setCreditTotal(new BigDecimal(creditTotal));
        r.setDueRaised(new BigDecimal(dueRaised));
        returns.add(r);
        return r;
    }

    /** A pending gateway refund already written (as the request would). */
    CommerceRefund pendingGateway(String amount) {
        CommerceRefund r = new CommerceRefund();
        r.setId("refund-" + ids.incrementAndGet());
        r.setInstituteId(INST);
        r.setOrderId(ORDER);
        r.setKind("ORDER");
        r.setSource("STAFF");
        r.setMethod("GATEWAY");
        r.setStatus("PENDING");
        r.setAmount(new BigDecimal(amount));
        r.setCurrency("INR");
        r.setGatewayVendor("RAZORPAY");
        r.setGatewayPaymentId(PAYMENT);
        r.setIdempotencyKey("REQ:" + r.getId());
        refunds.add(r);
        order.setRefundCommitted(order.getRefundCommitted().add(r.getAmount()));
        return r;
    }

    static CustomUserDetails user(String... authorities) {
        CustomUserDetails user = mock(CustomUserDetails.class);
        lenient().when(user.getUserId()).thenReturn("user-1");
        List<GrantedAuthority> granted = new ArrayList<>();
        for (String a : authorities) {
            granted.add(new SimpleGrantedAuthority(a));
        }
        lenient().when(user.getAuthorities()).thenAnswer(call -> granted);
        return user;
    }

    static CustomUserDetails manager() {
        return user("COMMERCE_STORE_MANAGER");
    }
}
