package vacademy.io.admin_core_service.features.commerce.stock.dto;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;

import java.math.BigDecimal;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Requests and answers of the stock operations ({@code /commerce/v1/stock/transfers},
 * {@code /stock/counts}, {@code /stock/overview}, {@code /stock/low}, {@code /stock/variants},
 * {@code /stock/approvers}). Field names are snake case; nulls are left out. Times are the
 * ISO text of the stored timestamp. No answer here carries a cost, a standard cost or a cost
 * price; the money a count review shows ({@code value*}) is set only for cost viewers.
 */
public final class StockOpsDtos {

    private StockOpsDtos() {
    }

    // ================================================================== shared

    /**
     * Who is asking, as the controllers worked it out after the access guard passed. Not JSON.
     *
     * @param visibleLocationIds null for an institute ADMIN (every location)
     */
    public record Caller(String userId, boolean admin, boolean manager, boolean stockStaff, boolean seesCost,
                         Set<String> visibleLocationIds) {

        /** May read what happens at the location. */
        public boolean reads(String locationId) {
            return admin || (visibleLocationIds != null && locationId != null && visibleLocationIds.contains(locationId));
        }

        /** May move stock at the location (manager or warehouse staff assigned there, or ADMIN). */
        public boolean actsAt(String locationId) {
            return admin || (stockStaff && reads(locationId));
        }
    }

    /** A manager's PIN given with a request (the admin app's {@code ManagerApproval}). */
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record Approval(String approverUserId, String pin, String reason) {

        /** Never prints the PIN. */
        @Override
        public String toString() {
            return "Approval[approverUserId=" + approverUserId + ", pin=" + (pin == null ? "null" : "***")
                    + ", reason=" + reason + "]";
        }
    }

    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record PlaceRef(String id, String code, String name, String gstin) {
    }

    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record LocationRef(String id, String name) {
    }

    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record CollectionRef(String id, String name) {
    }

    // ================================================================== transfers

    /** {@code {package_session_id, quantity}} for a quantity item, or {@code {piece_id}} / {@code {piece_code}}. */
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record TransferLineInput(String packageSessionId, Integer quantity, String pieceId, String pieceCode,
                                    String note) {
    }

    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record TransferCreateRequest(String clientRequestId, String fromLocationId, String toLocationId,
                                        String note, List<TransferLineInput> lines) {
    }

    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record TransferUpdateRequest(String clientRequestId, String toLocationId, String note,
                                        List<TransferLineInput> lines) {
    }

    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record CancelRequest(String clientRequestId, String reason) {
    }

    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record TransferDispatchRequest(String clientRequestId, String ewayBillNo, String documentType,
                                          String documentNumber, Boolean confirmPromisedOnline) {
    }

    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record ReceiveLineInput(String lineId, Integer qtyReceived, String shortfallReason) {
    }

    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record TransferReceiveRequest(String clientRequestId, List<ReceiveLineInput> lines, String note,
                                         Approval approval) {

        /** The body the request hash is taken over: the PIN is resent under the same key. */
        public TransferReceiveRequest withoutApproval() {
            return new TransferReceiveRequest(clientRequestId, lines, note, null);
        }
    }

    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record TransferLineView(String id, String packageSessionId, String sku, String itemName,
                                   String variantName, String stockMode, String unit, Integer qtyScale,
                                   String pieceId, String pieceCode, Integer qtySent, Integer qtyReceived,
                                   String shortfallReason, BigDecimal unitValue, BigDecimal lineValue,
                                   String hsnCode) {
    }

    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record TransferTotals(long qtySent, Long qtyReceived, BigDecimal value) {
    }

    /** Units that left an online location although they were held or sold online. */
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record Shortfall(String packageSessionId, int units) {
    }

    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record TransferView(String id, String transferNumber, String status, PlaceRef from, PlaceRef to,
                               boolean gstinDiffers, String documentType, String documentNumber,
                               String documentDate, String ewayBillNo, String note, String receiveNote,
                               String createdBy, String createdAt, String dispatchedAt, String dispatchedBy,
                               String receivedAt, String receivedBy, String cancelledAt,
                               List<TransferLineView> lines, TransferTotals totals, boolean overdue,
                               List<String> warnings, List<String> nextActions, List<Shortfall> sellableShortfall,
                               Boolean replayed) {

        public TransferView withReplayed() {
            return new TransferView(id, transferNumber, status, from, to, gstinDiffers, documentType, documentNumber,
                    documentDate, ewayBillNo, note, receiveNote, createdBy, createdAt, dispatchedAt, dispatchedBy,
                    receivedAt, receivedBy, cancelledAt, lines, totals, overdue, warnings, nextActions,
                    sellableShortfall, Boolean.TRUE);
        }

        public TransferView withShortfall(List<Shortfall> shortfall) {
            return new TransferView(id, transferNumber, status, from, to, gstinDiffers, documentType, documentNumber,
                    documentDate, ewayBillNo, note, receiveNote, createdBy, createdAt, dispatchedAt, dispatchedBy,
                    receivedAt, receivedBy, cancelledAt, lines, totals, overdue, warnings, nextActions, shortfall,
                    replayed);
        }
    }

    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record TransferRow(String id, String transferNumber, String status, PlaceRef from, PlaceRef to,
                              String documentNumber, long lineCount, long qtySent, String createdAt,
                              String dispatchedAt, String receivedAt, boolean overdue) {
    }

    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record TransfersAnswer(List<TransferRow> transfers, int page, int size, long total) {
    }

    /** {@code POST /stock/challan-series}. */
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record ChallanSeriesRequest(String prefix, String locationId, Long nextValue, String financialYear) {
    }

    // ================================================================== counts

    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record CountCreateRequest(String clientRequestId, String locationId, String kind,
                                     String scopeCollectionId, String recountOfCountId, String note) {
    }

    /**
     * {@code {package_session_id, mode: SET|ADD, quantity}}, or {@code {piece_code}} / {@code {piece_id}}.
     * {@code explicit_quantity}: the person typed the quantity (an ADD of a measured item needs it).
     */
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record CountLineInput(String packageSessionId, String mode, Integer quantity, String pieceCode,
                                 String pieceId, Boolean explicitQuantity) {
    }

    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record CountLinesRequest(String clientRequestId, List<CountLineInput> lines) {
    }

    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    @JsonInclude(JsonInclude.Include.NON_NULL)
    /**
     * {@code review_fingerprint}: the {@code fingerprint} of the review the person (and the manager
     * giving a PIN) looked at; when sent, a count whose lines changed since is refused, and with
     * {@code uncounted: ZERO} also one where more would be written off than was reviewed.
     * {@code reviewed_zero}: the review's {@code zero_write_off}, sent back with a ZERO post, so a
     * sale since the review posts (writing off only what is left) while stock that arrived since
     * is refused. A ZERO post needs both {@code review_fingerprint} (with its uncounted part) and
     * {@code reviewed_zero}.
     */
    public record CountPostRequest(String clientRequestId, String uncounted, Approval approval,
                                   Boolean confirmMeasured, String reviewFingerprint, ZeroWriteOff reviewedZero) {

        public CountPostRequest(String clientRequestId, String uncounted, Approval approval, Boolean confirmMeasured,
                                String reviewFingerprint) {
            this(clientRequestId, uncounted, approval, confirmMeasured, reviewFingerprint, null);
        }

        /** The body the request hash is taken over: the PIN and the confirm are resent under the same key. */
        public CountPostRequest withoutApproval() {
            return new CountPostRequest(clientRequestId, uncounted, null, null, reviewFingerprint, reviewedZero);
        }
    }

    /**
     * What {@code uncounted: ZERO} would write off at the review: each uncounted item's stock here
     * ({@code items}, package_session_id to units), the pieces nobody scanned ({@code pieces}) and,
     * per item, the units that had come in at the location since the count started
     * ({@code incoming}): stock that comes in after the review is never written off.
     */
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record ZeroWriteOff(Map<String, Integer> items, List<String> pieces, Map<String, Integer> incoming) {

        public ZeroWriteOff(Map<String, Integer> items, List<String> pieces) {
            this(items, pieces, null);
        }
    }

    /** {@code POST /counts/{id}/lines/{lineId}/accept}: the counted quantity the manager looked at. */
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record AcceptLineRequest(Integer countedQty) {
    }

    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record CountLineView(String id, String packageSessionId, String sku, String itemName, String variantName,
                                String stockMode, String unit, Integer qtyScale, String pieceId, String pieceCode,
                                Integer countedQty, String countedAt, String countedBy) {
    }

    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record CountLinesAnswer(List<CountLineView> lines, long lineCount, Boolean replayed) {
    }

    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record LineCountAnswer(long lineCount) {
    }

    /** A blind recount against the count it rechecks; {@code passes} at 98 % or more. */
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record Agreement(int compared, int agreeing, BigDecimal percent, boolean passes) {
    }

    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record RecountRef(String id, String status, Agreement agreement) {
    }

    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record CountView(String id, String countNumber, String kind, String status, LocationRef location,
                            CollectionRef scopeCollection, String recountOfCountId, RecountRef recount, String note,
                            String startedBy, String startedAt, String postedAt, String postedBy,
                            String uncountedChoice, Map<String, Object> summary, List<CountLineView> lines,
                            long lineCount, List<String> nextActions, Boolean replayed) {

        public CountView withReplayed() {
            return new CountView(id, countNumber, kind, status, location, scopeCollection, recountOfCountId, recount,
                    note, startedBy, startedAt, postedAt, postedBy, uncountedChoice, summary, lines, lineCount,
                    nextActions, Boolean.TRUE);
        }
    }

    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    @JsonInclude(JsonInclude.Include.NON_NULL)
    /** {@code next_actions}: what the caller may do with the count, as on the count itself (e.g. RECOUNT). */
    public record CountRow(String id, String countNumber, String kind, String status, LocationRef location,
                           CollectionRef scopeCollection, String startedBy, String startedAt, String postedAt,
                           long lineCount, String recountOfCountId, List<String> nextActions) {
    }

    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record CountsAnswer(List<CountRow> counts, int page, int size, long total) {
    }

    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record ReviewLine(String lineId, String packageSessionId, String sku, String itemName, String variantName,
                             String stockMode, String unit, Integer qtyScale, String pieceCode, Integer countedQty,
                             String countedAt, String firstCountedAt, Integer onHandNow, Integer movedSince,
                             Integer packedUnshipped, Integer expectedAtCount, Integer adjustment, BigDecimal value,
                             Integer movedWhileCounting, List<String> flags, String acceptedBy) {
    }

    /** Review flags of a line. */
    public static final String FLAG_NEEDS_RECOUNT = "NEEDS_RECOUNT";
    public static final String FLAG_RECOUNT_ACCEPTED = "RECOUNT_ACCEPTED";
    public static final String FLAG_MEASURED_CONFIRM = "MEASURED_CONFIRM";

    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record UncountedItem(String packageSessionId, String sku, String itemName, String variantName,
                                String stockMode, String unit, Integer qtyScale, int onHandNow) {
    }

    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record ReviewPiece(String pieceId, String code, String sku, String itemName, String status,
                              String locationName) {
    }

    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record ReviewTotals(int linesWithDifference, int unitsUp, int unitsDown, BigDecimal valueUp,
                               BigDecimal valueDown) {
    }

    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record CountReview(String countId, String asOf, List<ReviewLine> lines, List<UncountedItem> uncounted,
                              List<ReviewPiece> missingPieces, List<ReviewPiece> foundPieces,
                              List<ReviewPiece> misplacedPieces, List<ReviewPiece> notInStockPieces,
                              List<ReviewPiece> reservedNotCounted, List<ReviewPiece> arrivedDuringCount,
                              ReviewTotals totals, boolean needsApproval, int needsRecount,
                              boolean measuredConfirm, String fingerprint, ZeroWriteOff zeroWriteOff) {

        public CountReview(String countId, String asOf, List<ReviewLine> lines, List<UncountedItem> uncounted,
                           List<ReviewPiece> missingPieces, List<ReviewPiece> foundPieces,
                           List<ReviewPiece> misplacedPieces, List<ReviewPiece> notInStockPieces,
                           List<ReviewPiece> reservedNotCounted, List<ReviewPiece> arrivedDuringCount,
                           ReviewTotals totals, boolean needsApproval, int needsRecount, boolean measuredConfirm,
                           String fingerprint) {
            this(countId, asOf, lines, uncounted, missingPieces, foundPieces, misplacedPieces, notInStockPieces,
                    reservedNotCounted, arrivedDuringCount, totals, needsApproval, needsRecount, measuredConfirm,
                    fingerprint, null);
        }
    }

    // ================================================================== reads

    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record LevelCell(String locationId, int onHand, Integer reorderLevel, boolean low) {
    }

    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record OverviewRow(String packageSessionId, String productId, String sku, String productName,
                              String variantName, String stockMode, String unit, Integer qtyScale, String labelCode,
                              List<LevelCell> levels, int inTransit, int heldOnline, Integer sellableOnline) {
    }

    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record OverviewLocation(String id, String code, String name) {
    }

    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record OverviewAnswer(List<OverviewLocation> locations, List<OverviewRow> rows, int page, int size,
                                 long total) {
    }

    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record Elsewhere(String locationId, String locationName, int onHand) {
    }

    /** A low-stock row: REORDER fills the level fields, OUT_ONLINE the online ones. */
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record LowRow(String locationId, String packageSessionId, String sku, String productName,
                         String variantName, String unit, Integer qtyScale, Integer onHand, Integer reorderLevel,
                         Integer shortage, String lastSaleAt, List<Elsewhere> elsewhere, Integer onlineOnHand,
                         Integer heldOnline, Integer sellableOnline) {
    }

    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record LowAnswer(String kind, List<LowRow> rows, int page, int size, long total) {
    }

    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record VariantPick(String packageSessionId, String productId, String sku, String productName,
                              Map<String, String> names, String variantName, String status, String stockMode,
                              String stockPolicy, String unit, Integer qtyScale, Integer qtyStep, String labelCode,
                              String barcode, Integer onHand) {
    }

    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record VariantsAnswer(List<VariantPick> items) {
    }

    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record Approver(String userId, String fullName) {
    }

    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record ApproversAnswer(List<Approver> approvers) {
    }
}
