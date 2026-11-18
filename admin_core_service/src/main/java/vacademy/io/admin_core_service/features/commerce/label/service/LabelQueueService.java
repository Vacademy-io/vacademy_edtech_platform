package vacademy.io.admin_core_service.features.commerce.label.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import vacademy.io.admin_core_service.features.commerce.audit.CommerceAuditService;
import vacademy.io.admin_core_service.features.commerce.common.request.CommerceRequestGuard;
import vacademy.io.admin_core_service.features.commerce.label.dto.LabelDtos.CancelAnswer;
import vacademy.io.admin_core_service.features.commerce.label.dto.LabelDtos.LabelIdsRequest;
import vacademy.io.admin_core_service.features.commerce.label.dto.LabelDtos.LabelLineInput;
import vacademy.io.admin_core_service.features.commerce.label.dto.LabelDtos.LabelRequestsRequest;
import vacademy.io.admin_core_service.features.commerce.label.dto.LabelDtos.LabelRow;
import vacademy.io.admin_core_service.features.commerce.label.dto.LabelDtos.LabelsAnswer;
import vacademy.io.admin_core_service.features.commerce.label.dto.LabelDtos.Names;
import vacademy.io.admin_core_service.features.commerce.label.dto.LabelDtos.PrintDataAnswer;
import vacademy.io.admin_core_service.features.commerce.label.dto.LabelDtos.PrintDataRequest;
import vacademy.io.admin_core_service.features.commerce.label.dto.LabelDtos.PrintLabel;
import vacademy.io.admin_core_service.features.commerce.label.dto.LabelDtos.PrintedAnswer;
import vacademy.io.admin_core_service.features.commerce.label.dto.LabelDtos.ReplaceAnswer;
import vacademy.io.admin_core_service.features.commerce.label.dto.LabelDtos.ReplaceRow;
import vacademy.io.admin_core_service.features.commerce.label.entity.CommerceLabelRequest;
import vacademy.io.admin_core_service.features.commerce.label.enums.LabelReason;
import vacademy.io.admin_core_service.features.commerce.label.enums.LabelStatus;
import vacademy.io.admin_core_service.features.commerce.label.enums.LabelTemplate;
import vacademy.io.admin_core_service.features.commerce.label.enums.ReprintReason;
import vacademy.io.admin_core_service.features.commerce.label.repository.CommerceLabelRequestRepository;
import vacademy.io.admin_core_service.features.commerce.notify.CommerceNotificationShopSettings;
import vacademy.io.admin_core_service.features.commerce.security.CommerceAccessDeniedException;
import vacademy.io.admin_core_service.features.commerce.stock.dto.StockOpsDtos.Caller;
import vacademy.io.admin_core_service.features.commerce.stock.entity.StockReceiptLine;
import vacademy.io.admin_core_service.features.commerce.stock.enums.PieceStatus;
import vacademy.io.admin_core_service.features.commerce.stock.repository.CommercePieceRepository;
import vacademy.io.admin_core_service.features.commerce.stock.repository.CommercePieceRepository.PieceRow;
import vacademy.io.admin_core_service.features.commerce.stock.repository.StockOpsReadRepository;
import vacademy.io.admin_core_service.features.commerce.stock.repository.StockOpsReadRepository.ItemFacts;
import vacademy.io.admin_core_service.features.commerce.stock.repository.StockOpsReadRepository.ReferenceLabel;
import vacademy.io.admin_core_service.features.commerce.stock.repository.StockVariantRepository;
import vacademy.io.admin_core_service.features.commerce.stock.repository.StockVariantRepository.VariantFacts;
import vacademy.io.admin_core_service.features.commerce.stock.service.ScanCodeGenerator;
import vacademy.io.admin_core_service.features.commerce.storefront.service.StorefrontSnapshotLoader;
import vacademy.io.admin_core_service.features.commerce.storefront.service.StorefrontSnapshotLoader.CartVariant;
import vacademy.io.admin_core_service.features.commerce.storefront.service.StorefrontSnapshotLoader.OptionLabel;
import vacademy.io.common.exceptions.ConflictException;
import vacademy.io.common.exceptions.InvalidRequestException;
import vacademy.io.common.exceptions.VacademyException;

import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.function.Supplier;

/**
 * The label print queue and reprint log (WP-40). A receipt queues its labels in its own
 * transaction; a reversed receipt cancels its pending rows; staff ask for reprints and labels for
 * a price change. The labels are drawn by the browser (Hindi names need its text shaping) from
 * {@link #printData}, which changes nothing but a missing variant label code; the screen then
 * marks the rows printed. Codes never change: a piece prints its code, a quantity row its
 * variant's label code.
 */
@Slf4j
@Service
public class LabelQueueService {

    public static final String SOURCE_RECEIPT = "STOCK_RECEIPT";
    public static final String SOURCE_TRANSFER = "STOCK_TRANSFER";
    public static final String SOURCE_MANUAL = "MANUAL";
    public static final String ACTION_REQUEST = "LABEL_REQUEST";
    public static final String ACTION_CANCEL = "LABEL_CANCEL";
    public static final String ACTION_PRINTED = "LABEL_MARK_PRINTED";
    public static final String REFERENCE_LABELS = "LABEL_REQUEST";

    static final int MAX_QUANTITY = 10_000;
    static final int MAX_REQUEST_LINES = 100;
    static final int MAX_IDS = 200;
    static final int MAX_COPIES = 500;
    static final int MAX_QR_LENGTH = 64;
    private static final int MAX_PAGE_SIZE = 100;
    private static final ObjectMapper MAPPER = new ObjectMapper();

    private final CommerceLabelRequestRepository repository;
    private final CommercePieceRepository pieceRepository;
    private final StockVariantRepository variantRepository;
    private final StockOpsReadRepository readRepository;
    private final ScanCodeGenerator scanCodes;
    private final StorefrontSnapshotLoader snapshotLoader;
    private final CommerceNotificationShopSettings shopSettings;
    private final CommerceRequestGuard requestGuard;
    private final CommerceAuditService auditService;
    private final TransactionTemplate transaction;
    private final TransactionTemplate readOnly;

    public LabelQueueService(CommerceLabelRequestRepository repository, CommercePieceRepository pieceRepository,
                             StockVariantRepository variantRepository, StockOpsReadRepository readRepository,
                             ScanCodeGenerator scanCodes, StorefrontSnapshotLoader snapshotLoader,
                             CommerceNotificationShopSettings shopSettings, CommerceRequestGuard requestGuard,
                             CommerceAuditService auditService, PlatformTransactionManager transactionManager) {
        this.repository = repository;
        this.pieceRepository = pieceRepository;
        this.variantRepository = variantRepository;
        this.readRepository = readRepository;
        this.scanCodes = scanCodes;
        this.snapshotLoader = snapshotLoader;
        this.shopSettings = shopSettings;
        this.requestGuard = requestGuard;
        this.auditService = auditService;
        this.transaction = new TransactionTemplate(transactionManager);
        this.readOnly = new TransactionTemplate(transactionManager);
        this.readOnly.setReadOnly(true);
    }

    // ================================================================== from receipts

    /**
     * The labels of one receipt line, in the receipt's transaction: one row per created piece, or
     * one row for a quantity line ({@code qty_received} labels, one label for a measured item,
     * whose label goes on the roll or the shelf). A repeat queues nothing.
     */
    public void queueReceiptLine(String instituteId, String locationId, String receiptId, StockReceiptLine line,
                                 VariantFacts facts, List<String> pieceIds, String requestedBy) {
        if (pieceIds != null && !pieceIds.isEmpty()) {
            for (String pieceId : pieceIds) {
                repository.queueReceiptRow(UUID.randomUUID().toString(), instituteId, locationId,
                        line.getPackageSessionId(), pieceId, 1, receiptId, requestedBy);
            }
            return;
        }
        int scale = facts == null || facts.getQtyScale() == null ? 1 : facts.getQtyScale();
        int quantity = scale == 1 ? Math.min(Math.max(line.getQtyReceived(), 1), MAX_QUANTITY) : 1;
        repository.queueReceiptRow(UUID.randomUUID().toString(), instituteId, locationId, line.getPackageSessionId(),
                null, quantity, receiptId, requestedBy);
    }

    /** PENDING rows of a source become CANCELLED, in the caller's transaction (a receipt reversed). */
    public int cancelPendingOfSource(String instituteId, String sourceType, String sourceId, String actorUserId) {
        return repository.cancelPendingOfSource(instituteId, sourceType, sourceId, actorUserId);
    }

    // ================================================================== reads

    public LabelsAnswer list(String instituteId, Caller caller, String locationId, String status, String reason,
                             String sourceType, String sourceId, int page, int size) {
        Set<String> visible = caller.visibleLocationIds();
        boolean all = visible == null;
        int pageNo = Math.max(page, 0);
        int pageSize = Math.min(Math.max(size, 1), MAX_PAGE_SIZE);
        if (!all && visible.isEmpty()) {
            return new LabelsAnswer(List.of(), pageNo, pageSize, 0L, null);
        }
        String statusName = enumName(LabelStatus.class, status, "status");
        String reasonName = enumName(LabelReason.class, reason, "reason");
        String source = blankToNull(sourceType) == null ? null : sourceType.trim().toUpperCase(Locale.ROOT);
        return readOnly.execute(tx -> {
            Page<CommerceLabelRequest> rows = repository.search(instituteId, all, all ? List.of("-") : visible,
                    blankToNull(locationId), statusName, reasonName, source, blankToNull(sourceId),
                    PageRequest.of(pageNo, pageSize, Sort.by(Sort.Direction.DESC, "createdAt")
                            .and(Sort.by(Sort.Direction.ASC, "id"))));
            return new LabelsAnswer(rows(instituteId, rows.getContent()), pageNo, pageSize, rows.getTotalElements(),
                    null);
        });
    }

    /** Variants whose last printed label at the location shows another MRP than today's (and are on hand). */
    public ReplaceAnswer toReplace(String instituteId, String locationId) {
        return readOnly.execute(tx -> {
            List<CommerceLabelRequestRepository.LastPrinted> last = repository.lastPrinted(instituteId, locationId);
            Set<String> variants = new LinkedHashSet<>();
            last.forEach(row -> variants.add(row.getPackageSessionId()));
            if (variants.isEmpty()) {
                return new ReplaceAnswer(List.of());
            }
            Map<String, CartVariant> prices = snapshotLoader.cartVariants(instituteId, variants, List.of());
            Map<String, ItemFacts> facts = readRepository.itemFacts(instituteId, variants);
            Map<String, Integer> onHand = readRepository.onHandAt(instituteId, locationId, variants);
            List<ReplaceRow> out = new ArrayList<>();
            for (CommerceLabelRequestRepository.LastPrinted row : last) {
                CartVariant price = prices.get(row.getPackageSessionId());
                BigDecimal current = mrpOf(price);
                BigDecimal printed = row.getPrintedMrp() != null ? row.getPrintedMrp() : row.getPrintedPrice();
                int here = onHand.getOrDefault(row.getPackageSessionId(), 0);
                if (here <= 0 || current == null || (printed != null && printed.compareTo(current) == 0)) {
                    continue;
                }
                ItemFacts item = facts.get(row.getPackageSessionId());
                out.add(new ReplaceRow(row.getPackageSessionId(), item == null ? null : item.sku(),
                        item == null ? null : item.productName(), printed, current, here));
            }
            out.sort(Comparator.comparing(r -> r.sku() == null ? "" : r.sku()));
            return new ReplaceAnswer(out);
        });
    }

    // ================================================================== requests

    /**
     * Reprints (with a reason) and labels for a price change. A piece row is at the piece's
     * location, which must be one the caller acts at; a variant row at the request's location.
     */
    public LabelsAnswer request(String instituteId, Caller caller, LabelRequestsRequest request) {
        if (request == null) {
            throw new InvalidRequestException("VALIDATION: request body is required");
        }
        String key = CommerceRequestGuard.requireClientKey(request.clientRequestId());
        String locationId = blankToNull(request.locationId());
        if (locationId == null) {
            throw new InvalidRequestException("VALIDATION: location_id is required");
        }
        String reason = enumName(LabelReason.class, request.reason(), "reason");
        if (!LabelReason.REPRINT.name().equals(reason) && !LabelReason.PRICE_CHANGE.name().equals(reason)) {
            throw new InvalidRequestException("VALIDATION: reason is REPRINT or PRICE_CHANGE");
        }
        String reprintReason = enumName(ReprintReason.class, request.reprintReason(), "reprint_reason");
        String note = blankToNull(request.note());
        if (note != null && note.length() > 200) {
            throw new InvalidRequestException("VALIDATION: note is at most 200 characters");
        }
        if (LabelReason.REPRINT.name().equals(reason)) {
            if (reprintReason == null) {
                throw new InvalidRequestException("VALIDATION: say why the label is printed again (reprint_reason)");
            }
            if (ReprintReason.OTHER.name().equals(reprintReason) && note == null) {
                throw new InvalidRequestException("VALIDATION: write a note when the reason is OTHER");
            }
        } else if (reprintReason != null) {
            throw new InvalidRequestException("VALIDATION: reprint_reason is for a REPRINT only");
        }
        List<LabelLineInput> lines = request.lines();
        if (lines == null || lines.isEmpty() || lines.size() > MAX_REQUEST_LINES) {
            throw new InvalidRequestException("VALIDATION: 1 to " + MAX_REQUEST_LINES + " lines");
        }
        // The rows of one request share a source id, so a repeat of it answers the same rows.
        String groupId = UUID.nameUUIDFromBytes((instituteId + ":" + key).getBytes(StandardCharsets.UTF_8)).toString();
        CommerceRequestGuard.Key guardKey = new CommerceRequestGuard.Key(instituteId, key, ACTION_REQUEST,
                REFERENCE_LABELS, groupId, CommerceRequestGuard.hash(ACTION_REQUEST, request), caller.userId());
        Supplier<LabelsAnswer> current = () -> new LabelsAnswer(rows(instituteId,
                repository.findByInstituteIdAndSourceTypeAndSourceIdOrderByCreatedAtAscIdAsc(instituteId,
                        SOURCE_MANUAL, groupId)), null, null, null, Boolean.TRUE);
        CommerceRequestGuard.Outcome<LabelsAnswer> outcome = requestGuard.run(guardKey, () -> {
            List<CommerceLabelRequest> rows = new ArrayList<>();
            Set<String> variants = new HashSet<>();
            List<Object> resolved = new ArrayList<>();
            for (LabelLineInput line : lines) {
                if (line == null) {
                    throw new InvalidRequestException("VALIDATION: a line is empty");
                }
                String pieceId = blankToNull(line.pieceId());
                String pieceCode = blankToNull(line.pieceCode());
                if (pieceId != null || pieceCode != null) {
                    PieceRow piece = (pieceId != null ? pieceRepository.findRow(instituteId, pieceId)
                            : pieceRepository.findRowByCode(instituteId, pieceCode.toUpperCase(Locale.ROOT)))
                            .orElseThrow(() -> new VacademyException(HttpStatus.NOT_FOUND, "CODE_NOT_FOUND: "
                                    + (pieceCode != null ? pieceCode : pieceId) + " is not a piece of this institute"));
                    resolved.add(piece);
                    variants.add(piece.getPackageSessionId());
                } else {
                    String variant = blankToNull(line.packageSessionId());
                    if (variant == null) {
                        throw new InvalidRequestException("VALIDATION: a line names a package_session_id or a piece");
                    }
                    resolved.add(variant);
                    variants.add(variant);
                }
            }
            Map<String, ItemFacts> facts = readRepository.itemFacts(instituteId, variants);
            for (int i = 0; i < lines.size(); i++) {
                CommerceLabelRequest row = new CommerceLabelRequest();
                row.setInstituteId(instituteId);
                row.setReason(reason);
                row.setReprintReason(reprintReason);
                row.setNote(note);
                row.setSourceType(SOURCE_MANUAL);
                row.setSourceId(groupId);
                row.setStatus(LabelStatus.PENDING.name());
                row.setRequestedBy(caller.userId());
                if (resolved.get(i) instanceof PieceRow piece) {
                    boolean onShelf = PieceStatus.IN_STOCK.name().equals(piece.getStatus())
                            || PieceStatus.RESERVED.name().equals(piece.getStatus());
                    if (!onShelf || piece.getLocationId() == null) {
                        throw new ConflictException("PIECE_NOT_HERE: piece " + piece.getCode() + " is "
                                + piece.getStatus());
                    }
                    if (!caller.actsAt(piece.getLocationId())) {
                        throw new CommerceAccessDeniedException(CommerceAccessDeniedException.LOCATION_NOT_ALLOWED,
                                "piece " + piece.getCode() + " is at a location you are not assigned to");
                    }
                    row.setLocationId(piece.getLocationId());
                    row.setPackageSessionId(piece.getPackageSessionId());
                    row.setPieceId(piece.getId());
                    row.setQuantity(1);
                } else {
                    String variant = (String) resolved.get(i);
                    ItemFacts item = facts.get(variant);
                    if (item == null) {
                        throw new InvalidRequestException("ITEM_NOT_FOUND: an item does not belong to this institute");
                    }
                    if (item.archived()) {
                        throw new InvalidRequestException("ITEM_ARCHIVED: " + item.sku() + " is retired");
                    }
                    if (item.piece() && item.tracked()) {
                        throw new InvalidRequestException("PIECE_SCAN_REQUIRED: scan the piece labels of " + item.sku());
                    }
                    Integer quantity = lines.get(i).quantity();
                    if (quantity == null || quantity < 1 || quantity > MAX_QUANTITY) {
                        throw new InvalidRequestException("VALIDATION: quantity is 1 to " + MAX_QUANTITY + " labels");
                    }
                    row.setLocationId(locationId);
                    row.setPackageSessionId(variant);
                    row.setQuantity(quantity);
                }
                rows.add(row);
            }
            rows = repository.saveAllAndFlush(rows);
            if (LabelReason.REPRINT.name().equals(reason)) {
                for (CommerceLabelRequest row : rows) {
                    Map<String, Object> audit = new LinkedHashMap<>();
                    audit.put("package_session_id", row.getPackageSessionId());
                    audit.put("piece_id", row.getPieceId());
                    audit.put("quantity", row.getQuantity());
                    audit.put("reprint_reason", reprintReason);
                    auditService.record(instituteId, caller.userId(), row.getLocationId(), "LABEL_REPRINT",
                            REFERENCE_LABELS, row.getId(), null, json(audit), note);
                }
            }
            return new LabelsAnswer(rows(instituteId, rows), null, null, null, null);
        }, current);
        return outcome.value();
    }

    public CancelAnswer cancel(String instituteId, Caller caller, LabelIdsRequest request) {
        List<String> ids = ids(request);
        String key = CommerceRequestGuard.requireClientKey(request.clientRequestId());
        CommerceRequestGuard.Key guardKey = new CommerceRequestGuard.Key(instituteId, key, ACTION_CANCEL,
                REFERENCE_LABELS, null, CommerceRequestGuard.hash(ACTION_CANCEL, request), caller.userId());
        return requestGuard.run(guardKey, () -> {
            List<CommerceLabelRequest> rows = actOn(instituteId, caller, ids);
            List<String> pending = new ArrayList<>();
            List<String> skipped = new ArrayList<>(ids);
            for (CommerceLabelRequest row : rows) {
                if (LabelStatus.PENDING.name().equals(row.getStatus())) {
                    pending.add(row.getId());
                    skipped.remove(row.getId());
                }
            }
            int cancelled = pending.isEmpty() ? 0 : repository.cancelPending(instituteId, pending, caller.userId());
            return new CancelAnswer(cancelled, skipped, null);
        }, () -> {
            int cancelled = 0;
            for (CommerceLabelRequest row : repository.findByInstituteIdAndIdIn(instituteId, ids)) {
                if (LabelStatus.CANCELLED.name().equals(row.getStatus()) && caller.userId().equals(row.getCancelledBy())) {
                    cancelled++;
                }
            }
            return new CancelAnswer(cancelled, null, Boolean.TRUE);
        }).value();
    }

    /** After the print dialog: the rows are PRINTED, with the price and MRP of today stamped on them. */
    public PrintedAnswer markPrinted(String instituteId, Caller caller, LabelIdsRequest request) {
        List<String> ids = ids(request);
        String key = CommerceRequestGuard.requireClientKey(request.clientRequestId());
        CommerceRequestGuard.Key guardKey = new CommerceRequestGuard.Key(instituteId, key, ACTION_PRINTED,
                REFERENCE_LABELS, null, CommerceRequestGuard.hash(ACTION_PRINTED, request), caller.userId());
        return requestGuard.run(guardKey, () -> {
            List<CommerceLabelRequest> rows = actOn(instituteId, caller, ids);
            Set<String> variants = new HashSet<>();
            rows.forEach(row -> variants.add(row.getPackageSessionId()));
            Map<String, CartVariant> prices = snapshotLoader.cartVariants(instituteId, variants, List.of());
            LocalDateTime now = LocalDateTime.now();
            int printed = 0;
            for (CommerceLabelRequest row : rows) {
                CartVariant price = prices.get(row.getPackageSessionId());
                printed += repository.markPrinted(instituteId, row.getId(), now, caller.userId(),
                        price == null ? null : price.price(), mrpOf(price));
            }
            return new PrintedAnswer(printed, null);
        }, () -> {
            int printed = 0;
            for (CommerceLabelRequest row : repository.findByInstituteIdAndIdIn(instituteId, ids)) {
                if (LabelStatus.PRINTED.name().equals(row.getStatus()) && caller.userId().equals(row.getPrintedBy())) {
                    printed++;
                }
            }
            return new PrintedAnswer(printed, Boolean.TRUE);
        }).value();
    }

    // ================================================================== print data

    /**
     * What the browser draws, per label: the scan code, the QR text, the names in English and
     * Hindi, the price. Only PENDING rows (a printed label is printed again through a reprint
     * request). A quantity row of a variant with no label code yet gets one here, in a short write
     * transaction; nothing else changes.
     */
    public PrintDataAnswer printData(String instituteId, Caller caller, PrintDataRequest request) {
        if (request == null) {
            throw new InvalidRequestException("VALIDATION: request body is required");
        }
        String size = enumName(LabelTemplate.class, request.size(), "size");
        String receiptId = blankToNull(request.receiptId());
        boolean byIds = request.requestIds() != null && !request.requestIds().isEmpty();
        if (byIds == (receiptId != null)) {
            throw new InvalidRequestException("VALIDATION: send request_ids or receipt_id");
        }
        List<String> ids = byIds ? cleanIds(request.requestIds()) : List.of();
        List<CommerceLabelRequest> rows = transaction.execute(tx -> {
            List<CommerceLabelRequest> found;
            if (byIds) {
                found = actOn(instituteId, caller, ids);
                if (found.size() != ids.size()) {
                    throw new VacademyException(HttpStatus.NOT_FOUND, "LABEL_REQUEST_NOT_FOUND: a label request was "
                            + "not found");
                }
                for (CommerceLabelRequest row : found) {
                    if (!LabelStatus.PENDING.name().equals(row.getStatus())) {
                        throw new ConflictException("LABEL_NOT_PENDING: use Reprint for a label that was printed");
                    }
                }
            } else {
                found = repository.findByInstituteIdAndSourceTypeAndSourceIdAndStatus(instituteId, SOURCE_RECEIPT,
                        receiptId, LabelStatus.PENDING.name());
                for (CommerceLabelRequest row : found) {
                    requireActsAt(caller, row);
                }
            }
            int copies = found.stream().mapToInt(CommerceLabelRequest::getQuantity).sum();
            if (copies > MAX_COPIES) {
                throw new InvalidRequestException("LABELS_TOO_MANY: at most " + MAX_COPIES + " labels at once");
            }
            Set<String> variants = new HashSet<>();
            found.forEach(row -> variants.add(row.getPackageSessionId()));
            Map<String, ItemFacts> facts = readRepository.itemFacts(instituteId, variants);
            for (CommerceLabelRequest row : found) {
                ItemFacts item = facts.get(row.getPackageSessionId());
                if (row.getPieceId() == null && item != null && item.labelCode() == null) {
                    variantRepository.setLabelCodeIfMissing(instituteId, row.getPackageSessionId(),
                            scanCodes.newVariantLabelCode());
                }
            }
            return found;
        });
        // The primary, not the replica: a label code given a moment ago must be drawn.
        return transaction.execute(tx -> draw(instituteId, rows,
                size == null ? LabelTemplate.STICKER_50X25.name() : size));
    }

    private PrintDataAnswer draw(String instituteId, List<CommerceLabelRequest> rows, String size) {
        Set<String> variants = new HashSet<>();
        Set<String> pieces = new HashSet<>();
        for (CommerceLabelRequest row : rows) {
            variants.add(row.getPackageSessionId());
            if (row.getPieceId() != null) {
                pieces.add(row.getPieceId());
            }
        }
        Map<String, ItemFacts> facts = readRepository.itemFacts(instituteId, variants);
        Map<String, CartVariant> prices = variants.isEmpty() ? Map.of()
                : snapshotLoader.cartVariants(instituteId, variants, List.of());
        Map<String, String> codes = readRepository.pieceCodes(instituteId, pieces);
        CommerceNotificationShopSettings.Shop shop = shopSettings.read(instituteId);
        String linkBase = linkBase(instituteId, shop);
        List<CommerceLabelRequest> sorted = new ArrayList<>(rows);
        sorted.sort(Comparator
                .comparing((CommerceLabelRequest r) -> nullToEmpty(r.getSourceType() + ":" + r.getSourceId()))
                .thenComparing(r -> facts.get(r.getPackageSessionId()) == null ? ""
                        : nullToEmpty(facts.get(r.getPackageSessionId()).sku()))
                .thenComparing(r -> r.getPieceId() == null ? "" : nullToEmpty(codes.get(r.getPieceId()))));
        List<PrintLabel> out = new ArrayList<>();
        int copies = 0;
        for (CommerceLabelRequest row : sorted) {
            ItemFacts item = facts.get(row.getPackageSessionId());
            CartVariant price = prices.get(row.getPackageSessionId());
            String sku = item == null ? null : item.sku();
            if (price == null || price.price() == null || price.price().signum() <= 0) {
                throw new ConflictException("LABEL_NO_PRICE: " + sku + " has no price yet; a manager sets it first");
            }
            String code = row.getPieceId() != null ? codes.get(row.getPieceId()) : item == null ? null : item.labelCode();
            int scale = item == null ? 1 : Math.max(item.qtyScale(), 1);
            BigDecimal perUnit = BigDecimal.valueOf(scale);
            BigDecimal mrp = mrpOf(price);
            out.add(new PrintLabel(row.getId(), code, qrValue(linkBase, code), sku, productNames(price, item),
                    variantNames(price), price.price().multiply(perUnit).setScale(2, java.math.RoundingMode.HALF_UP),
                    mrp == null ? null : mrp.multiply(perUnit).setScale(2, java.math.RoundingMode.HALF_UP),
                    price.currency() == null ? "INR" : price.currency(), item == null ? null : item.unit(), scale,
                    row.getQuantity(), row.getPieceId()));
            copies += row.getQuantity();
        }
        Map<String, String> shopName = shop.shopName() == null ? Map.of() : shop.shopName();
        return new PrintDataAnswer(size, new Names(shopName.get("en"), shopName.get("hi")), out, copies);
    }

    private String linkBase(String instituteId, CommerceNotificationShopSettings.Shop shop) {
        try {
            return shopSettings.linkBase(instituteId, shop);
        } catch (RuntimeException e) {
            log.warn("Labels: the shop link base could not be read ({})", e.getClass().getSimpleName());
            return null;
        }
    }

    /** {@code <link base>/q/<code>} when there is a link base and it fits 64 characters; else the code. */
    public static String qrValue(String linkBase, String code) {
        if (code == null) {
            return null;
        }
        if (linkBase == null || linkBase.isBlank()) {
            return code;
        }
        String base = linkBase.endsWith("/") ? linkBase.substring(0, linkBase.length() - 1) : linkBase;
        String url = base + "/q/" + code;
        return url.length() <= MAX_QR_LENGTH ? url : code;
    }

    private static Names productNames(CartVariant price, ItemFacts item) {
        Map<String, String> names = price.names() == null || price.names().isEmpty()
                ? (item == null ? Map.of() : item.names()) : price.names();
        return new Names(blankToNull(names.get("en")), blankToNull(names.get("hi")));
    }

    /** The option values in the product's option order, in each language; the variant name when it has none. */
    private static Names variantNames(CartVariant price) {
        List<OptionLabel> options = price.options() == null ? List.of() : price.options();
        if (options.isEmpty()) {
            return new Names(blankToNull(price.legacyName()), null);
        }
        List<String> en = new ArrayList<>();
        List<String> hi = new ArrayList<>();
        boolean allHi = true;
        for (OptionLabel option : options) {
            Map<String, String> labels = option.labelI18n() == null ? Map.of() : option.labelI18n();
            String english = blankToNull(labels.get("en"));
            en.add(english != null ? english : option.code());
            String hindi = blankToNull(labels.get("hi"));
            if (hindi == null) {
                allHi = false;
            } else {
                hi.add(hindi);
            }
        }
        return new Names(String.join(" / ", en), allHi ? String.join(" / ", hi) : null);
    }

    /** The MRP of a base unit: the variant's MRP, else its price. */
    static BigDecimal mrpOf(CartVariant price) {
        if (price == null) {
            return null;
        }
        return price.mrp() != null ? price.mrp() : price.price();
    }

    // ================================================================== helpers

    private List<LabelRow> rows(String instituteId, Collection<CommerceLabelRequest> rows) {
        Set<String> variants = new HashSet<>();
        Set<String> pieces = new HashSet<>();
        Map<String, Set<String>> sources = new HashMap<>();
        for (CommerceLabelRequest row : rows) {
            variants.add(row.getPackageSessionId());
            if (row.getPieceId() != null) {
                pieces.add(row.getPieceId());
            }
            if (row.getSourceId() != null && !SOURCE_MANUAL.equals(row.getSourceType())) {
                sources.computeIfAbsent(row.getSourceType(), k -> new HashSet<>()).add(row.getSourceId());
            }
        }
        Map<String, ItemFacts> facts = readRepository.itemFacts(instituteId, variants);
        Map<String, ReferenceLabel> labels = readRepository.referenceLabels(instituteId, sources, pieces);
        Map<String, CartVariant> prices = variants.isEmpty() ? Map.of()
                : snapshotLoader.cartVariants(instituteId, variants, List.of());
        List<LabelRow> out = new ArrayList<>();
        for (CommerceLabelRequest row : rows) {
            ItemFacts item = facts.get(row.getPackageSessionId());
            ReferenceLabel piece = row.getPieceId() == null ? null : labels.get("PIECE:" + row.getPieceId());
            ReferenceLabel source = row.getSourceId() == null ? null
                    : labels.get(row.getSourceType() + ":" + row.getSourceId());
            CartVariant price = prices.get(row.getPackageSessionId());
            out.add(new LabelRow(row.getId(), row.getLocationId(), row.getPackageSessionId(),
                    item == null ? null : item.sku(), item == null ? null : item.productName(),
                    item == null ? null : item.variantName(), row.getPieceId(), piece == null ? null : piece.label(),
                    item == null ? null : item.labelCode(), row.getQuantity(), row.getReason(), row.getReprintReason(),
                    row.getNote(), row.getSourceType(), row.getSourceId(), source == null ? null : source.label(),
                    row.getStatus(), row.getRequestedBy(), text(row.getCreatedAt()), text(row.getPrintedAt()),
                    row.getPrintedBy(), price != null && price.price() != null && price.price().signum() > 0));
        }
        return out;
    }

    /** The rows of these ids, each at a location the caller acts at (403 otherwise). Unknown ids are absent. */
    private List<CommerceLabelRequest> actOn(String instituteId, Caller caller, List<String> ids) {
        List<CommerceLabelRequest> rows = repository.findByInstituteIdAndIdIn(instituteId, ids);
        for (CommerceLabelRequest row : rows) {
            requireActsAt(caller, row);
        }
        return rows;
    }

    private static void requireActsAt(Caller caller, CommerceLabelRequest row) {
        if (!caller.actsAt(row.getLocationId())) {
            throw new CommerceAccessDeniedException(CommerceAccessDeniedException.LOCATION_NOT_ALLOWED,
                    "a label is at a location you are not assigned to");
        }
    }

    private static List<String> ids(LabelIdsRequest request) {
        if (request == null || request.requestIds() == null || request.requestIds().isEmpty()) {
            throw new InvalidRequestException("VALIDATION: request_ids is required");
        }
        return cleanIds(request.requestIds());
    }

    private static List<String> cleanIds(List<String> raw) {
        List<String> ids = raw.stream().filter(id -> id != null && !id.isBlank()).map(String::trim).distinct().toList();
        if (ids.isEmpty() || ids.size() > MAX_IDS) {
            throw new InvalidRequestException("VALIDATION: 1 to " + MAX_IDS + " request_ids");
        }
        return ids;
    }

    private static <E extends Enum<E>> String enumName(Class<E> type, String raw, String field) {
        String value = blankToNull(raw);
        if (value == null) {
            return null;
        }
        try {
            return Enum.valueOf(type, value.toUpperCase(Locale.ROOT)).name();
        } catch (IllegalArgumentException e) {
            List<String> names = new ArrayList<>();
            for (E constant : type.getEnumConstants()) {
                names.add(constant.name());
            }
            throw new InvalidRequestException("VALIDATION: " + field + " is one of " + String.join(", ", names));
        }
    }

    private static String blankToNull(String value) {
        return value == null || value.isBlank() ? null : value.trim();
    }

    private static String nullToEmpty(String value) {
        return value == null ? "" : value;
    }

    private static String text(Object value) {
        return value == null ? null : value.toString();
    }

    private static String json(Object value) {
        try {
            return MAPPER.writeValueAsString(value);
        } catch (JsonProcessingException e) {
            throw new IllegalStateException("could not write a label request as JSON", e);
        }
    }
}
