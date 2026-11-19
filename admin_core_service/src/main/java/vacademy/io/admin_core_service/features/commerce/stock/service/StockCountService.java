package vacademy.io.admin_core_service.features.commerce.stock.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.JsonNode;
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
import vacademy.io.admin_core_service.features.commerce.order.desk.CommerceStockShortFlagger;
import vacademy.io.admin_core_service.features.commerce.security.CommerceAccessDeniedException;
import vacademy.io.admin_core_service.features.commerce.security.CommerceApprovalService;
import vacademy.io.admin_core_service.features.commerce.stock.dto.StockOpsDtos;
import vacademy.io.admin_core_service.features.commerce.stock.dto.StockOpsDtos.AcceptLineRequest;
import vacademy.io.admin_core_service.features.commerce.stock.dto.StockOpsDtos.Agreement;
import vacademy.io.admin_core_service.features.commerce.stock.dto.StockOpsDtos.Approval;
import vacademy.io.admin_core_service.features.commerce.stock.dto.StockOpsDtos.CancelRequest;
import vacademy.io.admin_core_service.features.commerce.stock.dto.StockOpsDtos.Caller;
import vacademy.io.admin_core_service.features.commerce.stock.dto.StockOpsDtos.CollectionRef;
import vacademy.io.admin_core_service.features.commerce.stock.dto.StockOpsDtos.CountCreateRequest;
import vacademy.io.admin_core_service.features.commerce.stock.dto.StockOpsDtos.CountLineInput;
import vacademy.io.admin_core_service.features.commerce.stock.dto.StockOpsDtos.CountLineView;
import vacademy.io.admin_core_service.features.commerce.stock.dto.StockOpsDtos.CountLinesAnswer;
import vacademy.io.admin_core_service.features.commerce.stock.dto.StockOpsDtos.CountLinesRequest;
import vacademy.io.admin_core_service.features.commerce.stock.dto.StockOpsDtos.CountPostRequest;
import vacademy.io.admin_core_service.features.commerce.stock.dto.StockOpsDtos.CountReview;
import vacademy.io.admin_core_service.features.commerce.stock.dto.StockOpsDtos.CountRow;
import vacademy.io.admin_core_service.features.commerce.stock.dto.StockOpsDtos.CountView;
import vacademy.io.admin_core_service.features.commerce.stock.dto.StockOpsDtos.CountsAnswer;
import vacademy.io.admin_core_service.features.commerce.stock.dto.StockOpsDtos.LineCountAnswer;
import vacademy.io.admin_core_service.features.commerce.stock.dto.StockOpsDtos.LocationRef;
import vacademy.io.admin_core_service.features.commerce.stock.dto.StockOpsDtos.RecountRef;
import vacademy.io.admin_core_service.features.commerce.stock.dto.StockOpsDtos.ReviewLine;
import vacademy.io.admin_core_service.features.commerce.stock.dto.StockOpsDtos.ReviewPiece;
import vacademy.io.admin_core_service.features.commerce.stock.dto.StockOpsDtos.ReviewTotals;
import vacademy.io.admin_core_service.features.commerce.stock.dto.StockOpsDtos.UncountedItem;
import vacademy.io.admin_core_service.features.commerce.stock.entity.StockCount;
import vacademy.io.admin_core_service.features.commerce.stock.entity.StockCountLine;
import vacademy.io.admin_core_service.features.commerce.stock.entity.StockLocation;
import vacademy.io.admin_core_service.features.commerce.stock.entity.StockMovement;
import vacademy.io.admin_core_service.features.commerce.stock.enums.StockCountKind;
import vacademy.io.admin_core_service.features.commerce.stock.enums.StockCountStatus;
import vacademy.io.admin_core_service.features.commerce.stock.enums.StockMovementType;
import vacademy.io.admin_core_service.features.commerce.stock.enums.UncountedChoice;
import vacademy.io.admin_core_service.features.commerce.stock.repository.CommercePieceRepository;
import vacademy.io.admin_core_service.features.commerce.stock.repository.CommercePieceRepository.PieceRow;
import vacademy.io.admin_core_service.features.commerce.stock.repository.StockCountLineRepository;
import vacademy.io.admin_core_service.features.commerce.stock.repository.StockCountRepository;
import vacademy.io.admin_core_service.features.commerce.stock.repository.StockLevelRepository;
import vacademy.io.admin_core_service.features.commerce.stock.repository.StockLocationRepository;
import vacademy.io.admin_core_service.features.commerce.stock.repository.StockMovementRepository;
import vacademy.io.admin_core_service.features.commerce.stock.repository.StockOpsReadRepository;
import vacademy.io.admin_core_service.features.commerce.stock.repository.StockOpsReadRepository.ItemFacts;
import vacademy.io.admin_core_service.features.commerce.stock.repository.StockOpsReadRepository.PieceState;
import vacademy.io.admin_core_service.features.commerce.stock.repository.StockOpsReadRepository.StockCountParcel;
import vacademy.io.admin_core_service.features.commerce.stock.service.CommerceStockSettings.AdjustmentLimits;
import vacademy.io.admin_core_service.features.commerce.stock.service.StockCountMath.CountedLine;
import vacademy.io.admin_core_service.features.commerce.stock.service.StockCountMath.Parcel;
import vacademy.io.admin_core_service.features.commerce.stock.service.StockCountMath.PieceHere;
import vacademy.io.admin_core_service.features.commerce.stock.service.StockCountMath.PieceSets;
import vacademy.io.admin_core_service.features.commerce.stock.service.StockCountMath.ScannedOutcome;
import vacademy.io.common.exceptions.ConflictException;
import vacademy.io.common.exceptions.InvalidRequestException;
import vacademy.io.common.exceptions.VacademyException;

import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HexFormat;
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
 * Stock counts (WP-40). A count is taken while the shop trades: lines are saved as they are
 * scanned or typed, each with the database time it was counted, and the post corrects each
 * quantity by {@link StockCountMath#adjustment} under the locks of the location's level rows, so
 * sales after a line was counted are not undone. Pieces are compared as sets. A blind recount by
 * another person posts no movement; it is compared with the count it rechecks.
 *
 * <p>No answer here shows a system quantity while a count is open, except the review (to the
 * stock staff of the location, never to the person doing the blind recount). The people who
 * started or saved lines of a count ("main counters") never open, see, change or post its blind
 * recount, and the recounter never sees or changes the count while the recount is open.
 *
 * <p>A line built by several ADD scans has a first and a last save; when stock of the item moved
 * at the location between the two, which part of the shelf it moved from cannot be known, so the
 * line is flagged {@code NEEDS_RECOUNT} and the post refuses it until it is counted again (SET)
 * or a manager accepts it. Units packed in parcels and not shipped are on hand but not on the
 * shelf (ARCHITECTURE 4.8, as a RESERVED piece): the post adds them back.
 */
@Slf4j
@Service
public class StockCountService {

    public static final String REFERENCE_COUNT = "STOCK_COUNT";
    public static final String ACTION_CREATE = "COUNT_CREATE";
    public static final String ACTION_LINES = "COUNT_LINES";
    public static final String ACTION_POST = "COUNT_POST";
    public static final String ACTION_CANCEL = "COUNT_CANCEL";
    public static final String APPROVAL_POST = "STOCK_COUNT_POST";
    public static final String REASON_DIFFERENCE = "COUNT_DIFFERENCE";
    public static final String REASON_FOUND = "FOUND";
    public static final String RECOUNT_OTHER_PERSON = "RECOUNT_OTHER_PERSON";

    static final int MAX_LINES = 5_000;
    static final int MAX_LINES_PER_SAVE = 200;
    static final int MAX_SET = 10_000_000;
    static final int MAX_ADD = 100_000;
    private static final int MAX_PAGE_SIZE = 100;
    private static final ObjectMapper MAPPER = new ObjectMapper();

    private final StockCountRepository countRepository;
    private final StockCountLineRepository lineRepository;
    private final StockLocationRepository locationRepository;
    private final StockLevelRepository levelRepository;
    private final StockMovementRepository movementRepository;
    private final CommercePieceRepository pieceRepository;
    private final StockOpsReadRepository readRepository;
    private final StockLedgerService ledger;
    private final CommerceCounterService counters;
    private final CommerceRequestGuard requestGuard;
    private final CommerceAuditService auditService;
    private final CommerceStockSettings settings;
    private final CommerceApprovalService approvalService;
    private final ObjectProvider<CommerceStockShortFlagger> shortFlagger;
    private final TransactionTemplate transaction;
    private final TransactionTemplate readOnly;

    public StockCountService(StockCountRepository countRepository, StockCountLineRepository lineRepository,
                             StockLocationRepository locationRepository, StockLevelRepository levelRepository,
                             StockMovementRepository movementRepository, CommercePieceRepository pieceRepository,
                             StockOpsReadRepository readRepository, StockLedgerService ledger,
                             CommerceCounterService counters, CommerceRequestGuard requestGuard,
                             CommerceAuditService auditService, CommerceStockSettings settings,
                             CommerceApprovalService approvalService,
                             ObjectProvider<CommerceStockShortFlagger> shortFlagger,
                             PlatformTransactionManager transactionManager) {
        this.countRepository = countRepository;
        this.lineRepository = lineRepository;
        this.locationRepository = locationRepository;
        this.levelRepository = levelRepository;
        this.movementRepository = movementRepository;
        this.pieceRepository = pieceRepository;
        this.readRepository = readRepository;
        this.ledger = ledger;
        this.counters = counters;
        this.requestGuard = requestGuard;
        this.auditService = auditService;
        this.settings = settings;
        this.approvalService = approvalService;
        this.shortFlagger = shortFlagger;
        this.transaction = new TransactionTemplate(transactionManager);
        this.readOnly = new TransactionTemplate(transactionManager);
        this.readOnly.setReadOnly(true);
    }

    /** A count opened by this call (201), or the one an earlier call with the same key opened (200). */
    public record Created(CountView view, boolean created) {
    }

    // ================================================================== reads

    public StockCount get(String instituteId, String countId) {
        return countRepository.findByInstituteIdAndId(instituteId, countId == null ? "" : countId.trim())
                .orElseThrow(StockCountService::notFound);
    }

    /** 403 RECOUNT_BLIND for the person doing an open blind recount of this count. */
    public void requireNotBlind(String instituteId, StockCount count, Caller caller) {
        if (!StockCountKind.COUNT.name().equals(count.getKind())) {
            return;
        }
        for (StockCount recount : countRepository.findRecountsOf(instituteId, count.getId())) {
            if (StockCountStatus.OPEN.name().equals(recount.getStatus())
                    && caller.userId().equals(recount.getStartedBy())) {
                throw new CommerceAccessDeniedException("RECOUNT_BLIND",
                        "you are doing a blind recount of this count; you see it once your recount is finished");
            }
        }
    }

    /** The main count's starter and everyone on its lines: they never do or see its blind recount. */
    Set<String> mainCounters(String instituteId, StockCount main) {
        Set<String> out = new HashSet<>(lineRepository.countedBy(instituteId, main.getId()));
        out.add(main.getStartedBy());
        return out;
    }

    /** The recount's starter, or a manager or ADMIN who is not a main counter. */
    private static boolean mayWorkOnRecount(StockCount recount, Caller caller, Set<String> mainCounters) {
        if (caller == null || mainCounters.contains(caller.userId())) {
            return false;
        }
        return caller.userId().equals(recount.getStartedBy()) || caller.manager();
    }

    /** 403 RECOUNT_OTHER_PERSON unless the caller may count, change or post this recount. */
    void requireRecountWorker(String instituteId, StockCount recount, Caller caller) {
        StockCount main = get(instituteId, recount.getRecountOfCountId());
        if (!mayWorkOnRecount(recount, caller, mainCounters(instituteId, main))) {
            throw new CommerceAccessDeniedException(RECOUNT_OTHER_PERSON, "only the person doing this blind recount "
                    + "(or a manager who did not count the first count) works on it");
        }
    }

    /** Lines and posts: the recount rules on a RECOUNT, blindness on a COUNT. */
    private void requireMayWork(String instituteId, StockCount count, Caller caller) {
        if (StockCountKind.RECOUNT.name().equals(count.getKind())) {
            requireRecountWorker(instituteId, count, caller);
        } else {
            requireNotBlind(instituteId, count, caller);
        }
    }

    public CountView view(String instituteId, String countId, Caller caller) {
        return readOnly.execute(status -> {
            StockCount count = get(instituteId, countId);
            requireNotBlind(instituteId, count, caller);
            if (StockCountKind.RECOUNT.name().equals(count.getKind())
                    && StockCountStatus.OPEN.name().equals(count.getStatus())) {
                StockCount main = get(instituteId, count.getRecountOfCountId());
                if (mainCounters(instituteId, main).contains(caller.userId())) {
                    throw new CommerceAccessDeniedException(RECOUNT_OTHER_PERSON, "you counted the count this blind "
                            + "recount checks; you see it once it is finished");
                }
            }
            return view(instituteId, count, caller);
        });
    }

    public CountsAnswer list(String instituteId, Caller caller, String locationId, String status, String kind,
                             int page, int size) {
        String statusName = StockTransferService.enumName(StockCountStatus.class, status, "status");
        String kindName = StockTransferService.enumName(StockCountKind.class, kind, "kind");
        Set<String> visible = caller.visibleLocationIds();
        boolean all = visible == null;
        int pageNo = Math.max(page, 0);
        int pageSize = Math.min(Math.max(size, 1), MAX_PAGE_SIZE);
        if (!all && visible.isEmpty()) {
            return new CountsAnswer(List.of(), pageNo, pageSize, 0);
        }
        return readOnly.execute(tx -> {
            Page<StockCount> rows = countRepository.search(instituteId, all, all ? List.of("-") : visible,
                    StockTransferService.blankToNull(locationId), statusName, kindName,
                    PageRequest.of(pageNo, pageSize, Sort.by(Sort.Direction.DESC, "startedAt")
                            .and(Sort.by(Sort.Direction.DESC, "id"))));
            List<String> ids = rows.getContent().stream().map(StockCount::getId).toList();
            Map<String, Long> totals = new HashMap<>();
            if (!ids.isEmpty()) {
                lineRepository.totals(instituteId, ids).forEach(t -> totals.put(t.getCountId(), t.getLineCount()));
            }
            Map<String, StockLocation> places = locations(instituteId);
            Map<String, String> collections = readRepository.collectionNames(instituteId,
                    rows.getContent().stream().map(StockCount::getScopeCollectionId).filter(id -> id != null).toList());
            // Open counts are few (one a location, plus its recount): their actions cost a read each.
            Set<String> openRecountOf = new HashSet<>();
            for (StockCount count : rows.getContent()) {
                if (StockCountKind.COUNT.name().equals(count.getKind())
                        && StockCountStatus.OPEN.name().equals(count.getStatus())) {
                    for (StockCount recount : countRepository.findRecountsOf(instituteId, count.getId())) {
                        if (StockCountStatus.OPEN.name().equals(recount.getStatus())) {
                            openRecountOf.add(count.getId());
                        }
                    }
                }
            }
            List<CountRow> out = new ArrayList<>();
            for (StockCount count : rows.getContent()) {
                out.add(new CountRow(count.getId(), count.getCountNumber(), count.getKind(), count.getStatus(),
                        location(places, count.getLocationId()), collection(collections, count.getScopeCollectionId()),
                        count.getStartedBy(), text(count.getStartedAt()), text(count.getPostedAt()),
                        totals.getOrDefault(count.getId(), 0L), count.getRecountOfCountId(),
                        nextActions(instituteId, count, caller, openRecountOf.contains(count.getId()))));
            }
            return new CountsAnswer(out, pageNo, pageSize, rows.getTotalElements());
        });
    }

    // ================================================================== open

    public Created open(String instituteId, Caller caller, CountCreateRequest request) {
        if (request == null) {
            throw new InvalidRequestException("VALIDATION: request body is required");
        }
        String key = CommerceRequestGuard.requireClientKey(request.clientRequestId());
        String hash = CommerceRequestGuard.hash(ACTION_CREATE, request);
        String locationId = StockTransferService.requireId(request.locationId(), "location_id");
        String kindName = StockTransferService.enumName(StockCountKind.class, request.kind(), "kind");
        StockCountKind kind = kindName == null ? StockCountKind.COUNT : StockCountKind.valueOf(kindName);
        String note = StockTransferService.limited(request.note(), 500, "note");

        Created earlier = transaction.execute(status -> countRepository
                .findByInstituteIdAndClientRequestId(instituteId, key)
                .map(found -> sameOrRefuse(instituteId, found, hash, caller)).orElse(null));
        if (earlier != null) {
            return earlier;
        }
        record Opening(String scopeCollectionId, String recountOf) {
        }
        Opening opening = transaction.execute(status -> {
            locationRepository.findByInstituteIdAndId(instituteId, locationId)
                    .orElseThrow(() -> new InvalidRequestException("LOCATION_NOT_FOUND: location_id does not belong "
                            + "to this institute"));
            if (kind == StockCountKind.COUNT) {
                if (StockTransferService.blankToNull(request.recountOfCountId()) != null) {
                    throw new InvalidRequestException("VALIDATION: recount_of_count_id is for a RECOUNT only");
                }
                String scope = StockTransferService.blankToNull(request.scopeCollectionId());
                if (scope != null && readRepository.collectionNames(instituteId, List.of(scope)).isEmpty()) {
                    throw new InvalidRequestException("VALIDATION: scope_collection_id is not a collection of this "
                            + "institute");
                }
                countRepository.findOpenCount(instituteId, locationId).ifPresent(open -> {
                    throw alreadyOpen(open);
                });
                return new Opening(scope, null);
            }
            String mainId = StockTransferService.requireId(request.recountOfCountId(), "recount_of_count_id");
            StockCount main = get(instituteId, mainId);
            if (!StockCountKind.COUNT.name().equals(main.getKind()) || !locationId.equals(main.getLocationId())) {
                throw new InvalidRequestException("VALIDATION: a recount rechecks a count of the same location");
            }
            if (!StockCountStatus.OPEN.name().equals(main.getStatus())) {
                throw new ConflictException("COUNT_NOT_OPEN: count " + main.getCountNumber() + " is "
                        + main.getStatus());
            }
            if (mainCounters(instituteId, main).contains(caller.userId())) {
                throw new ConflictException("RECOUNT_SAME_PERSON: a recount must be done by someone who did not "
                        + "count this count");
            }
            for (StockCount recount : countRepository.findRecountsOf(instituteId, mainId)) {
                if (StockCountStatus.OPEN.name().equals(recount.getStatus())) {
                    throw alreadyOpen(recount);
                }
            }
            return new Opening(main.getScopeCollectionId(), mainId);
        });
        String number = counters.nextNumber(instituteId, CommerceCounterService.SCOPE_COUNT);
        try {
            return transaction.execute(status -> {
                StockCount count = new StockCount();
                count.setInstituteId(instituteId);
                count.setCountNumber(number);
                count.setLocationId(locationId);
                count.setScopeCollectionId(opening.scopeCollectionId());
                count.setKind(kind.name());
                count.setRecountOfCountId(opening.recountOf());
                count.setStatus(StockCountStatus.OPEN.name());
                count.setNote(note);
                count.setStartedBy(caller.userId());
                count.setClientRequestId(key);
                count.setRequestHash(hash);
                count = countRepository.saveAndFlush(count);
                Map<String, Object> audit = new LinkedHashMap<>();
                audit.put("count_number", number);
                audit.put("kind", kind.name());
                audit.put("scope_collection_id", opening.scopeCollectionId());
                audit.put("recount_of_count_id", opening.recountOf());
                auditService.record(instituteId, caller.userId(), locationId, "STOCK_COUNT_OPENED", REFERENCE_COUNT,
                        count.getId(), null, json(audit), null);
                return new Created(view(instituteId, count, caller), true);
            });
        } catch (DataIntegrityViolationException e) {
            Created winner = transaction.execute(status -> countRepository
                    .findByInstituteIdAndClientRequestId(instituteId, key)
                    .map(found -> sameOrRefuse(instituteId, found, hash, caller)).orElse(null));
            if (winner != null) {
                return winner;
            }
            // The unique index of open counts: another count opened here a moment ago.
            StockCount open = transaction.execute(status -> opening.recountOf() == null
                    ? countRepository.findOpenCount(instituteId, locationId).orElse(null)
                    : countRepository.findRecountsOf(instituteId, opening.recountOf()).stream()
                    .filter(c -> StockCountStatus.OPEN.name().equals(c.getStatus())).findFirst().orElse(null));
            if (open != null) {
                throw alreadyOpen(open);
            }
            throw e;
        }
    }

    private static ConflictException alreadyOpen(StockCount open) {
        return new ConflictException("COUNT_ALREADY_OPEN: count " + open.getCountNumber()
                + " is open at this location");
    }

    private Created sameOrRefuse(String instituteId, StockCount earlier, String hash, Caller caller) {
        if (!hash.equals(earlier.getRequestHash())) {
            throw new ConflictException(CommerceRequestGuard.IDEMPOTENCY_MISMATCH
                    + ": client_request_id was already used for another count");
        }
        return new Created(view(instituteId, earlier, caller).withReplayed(), false);
    }

    // ================================================================== lines

    /** One resolved line to write. */
    private record LineWrite(String packageSessionId, String pieceId, boolean add, int quantity) {
    }

    /** Saves lines as they are scanned or typed; each change is saved at once by the screen. */
    public CountLinesAnswer saveLines(String instituteId, Caller caller, String countId, CountLinesRequest request) {
        if (request == null || request.lines() == null || request.lines().isEmpty()) {
            throw new InvalidRequestException("VALIDATION: lines is required");
        }
        if (request.lines().size() > MAX_LINES_PER_SAVE) {
            throw new InvalidRequestException("VALIDATION: at most " + MAX_LINES_PER_SAVE + " lines at once");
        }
        String key = CommerceRequestGuard.requireClientKey(request.clientRequestId());
        readOnly.executeWithoutResult(tx -> requireMayWork(instituteId, get(instituteId, countId), caller));
        CommerceRequestGuard.Key guardKey = new CommerceRequestGuard.Key(instituteId, key, ACTION_LINES,
                REFERENCE_COUNT, countId, CommerceRequestGuard.hash(ACTION_LINES, request, countId), caller.userId());
        List<LineWrite> written = new ArrayList<>();
        CommerceRequestGuard.Outcome<CountLinesAnswer> outcome = requestGuard.run(guardKey, () -> {
            String status = countRepository.lockStatusShared(instituteId, countId)
                    .orElseThrow(StockCountService::notFound);
            if (!StockCountStatus.OPEN.name().equals(status)) {
                throw new ConflictException("COUNT_NOT_OPEN: this count is " + status);
            }
            StockCount count = get(instituteId, countId);
            List<LineWrite> writes = resolveLineWrites(instituteId, count, request.lines());
            // One order for every save, so two scanners on one count never wait on each other in a circle.
            List<LineWrite> sorted = new ArrayList<>(writes);
            sorted.sort(Comparator.comparing(LineWrite::packageSessionId)
                    .thenComparing(w -> w.pieceId() == null ? "" : w.pieceId()));
            for (LineWrite write : sorted) {
                String id = UUID.randomUUID().toString();
                if (write.pieceId() != null) {
                    lineRepository.insertPiece(id, instituteId, countId, write.packageSessionId(), write.pieceId(),
                            caller.userId());
                } else if (write.add()) {
                    lineRepository.upsertAdd(id, instituteId, countId, write.packageSessionId(), write.quantity(),
                            caller.userId());
                } else {
                    lineRepository.upsertSet(id, instituteId, countId, write.packageSessionId(), write.quantity(),
                            caller.userId());
                }
            }
            long total = lineRepository.countByInstituteIdAndCountId(instituteId, countId);
            if (total > MAX_LINES) {
                throw new ConflictException("COUNT_TOO_LARGE: a count holds at most " + MAX_LINES
                        + " lines; count the rest in another count");
            }
            written.addAll(writes);
            return touched(instituteId, count, writes, total, null);
        }, () -> {
            StockCount count = get(instituteId, countId);
            List<LineWrite> writes = new ArrayList<>();
            for (CountLineInput input : request.lines()) {
                if (input != null && StockTransferService.blankToNull(input.packageSessionId()) != null
                        && StockTransferService.blankToNull(input.pieceId()) == null
                        && StockTransferService.blankToNull(input.pieceCode()) == null) {
                    writes.add(new LineWrite(input.packageSessionId().trim(), null, false, 0));
                }
            }
            return touched(instituteId, count, writes, lineRepository.countByInstituteIdAndCountId(instituteId, countId),
                    Boolean.TRUE);
        });
        return outcome.value();
    }

    private List<LineWrite> resolveLineWrites(String instituteId, StockCount count, List<CountLineInput> inputs) {
        List<Object> resolved = new ArrayList<>();
        Set<String> variants = new HashSet<>();
        for (CountLineInput input : inputs) {
            if (input == null) {
                throw new InvalidRequestException("VALIDATION: a line is empty");
            }
            String pieceId = StockTransferService.blankToNull(input.pieceId());
            String pieceCode = StockTransferService.blankToNull(input.pieceCode());
            if (pieceId != null || pieceCode != null) {
                PieceRow piece = (pieceId != null ? pieceRepository.findRow(instituteId, pieceId)
                        : pieceRepository.findRowByCode(instituteId, pieceCode.toUpperCase(Locale.ROOT)))
                        .orElseThrow(() -> new VacademyException(HttpStatus.NOT_FOUND,
                                "CODE_NOT_FOUND: " + (pieceCode != null ? pieceCode : pieceId) + " is not a piece of "
                                        + "this institute"));
                resolved.add(piece);
                variants.add(piece.getPackageSessionId());
            } else {
                String variant = StockTransferService.blankToNull(input.packageSessionId());
                if (variant == null) {
                    throw new InvalidRequestException("VALIDATION: a line names a package_session_id or a piece");
                }
                resolved.add(variant);
                variants.add(variant);
            }
        }
        Map<String, ItemFacts> facts = readRepository.itemFacts(instituteId, variants);
        Map<String, Boolean> inScope = new HashMap<>();
        List<LineWrite> out = new ArrayList<>();
        for (int i = 0; i < inputs.size(); i++) {
            CountLineInput input = inputs.get(i);
            if (resolved.get(i) instanceof PieceRow piece) {
                ItemFacts item = facts.get(piece.getPackageSessionId());
                if (item == null) {
                    throw new InvalidRequestException("ITEM_NOT_FOUND: an item does not belong to this institute");
                }
                if (!item.tracked()) {
                    throw new InvalidRequestException("ITEM_UNTRACKED: " + item.sku() + " is not counted");
                }
                requireInScope(instituteId, count, item, inScope);
                out.add(new LineWrite(piece.getPackageSessionId(), piece.getId(), false, 1));
                continue;
            }
            String variant = (String) resolved.get(i);
            ItemFacts item = facts.get(variant);
            if (item == null) {
                throw new InvalidRequestException("ITEM_NOT_FOUND: an item does not belong to this institute");
            }
            if (!item.tracked()) {
                throw new InvalidRequestException("ITEM_UNTRACKED: " + item.sku() + " is not counted");
            }
            if (item.archived()) {
                throw new InvalidRequestException("ITEM_ARCHIVED: " + item.sku() + " is retired");
            }
            if (item.piece()) {
                throw new InvalidRequestException("PIECE_SCAN_REQUIRED: scan the piece labels of " + item.sku());
            }
            requireInScope(instituteId, count, item, inScope);
            String mode = input.mode() == null ? "SET" : input.mode().trim().toUpperCase(Locale.ROOT);
            Integer quantity = input.quantity();
            if ("ADD".equals(mode) && item.qtyScale() > 1
                    && (quantity == null || !Boolean.TRUE.equals(input.explicitQuantity()))) {
                // A scan of a roll or shelf label is not one base unit (0.1 m): the length is typed.
                throw new InvalidRequestException("QTY_REQUIRED: type the length of " + item.sku() + " (in "
                        + item.unit() + ")");
            }
            if ("ADD".equals(mode)) {
                if (quantity == null || quantity < 1 || quantity > MAX_ADD) {
                    throw new InvalidRequestException("VALIDATION: an ADD is 1 to " + MAX_ADD + " base units");
                }
            } else if ("SET".equals(mode)) {
                if (quantity == null || quantity < 0 || quantity > MAX_SET) {
                    throw new InvalidRequestException("VALIDATION: a SET is 0 to " + MAX_SET + " base units");
                }
            } else {
                throw new InvalidRequestException("VALIDATION: mode is SET or ADD");
            }
            out.add(new LineWrite(variant, null, "ADD".equals(mode), quantity));
        }
        return out;
    }

    private void requireInScope(String instituteId, StockCount count, ItemFacts item, Map<String, Boolean> cache) {
        if (count.getScopeCollectionId() == null) {
            return;
        }
        boolean in = cache.computeIfAbsent(item.packageId(),
                packageId -> readRepository.inCollection(instituteId, count.getScopeCollectionId(), packageId));
        if (!in) {
            throw new ConflictException("COUNT_OUT_OF_SCOPE: " + item.sku() + " is not in the collection this "
                    + "count covers");
        }
    }

    private CountLinesAnswer touched(String instituteId, StockCount count, List<LineWrite> writes, long total,
                                     Boolean replayed) {
        List<StockCountLine> lines = new ArrayList<>();
        Set<String> seen = new HashSet<>();
        for (LineWrite write : writes) {
            (write.pieceId() != null
                    ? lineRepository.findByInstituteIdAndCountIdAndPieceId(instituteId, count.getId(), write.pieceId())
                    : lineRepository.findByInstituteIdAndCountIdAndPackageSessionIdAndPieceIdIsNull(instituteId,
                    count.getId(), write.packageSessionId()))
                    .filter(line -> seen.add(line.getId()))
                    .ifPresent(lines::add);
        }
        return new CountLinesAnswer(lineViews(instituteId, lines), total, replayed);
    }

    public LineCountAnswer deleteLine(String instituteId, Caller caller, String countId, String lineId) {
        return transaction.execute(tx -> {
            String status = countRepository.lockStatusShared(instituteId, countId)
                    .orElseThrow(StockCountService::notFound);
            if (!StockCountStatus.OPEN.name().equals(status)) {
                throw new ConflictException("COUNT_NOT_OPEN: this count is " + status);
            }
            requireMayWork(instituteId, get(instituteId, countId), caller);
            lineRepository.deleteLine(instituteId, countId, lineId);
            return new LineCountAnswer(lineRepository.countByInstituteIdAndCountId(instituteId, countId));
        });
    }

    /**
     * A manager accepts a line whose stock moved while it was being counted, as it stands: it then
     * posts with its last save as its count time. Only while its counted quantity is still the one
     * the manager looked at; any later save of the line clears the acceptance.
     */
    public CountLinesAnswer accept(String instituteId, Caller caller, String countId, String lineId,
                                   AcceptLineRequest request) {
        if (!caller.manager()) {
            throw new CommerceAccessDeniedException(CommerceAccessDeniedException.ROLE_NOT_ALLOWED,
                    "only a manager accepts a line that changed while it was being counted");
        }
        if (request == null || request.countedQty() == null) {
            throw new InvalidRequestException("VALIDATION: counted_qty is required");
        }
        return transaction.execute(tx -> {
            String status = countRepository.lockStatusShared(instituteId, countId)
                    .orElseThrow(StockCountService::notFound);
            if (!StockCountStatus.OPEN.name().equals(status)) {
                throw new ConflictException("COUNT_NOT_OPEN: this count is " + status);
            }
            StockCount count = get(instituteId, countId);
            if (!StockCountKind.COUNT.name().equals(count.getKind())) {
                throw new InvalidRequestException("VALIDATION: a recount posts nothing; there is nothing to accept");
            }
            requireNotBlind(instituteId, count, caller);
            String id = lineId == null ? "" : lineId.trim();
            StockCountLine line = lineRepository.findByInstituteIdAndCountIdAndId(instituteId, countId, id)
                    .orElseThrow(() -> new VacademyException(HttpStatus.NOT_FOUND,
                            "COUNT_LINE_NOT_FOUND: no such line on this count"));
            if (line.getPieceId() != null) {
                throw new InvalidRequestException("VALIDATION: a scanned piece has nothing to accept");
            }
            if (lineRepository.accept(instituteId, countId, id, request.countedQty(), caller.userId()) == 0) {
                throw new ConflictException("COUNT_LINE_CHANGED: this line changed meanwhile; look at it again");
            }
            Map<String, Object> audit = new LinkedHashMap<>();
            audit.put("line_id", id);
            audit.put("package_session_id", line.getPackageSessionId());
            audit.put("counted_qty", request.countedQty());
            auditService.record(instituteId, caller.userId(), count.getLocationId(), "STOCK_COUNT_LINE_ACCEPTED",
                    REFERENCE_COUNT, countId, null, json(audit), null);
            StockCountLine fresh = lineRepository.findByInstituteIdAndCountIdAndId(instituteId, countId, id)
                    .orElseThrow(StockCountService::notFound);
            return new CountLinesAnswer(lineViews(instituteId, List.of(fresh)),
                    lineRepository.countByInstituteIdAndCountId(instituteId, countId), null);
        });
    }

    // ================================================================== review

    public CountReview review(String instituteId, Caller caller, String countId) {
        return readOnly.execute(tx -> {
            StockCount count = get(instituteId, countId);
            requireNotBlind(instituteId, count, caller);
            boolean recount = StockCountKind.RECOUNT.name().equals(count.getKind());
            if (StockCountStatus.POSTED.name().equals(count.getStatus())) {
                return storedReview(instituteId, count, caller.seesCost());
            }
            if (!StockCountStatus.OPEN.name().equals(count.getStatus())) {
                throw new ConflictException("COUNT_NOT_OPEN: this count is " + count.getStatus());
            }
            if (recount) {
                throw new ConflictException("RECOUNT_NOT_FINISHED: a recount is compared once it is finished");
            }
            return build(instituteId, count, null, false, caller.seesCost()).review();
        });
    }

    /** The review, the movements it posts and the line results; the same code with or without locks. */
    private record Model(CountReview review, List<StockPosting> postings, Map<String, LineResult> lineResults,
                         BigDecimal absoluteValue, boolean overLimit, Map<String, Object> summary,
                         List<String> needsRecount, List<String> measured, String fingerprint,
                         String zeroPrint) {
    }

    /** What the post stamps on a line. */
    private record LineResult(int onHand, int moved, Integer packed, int adjustment) {
    }

    private Model build(String instituteId, StockCount count, UncountedChoice choice, boolean lock, boolean withValue) {
        String locationId = count.getLocationId();
        List<StockCountLine> lines = lineRepository.findByInstituteIdAndCountIdOrderByCreatedAtAscIdAsc(instituteId,
                count.getId());
        Set<String> counted = new LinkedHashSet<>();
        lines.forEach(line -> counted.add(line.getPackageSessionId()));
        Map<String, ItemFacts> facts = new HashMap<>(readRepository.itemFacts(instituteId, counted));
        List<String> countedTracked = counted.stream()
                .filter(id -> facts.get(id) != null && facts.get(id).tracked()).sorted().toList();
        if (lock) {
            for (String variant : countedTracked) {
                levelRepository.insertIfMissing(UUID.randomUUID().toString(), instituteId, locationId, variant);
            }
        }
        Map<String, Integer> levels = lock
                ? readRepository.lockScopeLevels(instituteId, locationId, count.getScopeCollectionId(), countedTracked)
                : readRepository.scopeLevels(instituteId, locationId, count.getScopeCollectionId(), countedTracked);
        List<PieceState> here = readRepository.piecesAt(instituteId, locationId, count.getScopeCollectionId(),
                count.getStartedAt());
        Map<String, PieceState> scanned = readRepository.scannedPieces(instituteId, count.getId());
        Set<String> more = new HashSet<>(levels.keySet());
        here.forEach(p -> more.add(p.packageSessionId()));
        scanned.values().forEach(p -> more.add(p.packageSessionId()));
        more.removeAll(facts.keySet());
        facts.putAll(readRepository.itemFacts(instituteId, more));
        Map<String, StockLocation> places = locations(instituteId);
        AdjustmentLimits limits = settings.adjustmentLimits(instituteId);
        BigDecimal measuredThreshold = settings.countMeasuredDifference(instituteId);
        List<Parcel> parcels = new ArrayList<>();
        boolean anyQuantityLine = lines.stream().anyMatch(line -> line.getPieceId() == null);
        if (anyQuantityLine) {
            for (StockCountParcel p : readRepository.parcelsSince(instituteId, locationId, count.getStartedAt())) {
                List<StockCountMath.Sale> sales = new ArrayList<>();
                p.sales().forEach(sale -> sales.add(new StockCountMath.Sale(sale.at(), sale.delta())));
                parcels.add(new Parcel(p.packageSessionId(), p.units(), p.packedAt(), p.status(), p.cancelledAt(),
                        sales));
            }
        }

        List<StockPosting> postings = new ArrayList<>();
        Map<String, LineResult> results = new LinkedHashMap<>();
        List<String> needsRecount = new ArrayList<>();
        List<String> measured = new ArrayList<>();
        StringBuilder fingerprint = new StringBuilder();
        List<ReviewLine> reviewLines = new ArrayList<>();
        boolean over = false;
        BigDecimal absolute = BigDecimal.ZERO;
        int linesWithDifference = 0;
        int unitsUp = 0;
        int unitsDown = 0;
        BigDecimal valueUp = BigDecimal.ZERO;
        BigDecimal valueDown = BigDecimal.ZERO;
        Map<String, String> lineOfPiece = new HashMap<>();
        Set<String> scannedVariants = new HashSet<>();

        for (StockCountLine line : lines) {
            fingerprint.append(line.getId()).append(':').append(line.getCountedQty()).append(':')
                    .append(line.getAcceptedBy() == null ? "" : "A").append(';');
            ItemFacts item = facts.get(line.getPackageSessionId());
            String countedAt = text(line.getCountedAt());
            if (line.getPieceId() != null) {
                lineOfPiece.put(line.getPieceId(), line.getId());
                scannedVariants.add(line.getPackageSessionId());
                continue;
            }
            if (item == null || !item.tracked()) {
                reviewLines.add(new ReviewLine(line.getId(), line.getPackageSessionId(), item == null ? null : item.sku(),
                        item == null ? null : item.productName(), item == null ? null : item.variantName(),
                        item == null ? null : item.stockMode(), item == null ? null : item.unit(),
                        item == null ? null : item.qtyScale(), null, line.getCountedQty(), countedAt,
                        text(line.getFirstCountedAt()), null, null, null, null, 0, null, null, null, null));
                continue;
            }
            String variant = line.getPackageSessionId();
            int onHand = levels.getOrDefault(variant, 0);
            boolean accepted = line.getAcceptedBy() != null;
            LocalDateTime last = line.getCountedAt();
            LocalDateTime first = line.getFirstCountedAt() == null || line.getFirstCountedAt().isAfter(last) ? last
                    : line.getFirstCountedAt();
            // Did stock of the item move here between the first and the last save of the line?
            int movedWhile = 0;
            boolean changedWhileCounting = false;
            if (first.isBefore(last)) {
                int[] between = readRepository.movementsBetween(instituteId, locationId, variant, first, last);
                int packedChange = Math.abs(StockCountMath.packedAt(parcels, variant, last)
                        - StockCountMath.packedAt(parcels, variant, first));
                movedWhile = between[1] + packedChange;
                changedWhileCounting = between[0] > 0 || packedChange != 0;
            }
            // The line's count time: its first save (identical to the last when nothing moved in
            // between), or the last save once a manager accepted a line that changed.
            LocalDateTime at = accepted ? last : first;
            int moved = movementRepository.sumMovedSince(instituteId, locationId, variant, at);
            int packed = StockCountMath.packedAt(parcels, variant, at);
            int adjustment = StockCountMath.adjustment(line.getCountedQty(), moved, packed, onHand);
            BigDecimal value = StockCountMath.value(adjustment, item.costPrice());
            results.put(line.getId(), new LineResult(onHand, moved, packed, adjustment));
            List<String> flags = new ArrayList<>();
            if (accepted) {
                flags.add(StockOpsDtos.FLAG_RECOUNT_ACCEPTED);
            } else if (changedWhileCounting) {
                flags.add(StockOpsDtos.FLAG_NEEDS_RECOUNT);
                needsRecount.add(item.sku());
            }
            if (StockCountMath.largeMeasuredDifference(adjustment, item.qtyScale(), measuredThreshold)) {
                flags.add(StockOpsDtos.FLAG_MEASURED_CONFIRM);
                measured.add(item.sku());
                // Staff need a manager for it (the PIN is the manager's confirm).
                over = true;
            }
            if (adjustment != 0) {
                linesWithDifference++;
                over |= StockCountMath.overLimit(adjustment, value, limits.quantity(), limits.value());
                absolute = absolute.add(value == null ? BigDecimal.ZERO : value.abs());
                if (adjustment > 0) {
                    unitsUp += adjustment;
                    valueUp = valueUp.add(value == null ? BigDecimal.ZERO : value);
                } else {
                    unitsDown -= adjustment;
                    valueDown = valueDown.add(value == null ? BigDecimal.ZERO : value.abs());
                }
                postings.add(adjustmentPosting(instituteId, count, line.getPackageSessionId(), null, adjustment,
                        REASON_DIFFERENCE, "COUNT:" + line.getId()));
            }
            reviewLines.add(new ReviewLine(line.getId(), variant, item.sku(), item.productName(), item.variantName(),
                    item.stockMode(), item.unit(), item.qtyScale(), null, line.getCountedQty(), countedAt,
                    text(first), onHand, moved, packed, StockCountMath.expectedAtCount(onHand, moved, packed),
                    adjustment, withValue ? value : null, movedWhile, flags.isEmpty() ? null : flags,
                    line.getAcceptedBy()));
        }

        // Pieces that were scanned.
        List<ReviewPiece> found = new ArrayList<>();
        List<ReviewPiece> misplaced = new ArrayList<>();
        List<ReviewPiece> notInStock = new ArrayList<>();
        for (PieceState piece : scanned.values()) {
            ScannedOutcome outcome = StockCountMath.classifyScanned(piece.status(), piece.locationId(), locationId);
            ReviewPiece shown = reviewPiece(piece, facts, places);
            String lineId = lineOfPiece.get(piece.pieceId());
            int adjustment = 0;
            switch (outcome) {
                case FOUND -> {
                    found.add(shown);
                    adjustment = 1;
                    BigDecimal value = StockCountMath.value(1, piece.unitCost());
                    over |= StockCountMath.overLimit(1, value, limits.quantity(), limits.value());
                    absolute = absolute.add(value == null ? BigDecimal.ZERO : value);
                    unitsUp++;
                    valueUp = valueUp.add(value == null ? BigDecimal.ZERO : value);
                    postings.add(adjustmentPosting(instituteId, count, piece.packageSessionId(), piece.pieceId(), 1,
                            REASON_FOUND, "COUNT:" + lineId));
                }
                case MISPLACED -> misplaced.add(shown);
                case NOT_IN_STOCK -> notInStock.add(shown);
                default -> {
                }
            }
            ItemFacts item = facts.get(piece.packageSessionId());
            results.put(lineId, new LineResult(levels.getOrDefault(piece.packageSessionId(), 0), 0, null, adjustment));
            reviewLines.add(new ReviewLine(lineId, piece.packageSessionId(), item == null ? null : item.sku(),
                    item == null ? null : item.productName(), item == null ? null : item.variantName(),
                    item == null ? null : item.stockMode(), item == null ? null : item.unit(),
                    item == null ? null : item.qtyScale(), piece.code(), 1, null, null, null, null, null, null,
                    adjustment, withValue && adjustment != 0 ? StockCountMath.value(1, piece.unitCost()) : null,
                    null, null, null));
        }

        // Pieces here that nobody scanned.
        List<PieceHere> pieceHere = new ArrayList<>();
        Map<String, PieceState> hereById = new HashMap<>();
        for (PieceState piece : here) {
            pieceHere.add(new PieceHere(piece.pieceId(), piece.packageSessionId(), piece.status(),
                    piece.movedHereSince()));
            hereById.put(piece.pieceId(), piece);
        }
        PieceSets sets = StockCountMath.pieceSets(pieceHere, scanned.keySet(), scannedVariants, choice);
        List<ReviewPiece> missing = new ArrayList<>();
        for (String pieceId : sets.missing()) {
            PieceState piece = hereById.get(pieceId);
            missing.add(reviewPiece(piece, facts, places));
            BigDecimal value = StockCountMath.value(1, piece.unitCost());
            over |= StockCountMath.overLimit(1, value, limits.quantity(), limits.value());
            absolute = absolute.add(value == null ? BigDecimal.ZERO : value);
            unitsDown++;
            valueDown = valueDown.add(value == null ? BigDecimal.ZERO : value);
            postings.add(adjustmentPosting(instituteId, count, piece.packageSessionId(), pieceId, -1,
                    REASON_DIFFERENCE, "COUNT_MISSING:" + count.getId() + ":" + pieceId));
        }
        List<ReviewPiece> reserved = sets.reservedNotCounted().stream()
                .map(id -> reviewPiece(hereById.get(id), facts, places)).toList();
        List<ReviewPiece> arrived = sets.arrivedDuringCount().stream()
                .map(id -> reviewPiece(hereById.get(id), facts, places)).toList();

        // Items nobody counted. What ZERO would write off (each quantity item's on hand, and the
        // pieces of items nobody scanned) is printed whatever the choice, so a review taken
        // without a choice binds a ZERO post to the same write-off.
        StringBuilder zeroPrint = new StringBuilder();
        Set<String> countedVariants = new HashSet<>(counted);
        List<UncountedItem> uncounted = new ArrayList<>();
        for (String variant : StockCountMath.uncounted(levels, countedVariants)) {
            ItemFacts item = facts.get(variant);
            int onHand = levels.get(variant);
            if (item != null && !item.piece()) {
                zeroPrint.append(variant).append(':').append(onHand).append(';');
            }
            uncounted.add(new UncountedItem(variant, item == null ? null : item.sku(),
                    item == null ? null : item.productName(), item == null ? null : item.variantName(),
                    item == null ? null : item.stockMode(), item == null ? null : item.unit(),
                    item == null ? null : item.qtyScale(), onHand));
            if (choice == UncountedChoice.ZERO && item != null && !item.piece()) {
                BigDecimal value = StockCountMath.value(-onHand, item.costPrice());
                over |= StockCountMath.overLimit(onHand, value, limits.quantity(), limits.value());
                absolute = absolute.add(value == null ? BigDecimal.ZERO : value.abs());
                unitsDown += onHand;
                valueDown = valueDown.add(value == null ? BigDecimal.ZERO : value.abs());
                postings.add(adjustmentPosting(instituteId, count, variant, null, -onHand, REASON_DIFFERENCE,
                        "COUNT_ZERO:" + count.getId() + ":" + variant));
            }
        }

        ReviewTotals totals = new ReviewTotals(linesWithDifference, unitsUp, unitsDown,
                withValue ? valueUp : null, withValue ? valueDown : null);
        List<String> zeroPieces = new ArrayList<>(StockCountMath.pieceSets(pieceHere, scanned.keySet(),
                scannedVariants, UncountedChoice.ZERO).missing());
        zeroPieces.sort(null);
        zeroPieces.forEach(pieceId -> zeroPrint.append("P").append(pieceId).append(';'));
        String print = sha256(fingerprint.toString());
        String zero = sha256(zeroPrint.toString());
        CountReview review = new CountReview(count.getId(), LocalDateTime.now().toString(), reviewLines, uncounted,
                missing, found, misplaced, notInStock, reserved, arrived, totals, over, needsRecount.size(),
                !measured.isEmpty(), print + "." + zero);

        Map<String, Object> summary = new LinkedHashMap<>();
        summary.put("lines", lines.size());
        summary.put("lines_with_difference", linesWithDifference);
        summary.put("units_up", unitsUp);
        summary.put("units_down", unitsDown);
        summary.put("missing", missing.size());
        summary.put("found", found.size());
        summary.put("misplaced", misplaced.size());
        summary.put("uncounted", uncounted.size());
        summary.put("value_up", valueUp);
        summary.put("value_down", valueDown);
        Map<String, Object> detail = new LinkedHashMap<>();
        detail.put("uncounted", uncounted);
        detail.put("missing_pieces", missing);
        detail.put("found_pieces", found);
        detail.put("misplaced_pieces", misplaced);
        detail.put("not_in_stock_pieces", notInStock);
        detail.put("reserved_not_counted", reserved);
        detail.put("arrived_during_count", arrived);
        summary.put("detail", detail);
        return new Model(review, postings, results, absolute, over, summary, needsRecount, measured, print, zero);
    }

    private static String sha256(String text) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256")
                    .digest(text.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 is not available", e);
        }
    }

    private StockPosting adjustmentPosting(String instituteId, StockCount count, String packageSessionId,
                                           String pieceId, int delta, String reason, String key) {
        return StockPosting.builder()
                .instituteId(instituteId)
                .locationId(count.getLocationId())
                .packageSessionId(packageSessionId)
                .pieceId(pieceId)
                .type(StockMovementType.ADJUSTMENT)
                .quantityDelta(delta)
                .reason(reason)
                .referenceType(REFERENCE_COUNT)
                .referenceId(count.getId())
                .actorUserId(null)
                .idempotencyKey(key)
                .build();
    }

    private CountReview storedReview(String instituteId, StockCount count, boolean withValue) {
        List<StockCountLine> lines = lineRepository.findByInstituteIdAndCountIdOrderByCreatedAtAscIdAsc(instituteId,
                count.getId());
        Map<String, ItemFacts> facts = readRepository.itemFacts(instituteId,
                lines.stream().map(StockCountLine::getPackageSessionId).toList());
        Map<String, String> codes = readRepository.pieceCodes(instituteId,
                lines.stream().map(StockCountLine::getPieceId).filter(id -> id != null).toList());
        Map<String, BigDecimal> movementCost = new HashMap<>();
        if (withValue) {
            List<String> movementIds = lines.stream().map(StockCountLine::getMovementId).filter(id -> id != null).toList();
            for (StockMovement movement : movementRepository.findAllById(movementIds)) {
                if (movement.getUnitCost() != null) {
                    movementCost.put(movement.getId(), movement.getUnitCost());
                }
            }
        }
        List<ReviewLine> out = new ArrayList<>();
        for (StockCountLine line : lines) {
            ItemFacts item = facts.get(line.getPackageSessionId());
            boolean piece = line.getPieceId() != null;
            Integer onHand = piece ? null : line.getOnHandAtPost();
            Integer moved = piece ? null : line.getMovedSince();
            Integer packed = piece ? null : line.getPackedUnshipped();
            BigDecimal cost = line.getMovementId() == null ? null : movementCost.get(line.getMovementId());
            int adjustment = line.getAdjustment() == null ? 0 : line.getAdjustment();
            out.add(new ReviewLine(line.getId(), line.getPackageSessionId(), item == null ? null : item.sku(),
                    item == null ? null : item.productName(), item == null ? null : item.variantName(),
                    item == null ? null : item.stockMode(), item == null ? null : item.unit(),
                    item == null ? null : item.qtyScale(), piece ? codes.get(line.getPieceId()) : null,
                    line.getCountedQty(), piece ? null : text(line.getCountedAt()),
                    piece ? null : text(line.getFirstCountedAt()), onHand, moved, packed,
                    onHand == null || moved == null ? null
                            : StockCountMath.expectedAtCount(onHand, moved, packed == null ? 0 : packed),
                    line.getAdjustment(), withValue && cost != null ? StockCountMath.value(adjustment, cost) : null,
                    null, line.getAcceptedBy() == null ? null : List.of(StockOpsDtos.FLAG_RECOUNT_ACCEPTED),
                    line.getAcceptedBy()));
        }
        JsonNode summary = summaryNode(count);
        JsonNode detail = summary.path("detail");
        return new CountReview(count.getId(), text(count.getPostedAt()), out,
                list(detail.path("uncounted"), new TypeReference<List<UncountedItem>>() { }),
                list(detail.path("missing_pieces"), new TypeReference<List<ReviewPiece>>() { }),
                list(detail.path("found_pieces"), new TypeReference<List<ReviewPiece>>() { }),
                list(detail.path("misplaced_pieces"), new TypeReference<List<ReviewPiece>>() { }),
                list(detail.path("not_in_stock_pieces"), new TypeReference<List<ReviewPiece>>() { }),
                list(detail.path("reserved_not_counted"), new TypeReference<List<ReviewPiece>>() { }),
                list(detail.path("arrived_during_count"), new TypeReference<List<ReviewPiece>>() { }),
                new ReviewTotals(summary.path("lines_with_difference").asInt(0), summary.path("units_up").asInt(0),
                        summary.path("units_down").asInt(0),
                        withValue && summary.hasNonNull("value_up") ? summary.get("value_up").decimalValue() : null,
                        withValue && summary.hasNonNull("value_down") ? summary.get("value_down").decimalValue() : null),
                false, 0, false, null);
    }

    // ================================================================== post

    /** Posts a count (or finishes a recount). A count posts once; the same key answers a replay. */
    public CountView post(String instituteId, Caller caller, String countId, CountPostRequest request) {
        if (request == null) {
            throw new InvalidRequestException("VALIDATION: request body is required");
        }
        String key = CommerceRequestGuard.requireClientKey(request.clientRequestId());
        CommerceRequestGuard.Key guardKey = new CommerceRequestGuard.Key(instituteId, key, ACTION_POST,
                REFERENCE_COUNT, countId, CommerceRequestGuard.hash(ACTION_POST, request.withoutApproval(), countId),
                caller.userId());
        Supplier<CountView> current = () -> view(instituteId, get(instituteId, countId), caller);
        CommerceRequestGuard.Outcome<CountView> done = requestGuard.replayIfDone(guardKey, current);
        if (done != null) {
            return done.value().withReplayed();
        }
        StockCount count = transaction.execute(status -> get(instituteId, countId));
        if (!StockCountStatus.OPEN.name().equals(count.getStatus())) {
            throw new ConflictException("COUNT_NOT_OPEN: this count is " + count.getStatus());
        }
        if (StockCountKind.RECOUNT.name().equals(count.getKind())) {
            readOnly.executeWithoutResult(tx -> requireRecountWorker(instituteId, count, caller));
            return answer(requestGuard.run(guardKey, () -> finishRecount(instituteId, caller, countId), current));
        }
        readOnly.executeWithoutResult(tx -> requireNotBlind(instituteId, count, caller));
        String choiceName = StockTransferService.blankToNull(request.uncounted()) == null ? null
                : StockTransferService.enumName(UncountedChoice.class, request.uncounted(), "uncounted");
        if (choiceName == null) {
            throw new InvalidRequestException("VALIDATION: choose what happens to items that were not counted");
        }
        UncountedChoice choice = UncountedChoice.valueOf(choiceName);
        Model before = transaction.execute(status -> {
            requireNoOpenRecount(instituteId, count);
            return build(instituteId, count, choice, false, true);
        });
        boolean manager = caller.manager();
        boolean confirmMeasured = Boolean.TRUE.equals(request.confirmMeasured());
        String reviewed = StockTransferService.blankToNull(request.reviewFingerprint());
        requireReviewed(before, reviewed, choice);
        requirePostable(before, manager, confirmMeasured);
        Approval approval = request.approval();
        boolean approvalGiven = approval != null && StockTransferService.blankToNull(approval.approverUserId()) != null
                && StockTransferService.blankToNull(approval.pin()) != null;
        if (before.overLimit() && !manager && !approvalGiven) {
            throw new CommerceAccessDeniedException(StockTransferService.APPROVAL_REQUIRED,
                    "this count has differences above your limit and needs a manager");
        }
        return answer(requestGuard.run(guardKey, () -> {
            String approvedBy = null;
            if (!manager && approvalGiven && before.overLimit()) {
                // First, before any stock lock: the approval commits or rolls back with the post.
                approvalService.approve(instituteId, count.getLocationId(), caller.userId(),
                        approval.approverUserId().trim(), approval.pin(), APPROVAL_POST, REFERENCE_COUNT, countId,
                        before.absoluteValue(), StockTransferService.blankToNull(approval.reason()));
                approvedBy = approval.approverUserId().trim();
            }
            StockCount locked = countRepository.lockForUpdate(instituteId, countId)
                    .orElseThrow(StockCountService::notFound);
            if (!StockCountStatus.OPEN.name().equals(locked.getStatus())) {
                throw new ConflictException("COUNT_NOT_OPEN: this count is " + locked.getStatus());
            }
            requireNoOpenRecount(instituteId, locked);
            // The location's shared lock first, then its level rows: the order every posting uses.
            locationRepository.lockForPosting(instituteId, locked.getLocationId())
                    .orElseThrow(() -> new InvalidRequestException("LOCATION_NOT_FOUND: the count's location"));
            Model model = build(instituteId, locked, choice, true, true);
            // Under the lock: the lines, and with ZERO the write-off of uncounted items, as reviewed.
            requireReviewed(model, reviewed, choice);
            requirePostable(model, manager, confirmMeasured);
            if (model.overLimit() && !manager && approvedBy == null) {
                throw new CommerceAccessDeniedException(StockTransferService.APPROVAL_REQUIRED,
                        "this count has differences above your limit and needs a manager");
            }
            if (approvedBy != null && (!model.fingerprint().equals(before.fingerprint())
                    || (choice == UncountedChoice.ZERO && !model.zeroPrint().equals(before.zeroPrint())))) {
                // The manager approved the lines as they were; lines saved since were not approved.
                throw new CommerceAccessDeniedException(StockTransferService.APPROVAL_REQUIRED,
                        "the count changed after the manager approved it; review it and approve again");
            }
            List<StockPosting> postings = new ArrayList<>();
            for (StockPosting posting : model.postings()) {
                postings.add(posting.toBuilder().actorUserId(caller.userId()).build());
            }
            List<StockPostResult> results = ledger.postAll(postings);
            Map<String, String> movementByKey = new HashMap<>();
            for (StockPostResult result : results) {
                if (result.movement() != null) {
                    movementByKey.put(result.movement().getIdempotencyKey(), result.movement().getId());
                }
            }
            model.lineResults().forEach((lineId, result) -> lineRepository.stampPost(instituteId, lineId,
                    result.onHand(), result.moved(), result.packed(), result.adjustment(),
                    movementByKey.get("COUNT:" + lineId)));
            Map<String, Object> summary = new LinkedHashMap<>(model.summary());
            summary.put("approved_by", approvedBy);
            locked.setStatus(StockCountStatus.POSTED.name());
            locked.setPostedAt(LocalDateTime.now());
            locked.setPostedBy(caller.userId());
            locked.setUncountedChoice(choice.name());
            locked.setSummaryJson(json(summary));
            locked = countRepository.saveAndFlush(locked);

            Map<String, Object> audit = new LinkedHashMap<>(model.summary());
            audit.remove("detail");
            audit.put("uncounted_choice", choice.name());
            audit.put("approved_by", approvedBy);
            auditService.record(instituteId, caller.userId(), locked.getLocationId(), "STOCK_COUNT_POSTED",
                    REFERENCE_COUNT, locked.getId(), null, json(audit), null);
            CommerceStockShortFlagger flagger = shortFlagger.getIfAvailable();
            if (flagger != null) {
                for (StockPostResult result : results) {
                    if (result.sellableShortfall() > 0 && result.movement() != null) {
                        flagger.afterCommit(instituteId, locked.getLocationId(),
                                result.movement().getPackageSessionId(), result.sellableShortfall());
                    }
                }
            }
            return view(instituteId, locked, caller);
        }, current));
    }

    /**
     * 409 COUNT_CHANGED when the post names the review it was approved on and the lines changed
     * since, or (ZERO) what is written off for uncounted items changed: an item came into scope or
     * its stock here changed after the review. A fingerprint without the uncounted part (a screen
     * loaded before it existed) binds the lines only.
     */
    private static void requireReviewed(Model model, String reviewed, UncountedChoice choice) {
        if (reviewed == null) {
            return;
        }
        int dot = reviewed.indexOf('.');
        String lines = dot < 0 ? reviewed : reviewed.substring(0, dot);
        boolean changed = !lines.equals(model.fingerprint());
        if (!changed && dot >= 0 && choice == UncountedChoice.ZERO) {
            changed = !reviewed.substring(dot + 1).equals(model.zeroPrint());
        }
        if (changed) {
            throw new ConflictException("COUNT_CHANGED: lines of this count changed since it was reviewed; review it "
                    + "again");
        }
    }

    /** 409 when a line needs a recount, or a large measured difference has no manager's confirm. */
    private static void requirePostable(Model model, boolean manager, boolean confirmMeasured) {
        if (!model.needsRecount().isEmpty()) {
            throw new ConflictException("COUNT_NEEDS_RECOUNT: " + model.needsRecount().size() + " line(s) changed while "
                    + "they were being counted (" + String.join(", ", model.needsRecount().stream().limit(5).toList())
                    + "); count them again or a manager accepts them");
        }
        if (manager && !model.measured().isEmpty() && !confirmMeasured) {
            throw new ConflictException("MEASURED_CONFIRM_REQUIRED: " + String.join(", ",
                    model.measured().stream().limit(5).toList()) + " differ(s) by more than the measured limit; a "
                    + "manager confirms it");
        }
    }

    private CountView finishRecount(String instituteId, Caller caller, String countId) {
        StockCount locked = countRepository.lockForUpdate(instituteId, countId).orElseThrow(StockCountService::notFound);
        if (!StockCountStatus.OPEN.name().equals(locked.getStatus())) {
            throw new ConflictException("COUNT_NOT_OPEN: this count is " + locked.getStatus());
        }
        requireRecountWorker(instituteId, locked, caller);
        Agreement agreement = StockCountMath.agreement(
                counted(lineRepository.findByInstituteIdAndCountIdOrderByCreatedAtAscIdAsc(instituteId,
                        locked.getRecountOfCountId())),
                counted(lineRepository.findByInstituteIdAndCountIdOrderByCreatedAtAscIdAsc(instituteId, countId)));
        Map<String, Object> summary = new LinkedHashMap<>();
        summary.put("lines", agreement.compared());
        summary.put("agreement", agreement);
        locked.setStatus(StockCountStatus.POSTED.name());
        locked.setPostedAt(LocalDateTime.now());
        locked.setPostedBy(caller.userId());
        locked.setSummaryJson(json(summary));
        locked = countRepository.saveAndFlush(locked);
        auditService.record(instituteId, caller.userId(), locked.getLocationId(), "STOCK_COUNT_POSTED",
                REFERENCE_COUNT, locked.getId(), null, json(summary), null);
        return view(instituteId, locked, caller);
    }

    private static List<CountedLine> counted(List<StockCountLine> lines) {
        List<CountedLine> out = new ArrayList<>();
        lines.forEach(line -> out.add(new CountedLine(line.getPackageSessionId(), line.getPieceId(),
                line.getCountedQty())));
        return out;
    }

    private void requireNoOpenRecount(String instituteId, StockCount count) {
        for (StockCount recount : countRepository.findRecountsOf(instituteId, count.getId())) {
            if (StockCountStatus.OPEN.name().equals(recount.getStatus())) {
                throw new ConflictException("RECOUNT_OPEN: recount " + recount.getCountNumber()
                        + " of this count is still open; finish or cancel it first");
            }
        }
    }

    // ================================================================== cancel

    public CountView cancel(String instituteId, Caller caller, String countId, CancelRequest request) {
        if (request == null) {
            throw new InvalidRequestException("VALIDATION: request body is required");
        }
        String key = CommerceRequestGuard.requireClientKey(request.clientRequestId());
        String reason = StockTransferService.limited(request.reason(), 500, "reason");
        CommerceRequestGuard.Key guardKey = new CommerceRequestGuard.Key(instituteId, key, ACTION_CANCEL,
                REFERENCE_COUNT, countId, CommerceRequestGuard.hash(ACTION_CANCEL, request, countId), caller.userId());
        Supplier<CountView> current = () -> view(instituteId, get(instituteId, countId), caller);
        return answer(requestGuard.run(guardKey, () -> {
            StockCount locked = countRepository.lockForUpdate(instituteId, countId)
                    .orElseThrow(StockCountService::notFound);
            if (!caller.userId().equals(locked.getStartedBy()) && !caller.manager()) {
                throw new CommerceAccessDeniedException(CommerceAccessDeniedException.ROLE_NOT_ALLOWED,
                        "only the person who started the count or a manager cancels it");
            }
            if (!StockCountStatus.OPEN.name().equals(locked.getStatus())) {
                throw new ConflictException("COUNT_NOT_OPEN: this count is " + locked.getStatus());
            }
            for (StockCount recount : countRepository.findRecountsOf(instituteId, locked.getId())) {
                if (StockCountStatus.OPEN.name().equals(recount.getStatus())) {
                    StockCount open = countRepository.lockForUpdate(instituteId, recount.getId()).orElse(recount);
                    open.setStatus(StockCountStatus.CANCELLED.name());
                    open.setCancelledAt(LocalDateTime.now());
                    open.setCancelledBy(caller.userId());
                    countRepository.saveAndFlush(open);
                }
            }
            locked.setStatus(StockCountStatus.CANCELLED.name());
            locked.setCancelledAt(LocalDateTime.now());
            locked.setCancelledBy(caller.userId());
            locked = countRepository.saveAndFlush(locked);
            auditService.record(instituteId, caller.userId(), locked.getLocationId(), "STOCK_COUNT_CANCELLED",
                    REFERENCE_COUNT, locked.getId(), null, null, reason);
            return view(instituteId, locked, caller);
        }, current));
    }

    // ================================================================== view

    CountView view(String instituteId, StockCount count, Caller caller) {
        Map<String, StockLocation> places = locations(instituteId);
        Map<String, String> collections = readRepository.collectionNames(instituteId,
                count.getScopeCollectionId() == null ? List.of() : List.of(count.getScopeCollectionId()));
        List<StockCountLine> lines = lineRepository.findByInstituteIdAndCountIdOrderByCreatedAtAscIdAsc(instituteId,
                count.getId());
        boolean isCount = StockCountKind.COUNT.name().equals(count.getKind());
        RecountRef recount = null;
        boolean recountOpen = false;
        if (isCount) {
            List<StockCount> recounts = countRepository.findRecountsOf(instituteId, count.getId());
            for (StockCount r : recounts) {
                recountOpen |= StockCountStatus.OPEN.name().equals(r.getStatus());
            }
            if (!recounts.isEmpty()) {
                StockCount latest = recounts.get(0);
                recount = new RecountRef(latest.getId(), latest.getStatus(), agreementOf(latest));
            }
        }
        Map<String, Object> summary = null;
        if (count.getSummaryJson() != null) {
            summary = MAPPER.convertValue(summaryNode(count), new TypeReference<Map<String, Object>>() { });
            summary.remove("detail");
            summary.remove("approved_by");
            if (caller == null || !caller.seesCost()) {
                summary.remove("value_up");
                summary.remove("value_down");
            }
        }
        List<String> actions = nextActions(instituteId, count, caller, recountOpen);
        return new CountView(count.getId(), count.getCountNumber(), count.getKind(), count.getStatus(),
                location(places, count.getLocationId()), collection(collections, count.getScopeCollectionId()),
                count.getRecountOfCountId(), recount, count.getNote(), count.getStartedBy(), text(count.getStartedAt()),
                text(count.getPostedAt()), count.getPostedBy(), count.getUncountedChoice(), summary,
                lineViews(instituteId, lines), lines.size(), actions, null);
    }

    /**
     * What the caller may do with a count, the same on the count and in the list: on an open
     * COUNT, COUNT, REVIEW, POST (no recount open), ACCEPT (manager), CANCEL (starter or manager)
     * and RECOUNT (not a main counter, no recount open); on an open RECOUNT, COUNT and POST for
     * its worker; REVIEW on a posted COUNT.
     */
    private List<String> nextActions(String instituteId, StockCount count, Caller caller, boolean recountOpen) {
        boolean isCount = StockCountKind.COUNT.name().equals(count.getKind());
        boolean open = StockCountStatus.OPEN.name().equals(count.getStatus());
        List<String> actions = new ArrayList<>();
        if (open && caller != null && caller.actsAt(count.getLocationId())) {
            if (isCount) {
                actions.add("COUNT");
                actions.add("REVIEW");
                if (!recountOpen) {
                    actions.add("POST");
                }
                if (caller.manager()) {
                    actions.add("ACCEPT");
                }
            } else {
                StockCount main = countRepository.findByInstituteIdAndId(instituteId, count.getRecountOfCountId())
                        .orElse(null);
                if (main != null && mayWorkOnRecount(count, caller, mainCounters(instituteId, main))) {
                    actions.add("COUNT");
                    actions.add("POST");
                }
            }
            if (caller.userId().equals(count.getStartedBy()) || caller.manager()) {
                actions.add("CANCEL");
            }
            if (isCount && !recountOpen && !mainCounters(instituteId, count).contains(caller.userId())) {
                actions.add("RECOUNT");
            }
        } else if (StockCountStatus.POSTED.name().equals(count.getStatus()) && isCount && caller != null
                && caller.actsAt(count.getLocationId())) {
            actions.add("REVIEW");
        }
        return actions;
    }

    private Agreement agreementOf(StockCount recount) {
        if (recount.getSummaryJson() == null) {
            return null;
        }
        JsonNode node = summaryNode(recount).path("agreement");
        if (node.isMissingNode() || node.isNull()) {
            return null;
        }
        return new Agreement(node.path("compared").asInt(0), node.path("agreeing").asInt(0),
                node.hasNonNull("percent") ? node.get("percent").decimalValue() : BigDecimal.ZERO,
                node.path("passes").asBoolean(false));
    }

    private List<CountLineView> lineViews(String instituteId, List<StockCountLine> lines) {
        Map<String, ItemFacts> facts = readRepository.itemFacts(instituteId,
                lines.stream().map(StockCountLine::getPackageSessionId).toList());
        Map<String, String> codes = readRepository.pieceCodes(instituteId,
                lines.stream().map(StockCountLine::getPieceId).filter(id -> id != null).toList());
        List<CountLineView> out = new ArrayList<>();
        for (StockCountLine line : lines) {
            ItemFacts item = facts.get(line.getPackageSessionId());
            out.add(new CountLineView(line.getId(), line.getPackageSessionId(), item == null ? null : item.sku(),
                    item == null ? null : item.productName(), item == null ? null : item.variantName(),
                    item == null ? null : item.stockMode(), item == null ? null : item.unit(),
                    item == null ? null : item.qtyScale(), line.getPieceId(),
                    line.getPieceId() == null ? null : codes.get(line.getPieceId()), line.getCountedQty(),
                    text(line.getCountedAt()), line.getCountedBy()));
        }
        return out;
    }

    private static ReviewPiece reviewPiece(PieceState piece, Map<String, ItemFacts> facts,
                                           Map<String, StockLocation> places) {
        ItemFacts item = facts.get(piece.packageSessionId());
        StockLocation at = piece.locationId() == null ? null : places.get(piece.locationId());
        return new ReviewPiece(piece.pieceId(), piece.code(), item == null ? null : item.sku(),
                item == null ? null : item.productName(), piece.status(), at == null ? null : at.getName());
    }

    // ================================================================== helpers

    private static CountView answer(CommerceRequestGuard.Outcome<CountView> outcome) {
        return outcome.replayed() ? outcome.value().withReplayed() : outcome.value();
    }

    private Map<String, StockLocation> locations(String instituteId) {
        Map<String, StockLocation> out = new HashMap<>();
        for (StockLocation location : locationRepository.findByInstituteIdOrderByCodeAsc(instituteId)) {
            out.put(location.getId(), location);
        }
        return out;
    }

    private static LocationRef location(Map<String, StockLocation> places, String id) {
        StockLocation location = places.get(id);
        return new LocationRef(id, location == null ? null : location.getName());
    }

    private static CollectionRef collection(Map<String, String> names, String id) {
        return id == null ? null : new CollectionRef(id, names.get(id));
    }

    private static JsonNode summaryNode(StockCount count) {
        try {
            return count.getSummaryJson() == null ? MAPPER.createObjectNode() : MAPPER.readTree(count.getSummaryJson());
        } catch (JsonProcessingException e) {
            log.warn("Count {} has an unreadable summary: {}", count.getId(), e.getMessage());
            return MAPPER.createObjectNode();
        }
    }

    private static <T> List<T> list(JsonNode node, TypeReference<List<T>> type) {
        if (node == null || !node.isArray()) {
            return List.of();
        }
        return MAPPER.convertValue(node, type);
    }

    private static VacademyException notFound() {
        return new VacademyException(HttpStatus.NOT_FOUND, "COUNT_NOT_FOUND: no such count");
    }

    private static String text(Object value) {
        return value == null ? null : value.toString();
    }

    private static String json(Object value) {
        try {
            return MAPPER.writeValueAsString(value);
        } catch (JsonProcessingException e) {
            throw new IllegalStateException("could not write a count as JSON", e);
        }
    }
}
