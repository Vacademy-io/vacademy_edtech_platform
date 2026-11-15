package vacademy.io.admin_core_service.features.commerce.stock.service;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.admin_core_service.features.commerce.stock.entity.CommercePiece;
import vacademy.io.admin_core_service.features.commerce.stock.entity.StockMovement;
import vacademy.io.admin_core_service.features.commerce.stock.enums.PieceStatus;
import vacademy.io.admin_core_service.features.commerce.stock.enums.StockMovementType;
import vacademy.io.admin_core_service.features.commerce.stock.repository.CommercePieceRepository;
import vacademy.io.admin_core_service.features.commerce.stock.repository.CommercePieceRepository.PieceRow;
import vacademy.io.admin_core_service.features.commerce.stock.repository.StockLevelRepository;
import vacademy.io.admin_core_service.features.commerce.stock.repository.StockLevelRepository.LevelRow;
import vacademy.io.admin_core_service.features.commerce.stock.repository.StockMovementRepository;
import vacademy.io.admin_core_service.features.commerce.stock.repository.StockVariantRepository;
import vacademy.io.admin_core_service.features.commerce.stock.repository.StockVariantRepository.VariantFacts;
import vacademy.io.common.exceptions.InvalidRequestException;
import vacademy.io.common.exceptions.VacademyException;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;

/**
 * Stock reads for the admin screens: levels, the ledger, pieces and the scan lookup. Every
 * query is filtered by the institute, and by the caller's locations when the caller is not an
 * institute ADMIN ({@code locationIds} null means every location). Page size is capped.
 */
@Service
public class StockQueryService {

    public static final int MAX_PAGE_SIZE = 100;
    private static final List<String> NO_FILTER = List.of("-");

    private final StockLevelRepository levelRepository;
    private final StockMovementRepository movementRepository;
    private final CommercePieceRepository pieceRepository;
    private final StockVariantRepository variantRepository;

    public StockQueryService(StockLevelRepository levelRepository, StockMovementRepository movementRepository,
                             CommercePieceRepository pieceRepository, StockVariantRepository variantRepository) {
        this.levelRepository = levelRepository;
        this.movementRepository = movementRepository;
        this.pieceRepository = pieceRepository;
        this.variantRepository = variantRepository;
    }

    @Transactional(readOnly = true)
    public Page<Map<String, Object>> levels(String instituteId, Collection<String> locationIds,
                                            String packageSessionId, boolean lowOnly, String search,
                                            int page, int size) {
        if (locationIds != null && locationIds.isEmpty()) {
            return Page.empty();
        }
        boolean all = locationIds == null;
        String q = blankToNull(search);
        if (q != null) {
            q = "%" + q.toLowerCase(Locale.ROOT).replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%";
        }
        Page<LevelRow> rows = levelRepository.search(instituteId, all, all ? NO_FILTER : locationIds,
                blankToNull(packageSessionId), lowOnly, q, PageRequest.of(Math.max(page, 0), pageSize(size)));
        return rows.map(row -> {
            Map<String, Object> out = new LinkedHashMap<>();
            out.put("location_id", row.getLocationId());
            out.put("package_session_id", row.getPackageSessionId());
            out.put("sku", row.getSku());
            out.put("product_name", row.getProductName());
            out.put("variant_name", row.getVariantName());
            out.put("on_hand", row.getOnHand());
            out.put("reorder_level", row.getReorderLevel());
            out.put("low", row.getReorderLevel() != null && row.getOnHand() != null
                    && row.getOnHand() <= row.getReorderLevel());
            return out;
        });
    }

    @Transactional(readOnly = true)
    public Page<Map<String, Object>> movements(String instituteId, Collection<String> locationIds,
                                               String packageSessionId, String type, LocalDate from, LocalDate to,
                                               boolean withCost, int page, int size) {
        if (locationIds != null && locationIds.isEmpty()) {
            return Page.empty();
        }
        String typeName = blankToNull(type);
        if (typeName != null) {
            try {
                typeName = StockMovementType.valueOf(typeName.toUpperCase(Locale.ROOT)).name();
            } catch (IllegalArgumentException e) {
                throw new InvalidRequestException("type is not a stock movement type");
            }
        }
        // Both ends are always given: a null timestamp parameter has no type for Postgres.
        LocalDateTime fromTime = (from != null ? from : LocalDate.of(2000, 1, 1)).atStartOfDay();
        LocalDateTime toTime = (to != null ? to.plusDays(1) : LocalDate.of(2200, 1, 1)).atStartOfDay();
        boolean all = locationIds == null;
        Page<StockMovement> rows = movementRepository.search(instituteId, all, all ? NO_FILTER : locationIds,
                blankToNull(packageSessionId), typeName, fromTime, toTime,
                PageRequest.of(Math.max(page, 0), pageSize(size),
                        Sort.by(Sort.Direction.DESC, "createdAt").and(Sort.by(Sort.Direction.DESC, "id"))));
        return rows.map(movement -> movementView(movement, withCost));
    }

    /** The JSON shape of a movement. Cost is left out for staff who must not see it. */
    public static Map<String, Object> movementView(StockMovement movement, boolean withCost) {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("id", movement.getId());
        out.put("location_id", movement.getLocationId());
        out.put("package_session_id", movement.getPackageSessionId());
        out.put("piece_id", movement.getPieceId());
        out.put("type", movement.getType());
        out.put("quantity_delta", movement.getQuantityDelta());
        out.put("balance_after", movement.getBalanceAfter());
        out.put("affects_sellable", movement.isAffectsSellable());
        out.put("reference_type", movement.getReferenceType());
        out.put("reference_id", movement.getReferenceId());
        out.put("transfer_id", movement.getTransferId());
        out.put("reverses_movement_id", movement.getReversesMovementId());
        out.put("reason", movement.getReason());
        out.put("note", movement.getNote());
        out.put("actor_user_id", movement.getActorUserId());
        out.put("created_at", movement.getCreatedAt() == null ? null : movement.getCreatedAt().toString());
        if (withCost) {
            out.put("unit_cost", movement.getUnitCost());
            out.put("cost_provisional", movement.isCostProvisional());
        }
        return out;
    }

    @Transactional(readOnly = true)
    public Page<Map<String, Object>> pieces(String instituteId, Collection<String> locationIds,
                                            String packageSessionId, String status, boolean withCost,
                                            int page, int size) {
        if (locationIds != null && locationIds.isEmpty()) {
            return Page.empty();
        }
        String statusName = blankToNull(status);
        if (statusName != null) {
            try {
                statusName = PieceStatus.valueOf(statusName.toUpperCase(Locale.ROOT)).name();
            } catch (IllegalArgumentException e) {
                throw new InvalidRequestException("status is not a piece status");
            }
        }
        boolean all = locationIds == null;
        Page<CommercePiece> rows = pieceRepository.search(instituteId, all, all ? NO_FILTER : locationIds,
                blankToNull(packageSessionId), statusName,
                PageRequest.of(Math.max(page, 0), pageSize(size), Sort.by(Sort.Direction.DESC, "createdAt")));
        return rows.map(piece -> pieceView(piece.getId(), piece.getPackageSessionId(), piece.getCode(),
                piece.getLocationId(), piece.getStatus(), piece.getUnitCost(), piece.getReceiptLineId(), withCost));
    }

    /**
     * One piece. A caller limited to some locations sees a piece that is at one of them; a
     * piece that is at no location (sold, in transit, written off) is shown to any stock staff.
     */
    @Transactional(readOnly = true)
    public Map<String, Object> piece(String instituteId, Collection<String> locationIds, String pieceId,
                                     boolean withCost) {
        PieceRow piece = pieceRepository.findRow(instituteId, pieceId)
                .orElseThrow(() -> new VacademyException(HttpStatus.NOT_FOUND, "Piece not found"));
        if (locationIds != null && piece.getLocationId() != null && !locationIds.contains(piece.getLocationId())) {
            throw new VacademyException(HttpStatus.NOT_FOUND, "Piece not found");
        }
        return pieceView(piece.getId(), piece.getPackageSessionId(), piece.getCode(), piece.getLocationId(),
                piece.getStatus(), piece.getUnitCost(), piece.getReceiptLineId(), withCost);
    }

    /**
     * Resolves a scanned code: a piece code, then a variant label code, then a variant barcode.
     * Always within the institute; an unknown code is 404.
     *
     * @param withStock    piece status and location are shown (stock and till staff)
     * @param withCost     cost is shown (manager, accountant)
     */
    @Transactional(readOnly = true)
    public Map<String, Object> scan(String instituteId, String rawCode, boolean withStock, boolean withCost) {
        String typed = rawCode == null ? "" : rawCode.trim();
        if (typed.isEmpty() || typed.length() > 100) {
            throw new InvalidRequestException("A code of at most 100 characters is required");
        }
        String upper = typed.toUpperCase(Locale.ROOT);
        Map<String, Object> out = new LinkedHashMap<>();
        if (ScanCodeGenerator.looksLike(ScanCodeGenerator.PIECE_PREFIX, upper)) {
            Optional<PieceRow> piece = pieceRepository.findRowByCode(instituteId, upper);
            if (piece.isPresent()) {
                VariantFacts variant = variantRepository.findFacts(instituteId, piece.get().getPackageSessionId())
                        .orElseThrow(() -> new VacademyException(HttpStatus.NOT_FOUND, "Code not found"));
                out.put("kind", "PIECE");
                out.put("variant", variantView(variant, withCost));
                Map<String, Object> pieceOut = new LinkedHashMap<>();
                pieceOut.put("id", piece.get().getId());
                pieceOut.put("code", piece.get().getCode());
                if (withStock) {
                    pieceOut.put("status", piece.get().getStatus());
                    pieceOut.put("location_id", piece.get().getLocationId());
                }
                if (withCost) {
                    pieceOut.put("unit_cost", piece.get().getUnitCost());
                }
                out.put("piece", pieceOut);
                return out;
            }
        }
        Optional<VariantFacts> variant = Optional.empty();
        if (ScanCodeGenerator.looksLike(ScanCodeGenerator.VARIANT_PREFIX, upper)) {
            variant = variantRepository.findFactsByLabelCode(instituteId, upper);
        }
        if (variant.isEmpty()) {
            variant = variantRepository.findFactsByBarcode(instituteId, typed);
        }
        VariantFacts found = variant.orElseThrow(() -> new VacademyException(HttpStatus.NOT_FOUND, "Code not found"));
        out.put("kind", "VARIANT");
        out.put("variant", variantView(found, withCost));
        return out;
    }

    private static Map<String, Object> variantView(VariantFacts variant, boolean withCost) {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("package_session_id", variant.getPackageSessionId());
        out.put("package_id", variant.getPackageId());
        out.put("sku", variant.getSku());
        out.put("barcode", variant.getBarcode());
        out.put("label_code", variant.getLabelCode());
        out.put("product_name", variant.getProductName());
        out.put("variant_name", variant.getVariantName());
        out.put("status", variant.getStatus());
        out.put("stock_mode", variant.getStockMode());
        out.put("stock_policy", variant.getStockPolicy());
        out.put("unit", variant.getUnit());
        out.put("qty_scale", variant.getQtyScale());
        if (withCost) {
            out.put("cost_price", variant.getCostPrice());
            out.put("standard_cost", variant.getStandardCost());
        }
        return out;
    }

    private static Map<String, Object> pieceView(String id, String packageSessionId, String code, String locationId,
                                                 String status, java.math.BigDecimal unitCost, String receiptLineId,
                                                 boolean withCost) {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("id", id);
        out.put("package_session_id", packageSessionId);
        out.put("code", code);
        out.put("location_id", locationId);
        out.put("status", status);
        out.put("receipt_line_id", receiptLineId);
        if (withCost) {
            out.put("unit_cost", unitCost);
        }
        return out;
    }

    private static int pageSize(int size) {
        return Math.min(Math.max(size, 1), MAX_PAGE_SIZE);
    }

    private static String blankToNull(String value) {
        return value == null || value.isBlank() ? null : value.trim();
    }
}
