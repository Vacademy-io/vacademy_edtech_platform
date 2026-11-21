package vacademy.io.admin_core_service.features.commerce.pos.service;

import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import vacademy.io.admin_core_service.features.commerce.document.dto.CommerceInvoiceSnapshot;
import vacademy.io.admin_core_service.features.commerce.document.service.AmountInWords;
import vacademy.io.admin_core_service.features.commerce.document.service.CommerceInvoiceService;
import vacademy.io.admin_core_service.features.commerce.order.checkout.CommerceOrderWriter;
import vacademy.io.admin_core_service.features.commerce.order.entity.CommerceOrder;
import vacademy.io.admin_core_service.features.commerce.order.entity.CommerceOrderLine;
import vacademy.io.admin_core_service.features.commerce.order.entity.CommerceOrderTender;
import vacademy.io.admin_core_service.features.commerce.order.enums.TenderMode;
import vacademy.io.admin_core_service.features.commerce.order.repository.CommerceOrderLineRepository;
import vacademy.io.admin_core_service.features.commerce.order.repository.CommerceOrderRepository;
import vacademy.io.admin_core_service.features.commerce.order.repository.CommerceOrderTenderRepository;
import vacademy.io.admin_core_service.features.commerce.pos.dto.PosDtos;
import vacademy.io.admin_core_service.features.commerce.pos.entity.PosRegister;
import vacademy.io.admin_core_service.features.commerce.pos.entity.PosSession;
import vacademy.io.admin_core_service.features.commerce.pos.repository.PosReadRepository;
import vacademy.io.admin_core_service.features.commerce.pos.repository.PosRegisterRepository;
import vacademy.io.admin_core_service.features.commerce.pos.repository.PosSessionRepository;
import vacademy.io.admin_core_service.features.commerce.returns.entity.CommerceReturn;
import vacademy.io.admin_core_service.features.commerce.returns.repository.CommerceReturnRepository;
import vacademy.io.admin_core_service.features.commerce.security.CommerceAccessDeniedException;
import vacademy.io.admin_core_service.features.commerce.stock.entity.StockLocation;
import vacademy.io.admin_core_service.features.commerce.stock.repository.CommercePieceRepository;
import vacademy.io.admin_core_service.features.commerce.stock.repository.StockLocationRepository;
import vacademy.io.admin_core_service.features.commerce.tax.calc.TaxRateRow;
import vacademy.io.admin_core_service.features.institute.repository.InstituteRepository;
import vacademy.io.admin_core_service.features.invoice.entity.Invoice;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.VacademyException;
import vacademy.io.common.institute.entity.Institute;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.sql.Timestamp;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;

/**
 * What a counter bill shows: the receipt (80 mm print) and the sale detail (bills list, void,
 * returns). Built from the order, its tenders and its document; read-only, and no cost is ever
 * read. The receipt route lets anyone at a till of the bill's location reprint it, also after
 * the session closed.
 */
@Service
public class PosReceiptService {

    public static final String ACTION_VOID = "VOID";
    public static final String ACTION_CHANGE_TENDER = "CHANGE_TENDER";
    public static final String ACTION_RETURN = "RETURN";
    private static final BigDecimal ZERO = BigDecimal.ZERO.setScale(2);

    private final PosAccess access;
    private final CommerceOrderRepository orderRepository;
    private final CommerceOrderLineRepository lineRepository;
    private final CommerceOrderTenderRepository tenderRepository;
    private final PosReadRepository readRepository;
    private final PosSessionRepository sessionRepository;
    private final PosRegisterRepository registerRepository;
    private final StockLocationRepository locationRepository;
    private final CommercePieceRepository pieceRepository;
    private final CommerceReturnRepository returnRepository;
    private final CommerceInvoiceService invoiceService;
    private final InstituteRepository instituteRepository;
    private final TransactionTemplate readOnly;

    @PersistenceContext
    private EntityManager entityManager;

    public PosReceiptService(PosAccess access, CommerceOrderRepository orderRepository,
                             CommerceOrderLineRepository lineRepository, CommerceOrderTenderRepository tenderRepository,
                             PosReadRepository readRepository, PosSessionRepository sessionRepository,
                             PosRegisterRepository registerRepository, StockLocationRepository locationRepository,
                             CommercePieceRepository pieceRepository, CommerceReturnRepository returnRepository,
                             CommerceInvoiceService invoiceService, InstituteRepository instituteRepository,
                             PlatformTransactionManager transactionManager) {
        this.access = access;
        this.orderRepository = orderRepository;
        this.lineRepository = lineRepository;
        this.tenderRepository = tenderRepository;
        this.readRepository = readRepository;
        this.sessionRepository = sessionRepository;
        this.registerRepository = registerRepository;
        this.locationRepository = locationRepository;
        this.pieceRepository = pieceRepository;
        this.returnRepository = returnRepository;
        this.invoiceService = invoiceService;
        this.instituteRepository = instituteRepository;
        this.readOnly = new TransactionTemplate(transactionManager);
        this.readOnly.setReadOnly(true);
    }

    /** {@code GET /pos/sales/{orderId}/receipt}: TILL at the bill's location, or an ADMIN. */
    public PosDtos.Receipt receipt(CustomUserDetails user, String instituteId, String orderId) {
        CommerceOrder order = readPosOrder(instituteId, orderId);
        access.requireAt(user, instituteId, PosAccess.TILL, order.getFulfilmentLocationId());
        return receipt(instituteId, order.getId());
    }

    /** A POS order of the institute, read now; 404 ORDER_NOT_FOUND for anything else. */
    public CommerceOrder readPosOrder(String instituteId, String orderId) {
        CommerceOrder order = orderId == null || orderId.isBlank() ? null : readOnly.execute(tx -> {
            CommerceOrder found = orderRepository.findByIdAndInstituteId(orderId.trim(), instituteId).orElse(null);
            if (found != null && entityManager != null) {
                entityManager.refresh(found);
            }
            return found;
        });
        if (order == null || !CommerceOrderWriter.CHANNEL_POS.equals(order.getChannel())) {
            throw new VacademyException(HttpStatus.NOT_FOUND, "ORDER_NOT_FOUND: no such counter bill");
        }
        return order;
    }

    // ================================================================== receipt

    /** The receipt of a POS order, without an access check. */
    public PosDtos.Receipt receipt(String instituteId, String orderId) {
        return readOnly.execute(tx -> {
            CommerceOrder order = orderRepository.findByIdAndInstituteId(orderId, instituteId).orElseThrow();
            if (entityManager != null) {
                entityManager.refresh(order);
            }
            List<CommerceOrderLine> lines = lineRepository.findByOrderIdOrderByLineNoAsc(order.getId());
            List<CommerceOrderTender> tenders = tenderRepository.findByOrderIdOrderByCreatedAtAsc(order.getId());
            Invoice invoice = document(instituteId, order.getId());
            CommerceInvoiceSnapshot snapshot = invoice == null ? null : CommerceInvoiceService.readSnapshot(invoice);
            Institute institute = instituteRepository.findById(instituteId).orElse(null);
            StockLocation location = order.getFulfilmentLocationId() == null ? null
                    : locationRepository.findByInstituteIdAndId(instituteId, order.getFulfilmentLocationId())
                    .orElse(null);
            PosRegister register = registerOf(instituteId, order.getPosSessionId());

            PosDtos.ReceiptShop shop = new PosDtos.ReceiptShop(
                    institute == null ? null : institute.getInstituteName(),
                    snapshot == null ? null : snapshot.getSellerLegalName(),
                    invoice == null ? null : invoice.getSellerGstin(),
                    addressLines(snapshot == null ? null : snapshot.getSellerAddress()),
                    institute == null ? null : institute.getMobileNumber());
            PosDtos.ReceiptDocument document = invoice == null ? null : new PosDtos.ReceiptDocument(
                    invoice.getDocumentType(), invoice.getInvoiceNumber(), invoice.getDocumentDate(),
                    invoice.getInvoiceDate() == null ? null : Timestamp.valueOf(invoice.getInvoiceDate()),
                    invoice.getCancelledAt() != null, invoice.getCancelReason(),
                    invoice.getExternalInvoiceNumber() != null);
            boolean walkIn = order.getCustomerPhone() == null && order.getCustomerName() == null
                    && order.getBuyerGstin() == null;
            PosDtos.ReceiptCustomer customer = walkIn ? null : new PosDtos.ReceiptCustomer(order.getCustomerName(),
                    PosReadRepository.last4(order.getCustomerPhone()), order.getBuyerGstin(),
                    order.getBuyerGstin() != null && snapshot != null ? snapshot.getBuyerName() : null);

            List<PosDtos.ReceiptLine> receiptLines = new ArrayList<>();
            for (CommerceOrderLine line : lines) {
                if (!CommerceOrderLine.TYPE_ITEM.equals(line.getLineType())) {
                    continue;
                }
                receiptLines.add(new PosDtos.ReceiptLine(line.getNameSnapshot(), line.getVariantLabel(),
                        line.getQuantity(), line.getQtyScale() == null ? 1 : line.getQtyScale(), line.getUnit(),
                        line.getUnitPrice(), line.getDiscount(), line.getLineTotal(), line.getHsnCode(),
                        line.getTaxRate()));
            }
            List<PosDtos.ReceiptTender> receiptTenders = new ArrayList<>();
            BigDecimal cashTendered = null;
            BigDecimal change = null;
            for (CommerceOrderTender tender : tenders) {
                receiptTenders.add(new PosDtos.ReceiptTender(tender.getMode(), tender.getAmount(),
                        tender.getReference(), tender.getStatus()));
                if (TenderMode.CASH.name().equals(tender.getMode())
                        && CommerceOrderTender.STATUS_RECEIVED.equals(tender.getStatus())
                        && tender.getCashTendered() != null) {
                    cashTendered = tender.getCashTendered();
                    change = tender.getCashTendered().subtract(tender.getAmount()).max(ZERO);
                }
            }
            return new PosDtos.Receipt(shop,
                    location == null ? null : new PosDtos.ReceiptLocation(location.getName(), location.getStateCode()),
                    register == null ? null : new PosDtos.NamedRef(register.getCode(), register.getName()),
                    document, order.getOrderNumber(), customer, receiptLines,
                    snapshot == null || snapshot.getTax() == null ? List.of() : taxRows(snapshot.getTax().getRateRows()),
                    new PosDtos.Totals(order.getSubtotal(), order.getDiscount(), order.getTax(), order.getRoundOff(),
                            order.getTotal()),
                    AmountInWords.rupees(order.getTotal()), receiptTenders, cashTendered, change,
                    invoice == null ? null : invoice.getInvoiceNumber());
        });
    }

    /** The order's document: the live one, else the newest (a voided bill's cancelled document). */
    private Invoice document(String instituteId, String orderId) {
        List<PosReadRepository.InvoiceFact> found = readRepository.invoicesOf(instituteId, List.of(orderId));
        PosReadRepository.InvoiceFact pick = null;
        for (PosReadRepository.InvoiceFact invoice : found) {
            if (!invoice.cancelled()) {
                pick = invoice;
            }
        }
        if (pick == null && !found.isEmpty()) {
            pick = found.get(found.size() - 1);
        }
        return pick == null ? null : invoiceService.requireDocument(instituteId, pick.id());
    }

    private PosRegister registerOf(String instituteId, String sessionId) {
        if (sessionId == null) {
            return null;
        }
        PosSession session = sessionRepository.findByInstituteIdAndId(instituteId, sessionId).orElse(null);
        return session == null ? null
                : registerRepository.findByInstituteIdAndId(instituteId, session.getRegisterId()).orElse(null);
    }

    static List<String> addressLines(String address) {
        List<String> out = new ArrayList<>();
        if (address == null || address.isBlank()) {
            return out;
        }
        for (String part : address.split("\\n|, ")) {
            if (!part.isBlank()) {
                out.add(part.trim());
            }
        }
        return out;
    }

    /** Tax rows by rate (rows of one rate with several HSN codes added together). */
    static List<PosDtos.TaxRow> taxRows(List<TaxRateRow> rows) {
        Map<BigDecimal, BigDecimal[]> byRate = new TreeMap<>();
        if (rows != null) {
            for (TaxRateRow row : rows) {
                BigDecimal rate = row.getRatePercent() == null ? ZERO : row.getRatePercent().stripTrailingZeros();
                BigDecimal[] sums = byRate.computeIfAbsent(rate, r -> new BigDecimal[]{ZERO, ZERO, ZERO, ZERO, ZERO});
                sums[0] = sums[0].add(nz(row.getTaxableValue()));
                sums[1] = sums[1].add(nz(row.getCgst()));
                sums[2] = sums[2].add(nz(row.getSgst()));
                sums[3] = sums[3].add(nz(row.getIgst()));
                sums[4] = sums[4].add(nz(row.getCess()));
            }
        }
        List<PosDtos.TaxRow> out = new ArrayList<>();
        byRate.forEach((rate, s) -> out.add(new PosDtos.TaxRow(rate, s[0], s[1], s[2], s[3], s[4])));
        return out;
    }

    // ================================================================== sale detail

    /** The sale detail of a POS order with the caller's next actions; no access check here. */
    public PosDtos.SaleDetail saleDetail(CustomUserDetails user, String instituteId, String orderId) {
        record Read(CommerceOrder order, PosSession session, PosDtos.SaleDetail detail, int returnableUnits) {
        }
        Read read = readOnly.execute(tx -> {
            CommerceOrder order = orderRepository.findByIdAndInstituteId(orderId, instituteId).orElseThrow();
            if (entityManager != null) {
                entityManager.refresh(order);
            }
            PosSession session = order.getPosSessionId() == null ? null
                    : sessionRepository.findByInstituteIdAndId(instituteId, order.getPosSessionId()).orElse(null);
            if (session != null && entityManager != null) {
                entityManager.refresh(session);
            }
            List<CommerceOrderLine> lines = lineRepository.findByOrderIdOrderByLineNoAsc(order.getId());
            List<CommerceOrderTender> tenders = tenderRepository.findByOrderIdOrderByCreatedAtAsc(order.getId());
            Invoice invoice = document(instituteId, order.getId());
            List<PosDtos.SaleDetailLine> outLines = new ArrayList<>();
            int returnableUnits = 0;
            for (CommerceOrderLine line : lines) {
                if (!CommerceOrderLine.TYPE_ITEM.equals(line.getLineType())) {
                    continue;
                }
                List<String> pieceIds = new ArrayList<>();
                List<String> pieceCodes = new ArrayList<>();
                for (CommercePieceRepository.PieceRow piece : pieceRepository.findRowsByOrderLine(instituteId,
                        line.getId())) {
                    pieceIds.add(piece.getId());
                    pieceCodes.add(piece.getCode());
                }
                int returned = line.getQtyReturned() == null ? 0 : line.getQtyReturned();
                int shipped = line.getQtyShipped() == null ? 0 : line.getQtyShipped();
                int returnable = Math.max(0, shipped - returned - (int) returnRepository.openQuantity(line.getId()));
                returnableUnits += returnable;
                outLines.add(new PosDtos.SaleDetailLine(line.getId(), line.getLineNo(), line.getPackageSessionId(),
                        line.getSkuSnapshot(), line.getNameSnapshot(), line.getVariantLabel(), line.getUnit(),
                        line.getQtyScale() == null ? 1 : line.getQtyScale(), line.getQuantity(), line.getUnitPrice(),
                        line.getMrp(), line.getDiscount(), line.getTaxableValue(), line.getTaxRate(),
                        line.getTaxAmount(), line.getLineTotal(), pieceIds, pieceCodes, returned, returnable));
            }
            List<PosDtos.SaleTender> outTenders = new ArrayList<>();
            BigDecimal change = ZERO;
            for (CommerceOrderTender tender : tenders) {
                outTenders.add(new PosDtos.SaleTender(tender.getId(), tender.getMode(), tender.getAmount(),
                        tender.getReference(), tender.getStatus(), tender.getCashTendered()));
                if (TenderMode.CASH.name().equals(tender.getMode())
                        && CommerceOrderTender.STATUS_RECEIVED.equals(tender.getStatus())
                        && tender.getCashTendered() != null) {
                    change = change.add(tender.getCashTendered().subtract(tender.getAmount()).max(ZERO));
                }
            }
            List<PosDtos.SaleReturn> returns = new ArrayList<>();
            for (CommerceReturn ret : returnRepository.findByOrderIdOrderByCreatedAtAsc(order.getId())) {
                returns.add(new PosDtos.SaleReturn(ret.getId(), ret.getReturnNumber(), ret.getStatus(),
                        ret.getCreditTotal()));
            }
            PosDtos.DocumentRef document = invoice == null ? null : new PosDtos.DocumentRef(invoice.getId(),
                    invoice.getInvoiceNumber(), invoice.getDocumentType(), invoice.getDocumentDate(),
                    invoice.getCancelledAt() != null);
            PosDtos.SaleDetail detail = new PosDtos.SaleDetail(order.getId(), order.getOrderNumber(),
                    order.getChannel(), order.getStatus(), order.getPosSessionId(),
                    session == null ? null : session.getRegisterId(), order.getFulfilmentLocationId(), document,
                    new PosDtos.SaleCustomer(order.getCustomerName(), PosReadRepository.last4(order.getCustomerPhone()),
                            order.getBuyerGstin()),
                    outLines,
                    new PosDtos.SaleTotals(order.getSubtotal(), order.getDiscount(), order.getTax(),
                            order.getRoundOff(), order.getTotal(), order.getAmountPaid(), order.getAmountRefunded()),
                    outTenders, change, returns, List.of());
            return new Read(order, session, detail, returnableUnits);
        });
        CommerceOrder order = read.order();
        PosDtos.SaleDetail d = read.detail();
        int returnableUnits = read.returnableUnits();
        List<String> next = new ArrayList<>();
        boolean delivered = "DELIVERED".equals(order.getStatus());
        if (CommerceOrderWriter.CHANNEL_POS.equals(order.getChannel()) && delivered && read.session() != null
                && read.session().isOpen() && atTill(user, instituteId, order.getFulfilmentLocationId())) {
            next.add(ACTION_VOID);
            next.add(ACTION_CHANGE_TENDER);
        }
        if (delivered && CommerceOrderWriter.PAYMENT_PAID.equals(order.getPaymentStatus()) && returnableUnits > 0) {
            next.add(ACTION_RETURN);
        }
        return new PosDtos.SaleDetail(d.orderId(), d.orderNumber(), d.channel(), d.status(), d.sessionId(),
                d.registerId(), d.locationId(), d.document(), d.customer(), d.lines(), d.totals(), d.tenders(),
                d.changeDue(), d.returns(), next);
    }

    private boolean atTill(CustomUserDetails user, String instituteId, String locationId) {
        try {
            access.requireAt(user, instituteId, PosAccess.TILL, locationId);
            return true;
        } catch (CommerceAccessDeniedException e) {
            return false;
        }
    }

    private static BigDecimal nz(BigDecimal value) {
        return value == null ? ZERO : value.setScale(2, RoundingMode.HALF_UP);
    }
}
