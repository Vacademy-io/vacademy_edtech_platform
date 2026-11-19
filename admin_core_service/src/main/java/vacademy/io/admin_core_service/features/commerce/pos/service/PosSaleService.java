package vacademy.io.admin_core_service.features.commerce.pos.service;

import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.commerce.audit.CommerceAuditService;
import vacademy.io.admin_core_service.features.commerce.common.request.CommerceRequestGuard;
import vacademy.io.admin_core_service.features.commerce.customer.CommercePhones;
import vacademy.io.admin_core_service.features.commerce.customer.service.CommerceCustomerService;
import vacademy.io.admin_core_service.features.commerce.document.dto.CommerceInvoiceLineExtra;
import vacademy.io.admin_core_service.features.commerce.document.dto.CommerceInvoiceRequest;
import vacademy.io.admin_core_service.features.commerce.document.service.CommerceInvoiceService;
import vacademy.io.admin_core_service.features.commerce.document.service.DocumentClock;
import vacademy.io.admin_core_service.features.commerce.order.checkout.BuyerIdentity;
import vacademy.io.admin_core_service.features.commerce.order.checkout.CheckoutException;
import vacademy.io.admin_core_service.features.commerce.order.checkout.CommerceBuyerResolver;
import vacademy.io.admin_core_service.features.commerce.order.checkout.CommerceOrderWriter;
import vacademy.io.admin_core_service.features.commerce.order.desk.CommerceOrderDeskService;
import vacademy.io.admin_core_service.features.commerce.order.desk.CommerceOrderEvents;
import vacademy.io.admin_core_service.features.commerce.order.desk.CommerceStaffOrderService;
import vacademy.io.admin_core_service.features.commerce.order.desk.CommerceStockShortFlagger;
import vacademy.io.admin_core_service.features.commerce.order.dto.CartPriceDtos;
import vacademy.io.admin_core_service.features.commerce.order.dto.CartPriceRequest;
import vacademy.io.admin_core_service.features.commerce.order.dto.CartPriceSnapshot;
import vacademy.io.admin_core_service.features.commerce.order.entity.CommerceOrder;
import vacademy.io.admin_core_service.features.commerce.order.entity.CommerceOrderLine;
import vacademy.io.admin_core_service.features.commerce.order.entity.CommerceOrderTender;
import vacademy.io.admin_core_service.features.commerce.order.enums.TenderMode;
import vacademy.io.admin_core_service.features.commerce.order.repository.CommerceOrderLineRepository;
import vacademy.io.admin_core_service.features.commerce.order.repository.CommerceOrderRepository;
import vacademy.io.admin_core_service.features.commerce.order.repository.CommerceOrderTenderRepository;
import vacademy.io.admin_core_service.features.commerce.order.service.CartPricingException;
import vacademy.io.admin_core_service.features.commerce.order.service.CommerceOrderService;
import vacademy.io.admin_core_service.features.commerce.pos.dto.PosDtos;
import vacademy.io.admin_core_service.features.commerce.pos.entity.PosRegister;
import vacademy.io.admin_core_service.features.commerce.pos.entity.PosSession;
import vacademy.io.admin_core_service.features.commerce.pos.enums.PosApprovalAction;
import vacademy.io.admin_core_service.features.commerce.pos.enums.PosRegisterStatus;
import vacademy.io.admin_core_service.features.commerce.pos.repository.PosReadRepository;
import vacademy.io.admin_core_service.features.commerce.pos.repository.PosSessionRepository;
import vacademy.io.admin_core_service.features.commerce.returns.entity.CommerceReturn;
import vacademy.io.admin_core_service.features.commerce.returns.enums.RefundMethod;
import vacademy.io.admin_core_service.features.commerce.returns.service.CommerceExchangeService;
import vacademy.io.admin_core_service.features.commerce.security.CommerceApprovalService;
import vacademy.io.admin_core_service.features.commerce.stock.enums.StockMovementType;
import vacademy.io.admin_core_service.features.commerce.stock.repository.CommercePieceRepository;
import vacademy.io.admin_core_service.features.commerce.stock.service.CommerceCounterService;
import vacademy.io.admin_core_service.features.commerce.stock.service.StockLedgerService;
import vacademy.io.admin_core_service.features.commerce.stock.service.StockPeriodGuard;
import vacademy.io.admin_core_service.features.commerce.stock.service.StockPostResult;
import vacademy.io.admin_core_service.features.commerce.stock.service.StockPosting;
import vacademy.io.admin_core_service.features.commerce.storefront.service.StorefrontSnapshotLoader;
import vacademy.io.admin_core_service.features.commerce.storefront.service.StorefrontSnapshotLoader.CartVariant;
import vacademy.io.admin_core_service.features.commerce.tax.service.CommerceInputRules;
import vacademy.io.admin_core_service.features.commerce.tax.service.GstinValidator;
import vacademy.io.admin_core_service.features.stock_hold.service.StockHoldService;
import vacademy.io.admin_core_service.features.user_subscription.entity.PaymentLog;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.ConflictException;
import vacademy.io.common.exceptions.InvalidRequestException;
import vacademy.io.common.exceptions.VacademyException;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.LocalDate;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * The counter sale: quote, sale and bill-book entry (a paper bill keyed in later).
 *
 * <p>One sale is one transaction, in the lock order of the shop: the exchange's old order and
 * return, the new order header (flushed: a double tap fails on its client key here), the PIN
 * (a remote role check, before any stock or session lock), the session FOR SHARE (a close waits
 * for the sale), the stock ledger (levels, package session, variants, pieces), and the
 * document number last. Any failure rolls everything back, the series counter included: no
 * invoice number is ever used by a sale that did not happen. Order numbers may have gaps.
 *
 * <p>Money and stock go through the shop's own path: {@link CommerceOrderService#priceCart}
 * with {@link CommerceOrderService.CounterPricing}, {@link CommerceOrderWriter#writePos}, the
 * stock ledger's POS_SALE, the staff order's {@code settlePaid}, the invoice service.
 */
@Slf4j
@Service
public class PosSaleService {

    public static final String PRICE_CHANGED = "PRICE_CHANGED";
    public static final String CART_CHANGED = "CART_CHANGED";
    public static final String NOT_PRICEABLE = "NOT_PRICEABLE";
    public static final String TENDERS_SHORT = "TENDERS_SHORT";
    public static final String TENDERS_OVER = "TENDERS_OVER";
    public static final String CASH_TENDERED_SHORT = "CASH_TENDERED_SHORT";
    public static final String PIECE_SCAN_REQUIRED = "PIECE_SCAN_REQUIRED";
    public static final String SOLD_ONLINE = "SOLD_ONLINE";
    public static final String IN_ONLINE_CHECKOUT = "IN_ONLINE_CHECKOUT";
    public static final String PIECE_STATE = "PIECE_STATE";
    public static final String BILL_DATE_INVALID = "BILL_DATE_INVALID";
    public static final String BILL_BOOK_NUMBER_USED = "BILL_BOOK_NUMBER_USED";
    /** OPS: a paper bill is keyed "never later than the next working day", with a weekend. */
    public static final int BILL_BOOK_MAX_AGE_DAYS = 3;
    public static final String HOLD_REASON_POS_SALE = "POS_SALE";

    static final int MAX_LINES = 50;
    static final int MAX_TENDERS = 10;
    static final int MAX_QUANTITY = 100_000;
    static final Pattern REFERENCE = Pattern.compile("^[A-Za-z0-9 /_.:#-]+$");
    static final Pattern BOOK_NUMBER = Pattern.compile("^[0-9]{1,9}$");
    static final BigDecimal MAX_AMOUNT = new BigDecimal("9999999999.99");
    private static final BigDecimal ZERO = BigDecimal.ZERO.setScale(2);
    private static final BigDecimal HUNDRED = new BigDecimal("100");

    private final PosAccess access;
    private final PosSessionRepository sessionRepository;
    private final PosReadRepository readRepository;
    private final PosSettingsService settings;
    private final PosWalkInUsers walkIns;
    private final PosReceiptService receipts;
    private final CommerceOrderService orderService;
    private final CommerceOrderWriter writer;
    private final CommerceOrderRepository orderRepository;
    private final CommerceOrderLineRepository lineRepository;
    private final CommerceOrderTenderRepository tenderRepository;
    private final CommerceOrderDeskService desk;
    private final CommerceStaffOrderService staffOrders;
    private final CommerceOrderEvents events;
    private final CommerceBuyerResolver buyerResolver;
    private final CommerceCustomerService customerService;
    private final CommerceCounterService counterService;
    private final StorefrontSnapshotLoader variantLoader;
    private final StockLedgerService ledger;
    private final StockHoldService stockHoldService;
    private final CommercePieceRepository pieceRepository;
    private final CommerceStockShortFlagger stockShortFlagger;
    private final CommerceInvoiceService invoiceService;
    private final CommerceApprovalService approvalService;
    private final CommerceAuditService auditService;
    private final DocumentClock clock;
    private final ObjectProvider<StockPeriodGuard> periodGuard;
    private final ObjectProvider<CommerceExchangeService> exchangeProvider;
    private final TransactionTemplate transaction;
    private final TransactionTemplate readOnly;

    @PersistenceContext
    private EntityManager entityManager;

    public PosSaleService(PosAccess access, PosSessionRepository sessionRepository, PosReadRepository readRepository,
                          PosSettingsService settings, PosWalkInUsers walkIns, PosReceiptService receipts,
                          CommerceOrderService orderService, CommerceOrderWriter writer,
                          CommerceOrderRepository orderRepository, CommerceOrderLineRepository lineRepository,
                          CommerceOrderTenderRepository tenderRepository, CommerceOrderDeskService desk,
                          CommerceStaffOrderService staffOrders, CommerceOrderEvents events,
                          CommerceBuyerResolver buyerResolver, CommerceCustomerService customerService,
                          CommerceCounterService counterService, StorefrontSnapshotLoader variantLoader,
                          StockLedgerService ledger, StockHoldService stockHoldService,
                          CommercePieceRepository pieceRepository, CommerceStockShortFlagger stockShortFlagger,
                          CommerceInvoiceService invoiceService, CommerceApprovalService approvalService,
                          CommerceAuditService auditService, DocumentClock clock,
                          ObjectProvider<StockPeriodGuard> periodGuard,
                          ObjectProvider<CommerceExchangeService> exchangeProvider,
                          PlatformTransactionManager transactionManager) {
        this.access = access;
        this.sessionRepository = sessionRepository;
        this.readRepository = readRepository;
        this.settings = settings;
        this.walkIns = walkIns;
        this.receipts = receipts;
        this.orderService = orderService;
        this.writer = writer;
        this.orderRepository = orderRepository;
        this.lineRepository = lineRepository;
        this.tenderRepository = tenderRepository;
        this.desk = desk;
        this.staffOrders = staffOrders;
        this.events = events;
        this.buyerResolver = buyerResolver;
        this.customerService = customerService;
        this.counterService = counterService;
        this.variantLoader = variantLoader;
        this.ledger = ledger;
        this.stockHoldService = stockHoldService;
        this.pieceRepository = pieceRepository;
        this.stockShortFlagger = stockShortFlagger;
        this.invoiceService = invoiceService;
        this.approvalService = approvalService;
        this.auditService = auditService;
        this.clock = clock;
        this.periodGuard = periodGuard;
        this.exchangeProvider = exchangeProvider;
        this.transaction = new TransactionTemplate(transactionManager);
        this.readOnly = new TransactionTemplate(transactionManager);
        this.readOnly.setReadOnly(true);
    }

    /** The answer of a sale, and whether it answers an earlier request with the same key. */
    public record Outcome(PosDtos.SaleAnswer answer, boolean replayed) {
    }

    // ================================================================== validation

    /** One line as validated. */
    record CleanLine(String lineRef, String variantId, int quantity, List<String> pieceIds, BigDecimal lineDiscount,
                     BigDecimal unitPrice) {
    }

    /** One tender as validated. */
    record CleanTender(TenderMode mode, BigDecimal amount, BigDecimal cashTendered, String reference) {
    }

    /** The body as validated (what does not need the catalogue). */
    record Clean(String clientRequestId, String sessionId, List<CleanLine> lines, String billDiscountKind,
                 BigDecimal billDiscountValue, String discountReason, String phone, String name, String buyerGstin,
                 String buyerLegalName, List<CleanTender> tenders, CommerceExchangeService.Ask exchange,
                 PosDtos.Approval approval, boolean notifyBuyer, String bookNumber, LocalDate documentDate) {

        BigDecimal received() {
            return tenders.stream().map(CleanTender::amount).reduce(ZERO, BigDecimal::add);
        }

        boolean anyLineDiscount() {
            return lines.stream().anyMatch(l -> l.lineDiscount() != null && l.lineDiscount().signum() > 0);
        }

        boolean walkIn() {
            return phone == null;
        }
    }

    /** What a request is for: the validation and the hash differ by kind. */
    enum Kind { QUOTE, SALE, BILL_BOOK }

    /**
     * Every 400 rule of the body that does not need the catalogue. The piece rule and the
     * line-discount ceiling are checked once the variants are read ({@link #requirePieces},
     * pricing).
     */
    static Clean validate(PosDtos.SaleRequest request, Kind kind, LocalDate today) {
        if (request == null) {
            throw validation("the request has no body");
        }
        String key = kind == Kind.QUOTE ? null : CommerceRequestGuard.requireClientKey(request.clientRequestId());
        String sessionId = text(request.sessionId(), "session_id", 36);
        if (sessionId == null) {
            throw validation("session_id is required");
        }
        List<PosDtos.SaleLine> asked = request.lines();
        if (asked == null || asked.isEmpty() || asked.size() > MAX_LINES) {
            throw validation("lines holds 1 to " + MAX_LINES + " lines");
        }
        List<CleanLine> lines = new ArrayList<>();
        Set<String> refs = new LinkedHashSet<>();
        Set<String> variants = new LinkedHashSet<>();
        Set<String> allPieces = new LinkedHashSet<>();
        int no = 0;
        for (PosDtos.SaleLine line : asked) {
            no++;
            if (line == null) {
                throw validation("line " + no + " is empty");
            }
            String ref = text(line.lineRef(), "line_ref", 64);
            if (ref == null || !refs.add(ref)) {
                throw validation("line_ref of line " + no + " is 1 to 64 characters and distinct");
            }
            String variantId = text(line.variantId(), "variant_id", 36);
            if (variantId == null || !variants.add(variantId)) {
                throw validation("variant_id of line " + ref + " is required and appears once (merge the lines)");
            }
            if (line.quantity() == null || line.quantity() < 1 || line.quantity() > MAX_QUANTITY) {
                throw validation("quantity of line " + ref + " is 1 to " + MAX_QUANTITY + " (base units)");
            }
            List<String> pieces = new ArrayList<>();
            if (line.pieceIds() != null && !line.pieceIds().isEmpty()) {
                for (String raw : line.pieceIds()) {
                    String piece = raw == null ? "" : raw.trim();
                    if (piece.isEmpty() || piece.length() > 36 || !allPieces.add(piece)) {
                        throw validation("piece_ids of line " + ref + " are distinct ids");
                    }
                    pieces.add(piece);
                }
                if (pieces.size() != line.quantity()) {
                    throw new InvalidRequestException(PIECE_SCAN_REQUIRED + ": line " + ref + " names "
                            + pieces.size() + " piece(s) for a quantity of " + line.quantity());
                }
            }
            BigDecimal discount = line.lineDiscount();
            if (discount != null) {
                if (discount.signum() < 0 || discount.stripTrailingZeros().scale() > 2
                        || discount.compareTo(MAX_AMOUNT) > 0) {
                    throw validation("line_discount of line " + ref + " is an amount of at least 0");
                }
                discount = discount.setScale(2, RoundingMode.UNNECESSARY);
            }
            BigDecimal unitPrice = line.unitPrice();
            if (unitPrice != null && (unitPrice.signum() < 0 || unitPrice.compareTo(MAX_AMOUNT) > 0)) {
                throw validation("unit_price of line " + ref + " is not an amount");
            }
            lines.add(new CleanLine(ref, variantId, line.quantity(), List.copyOf(pieces), discount, unitPrice));
        }

        String billKind = null;
        BigDecimal billValue = null;
        String reason = null;
        if (request.billDiscount() != null && request.billDiscount().value() != null) {
            billKind = request.billDiscount().kind() == null ? null
                    : request.billDiscount().kind().trim().toUpperCase(java.util.Locale.ROOT);
            billValue = request.billDiscount().value();
            if ("AMOUNT".equals(billKind)) {
                if (billValue.compareTo(new BigDecimal("0.01")) < 0 || billValue.stripTrailingZeros().scale() > 2
                        || billValue.compareTo(MAX_AMOUNT) > 0) {
                    throw validation("bill_discount.value is an amount of at least 0.01");
                }
            } else if ("PERCENT".equals(billKind)) {
                if (billValue.compareTo(new BigDecimal("0.01")) < 0 || billValue.compareTo(HUNDRED) > 0
                        || billValue.stripTrailingZeros().scale() > 2) {
                    throw validation("bill_discount.value is a percent from 0.01 to 100");
                }
            } else {
                throw validation("bill_discount.kind is AMOUNT or PERCENT");
            }
        }
        if (request.billDiscount() != null) {
            // The reason of every discount on the bill, line discounts included.
            reason = text(request.billDiscount().reason(), "bill_discount.reason", 200);
        }
        if (reason == null) {
            // A bill with line discounts only carries its reason at the top level.
            reason = text(request.discountReason(), "discount_reason", 200);
        }
        boolean lineDiscounts = lines.stream().anyMatch(l -> l.lineDiscount() != null && l.lineDiscount().signum() > 0);
        if ((billKind != null || lineDiscounts) && reason == null) {
            throw validation("a discount needs a reason (bill_discount.reason or discount_reason, 1 to 200 "
                    + "characters)");
        }

        String phone = null;
        String name = null;
        String gstin = null;
        String legalName = null;
        PosDtos.Customer customer = request.customer();
        if (customer != null) {
            if (StringUtils.hasText(customer.phone())) {
                phone = CommercePhones.normalise(customer.phone());
                if (phone == null) {
                    throw validation("customer.phone is not a valid phone number");
                }
            }
            name = text(customer.name(), "customer.name", 200);
            String rawGstin = text(customer.buyerGstin(), "customer.buyer_gstin", 20);
            if (rawGstin != null) {
                gstin = GstinValidator.normalise(rawGstin);
                if (!GstinValidator.isValid(gstin)) {
                    throw validation("customer.buyer_gstin is not a valid GSTIN");
                }
                legalName = text(customer.buyerLegalName(), "customer.buyer_legal_name", 200);
                if (legalName == null) {
                    throw validation("customer.buyer_legal_name is required with a GSTIN");
                }
            }
        }

        List<CleanTender> tenders = new ArrayList<>();
        if (kind != Kind.QUOTE) {
            List<PosDtos.Tender> asked2 = request.tenders() == null ? List.of() : request.tenders();
            if (asked2.size() > MAX_TENDERS) {
                throw validation("tenders holds at most " + MAX_TENDERS + " payments");
            }
            int cash = 0;
            for (PosDtos.Tender tender : asked2) {
                TenderMode mode = tender == null ? null : TenderMode.of(tender.mode());
                if (mode == null || !TenderMode.STAFF_RECEIVED.contains(mode)) {
                    throw validation("a tender mode is CASH, UPI, CARD, BANK_TRANSFER or CHEQUE");
                }
                BigDecimal amount = tender.amount();
                if (amount == null || amount.signum() <= 0 || amount.stripTrailingZeros().scale() > 2
                        || amount.compareTo(MAX_AMOUNT) > 0) {
                    throw validation("a tender amount is more than 0 with at most two decimals");
                }
                amount = amount.setScale(2, RoundingMode.UNNECESSARY);
                BigDecimal handed = tender.cashTendered();
                if (mode == TenderMode.CASH) {
                    if (++cash > 1) {
                        throw validation("at most one CASH tender");
                    }
                    if (handed != null) {
                        if (handed.stripTrailingZeros().scale() > 2 || handed.compareTo(MAX_AMOUNT) > 0) {
                            throw validation("cash_tendered is an amount with at most two decimals");
                        }
                        handed = handed.setScale(2, RoundingMode.UNNECESSARY);
                        if (handed.compareTo(amount) < 0) {
                            throw new InvalidRequestException(CASH_TENDERED_SHORT + ": the cash handed over ("
                                    + handed.toPlainString() + ") is less than the cash amount ("
                                    + amount.toPlainString() + ")");
                        }
                    }
                } else if (handed != null) {
                    throw validation("cash_tendered is only for a CASH tender");
                }
                String reference = text(tender.reference(), "tender reference", 100);
                if (reference != null && !REFERENCE.matcher(reference).matches()) {
                    throw validation("a tender reference holds letters, digits, spaces and / _ . : # -");
                }
                if ((mode == TenderMode.UPI || mode == TenderMode.CARD) && reference == null) {
                    throw validation("a " + mode.name() + " tender needs its reference");
                }
                tenders.add(new CleanTender(mode, amount, handed, reference));
            }
        }

        CommerceExchangeService.Ask exchange = null;
        if (request.exchange() != null) {
            String returnId = text(request.exchange().returnId(), "exchange.return_id", 36);
            if (returnId == null) {
                throw validation("exchange.return_id is required");
            }
            RefundMethod method = null;
            String reference = null;
            PosDtos.RemainderRefund rest = request.exchange().remainderRefund();
            if (rest != null && rest.method() != null) {
                method = RefundMethod.of(rest.method());
                if (method != RefundMethod.CASH && method != RefundMethod.UPI && method != RefundMethod.BANK_TRANSFER) {
                    throw validation("exchange.remainder_refund.method is CASH, UPI or BANK_TRANSFER");
                }
                reference = text(rest.reference(), "exchange.remainder_refund.reference", 100);
            }
            exchange = new CommerceExchangeService.Ask(returnId, method, reference);
        }

        String bookNumber = null;
        LocalDate documentDate = null;
        if (kind == Kind.BILL_BOOK) {
            bookNumber = text(request.bookNumber(), "book_number", 9);
            if (bookNumber == null || !BOOK_NUMBER.matcher(bookNumber).matches()) {
                throw validation("book_number is the number printed on the paper bill (1 to 9 digits)");
            }
            documentDate = billDate(request.documentDate(), today);
            if (exchange != null) {
                throw validation("an exchange is taken at the till, not on a paper bill");
            }
        } else if (request.bookNumber() != null || request.documentDate() != null) {
            throw validation("book_number and document_date are only for a bill-book entry");
        }
        boolean notify = kind == Kind.SALE && (request.notifyBuyer() == null || request.notifyBuyer());
        return new Clean(key, sessionId, lines, billKind, billValue, reason, phone, name, gstin, legalName, tenders,
                exchange, request.approval(), notify, bookNumber, documentDate);
    }

    /** The date of a paper bill: today or up to {@link #BILL_BOOK_MAX_AGE_DAYS} days before. */
    static LocalDate billDate(String raw, LocalDate today) {
        LocalDate date;
        try {
            date = raw == null ? null : LocalDate.parse(raw.trim());
        } catch (DateTimeParseException e) {
            date = null;
        }
        if (date == null || date.isAfter(today) || date.isBefore(today.minusDays(BILL_BOOK_MAX_AGE_DAYS))) {
            throw new InvalidRequestException(BILL_DATE_INVALID + ": document_date is a date from "
                    + today.minusDays(BILL_BOOK_MAX_AGE_DAYS) + " to " + today);
        }
        return date;
    }

    /**
     * {@code piece_ids} are given exactly for a variant counted by piece and tracked
     * (400 PIECE_SCAN_REQUIRED when missing; 400 VALIDATION when given for another variant).
     */
    static void requirePieces(List<CleanLine> lines, Map<String, CartVariant> variants) {
        for (CleanLine line : lines) {
            CartVariant variant = variants.get(line.variantId());
            if (variant == null) {
                continue;
            }
            boolean pieceStock = variant.piece() && variant.tracked();
            if (pieceStock && line.pieceIds().isEmpty()) {
                throw new InvalidRequestException(PIECE_SCAN_REQUIRED + ": line " + line.lineRef()
                        + " is sold by piece: scan the piece label of each unit");
            }
            if (!pieceStock && !line.pieceIds().isEmpty()) {
                throw validation("piece_ids of line " + line.lineRef() + " are only for an item sold by piece");
            }
        }
    }

    /**
     * A sale line must be a whole number of the item's sale step (0.5 m of a cloth sold in steps of
     * 5 base units): 400 {@code QUANTITY_STEP} before anything is priced or written. The quote
     * keeps listing the line as unavailable instead.
     */
    static void requireSteps(List<CleanLine> lines, Map<String, CartVariant> variants) {
        for (CleanLine line : lines) {
            CartVariant variant = variants.get(line.variantId());
            if (variant == null) {
                continue;
            }
            int step = Math.max(1, variant.qtyStep());
            if (line.quantity() % step != 0) {
                throw CommerceOrderService.stepRefusal(line.lineRef(), step, variant.qtyScale(), variant.unit());
            }
        }
    }

    /** The bill discount in rupees: AMOUNT as given; PERCENT of the goods after line discounts, rounded. */
    static BigDecimal billDiscountAmount(Clean clean, Map<String, CartVariant> variants) {
        if (clean.billDiscountKind() == null) {
            return null;
        }
        if ("AMOUNT".equals(clean.billDiscountKind())) {
            return clean.billDiscountValue().setScale(2, RoundingMode.UNNECESSARY);
        }
        BigDecimal goods = ZERO;
        for (CleanLine line : clean.lines()) {
            CartVariant variant = variants.get(line.variantId());
            if (variant == null || variant.price() == null) {
                continue;
            }
            goods = goods.add(variant.price().multiply(BigDecimal.valueOf(line.quantity())));
            if (line.lineDiscount() != null) {
                goods = goods.subtract(line.lineDiscount());
            }
        }
        return goods.max(ZERO).multiply(clean.billDiscountValue()).divide(HUNDRED, 2, RoundingMode.HALF_UP);
    }

    /**
     * Whether the discounts need a manager: a cashier gives more (line + bill discounts) than
     * {@code limitPercent} of the goods' gross value. A manager or ADMIN never needs a PIN.
     */
    static boolean discountNeedsApproval(boolean manager, BigDecimal cashierDiscount, BigDecimal gross,
                                         BigDecimal limitPercent) {
        if (manager || cashierDiscount == null || cashierDiscount.signum() <= 0) {
            return false;
        }
        BigDecimal allowed = gross.multiply(limitPercent).divide(HUNDRED, 2, RoundingMode.HALF_UP);
        return cashierDiscount.compareTo(allowed) > 0;
    }

    /**
     * Whether a cashier needs a manager's PIN to spend a return's credit on a new bill: only the
     * credit of a return taken at the counter in the cashier's own session (this sale's session)
     * is theirs to use. A manager or ADMIN never needs a PIN.
     */
    static boolean exchangeNeedsApproval(boolean manager, CommerceReturn ret, PosSession session) {
        return !manager && (ret.getPosSessionId() == null || !ret.getPosSessionId().equals(session.getId()));
    }

    /** The credit left over after the new bill: money back to the buyer (0 when the bill takes it all). */
    static BigDecimal remainder(BigDecimal credit, BigDecimal total) {
        return credit == null || total == null ? ZERO : credit.subtract(total).max(ZERO);
    }

    /** Whether a cashier needs a PIN for the remainder paid back: above the refund limit, whatever the method. */
    static boolean remainderNeedsApproval(boolean manager, BigDecimal credit, BigDecimal total, BigDecimal limit) {
        return !manager && PosReturnService.aboveLimit(remainder(credit, total), limit);
    }

    // ================================================================== pricing

    /** One priced cart and what the cashier gave off it. */
    record Priced(CommerceOrderService.CartPrice price, BigDecimal cashierDiscount, BigDecimal gross) {
    }

    private Priced price(String instituteId, String locationId, Clean clean, Map<String, CartVariant> variants) {
        Map<String, BigDecimal> lineDiscounts = new LinkedHashMap<>();
        List<CartPriceRequest.Line> cartLines = new ArrayList<>();
        BigDecimal cashierDiscount = ZERO;
        for (CleanLine line : clean.lines()) {
            cartLines.add(CartPriceRequest.Line.builder().lineRef(line.lineRef()).variantId(line.variantId())
                    .quantity(line.quantity()).unitPrice(line.unitPrice()).build());
            if (line.lineDiscount() != null && line.lineDiscount().signum() > 0) {
                lineDiscounts.put(line.lineRef(), line.lineDiscount());
                cashierDiscount = cashierDiscount.add(line.lineDiscount());
            }
        }
        BigDecimal bill = billDiscountAmount(clean, variants);
        if (bill != null) {
            cashierDiscount = cashierDiscount.add(bill);
        }
        CartPriceRequest cart = CartPriceRequest.builder().lines(cartLines).paymentMethod(CartPriceRequest.PREPAID)
                .build();
        CommerceOrderService.CartPrice priced;
        try {
            priced = orderService.priceCart(instituteId, cart, null, new CommerceOrderService.CounterPricing(
                    locationId, lineDiscounts, bill, clean.discountReason()));
        } catch (CartPricingException e) {
            if (CartPricingException.CART_INVALID.equals(e.getCode())) {
                throw validation(e.getMessage());
            }
            throw new ConflictException(NOT_PRICEABLE + ": " + e.getMessage());
        }
        BigDecimal gross = priced.view().getTotals() == null || priced.view().getTotals().getSubtotal() == null ? ZERO
                : priced.view().getTotals().getSubtotal();
        return new Priced(priced, cashierDiscount, gross);
    }

    // ================================================================== quote

    /** {@code POST /pos/quote}: the price of a bill now; writes nothing, checks no stock. */
    public PosDtos.Quote quote(CustomUserDetails user, String instituteId, PosDtos.SaleRequest request) {
        Clean clean = validate(request, Kind.QUOTE, clock.today(instituteId));
        PosSession session = access.session(user, instituteId, clean.sessionId());
        Map<String, CartVariant> variants = variants(instituteId, clean);
        Priced priced = price(instituteId, session.getLocationId(), clean, variants);
        CartPriceDtos.CartPrice view = priced.price().view();
        PosSettingsService.Limits limits = settings.limits(instituteId);
        List<String> needs = new ArrayList<>();
        if (discountNeedsApproval(PosAccess.isManager(user), priced.cashierDiscount(), priced.gross(),
                limits.cashierDiscountPercent())) {
            needs.add(PosApprovalAction.POS_DISCOUNT.name());
        }
        BigDecimal credit = null;
        if (clean.exchange() != null) {
            CommerceExchangeService exchanges = exchangeProvider.getIfAvailable();
            if (exchanges != null) {
                CommerceReturn ret = readOnly.execute(tx -> exchanges.readReturn(instituteId,
                        clean.exchange().returnId()));
                access.requireAt(user, instituteId, PosAccess.TILL, ret.getLocationId());
                boolean usable = !exchangeNeedsApproval(PosAccess.isManager(user), ret, session);
                if (!usable && clean.approval() != null) {
                    // The manager's PIN lets the cashier see (and then spend, with the same PIN on the
                    // sale) the credit of a return not taken in this session.
                    PosDtos.Approval approval = clean.approval();
                    transaction.executeWithoutResult(tx -> approvalService.approve(instituteId,
                            session.getLocationId(), user.getUserId(), approval.approverUserId(), approval.pin(),
                            PosApprovalAction.POS_EXCHANGE.name(), "RETURN", ret.getId(), ret.getCreditTotal(),
                            clip(approval.reason(), 500)));
                    usable = true;
                }
                if (usable) {
                    credit = ret.getCreditTotal();
                    BigDecimal total = view.getTotals() == null ? null : view.getTotals().getTotal();
                    if (total != null && remainderNeedsApproval(PosAccess.isManager(user), credit, total,
                            limits.cashRefundLimit())) {
                        needs.add(PosApprovalAction.POS_CASH_REFUND.name());
                    }
                } else {
                    // Not the caller's to spend without a manager: no amount is told.
                    needs.add(PosApprovalAction.POS_EXCHANGE.name());
                }
            }
        }
        List<PosDtos.QuoteLine> lines = new ArrayList<>();
        for (CartPriceDtos.Line line : view.getLines() == null ? List.<CartPriceDtos.Line>of() : view.getLines()) {
            lines.add(new PosDtos.QuoteLine(line.getLineRef(), line.getVariantId(), line.getQuantity(),
                    line.getUnitPrice(), line.getGross(), line.getDiscount(), line.getNet(), line.getTaxableValue(),
                    line.getTaxRatePercent(), line.getTaxAmount()));
        }
        List<PosDtos.Unavailable> unavailable = new ArrayList<>();
        for (CartPriceDtos.UnavailableLine line : view.getUnavailable() == null
                ? List.<CartPriceDtos.UnavailableLine>of() : view.getUnavailable()) {
            unavailable.add(new PosDtos.Unavailable(line.getLineRef(), line.getReason()));
        }
        List<PosDtos.PriceChange> changes = new ArrayList<>();
        for (CartPriceDtos.Change change : view.getChanges() == null ? List.<CartPriceDtos.Change>of()
                : view.getChanges()) {
            changes.add(new PosDtos.PriceChange(change.getLineRef(), change.getVariantId(), change.getType(),
                    change.getReason(), change.getOldUnitPrice(), change.getNewUnitPrice()));
        }
        List<PosDtos.TaxRow> taxRows = new ArrayList<>();
        if (view.getTax() != null && view.getTax().getRows() != null) {
            for (CartPriceDtos.TaxRow row : view.getTax().getRows()) {
                taxRows.add(new PosDtos.TaxRow(row.getRatePercent(), row.getTaxableValue(), row.getCgst(),
                        row.getSgst(), row.getIgst(), row.getCess()));
            }
        }
        CartPriceDtos.Totals t = view.getTotals();
        BigDecimal discount = t == null ? ZERO : t.getDiscount();
        BigDecimal percent = priced.gross().signum() == 0 ? ZERO
                : discount.multiply(HUNDRED).divide(priced.gross(), 2, RoundingMode.HALF_UP);
        BigDecimal taxAmount = view.getTax() == null ? ZERO : view.getTax().getTaxAmount();
        return new PosDtos.Quote(lines, unavailable, changes,
                new PosDtos.Totals(t == null ? ZERO : t.getSubtotal(), discount, taxAmount,
                        t == null ? ZERO : t.getRoundOff(), t == null ? ZERO : t.getTotal()),
                taxRows, percent, limits.cashierDiscountPercent(), needs, credit);
    }

    // ================================================================== sale and bill-book entry

    /** {@code POST /pos/sales}. */
    public Outcome sale(CustomUserDetails user, String instituteId, PosDtos.SaleRequest request) {
        return place(user, instituteId, request, Kind.SALE);
    }

    /** {@code POST /pos/bill-book-entries}: a paper bill keyed in with its number and date. */
    public Outcome billBook(CustomUserDetails user, String instituteId, PosDtos.SaleRequest request) {
        return place(user, instituteId, request, Kind.BILL_BOOK);
    }

    /** Everything the transaction needs, resolved before it opens. */
    record Plan(String instituteId, Clean clean, Kind kind, PosSession session, PosRegister register,
                CartPriceSnapshot snapshot, Map<String, CartVariant> variants, String orderNumber, String hash,
                String userId, String actor, boolean manager, List<PosApprovalAction> approvals,
                BigDecimal cashierDiscount, BigDecimal refundLimit) {
    }

    private Outcome place(CustomUserDetails user, String instituteId, PosDtos.SaleRequest request, Kind kind) {
        LocalDate today = clock.today(instituteId);
        Clean clean = validate(request, kind, today);
        // 1. Before any transaction: the guard, the session, the replay, the price, the rules.
        PosSession session = access.session(user, instituteId, clean.sessionId());
        String hash = CommerceRequestGuard.hash(kind == Kind.SALE ? "POS_SALE" : "POS_BILL_BOOK",
                request.withoutApproval());
        // A retry of a bill that was made is answered first, even after the counter closed.
        CommerceOrder earlier = readOnly.execute(tx -> orderRepository
                .findByInstituteIdAndClientRequestId(instituteId, clean.clientRequestId()).orElse(null));
        if (earlier != null) {
            return replay(user, instituteId, earlier, hash);
        }
        if (!session.isOpen()) {
            throw new ConflictException(PosSessionService.SESSION_NOT_OPEN + ": this counter is closed");
        }
        PosRegister register = access.readRegister(instituteId, session.getRegisterId());
        if (!PosRegisterStatus.ACTIVE.name().equals(register.getStatus())) {
            throw new ConflictException(PosSessionService.REGISTER_INACTIVE + ": this register is not in use");
        }
        boolean manager = PosAccess.isManager(user);
        if (kind == Kind.BILL_BOOK) {
            if (!manager && clean.approval() == null) {
                throw PosSessionService.approvalRequired(PosApprovalAction.POS_BILL_BOOK,
                        "a paper bill is keyed in with a manager's PIN");
            }
            periodGuard.ifAvailable(guard -> guard.assertOpen(instituteId, clean.documentDate()));
        }
        Map<String, CartVariant> variants = variants(instituteId, clean);
        requirePieces(clean.lines(), variants);
        requireSteps(clean.lines(), variants);
        Priced priced = price(instituteId, session.getLocationId(), clean, variants);
        CommerceOrderService.CartPrice price = priced.price();
        if (price.view().getUnavailable() != null && !price.view().getUnavailable().isEmpty()) {
            List<String> refs = new ArrayList<>();
            price.view().getUnavailable().forEach(u -> refs.add(u.getLineRef() + " (" + u.getReason() + ")"));
            throw new ConflictException(CART_CHANGED + ": these lines cannot be sold as asked: "
                    + String.join(", ", refs));
        }
        if (price.view().getChanges() != null) {
            for (CartPriceDtos.Change change : price.view().getChanges()) {
                if (CommerceOrderService.CHANGE_PRICE.equals(change.getType())) {
                    throw new ConflictException(PRICE_CHANGED + ": line " + change.getLineRef() + " is now "
                            + change.getNewUnitPrice().toPlainString());
                }
            }
        }
        CartPriceSnapshot snapshot = price.snapshot();
        if (snapshot == null || snapshot.getTotal() == null || snapshot.getTotal().signum() <= 0) {
            throw new ConflictException(NOT_PRICEABLE + ": a bill with nothing to pay cannot be made");
        }
        // Every reason this sale needs a manager's PIN for; one PIN covers them all.
        PosSettingsService.Limits limits = settings.limits(instituteId);
        List<PosApprovalAction> approvals = new ArrayList<>();
        if (kind == Kind.BILL_BOOK) {
            // The manager's PIN on a paper bill approves the bill as a whole, its discounts included.
            if (!manager) {
                approvals.add(PosApprovalAction.POS_BILL_BOOK);
            }
        } else if (discountNeedsApproval(manager, priced.cashierDiscount(), priced.gross(),
                limits.cashierDiscountPercent())) {
            approvals.add(PosApprovalAction.POS_DISCOUNT);
        }
        BigDecimal total = snapshot.getTotal();
        BigDecimal received = clean.received();
        String why = null;
        if (clean.exchange() != null) {
            CommerceExchangeService exchanges = exchanges();
            CommerceReturn ret = readOnly.execute(tx -> exchanges.readReturn(instituteId, clean.exchange().returnId()));
            access.requireAt(user, instituteId, PosAccess.TILL, ret.getLocationId());
            if (received.compareTo(total) > 0) {
                throw tendersOver(received, total);
            }
            if (exchangeNeedsApproval(manager, ret, session)) {
                approvals.add(PosApprovalAction.POS_EXCHANGE);
                why = "the credit of a return not taken in this counter session is used with a manager's PIN";
            }
            // The remainder is decided again under the lock (the credit is read there); this is the early answer.
            if (clean.exchange().remainderMethod() != null
                    && remainderNeedsApproval(manager, ret.getCreditTotal(), total, limits.cashRefundLimit())) {
                approvals.add(PosApprovalAction.POS_CASH_REFUND);
                why = why != null ? why : "a refund of " + remainder(ret.getCreditTotal(), total).toPlainString()
                        + " is above the cashier's limit";
            }
        } else {
            requireTendersEqual(received, total);
        }
        if (!approvals.isEmpty() && clean.approval() == null) {
            PosApprovalAction first = approvals.get(0);
            throw PosSessionService.approvalRequired(first, first == PosApprovalAction.POS_BILL_BOOK
                    ? "a paper bill is keyed in with a manager's PIN"
                    : first == PosApprovalAction.POS_DISCOUNT ? "the discount "
                    + priced.cashierDiscount().toPlainString() + " is above the cashier's limit" : why);
        }

        // Remote, then the counter in its own short transaction: nothing is locked meanwhile.
        String userId;
        try {
            userId = clean.walkIn() ? walkIns.userId(instituteId)
                    : buyerResolver.resolve(instituteId, BuyerIdentity.PHONE_OTP, clean.phone(), clean.name(), null,
                    true).userId();
        } catch (CheckoutException e) {
            throw refusal(e);
        }
        String orderNumber = counterService.nextNumber(instituteId, CommerceOrderWriter.ORDER_COUNTER_SCOPE);
        Plan plan = new Plan(instituteId, clean, kind, session, register, snapshot, variants, orderNumber, hash,
                userId, user.getUserId(), manager, List.copyOf(approvals), priced.cashierDiscount(),
                limits.cashRefundLimit());

        // 2. One transaction.
        Written written;
        try {
            written = transaction.execute(status -> write(plan));
        } catch (RuntimeException e) {
            // A double tap, or a retry while the first request still ran: the first may have
            // committed while this one was refused on what the first changed (the exchange's
            // return already spent, a piece already sold) or on the client key. Answer its bill.
            CommerceOrder winner = readOnly.execute(tx -> orderRepository
                    .findByInstituteIdAndClientRequestId(instituteId, clean.clientRequestId()).orElse(null));
            if (winner != null) {
                return replay(user, instituteId, winner, hash);
            }
            if (e instanceof DataIntegrityViolationException) {
                if (kind == Kind.BILL_BOOK && isConstraint(e, INVOICE_NUMBER_CONSTRAINT)) {
                    throw new ConflictException(BILL_BOOK_NUMBER_USED + ": bill number " + clean.bookNumber()
                            + " has already been entered");
                }
                throw e;
            }
            if (e instanceof CheckoutException checkout) {
                throw refusal(checkout);
            }
            if (e instanceof ConflictException conflict) {
                throw stockRefusal(instituteId, plan, conflict);
            }
            throw e;
        }
        // 3. After the commit.
        if (written.exchangeRemainder() && clean.exchange() != null) {
            exchanges().executeRemainder(instituteId, written.orderId());
        }
        return new Outcome(answer(user, instituteId, written.orderId(), false), false);
    }

    /** What the sale transaction made. */
    record Written(String orderId, boolean exchangeRemainder) {
    }

    /** Steps 2.1 to 2.9 of the sale, inside its transaction. */
    Written write(Plan plan) {
        String instituteId = plan.instituteId();
        Clean clean = plan.clean();
        PosSession session = plan.session();
        String locationId = session.getLocationId();
        String actor = plan.actor();
        CartPriceSnapshot snapshot = plan.snapshot();

        // 2.1 The exchange's old order and return, before anything of the new order is written.
        CommerceExchangeService.Locked exchange = null;
        List<CommerceOrderWriter.PosTender> tenders = new ArrayList<>();
        if (clean.exchange() != null) {
            exchange = exchanges().lock(instituteId, clean.exchange());
            BigDecimal total = snapshot.getTotal();
            BigDecimal applied = CommerceExchangeService.applied(exchange.credit(), total);
            requireTendersEqual(clean.received().add(applied), total);
            CommerceExchangeService.requireRemainder(clean.exchange(), exchange.credit(), total);
            tenders.add(new CommerceOrderWriter.PosTender(TenderMode.CREDIT_NOTE.name(), applied,
                    exchange.creditNoteNumber(), null));
        }
        for (CleanTender tender : clean.tenders()) {
            tenders.add(new CommerceOrderWriter.PosTender(tender.mode().name(), tender.amount(), tender.reference(),
                    tender.cashTendered()));
        }

        // 2.2 The order (header flushed first).
        String customerId = clean.walkIn() ? null
                : customerService.findOrCreateUnverified(instituteId, clean.phone()).getId();
        String name = clean.name() != null ? clean.name() : clean.buyerLegalName();
        CommerceOrderWriter.Written written = writer.writePos(new CommerceOrderWriter.PosNewOrder(instituteId,
                plan.orderNumber(), clean.clientRequestId(), plan.hash(), plan.userId(), customerId, actor,
                clean.phone(), name, clean.buyerGstin(), snapshot, session.getId(), locationId,
                plan.kind() == Kind.BILL_BOOK ? clean.documentDate() : clock.today(instituteId), tenders));
        CommerceOrder order = written.order();
        if (exchange != null) {
            order.setExchangeOfOrderId(exchange.oldOrder().getId());
            order = orderRepository.save(order);
        }

        // 2.3 The PIN (a remote role check), before the session, stock and series locks: one
        // approval row per reason, all by the one PIN. The remainder is decided here, on the
        // credit read under the lock.
        List<PosApprovalAction> reasons = new ArrayList<>(plan.approvals());
        BigDecimal rest = exchange == null ? ZERO : remainder(exchange.credit(), snapshot.getTotal());
        if (exchange != null && clean.exchange().remainderMethod() != null && !reasons.contains(
                PosApprovalAction.POS_CASH_REFUND) && remainderNeedsApproval(plan.manager(), exchange.credit(),
                snapshot.getTotal(), plan.refundLimit())) {
            if (clean.approval() == null) {
                throw PosSessionService.approvalRequired(PosApprovalAction.POS_CASH_REFUND, "a refund of "
                        + rest.toPlainString() + " is above the cashier's limit");
            }
            reasons.add(PosApprovalAction.POS_CASH_REFUND);
        }
        String approver = null;
        for (PosApprovalAction reason : reasons) {
            PosDtos.Approval approval = clean.approval();
            BigDecimal amount = switch (reason) {
                case POS_DISCOUNT -> plan.cashierDiscount();
                case POS_EXCHANGE -> exchange == null ? order.getTotal() : exchange.credit();
                case POS_CASH_REFUND -> rest;
                default -> order.getTotal();
            };
            approvalService.approve(instituteId, locationId, actor, approval.approverUserId(), approval.pin(),
                    reason.name(), "ORDER", order.getId(), amount, clip(approval.reason(), 500));
            approver = approval.approverUserId();
        }

        // 2.4 The session FOR SHARE: a close waits for this sale.
        PosSession locked = sessionRepository.lockForShare(instituteId, session.getId())
                .orElseThrow(() -> new IllegalStateException("session disappeared"));
        if (entityManager != null) {
            entityManager.refresh(locked);
        }
        if (!locked.isOpen() || (!plan.manager() && !actor.equals(locked.getCashierUserId()))) {
            throw new ConflictException(PosSessionService.SESSION_NOT_OPEN + ": this counter is closed");
        }

        // 2.5 Stock: one ledger call in lock order; pieces linked; cost; closed SOLD hold rows.
        List<CommerceOrderLine> lines = written.lines();
        Map<String, CleanLine> askedByRef = new HashMap<>();
        clean.lines().forEach(l -> askedByRef.put(l.lineRef(), l));
        List<StockPosting> postings = new ArrayList<>();
        List<CommerceOrderLine> tracked = new ArrayList<>();
        for (CommerceOrderLine line : CommerceOrderDeskService.items(lines)) {
            CartVariant variant = plan.variants().get(line.getPackageSessionId());
            if (variant == null || !variant.tracked()) {
                continue;
            }
            tracked.add(line);
            CleanLine asked = askedByRef.get(line.getLineRef());
            if (variant.piece()) {
                for (String pieceId : asked.pieceIds()) {
                    postings.add(posting(instituteId, locationId, line, -1, pieceId,
                            "POS_SALE:" + line.getId() + ":" + pieceId, actor, plan.kind() == Kind.BILL_BOOK));
                }
            } else {
                postings.add(posting(instituteId, locationId, line, -line.getQuantity(), null,
                        "POS_SALE:" + line.getId(), actor, plan.kind() == Kind.BILL_BOOK));
            }
        }
        List<StockPostResult> results = postings.isEmpty() ? List.of() : ledger.postAll(postings);
        Map<String, List<StockPostResult>> resultsByLine = new HashMap<>();
        for (StockPostResult result : results) {
            if (result.movement() != null) {
                resultsByLine.computeIfAbsent(result.movement().getReferenceId(), k -> new ArrayList<>()).add(result);
                if (plan.kind() == Kind.BILL_BOOK && result.sellableShortfall() > 0) {
                    stockShortFlagger.afterCommit(instituteId, locationId, result.movement().getPackageSessionId(),
                            result.sellableShortfall());
                }
            }
        }
        for (CommerceOrderLine line : tracked) {
            CleanLine asked = askedByRef.get(line.getLineRef());
            for (String pieceId : asked.pieceIds()) {
                if (pieceRepository.linkSoldToLine(instituteId, pieceId, line.getId()) != 1) {
                    throw new ConflictException(PIECE_STATE + ": a piece of line " + line.getLineRef()
                            + " could not be named for the bill");
                }
            }
            if (asked.pieceIds().size() == 1 && line.getQuantity() == 1) {
                line.setPieceId(asked.pieceIds().get(0));
            }
            line.setCostTotal(costTotal(resultsByLine.get(line.getId())));
            stockHoldService.recordSold(instituteId, line.getPackageSessionId(), plan.userId(), line.getUserPlanId(),
                    order.getPrimaryPaymentLogId(), line.getQuantity(), locationId);
            stockHoldService.closeWithoutGiveBack(line.getUserPlanId(), line.getPackageSessionId(),
                    HOLD_REASON_POS_SALE);
        }

        // 2.6 The exchange's refunds on the old order.
        boolean remainder = false;
        if (exchange != null) {
            // The remainder refund (money out of this drawer) is stamped with the session.
            remainder = exchanges().apply(exchange, order, clean.exchange(), actor, session.getId()) != null;
        }

        // 2.7 Paid: logs PAID, plans ACTIVE; the lines with their cost and piece. The logs were put
        // in the order's payment group by a native update; a copy held by this persistence context
        // still lacks the group (no stock hold cleared the context, as on a staff order), and the
        // payment code tells a commerce log by its group: read them again first.
        refreshPaymentLogs(lines);
        staffOrders.settlePaid(order, lines);
        lines = lineRepository.saveAll(lines);

        // 2.8 The document, last: its number is taken under the series row lock.
        List<CommerceInvoiceLineExtra> extras = new ArrayList<>();
        List<String> logIds = new ArrayList<>();
        for (CommerceOrderLine line : CommerceOrderDeskService.items(lines)) {
            extras.add(CommerceInvoiceLineExtra.builder().lineRef(line.getLineRef()).sku(line.getSkuSnapshot())
                    .packageSessionId(line.getPackageSessionId()).pieceId(line.getPieceId()).build());
            if (StringUtils.hasText(line.getPaymentLogId())) {
                logIds.add(line.getPaymentLogId());
            }
        }
        invoiceService.issue(instituteId, CommerceInvoiceRequest.builder()
                .commerceOrderId(order.getId())
                .orderNumber(order.getOrderNumber())
                .channel(CommerceOrderWriter.CHANNEL_POS)
                .locationId(locationId)
                .registerId(plan.register().getId())
                .userId(order.getUserId())
                .buyerName(clean.buyerGstin() != null ? clean.buyerLegalName() : order.getCustomerName())
                .buyerPhone(order.getCustomerPhone())
                .buyerGstin(order.getBuyerGstin())
                .billingAddress(null)
                .documentDate(order.getDocumentDate())
                .currency(order.getCurrency())
                .tax(snapshot.getTax())
                .lineExtras(extras)
                .paymentLogIds(logIds)
                .externalInvoiceNumber(plan.kind() == Kind.BILL_BOOK ? clean.bookNumber() : null)
                .actorUserId(actor)
                .build());

        // 2.9 Audit, the books' hook and the buyer's message after the commit.
        Map<String, Object> detail = new LinkedHashMap<>();
        detail.put("order_number", order.getOrderNumber());
        detail.put("total", order.getTotal().toPlainString());
        detail.put("tender_modes", tenders.stream().map(CommerceOrderWriter.PosTender::mode).distinct().toList());
        detail.put("session_id", session.getId());
        if (plan.kind() == Kind.BILL_BOOK) {
            detail.put("book_number", clean.bookNumber());
            detail.put("document_date", clean.documentDate().toString());
            detail.put("approved_by", approver);
        }
        auditService.record(instituteId, actor, locationId, plan.kind() == Kind.BILL_BOOK ? "POS_BILL_BOOK_ENTRY"
                : "POS_SALE", "ORDER", order.getId(), null, CommerceInputRules.json(detail), null);
        if (plan.cashierDiscount() != null && plan.cashierDiscount().signum() > 0) {
            Map<String, Object> discount = new LinkedHashMap<>();
            discount.put("amount", plan.cashierDiscount().toPlainString());
            discount.put("approved_by", approver);
            auditService.record(instituteId, actor, locationId, "DISCOUNT", "ORDER", order.getId(), null,
                    CommerceInputRules.json(discount), clean.discountReason());
        }
        for (CommerceOrderTender tender : tenderRepository.findByOrderIdOrderByCreatedAtAsc(order.getId())) {
            if (CommerceOrderTender.STATUS_RECEIVED.equals(tender.getStatus())) {
                String orderId = order.getId();
                String tenderId = tender.getId();
                String mode = tender.getMode();
                BigDecimal amount = tender.getAmount();
                desk.afterCommitMoney(hook -> hook.tenderReceived(instituteId, orderId, tenderId, mode, amount));
            }
        }
        if (plan.kind() == Kind.SALE) {
            events.afterCommit(desk.event(CommerceOrderEvents.POS_BILL_ISSUED, order, null,
                    clean.notifyBuyer() && order.getCustomerPhone() != null));
        }
        log.info("POS {} {} ({}) at session {}: {} line(s), total {} {}", plan.kind() == Kind.BILL_BOOK
                        ? "bill-book entry" : "sale", order.getOrderNumber(), order.getId(), session.getId(),
                CommerceOrderDeskService.items(lines).size(), order.getTotal(), order.getCurrency());
        return new Written(order.getId(), remainder);
    }

    private void refreshPaymentLogs(List<CommerceOrderLine> lines) {
        if (entityManager == null) {
            return;
        }
        entityManager.flush();
        for (CommerceOrderLine line : lines) {
            if (!StringUtils.hasText(line.getPaymentLogId())) {
                continue;
            }
            PaymentLog paymentLog = entityManager.find(PaymentLog.class, line.getPaymentLogId());
            if (paymentLog != null) {
                entityManager.refresh(paymentLog);
            }
        }
    }

    private static StockPosting posting(String instituteId, String locationId, CommerceOrderLine line, int delta,
                                        String pieceId, String key, String actor, boolean allowShortfall) {
        return StockPosting.builder()
                .instituteId(instituteId)
                .locationId(locationId)
                .packageSessionId(line.getPackageSessionId())
                .pieceId(pieceId)
                .type(StockMovementType.POS_SALE)
                .quantityDelta(delta)
                .referenceType("ORDER_LINE")
                .referenceId(line.getId())
                .actorUserId(actor)
                .idempotencyKey(key)
                .allowShortfall(allowShortfall)
                .build();
    }

    /** Σ unit cost × units of the line's movements, to the paisa; null when one has no cost. */
    static BigDecimal costTotal(List<StockPostResult> results) {
        if (results == null || results.isEmpty()) {
            return null;
        }
        BigDecimal total = BigDecimal.ZERO;
        for (StockPostResult result : results) {
            if (result.movement() == null || result.movement().getUnitCost() == null) {
                return null;
            }
            total = total.add(result.movement().getUnitCost()
                    .multiply(BigDecimal.valueOf(Math.abs(result.movement().getQuantityDelta()))));
        }
        return total.setScale(2, RoundingMode.HALF_UP);
    }

    // ================================================================== answers and refusals

    /** The unique number of an invoice (V432): a paper bill number entered twice at once. */
    static final String INVOICE_NUMBER_CONSTRAINT = "uq_invoice_institute_number";

    /** Whether {@code e} (or a cause) names the database constraint {@code name}. */
    static boolean isConstraint(Throwable e, String name) {
        for (Throwable t = e; t != null; t = t.getCause() == t ? null : t.getCause()) {
            if (t instanceof org.hibernate.exception.ConstraintViolationException violation
                    && violation.getConstraintName() != null
                    && violation.getConstraintName().toLowerCase(java.util.Locale.ROOT).contains(name)) {
                return true;
            }
            String message = t.getMessage();
            if (message != null && message.contains("\"" + name + "\"")) {
                return true;
            }
        }
        return false;
    }

    private Outcome replay(CustomUserDetails user, String instituteId, CommerceOrder earlier, String hash) {
        if (!hash.equals(earlier.getRequestHash()) || !CommerceOrderWriter.CHANNEL_POS.equals(earlier.getChannel())) {
            throw new ConflictException(CommerceRequestGuard.IDEMPOTENCY_MISMATCH
                    + ": client_request_id was already used for another request");
        }
        access.requireAt(user, instituteId, PosAccess.TILL, earlier.getFulfilmentLocationId());
        return new Outcome(answer(user, instituteId, earlier.getId(), true), true);
    }

    private PosDtos.SaleAnswer answer(CustomUserDetails user, String instituteId, String orderId, boolean replayed) {
        return new PosDtos.SaleAnswer(receipts.saleDetail(user, instituteId, orderId),
                receipts.receipt(instituteId, orderId), replayed);
    }

    /**
     * A stock refusal named for the till: units in an online checkout (until when), sold online,
     * or a piece packed for an online order. Everything else passes through with its code.
     */
    private RuntimeException stockRefusal(String instituteId, Plan plan, ConflictException e) {
        String message = e.getMessage() == null ? "" : e.getMessage();
        if (message.startsWith(SOLD_ONLINE)) {
            for (CleanLine line : plan.clean().lines()) {
                CartVariant variant = plan.variants().get(line.variantId());
                if (variant == null || !variant.tracked()) {
                    continue;
                }
                PosReadRepository.HeldOnline held = readOnly.execute(tx -> readRepository.heldOnline(instituteId,
                        line.variantId()));
                if (held != null && held.quantity() > 0) {
                    return new ConflictException(IN_ONLINE_CHECKOUT + ": " + variant.sku()
                            + " is in an online checkout until " + PosSessionService.hhmm(held.until()));
                }
            }
            for (CleanLine line : plan.clean().lines()) {
                CartVariant variant = plan.variants().get(line.variantId());
                if (variant == null || !variant.tracked()) {
                    continue;
                }
                Integer available = readOnly.execute(tx -> readRepository.availableOnline(line.variantId()));
                if (available != null && available < line.quantity()) {
                    return new ConflictException(SOLD_ONLINE + ": " + variant.sku()
                            + " is sold online and awaits dispatch");
                }
            }
            return e;
        }
        if (message.startsWith(PIECE_STATE)) {
            for (CleanLine line : plan.clean().lines()) {
                for (String pieceId : line.pieceIds()) {
                    CommercePieceRepository.PieceRow piece = readOnly.execute(tx -> pieceRepository
                            .findRow(instituteId, pieceId).orElse(null));
                    if (piece != null && "RESERVED".equals(piece.getStatus())) {
                        return new ConflictException(SOLD_ONLINE + ": piece " + piece.getCode()
                                + " is packed for an online order");
                    }
                }
            }
        }
        return e;
    }

    private static void requireTendersEqual(BigDecimal received, BigDecimal total) {
        if (received.compareTo(total) > 0) {
            throw tendersOver(received, total);
        }
        if (received.compareTo(total) < 0) {
            throw new InvalidRequestException(TENDERS_SHORT + ": " + total.subtract(received).toPlainString()
                    + " is not paid (total " + total.toPlainString() + ", received " + received.toPlainString() + ")");
        }
    }

    private static InvalidRequestException tendersOver(BigDecimal received, BigDecimal total) {
        return new InvalidRequestException(TENDERS_OVER + ": the money received (" + received.toPlainString()
                + ") is more than the bill total (" + total.toPlainString() + ")");
    }

    private Map<String, CartVariant> variants(String instituteId, Clean clean) {
        Set<String> ids = new LinkedHashSet<>();
        clean.lines().forEach(l -> ids.add(l.variantId()));
        return variantLoader.cartVariants(instituteId, ids, Set.of());
    }

    private CommerceExchangeService exchanges() {
        CommerceExchangeService exchanges = exchangeProvider.getIfAvailable();
        if (exchanges == null) {
            throw new ConflictException(CommerceExchangeService.EXCHANGE_NOT_AVAILABLE + ": exchanges are not "
                    + "available");
        }
        return exchanges;
    }

    /** A checkout refusal (buyer account, changed cart) as the counter's error: the message starts with the code. */
    static VacademyException refusal(CheckoutException e) {
        HttpStatus status = e.getStatus() == null ? HttpStatus.CONFLICT : e.getStatus();
        String code = CheckoutException.CART_CHANGED.equals(e.getCode()) ? CART_CHANGED : e.getCode();
        return new VacademyException(status, code + ": " + e.getMessage());
    }

    static String text(String raw, String field, int max) {
        if (raw == null || raw.isBlank()) {
            return null;
        }
        String value = raw.trim();
        if (value.length() > max) {
            throw validation(field + " is at most " + max + " characters");
        }
        return value;
    }

    private static String clip(String value, int max) {
        if (value == null || value.isBlank()) {
            return null;
        }
        String v = value.trim();
        return v.length() <= max ? v : v.substring(0, max);
    }

    static InvalidRequestException validation(String message) {
        return new InvalidRequestException("VALIDATION: " + message);
    }
}
