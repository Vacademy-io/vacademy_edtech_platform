package vacademy.io.admin_core_service.features.commerce.stock.service;

import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.admin_core_service.features.commerce.catalogue.enums.StockMode;
import vacademy.io.admin_core_service.features.commerce.catalogue.enums.StockPolicy;
import vacademy.io.admin_core_service.features.commerce.stock.entity.StockCostAdjustment;
import vacademy.io.admin_core_service.features.commerce.stock.entity.StockMovement;
import vacademy.io.admin_core_service.features.commerce.stock.enums.CostAdjustmentReason;
import vacademy.io.admin_core_service.features.commerce.stock.enums.CostSource;
import vacademy.io.admin_core_service.features.commerce.stock.enums.LocationStatus;
import vacademy.io.admin_core_service.features.commerce.stock.enums.PieceStatus;
import vacademy.io.admin_core_service.features.commerce.stock.enums.ReceiptSourceKind;
import vacademy.io.admin_core_service.features.commerce.stock.enums.ReceiptStatus;
import vacademy.io.admin_core_service.features.commerce.stock.enums.StockMovementType;
import vacademy.io.admin_core_service.features.commerce.stock.repository.CommercePieceRepository;
import vacademy.io.admin_core_service.features.commerce.stock.repository.CommercePieceRepository.PieceRow;
import vacademy.io.admin_core_service.features.commerce.stock.repository.StockCostAdjustmentRepository;
import vacademy.io.admin_core_service.features.commerce.stock.repository.StockLevelRepository;
import vacademy.io.admin_core_service.features.commerce.stock.repository.StockLocationRepository;
import vacademy.io.admin_core_service.features.commerce.stock.repository.StockLocationRepository.LocationFacts;
import vacademy.io.admin_core_service.features.commerce.stock.repository.StockMovementRepository;
import vacademy.io.admin_core_service.features.commerce.stock.repository.StockReceiptLineRepository;
import vacademy.io.admin_core_service.features.commerce.stock.repository.StockReceiptLineRepository.LineRow;
import vacademy.io.admin_core_service.features.commerce.stock.repository.StockVariantRepository;
import vacademy.io.admin_core_service.features.commerce.stock.repository.StockVariantRepository.VariantCost;
import vacademy.io.admin_core_service.features.commerce.stock.repository.StockVariantRepository.VariantFacts;
import vacademy.io.admin_core_service.features.commerce.stock.service.StockPosting.CostTreatment;
import vacademy.io.admin_core_service.features.packages.repository.PackageSessionRepository;
import vacademy.io.admin_core_service.features.packages.repository.PackageSessionRepository.CommerceStockCounters;
import vacademy.io.common.exceptions.ConflictException;
import vacademy.io.common.exceptions.InvalidRequestException;
import vacademy.io.common.logging.SentryLogger;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

/**
 * The only writer of {@code stock_level}, {@code stock_movement}, {@code stock_cost_adjustment},
 * the cost columns of {@code commerce_variant} and {@code commerce_piece}, and, for a shop
 * variant at a location that sells online, of {@code package_session.max_seats}.
 *
 * <p>One posting, in the caller's transaction:
 * <ol>
 *   <li>the location row, shared lock (a change of {@code sells_online} waits for postings);</li>
 *   <li>the {@code stock_level} row, locked. A repeated idempotency key is looked for again
 *       after this lock: the same key always names the same level row, so two deliveries of one
 *       request queue here and the second finds the first one's movement;</li>
 *   <li>one conditional UPDATE of {@code on_hand} that refuses to go below zero;</li>
 *   <li>at an online location, the {@code package_session} counters and,
 *       when promised units leave, the variant's sellable deficit;</li>
 *   <li>the cost: the variant row is locked only when the average may change;</li>
 *   <li>for one-of-a-kind stock, the piece moves by compare-and-set;</li>
 *   <li>the movement row is inserted. Nothing ever updates it.</li>
 * </ol>
 * That is the lock order of the stock code (level, package session, variant, piece). A
 * caller that posts several lines in one transaction sorts them first ({@link #LOCK_ORDER}).
 *
 * <p>An UNTRACKED variant has no level rows and no movements: a posting for it does nothing.
 */
@Slf4j
@Service
public class StockLedgerService {

    /** Lines of one transaction are posted in this order: package session, then location. */
    public static final Comparator<StockPosting> LOCK_ORDER = Comparator
            .comparing(StockPosting::getPackageSessionId)
            .thenComparing(StockPosting::getLocationId)
            .thenComparing(posting -> posting.getPieceId() == null ? "" : posting.getPieceId());

    static final int MAX_KEY_LENGTH = 160;
    private static final int MAX_NAME_LENGTH = 32;
    private static final int MAX_REFERENCE_ID_LENGTH = 64;

    private final StockLocationRepository locationRepository;
    private final StockLevelRepository levelRepository;
    private final StockMovementRepository movementRepository;
    private final CommercePieceRepository pieceRepository;
    private final StockVariantRepository variantRepository;
    private final StockCostAdjustmentRepository costAdjustmentRepository;
    private final StockReceiptLineRepository receiptLineRepository;
    private final PackageSessionRepository packageSessionRepository;
    private final StockClock clock;

    public StockLedgerService(StockLocationRepository locationRepository,
                              StockLevelRepository levelRepository,
                              StockMovementRepository movementRepository,
                              CommercePieceRepository pieceRepository,
                              StockVariantRepository variantRepository,
                              StockCostAdjustmentRepository costAdjustmentRepository,
                              StockReceiptLineRepository receiptLineRepository,
                              PackageSessionRepository packageSessionRepository,
                              StockClock clock) {
        this.locationRepository = locationRepository;
        this.levelRepository = levelRepository;
        this.movementRepository = movementRepository;
        this.pieceRepository = pieceRepository;
        this.variantRepository = variantRepository;
        this.costAdjustmentRepository = costAdjustmentRepository;
        this.receiptLineRepository = receiptLineRepository;
        this.packageSessionRepository = packageSessionRepository;
        this.clock = clock;
    }

    // ── Posting ─────────────────────────────────────────────────────────────

    /**
     * Posts one movement.
     *
     * @throws InvalidRequestException (400) the variant or the location is not of this institute,
     *                                 or the posting is malformed
     * @throws ConflictException       (409) not that much on hand here; at an online location, a
     *                                 counter sale of units that are held or sold online; a piece
     *                                 that is not where the posting expects it
     */
    @Transactional
    public StockPostResult post(StockPosting posting) {
        validate(posting);
        String instituteId = posting.getInstituteId();
        String locationId = posting.getLocationId();
        String packageSessionId = posting.getPackageSessionId();
        int delta = posting.getQuantityDelta();

        VariantFacts variant = variantRepository.findFacts(instituteId, packageSessionId)
                .orElseThrow(() -> new InvalidRequestException("This item is not a shop product of this institute"));
        if (StockPolicy.UNTRACKED.name().equals(variant.getStockPolicy())) {
            return StockPostResult.untracked();
        }
        Optional<StockMovement> posted = movementRepository.findByInstituteIdAndIdempotencyKey(
                instituteId, posting.getIdempotencyKey());
        if (posted.isPresent()) {
            return repeated(posting, posted.get());
        }

        LocationFacts location = locationRepository.lockForPosting(instituteId, locationId)
                .orElseThrow(() -> new InvalidRequestException("This location does not belong to this institute"));
        boolean bringsNewStock = delta > 0 && (posting.getType() == StockMovementType.RECEIPT
                || posting.getType() == StockMovementType.TRANSFER_IN);
        if (bringsNewStock && !LocationStatus.ACTIVE.name().equals(location.getStatus())) {
            throw new ConflictException("LOCATION_INACTIVE: this location is not active");
        }

        boolean pieceStock = StockMode.PIECE.name().equals(variant.getStockMode());
        if (pieceStock && (isBlank(posting.getPieceId()) || Math.abs(delta) != 1)) {
            throw new InvalidRequestException("A one-of-a-kind item moves one piece at a time, named by its piece");
        }
        if (!pieceStock && !isBlank(posting.getPieceId())) {
            throw new InvalidRequestException("This item is counted by quantity and has no pieces");
        }

        levelRepository.insertIfMissing(UUID.randomUUID().toString(), instituteId, locationId, packageSessionId);
        int onHandBefore = levelRepository.lockOnHand(instituteId, locationId, packageSessionId)
                .orElseThrow(() -> new IllegalStateException("stock level row is missing after its insert"));
        // Again, now that the level row is ours: a twin of this request may have committed.
        posted = movementRepository.findByInstituteIdAndIdempotencyKey(instituteId, posting.getIdempotencyKey());
        if (posted.isPresent()) {
            return repeated(posting, posted.get());
        }
        // Under the level lock: every correction of one movement posts on this same row, so
        // two of them cannot both read "nothing undone yet".
        StockMovement original = isBlank(posting.getReversesMovementId()) ? null : requireReversible(posting);

        if (levelRepository.applyDelta(instituteId, locationId, packageSessionId, delta) == 0) {
            throw new ConflictException("NOT_IN_STOCK: only " + onHandBefore + " on hand at this location");
        }

        boolean online = Boolean.TRUE.equals(location.getSellsOnline());
        int shortfall = online ? moveSellable(posting) : 0;

        CostStamp cost = pieceStock ? movePiece(posting) : quantityCost(posting, variant, original);

        StockMovement movement = new StockMovement();
        movement.setInstituteId(instituteId);
        movement.setLocationId(locationId);
        movement.setPackageSessionId(packageSessionId);
        movement.setPieceId(blankToNull(posting.getPieceId()));
        movement.setType(posting.getType().name());
        movement.setQuantityDelta(delta);
        movement.setBalanceAfter(onHandBefore + delta);
        movement.setAffectsSellable(online);
        movement.setReferenceType(posting.getReferenceType());
        movement.setReferenceId(posting.getReferenceId());
        movement.setTransferId(posting.getTransferId());
        movement.setReversesMovementId(posting.getReversesMovementId());
        movement.setReason(posting.getReason());
        movement.setNote(posting.getNote());
        movement.setActorUserId(posting.getActorUserId());
        movement.setIdempotencyKey(posting.getIdempotencyKey());
        movement.setUnitCost(cost.unitCost());
        movement.setCostProvisional(cost.provisional());
        movement = movementRepository.save(movement);

        if (cost.removal() != null) {
            saveAdjustment(instituteId, packageSessionId, null, movement.getId(), null, null, Math.abs(delta),
                    cost.unitCost(), cost.unitCost(), cost.quantityAtChange(), cost.oldAverage(),
                    cost.removal().newAverage(), cost.removal().variance(),
                    posting.getType() == StockMovementType.PURCHASE_RETURN
                            ? CostAdjustmentReason.PURCHASE_RETURN : CostAdjustmentReason.RECEIPT_REVERSAL,
                    posting.getActorUserId(), "MOVE:" + movement.getId());
        }
        if (shortfall > 0) {
            log.warn("Stock short for online orders: {} unit(s) of variant {} left location {} although "
                            + "held or sold online (movement {}, institute {})",
                    shortfall, packageSessionId, locationId, movement.getId(), instituteId);
        }
        return new StockPostResult(movement, true, shortfall);
    }

    /**
     * The answer to a key that was posted before. The same key for a different item, place,
     * kind or quantity is a caller error: answering "done" would hide that nothing moved.
     */
    private static StockPostResult repeated(StockPosting posting, StockMovement first) {
        if (!posting.getPackageSessionId().equals(first.getPackageSessionId())
                || !posting.getLocationId().equals(first.getLocationId())
                || !posting.getType().name().equals(first.getType())
                || posting.getQuantityDelta() != first.getQuantityDelta()) {
            throw new ConflictException("IDEMPOTENCY_KEY_REUSED: this request key was already used for "
                    + "another stock movement");
        }
        return StockPostResult.repeated(first);
    }

    /**
     * A correction must undo a real movement of the same item, place and kind, in the other
     * direction, and all corrections of one movement together cannot undo more than it moved.
     */
    private StockMovement requireReversible(StockPosting posting) {
        String instituteId = posting.getInstituteId();
        StockMovement original = movementRepository
                .findByInstituteIdAndId(instituteId, posting.getReversesMovementId().trim())
                .orElseThrow(() -> new InvalidRequestException("REVERSAL_INVALID: the movement to undo was not found"));
        boolean samePiece = isBlank(posting.getPieceId()) ? isBlank(original.getPieceId())
                : posting.getPieceId().equals(original.getPieceId());
        if (!posting.getPackageSessionId().equals(original.getPackageSessionId())
                || !posting.getLocationId().equals(original.getLocationId())
                || !posting.getType().name().equals(original.getType())
                || !samePiece
                || !isBlank(original.getReversesMovementId())
                || Integer.signum(posting.getQuantityDelta()) == Integer.signum(original.getQuantityDelta())) {
            throw new InvalidRequestException("REVERSAL_INVALID: a correction undoes a movement of the same "
                    + "item, location and kind, in the other direction");
        }
        long undone = Math.abs(movementRepository.sumReversed(instituteId, original.getId()));
        long left = Math.abs((long) original.getQuantityDelta()) - undone;
        if (Math.abs((long) posting.getQuantityDelta()) > left) {
            throw new ConflictException("ALREADY_REVERSED: only " + Math.max(left, 0) + " unit(s) of this "
                    + "movement are left to undo");
        }
        return original;
    }

    /** The movement an idempotency key has already posted, if any. */
    @Transactional(readOnly = true)
    public Optional<StockMovement> findPosted(String instituteId, String idempotencyKey) {
        if (isBlank(instituteId) || isBlank(idempotencyKey)) {
            return Optional.empty();
        }
        return movementRepository.findByInstituteIdAndIdempotencyKey(instituteId, idempotencyKey);
    }

    /** Posts several movements of one transaction in lock order. Results come back in that order. */
    @Transactional
    public List<StockPostResult> postAll(List<StockPosting> postings) {
        List<StockPosting> sorted = new ArrayList<>(postings == null ? List.of() : postings);
        sorted.sort(LOCK_ORDER);
        List<StockPostResult> results = new ArrayList<>(sorted.size());
        for (StockPosting posting : sorted) {
            results.add(post(posting));
        }
        return results;
    }

    /** The reorder threshold of a level row. It is not a quantity, but the row has one writer. */
    @Transactional
    public void setReorderLevel(String instituteId, String locationId, String packageSessionId,
                                Integer reorderLevel) {
        if (reorderLevel != null && reorderLevel < 0) {
            throw new InvalidRequestException("reorder_level cannot be negative");
        }
        variantRepository.findFacts(instituteId, packageSessionId)
                .orElseThrow(() -> new InvalidRequestException("This item is not a shop product of this institute"));
        locationRepository.findByInstituteIdAndId(instituteId, locationId)
                .orElseThrow(() -> new InvalidRequestException("This location does not belong to this institute"));
        levelRepository.insertIfMissing(UUID.randomUUID().toString(), instituteId, locationId, packageSessionId);
        levelRepository.setReorderLevel(instituteId, locationId, packageSessionId, reorderLevel);
    }

    // ── Sellable counters at an online location ──

    /** @return units that left although they were already promised online (0 when none). */
    private int moveSellable(StockPosting posting) {
        String packageSessionId = posting.getPackageSessionId();
        int delta = posting.getQuantityDelta();
        int quantity = Math.abs(delta);
        CommerceStockCounters before = packageSessionRepository.lockCommerceStockCounters(packageSessionId)
                .orElseThrow(() -> new IllegalStateException(
                        "package session of variant " + packageSessionId + " is missing"));
        switch (posting.getType()) {
            case SALE -> {
                // Shipment: the hold took available_slots at checkout. Undo of a shipment: back
                // on the shelf, still promised.
                if (delta < 0) {
                    packageSessionRepository.commerceStockShipped(packageSessionId, quantity);
                } else {
                    packageSessionRepository.commerceStockUnshipped(packageSessionId, quantity);
                }
                return 0;
            }
            case POS_SALE -> {
                if (delta > 0) {
                    sellableIn(packageSessionId, quantity);
                    return 0;
                }
                if (packageSessionRepository.commerceStockSoldAtCounter(packageSessionId, quantity) == 1) {
                    return 0;
                }
                if (!posting.isAllowShortfall()) {
                    throw new ConflictException("SOLD_ONLINE: these units are sold online and await "
                            + "dispatch, or are in an online checkout");
                }
                // A paper bill keyed later: the sale happened, so the units leave as any other
                // outflow does (floored, the deficit remembered) and the shortfall is answered.
                return outFloored(packageSessionId, quantity, before);
            }
            default -> {
                if (delta > 0) {
                    sellableIn(packageSessionId, quantity);
                    return 0;
                }
                return outFloored(packageSessionId, quantity, before);
            }
        }
    }

    /**
     * Units leave an online location whatever was promised: both counters are taken down, never
     * below zero, and the units that were already promised are remembered as a deficit.
     *
     * @return the units that left although promised online
     */
    private int outFloored(String packageSessionId, int quantity, CommerceStockCounters before) {
        packageSessionRepository.commerceStockOutFloored(packageSessionId, quantity);
        int unpromised = before.getAvailableSlots() == null ? 0 : Math.max(before.getAvailableSlots(), 0);
        int shortfall = Math.max(quantity - unpromised, 0);
        if (shortfall > 0) {
            // available_slots stopped at 0. The rest is remembered, so that a later
            // inflow or a released hold does not put promised units back on sale.
            packageSessionRepository.commerceAddSellableDeficit(packageSessionId, shortfall);
        }
        return shortfall;
    }

    /**
     * Units came in at an online location: they first pay off the deficit (units that left
     * while promised), and only the rest becomes sellable. The package session row is locked.
     */
    private void sellableIn(String packageSessionId, int quantity) {
        Integer deficit = packageSessionRepository.commerceSellableDeficit(packageSessionId);
        int pay = Math.min(deficit == null ? 0 : Math.max(deficit, 0), quantity);
        if (pay > 0) {
            packageSessionRepository.commerceAddSellableDeficit(packageSessionId, -pay);
        }
        packageSessionRepository.commerceStockIn(packageSessionId, quantity, quantity - pay);
    }

    // ── Cost of quantity stock ──────────────────────────────────────────────

    /** What is stamped on the movement, and for a removal at cost what the average did. */
    private record CostStamp(BigDecimal unitCost, boolean provisional, StockCostMath.Change removal,
                             BigDecimal oldAverage, Integer quantityAtChange) {
        static CostStamp of(BigDecimal unitCost, boolean provisional) {
            return new CostStamp(StockCostMath.cost(unitCost), provisional, null, null, null);
        }
    }

    private CostStamp quantityCost(StockPosting posting, VariantFacts variant, StockMovement original) {
        String instituteId = posting.getInstituteId();
        String packageSessionId = posting.getPackageSessionId();
        int delta = posting.getQuantityDelta();
        CostTreatment treatment = treatmentOf(posting);
        BigDecimal statedCost = posting.getUnitCost();
        if (original != null && posting.getCostTreatment() == null && statedCost == null) {
            // A correction carries the cost of the row it undoes, never the average of today.
            // Units that come back (a voided sale, an undone damage entry) re-average like a
            // customer return; units that leave again keep the average.
            if (delta > 0 && original.getUnitCost() != null && !original.isCostProvisional()) {
                treatment = CostTreatment.KNOWN;
                statedCost = original.getUnitCost();
            } else {
                return CostStamp.of(original.getUnitCost(), original.isCostProvisional());
            }
        }
        if (treatment == CostTreatment.AT_AVERAGE) {
            // Read without a lock; a value a moment old is accepted.
            return CostStamp.of(variant.getCostPrice(), false);
        }
        if (treatment == CostTreatment.PROVISIONAL) {
            return CostStamp.of(variant.getCostPrice(), true);
        }
        BigDecimal unitCost = StockCostMath.cost(statedCost);
        VariantCost locked = variantRepository.lockCost(instituteId, packageSessionId)
                .orElseThrow(() -> new IllegalStateException("variant row is missing: " + packageSessionId));
        // Read after the lock, and after this posting changed its level row.
        long quantityAfter = quantityEverywhere(instituteId, packageSessionId);
        long quantityBefore = quantityAfter - delta;
        BigDecimal oldAverage = locked.getCostPrice();
        if (treatment == CostTreatment.KNOWN) {
            BigDecimal newAverage = StockCostMath.afterInflow(oldAverage, quantityBefore, unitCost, delta);
            if (!StockCostMath.same(oldAverage, newAverage)) {
                variantRepository.setCostPrice(instituteId, packageSessionId, newAverage);
            }
            return CostStamp.of(unitCost, false);
        }
        StockCostMath.Change removal = StockCostMath.afterRemovalAtCost(oldAverage, quantityBefore, unitCost, -delta);
        if (!StockCostMath.same(oldAverage, removal.newAverage())) {
            variantRepository.setCostPrice(instituteId, packageSessionId, removal.newAverage());
        }
        return new CostStamp(unitCost, false, removal, oldAverage, clampToInt(quantityBefore));
    }

    private static CostTreatment treatmentOf(StockPosting posting) {
        if (posting.getCostTreatment() != null) {
            return posting.getCostTreatment();
        }
        boolean stated = posting.getUnitCost() != null;
        boolean in = posting.getQuantityDelta() > 0;
        return switch (posting.getType()) {
            case RECEIPT -> in ? (stated ? CostTreatment.KNOWN : CostTreatment.PROVISIONAL)
                    : (stated ? CostTreatment.REMOVE_AT_COST : CostTreatment.AT_AVERAGE);
            case RETURN -> in && stated ? CostTreatment.KNOWN : CostTreatment.AT_AVERAGE;
            case PURCHASE_RETURN -> !in && stated ? CostTreatment.REMOVE_AT_COST : CostTreatment.AT_AVERAGE;
            default -> CostTreatment.AT_AVERAGE;
        };
    }

    /** Q of the cost rules: on hand over all locations plus what is in transit between them. */
    private long quantityEverywhere(String instituteId, String packageSessionId) {
        return levelRepository.sumOnHand(instituteId, packageSessionId)
                + movementRepository.sumInTransit(instituteId, packageSessionId);
    }

    // ── Pieces ──────────────────────────────────────────────────────────────

    /** Moves the piece by compare-and-set and returns its own cost for the stamp. */
    private CostStamp movePiece(StockPosting posting) {
        String instituteId = posting.getInstituteId();
        String locationId = posting.getLocationId();
        PieceRow piece = pieceRepository.lockRow(instituteId, posting.getPieceId())
                .orElseThrow(() -> new InvalidRequestException("This piece does not belong to this institute"));
        if (!posting.getPackageSessionId().equals(piece.getPackageSessionId())) {
            throw new InvalidRequestException("This piece is not a piece of this item");
        }
        StockMovementType type = posting.getType();
        boolean in = posting.getQuantityDelta() > 0;
        String away = awayStatus(type).name();
        // A shipment takes a piece that was reserved at packing, and its undo puts it back so.
        String here = (type == StockMovementType.SALE ? PieceStatus.RESERVED : PieceStatus.IN_STOCK).name();
        if (in && type == StockMovementType.RECEIPT) {
            // The receipt created the piece here a moment ago; there is no earlier state to leave.
            if (!here.equals(piece.getStatus()) || !locationId.equals(piece.getLocationId())) {
                throw new ConflictException("PIECE_STATE: piece " + piece.getCode() + " is not new at this location");
            }
        } else {
            int moved = in
                    ? pieceRepository.transition(instituteId, piece.getId(), away, null, here, locationId)
                    : pieceRepository.transition(instituteId, piece.getId(), here, locationId, away, null);
            if (moved != 1) {
                throw new ConflictException("PIECE_STATE: piece " + piece.getCode() + " is " + piece.getStatus()
                        + " and cannot be moved this way");
            }
        }
        return CostStamp.of(piece.getUnitCost(), treatmentOf(posting) == CostTreatment.PROVISIONAL);
    }

    /** Where a piece is once it has left a location by this kind of movement. */
    static PieceStatus awayStatus(StockMovementType type) {
        return switch (type) {
            case RECEIPT -> PieceStatus.VOIDED;
            case ADJUSTMENT, DAMAGE -> PieceStatus.WRITTEN_OFF;
            case TRANSFER_OUT, TRANSFER_IN -> PieceStatus.IN_TRANSIT;
            case SALE, POS_SALE, RETURN -> PieceStatus.SOLD;
            case PURCHASE_RETURN -> PieceStatus.RETURNED_TO_SUPPLIER;
        };
    }

    // ── Cost known later, standard cost ─────────────────────────────────────

    /** A cost for a receipt line (or one of its pieces) that becomes known after the receipt. */
    public record ReceiptCostChange(String instituteId, String receiptLineId, String pieceId,
                                    BigDecimal newUnitCost, CostSource source, CostAdjustmentReason reason,
                                    String billLineId, LocalDate bookDate, String actorUserId,
                                    String idempotencyKey) {
    }

    /**
     * Sets the cost of a receipt line and moves the average by the weighted-average rule. The
     * movement posted at receipt is not touched; the change is one {@code stock_cost_adjustment}
     * row per line, or per piece for one-of-a-kind stock. A repeated key changes nothing.
     *
     * <p>The caller holds the lock on the receipt row. Here the variant row is locked and the
     * line is read after that lock, so two cost changes on one variant apply one after the
     * other and reach the same result in either order.
     *
     * @throws ConflictException (409) COST_NEGATIVE when the average would fall below zero: it
     *                           is left as it was and an alert is raised
     */
    @Transactional
    public List<StockCostAdjustment> applyReceiptCost(ReceiptCostChange change) {
        if (change == null || isBlank(change.instituteId()) || isBlank(change.receiptLineId())
                || isBlank(change.idempotencyKey()) || change.reason() == null || change.source() == null
                || !change.source().isKnown()) {
            throw new IllegalArgumentException("stock cost: institute, receipt line, key, reason and a known "
                    + "cost source are required");
        }
        requireKey(change.idempotencyKey());
        BigDecimal newCost = requireCost(change.newUnitCost(), "unit_cost");
        String instituteId = change.instituteId();

        LineRow line = receiptLineRepository.findRow(instituteId, change.receiptLineId())
                .orElseThrow(() -> new InvalidRequestException("This receipt line does not belong to this institute"));
        String packageSessionId = line.getPackageSessionId();
        VariantFacts variant = variantRepository.findFacts(instituteId, packageSessionId)
                .orElseThrow(() -> new InvalidRequestException("This item is not a shop product of this institute"));
        LocalDate bookDate = change.bookDate() != null ? change.bookDate() : clock.today(instituteId);
        boolean supplier = ReceiptSourceKind.SUPPLIER.name().equals(line.getSourceKind());
        List<StockCostAdjustment> written = new ArrayList<>();

        if (StockMode.PIECE.name().equals(variant.getStockMode())) {
            requirePosted(line);
            List<PieceRow> pieces = new ArrayList<>(pieceRepository.findRowsByReceiptLine(instituteId, line.getId()));
            if (!isBlank(change.pieceId())) {
                pieces.removeIf(piece -> !change.pieceId().equals(piece.getId()));
                if (pieces.isEmpty()) {
                    throw new InvalidRequestException("This piece is not on this receipt line");
                }
            }
            for (PieceRow listed : pieces) {
                // A change that names its piece already carries the piece in its key; adding it
                // again could pass the 160 characters of the column.
                String key = isBlank(change.pieceId()) ? change.idempotencyKey() + ":" + listed.getId()
                        : change.idempotencyKey();
                Optional<StockCostAdjustment> done = costAdjustmentRepository
                        .findByInstituteIdAndIdempotencyKey(instituteId, key);
                if (done.isPresent()) {
                    written.add(done.get());
                    continue;
                }
                PieceRow piece = pieceRepository.lockRow(instituteId, listed.getId()).orElse(listed);
                BigDecimal oldCost = piece.getUnitCost();
                boolean stillOurs = PieceStatus.IN_STOCK.name().equals(piece.getStatus())
                        || PieceStatus.RESERVED.name().equals(piece.getStatus())
                        || PieceStatus.IN_TRANSIT.name().equals(piece.getStatus());
                BigDecimal variance = stillOurs ? BigDecimal.ZERO
                        : newCost.subtract(oldCost == null ? BigDecimal.ZERO : oldCost);
                pieceRepository.setUnitCost(instituteId, piece.getId(), newCost);
                written.add(saveAdjustment(instituteId, packageSessionId, piece.getId(), null, line.getId(),
                        change.billLineId(), 1, oldCost, newCost, stillOurs ? 1 : 0, null, null,
                        StockCostMath.money(variance), change.reason(), change.actorUserId(), key, bookDate));
            }
            if (isBlank(change.pieceId())) {
                receiptLineRepository.setCost(instituteId, line.getId(), newCost, change.source().name());
            }
        } else {
            Optional<StockCostAdjustment> done = costAdjustmentRepository
                    .findByInstituteIdAndIdempotencyKey(instituteId, change.idempotencyKey());
            if (done.isPresent()) {
                return List.of(done.get());
            }
            VariantCost locked = variantRepository.lockCost(instituteId, packageSessionId)
                    .orElseThrow(() -> new IllegalStateException("variant row is missing: " + packageSessionId));
            done = costAdjustmentRepository.findByInstituteIdAndIdempotencyKey(instituteId, change.idempotencyKey());
            if (done.isPresent()) {
                return List.of(done.get());
            }
            // Fresh, under the variant lock: an earlier change of this line is visible now.
            line = receiptLineRepository.findRow(instituteId, change.receiptLineId()).orElse(line);
            requirePosted(line);
            long quantityNow = quantityEverywhere(instituteId, packageSessionId);
            BigDecimal oldAverage = locked.getCostPrice();
            StockCostMath.Change result;
            try {
                result = StockCostMath.costKnownLater(oldAverage, quantityNow, line.getUnitCost(), newCost,
                        line.getQtyReceived());
            } catch (StockCostMath.NegativeAverageException e) {
                alertNegativeAverage(instituteId, packageSessionId, line.getId(), e.getMessage());
                throw new ConflictException("COST_NEGATIVE: this cost would make the average cost negative; "
                        + "nothing was changed");
            }
            if (!StockCostMath.same(oldAverage, result.newAverage())) {
                variantRepository.setCostPrice(instituteId, packageSessionId, result.newAverage());
            }
            receiptLineRepository.setCost(instituteId, line.getId(), newCost, change.source().name());
            String movementId = movementRepository
                    .findByInstituteIdAndIdempotencyKey(instituteId, receiptKey(line.getId(), null))
                    .map(StockMovement::getId).orElse(null);
            written.add(saveAdjustment(instituteId, packageSessionId, null, movementId, line.getId(),
                    change.billLineId(), line.getQtyReceived(), line.getUnitCost(), newCost,
                    clampToInt(quantityNow), oldAverage, result.newAverage(), result.variance(), change.reason(),
                    change.actorUserId(), change.idempotencyKey(), bookDate));
        }
        if (supplier) {
            variantRepository.setLastPurchaseCost(instituteId, packageSessionId, newCost);
        }
        return written;
    }

    /**
     * Stamps the cost a receipt line carries right after its movement was posted with no stated
     * cost: the running average as a stand-in (PROVISIONAL), or nothing (NONE).
     */
    @Transactional
    public void stampReceiptLineCost(String instituteId, String receiptLineId, BigDecimal unitCost) {
        CostSource source = unitCost == null ? CostSource.NONE : CostSource.PROVISIONAL;
        receiptLineRepository.setCost(instituteId, receiptLineId, StockCostMath.cost(unitCost), source.name());
    }

    /**
     * "Set standard cost": the figure goods take when they arrive with no bill and no typed
     * cost. For quantity stock with no average yet it is also the starting average, which is
     * what the item-costs import relies on. A repeated key changes nothing.
     */
    @Transactional
    public StockCostAdjustment setStandardCost(String instituteId, String packageSessionId, BigDecimal standardCost,
                                               String actorUserId, String idempotencyKey) {
        requireKey(idempotencyKey);
        BigDecimal newCost = requireCost(standardCost, "standard_cost");
        VariantFacts variant = variantRepository.findFacts(instituteId, packageSessionId)
                .orElseThrow(() -> new InvalidRequestException("This item is not a shop product of this institute"));
        Optional<StockCostAdjustment> done = costAdjustmentRepository
                .findByInstituteIdAndIdempotencyKey(instituteId, idempotencyKey);
        if (done.isPresent()) {
            return done.get();
        }
        VariantCost locked = variantRepository.lockCost(instituteId, packageSessionId)
                .orElseThrow(() -> new IllegalStateException("variant row is missing: " + packageSessionId));
        done = costAdjustmentRepository.findByInstituteIdAndIdempotencyKey(instituteId, idempotencyKey);
        if (done.isPresent()) {
            return done.get();
        }
        variantRepository.setStandardCost(instituteId, packageSessionId, newCost);
        BigDecimal oldAverage = locked.getCostPrice();
        BigDecimal newAverage = oldAverage;
        boolean quantityStock = !StockMode.PIECE.name().equals(variant.getStockMode());
        Integer quantityNow = null;
        if (quantityStock) {
            quantityNow = clampToInt(quantityEverywhere(instituteId, packageSessionId));
            if (oldAverage == null) {
                newAverage = newCost;
                variantRepository.setCostPrice(instituteId, packageSessionId, newAverage);
            }
        }
        return saveAdjustment(instituteId, packageSessionId, null, null, null, null, 0,
                locked.getStandardCost(), newCost, quantityNow, quantityStock ? oldAverage : null,
                quantityStock ? newAverage : null, StockCostMath.money(BigDecimal.ZERO),
                CostAdjustmentReason.STANDARD_SET, actorUserId, idempotencyKey, clock.today(instituteId));
    }

    /** The idempotency key of the movement a receipt line (or one of its pieces) posts. */
    public static String receiptKey(String receiptLineId, String pieceId) {
        return "RECEIPT:" + receiptLineId + (isBlank(pieceId) ? "" : ":" + pieceId);
    }

    /** The key of the movement that undoes it. */
    public static String receiptReversalKey(String receiptLineId, String pieceId) {
        return "RECEIPT_REVERSAL:" + receiptLineId + (isBlank(pieceId) ? "" : ":" + pieceId);
    }

    // ── internals ───────────────────────────────────────────────────────────

    private StockCostAdjustment saveAdjustment(String instituteId, String packageSessionId, String pieceId,
                                               String movementId, String receiptLineId, String billLineId,
                                               int quantity, BigDecimal oldUnitCost, BigDecimal newUnitCost,
                                               Integer quantityAtChange, BigDecimal oldAverage,
                                               BigDecimal newAverage, BigDecimal variance,
                                               CostAdjustmentReason reason, String actorUserId, String key) {
        return saveAdjustment(instituteId, packageSessionId, pieceId, movementId, receiptLineId, billLineId,
                quantity, oldUnitCost, newUnitCost, quantityAtChange, oldAverage, newAverage, variance, reason,
                actorUserId, key, clock.today(instituteId));
    }

    private StockCostAdjustment saveAdjustment(String instituteId, String packageSessionId, String pieceId,
                                               String movementId, String receiptLineId, String billLineId,
                                               int quantity, BigDecimal oldUnitCost, BigDecimal newUnitCost,
                                               Integer quantityAtChange, BigDecimal oldAverage,
                                               BigDecimal newAverage, BigDecimal variance,
                                               CostAdjustmentReason reason, String actorUserId, String key,
                                               LocalDate bookDate) {
        StockCostAdjustment row = new StockCostAdjustment();
        row.setInstituteId(instituteId);
        row.setPackageSessionId(packageSessionId);
        row.setPieceId(pieceId);
        row.setMovementId(movementId);
        row.setReceiptLineId(receiptLineId);
        row.setBillLineId(billLineId);
        row.setQuantity(quantity);
        row.setOldUnitCost(oldUnitCost);
        row.setNewUnitCost(newUnitCost);
        row.setQtyOnHandAtChange(quantityAtChange);
        row.setOldAverage(oldAverage);
        row.setNewAverage(newAverage);
        row.setVarianceAmount(variance == null ? StockCostMath.money(BigDecimal.ZERO) : variance);
        row.setBookDate(bookDate);
        row.setReason(reason.name());
        row.setActorUserId(actorUserId);
        row.setIdempotencyKey(key);
        return costAdjustmentRepository.save(row);
    }

    private static void requirePosted(LineRow line) {
        if (!ReceiptStatus.POSTED.name().equals(line.getReceiptStatus())) {
            throw new ConflictException("RECEIPT_REVERSED: this receipt was reversed and takes no cost");
        }
    }

    private void alertNegativeAverage(String instituteId, String packageSessionId, String receiptLineId,
                                      String detail) {
        log.error("Stock cost change refused: negative average for variant {} of institute {} (receipt line {}): {}",
                packageSessionId, instituteId, receiptLineId, detail);
        try {
            SentryLogger.logWarning("Commerce stock: a cost change was refused because the average would be negative",
                    Map.of("instituteId", instituteId, "packageSessionId", packageSessionId,
                            "receiptLineId", receiptLineId));
        } catch (RuntimeException e) {
            log.warn("Could not raise the negative-average alert: {}", e.getMessage());
        }
    }

    private static void validate(StockPosting posting) {
        if (posting == null || isBlank(posting.getInstituteId()) || isBlank(posting.getLocationId())
                || isBlank(posting.getPackageSessionId()) || posting.getType() == null) {
            throw new InvalidRequestException("A stock movement needs an institute, a location, an item and a type");
        }
        if (posting.getQuantityDelta() == 0) {
            throw new InvalidRequestException("A stock movement cannot be for zero units");
        }
        requireKey(posting.getIdempotencyKey());
        StockMovementType type = posting.getType();
        boolean reversal = !isBlank(posting.getReversesMovementId());
        int delta = posting.getQuantityDelta();
        // A correction is a row of the same type with the opposite sign. ADJUSTMENT goes both ways.
        boolean naturallyIn = type == StockMovementType.RECEIPT || type == StockMovementType.TRANSFER_IN
                || type == StockMovementType.RETURN;
        if (type != StockMovementType.ADJUSTMENT && ((delta > 0) == naturallyIn) == reversal) {
            throw new InvalidRequestException("The direction of this " + type + " movement is wrong; "
                    + "a correction must name the movement it undoes");
        }
        if (posting.getUnitCost() != null && posting.getUnitCost().signum() < 0) {
            throw new InvalidRequestException("unit_cost cannot be negative");
        }
        requireLength(posting.getReason(), MAX_NAME_LENGTH, "reason");
        requireLength(posting.getReferenceType(), MAX_NAME_LENGTH, "reference_type");
        requireLength(posting.getReferenceId(), MAX_REFERENCE_ID_LENGTH, "reference_id");
    }

    private static void requireKey(String key) {
        if (isBlank(key) || key.length() > MAX_KEY_LENGTH) {
            throw new InvalidRequestException("An idempotency key of at most " + MAX_KEY_LENGTH
                    + " characters is required");
        }
    }

    private static BigDecimal requireCost(BigDecimal value, String field) {
        if (value == null || value.signum() < 0 || value.scale() > StockCostMath.COST_SCALE
                || value.precision() - value.scale() > 10) {
            throw new InvalidRequestException(field + " must be zero or more, with at most four decimals");
        }
        return StockCostMath.cost(value);
    }

    private static void requireLength(String value, int max, String field) {
        if (value != null && value.length() > max) {
            throw new InvalidRequestException(field + " is longer than " + max + " characters");
        }
    }

    private static int clampToInt(long value) {
        return (int) Math.max(Integer.MIN_VALUE, Math.min(Integer.MAX_VALUE, value));
    }

    private static String blankToNull(String value) {
        return isBlank(value) ? null : value;
    }

    private static boolean isBlank(String value) {
        return value == null || value.isBlank();
    }
}
