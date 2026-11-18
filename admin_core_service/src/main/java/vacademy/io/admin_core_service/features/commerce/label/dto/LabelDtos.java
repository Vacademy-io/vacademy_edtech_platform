package vacademy.io.admin_core_service.features.commerce.label.dto;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;

import java.math.BigDecimal;
import java.util.List;

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

    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record LabelIdsRequest(String clientRequestId, List<String> requestIds) {
    }

    /** {@code request_ids} (1..200) or {@code receipt_id} (its PENDING rows); {@code size} STICKER_50X25 or A4_65. */
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record PrintDataRequest(List<String> requestIds, String receiptId, String size) {
    }

    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record LabelRow(String id, String locationId, String packageSessionId, String sku, String itemName,
                           String variantName, String pieceId, String pieceCode, String labelCode, int quantity,
                           String reason, String reprintReason, String note, String sourceType, String sourceId,
                           String sourceLabel, String status, String requestedBy, String createdAt, String printedAt,
                           String printedBy, boolean hasPrice) {
    }

    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record LabelsAnswer(List<LabelRow> requests, Integer page, Integer size, Long total, Boolean replayed) {
    }

    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record CancelAnswer(int cancelled, List<String> skipped, Boolean replayed) {
    }

    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record PrintedAnswer(int printed, Boolean replayed) {
    }

    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record ReplaceRow(String packageSessionId, String sku, String itemName, BigDecimal printedMrp,
                             BigDecimal currentMrp, int onHand) {
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

    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record PrintDataAnswer(String size, Names shopName, List<PrintLabel> labels, int totalCopies) {
    }
}
