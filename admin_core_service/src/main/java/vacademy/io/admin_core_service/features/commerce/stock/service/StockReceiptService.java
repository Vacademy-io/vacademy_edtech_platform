package vacademy.io.admin_core_service.features.commerce.stock.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import vacademy.io.admin_core_service.features.capabilities.service.CapabilityResolver;
import vacademy.io.admin_core_service.features.commerce.audit.CommerceAuditService;
import vacademy.io.admin_core_service.features.commerce.label.service.LabelQueueService;
import vacademy.io.admin_core_service.features.commerce.stock.repository.StockOpsReadRepository;
import vacademy.io.admin_core_service.features.commerce.stock.repository.StockOpsReadRepository.ItemFacts;
import vacademy.io.admin_core_service.features.commerce.catalogue.enums.ProductStatus;
import vacademy.io.admin_core_service.features.commerce.catalogue.enums.StockMode;
import vacademy.io.admin_core_service.features.commerce.catalogue.enums.StockPolicy;
import vacademy.io.admin_core_service.features.commerce.order.desk.CommerceStockShortFlagger;
import vacademy.io.admin_core_service.features.commerce.security.CommerceAccessDeniedException;
import vacademy.io.admin_core_service.features.commerce.stock.dto.ReceiptCostRequest;
import vacademy.io.admin_core_service.features.commerce.stock.dto.ReceiptRequest;
import vacademy.io.admin_core_service.features.commerce.stock.entity.CommercePiece;
import vacademy.io.admin_core_service.features.commerce.stock.entity.StockLocation;
import vacademy.io.admin_core_service.features.commerce.stock.entity.StockMovement;
import vacademy.io.admin_core_service.features.commerce.stock.entity.StockReceipt;
import vacademy.io.admin_core_service.features.commerce.stock.entity.StockReceiptLine;
import vacademy.io.admin_core_service.features.commerce.stock.enums.CostAdjustmentReason;
import vacademy.io.admin_core_service.features.commerce.stock.enums.CostSource;
import vacademy.io.admin_core_service.features.commerce.stock.enums.LocationStatus;
import vacademy.io.admin_core_service.features.commerce.stock.enums.NoBillReason;
import vacademy.io.admin_core_service.features.commerce.stock.enums.PieceStatus;
import vacademy.io.admin_core_service.features.commerce.stock.enums.ReceiptBillStatus;
import vacademy.io.admin_core_service.features.commerce.stock.enums.ReceiptSourceKind;
import vacademy.io.admin_core_service.features.commerce.stock.enums.ReceiptStatus;
import vacademy.io.admin_core_service.features.commerce.stock.enums.StockMovementType;
import vacademy.io.admin_core_service.features.commerce.stock.repository.CommercePieceRepository;
import vacademy.io.admin_core_service.features.commerce.stock.repository.CommercePieceRepository.PieceRow;
import vacademy.io.admin_core_service.features.commerce.stock.repository.StockLocationRepository;
import vacademy.io.admin_core_service.features.commerce.stock.repository.StockMovementRepository;
import vacademy.io.admin_core_service.features.commerce.stock.repository.StockReceiptLineRepository;
import vacademy.io.admin_core_service.features.commerce.stock.repository.StockReceiptLineRepository.LineRow;
import vacademy.io.admin_core_service.features.commerce.stock.repository.StockReceiptRepository;
import vacademy.io.admin_core_service.features.commerce.stock.repository.StockVariantRepository;
import vacademy.io.admin_core_service.features.commerce.stock.repository.StockVariantRepository.VariantFacts;
import vacademy.io.admin_core_service.features.commerce.stock.service.StockLedgerService.ReceiptCostChange;
import vacademy.io.admin_core_service.features.commerce.stock.service.StockPosting.CostTreatment;
import vacademy.io.common.exceptions.ConflictException;
import vacademy.io.common.exceptions.InvalidRequestException;
import vacademy.io.common.exceptions.VacademyException;

import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.TreeMap;
import java.util.TreeSet;

/**
 * Goods receipts. A receipt is posted
 * as it is created: the header, its lines, one RECEIPT movement per line (per piece for
 * one-of-a-kind stock) and the pieces, in one transaction. Stock moves here and nowhere else on
 * the purchase side; a bill never moves stock.
 *
 * <p>Callers pass an institute id the access guard has checked and say whether the caller may
 * state a cost (manager, accountant) or not (warehouse staff).
 */
@Slf4j
@Service
public class StockReceiptService {

    public static final String REFERENCE_RECEIPT = "STOCK_RECEIPT";
    public static final String REASON_OPENING = "OPENING";
    public static final String REASON_RECEIPT_REVERSAL = "RECEIPT_REVERSAL";
    public static final String AUDIT_RECEIPT_POST = "STOCK_RECEIPT_POST";
    public static final String AUDIT_RECEIPT_REVERSE = "STOCK_RECEIPT_REVERSE";
    public static final String AUDIT_RECEIPT_COST = "STOCK_RECEIPT_COST";
    public static final String AUDIT_RECEIPT_NO_BILL = "STOCK_RECEIPT_NO_BILL";
    /** The accounts feature key; its enum value arrives with WP-60a. */
    static final String ACCOUNTS_FEATURE_KEY = "commerce.accounts";

    static final int MAX_LINES = 500;
    static final int MAX_PIECES_PER_LINE = 200;
    static final int MAX_PIECES_PER_RECEIPT = 1000;
    static final int MAX_QUANTITY = 10_000_000;
    static final int MAX_BULK_IDS = 200;
    private static final int MAX_PAGE_SIZE = 100;
    private static final ObjectMapper MAPPER = new ObjectMapper();

    private final StockReceiptRepository receiptRepository;
    private final StockReceiptLineRepository lineRepository;
    private final StockLocationRepository locationRepository;
    private final StockVariantRepository variantRepository;
    private final CommercePieceRepository pieceRepository;
    private final StockMovementRepository movementRepository;
    private final StockLedgerService ledger;
    private final ScanCodeGenerator scanCodes;
    private final CommerceCounterService counters;
    private final CommerceAuditService auditService;
    private final CapabilityResolver capabilityResolver;
    private final StockClock clock;
    private final ObjectProvider<StockSupplierDirectory> supplierDirectory;
    private final ObjectProvider<StockPeriodGuard> periodGuard;
    private final TransactionTemplate transaction;

    /** Flags open orders a receipt reversal left short; absent in tests built by hand. */
    @Autowired(required = false)
    private CommerceStockShortFlagger stockShortFlagger;

    /** The label print queue (WP-40); absent in tests built by hand. */
    private ObjectProvider<LabelQueueService> labelQueue;

    @Autowired(required = false)
    public void setLabelQueue(ObjectProvider<LabelQueueService> labelQueue) {
        this.labelQueue = labelQueue;
    }

    /** Item names and measure for the receipt view (WP-40); absent in tests built by hand. */
    private StockOpsReadRepository opsReadRepository;

    @Autowired(required = false)
    public void setOpsReadRepository(StockOpsReadRepository opsReadRepository) {
        this.opsReadRepository = opsReadRepository;
    }

    public StockReceiptService(StockReceiptRepository receiptRepository,
                               StockReceiptLineRepository lineRepository,
                               StockLocationRepository locationRepository,
                               StockVariantRepository variantRepository,
                               CommercePieceRepository pieceRepository,
                               StockMovementRepository movementRepository,
                               StockLedgerService ledger,
                               ScanCodeGenerator scanCodes,
                               CommerceCounterService counters,
                               CommerceAuditService auditService,
                               CapabilityResolver capabilityResolver,
                               StockClock clock,
                               ObjectProvider<StockSupplierDirectory> supplierDirectory,
                               ObjectProvider<StockPeriodGuard> periodGuard,
                               PlatformTransactionManager transactionManager) {
        this.receiptRepository = receiptRepository;
        this.lineRepository = lineRepository;
        this.locationRepository = locationRepository;
        this.variantRepository = variantRepository;
        this.pieceRepository = pieceRepository;
        this.movementRepository = movementRepository;
        this.ledger = ledger;
        this.scanCodes = scanCodes;
        this.counters = counters;
        this.auditService = auditService;
        this.capabilityResolver = capabilityResolver;
        this.clock = clock;
        this.supplierDirectory = supplierDirectory;
        this.periodGuard = periodGuard;
        this.transaction = new TransactionTemplate(transactionManager);
    }

    // ── Create and post ─────────────────────────────────────────────────────

    /**
     * Creates and posts a receipt. Not transactional itself: the receipt number is taken in a
     * short transaction of its own first (it may leave a gap), then everything else commits or
     * rolls back together.
     *
     * @param mayStateCost false for warehouse staff: a cost in the request is then refused
     */
    public StockReceipt create(String instituteId, String actorUserId, boolean mayStateCost,
                               ReceiptRequest request) {
        Draft draft = validate(instituteId, mayStateCost, request);
        Optional<StockReceipt> earlier = receiptRepository.findByInstituteIdAndClientRequestId(
                instituteId, draft.clientRequestId);
        if (earlier.isPresent()) {
            return sameRequestOrRefuse(earlier.get(), draft);
        }
        String number = counters.nextNumber(instituteId, CommerceCounterService.SCOPE_GOODS_RECEIPT);
        try {
            return transaction.execute(status -> post(instituteId, actorUserId, draft, number));
        } catch (DataIntegrityViolationException e) {
            // Two deliveries of one request: the other one won the unique key.
            StockReceipt winner = receiptRepository
                    .findByInstituteIdAndClientRequestId(instituteId, draft.clientRequestId).orElseThrow(() -> e);
            return sameRequestOrRefuse(winner, draft);
        }
    }

    private static StockReceipt sameRequestOrRefuse(StockReceipt earlier, Draft draft) {
        if (!draft.requestHash.equals(earlier.getRequestHash())) {
            throw new ConflictException("IDEMPOTENCY_MISMATCH: this client_request_id was used for a different receipt");
        }
        return earlier;
    }

    private StockReceipt post(String instituteId, String actorUserId, Draft draft, String receiptNumber) {
        periodGuard.ifAvailable(guard -> guard.assertOpen(instituteId, draft.receivedDate));

        StockLocation location = locationRepository.findByInstituteIdAndId(instituteId, draft.locationId)
                .orElseThrow(() -> new InvalidRequestException("LOCATION_NOT_FOUND: location_id does not belong to this institute"));
        if (!LocationStatus.ACTIVE.name().equals(location.getStatus())) {
            throw new ConflictException("LOCATION_INACTIVE: this location is not active");
        }
        requireSource(instituteId, draft);

        Map<String, VariantFacts> variants = new HashMap<>();
        for (VariantFacts facts : variantRepository.findFactsIn(instituteId, draft.lines.keySet())) {
            variants.put(facts.getPackageSessionId(), facts);
        }
        int pieces = 0;
        for (DraftLine line : draft.lines.values()) {
            VariantFacts facts = variants.get(line.packageSessionId);
            if (facts == null) {
                throw new InvalidRequestException("ITEM_NOT_FOUND: an item does not belong to this institute");
            }
            if (StockPolicy.UNTRACKED.name().equals(facts.getStockPolicy())) {
                throw new InvalidRequestException("ITEM_UNTRACKED: " + facts.getSku() + " is not counted and takes no receipt");
            }
            if (ProductStatus.ARCHIVED.name().equals(facts.getStatus())) {
                throw new InvalidRequestException("ITEM_ARCHIVED: " + facts.getSku() + " is retired");
            }
            if (StockMode.PIECE.name().equals(facts.getStockMode())) {
                if (line.quantity > MAX_PIECES_PER_LINE) {
                    throw new InvalidRequestException("At most " + MAX_PIECES_PER_LINE + " pieces of one item per receipt");
                }
                pieces += line.quantity;
            }
        }
        if (pieces > MAX_PIECES_PER_RECEIPT) {
            throw new InvalidRequestException("At most " + MAX_PIECES_PER_RECEIPT + " pieces per receipt");
        }

        StockReceipt receipt = new StockReceipt();
        receipt.setInstituteId(instituteId);
        receipt.setReceiptNumber(receiptNumber);
        receipt.setLocationId(draft.locationId);
        receipt.setSourceKind(draft.sourceKind.name());
        receipt.setSourceLocationId(draft.sourceLocationId);
        receipt.setSupplierId(draft.supplierId);
        receipt.setSupplierChallanNumber(draft.supplierChallanNumber);
        receipt.setSupplierChallanDate(draft.supplierChallanDate);
        receipt.setEwayBillNo(draft.ewayBillNo);
        receipt.setEwayBillDate(draft.ewayBillDate);
        receipt.setReceivedDate(draft.receivedDate);
        receipt.setStatus(ReceiptStatus.POSTED.name());
        receipt.setBillStatus((draft.sourceKind == ReceiptSourceKind.SUPPLIER
                ? ReceiptBillStatus.UNBILLED : ReceiptBillStatus.NOT_APPLICABLE).name());
        receipt.setNote(draft.note);
        receipt.setReceivedBy(actorUserId);
        receipt.setPostedAt(LocalDateTime.now());
        receipt.setClientRequestId(draft.clientRequestId);
        receipt.setRequestHash(draft.requestHash);
        receipt = receiptRepository.saveAndFlush(receipt);

        String reason = draft.sourceKind == ReceiptSourceKind.OPENING ? REASON_OPENING : null;
        // draft.lines is sorted by package session: the lock order of the ledger.
        for (DraftLine draftLine : draft.lines.values()) {
            VariantFacts facts = variants.get(draftLine.packageSessionId);
            boolean pieceStock = StockMode.PIECE.name().equals(facts.getStockMode());

            // Cost, in this order: typed; the standard cost for goods that bring
            // no bill; otherwise the running average as a stand-in, decided by the ledger.
            BigDecimal knownCost = null;
            CostSource source = CostSource.NONE;
            if (draftLine.unitCost != null) {
                knownCost = draftLine.unitCost;
                source = CostSource.TYPED;
            } else if (draft.sourceKind != ReceiptSourceKind.SUPPLIER && facts.getStandardCost() != null) {
                knownCost = facts.getStandardCost();
                source = CostSource.STANDARD;
            }

            StockReceiptLine line = new StockReceiptLine();
            line.setInstituteId(instituteId);
            line.setReceiptId(receipt.getId());
            line.setPackageSessionId(draftLine.packageSessionId);
            line.setQtyReceived(draftLine.quantity);
            line.setUnitCost(knownCost);
            line.setCostSource(source.name());
            line.setNote(draftLine.note);
            line = lineRepository.saveAndFlush(line);

            StockPosting.StockPostingBuilder posting = StockPosting.builder()
                    .instituteId(instituteId)
                    .locationId(draft.locationId)
                    .packageSessionId(draftLine.packageSessionId)
                    .type(StockMovementType.RECEIPT)
                    .reason(reason)
                    .referenceType(REFERENCE_RECEIPT)
                    .referenceId(receipt.getId())
                    .actorUserId(actorUserId)
                    .unitCost(knownCost)
                    .costTreatment(knownCost != null ? CostTreatment.KNOWN : CostTreatment.PROVISIONAL);

            if (pieceStock) {
                List<CommercePiece> created = new ArrayList<>(draftLine.quantity);
                for (int i = 0; i < draftLine.quantity; i++) {
                    CommercePiece piece = new CommercePiece();
                    piece.setInstituteId(instituteId);
                    piece.setPackageSessionId(draftLine.packageSessionId);
                    piece.setCode(scanCodes.newPieceCode());
                    piece.setLocationId(draft.locationId);
                    piece.setStatus(PieceStatus.IN_STOCK.name());
                    piece.setUnitCost(knownCost);
                    piece.setReceiptLineId(line.getId());
                    created.add(piece);
                }
                created = pieceRepository.saveAllAndFlush(created);
                created.sort(Comparator.comparing(CommercePiece::getId));
                for (CommercePiece piece : created) {
                    ledger.post(posting.pieceId(piece.getId()).quantityDelta(1)
                            .idempotencyKey(StockLedgerService.receiptKey(line.getId(), piece.getId())).build());
                }
                queueLabels(instituteId, draft.locationId, receipt.getId(), line, facts,
                        created.stream().map(CommercePiece::getId).toList(), actorUserId);
            } else {
                StockPostResult result = ledger.post(posting.quantityDelta(draftLine.quantity)
                        .idempotencyKey(StockLedgerService.receiptKey(line.getId(), null)).build());
                if (knownCost == null && result.movement() != null) {
                    ledger.stampReceiptLineCost(instituteId, line.getId(), result.movement().getUnitCost());
                }
                queueLabels(instituteId, draft.locationId, receipt.getId(), line, facts, List.of(), actorUserId);
            }
            if (facts.getLabelCode() == null) {
                variantRepository.setLabelCodeIfMissing(instituteId, draftLine.packageSessionId,
                        scanCodes.newVariantLabelCode());
            }
        }

        Map<String, Object> audit = new LinkedHashMap<>();
        audit.put("receipt_number", receiptNumber);
        audit.put("source_kind", draft.sourceKind.name());
        audit.put("lines", draft.lines.size());
        auditService.record(instituteId, actorUserId, draft.locationId, AUDIT_RECEIPT_POST, REFERENCE_RECEIPT,
                receipt.getId(), null, json(audit), null);
        return receipt;
    }

    /** The labels of a receipt line, in the receipt's transaction (WP-40). */
    private void queueLabels(String instituteId, String locationId, String receiptId, StockReceiptLine line,
                             VariantFacts facts, List<String> pieceIds, String actorUserId) {
        LabelQueueService queue = labelQueue == null ? null : labelQueue.getIfAvailable();
        if (queue != null) {
            queue.queueReceiptLine(instituteId, locationId, receiptId, line, facts, pieceIds, actorUserId);
        }
    }

    private void requireSource(String instituteId, Draft draft) {
        switch (draft.sourceKind) {
            case OWN_SOURCE -> {
                StockLocation source = locationRepository.findByInstituteIdAndId(instituteId, draft.sourceLocationId)
                        .orElseThrow(() -> new InvalidRequestException(
                                "LOCATION_NOT_FOUND: source_location_id does not belong to this institute"));
                if (!source.isSource()) {
                    throw new InvalidRequestException("source_location_id is not one of your source locations");
                }
            }
            case SUPPLIER -> {
                if (!capabilityResolver.isFeatureGranted(instituteId, ACCOUNTS_FEATURE_KEY)) {
                    throw new CommerceAccessDeniedException(CommerceAccessDeniedException.FEATURE_DISABLED,
                            "receiving from a supplier needs the accounts feature");
                }
                StockSupplierDirectory directory = supplierDirectory.getIfAvailable();
                if (directory == null) {
                    throw new InvalidRequestException("SUPPLIERS_NOT_AVAILABLE: suppliers are not set up yet; "
                            + "receive these goods as OTHER with a note");
                }
                if (!directory.isSupplierOf(instituteId, draft.supplierId)) {
                    throw new InvalidRequestException("SUPPLIER_NOT_FOUND: supplier_id does not belong to this institute");
                }
            }
            default -> {
                // OPENING and OTHER name no source.
            }
        }
    }

    // ── Reverse ─────────────────────────────────────────────────────────────

    /**
     * Undoes a wrong receipt with one reversing RECEIPT movement per line or piece (reason
     * RECEIPT_REVERSAL); its pieces become VOIDED. Refused with 409 RECEIPT_BILLED while a
     * bill covers any of it, and with 409 NOT_IN_STOCK when some of the goods have already
     * left. A second call for a reversed receipt changes nothing.
     */
    public StockReceipt reverse(String instituteId, String actorUserId, String receiptId, String reasonText) {
        if (reasonText == null || reasonText.isBlank()) {
            throw new InvalidRequestException("A reason is required to reverse a receipt");
        }
        return transaction.execute(status -> {
            StockReceipt receipt = get(instituteId, receiptId);
            periodGuard.ifAvailable(guard -> guard.assertOpen(instituteId, receipt.getReceivedDate()));
            String current = receiptRepository.lockStatus(instituteId, receiptId)
                    .orElseThrow(() -> new VacademyException(HttpStatus.NOT_FOUND, "Receipt not found"));
            if (ReceiptStatus.REVERSED.name().equals(current)) {
                return get(instituteId, receiptId);
            }
            List<LineRow> lines = lineRepository.findRowsOfReceipt(instituteId, receiptId);
            for (LineRow line : lines) {
                if (line.getQtyBilled() != null && line.getQtyBilled() > 0) {
                    throw new ConflictException("RECEIPT_BILLED: a purchase bill covers this receipt; "
                            + "unlink the bill, or send the goods back with a purchase return");
                }
            }
            for (LineRow line : lines) { // already in package-session order
                BigDecimal ownCost = CostSource.valueOf(line.getCostSource()).isKnown() ? line.getUnitCost() : null;
                StockPosting.StockPostingBuilder posting = StockPosting.builder()
                        .instituteId(instituteId)
                        .locationId(receipt.getLocationId())
                        .packageSessionId(line.getPackageSessionId())
                        .type(StockMovementType.RECEIPT)
                        .reason(REASON_RECEIPT_REVERSAL)
                        .note(reasonText.trim())
                        .referenceType(REFERENCE_RECEIPT)
                        .referenceId(receiptId)
                        .actorUserId(actorUserId)
                        .unitCost(ownCost);
                List<PieceRow> pieces = pieceRepository.findRowsByReceiptLine(instituteId, line.getId());
                int shortfall = 0;
                if (pieces.isEmpty()) {
                    shortfall += ledger.post(posting.quantityDelta(-line.getQtyReceived())
                            .reversesMovementId(originalMovementId(instituteId, line.getId(), null))
                            .idempotencyKey(StockLedgerService.receiptReversalKey(line.getId(), null)).build())
                            .sellableShortfall();
                } else {
                    for (PieceRow piece : pieces) {
                        shortfall += ledger.post(posting.pieceId(piece.getId()).quantityDelta(-1)
                                .reversesMovementId(originalMovementId(instituteId, line.getId(), piece.getId()))
                                .idempotencyKey(StockLedgerService.receiptReversalKey(line.getId(), piece.getId()))
                                .build()).sellableShortfall();
                    }
                }
                if (shortfall > 0 && stockShortFlagger != null) {
                    // After the reversal commits: open orders of this variant here are short.
                    stockShortFlagger.afterCommit(instituteId, receipt.getLocationId(), line.getPackageSessionId(),
                            shortfall);
                }
            }
            if (receiptRepository.markReversed(instituteId, receiptId, actorUserId) != 1) {
                throw new ConflictException("RECEIPT_REVERSED: this receipt was reversed a moment ago");
            }
            LabelQueueService queue = labelQueue == null ? null : labelQueue.getIfAvailable();
            if (queue != null) {
                // Labels of goods that are no longer here are not printed.
                queue.cancelPendingOfSource(instituteId, LabelQueueService.SOURCE_RECEIPT, receiptId, actorUserId);
            }
            auditService.record(instituteId, actorUserId, receipt.getLocationId(), AUDIT_RECEIPT_REVERSE,
                    REFERENCE_RECEIPT, receiptId, null, null, reasonText.trim());
            return get(instituteId, receiptId);
        });
    }

    private String originalMovementId(String instituteId, String lineId, String pieceId) {
        return movementRepository
                .findByInstituteIdAndIdempotencyKey(instituteId, StockLedgerService.receiptKey(lineId, pieceId))
                .map(StockMovement::getId)
                .orElseThrow(() -> new IllegalStateException("receipt line " + lineId + " has no movement to reverse"));
    }

    // ── Cost typed later, no bill ───────────────────────────────────────────

    /** A cost typed per line or per piece after the receipt (manager or accountant). */
    public StockReceipt typeCost(String instituteId, String actorUserId, String receiptId, ReceiptCostRequest request) {
        if (request == null || request.getLines() == null || request.getLines().isEmpty()) {
            throw new InvalidRequestException("lines is required");
        }
        if (request.getLines().size() > MAX_LINES) {
            throw new InvalidRequestException("At most " + MAX_LINES + " lines");
        }
        String clientRequestId = requireClientRequestId(request.getClientRequestId());
        return transaction.execute(status -> {
            StockReceipt receipt = get(instituteId, receiptId);
            String current = receiptRepository.lockStatus(instituteId, receiptId)
                    .orElseThrow(() -> new VacademyException(HttpStatus.NOT_FOUND, "Receipt not found"));
            if (!ReceiptStatus.POSTED.name().equals(current)) {
                throw new ConflictException("RECEIPT_REVERSED: this receipt was reversed and takes no cost");
            }
            Map<String, LineRow> linesById = new HashMap<>();
            lineRepository.findRowsOfReceipt(instituteId, receiptId).forEach(row -> linesById.put(row.getId(), row));
            List<ReceiptCostRequest.Line> sorted = new ArrayList<>(request.getLines());
            for (ReceiptCostRequest.Line entry : sorted) {
                if (entry == null || entry.getLineId() == null || !linesById.containsKey(entry.getLineId())) {
                    throw new InvalidRequestException("A line does not belong to this receipt");
                }
                if (entry.getUnitCost() == null) {
                    throw new InvalidRequestException("unit_cost is required on every line");
                }
            }
            // Variant rows are locked in package-session order, whatever order the lines came in.
            sorted.sort(Comparator
                    .comparing((ReceiptCostRequest.Line entry) -> linesById.get(entry.getLineId()).getPackageSessionId())
                    .thenComparing(ReceiptCostRequest.Line::getLineId)
                    .thenComparing(entry -> entry.getPieceId() == null ? "" : entry.getPieceId()));
            for (ReceiptCostRequest.Line entry : sorted) {
                String key = "COST:" + entry.getLineId()
                        + (entry.getPieceId() == null || entry.getPieceId().isBlank() ? "" : ":" + entry.getPieceId())
                        + ":" + clientRequestId;
                ledger.applyReceiptCost(new ReceiptCostChange(instituteId, entry.getLineId(),
                        entry.getPieceId() == null || entry.getPieceId().isBlank() ? null : entry.getPieceId(),
                        entry.getUnitCost(), CostSource.TYPED, CostAdjustmentReason.TYPED, null, null, actorUserId,
                        key));
            }
            Map<String, Object> audit = new LinkedHashMap<>();
            audit.put("lines", sorted.size());
            auditService.record(instituteId, actorUserId, receipt.getLocationId(), AUDIT_RECEIPT_COST,
                    REFERENCE_RECEIPT, receiptId, null, json(audit), null);
            return get(instituteId, receiptId);
        });
    }

    /**
     * "No bill will come" for supplier receipts that are still UNBILLED, one or many.
     *
     * @return how many receipts were closed; the rest were not UNBILLED supplier receipts
     */
    public int markNoBill(String instituteId, String actorUserId, Collection<String> receiptIds, String reason) {
        if (receiptIds == null || receiptIds.isEmpty()) {
            throw new InvalidRequestException("receipt_ids is required");
        }
        if (receiptIds.size() > MAX_BULK_IDS) {
            throw new InvalidRequestException("At most " + MAX_BULK_IDS + " receipts at once");
        }
        NoBillReason noBillReason;
        try {
            noBillReason = NoBillReason.valueOf(reason == null ? "" : reason.trim().toUpperCase(Locale.ROOT));
        } catch (IllegalArgumentException e) {
            throw new InvalidRequestException("reason must be BILLED_ELSEWHERE, GIFT_OR_SAMPLE or OTHER");
        }
        TreeSet<String> ids = new TreeSet<>(); // sorted: receipt rows are locked in id order
        for (String id : receiptIds) {
            if (id != null && !id.isBlank()) {
                ids.add(id.trim());
            }
        }
        Integer closed = transaction.execute(status -> {
            int count = 0;
            for (String id : ids) {
                if (receiptRepository.markNoBill(instituteId, id, noBillReason.name()) == 1) {
                    count++;
                    auditService.record(instituteId, actorUserId, null, AUDIT_RECEIPT_NO_BILL, REFERENCE_RECEIPT, id,
                            null, null, noBillReason.name());
                }
            }
            return count;
        });
        return closed == null ? 0 : closed;
    }

    // ── Reads ───────────────────────────────────────────────────────────────

    public StockReceipt get(String instituteId, String receiptId) {
        return receiptRepository.findByInstituteIdAndId(instituteId, receiptId)
                .orElseThrow(() -> new VacademyException(HttpStatus.NOT_FOUND, "Receipt not found"));
    }

    /** @param locationIds null for every location of the institute */
    public Page<StockReceipt> list(String instituteId, Collection<String> locationIds, String status,
                                   String billStatus, String supplierId, int page, int size) {
        boolean all = locationIds == null;
        if (!all && locationIds.isEmpty()) {
            return Page.empty();
        }
        return receiptRepository.search(instituteId, all, all ? List.of("-") : locationIds,
                blankToNull(status), blankToNull(billStatus), blankToNull(supplierId),
                PageRequest.of(Math.max(page, 0), Math.min(Math.max(size, 1), MAX_PAGE_SIZE),
                        Sort.by(Sort.Direction.DESC, "receivedDate").and(Sort.by(Sort.Direction.DESC, "receiptNumber"))));
    }

    /** A receipt with its lines and pieces. Cost fields are left out unless {@code withCost}. */
    public Map<String, Object> view(String instituteId, StockReceipt receipt, boolean withCost, boolean withLines) {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("id", receipt.getId());
        out.put("receipt_number", receipt.getReceiptNumber());
        out.put("location_id", receipt.getLocationId());
        out.put("source_kind", receipt.getSourceKind());
        out.put("source_location_id", receipt.getSourceLocationId());
        out.put("supplier_id", receipt.getSupplierId());
        out.put("supplier_challan_number", receipt.getSupplierChallanNumber());
        out.put("supplier_challan_date", text(receipt.getSupplierChallanDate()));
        out.put("eway_bill_no", receipt.getEwayBillNo());
        out.put("eway_bill_date", text(receipt.getEwayBillDate()));
        out.put("received_date", text(receipt.getReceivedDate()));
        out.put("status", receipt.getStatus());
        out.put("bill_status", receipt.getBillStatus());
        out.put("no_bill_reason", receipt.getNoBillReason());
        out.put("note", receipt.getNote());
        out.put("received_by", receipt.getReceivedBy());
        out.put("posted_at", text(receipt.getPostedAt()));
        out.put("reversed_by", receipt.getReversedBy());
        out.put("reversed_at", text(receipt.getReversedAt()));
        if (!withLines) {
            return out;
        }
        List<Map<String, Object>> lines = new ArrayList<>();
        List<StockReceiptLine> receiptLines = lineRepository
                .findByInstituteIdAndReceiptIdOrderByPackageSessionIdAscIdAsc(instituteId, receipt.getId());
        Map<String, ItemFacts> items = opsReadRepository == null || receiptLines.isEmpty() ? Map.of()
                : opsReadRepository.itemFacts(instituteId,
                receiptLines.stream().map(StockReceiptLine::getPackageSessionId).toList());
        for (StockReceiptLine line : receiptLines) {
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("id", line.getId());
            row.put("package_session_id", line.getPackageSessionId());
            ItemFacts item = items.get(line.getPackageSessionId());
            row.put("sku", item == null ? null : item.sku());
            row.put("product_name", item == null ? null : item.productName());
            row.put("variant_name", item == null ? null : item.variantName());
            row.put("stock_mode", item == null ? null : item.stockMode());
            row.put("unit", item == null ? null : item.unit());
            row.put("qty_scale", item == null ? null : item.qtyScale());
            row.put("qty_received", line.getQtyReceived());
            row.put("qty_billed", line.getQtyBilled() == null ? 0 : line.getQtyBilled());
            row.put("note", line.getNote());
            if (withCost) {
                row.put("unit_cost", line.getUnitCost());
                row.put("cost_source", line.getCostSource());
            }
            List<Map<String, Object>> pieces = new ArrayList<>();
            for (PieceRow piece : pieceRepository.findRowsByReceiptLine(instituteId, line.getId())) {
                Map<String, Object> pieceRow = new LinkedHashMap<>();
                pieceRow.put("id", piece.getId());
                pieceRow.put("code", piece.getCode());
                pieceRow.put("status", piece.getStatus());
                if (withCost) {
                    pieceRow.put("unit_cost", piece.getUnitCost());
                }
                pieces.add(pieceRow);
            }
            row.put("pieces", pieces);
            lines.add(row);
        }
        out.put("lines", lines);
        return out;
    }

    // ── Validation ──────────────────────────────────────────────────────────

    private static final class DraftLine {
        String packageSessionId;
        int quantity;
        BigDecimal unitCost;
        String note;
    }

    private static final class Draft {
        String locationId;
        ReceiptSourceKind sourceKind;
        String sourceLocationId;
        String supplierId;
        String supplierChallanNumber;
        LocalDate supplierChallanDate;
        String ewayBillNo;
        LocalDate ewayBillDate;
        LocalDate receivedDate;
        String note;
        String clientRequestId;
        String requestHash;
        /** Sorted by package session id. */
        final TreeMap<String, DraftLine> lines = new TreeMap<>();
    }

    private Draft validate(String instituteId, boolean mayStateCost, ReceiptRequest request) {
        if (request == null) {
            throw new InvalidRequestException("Request body is required");
        }
        Draft draft = new Draft();
        draft.clientRequestId = requireClientRequestId(request.getClientRequestId());
        draft.locationId = requireId(request.getLocationId(), "location_id");
        try {
            draft.sourceKind = ReceiptSourceKind.valueOf(
                    request.getSourceKind() == null ? "" : request.getSourceKind().trim().toUpperCase(Locale.ROOT));
        } catch (IllegalArgumentException e) {
            throw new InvalidRequestException("source_kind must be OWN_SOURCE, SUPPLIER, OPENING or OTHER");
        }
        if (draft.sourceKind == ReceiptSourceKind.OWN_SOURCE) {
            draft.sourceLocationId = requireId(request.getSourceLocationId(), "source_location_id");
        } else if (draft.sourceKind == ReceiptSourceKind.SUPPLIER) {
            draft.supplierId = requireId(request.getSupplierId(), "supplier_id");
        }
        draft.supplierChallanNumber = limited(request.getSupplierChallanNumber(), 64, "supplier_challan_number");
        draft.supplierChallanDate = request.getSupplierChallanDate();
        draft.ewayBillNo = limited(request.getEwayBillNo(), 32, "eway_bill_no");
        draft.ewayBillDate = request.getEwayBillDate();
        draft.note = limited(request.getNote(), 2000, "note");
        if (draft.sourceKind == ReceiptSourceKind.OTHER && draft.note == null) {
            throw new InvalidRequestException("A note is required when the source is OTHER");
        }
        LocalDate today = clock.today(instituteId);
        draft.receivedDate = request.getReceivedDate() != null ? request.getReceivedDate() : today;
        if (draft.receivedDate.isAfter(today)) {
            throw new InvalidRequestException("received_date cannot be in the future");
        }
        if (request.getLines() == null || request.getLines().isEmpty()) {
            throw new InvalidRequestException("A receipt needs at least one line");
        }
        if (request.getLines().size() > MAX_LINES) {
            throw new InvalidRequestException("At most " + MAX_LINES + " lines per receipt");
        }
        for (ReceiptRequest.Line requested : request.getLines()) {
            if (requested == null) {
                throw new InvalidRequestException("A line is empty");
            }
            DraftLine line = new DraftLine();
            line.packageSessionId = requireId(requested.getPackageSessionId(), "package_session_id");
            if (requested.getQuantity() == null || requested.getQuantity() < 1
                    || requested.getQuantity() > MAX_QUANTITY) {
                throw new InvalidRequestException("quantity must be a whole number between 1 and " + MAX_QUANTITY);
            }
            line.quantity = requested.getQuantity();
            if (requested.getUnitCost() != null) {
                if (!mayStateCost) {
                    throw new CommerceAccessDeniedException(CommerceAccessDeniedException.ROLE_NOT_ALLOWED,
                            "your role cannot state a cost");
                }
                BigDecimal cost = requested.getUnitCost();
                if (cost.signum() < 0 || cost.scale() > StockCostMath.COST_SCALE
                        || cost.precision() - cost.scale() > 10) {
                    throw new InvalidRequestException("unit_cost must be zero or more, with at most four decimals");
                }
                line.unitCost = StockCostMath.cost(cost);
            }
            line.note = limited(requested.getNote(), 1000, "note");
            if (draft.lines.put(line.packageSessionId, line) != null) {
                throw new InvalidRequestException("An item appears on two lines; put it on one");
            }
        }
        draft.requestHash = hash(draft);
        return draft;
    }

    private static String hash(Draft draft) {
        StringBuilder text = new StringBuilder()
                .append(draft.locationId).append('|').append(draft.sourceKind).append('|')
                .append(draft.sourceLocationId).append('|').append(draft.supplierId).append('|')
                .append(draft.supplierChallanNumber).append('|').append(draft.receivedDate);
        for (DraftLine line : draft.lines.values()) {
            text.append('|').append(line.packageSessionId).append(':').append(line.quantity).append(':')
                    .append(line.unitCost == null ? "" : line.unitCost.toPlainString());
        }
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(text.toString().getBytes(StandardCharsets.UTF_8));
            StringBuilder hex = new StringBuilder(digest.length * 2);
            for (byte b : digest) {
                hex.append(Character.forDigit((b >> 4) & 0xF, 16)).append(Character.forDigit(b & 0xF, 16));
            }
            return hex.toString();
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 is not available", e);
        }
    }

    static String requireClientRequestId(String raw) {
        String value = raw == null ? "" : raw.trim();
        if (value.isEmpty() || value.length() > 64 || !value.matches("[A-Za-z0-9._:-]+")) {
            throw new InvalidRequestException("client_request_id is required: up to 64 letters, digits, . _ : or -");
        }
        return value;
    }

    private static String requireId(String raw, String field) {
        String value = raw == null ? "" : raw.trim();
        if (value.isEmpty() || value.length() > 255) {
            throw new InvalidRequestException(field + " is required");
        }
        return value;
    }

    private static String limited(String raw, int max, String field) {
        String value = blankToNull(raw);
        if (value != null && value.length() > max) {
            throw new InvalidRequestException(field + " is longer than " + max + " characters");
        }
        return value;
    }

    private static String blankToNull(String value) {
        return value == null || value.isBlank() ? null : value.trim();
    }

    private static String text(Object value) {
        return value == null ? null : value.toString();
    }

    private static String json(Object value) {
        try {
            return MAPPER.writeValueAsString(value);
        } catch (JsonProcessingException e) {
            throw new IllegalStateException("could not write a receipt as JSON", e);
        }
    }
}
