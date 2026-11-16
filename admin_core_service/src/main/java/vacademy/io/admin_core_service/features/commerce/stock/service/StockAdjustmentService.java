package vacademy.io.admin_core_service.features.commerce.stock.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.admin_core_service.features.commerce.audit.CommerceAuditService;
import vacademy.io.admin_core_service.features.commerce.order.desk.CommerceStockShortFlagger;
import vacademy.io.admin_core_service.features.commerce.security.CommerceAccessDeniedException;
import vacademy.io.admin_core_service.features.commerce.security.CommerceApprovalService;
import vacademy.io.admin_core_service.features.commerce.stock.dto.AdjustmentRequest;
import vacademy.io.admin_core_service.features.commerce.stock.enums.StockMovementType;
import vacademy.io.admin_core_service.features.commerce.stock.repository.CommercePieceRepository;
import vacademy.io.admin_core_service.features.commerce.stock.repository.StockVariantRepository;
import vacademy.io.admin_core_service.features.commerce.stock.repository.StockVariantRepository.VariantFacts;
import vacademy.io.admin_core_service.features.commerce.stock.service.CommerceStockSettings.AdjustmentLimits;
import vacademy.io.common.exceptions.InvalidRequestException;

import java.math.BigDecimal;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;

/**
 * A single stock adjustment or a damage write-off. Each needs a reason.
 * Above the institute's limit on quantity or value ({@code commerce.limits.adjustmentQuantity},
 * {@code commerce.limits.adjustmentValue}) it needs a manager: either the caller is one, or a
 * manager approves with their PIN, and that approval is written in this same transaction.
 */
@Service
public class StockAdjustmentService {

    public static final String APPROVAL_REQUIRED = "APPROVAL_REQUIRED";
    public static final String ACTION_ADJUSTMENT = "STOCK_ADJUSTMENT";
    public static final String REFERENCE_ADJUSTMENT = "STOCK_ADJUSTMENT";
    private static final int MAX_QUANTITY = 10_000_000;
    private static final ObjectMapper MAPPER = new ObjectMapper();

    private final StockLedgerService ledger;
    private final StockVariantRepository variantRepository;
    private final CommercePieceRepository pieceRepository;
    private final CommerceStockSettings settings;
    private final CommerceApprovalService approvalService;
    private final CommerceAuditService auditService;

    /** Flags open orders a damage or a count left short; absent in tests built by hand. */
    @Autowired(required = false)
    private CommerceStockShortFlagger stockShortFlagger;

    public StockAdjustmentService(StockLedgerService ledger, StockVariantRepository variantRepository,
                                  CommercePieceRepository pieceRepository, CommerceStockSettings settings,
                                  CommerceApprovalService approvalService, CommerceAuditService auditService) {
        this.ledger = ledger;
        this.variantRepository = variantRepository;
        this.pieceRepository = pieceRepository;
        this.settings = settings;
        this.approvalService = approvalService;
        this.auditService = auditService;
    }

    /**
     * @param callerIsManager the caller is an institute ADMIN or a store manager
     * @throws CommerceAccessDeniedException 403 APPROVAL_REQUIRED above the limit with no
     *                                       approver; PIN_INVALID or PIN_LOCKED from the approval
     */
    @Transactional
    public StockPostResult adjust(String instituteId, String actorUserId, boolean callerIsManager,
                                  AdjustmentRequest request) {
        if (request == null) {
            throw new InvalidRequestException("Request body is required");
        }
        String clientRequestId = StockReceiptService.requireClientRequestId(request.getClientRequestId());
        String locationId = required(request.getLocationId(), "location_id");
        String packageSessionId = required(request.getPackageSessionId(), "package_session_id");
        String reason = required(request.getReason(), "reason").toUpperCase(Locale.ROOT);
        if (!reason.matches("[A-Z0-9_]{1,32}")) {
            throw new InvalidRequestException("reason must be a code of up to 32 letters, digits or _");
        }
        StockMovementType type = "DAMAGE".equalsIgnoreCase(trim(request.getKind()))
                ? StockMovementType.DAMAGE : StockMovementType.ADJUSTMENT;
        if (request.getKind() != null && !request.getKind().isBlank()
                && !type.name().equalsIgnoreCase(request.getKind().trim())) {
            throw new InvalidRequestException("kind must be ADJUSTMENT or DAMAGE");
        }
        Integer raw = request.getQuantityDelta();
        if (raw == null || raw == 0 || Math.abs((long) raw) > MAX_QUANTITY) {
            throw new InvalidRequestException("quantity_delta must be a whole number other than zero");
        }
        // Damage is always a loss, however the number was typed.
        int delta = type == StockMovementType.DAMAGE ? -Math.abs(raw) : raw;
        int quantity = Math.abs(delta);

        // A second delivery of the same request: nothing to approve or post again.
        var posted = ledger.findPosted(instituteId, "ADJ:" + clientRequestId);
        if (posted.isPresent()) {
            return StockPostResult.repeated(posted.get());
        }

        VariantFacts variant = variantRepository.findFacts(instituteId, packageSessionId)
                .orElseThrow(() -> new InvalidRequestException("ITEM_NOT_FOUND: this item does not belong to this institute"));
        String pieceId = trim(request.getPieceId());
        BigDecimal unitCost = variant.getCostPrice();
        if (pieceId != null) {
            unitCost = pieceRepository.findRow(instituteId, pieceId)
                    .orElseThrow(() -> new InvalidRequestException("PIECE_NOT_FOUND: this piece does not belong to this institute"))
                    .getUnitCost();
        }
        BigDecimal value = unitCost == null ? null
                : StockCostMath.money(unitCost.multiply(BigDecimal.valueOf(quantity)));

        AdjustmentLimits limits = settings.adjustmentLimits(instituteId);
        boolean overLimit = (limits.quantity() != null && quantity > limits.quantity())
                // No cost yet means the value cannot be shown to be under the limit.
                || (limits.value() != null && (value == null || value.compareTo(limits.value()) > 0));
        String approvedBy = null;
        if (overLimit && !callerIsManager) {
            if (isBlank(request.getApproverUserId()) || isBlank(request.getApproverPin())) {
                throw new CommerceAccessDeniedException(APPROVAL_REQUIRED,
                        "this adjustment is above your limit and needs a manager");
            }
            approvalService.approve(instituteId, locationId, actorUserId, request.getApproverUserId().trim(),
                    request.getApproverPin(), ACTION_ADJUSTMENT, REFERENCE_ADJUSTMENT, clientRequestId, value, reason);
            approvedBy = request.getApproverUserId().trim();
        }

        StockPostResult result = ledger.post(StockPosting.builder()
                .instituteId(instituteId)
                .locationId(locationId)
                .packageSessionId(packageSessionId)
                .pieceId(pieceId)
                .type(type)
                .quantityDelta(delta)
                .reason(reason)
                .note(trim(request.getNote()))
                .referenceType(REFERENCE_ADJUSTMENT)
                .referenceId(clientRequestId)
                .actorUserId(actorUserId)
                .idempotencyKey("ADJ:" + clientRequestId)
                .build());
        if (result.isUntracked()) {
            throw new InvalidRequestException("ITEM_UNTRACKED: this item is not counted and cannot be adjusted");
        }
        if (result.created() && result.sellableShortfall() > 0 && stockShortFlagger != null) {
            // After this transaction commits: open orders of this variant here are short.
            stockShortFlagger.afterCommit(instituteId, locationId, packageSessionId, result.sellableShortfall());
        }
        if (result.created()) {
            Map<String, Object> audit = new LinkedHashMap<>();
            audit.put("type", type.name());
            audit.put("package_session_id", packageSessionId);
            audit.put("piece_id", pieceId);
            audit.put("quantity_delta", delta);
            audit.put("balance_after", result.movement().getBalanceAfter());
            audit.put("over_limit", overLimit);
            audit.put("approved_by", approvedBy);
            auditService.record(instituteId, actorUserId, locationId, type == StockMovementType.DAMAGE
                            ? "STOCK_DAMAGE" : "STOCK_ADJUSTMENT", REFERENCE_ADJUSTMENT,
                    result.movement().getId(), null, json(audit), reason);
        }
        return result;
    }

    private static String required(String raw, String field) {
        String value = trim(raw);
        if (value == null || value.length() > 255) {
            throw new InvalidRequestException(field + " is required");
        }
        return value;
    }

    private static String trim(String value) {
        return value == null || value.isBlank() ? null : value.trim();
    }

    private static boolean isBlank(String value) {
        return value == null || value.isBlank();
    }

    private static String json(Object value) {
        try {
            return MAPPER.writeValueAsString(value);
        } catch (JsonProcessingException e) {
            throw new IllegalStateException("could not write an adjustment as JSON", e);
        }
    }
}
