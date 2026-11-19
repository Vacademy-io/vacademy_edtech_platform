package vacademy.io.admin_core_service.features.commerce.label.dto;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;

import java.math.BigDecimal;
import java.util.List;
import java.util.Map;

/**
 * Requests and answers of the label queue ({@code /commerce/v1/labels}). Snake case, nulls left
 * out. Labels are drawn by the browser from {@link PrintDataAnswer} (Hindi names need the
 * browser's text shaping); no answer here carries a cost.
 */
public final class LabelDtos {

    private LabelDtos() {
    }

    /** {@code {package_session_id, quantity}} for a variant, or {@code {piece_id}} / {@code {piece_code}}. */
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record LabelLineInput(String packageSessionId, Integer quantity, String pieceId, String pieceCode) {
    }

    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record LabelRequestsRequest(String clientRequestId, String locationId, String reason,
                                       String reprintReason, String note, List<LabelLineInput> lines) {
    }

    /**
     * Ids to cancel or mark printed. {@code printed_copies} (mark-printed only): for a row that a
     * print drew in part (print-data's {@code left_out}), how many of its labels were drawn; the
     * row keeps waiting with the rest. A row not named in it is printed in full.
     */
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record LabelIdsRequest(String clientRequestId, List<String> requestIds, Map<String, Integer> printedCopies) {

        public LabelIdsRequest(String clientRequestId, List<String> requestIds) {
            this(clientRequestId, requestIds, null);
        }
    }

    /** {@code request_ids} (1..200) or {@code receipt_id} (its PENDING rows); {@code size} STICKER_50X25 or A4_65. */
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record PrintDataRequest(List<String> requestIds, String receiptId, String size) {
    }

    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record LabelRow(String id, String locationId, String packageSessionId, String sku, String itemName,
                           String variantName, String stockMode, String unit, Integer qtyScale, String pieceId,
                           String pieceCode, String labelCode, int quantity, String reason, String reprintReason,
                           String note, String sourceType, String sourceId, String sourceLabel, String status,
                           String requestedBy, String createdAt, String printedAt, String printedBy,
                           boolean hasPrice) {
    }

    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record LabelsAnswer(List<LabelRow> requests, Integer page, Integer size, Long total, Boolean replayed) {
    }

    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record CancelAnswer(int cancelled, List<String> skipped, Boolean replayed) {
    }

    /** {@code partly}: rows marked for part of their labels; they keep waiting with the rest. */
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record PrintedAnswer(int printed, List<String> skipped, Boolean replayed, List<String> partly) {

        public PrintedAnswer(int printed, List<String> skipped, Boolean replayed) {
            this(printed, skipped, replayed, null);
        }
    }

    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    @JsonInclude(JsonInclude.Include.NON_NULL)
    /**
     * A variant whose shelf labels show an old MRP. {@code labels}: how many to queue (PIECE: the
     * pieces on the shelf, one each; measured: one per roll, 1; quantity: on hand, at most 500, then
     * {@code capped}).
     */
    public record ReplaceRow(String packageSessionId, String sku, String itemName, String stockMode, String unit,
                             Integer qtyScale, BigDecimal printedMrp, BigDecimal currentMrp, int onHand, int labels,
                             boolean capped, boolean hasPrice) {
    }

    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record ReplaceAnswer(List<ReplaceRow> rows) {
    }

    /** A text in English and Hindi; either is null when the shop has not written it. */
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    @JsonInclude(JsonInclude.Include.ALWAYS)
    public record Names(String en, String hi) {
    }

    /**
     * One label to draw, {@code copies} times. {@code code} is the scan code the till and the
     * pack station resolve (piece code or variant label code); {@code qr_value} is what the QR
     * holds ({@code <shop link base>/q/<code>}, or the bare code). {@code price} and {@code mrp}
     * are per display unit ({@code unit}; per base unit x {@code qty_scale}), tax included.
     */
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record PrintLabel(String requestId, String code, String qrValue, String sku, Names productName,
                             Names variantName, BigDecimal price, BigDecimal mrp, String currency, String unit,
                             int qtyScale, int copies, String pieceId) {
    }

    /** A row that was not drawn, and why ({@code NO_PRICE}: a manager sets the price first). */
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record SkippedLabel(String requestId, String sku, String reason) {
    }

    /**
     * Labels of a row that did not fit this print (at most 500 labels at once): {@code copies} of
     * them were not drawn. They stay waiting; the next print draws them.
     */
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record LeftOutLabel(String requestId, String sku, int copies) {
    }

    /**
     * {@code labels}: at most 500 copies in all. A row that does not fit is drawn in part or not
     * at all and listed in {@code left_out} ({@code left_out_copies} labels in all).
     */
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record PrintDataAnswer(String size, Names shopName, List<PrintLabel> labels, int totalCopies,
                                  List<SkippedLabel> skipped, List<LeftOutLabel> leftOut, Integer leftOutCopies) {

        public PrintDataAnswer(String size, Names shopName, List<PrintLabel> labels, int totalCopies,
                               List<SkippedLabel> skipped) {
            this(size, shopName, labels, totalCopies, skipped, null, null);
        }
    }
}
