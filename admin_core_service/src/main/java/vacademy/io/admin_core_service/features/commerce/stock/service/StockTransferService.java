package vacademy.io.admin_core_service.features.commerce.stock.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import vacademy.io.admin_core_service.features.commerce.audit.CommerceAuditService;
import vacademy.io.admin_core_service.features.commerce.common.request.CommerceRequestGuard;
import vacademy.io.admin_core_service.features.commerce.document.entity.CommerceDocumentSeries;
import vacademy.io.admin_core_service.features.commerce.document.enums.DocumentType;
import vacademy.io.admin_core_service.features.commerce.document.repository.CommerceDocumentSeriesRepository;
import vacademy.io.admin_core_service.features.commerce.document.service.CommerceDocumentNumberService;
import vacademy.io.admin_core_service.features.commerce.document.service.CommerceSellerLookup;
import vacademy.io.admin_core_service.features.commerce.document.service.DocumentClock;
import vacademy.io.admin_core_service.features.commerce.document.service.DocumentNumberAllocator;
import vacademy.io.admin_core_service.features.commerce.document.service.FinancialYear;
import vacademy.io.admin_core_service.features.commerce.document.service.SeriesPicker;
import vacademy.io.admin_core_service.features.commerce.order.desk.CommerceStockShortFlagger;
import vacademy.io.admin_core_service.features.commerce.security.CommerceAccessDeniedException;
import vacademy.io.admin_core_service.features.commerce.security.CommerceApprovalService;
import vacademy.io.admin_core_service.features.commerce.stock.dto.StockOpsDtos.Approval;
import vacademy.io.admin_core_service.features.commerce.stock.dto.StockOpsDtos.CancelRequest;
import vacademy.io.admin_core_service.features.commerce.stock.dto.StockOpsDtos.Caller;
import vacademy.io.admin_core_service.features.commerce.stock.dto.StockOpsDtos.PlaceRef;
import vacademy.io.admin_core_service.features.commerce.stock.dto.StockOpsDtos.ReceiveLineInput;
import vacademy.io.admin_core_service.features.commerce.stock.dto.StockOpsDtos.Shortfall;
import vacademy.io.admin_core_service.features.commerce.stock.dto.StockOpsDtos.TransferCreateRequest;
import vacademy.io.admin_core_service.features.commerce.stock.dto.StockOpsDtos.TransferDispatchRequest;
import vacademy.io.admin_core_service.features.commerce.stock.dto.StockOpsDtos.TransferLineInput;
import vacademy.io.admin_core_service.features.commerce.stock.dto.StockOpsDtos.TransferLineView;
import vacademy.io.admin_core_service.features.commerce.stock.dto.StockOpsDtos.TransferReceiveRequest;
import vacademy.io.admin_core_service.features.commerce.stock.dto.StockOpsDtos.TransferRow;
import vacademy.io.admin_core_service.features.commerce.stock.dto.StockOpsDtos.TransferTotals;
import vacademy.io.admin_core_service.features.commerce.stock.dto.StockOpsDtos.TransferUpdateRequest;
import vacademy.io.admin_core_service.features.commerce.stock.dto.StockOpsDtos.TransferView;
import vacademy.io.admin_core_service.features.commerce.stock.dto.StockOpsDtos.TransfersAnswer;
import vacademy.io.admin_core_service.features.commerce.stock.entity.StockLocation;
import vacademy.io.admin_core_service.features.commerce.stock.entity.StockTransfer;
import vacademy.io.admin_core_service.features.commerce.stock.entity.StockTransferLine;
import vacademy.io.admin_core_service.features.commerce.stock.enums.LocationStatus;
import vacademy.io.admin_core_service.features.commerce.stock.enums.PieceStatus;
import vacademy.io.admin_core_service.features.commerce.stock.enums.StockMovementType;
import vacademy.io.admin_core_service.features.commerce.stock.enums.TransferDocumentType;
import vacademy.io.admin_core_service.features.commerce.stock.enums.TransferShortfallReason;
import vacademy.io.admin_core_service.features.commerce.stock.enums.TransferStatus;
import vacademy.io.admin_core_service.features.commerce.stock.repository.CommercePieceRepository;
import vacademy.io.admin_core_service.features.commerce.stock.repository.CommercePieceRepository.PieceRow;
import vacademy.io.admin_core_service.features.commerce.stock.repository.StockLocationRepository;
import vacademy.io.admin_core_service.features.commerce.stock.repository.StockLocationRepository.LocationFacts;
import vacademy.io.admin_core_service.features.commerce.stock.repository.StockOpsReadRepository;
import vacademy.io.admin_core_service.features.commerce.stock.repository.StockOpsReadRepository.ItemFacts;
import vacademy.io.admin_core_service.features.commerce.stock.repository.StockTransferLineRepository;
import vacademy.io.admin_core_service.features.commerce.stock.repository.StockTransferRepository;
import vacademy.io.admin_core_service.features.commerce.stock.service.CommerceStockSettings.AdjustmentLimits;
import vacademy.io.admin_core_service.features.commerce.storefront.service.StorefrontSnapshotLoader;
import vacademy.io.admin_core_service.features.commerce.storefront.service.StorefrontSnapshotLoader.CartVariant;
import vacademy.io.admin_core_service.features.commerce.tax.service.CommerceTaxContext;
import vacademy.io.admin_core_service.features.commerce.tax.service.CommerceTaxSettingService;
import vacademy.io.common.exceptions.ConflictException;
import vacademy.io.common.exceptions.InvalidRequestException;
import vacademy.io.common.exceptions.VacademyException;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.Collection;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.function.Supplier;
import java.util.regex.Pattern;

/**
 * Transfers between two own locations (WP-40). A draft reserves nothing; the dispatch posts one
 * TRANSFER_OUT per line at the source (pieces go IN_TRANSIT) and takes a delivery-challan number
 * last; the receive posts TRANSFER_IN for the full sent quantity and a DAMAGE for any shortfall,
 * so the ledger explains every unit and the stock in transit returns to zero.
 *
 * <p>Two places with different GSTINs are two registrations: the move is a supply, and the
 * dispatch is refused until a manager records the document the shop's accountant asks for
 * (EXTERNAL_INVOICE); no challan number is taken then.
 *
 * <p>Callers pass an institute id the access guard checked, and the caller's place facts. Every
 * view is built inside the transaction that wrote it, never from the read replica.
 */
@Slf4j
@Service
public class StockTransferService {

    public static final String REFERENCE_TRANSFER = "STOCK_TRANSFER";
    public static final String ACTION_CREATE = "TRANSFER_CREATE";
    public static final String ACTION_UPDATE = "TRANSFER_UPDATE";
    public static final String ACTION_CANCEL = "TRANSFER_CANCEL";
    public static final String ACTION_DISPATCH = "TRANSFER_DISPATCH";
    public static final String ACTION_RECEIVE = "TRANSFER_RECEIVE";
    public static final String APPROVAL_SHORT = "STOCK_TRANSFER_SHORT";
    public static final String APPROVAL_REQUIRED = "APPROVAL_REQUIRED";
    public static final String CHANNEL_ALL = "ALL";

    static final int MAX_LINES = 300;
    static final int MAX_QUANTITY = 10_000_000;
    static final int DEFAULT_OVERDUE_DAYS = 7;
    private static final int MAX_PAGE_SIZE = 100;
    private static final Pattern EWAY_BILL = Pattern.compile("^[A-Za-z0-9]{1,32}$");
    private static final Pattern EXTERNAL_NUMBER = Pattern.compile("^[A-Za-z0-9/ _.-]{1,64}$");
    private static final ObjectMapper MAPPER = new ObjectMapper();

    private final StockTransferRepository transferRepository;
    private final StockTransferLineRepository lineRepository;
    private final StockLocationRepository locationRepository;
    private final CommercePieceRepository pieceRepository;
    private final StockOpsReadRepository readRepository;
    private final StockLedgerService ledger;
    private final CommerceCounterService counters;
    private final CommerceRequestGuard requestGuard;
    private final CommerceAuditService auditService;
    private final CommerceSellerLookup sellerLookup;
    private final CommerceTaxSettingService taxSettingService;
    private final CommerceDocumentNumberService documentNumbers;
    private final CommerceDocumentSeriesRepository seriesRepository;
    private final DocumentClock documentClock;
    private final StorefrontSnapshotLoader snapshotLoader;
    private final CommerceStockSettings settings;
    private final CommerceApprovalService approvalService;
    private final ObjectProvider<CommerceStockShortFlagger> shortFlagger;
    private final TransactionTemplate transaction;
    private final TransactionTemplate readOnly;

    public StockTransferService(StockTransferRepository transferRepository,
                                StockTransferLineRepository lineRepository,
                                StockLocationRepository locationRepository,
                                CommercePieceRepository pieceRepository,
                                StockOpsReadRepository readRepository,
                                StockLedgerService ledger,
                                CommerceCounterService counters,
                                CommerceRequestGuard requestGuard,
                                CommerceAuditService auditService,
                                CommerceSellerLookup sellerLookup,
                                CommerceTaxSettingService taxSettingService,
                                CommerceDocumentNumberService documentNumbers,
                                CommerceDocumentSeriesRepository seriesRepository,
                                DocumentClock documentClock,
                                StorefrontSnapshotLoader snapshotLoader,
                                CommerceStockSettings settings,
                                CommerceApprovalService approvalService,
                                ObjectProvider<CommerceStockShortFlagger> shortFlagger,
                                PlatformTransactionManager transactionManager) {
        this.transferRepository = transferRepository;
        this.lineRepository = lineRepository;
        this.locationRepository = locationRepository;
        this.pieceRepository = pieceRepository;
        this.readRepository = readRepository;
        this.ledger = ledger;
        this.counters = counters;
        this.requestGuard = requestGuard;
        this.auditService = auditService;
        this.sellerLookup = sellerLookup;
        this.taxSettingService = taxSettingService;
        this.documentNumbers = documentNumbers;
        this.seriesRepository = seriesRepository;
        this.documentClock = documentClock;
        this.snapshotLoader = snapshotLoader;
        this.settings = settings;
        this.approvalService = approvalService;
        this.shortFlagger = shortFlagger;
        this.transaction = new TransactionTemplate(transactionManager);
        this.readOnly = new TransactionTemplate(transactionManager);
        this.readOnly.setReadOnly(true);
    }

    /** A created transfer, and whether this call created it (201) or answered a repeat (200). */
    public record Created(TransferView view, boolean created) {
    }

    // ================================================================== reads

    /** The transfer of this institute (another institute's id is 404 TRANSFER_NOT_FOUND). */
    public StockTransfer get(String instituteId, String transferId) {
        return transferRepository.findByInstituteIdAndId(instituteId, transferId == null ? "" : transferId.trim())
                .orElseThrow(StockTransferService::notFound);
    }

    public TransferView view(String instituteId, String transferId, Caller caller) {
        return readOnly.execute(status -> view(instituteId, get(instituteId, transferId), caller));
    }

    public TransfersAnswer list(String instituteId, Caller caller, String status, String direction,
                                String locationId, Integer overdueDays, int page, int size) {
        String statusName = enumName(TransferStatus.class, status, "status");
        String dir = direction == null || direction.isBlank() ? "ANY" : direction.trim().toUpperCase(Locale.ROOT);
        if (!Set.of("OUT", "IN", "ANY").contains(dir)) {
            throw new InvalidRequestException("VALIDATION: direction is OUT, IN or ANY");
        }
        int days = overdueDays == null ? DEFAULT_OVERDUE_DAYS : overdueDays;
        if (days < 1 || days > 90) {
            throw new InvalidRequestException("VALIDATION: overdueDays is 1 to 90");
        }
        Set<String> visible = caller.visibleLocationIds();
        boolean all = visible == null;
        int pageNo = Math.max(page, 0);
        int pageSize = Math.min(Math.max(size, 1), MAX_PAGE_SIZE);
        if (!all && visible.isEmpty()) {
            return new TransfersAnswer(List.of(), pageNo, pageSize, 0);
        }
        String location = blankToNull(locationId);
        return readOnly.execute(tx -> {
            Page<StockTransfer> rows = transferRepository.search(instituteId, statusName, dir, location, all,
                    all ? List.of("-") : visible, PageRequest.of(pageNo, pageSize,
                            Sort.by(Sort.Direction.DESC, "createdAt").and(Sort.by(Sort.Direction.DESC, "id"))));
            Map<String, StockLocation> places = locations(instituteId);
            Map<String, long[]> totals = new HashMap<>();
            List<String> ids = rows.getContent().stream().map(StockTransfer::getId).toList();
            if (!ids.isEmpty()) {
                for (StockTransferLineRepository.LineTotals t : lineRepository.totals(instituteId, ids)) {
                    totals.put(t.getTransferId(), new long[]{nz(t.getLineCount()), nz(t.getQtySent())});
                }
            }
            List<TransferRow> out = new ArrayList<>();
            for (StockTransfer t : rows.getContent()) {
                long[] sum = totals.getOrDefault(t.getId(), new long[]{0, 0});
                out.add(new TransferRow(t.getId(), t.getTransferNumber(), t.getStatus(),
                        place(places.get(t.getFromLocationId()), t.getFromLocationId(), null),
                        place(places.get(t.getToLocationId()), t.getToLocationId(), null), t.getDocumentNumber(),
                        sum[0], sum[1], text(t.getCreatedAt()), text(t.getDispatchedAt()), text(t.getReceivedAt()),
                        overdue(t, days)));
            }
            return new TransfersAnswer(out, pageNo, pageSize, rows.getTotalElements());
        });
    }

    // ================================================================== create, update, cancel

    /**
     * A draft. The number is taken first in a transaction of its own (gaps allowed); a repeat of
     * the same request answers the transfer it made (by the header's client_request_id).
     */
    public Created create(String instituteId, Caller caller, TransferCreateRequest request) {
        if (request == null) {
            throw new InvalidRequestException("VALIDATION: request body is required");
        }
        String key = CommerceRequestGuard.requireClientKey(request.clientRequestId());
        String hash = CommerceRequestGuard.hash(ACTION_CREATE, request);
        String from = requireId(request.fromLocationId(), "from_location_id");
        String to = requireId(request.toLocationId(), "to_location_id");
        if (from.equals(to)) {
            throw new InvalidRequestException("TRANSFER_SAME_LOCATION: a transfer goes to another location");
        }
        String note = limited(request.note(), 500, "note");
        Created earlier = transaction.execute(status -> transferRepository
                .findByInstituteIdAndClientRequestId(instituteId, key)
                .map(found -> sameOrRefuse(instituteId, found, hash, caller)).orElse(null));
        if (earlier != null) {
            return earlier;
        }
        // Checked before a number is taken, so a refused request leaves no gap.
        transaction.execute(status -> {
            requireActive(instituteId, from);
            requireActive(instituteId, to);
            resolveLines(instituteId, from, request.lines());
            return null;
        });
        String number = counters.nextNumber(instituteId, CommerceCounterService.SCOPE_TRANSFER);
        try {
            return transaction.execute(status -> {
                requireActive(instituteId, from);
                requireActive(instituteId, to);
                List<NewLine> lines = resolveLines(instituteId, from, request.lines());
                StockTransfer transfer = new StockTransfer();
                transfer.setInstituteId(instituteId);
                transfer.setTransferNumber(number);
                transfer.setFromLocationId(from);
                transfer.setToLocationId(to);
                transfer.setStatus(TransferStatus.DRAFT.name());
                transfer.setNote(note);
                transfer.setCreatedBy(caller.userId());
                transfer.setClientRequestId(key);
                transfer.setRequestHash(hash);
                transfer = transferRepository.saveAndFlush(transfer);
                saveLines(instituteId, transfer.getId(), lines);
                Map<String, Object> audit = new LinkedHashMap<>();
                audit.put("transfer_number", number);
                audit.put("from_location_id", from);
                audit.put("to_location_id", to);
                audit.put("lines", lines.size());
                auditService.record(instituteId, caller.userId(), from, "TRANSFER_CREATED", REFERENCE_TRANSFER,
                        transfer.getId(), null, json(audit), null);
                return new Created(view(instituteId, transfer, caller), true);
            });
        } catch (DataIntegrityViolationException e) {
            Created winner = transaction.execute(status -> transferRepository
                    .findByInstituteIdAndClientRequestId(instituteId, key)
                    .map(found -> sameOrRefuse(instituteId, found, hash, caller)).orElse(null));
            if (winner == null) {
                throw e;
            }
            return winner;
        }
    }

    private Created sameOrRefuse(String instituteId, StockTransfer earlier, String hash, Caller caller) {
        if (!hash.equals(earlier.getRequestHash())) {
            throw new ConflictException(CommerceRequestGuard.IDEMPOTENCY_MISMATCH
                    + ": client_request_id was already used for another transfer");
        }
        return new Created(view(instituteId, earlier, caller).withReplayed(), false);
    }

    /** A draft's destination, note and lines (the lines replace all lines). */
    public TransferView update(String instituteId, Caller caller, String transferId, TransferUpdateRequest request) {
        if (request == null) {
            throw new InvalidRequestException("VALIDATION: request body is required");
        }
        String key = CommerceRequestGuard.requireClientKey(request.clientRequestId());
        String hash = CommerceRequestGuard.hash(ACTION_UPDATE, request, transferId);
        String note = limited(request.note(), 500, "note");
        String newTo = blankToNull(request.toLocationId());
        CommerceRequestGuard.Key guardKey = new CommerceRequestGuard.Key(instituteId, key, ACTION_UPDATE,
                REFERENCE_TRANSFER, transferId, hash, caller.userId());
        return answer(requestGuard.run(guardKey, () -> {
            StockTransfer transfer = lockDraft(instituteId, transferId);
            if (newTo != null && !newTo.equals(transfer.getToLocationId())) {
                if (newTo.equals(transfer.getFromLocationId())) {
                    throw new InvalidRequestException("TRANSFER_SAME_LOCATION: a transfer goes to another location");
                }
                requireActive(instituteId, newTo);
                transfer.setToLocationId(newTo);
            }
            if (request.note() != null) {
                transfer.setNote(note);
            }
            int lineCount;
            if (request.lines() != null) {
                List<NewLine> lines = resolveLines(instituteId, transfer.getFromLocationId(), request.lines());
                lineRepository.deleteOfTransfer(instituteId, transfer.getId());
                saveLines(instituteId, transfer.getId(), lines);
                lineCount = lines.size();
            } else {
                lineCount = -1;
            }
            transfer = transferRepository.saveAndFlush(transfer);
            Map<String, Object> audit = new LinkedHashMap<>();
            audit.put("to_location_id", transfer.getToLocationId());
            if (lineCount >= 0) {
                audit.put("lines", lineCount);
            }
            auditService.record(instituteId, caller.userId(), transfer.getFromLocationId(), "TRANSFER_UPDATED",
                    REFERENCE_TRANSFER, transfer.getId(), null, json(audit), null);
            return view(instituteId, transfer, caller);
        }, current(instituteId, transferId, caller)));
    }

    public TransferView cancel(String instituteId, Caller caller, String transferId, CancelRequest request) {
        if (request == null) {
            throw new InvalidRequestException("VALIDATION: request body is required");
        }
        String key = CommerceRequestGuard.requireClientKey(request.clientRequestId());
        String reason = limited(request.reason(), 500, "reason");
        CommerceRequestGuard.Key guardKey = new CommerceRequestGuard.Key(instituteId, key, ACTION_CANCEL,
                REFERENCE_TRANSFER, transferId, CommerceRequestGuard.hash(ACTION_CANCEL, request, transferId),
                caller.userId());
        return answer(requestGuard.run(guardKey, () -> {
            StockTransfer transfer = transferRepository.lockForUpdate(instituteId, transferId)
                    .orElseThrow(StockTransferService::notFound);
            if (TransferStatus.DISPATCHED.name().equals(transfer.getStatus())) {
                throw new ConflictException("TRANSFER_DISPATCHED: a transfer on the way cannot be cancelled; "
                        + "send it back with a new transfer");
            }
            if (!TransferStatus.DRAFT.name().equals(transfer.getStatus())) {
                throw new ConflictException("TRANSFER_NOT_DRAFT: this transfer is " + transfer.getStatus());
            }
            transfer.setStatus(TransferStatus.CANCELLED.name());
            transfer.setCancelledAt(LocalDateTime.now());
            transfer.setCancelledBy(caller.userId());
            transfer = transferRepository.saveAndFlush(transfer);
            auditService.record(instituteId, caller.userId(), transfer.getFromLocationId(), "TRANSFER_CANCELLED",
                    REFERENCE_TRANSFER, transfer.getId(), null, null, reason);
            return view(instituteId, transfer, caller);
        }, current(instituteId, transferId, caller)));
    }

    // ================================================================== dispatch

    /**
     * Sends the goods. Lock order: transfer row, both location rows (shared), then the ledger's
     * level rows in its lock order, the package session, the variant and the piece; the
     * challan series row last, so a refusal anywhere before it takes no number.
     */
    public TransferView dispatch(String instituteId, Caller caller, String transferId,
                                 TransferDispatchRequest request) {
        if (request == null) {
            throw new InvalidRequestException("VALIDATION: request body is required");
        }
        String key = CommerceRequestGuard.requireClientKey(request.clientRequestId());
        CommerceRequestGuard.Key guardKey = new CommerceRequestGuard.Key(instituteId, key, ACTION_DISPATCH,
                REFERENCE_TRANSFER, transferId, CommerceRequestGuard.hash(ACTION_DISPATCH, request, transferId),
                caller.userId());
        Supplier<TransferView> current = current(instituteId, transferId, caller);
        CommerceRequestGuard.Outcome<TransferView> done = requestGuard.replayIfDone(guardKey, current);
        if (done != null) {
            return done.value().withReplayed();
        }

        TransferDocumentType documentType = documentType(request.documentType());
        boolean confirm = Boolean.TRUE.equals(request.confirmPromisedOnline());
        if ((documentType == TransferDocumentType.EXTERNAL_INVOICE || confirm) && !caller.manager()) {
            throw new CommerceAccessDeniedException(CommerceAccessDeniedException.ROLE_NOT_ALLOWED,
                    "only a manager records an external document or sends units promised online");
        }
        String ewayBill = blankToNull(request.ewayBillNo());
        if (ewayBill != null && !EWAY_BILL.matcher(ewayBill).matches()) {
            throw new InvalidRequestException("VALIDATION: eway_bill_no is up to 32 letters and digits");
        }
        record Checked(StockTransfer transfer, String fromGstin, String toGstin, int fyStartMonth) {
        }
        Checked checked = transaction.execute(status -> {
            StockTransfer transfer = get(instituteId, transferId);
            requireDraft(transfer);
            if (lineRepository.findByInstituteIdAndTransferIdOrderByCreatedAtAscIdAsc(instituteId, transferId)
                    .isEmpty()) {
                throw new ConflictException("TRANSFER_EMPTY: add at least one item before you dispatch");
            }
            requireActive(instituteId, transfer.getToLocationId());
            CommerceTaxContext tax = taxSettingService.context(instituteId);
            return new Checked(transfer, gstinOf(instituteId, transfer.getFromLocationId(), tax),
                    gstinOf(instituteId, transfer.getToLocationId(), tax), tax.getFyStartMonth());
        });
        boolean differs = !Objects.equals(checked.fromGstin(), checked.toGstin());
        String externalNumber = null;
        if (differs) {
            if (documentType != TransferDocumentType.EXTERNAL_INVOICE) {
                throw new ConflictException("TRANSFER_NEEDS_DOCUMENT: these two places have different GSTINs; "
                        + "a manager must record the document your CA asks for");
            }
            externalNumber = request.documentNumber() == null ? "" : request.documentNumber().trim();
            if (!EXTERNAL_NUMBER.matcher(externalNumber).matches()) {
                throw new InvalidRequestException("VALIDATION: document_number is 1 to 64 letters, digits, "
                        + "spaces or / _ . -");
            }
        } else {
            if (documentType == TransferDocumentType.EXTERNAL_INVOICE) {
                throw new InvalidRequestException("TRANSFER_DOCUMENT_NOT_ALLOWED: these two places share a GSTIN; "
                        + "the transfer travels with a delivery challan");
            }
            if (blankToNull(request.documentNumber()) != null) {
                throw new InvalidRequestException("VALIDATION: the challan number comes from the challan series");
            }
        }
        String documentNumber = externalNumber;
        return answer(requestGuard.run(guardKey, () -> dispatchLocked(instituteId, caller, transferId, checked.fromGstin(),
                checked.toGstin(), checked.fyStartMonth(), differs, documentNumber, ewayBill, confirm), current));
    }

    private TransferView dispatchLocked(String instituteId, Caller caller, String transferId, String fromGstin,
                                        String toGstin, int fyStartMonth, boolean external, String externalNumber,
                                        String ewayBill, boolean confirm) {
        StockTransfer transfer = transferRepository.lockForUpdate(instituteId, transferId)
                .orElseThrow(StockTransferService::notFound);
        requireDraft(transfer);
        String from = transfer.getFromLocationId();
        String to = transfer.getToLocationId();
        // Shared row locks: a deactivation of either place waits for this dispatch, and then sees it.
        LocationFacts toFacts = locationRepository.lockForPosting(instituteId, to)
                .orElseThrow(() -> new InvalidRequestException("LOCATION_NOT_FOUND: to_location_id"));
        if (!LocationStatus.ACTIVE.name().equals(toFacts.getStatus())) {
            throw new ConflictException("LOCATION_INACTIVE: the destination is not active");
        }
        locationRepository.lockForPosting(instituteId, from)
                .orElseThrow(() -> new InvalidRequestException("LOCATION_NOT_FOUND: from_location_id"));
        List<StockTransferLine> lines = lineRepository
                .findByInstituteIdAndTransferIdOrderByCreatedAtAscIdAsc(instituteId, transferId);
        if (lines.isEmpty()) {
            throw new ConflictException("TRANSFER_EMPTY: add at least one item before you dispatch");
        }
        Set<String> variants = new HashSet<>();
        lines.forEach(line -> variants.add(line.getPackageSessionId()));
        Map<String, ItemFacts> facts = readRepository.itemFacts(instituteId, variants);
        Map<String, CartVariant> prices = snapshotLoader.cartVariants(instituteId, variants, List.of());
        Map<String, StockLocation> places = locations(instituteId);

        List<StockPosting> postings = new ArrayList<>();
        for (StockTransferLine line : lines) {
            ItemFacts item = facts.get(line.getPackageSessionId());
            requireMovable(item, line.getPieceId() != null);
            if (line.getPieceId() != null) {
                PieceRow piece = pieceRepository.findRow(instituteId, line.getPieceId())
                        .orElseThrow(() -> new InvalidRequestException("ITEM_NOT_FOUND: a piece of this transfer is gone"));
                requirePieceHere(piece, from, places);
            }
            CartVariant price = prices.get(line.getPackageSessionId());
            lineRepository.stampDispatch(instituteId, line.getId(), unitValue(price), item.hsnCode(),
                    clip(item.sku(), 64), clip(item.productName(), 255));
            postings.add(StockPosting.builder()
                    .instituteId(instituteId)
                    .locationId(from)
                    .packageSessionId(line.getPackageSessionId())
                    .pieceId(line.getPieceId())
                    .type(StockMovementType.TRANSFER_OUT)
                    .quantityDelta(-line.getQtySent())
                    .referenceType(REFERENCE_TRANSFER)
                    .referenceId(transfer.getId())
                    .transferId(transfer.getId())
                    .actorUserId(caller.userId())
                    .idempotencyKey("TRANSFER_OUT:" + line.getId())
                    .build());
        }
        List<StockPostResult> results = ledger.postAll(postings);
        Map<String, Integer> shortfall = new LinkedHashMap<>();
        for (StockPostResult result : results) {
            if (result.sellableShortfall() > 0 && result.movement() != null) {
                shortfall.merge(result.movement().getPackageSessionId(), result.sellableShortfall(), Integer::sum);
            }
        }
        if (!shortfall.isEmpty() && !confirm) {
            Map.Entry<String, Integer> first = shortfall.entrySet().iterator().next();
            ItemFacts item = facts.get(first.getKey());
            int units = shortfall.values().stream().mapToInt(Integer::intValue).sum();
            throw new ConflictException("PROMISED_ONLINE: " + units + " unit(s) of "
                    + (item == null ? first.getKey() : item.sku())
                    + (shortfall.size() > 1 ? " and other items" : "")
                    + " are held or sold online; a manager may send them anyway");
        }

        LocalDate today = documentClock.today(instituteId);
        transfer.setStatus(TransferStatus.DISPATCHED.name());
        transfer.setDispatchedAt(LocalDateTime.now());
        transfer.setDispatchedBy(caller.userId());
        transfer.setFromGstin(fromGstin);
        transfer.setToGstin(toGstin);
        transfer.setEwayBillNo(ewayBill);
        transfer.setDocumentDate(today);
        if (external) {
            transfer.setDocumentType(TransferDocumentType.EXTERNAL_INVOICE.name());
            transfer.setDocumentNumber(externalNumber);
        } else {
            // Last: the series row is the last lock, and a refusal before it took no number.
            DocumentNumberAllocator.Allocation number = documentNumbers.allocate(instituteId,
                    DocumentType.DELIVERY_CHALLAN, FinancialYear.of(today, fyStartMonth), fromGstin, from, null,
                    CHANNEL_ALL);
            transfer.setDocumentType(TransferDocumentType.DELIVERY_CHALLAN.name());
            transfer.setDocumentNumber(number.number());
            transfer.setDocumentSeriesId(number.seriesId());
        }
        transfer = transferRepository.saveAndFlush(transfer);

        List<Shortfall> shortList = new ArrayList<>();
        shortfall.forEach((variant, units) -> shortList.add(new Shortfall(variant, units)));
        Map<String, Object> audit = new LinkedHashMap<>();
        audit.put("transfer_number", transfer.getTransferNumber());
        audit.put("lines", lines.size());
        audit.put("document_type", transfer.getDocumentType());
        audit.put("document_number", transfer.getDocumentNumber());
        audit.put("sellable_shortfall", shortfall);
        auditService.record(instituteId, caller.userId(), from, "TRANSFER_DISPATCHED", REFERENCE_TRANSFER,
                transfer.getId(), null, json(audit), null);
        CommerceStockShortFlagger flagger = shortFlagger.getIfAvailable();
        if (flagger != null) {
            // Registered now, run after this transaction commits.
            shortfall.forEach((variant, units) -> flagger.afterCommit(instituteId, from, variant, units));
        }
        return view(instituteId, transfer, caller).withShortfall(shortList.isEmpty() ? null : shortList);
    }

    // ================================================================== receive

    public TransferView receive(String instituteId, Caller caller, String transferId,
                                TransferReceiveRequest request) {
        if (request == null) {
            throw new InvalidRequestException("VALIDATION: request body is required");
        }
        String key = CommerceRequestGuard.requireClientKey(request.clientRequestId());
        CommerceRequestGuard.Key guardKey = new CommerceRequestGuard.Key(instituteId, key, ACTION_RECEIVE,
                REFERENCE_TRANSFER, transferId,
                CommerceRequestGuard.hash(ACTION_RECEIVE, request.withoutApproval(), transferId), caller.userId());
        Supplier<TransferView> current = current(instituteId, transferId, caller);
        CommerceRequestGuard.Outcome<TransferView> done = requestGuard.replayIfDone(guardKey, current);
        if (done != null) {
            return done.value().withReplayed();
        }
        String note = limited(request.note(), 500, "note");

        record Plan(Map<String, Received> byLine, boolean needsApproval, BigDecimal shortValue) {
        }
        Plan plan = transaction.execute(status -> {
            StockTransfer transfer = get(instituteId, transferId);
            if (!TransferStatus.DISPATCHED.name().equals(transfer.getStatus())) {
                throw new ConflictException("TRANSFER_NOT_DISPATCHED: this transfer is " + transfer.getStatus());
            }
            List<StockTransferLine> lines = lineRepository
                    .findByInstituteIdAndTransferIdOrderByCreatedAtAscIdAsc(instituteId, transferId);
            Map<String, Received> byLine = receivedLines(lines, request.lines());
            Map<String, ItemFacts> facts = readRepository.itemFacts(instituteId,
                    lines.stream().map(StockTransferLine::getPackageSessionId).toList());
            AdjustmentLimits limits = settings.adjustmentLimits(instituteId);
            boolean over = false;
            BigDecimal total = BigDecimal.ZERO;
            for (StockTransferLine line : lines) {
                int shortBy = line.getQtySent() - byLine.get(line.getId()).quantity();
                if (shortBy <= 0) {
                    continue;
                }
                BigDecimal unitCost = line.getPieceId() != null
                        ? pieceRepository.findRow(instituteId, line.getPieceId()).map(PieceRow::getUnitCost).orElse(null)
                        : facts.get(line.getPackageSessionId()) == null ? null
                        : facts.get(line.getPackageSessionId()).costPrice();
                BigDecimal value = StockCountMath.value(shortBy, unitCost);
                over |= StockCountMath.overLimit(shortBy, value, limits.quantity(), limits.value());
                total = total.add(value == null ? BigDecimal.ZERO : value);
            }
            return new Plan(byLine, over && !caller.manager(), total);
        });
        Approval approval = request.approval();
        if (plan.needsApproval() && (approval == null || blankToNull(approval.approverUserId()) == null
                || blankToNull(approval.pin()) == null)) {
            throw new CommerceAccessDeniedException(APPROVAL_REQUIRED,
                    "this shortfall is above your limit and needs a manager");
        }
        return answer(requestGuard.run(guardKey, () -> {
            StockTransfer transfer = get(instituteId, transferId);
            String approvedBy = null;
            if (plan.needsApproval()) {
                // First, before any stock lock: the approval commits or rolls back with the receive.
                approvalService.approve(instituteId, transfer.getToLocationId(), caller.userId(),
                        approval.approverUserId().trim(), approval.pin(), APPROVAL_SHORT, REFERENCE_TRANSFER,
                        transferId, plan.shortValue(), blankToNull(approval.reason()));
                approvedBy = approval.approverUserId().trim();
            }
            transfer = transferRepository.lockForUpdate(instituteId, transferId)
                    .orElseThrow(StockTransferService::notFound);
            if (!TransferStatus.DISPATCHED.name().equals(transfer.getStatus())) {
                throw new ConflictException("TRANSFER_NOT_DISPATCHED: this transfer is " + transfer.getStatus());
            }
            String to = transfer.getToLocationId();
            List<StockTransferLine> lines = lineRepository
                    .findByInstituteIdAndTransferIdOrderByCreatedAtAscIdAsc(instituteId, transferId);
            List<StockPosting> postings = new ArrayList<>();
            Map<String, Object> shortAudit = new LinkedHashMap<>();
            for (StockTransferLine line : lines) {
                Received received = plan.byLine().get(line.getId());
                if (received == null) {
                    throw new InvalidRequestException("VALIDATION: every line of the transfer is named exactly once");
                }
                StockPosting base = StockPosting.builder()
                        .instituteId(instituteId)
                        .locationId(to)
                        .packageSessionId(line.getPackageSessionId())
                        .pieceId(line.getPieceId())
                        .type(StockMovementType.TRANSFER_IN)
                        .quantityDelta(line.getQtySent())
                        .referenceType(REFERENCE_TRANSFER)
                        .referenceId(transfer.getId())
                        .transferId(transfer.getId())
                        .actorUserId(caller.userId())
                        .idempotencyKey("TRANSFER_IN:" + line.getId())
                        .build();
                // The full sent quantity arrives, then the shortfall leaves with its reason: the
                // stable sort of postAll keeps this order on the one level row.
                postings.add(base);
                int shortBy = line.getQtySent() - received.quantity();
                if (shortBy > 0) {
                    postings.add(base.toBuilder()
                            .type(StockMovementType.DAMAGE)
                            .quantityDelta(-shortBy)
                            .reason(received.reason())
                            .idempotencyKey("TRANSFER_SHORT:" + line.getId())
                            .build());
                    shortAudit.put(line.getId(), Map.of("short", shortBy, "reason", received.reason()));
                }
            }
            List<StockPostResult> results = ledger.postAll(postings);
            for (StockTransferLine line : lines) {
                Received received = plan.byLine().get(line.getId());
                lineRepository.stampReceived(instituteId, line.getId(), received.quantity(), received.reason());
            }
            transfer.setStatus(TransferStatus.RECEIVED.name());
            transfer.setReceivedAt(LocalDateTime.now());
            transfer.setReceivedBy(caller.userId());
            transfer.setReceiveNote(note);
            transfer = transferRepository.saveAndFlush(transfer);

            Map<String, Object> audit = new LinkedHashMap<>();
            audit.put("transfer_number", transfer.getTransferNumber());
            audit.put("shortfall", shortAudit);
            audit.put("approved_by", approvedBy);
            auditService.record(instituteId, caller.userId(), to, "TRANSFER_RECEIVED", REFERENCE_TRANSFER,
                    transfer.getId(), null, json(audit), note);
            CommerceStockShortFlagger flagger = shortFlagger.getIfAvailable();
            if (flagger != null) {
                for (StockPostResult result : results) {
                    if (result.sellableShortfall() > 0 && result.movement() != null) {
                        flagger.afterCommit(instituteId, to, result.movement().getPackageSessionId(),
                                result.sellableShortfall());
                    }
                }
            }
            return view(instituteId, transfer, caller);
        }, current));
    }

    /** What arrived of one line. */
    record Received(int quantity, String reason) {
    }

    /** The receive sheet against the lines: every line named once, quantities and reasons as the rules say. */
    static Map<String, Received> receivedLines(List<StockTransferLine> lines, List<ReceiveLineInput> input) {
        if (input == null || input.size() != lines.size()) {
            throw new InvalidRequestException("VALIDATION: every line of the transfer is named exactly once");
        }
        Map<String, StockTransferLine> byId = new HashMap<>();
        lines.forEach(line -> byId.put(line.getId(), line));
        Map<String, Received> out = new LinkedHashMap<>();
        for (ReceiveLineInput entry : input) {
            String lineId = entry == null ? null : blankToNull(entry.lineId());
            StockTransferLine line = lineId == null ? null : byId.get(lineId);
            if (line == null || out.containsKey(lineId)) {
                throw new InvalidRequestException("VALIDATION: every line of the transfer is named exactly once");
            }
            Integer quantity = entry.qtyReceived();
            if (quantity == null || quantity < 0) {
                throw new InvalidRequestException("VALIDATION: qty_received is 0 or more");
            }
            if (quantity > line.getQtySent()) {
                throw new InvalidRequestException("RECEIVED_ABOVE_SENT: more cannot arrive than was sent ("
                        + line.getQtySent() + ")");
            }
            String reason = blankToNull(entry.shortfallReason());
            if (quantity < line.getQtySent()) {
                if (reason == null) {
                    throw new InvalidRequestException("SHORTFALL_REASON_REQUIRED: say why a line is short");
                }
                reason = enumName(TransferShortfallReason.class, reason, "shortfall_reason");
            } else if (reason != null) {
                throw new InvalidRequestException("VALIDATION: a line that arrived in full takes no shortfall_reason");
            }
            out.put(lineId, new Received(quantity, reason));
        }
        return out;
    }

    // ================================================================== GSTIN rule

    /** The GSTIN a place sells under: its own, else the institute's (409 LOCATION_NEEDS_GSTIN passes through). */
    private String gstinOf(String instituteId, String locationId, CommerceTaxContext tax) {
        String gstin = sellerLookup.resolve(instituteId, locationId, tax).getGstin();
        return gstin == null || gstin.isBlank() ? null : gstin.trim().toUpperCase(Locale.ROOT);
    }

    /** The two GSTINs as the view shows them; a place that cannot be resolved shows its own (or none). */
    private String[] liveGstins(String instituteId, StockTransfer transfer, Map<String, StockLocation> places) {
        try {
            CommerceTaxContext tax = taxSettingService.context(instituteId);
            return new String[]{gstinOf(instituteId, transfer.getFromLocationId(), tax),
                    gstinOf(instituteId, transfer.getToLocationId(), tax)};
        } catch (RuntimeException e) {
            StockLocation from = places.get(transfer.getFromLocationId());
            StockLocation to = places.get(transfer.getToLocationId());
            return new String[]{from == null ? null : from.getGstin(), to == null ? null : to.getGstin()};
        }
    }

    // ================================================================== view

    TransferView view(String instituteId, StockTransfer transfer, Caller caller) {
        Map<String, StockLocation> places = locations(instituteId);
        boolean draft = TransferStatus.DRAFT.name().equals(transfer.getStatus());
        String[] gstins = draft ? liveGstins(instituteId, transfer, places)
                : new String[]{transfer.getFromGstin(), transfer.getToGstin()};
        boolean differs = !Objects.equals(gstins[0], gstins[1]);

        List<StockTransferLine> lines = lineRepository
                .findByInstituteIdAndTransferIdOrderByCreatedAtAscIdAsc(instituteId, transfer.getId());
        Set<String> variants = new HashSet<>();
        Set<String> pieceIds = new HashSet<>();
        for (StockTransferLine line : lines) {
            variants.add(line.getPackageSessionId());
            if (line.getPieceId() != null) {
                pieceIds.add(line.getPieceId());
            }
        }
        Map<String, ItemFacts> facts = readRepository.itemFacts(instituteId, variants);
        Map<String, String> codes = readRepository.pieceCodes(instituteId, pieceIds);
        // A draft has no copied values yet: the current price is shown (the e-way bill hint uses it).
        Map<String, CartVariant> prices = draft && !variants.isEmpty()
                ? snapshotLoader.cartVariants(instituteId, variants, List.of()) : Map.of();
        List<TransferLineView> out = new ArrayList<>();
        long sent = 0;
        long received = 0;
        boolean anyReceived = false;
        BigDecimal value = BigDecimal.ZERO;
        boolean anyValue = false;
        for (StockTransferLine line : lines) {
            ItemFacts item = facts.get(line.getPackageSessionId());
            BigDecimal unitValue = draft ? unitValue(prices.get(line.getPackageSessionId())) : line.getUnitValue();
            BigDecimal lineValue = unitValue == null ? null
                    : unitValue.multiply(BigDecimal.valueOf(line.getQtySent())).setScale(2, RoundingMode.HALF_UP);
            if (lineValue != null) {
                value = value.add(lineValue);
                anyValue = true;
            }
            sent += line.getQtySent();
            if (line.getQtyReceived() != null) {
                received += line.getQtyReceived();
                anyReceived = true;
            }
            out.add(new TransferLineView(line.getId(), line.getPackageSessionId(),
                    line.getSku() != null ? line.getSku() : item == null ? null : item.sku(),
                    line.getItemName() != null ? line.getItemName() : item == null ? null : item.productName(),
                    item == null ? null : item.variantName(), item == null ? null : item.stockMode(),
                    item == null ? null : item.unit(), item == null ? null : item.qtyScale(), line.getPieceId(),
                    line.getPieceId() == null ? null : codes.get(line.getPieceId()), line.getQtySent(),
                    line.getQtyReceived(), line.getShortfallReason(),
                    unitValue == null ? null : unitValue.setScale(2, RoundingMode.HALF_UP), lineValue,
                    line.getHsnCode() != null ? line.getHsnCode() : item == null ? null : item.hsnCode()));
        }

        List<String> warnings = new ArrayList<>();
        StockLocation to = places.get(transfer.getToLocationId());
        boolean open = draft || TransferStatus.DISPATCHED.name().equals(transfer.getStatus());
        if (draft && !differs && !challanSeriesFits(instituteId, gstins[0], transfer.getFromLocationId())) {
            warnings.add("NO_CHALLAN_SERIES");
        }
        if (open && (to == null || !LocationStatus.ACTIVE.name().equals(to.getStatus()))) {
            warnings.add("DESTINATION_INACTIVE");
        }
        if (draft && differs) {
            warnings.add("NEEDS_DOCUMENT");
        }
        List<String> actions = new ArrayList<>();
        if (draft && caller != null && caller.actsAt(transfer.getFromLocationId())) {
            actions.add("EDIT");
            actions.add("CANCEL");
            if (!lines.isEmpty() && (!differs || caller.manager())) {
                actions.add("DISPATCH");
            }
        }
        if (TransferStatus.DISPATCHED.name().equals(transfer.getStatus()) && caller != null
                && caller.actsAt(transfer.getToLocationId())) {
            actions.add("RECEIVE");
        }
        if (TransferStatus.DISPATCHED.name().equals(transfer.getStatus())
                || TransferStatus.RECEIVED.name().equals(transfer.getStatus())) {
            actions.add("PRINT_CHALLAN");
        }
        return new TransferView(transfer.getId(), transfer.getTransferNumber(), transfer.getStatus(),
                place(places.get(transfer.getFromLocationId()), transfer.getFromLocationId(), gstins[0]),
                place(to, transfer.getToLocationId(), gstins[1]), differs, transfer.getDocumentType(),
                transfer.getDocumentNumber(), text(transfer.getDocumentDate()), transfer.getEwayBillNo(),
                transfer.getNote(), transfer.getReceiveNote(), transfer.getCreatedBy(), text(transfer.getCreatedAt()),
                text(transfer.getDispatchedAt()), transfer.getDispatchedBy(), text(transfer.getReceivedAt()),
                transfer.getReceivedBy(), text(transfer.getCancelledAt()), out,
                new TransferTotals(sent, anyReceived ? received : null, anyValue ? value : null),
                overdue(transfer, DEFAULT_OVERDUE_DAYS), warnings, actions, null, null);
    }

    /** Whether an ACTIVE SYSTEM delivery-challan series of this or an earlier year fits the source. */
    private boolean challanSeriesFits(String instituteId, String sellerGstin, String locationId) {
        try {
            int fyStartMonth = taxSettingService.context(instituteId).getFyStartMonth();
            int year = FinancialYear.startYear(FinancialYear.of(documentClock.today(instituteId), fyStartMonth));
            List<CommerceDocumentSeries> candidates = seriesRepository
                    .findByInstituteIdAndDocumentType(instituteId, DocumentType.DELIVERY_CHALLAN.name()).stream()
                    .filter(s -> FinancialYear.startYear(s.getFinancialYear()) <= year)
                    .toList();
            return SeriesPicker.pick(candidates, sellerGstin, locationId, null, CHANNEL_ALL).isPresent();
        } catch (RuntimeException e) {
            log.warn("Could not check the challan series of institute {}: {}", instituteId, e.getMessage());
            return true;
        }
    }

    private Supplier<TransferView> current(String instituteId, String transferId, Caller caller) {
        return () -> view(instituteId, get(instituteId, transferId), caller);
    }

    private static TransferView answer(CommerceRequestGuard.Outcome<TransferView> outcome) {
        return outcome.replayed() ? outcome.value().withReplayed() : outcome.value();
    }

    // ================================================================== lines

    /** A line to save: a quantity of a variant, or one piece. */
    record NewLine(String packageSessionId, String pieceId, int quantity, String note) {
    }

    /**
     * The requested lines, checked: a quantity line per QUANTITY variant, a piece line per piece
     * IN_STOCK at the source; nothing untracked, retired, unknown or twice.
     */
    List<NewLine> resolveLines(String instituteId, String fromLocationId, List<TransferLineInput> input) {
        List<TransferLineInput> requested = input == null ? List.of() : input;
        if (requested.size() > MAX_LINES) {
            throw new InvalidRequestException("VALIDATION: at most " + MAX_LINES + " lines per transfer");
        }
        Map<String, StockLocation> places = locations(instituteId);
        List<Object> resolved = new ArrayList<>();
        Set<String> variants = new HashSet<>();
        for (TransferLineInput line : requested) {
            if (line == null) {
                throw new InvalidRequestException("VALIDATION: a line is empty");
            }
            String pieceId = blankToNull(line.pieceId());
            String pieceCode = blankToNull(line.pieceCode());
            if (pieceId != null || pieceCode != null) {
                PieceRow piece = (pieceId != null ? pieceRepository.findRow(instituteId, pieceId)
                        : pieceRepository.findRowByCode(instituteId, pieceCode.toUpperCase(Locale.ROOT)))
                        .orElseThrow(() -> new InvalidRequestException("ITEM_NOT_FOUND: piece "
                                + (pieceCode != null ? pieceCode : pieceId) + " does not belong to this institute"));
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
        List<NewLine> out = new ArrayList<>();
        Set<String> seenVariants = new HashSet<>();
        Set<String> seenPieces = new HashSet<>();
        for (int i = 0; i < requested.size(); i++) {
            TransferLineInput line = requested.get(i);
            String note = limited(line.note(), 200, "note");
            if (resolved.get(i) instanceof PieceRow piece) {
                requireMovable(facts.get(piece.getPackageSessionId()), true);
                requirePieceHere(piece, fromLocationId, places);
                if (!seenPieces.add(piece.getId())) {
                    throw new InvalidRequestException("VALIDATION: piece " + piece.getCode() + " is on two lines");
                }
                out.add(new NewLine(piece.getPackageSessionId(), piece.getId(), 1, note));
            } else {
                String variant = (String) resolved.get(i);
                ItemFacts item = facts.get(variant);
                requireMovable(item, false);
                Integer quantity = line.quantity();
                if (quantity == null || quantity < 1 || quantity > MAX_QUANTITY) {
                    throw new InvalidRequestException("VALIDATION: quantity is a whole number of base units from 1 to "
                            + MAX_QUANTITY);
                }
                if (!seenVariants.add(variant)) {
                    throw new InvalidRequestException("VALIDATION: " + item.sku() + " is on two lines; put it on one");
                }
                out.add(new NewLine(variant, null, quantity, note));
            }
        }
        return out;
    }

    private void saveLines(String instituteId, String transferId, List<NewLine> lines) {
        List<StockTransferLine> rows = new ArrayList<>();
        for (NewLine line : lines) {
            StockTransferLine row = new StockTransferLine();
            row.setInstituteId(instituteId);
            row.setTransferId(transferId);
            row.setPackageSessionId(line.packageSessionId());
            row.setPieceId(line.pieceId());
            row.setQtySent(line.quantity());
            row.setNote(line.note());
            rows.add(row);
        }
        lineRepository.saveAllAndFlush(rows);
    }

    /** A variant that may travel: known, counted, not retired, and in the right form. */
    static void requireMovable(ItemFacts item, boolean asPiece) {
        if (item == null) {
            throw new InvalidRequestException("ITEM_NOT_FOUND: an item does not belong to this institute");
        }
        if (!item.tracked()) {
            throw new InvalidRequestException("ITEM_UNTRACKED: " + item.sku() + " is not counted and does not travel "
                    + "on a transfer");
        }
        if (item.archived()) {
            throw new InvalidRequestException("ITEM_ARCHIVED: " + item.sku() + " is retired");
        }
        if (item.piece() && !asPiece) {
            throw new InvalidRequestException("PIECE_SCAN_REQUIRED: scan the piece labels of " + item.sku());
        }
        if (!item.piece() && asPiece) {
            throw new InvalidRequestException("VALIDATION: " + item.sku() + " is counted by quantity, not by piece");
        }
    }

    private static void requirePieceHere(PieceRow piece, String locationId, Map<String, StockLocation> places) {
        if (!PieceStatus.IN_STOCK.name().equals(piece.getStatus()) || !locationId.equals(piece.getLocationId())) {
            StockLocation at = piece.getLocationId() == null ? null : places.get(piece.getLocationId());
            throw new ConflictException("PIECE_NOT_HERE: piece " + piece.getCode() + " is " + piece.getStatus()
                    + (at == null ? "" : " at " + at.getName()));
        }
    }

    // ================================================================== helpers

    private StockTransfer lockDraft(String instituteId, String transferId) {
        StockTransfer transfer = transferRepository.lockForUpdate(instituteId, transferId)
                .orElseThrow(StockTransferService::notFound);
        requireDraft(transfer);
        return transfer;
    }

    private static void requireDraft(StockTransfer transfer) {
        if (!TransferStatus.DRAFT.name().equals(transfer.getStatus())) {
            throw new ConflictException("TRANSFER_NOT_DRAFT: this transfer is " + transfer.getStatus());
        }
    }

    private void requireActive(String instituteId, String locationId) {
        StockLocation location = locationRepository.findByInstituteIdAndId(instituteId, locationId)
                .orElseThrow(() -> new InvalidRequestException("LOCATION_NOT_FOUND: a location does not belong to "
                        + "this institute"));
        if (!LocationStatus.ACTIVE.name().equals(location.getStatus())) {
            throw new ConflictException("LOCATION_INACTIVE: " + location.getName() + " is not active");
        }
    }

    private Map<String, StockLocation> locations(String instituteId) {
        Map<String, StockLocation> out = new HashMap<>();
        for (StockLocation location : locationRepository.findByInstituteIdOrderByCodeAsc(instituteId)) {
            out.put(location.getId(), location);
        }
        return out;
    }

    private static PlaceRef place(StockLocation location, String id, String gstin) {
        return location == null ? new PlaceRef(id, null, null, gstin)
                : new PlaceRef(location.getId(), location.getCode(), location.getName(), gstin);
    }

    /** The tax-inclusive selling price of one base unit, or null when the variant has none. */
    static BigDecimal unitValue(CartVariant price) {
        return price == null || price.price() == null ? null : price.price();
    }

    static boolean overdue(StockTransfer transfer, int days) {
        return TransferStatus.DISPATCHED.name().equals(transfer.getStatus()) && transfer.getDispatchedAt() != null
                && transfer.getDispatchedAt().isBefore(LocalDateTime.now().minusDays(days));
    }

    private static TransferDocumentType documentType(String raw) {
        String name = enumName(TransferDocumentType.class, raw, "document_type");
        return name == null ? null : TransferDocumentType.valueOf(name);
    }

    static <E extends Enum<E>> String enumName(Class<E> type, String raw, String field) {
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

    private static VacademyException notFound() {
        return new VacademyException(HttpStatus.NOT_FOUND, "TRANSFER_NOT_FOUND: no such transfer");
    }

    static String requireId(String raw, String field) {
        String value = blankToNull(raw);
        if (value == null || value.length() > 255) {
            throw new InvalidRequestException("VALIDATION: " + field + " is required");
        }
        return value;
    }

    static String limited(String raw, int max, String field) {
        String value = blankToNull(raw);
        if (value != null && value.length() > max) {
            throw new InvalidRequestException("VALIDATION: " + field + " is longer than " + max + " characters");
        }
        return value;
    }

    static String blankToNull(String value) {
        return value == null || value.isBlank() ? null : value.trim();
    }

    private static String clip(String value, int max) {
        return value == null || value.length() <= max ? value : value.substring(0, max);
    }

    private static long nz(Long value) {
        return value == null ? 0 : value;
    }

    static String text(Object value) {
        return value == null ? null : value.toString();
    }

    private static String json(Object value) {
        try {
            return MAPPER.writeValueAsString(value);
        } catch (JsonProcessingException e) {
            throw new IllegalStateException("could not write a transfer as JSON", e);
        }
    }
}
