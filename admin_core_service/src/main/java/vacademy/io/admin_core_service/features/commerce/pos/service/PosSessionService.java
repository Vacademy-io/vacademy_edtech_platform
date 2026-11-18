package vacademy.io.admin_core_service.features.commerce.pos.service;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import lombok.extern.slf4j.Slf4j;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import vacademy.io.admin_core_service.features.commerce.audit.CommerceAuditService;
import vacademy.io.admin_core_service.features.commerce.common.request.CommerceRequestGuard;
import vacademy.io.admin_core_service.features.commerce.order.enums.TenderMode;
import vacademy.io.admin_core_service.features.commerce.pos.dto.PosDtos;
import vacademy.io.admin_core_service.features.commerce.pos.entity.PosCashMovement;
import vacademy.io.admin_core_service.features.commerce.pos.entity.PosRegister;
import vacademy.io.admin_core_service.features.commerce.pos.entity.PosSession;
import vacademy.io.admin_core_service.features.commerce.pos.enums.CashMovementReference;
import vacademy.io.admin_core_service.features.commerce.pos.enums.CashMovementType;
import vacademy.io.admin_core_service.features.commerce.pos.enums.PosApprovalAction;
import vacademy.io.admin_core_service.features.commerce.pos.enums.PosRegisterStatus;
import vacademy.io.admin_core_service.features.commerce.pos.enums.PosSessionStatus;
import vacademy.io.admin_core_service.features.commerce.pos.repository.PosCashMovementRepository;
import vacademy.io.admin_core_service.features.commerce.pos.repository.PosReadRepository;
import vacademy.io.admin_core_service.features.commerce.pos.repository.PosRegisterRepository;
import vacademy.io.admin_core_service.features.commerce.pos.repository.PosSessionRepository;
import vacademy.io.admin_core_service.features.commerce.security.CommerceApprovalService;
import vacademy.io.admin_core_service.features.commerce.security.entity.CommerceStaffLocation;
import vacademy.io.admin_core_service.features.commerce.security.repository.CommerceStaffLocationRepository;
import vacademy.io.admin_core_service.features.commerce.stock.entity.StockLocation;
import vacademy.io.admin_core_service.features.commerce.stock.repository.StockLocationRepository;
import vacademy.io.admin_core_service.features.commerce.tax.service.CommerceInputRules;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.ConflictException;
import vacademy.io.common.exceptions.InvalidRequestException;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.Date;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;

/**
 * Counter sessions: open (with the drawer's opening cash), the open session of a register,
 * cash in and out (managers), the close with the cash count and the frozen day report
 * (Z-report), and the session list and detail.
 *
 * <p>Expected cash is one formula, read by {@code pos_session_id}: opening cash + CASH tenders
 * RECEIVED + cash in − cash out − CASH refunds PROCESSED. The close takes the session row FOR
 * UPDATE, so it waits for every sale in flight (they hold it FOR SHARE) and then recomputes.
 */
@Slf4j
@Service
public class PosSessionService {

    public static final String SESSION_ALREADY_OPEN = "SESSION_ALREADY_OPEN";
    public static final String SESSION_NOT_OPEN = "SESSION_NOT_OPEN";
    public static final String REGISTER_INACTIVE = "REGISTER_INACTIVE";
    public static final String OPENING_NOTE_REQUIRED = "OPENING_NOTE_REQUIRED";
    public static final String VARIANCE_NOTE_REQUIRED = "VARIANCE_NOTE_REQUIRED";
    public static final String COUNT_MISMATCH = "COUNT_MISMATCH";
    public static final String APPROVAL_REQUIRED = "APPROVAL_REQUIRED";

    public static final String ACTION_SELL = "SELL";
    public static final String ACTION_CASH_MOVEMENT = "CASH_MOVEMENT";
    public static final String ACTION_CLOSE = "CLOSE";
    public static final String ACTION_BILL_BOOK = "BILL_BOOK";

    /** The notes and coins a drawer is counted in. */
    public static final List<Integer> DENOMINATIONS = List.of(2000, 500, 200, 100, 50, 20, 10, 5, 2, 1);
    static final BigDecimal MAX_CASH = new BigDecimal("9999999.99");
    static final int MAX_COUNT = 100_000;
    static final ZoneId INDIA = ZoneId.of("Asia/Kolkata");
    private static final BigDecimal ZERO = BigDecimal.ZERO.setScale(2);
    private static final DateTimeFormatter HH_MM = DateTimeFormatter.ofPattern("HH:mm");
    private static final ObjectMapper JSON = new ObjectMapper().findAndRegisterModules()
            .configure(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS, false);

    private final PosAccess access;
    private final PosSessionRepository sessionRepository;
    private final PosRegisterRepository registerRepository;
    private final PosCashMovementRepository movementRepository;
    private final PosReadRepository readRepository;
    private final StockLocationRepository locationRepository;
    private final CommerceStaffLocationRepository staffLocationRepository;
    private final PosSettingsService settings;
    private final CommerceApprovalService approvalService;
    private final CommerceAuditService auditService;
    private final CommerceRequestGuard requestGuard;
    private final PosUserNames userNames;
    private final TransactionTemplate readOnly;

    @PersistenceContext
    private EntityManager entityManager;

    public PosSessionService(PosAccess access, PosSessionRepository sessionRepository,
                             PosRegisterRepository registerRepository, PosCashMovementRepository movementRepository,
                             PosReadRepository readRepository, StockLocationRepository locationRepository,
                             CommerceStaffLocationRepository staffLocationRepository, PosSettingsService settings,
                             CommerceApprovalService approvalService, CommerceAuditService auditService,
                             CommerceRequestGuard requestGuard, PosUserNames userNames,
                             PlatformTransactionManager transactionManager) {
        this.access = access;
        this.sessionRepository = sessionRepository;
        this.registerRepository = registerRepository;
        this.movementRepository = movementRepository;
        this.readRepository = readRepository;
        this.locationRepository = locationRepository;
        this.staffLocationRepository = staffLocationRepository;
        this.settings = settings;
        this.approvalService = approvalService;
        this.auditService = auditService;
        this.requestGuard = requestGuard;
        this.userNames = userNames;
        this.readOnly = new TransactionTemplate(transactionManager);
        this.readOnly.setReadOnly(true);
    }

    /** The answer of a write, and whether it answers an earlier request with the same key. */
    public record Saved(PosDtos.SessionView session, boolean replayed) {
    }

    // ================================================================== open

    /** Thrown inside the open transaction when the register or the cashier already has one open. */
    private static final class AlreadyOpen extends RuntimeException {
        AlreadyOpen() {
            super(null, null, false, false);
        }
    }

    /** {@code POST /pos/sessions}: TILL at the register's location. */
    public Saved open(CustomUserDetails user, String instituteId, PosDtos.SessionOpenRequest request) {
        if (request == null) {
            throw validation("the request has no body");
        }
        String clientKey = CommerceRequestGuard.requireClientKey(request.clientRequestId());
        BigDecimal opening = cash(request.openingCash(), "opening_cash");
        String note = text(request.openingNote(), "opening_note", 500);
        PosRegister register = access.register(user, instituteId, request.registerId(), PosAccess.TILL);
        String actor = user.getUserId();
        CommerceRequestGuard.Key key = new CommerceRequestGuard.Key(instituteId, clientKey, "POS_SESSION_OPEN",
                "POS_REGISTER", register.getId(), CommerceRequestGuard.hash("POS_SESSION_OPEN", request), actor);
        CommerceRequestGuard.Outcome<String> outcome;
        try {
            outcome = requestGuard.run(key, () -> openInside(instituteId, register.getId(), actor, opening, note,
                            clientKey),
                    () -> sessionRepository.findByInstituteIdAndOpenRequestId(instituteId, clientKey)
                            .map(PosSession::getId)
                            .orElseThrow(() -> new IllegalStateException("the session of a finished request is gone")));
        } catch (AlreadyOpen | DataIntegrityViolationException e) {
            throw alreadyOpen(user, instituteId, register);
        }
        return new Saved(view(user, instituteId, outcome.value()), outcome.replayed());
    }

    private String openInside(String instituteId, String registerId, String actor, BigDecimal opening, String note,
                              String clientKey) {
        PosRegister register = registerRepository.findByInstituteIdAndId(instituteId, registerId).orElseThrow();
        if (!PosRegisterStatus.ACTIVE.name().equals(register.getStatus())) {
            throw new ConflictException(REGISTER_INACTIVE + ": this register is not in use");
        }
        StockLocation location = locationRepository.findByInstituteIdAndId(instituteId, register.getLocationId())
                .orElse(null);
        if (location == null || !location.isPosEnabled() || !"ACTIVE".equals(location.getStatus())) {
            throw new ConflictException(PosRegisterService.LOCATION_NOT_POS + ": this location has no billing counter");
        }
        if (sessionRepository.findOpenByRegister(instituteId, registerId).isPresent()
                || sessionRepository.findOpenByCashier(instituteId, actor).isPresent()) {
            throw new AlreadyOpen();
        }
        PosSession previous = sessionRepository.findLastClosed(instituteId, registerId).orElse(null);
        BigDecimal previousCounted = previous == null ? null : previousCounted(previous);
        if (previousCounted != null && previousCounted.compareTo(opening) != 0 && note == null) {
            throw new InvalidRequestException(OPENING_NOTE_REQUIRED + ": the cash differs from the last close ("
                    + previousCounted.toPlainString() + "); say why");
        }
        PosSession session = new PosSession();
        session.setInstituteId(instituteId);
        session.setRegisterId(registerId);
        session.setLocationId(register.getLocationId());
        session.setCashierUserId(actor);
        session.setStatus(PosSessionStatus.OPEN.name());
        session.setOpenedAt(new Date());
        session.setOpeningCash(opening);
        session.setOpeningNote(note);
        session.setPreviousSessionId(previous == null ? null : previous.getId());
        session.setPreviousCountedCash(previousCounted);
        session.setOpenRequestId(clientKey);
        session = sessionRepository.saveAndFlush(session);
        Map<String, Object> detail = new LinkedHashMap<>();
        detail.put("register_id", registerId);
        detail.put("opening_cash", opening.toPlainString());
        detail.put("previous_counted_cash", previousCounted == null ? null : previousCounted.toPlainString());
        auditService.record(instituteId, actor, register.getLocationId(), "POS_SESSION_OPENED", "POS_SESSION",
                session.getId(), null, CommerceInputRules.json(detail), note);
        return session.getId();
    }

    /** What the last close left in the drawer: the count, less the cash handed over at close. */
    static BigDecimal previousCounted(PosSession previous) {
        if (previous.getCountedCash() == null) {
            return null;
        }
        BigDecimal handover = previous.getHandoverAmount() == null ? ZERO : previous.getHandoverAmount();
        return previous.getCountedCash().subtract(handover).setScale(2, RoundingMode.HALF_UP);
    }

    /** 409 SESSION_ALREADY_OPEN naming the holder (read after the failed transaction). */
    private ConflictException alreadyOpen(CustomUserDetails user, String instituteId, PosRegister register) {
        PosSession onRegister = readOnly.execute(status -> sessionRepository.findOpenByRegister(instituteId,
                register.getId()).orElse(null));
        if (onRegister != null) {
            String name = PosAccess.isOwner(user, onRegister) ? "you"
                    : userNames.names(List.of(onRegister.getCashierUserId())).getOrDefault(onRegister.getCashierUserId(),
                    "another cashier");
            return new ConflictException(SESSION_ALREADY_OPEN + ": " + register.getCode() + " is open by " + name
                    + " since " + hhmm(onRegister.getOpenedAt()));
        }
        PosSession mine = readOnly.execute(status -> sessionRepository.findOpenByCashier(instituteId,
                user.getUserId()).orElse(null));
        String other = mine == null ? null : readOnly.execute(status -> registerRepository
                .findByInstituteIdAndId(instituteId, mine.getRegisterId()).map(PosRegister::getCode).orElse(null));
        return new ConflictException(SESSION_ALREADY_OPEN + ": you already have counter "
                + (other == null ? "another register" : other) + " open");
    }

    static String hhmm(Date at) {
        return at == null ? "" : HH_MM.format(at.toInstant().atZone(INDIA));
    }

    // ================================================================== reads

    /** {@code GET /pos/registers/{id}/session}: the register's OPEN session, or null. */
    public PosDtos.CurrentSessionAnswer current(CustomUserDetails user, String instituteId, String registerId) {
        PosRegister register = access.register(user, instituteId, registerId, PosAccess.TILL);
        PosSession open = readOnly.execute(status -> sessionRepository.findOpenByRegister(instituteId,
                register.getId()).orElse(null));
        return new PosDtos.CurrentSessionAnswer(open == null ? null : view(user, instituteId, open.getId()));
    }

    /** {@code GET /pos/sessions/{id}}: the session guard (own session, or a manager at its location). */
    public PosDtos.SessionView detail(CustomUserDetails user, String instituteId, String sessionId) {
        PosSession session = access.session(user, instituteId, sessionId);
        return view(user, instituteId, session.getId());
    }

    /** {@code GET /pos/sessions}: a cashier sees their own; a manager the sessions of their locations. */
    public PosDtos.SessionsPage list(CustomUserDetails user, String instituteId, String registerId, String locationId,
                                     String status, String from, String to, Integer page, Integer pageSize) {
        access.require(user, instituteId, PosAccess.TILL);
        int p = page == null ? 0 : Math.max(page, 0);
        int size = pageSize == null ? 50 : Math.min(Math.max(pageSize, 1), 100);
        PosSessionStatus wanted = null;
        if (CommerceInputRules.trimToNull(status) != null) {
            wanted = PosSessionStatus.of(status);
            if (wanted == null) {
                throw validation("status is OPEN or CLOSED");
            }
        }
        LocalDateTime openedFrom = indiaDayStart(from, "from", 0);
        LocalDateTime openedBefore = indiaDayStart(to, "to", 1);
        String cashier = PosAccess.isManager(user) ? null : user.getUserId();
        boolean admin = PosAccess.isAdmin(user);
        PosSessionStatus filterStatus = wanted;
        PosReadRepository.SessionPage found = readOnly.execute(tx -> {
            Set<String> mine = null;
            if (!admin) {
                mine = new LinkedHashSet<>();
                for (CommerceStaffLocation row : staffLocationRepository.findByInstituteIdAndUserId(instituteId,
                        user.getUserId())) {
                    mine.add(row.getLocationId());
                }
            }
            return readRepository.sessions(instituteId, new PosReadRepository.SessionFilter(
                    CommerceInputRules.trimToNull(registerId), CommerceInputRules.trimToNull(locationId), mine,
                    filterStatus == null ? null : filterStatus.name(), cashier, openedFrom, openedBefore), p, size);
        });
        return new PosDtos.SessionsPage(found.rows(), p, size, found.total());
    }

    /** The UTC start of an India date (plus {@code plusDays}), for a timestamp column written in UTC. */
    static LocalDateTime indiaDayStart(String raw, String field, int plusDays) {
        String value = CommerceInputRules.trimToNull(raw);
        if (value == null) {
            return null;
        }
        try {
            return LocalDate.parse(value).plusDays(plusDays).atStartOfDay(INDIA).withZoneSameInstant(ZoneOffset.UTC)
                    .toLocalDateTime();
        } catch (DateTimeParseException e) {
            throw validation(field + " is a date like 2026-11-18");
        }
    }

    /** {@code GET /pos/sessions/{id}/sales}: the session's bills, newest first. */
    public PosDtos.SalesPage sales(CustomUserDetails user, String instituteId, String sessionId, Integer page,
                                   Integer pageSize) {
        PosSession session = access.session(user, instituteId, sessionId);
        int p = page == null ? 0 : Math.max(page, 0);
        int size = pageSize == null ? 50 : Math.min(Math.max(pageSize, 1), 100);
        PosReadRepository.SalePage found = readOnly.execute(tx -> readRepository.sessionSales(instituteId,
                session.getId(), p, size));
        return new PosDtos.SalesPage(found.rows(), p, size, found.total());
    }

    // ================================================================== cash in and out

    /** {@code POST /pos/sessions/{id}/cash-movements}: a store manager at the location, or an ADMIN. */
    public Saved cashMovement(CustomUserDetails user, String instituteId, String sessionId,
                              PosDtos.CashMovementRequest request) {
        if (request == null) {
            throw validation("the request has no body");
        }
        String clientKey = CommerceRequestGuard.requireClientKey(request.clientRequestId());
        CashMovementType type = CashMovementType.of(request.type());
        if (type == null) {
            throw validation("type is CASH_IN or CASH_OUT");
        }
        BigDecimal amount = cash(request.amount(), "amount");
        if (amount.signum() <= 0) {
            throw validation("amount is more than 0");
        }
        String reason = text(request.reason(), "reason", 200);
        if (reason == null) {
            throw validation("reason is required");
        }
        PosSession seen = access.readSession(instituteId, sessionId);
        access.requireAt(user, instituteId, PosAccess.MANAGER, seen.getLocationId());
        String actor = user.getUserId();
        CommerceRequestGuard.Key key = new CommerceRequestGuard.Key(instituteId, clientKey, "POS_CASH_MOVEMENT",
                "POS_SESSION", seen.getId(), CommerceRequestGuard.hash("POS_CASH_MOVEMENT", request, seen.getId()),
                actor);
        CommerceRequestGuard.Outcome<String> outcome = requestGuard.run(key, () -> {
            PosSession session = lockForUpdate(instituteId, seen.getId());
            requireOpen(session);
            PosCashMovement movement = new PosCashMovement();
            movement.setInstituteId(instituteId);
            movement.setSessionId(session.getId());
            movement.setType(type.name());
            movement.setAmount(amount);
            movement.setReason(reason);
            movement.setActorUserId(actor);
            movement.setReferenceType(CashMovementReference.NONE.name());
            movement.setReviewStatus("NONE");
            movement.setClientRequestId(clientKey);
            movement = movementRepository.saveAndFlush(movement);
            Map<String, Object> detail = new LinkedHashMap<>();
            detail.put("type", type.name());
            detail.put("amount", amount.toPlainString());
            auditService.record(instituteId, actor, session.getLocationId(), "POS_CASH_MOVED", "POS_SESSION",
                    session.getId(), null, CommerceInputRules.json(detail), reason);
            return session.getId();
        }, seen::getId);
        return new Saved(view(user, instituteId, outcome.value()), outcome.replayed());
    }

    // ================================================================== close

    /** The count of a close as validated: the counted total and the denominations (or null). */
    record Count(BigDecimal counted, Map<String, Integer> denominations) {
    }

    /**
     * The counted cash: the sum of the denominations when given (keys from {@link #DENOMINATIONS},
     * counts 0 to 100000), else {@code counted_cash}. Both given and different: 400 COUNT_MISMATCH;
     * neither: 400 VALIDATION.
     */
    static Count count(BigDecimal countedCash, Map<String, Integer> denominations) {
        BigDecimal typed = countedCash == null ? null : cash(countedCash, "counted_cash");
        if (denominations == null || denominations.isEmpty()) {
            if (typed == null) {
                throw validation("counted_cash or denominations is required");
            }
            return new Count(typed, null);
        }
        Map<String, Integer> clean = new TreeMap<String, Integer>(Comparator.comparingInt((String k) -> Integer.parseInt(k)).reversed());
        BigDecimal sum = ZERO;
        for (Map.Entry<String, Integer> entry : denominations.entrySet()) {
            String keyText = entry.getKey() == null ? "" : entry.getKey().trim();
            int note;
            try {
                note = Integer.parseInt(keyText);
            } catch (NumberFormatException e) {
                throw validation("denominations has keys " + DENOMINATIONS);
            }
            if (!DENOMINATIONS.contains(note)) {
                throw validation("denominations has keys " + DENOMINATIONS);
            }
            Integer pieces = entry.getValue();
            if (pieces == null || pieces < 0 || pieces > MAX_COUNT) {
                throw validation("a denomination count is 0 to " + MAX_COUNT);
            }
            clean.put(String.valueOf(note), pieces);
            sum = sum.add(BigDecimal.valueOf((long) note * pieces));
        }
        sum = sum.setScale(2, RoundingMode.UNNECESSARY);
        if (sum.compareTo(MAX_CASH) > 0) {
            throw validation("the counted cash is at most " + MAX_CASH.toPlainString());
        }
        if (typed != null && typed.compareTo(sum) != 0) {
            throw new InvalidRequestException(COUNT_MISMATCH + ": counted_cash (" + typed.toPlainString()
                    + ") is not the sum of the denominations (" + sum.toPlainString() + ")");
        }
        return new Count(sum, new LinkedHashMap<>(clean));
    }

    /** Whether a close's difference needs a manager's PIN: a cashier above the variance limit. */
    static boolean varianceNeedsApproval(boolean manager, BigDecimal variance, BigDecimal limit) {
        return !manager && variance.abs().compareTo(limit == null ? ZERO : limit) > 0;
    }

    /** {@code POST /pos/sessions/{id}/close}: the session guard. */
    public Saved close(CustomUserDetails user, String instituteId, String sessionId,
                       PosDtos.SessionCloseRequest request) {
        if (request == null) {
            throw validation("the request has no body");
        }
        String clientKey = CommerceRequestGuard.requireClientKey(request.clientRequestId());
        PosSession seen = access.session(user, instituteId, sessionId);
        Count count = count(request.countedCash(), request.denominations());
        String note = text(request.note(), "note", 500);
        boolean manager = PosAccess.isManager(user);
        BigDecimal limit = settings.limits(instituteId).cashVarianceLimit();
        PosDtos.Approval approval = request.approval();

        // 1. Before the transaction, from the live figures: the note and the PIN rule.
        if (seen.isOpen()) {
            BigDecimal expected = readOnly.execute(tx -> expectedCash(seen, readFacts(instituteId, seen.getId())));
            BigDecimal variance = count.counted().subtract(expected);
            if (variance.signum() != 0 && note == null) {
                throw new InvalidRequestException(VARIANCE_NOTE_REQUIRED + ": the counted cash differs from the "
                        + "expected " + expected.toPlainString() + "; say why");
            }
            if (varianceNeedsApproval(manager, variance, limit) && approval == null) {
                throw approvalRequired(PosApprovalAction.POS_VARIANCE, "the difference " + variance.toPlainString()
                        + " is above the cashier's limit");
            }
        }
        String actor = user.getUserId();
        PosDtos.SessionCloseRequest hashed = new PosDtos.SessionCloseRequest(request.clientRequestId(),
                request.countedCash(), request.denominations(), request.note(), null);
        CommerceRequestGuard.Key key = new CommerceRequestGuard.Key(instituteId, clientKey, "POS_SESSION_CLOSE",
                "POS_SESSION", seen.getId(), CommerceRequestGuard.hash("POS_SESSION_CLOSE", hashed, seen.getId()),
                actor);
        CommerceRequestGuard.Outcome<String> outcome = requestGuard.run(key,
                () -> closeInside(instituteId, seen.getId(), actor, manager, limit, count, note, approval, clientKey),
                seen::getId);
        return new Saved(view(user, instituteId, outcome.value()), outcome.replayed());
    }

    private String closeInside(String instituteId, String sessionId, String actor, boolean manager,
                               BigDecimal limit, Count count, String note, PosDtos.Approval approval,
                               String clientKey) {
        // The PIN first: its role check is a remote call, made before the session lock is taken.
        PosSession before = sessionRepository.findByInstituteIdAndId(instituteId, sessionId).orElseThrow();
        boolean approved = false;
        if (approval != null && !manager) {
            BigDecimal estimate = count.counted().subtract(expectedCash(before, readFacts(instituteId, sessionId)));
            if (varianceNeedsApproval(false, estimate, limit)) {
                approvalService.approve(instituteId, before.getLocationId(), actor, approval.approverUserId(),
                        approval.pin(), PosApprovalAction.POS_VARIANCE.name(), "POS_SESSION", sessionId,
                        estimate.abs(), clip(approval.reason(), 500));
                approved = true;
            }
        }
        PosSession session = lockForUpdate(instituteId, sessionId);
        requireOpen(session);
        Facts facts = readFacts(instituteId, sessionId);
        BigDecimal expected = expectedCash(session, facts);
        BigDecimal variance = count.counted().subtract(expected);
        if (variance.signum() != 0 && note == null) {
            throw new InvalidRequestException(VARIANCE_NOTE_REQUIRED + ": the counted cash differs from the expected "
                    + expected.toPlainString() + "; say why");
        }
        if (varianceNeedsApproval(manager, variance, limit) && !approved) {
            throw approvalRequired(PosApprovalAction.POS_VARIANCE, "the difference " + variance.toPlainString()
                    + " is above the cashier's limit");
        }
        Date closedAt = new Date();
        PosRegister register = registerRepository.findByInstituteIdAndId(instituteId, session.getRegisterId())
                .orElseThrow();
        String locationName = locationRepository.findByInstituteIdAndId(instituteId, session.getLocationId())
                .map(StockLocation::getName).orElse(null);
        PosDtos.ZReport z = zReport(session, register, locationName, facts, closedAt, count.counted(), variance,
                count.denominations());
        session.setStatus(PosSessionStatus.CLOSED.name());
        session.setClosedAt(closedAt);
        session.setClosedBy(actor);
        session.setCloseRequestId(clientKey);
        session.setExpectedCash(expected);
        session.setCountedCash(count.counted());
        session.setVariance(variance);
        session.setCountedDenominationsJson(count.denominations() == null ? null : json(count.denominations()));
        session.setCloseNote(note);
        session.setZReportJson(json(z));
        sessionRepository.saveAndFlush(session);
        Map<String, Object> detail = new LinkedHashMap<>();
        detail.put("expected_cash", expected.toPlainString());
        detail.put("counted_cash", count.counted().toPlainString());
        detail.put("variance", variance.toPlainString());
        auditService.record(instituteId, actor, session.getLocationId(), "POS_SESSION_CLOSED", "POS_SESSION",
                session.getId(), null, CommerceInputRules.json(detail), note);
        log.info("POS session {} of register {} closed: expected {}, counted {}, variance {}", session.getId(),
                register.getCode(), expected, count.counted(), variance);
        return session.getId();
    }

    // ================================================================== facts, expected cash, Z-report

    /** What a session's money is made of, read by {@code pos_session_id}. */
    record Facts(List<PosReadRepository.OrderFact> orders, List<PosReadRepository.InvoiceFact> invoices,
                 List<PosReadRepository.TenderFact> tenders, List<PosReadRepository.RefundFact> refunds,
                 List<PosReadRepository.MovementFact> movements, List<PosDtos.TaxRow> taxByRate,
                 PosDtos.ReturnsTotal returns) {
    }

    /** Inside a transaction. */
    Facts readFacts(String instituteId, String sessionId) {
        List<PosReadRepository.OrderFact> orders = readRepository.sessionOrders(instituteId, sessionId);
        List<PosReadRepository.InvoiceFact> invoices = readRepository.invoicesOf(instituteId,
                orders.stream().map(PosReadRepository.OrderFact::id).toList());
        Set<String> liveOrders = new LinkedHashSet<>();
        for (PosReadRepository.OrderFact order : orders) {
            if (!"CANCELLED".equals(order.status())) {
                liveOrders.add(order.id());
            }
        }
        List<String> liveInvoiceIds = invoices.stream()
                .filter(i -> !i.cancelled() && liveOrders.contains(i.orderId()))
                .map(PosReadRepository.InvoiceFact::id).toList();
        return new Facts(orders, invoices, readRepository.sessionTenders(instituteId, sessionId),
                readRepository.sessionRefunds(instituteId, sessionId),
                readRepository.sessionMovements(instituteId, sessionId),
                readRepository.taxByRate(instituteId, liveInvoiceIds),
                readRepository.sessionReturns(instituteId, sessionId));
    }

    /**
     * Expected cash in the drawer: opening + CASH tenders RECEIVED + cash in − cash out − CASH
     * refunds PROCESSED. VOID and PENDING tenders and refunds of other methods do not count.
     */
    static BigDecimal expectedCash(PosSession session, Facts facts) {
        return expectedCash(session.getOpeningCash(), facts.tenders(), facts.movements(), facts.refunds());
    }

    static BigDecimal expectedCash(BigDecimal opening, List<PosReadRepository.TenderFact> tenders,
                                   List<PosReadRepository.MovementFact> movements,
                                   List<PosReadRepository.RefundFact> refunds) {
        BigDecimal expected = opening == null ? ZERO : opening;
        for (PosReadRepository.TenderFact tender : tenders) {
            if (TenderMode.CASH.name().equals(tender.mode()) && "RECEIVED".equals(tender.status())) {
                expected = expected.add(tender.amount());
            }
        }
        for (PosReadRepository.MovementFact movement : movements) {
            expected = CashMovementType.CASH_IN.name().equals(movement.type()) ? expected.add(movement.amount())
                    : expected.subtract(movement.amount());
        }
        for (PosReadRepository.RefundFact refund : refunds) {
            if ("CASH".equals(refund.method()) && "PROCESSED".equals(refund.status())) {
                expected = expected.subtract(refund.amount());
            }
        }
        return expected.setScale(2, RoundingMode.HALF_UP);
    }

    /**
     * The day report from the facts. {@code bills}: POS orders keyed at the till and not
     * cancelled; {@code voided}: cancelled ones; {@code bill_book}: paper bills keyed in (not in
     * {@code bills}). First and last invoice number: SYSTEM numbers of live documents only.
     */
    static PosDtos.ZReport zReport(PosSession session, PosRegister register, String locationName, Facts facts,
                                   Date closedAt, BigDecimal counted, BigDecimal variance,
                                   Map<String, Integer> denominations) {
        Set<String> paperOrders = new LinkedHashSet<>();
        for (PosReadRepository.InvoiceFact invoice : facts.invoices()) {
            if (invoice.externalNumber() != null) {
                paperOrders.add(invoice.orderId());
            }
        }
        int bills = 0;
        BigDecimal billsTotal = ZERO;
        int voided = 0;
        BigDecimal voidedTotal = ZERO;
        int book = 0;
        BigDecimal bookTotal = ZERO;
        BigDecimal discounts = ZERO;
        for (PosReadRepository.OrderFact order : facts.orders()) {
            if ("CANCELLED".equals(order.status())) {
                voided++;
                voidedTotal = voidedTotal.add(order.total());
                continue;
            }
            discounts = discounts.add(order.discount());
            if (paperOrders.contains(order.id())) {
                book++;
                bookTotal = bookTotal.add(order.total());
            } else {
                bills++;
                billsTotal = billsTotal.add(order.total());
            }
        }
        Map<String, BigDecimal> modeAmount = new TreeMap<>();
        Map<String, Integer> modeCount = new TreeMap<>();
        for (PosReadRepository.TenderFact tender : facts.tenders()) {
            if ("RECEIVED".equals(tender.status())) {
                modeAmount.merge(tender.mode(), tender.amount(), BigDecimal::add);
                modeCount.merge(tender.mode(), 1, Integer::sum);
            }
        }
        List<PosDtos.ModeTotal> byMode = new ArrayList<>();
        modeAmount.forEach((mode, amount) -> byMode.add(new PosDtos.ModeTotal(mode, modeCount.get(mode), amount)));
        Map<String, BigDecimal> refundAmount = new TreeMap<>();
        Map<String, Integer> refundCount = new TreeMap<>();
        for (PosReadRepository.RefundFact refund : facts.refunds()) {
            refundAmount.merge(refund.method(), refund.amount(), BigDecimal::add);
            refundCount.merge(refund.method(), 1, Integer::sum);
        }
        List<PosDtos.MethodTotal> refunds = new ArrayList<>();
        refundAmount.forEach((method, amount) -> refunds.add(new PosDtos.MethodTotal(method, refundCount.get(method),
                amount)));
        BigDecimal cashIn = ZERO;
        BigDecimal cashOut = ZERO;
        for (PosReadRepository.MovementFact movement : facts.movements()) {
            if (CashMovementType.CASH_IN.name().equals(movement.type())) {
                cashIn = cashIn.add(movement.amount());
            } else {
                cashOut = cashOut.add(movement.amount());
            }
        }
        String first = null;
        String last = null;
        for (PosReadRepository.InvoiceFact invoice : facts.invoices()) {
            if (invoice.externalNumber() == null && invoice.number() != null) {
                if (first == null) {
                    first = invoice.number();
                }
                last = invoice.number();
            }
        }
        return new PosDtos.ZReport(session.getId(), new PosDtos.NamedRef(register.getCode(), register.getName()),
                new PosDtos.NamedRef(null, locationName), session.getCashierUserId(), session.getOpenedAt(), closedAt,
                session.getOpeningCash(), new PosDtos.CountTotal(bills, billsTotal),
                new PosDtos.CountTotal(voided, voidedTotal), discounts, byMode, facts.taxByRate(), refunds,
                facts.returns(), cashIn, cashOut, expectedCash(session, facts), counted, variance, denominations,
                new PosDtos.CountTotal(book, bookTotal), first, last);
    }

    // ================================================================== view

    /** The session as the screen shows it, read now; the cashier's name from the account service. */
    public PosDtos.SessionView view(CustomUserDetails user, String instituteId, String sessionId) {
        record Read(PosSession session, PosRegister register, String locationName, List<PosCashMovement> movements,
                    PosDtos.ZReport summary) {
        }
        Read read = readOnly.execute(tx -> {
            PosSession session = sessionRepository.findByInstituteIdAndId(instituteId, sessionId).orElseThrow();
            if (entityManager != null) {
                entityManager.refresh(session);
            }
            PosRegister register = registerRepository.findByInstituteIdAndId(instituteId, session.getRegisterId())
                    .orElseThrow();
            String locationName = locationRepository.findByInstituteIdAndId(instituteId, session.getLocationId())
                    .map(StockLocation::getName).orElse(null);
            List<PosCashMovement> movements = movementRepository
                    .findByInstituteIdAndSessionIdOrderByCreatedAtAscIdAsc(instituteId, session.getId());
            PosDtos.ZReport summary = session.isOpen()
                    ? zReport(session, register, locationName, readFacts(instituteId, session.getId()), null, null,
                    null, null)
                    : null;
            return new Read(session, register, locationName, movements, summary);
        });
        PosSession s = read.session();
        String cashierName = userNames.names(List.of(s.getCashierUserId())).getOrDefault(s.getCashierUserId(), "");
        boolean mine = PosAccess.isOwner(user, s);
        boolean manager = PosAccess.isManager(user);
        List<String> next = new ArrayList<>();
        if (s.isOpen()) {
            if (mine) {
                next.add(ACTION_SELL);
            }
            if (manager) {
                next.add(ACTION_CASH_MOVEMENT);
            }
            if (mine || manager) {
                next.add(ACTION_CLOSE);
                next.add(ACTION_BILL_BOOK);
            }
        }
        List<PosDtos.CashMovementView> movements = new ArrayList<>();
        for (PosCashMovement m : read.movements()) {
            movements.add(new PosDtos.CashMovementView(m.getId(), m.getType(), m.getAmount(), m.getReason(),
                    m.getActorUserId(), m.getCreatedAt() == null ? null
                    : java.sql.Timestamp.valueOf(m.getCreatedAt())));
        }
        return new PosDtos.SessionView(s.getId(), s.getStatus(),
                new PosDtos.Ref(read.register().getId(), read.register().getCode(), read.register().getName()),
                new PosDtos.Ref(s.getLocationId(), null, read.locationName()), s.getCashierUserId(), cashierName, mine,
                s.getOpenedAt(), s.getOpeningCash(), s.getOpeningNote(), s.getPreviousCountedCash(), s.getClosedAt(),
                s.getClosedBy(), s.getExpectedCash(), s.getCountedCash(), s.getVariance(), s.getCloseNote(),
                readJson(s.getCountedDenominationsJson(), new TypeReference<Map<String, Integer>>() {
                }), movements, read.summary(),
                readJson(s.getZReportJson(), new TypeReference<PosDtos.ZReport>() {
                }), next);
    }

    // ================================================================== shared steps

    /** The session row FOR UPDATE, read again. 404 when it is not of this institute. */
    PosSession lockForUpdate(String instituteId, String sessionId) {
        PosSession session = sessionRepository.lockForUpdate(instituteId, sessionId)
                .orElseThrow(() -> new IllegalStateException("session disappeared"));
        if (entityManager != null) {
            entityManager.refresh(session);
        }
        return session;
    }

    /** 409 SESSION_NOT_OPEN unless the session is OPEN. */
    public static void requireOpen(PosSession session) {
        if (!session.isOpen()) {
            throw new ConflictException(SESSION_NOT_OPEN + ": this counter is closed");
        }
    }

    /** 409 APPROVAL_REQUIRED: the screen opens the PIN dialog and sends the same body with {@code approval}. */
    public static ConflictException approvalRequired(PosApprovalAction action, String why) {
        return new ConflictException(APPROVAL_REQUIRED + ": " + action.name() + " " + why);
    }

    /** An amount of cash: 0 to 9,999,999.99 with at most two decimals. */
    static BigDecimal cash(BigDecimal value, String field) {
        if (value == null || value.signum() < 0 || value.compareTo(MAX_CASH) > 0
                || value.stripTrailingZeros().scale() > 2) {
            throw validation(field + " is an amount from 0 to 9999999.99 with at most two decimals");
        }
        return value.setScale(2, RoundingMode.UNNECESSARY);
    }

    static String text(String raw, String field, int max) {
        if (raw == null || raw.isBlank()) {
            return null;
        }
        String value = raw.trim();
        if (value.length() > max) {
            throw validation(field + " is at most " + max + " characters");
        }
        return value;
    }

    private static String clip(String value, int max) {
        if (value == null || value.isBlank()) {
            return null;
        }
        String v = value.trim();
        return v.length() <= max ? v : v.substring(0, max);
    }

    static InvalidRequestException validation(String message) {
        return new InvalidRequestException("VALIDATION: " + message);
    }

    static String json(Object value) {
        try {
            return JSON.writeValueAsString(value);
        } catch (Exception e) {
            throw new IllegalStateException("counter JSON could not be written", e);
        }
    }

    private static <T> T readJson(String json, TypeReference<T> type) {
        if (json == null || json.isBlank()) {
            return null;
        }
        try {
            return JSON.readValue(json, type);
        } catch (Exception e) {
            log.warn("POS: a stored session JSON could not be read: {}", e.getMessage());
            return null;
        }
    }
}
