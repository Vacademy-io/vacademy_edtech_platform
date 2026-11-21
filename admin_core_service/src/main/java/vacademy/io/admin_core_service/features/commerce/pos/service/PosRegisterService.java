package vacademy.io.admin_core_service.features.commerce.pos.service;

import lombok.extern.slf4j.Slf4j;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import vacademy.io.admin_core_service.features.commerce.audit.CommerceAuditService;
import vacademy.io.admin_core_service.features.commerce.common.request.CommerceRequestGuard;
import vacademy.io.admin_core_service.features.commerce.document.dto.DocumentSeriesDTO;
import vacademy.io.admin_core_service.features.commerce.document.entity.CommerceDocumentSeries;
import vacademy.io.admin_core_service.features.commerce.document.enums.DocumentChannel;
import vacademy.io.admin_core_service.features.commerce.document.enums.DocumentType;
import vacademy.io.admin_core_service.features.commerce.document.enums.SeriesKind;
import vacademy.io.admin_core_service.features.commerce.document.enums.SeriesStatus;
import vacademy.io.admin_core_service.features.commerce.document.repository.CommerceDocumentSeriesRepository;
import vacademy.io.admin_core_service.features.commerce.document.service.CommerceDocumentSeriesService;
import vacademy.io.admin_core_service.features.commerce.document.service.CommerceSellerLookup;
import vacademy.io.admin_core_service.features.commerce.document.service.DocumentClock;
import vacademy.io.admin_core_service.features.commerce.document.service.FinancialYear;
import vacademy.io.admin_core_service.features.commerce.document.service.SeriesPicker;
import vacademy.io.admin_core_service.features.commerce.pos.dto.PosDtos;
import vacademy.io.admin_core_service.features.commerce.pos.entity.PosRegister;
import vacademy.io.admin_core_service.features.commerce.pos.entity.PosSession;
import vacademy.io.admin_core_service.features.commerce.pos.enums.PosRegisterStatus;
import vacademy.io.admin_core_service.features.commerce.pos.repository.PosRegisterRepository;
import vacademy.io.admin_core_service.features.commerce.pos.repository.PosSessionRepository;
import vacademy.io.admin_core_service.features.commerce.security.entity.CommerceStaffLocation;
import vacademy.io.admin_core_service.features.commerce.security.repository.CommerceStaffLocationRepository;
import vacademy.io.admin_core_service.features.commerce.stock.entity.StockLocation;
import vacademy.io.admin_core_service.features.commerce.stock.repository.StockLocationRepository;
import vacademy.io.admin_core_service.features.commerce.tax.enums.TaxMode;
import vacademy.io.admin_core_service.features.commerce.tax.service.CommerceInputRules;
import vacademy.io.admin_core_service.features.commerce.tax.service.CommerceTaxContext;
import vacademy.io.admin_core_service.features.commerce.tax.service.CommerceTaxSettingService;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.ConflictException;
import vacademy.io.common.exceptions.InvalidRequestException;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * Registers (tills) of a location: list, create (with the register's own SYSTEM invoice series
 * when a prefix is given) and update (name, status). No delete: a register with sessions is
 * history. Writes are guarded by {@link CommerceRequestGuard}.
 */
@Slf4j
@Service
public class PosRegisterService {

    public static final String REGISTER_CODE_TAKEN = "REGISTER_CODE_TAKEN";
    public static final String REGISTER_HAS_OPEN_SESSION = "REGISTER_HAS_OPEN_SESSION";
    public static final String LOCATION_NOT_POS = "LOCATION_NOT_POS";
    public static final String SERIES_PREFIX_IN_USE = "SERIES_PREFIX_IN_USE";
    public static final String WARNING_NO_REGISTER_SERIES = "NO_REGISTER_SERIES";
    public static final String WARNING_NO_CREDIT_NOTE_SERIES = "NO_CREDIT_NOTE_SERIES";

    static final Pattern CODE = Pattern.compile("^[A-Z0-9-]{1,16}$");
    /** The series rule of {@link CommerceDocumentSeriesService}: 1 to 6 characters, a letter or digit first. */
    static final Pattern PREFIX = Pattern.compile("^[A-Z0-9][A-Z0-9/-]{0,5}$");

    private final PosAccess access;
    private final PosRegisterRepository registerRepository;
    private final PosSessionRepository sessionRepository;
    private final StockLocationRepository locationRepository;
    private final CommerceStaffLocationRepository staffLocationRepository;
    private final CommerceDocumentSeriesService seriesService;
    private final CommerceDocumentSeriesRepository seriesRepository;
    private final CommerceTaxSettingService taxSettingService;
    private final CommerceSellerLookup sellerLookup;
    private final DocumentClock clock;
    private final CommerceAuditService auditService;
    private final CommerceRequestGuard requestGuard;
    private final PosUserNames userNames;
    private final TransactionTemplate readOnly;

    public PosRegisterService(PosAccess access, PosRegisterRepository registerRepository,
                              PosSessionRepository sessionRepository, StockLocationRepository locationRepository,
                              CommerceStaffLocationRepository staffLocationRepository,
                              CommerceDocumentSeriesService seriesService,
                              CommerceDocumentSeriesRepository seriesRepository,
                              CommerceTaxSettingService taxSettingService, CommerceSellerLookup sellerLookup,
                              DocumentClock clock, CommerceAuditService auditService,
                              CommerceRequestGuard requestGuard, PosUserNames userNames,
                              PlatformTransactionManager transactionManager) {
        this.access = access;
        this.registerRepository = registerRepository;
        this.sessionRepository = sessionRepository;
        this.locationRepository = locationRepository;
        this.staffLocationRepository = staffLocationRepository;
        this.seriesService = seriesService;
        this.seriesRepository = seriesRepository;
        this.taxSettingService = taxSettingService;
        this.sellerLookup = sellerLookup;
        this.clock = clock;
        this.auditService = auditService;
        this.requestGuard = requestGuard;
        this.userNames = userNames;
        this.readOnly = new TransactionTemplate(transactionManager);
        this.readOnly.setReadOnly(true);
    }

    /** The answer of a write, and whether it answers an earlier request with the same key. */
    public record Saved(PosDtos.RegisterView register, boolean replayed) {
    }

    // ================================================================== list

    /** {@code GET /pos/registers}: the registers at the caller's locations (an ADMIN sees all). */
    public PosDtos.RegistersAnswer list(CustomUserDetails user, String instituteId, String locationId) {
        access.require(user, instituteId, PosAccess.TILL);
        String location = CommerceInputRules.trimToNull(locationId);
        if (location != null) {
            access.requireAt(user, instituteId, PosAccess.TILL, location);
        }
        boolean admin = PosAccess.isAdmin(user);
        List<PosRegister> registers = readOnly.execute(status -> {
            if (location != null) {
                return registerRepository.findByInstituteIdAndLocationIdIn(instituteId, List.of(location));
            }
            if (admin) {
                return registerRepository.findByInstituteId(instituteId);
            }
            Set<String> mine = new LinkedHashSet<>();
            for (CommerceStaffLocation row : staffLocationRepository.findByInstituteIdAndUserId(instituteId,
                    user.getUserId())) {
                mine.add(row.getLocationId());
            }
            return mine.isEmpty() ? List.<PosRegister>of()
                    : registerRepository.findByInstituteIdAndLocationIdIn(instituteId, mine);
        });
        return new PosDtos.RegistersAnswer(views(user, instituteId, registers));
    }

    /** The view of one register. */
    public PosDtos.RegisterView view(CustomUserDetails user, String instituteId, PosRegister register) {
        return views(user, instituteId, List.of(register)).get(0);
    }

    /** Views sorted by location name then code; the open sessions' cashier names in one remote call. */
    List<PosDtos.RegisterView> views(CustomUserDetails user, String instituteId, List<PosRegister> registers) {
        if (registers == null || registers.isEmpty()) {
            return List.of();
        }
        record Facts(Map<String, StockLocation> locations, Map<String, PosSession> open,
                     Map<String, List<String>> warnings) {
        }
        Facts facts = readOnly.execute(status -> {
            Map<String, StockLocation> locations = new HashMap<>();
            for (PosRegister register : registers) {
                locations.computeIfAbsent(register.getLocationId(), id -> locationRepository
                        .findByInstituteIdAndId(instituteId, id).orElse(null));
            }
            Map<String, PosSession> open = new HashMap<>();
            for (PosSession session : sessionRepository.findOpenByRegisters(instituteId,
                    registers.stream().map(PosRegister::getId).toList())) {
                open.put(session.getRegisterId(), session);
            }
            Map<String, List<String>> warnings = new HashMap<>();
            SeriesFacts series = seriesFacts(instituteId);
            for (PosRegister register : registers) {
                warnings.put(register.getId(), warnings(register, locations.get(register.getLocationId()), series));
            }
            return new Facts(locations, open, warnings);
        });
        Map<String, String> names = userNames.names(facts.open().values().stream()
                .map(PosSession::getCashierUserId).toList());
        List<PosDtos.RegisterView> out = new ArrayList<>();
        for (PosRegister register : registers) {
            StockLocation location = facts.locations().get(register.getLocationId());
            PosSession open = facts.open().get(register.getId());
            PosDtos.OpenSessionRef openRef = open == null ? null : new PosDtos.OpenSessionRef(open.getId(),
                    open.getCashierUserId(), names.getOrDefault(open.getCashierUserId(), ""), open.getOpenedAt(),
                    PosAccess.isOwner(user, open));
            out.add(new PosDtos.RegisterView(register.getId(), register.getCode(), register.getName(),
                    register.getLocationId(), location == null ? null : location.getName(), register.getStatus(),
                    openRef, facts.warnings().get(register.getId())));
        }
        out.sort(Comparator.comparing((PosDtos.RegisterView v) -> v.locationName() == null ? "" : v.locationName(),
                String.CASE_INSENSITIVE_ORDER).thenComparing(PosDtos.RegisterView::code));
        return out;
    }

    /** The series facts the setup warnings need: this year's ACTIVE series of the two types. */
    private record SeriesFacts(DocumentType saleType, String financialYear, List<CommerceDocumentSeries> sales,
                               List<CommerceDocumentSeries> creditNotes, CommerceTaxContext tax) {
    }

    private SeriesFacts seriesFacts(String instituteId) {
        CommerceTaxContext tax = taxSettingService.context(instituteId);
        DocumentType saleType = saleDocumentType(tax.getMode());
        String year = FinancialYear.of(clock.today(instituteId), tax.getFyStartMonth());
        return new SeriesFacts(saleType, year,
                seriesRepository.findByInstituteIdAndDocumentTypeAndFinancialYearAndStatus(instituteId,
                        saleType.name(), year, SeriesStatus.ACTIVE.name()),
                seriesRepository.findByInstituteIdAndDocumentTypeAndFinancialYearAndStatus(instituteId,
                        DocumentType.CREDIT_NOTE.name(), year, SeriesStatus.ACTIVE.name()),
                tax);
    }

    private List<String> warnings(PosRegister register, StockLocation location, SeriesFacts series) {
        List<String> out = new ArrayList<>();
        boolean own = series.sales().stream().anyMatch(s -> SeriesKind.SYSTEM.name().equals(s.getKind())
                && register.getId().equals(s.getRegisterId()));
        if (!own) {
            out.add(WARNING_NO_REGISTER_SERIES);
        }
        String sellerGstin = null;
        try {
            sellerGstin = sellerLookup.resolve(register.getInstituteId(), register.getLocationId(), series.tax())
                    .getGstin();
        } catch (RuntimeException e) {
            // A location the seller lookup refuses cannot issue documents either; the series
            // test below then looks for any series of the location.
        }
        if (SeriesPicker.pick(series.creditNotes(), sellerGstin, register.getLocationId(), register.getId(),
                DocumentChannel.POS.name()).isEmpty()) {
            out.add(WARNING_NO_CREDIT_NOTE_SERIES);
        }
        if (location == null || !location.isPosEnabled() || !"ACTIVE".equals(location.getStatus())) {
            out.add(LOCATION_NOT_POS);
        }
        return out;
    }

    /** The sale document of a tax mode: tax invoice, bill of supply or plain invoice. */
    static DocumentType saleDocumentType(TaxMode mode) {
        if (mode == null) {
            return DocumentType.INVOICE;
        }
        return switch (mode) {
            case REGULAR -> DocumentType.TAX_INVOICE;
            case COMPOSITION -> DocumentType.BILL_OF_SUPPLY;
            case UNREGISTERED -> DocumentType.INVOICE;
        };
    }

    // ================================================================== create

    /** The create request as validated. */
    record CleanCreate(String clientRequestId, String locationId, String code, String name, String prefix,
                       Long nextValue) {
    }

    static CleanCreate validate(PosDtos.RegisterCreateRequest request) {
        if (request == null) {
            throw validation("the request has no body");
        }
        String key = CommerceRequestGuard.requireClientKey(request.clientRequestId());
        String locationId = CommerceInputRules.trimToNull(request.locationId());
        if (locationId == null || locationId.length() > 36) {
            throw validation("location_id is required");
        }
        String code = CommerceInputRules.trimToNull(request.code());
        code = code == null ? null : code.toUpperCase(Locale.ROOT);
        if (code == null || !CODE.matcher(code).matches()) {
            throw validation("code is 1 to 16 letters, digits or hyphens");
        }
        String name = name(request.name());
        String prefix = CommerceInputRules.trimToNull(request.invoicePrefix());
        Long next = request.invoiceNextValue();
        if (prefix != null) {
            prefix = prefix.toUpperCase(Locale.ROOT);
            if (!PREFIX.matcher(prefix).matches()) {
                throw validation("invoice_prefix is 1 to 6 letters, digits, slashes or hyphens, starting with a "
                        + "letter or digit");
            }
            if (next != null && next < 1) {
                throw validation("invoice_next_value starts at 1");
            }
        } else if (next != null) {
            throw validation("invoice_next_value is given with an invoice_prefix");
        }
        return new CleanCreate(key, locationId, code, name, prefix, next);
    }

    private static String name(String raw) {
        String name = CommerceInputRules.trimToNull(raw);
        if (name == null || name.length() > 60) {
            throw validation("name is 1 to 60 characters");
        }
        return name;
    }

    /** {@code POST /pos/registers}: a store manager at the location, or an ADMIN. */
    public Saved create(CustomUserDetails user, String instituteId, PosDtos.RegisterCreateRequest request) {
        CleanCreate clean = validate(request);
        access.requireAt(user, instituteId, PosAccess.MANAGER, clean.locationId());
        String actor = user.getUserId();
        CommerceRequestGuard.Key key = new CommerceRequestGuard.Key(instituteId, clean.clientRequestId(),
                "POS_REGISTER_CREATE", "STOCK_LOCATION", clean.locationId(),
                CommerceRequestGuard.hash("POS_REGISTER_CREATE", request), actor);
        CommerceRequestGuard.Outcome<PosRegister> outcome;
        try {
            outcome = requestGuard.run(key, () -> createInside(instituteId, clean, actor),
                    () -> registerRepository.findByInstituteId(instituteId).stream()
                            .filter(r -> clean.code().equals(r.getCode())).findFirst()
                            .orElseThrow(() -> new IllegalStateException("the register of a finished request is gone")));
        } catch (DataIntegrityViolationException e) {
            throw new ConflictException(REGISTER_CODE_TAKEN + ": another register already has the code "
                    + clean.code());
        }
        return new Saved(view(user, instituteId, outcome.value()), outcome.replayed());
    }

    private PosRegister createInside(String instituteId, CleanCreate clean, String actor) {
        StockLocation location = locationRepository.findByInstituteIdAndId(instituteId, clean.locationId())
                .orElseThrow(() -> validation("location_id is not a location of this institute"));
        if (!location.isPosEnabled() || !"ACTIVE".equals(location.getStatus())) {
            throw new ConflictException(LOCATION_NOT_POS + ": this location has no billing counter");
        }
        if (registerRepository.existsByInstituteIdAndCode(instituteId, clean.code())) {
            throw new ConflictException(REGISTER_CODE_TAKEN + ": another register already has the code "
                    + clean.code());
        }
        PosRegister register = new PosRegister();
        register.setInstituteId(instituteId);
        register.setLocationId(location.getId());
        register.setCode(clean.code());
        register.setName(clean.name());
        register.setStatus(PosRegisterStatus.ACTIVE.name());
        register.setCreatedBy(actor);
        register = registerRepository.saveAndFlush(register);

        DocumentSeriesDTO series = null;
        if (clean.prefix() != null) {
            CommerceTaxContext tax = taxSettingService.context(instituteId);
            String year = FinancialYear.of(clock.today(instituteId), tax.getFyStartMonth());
            if (seriesRepository.findByInstituteIdAndPrefixAndFinancialYear(instituteId, clean.prefix(), year)
                    .isPresent()) {
                throw new ConflictException(SERIES_PREFIX_IN_USE + ": a series with the prefix " + clean.prefix()
                        + " already exists for " + year + "; choose another prefix");
            }
            series = seriesService.create(instituteId, actor, DocumentSeriesDTO.builder()
                    .documentType(saleDocumentType(tax.getMode()).name())
                    .kind(SeriesKind.SYSTEM.name())
                    .channel(DocumentChannel.POS.name())
                    .prefix(clean.prefix())
                    .financialYear(year)
                    .locationId(location.getId())
                    .registerId(register.getId())
                    .nextValue(clean.nextValue() == null ? 1L : clean.nextValue())
                    .build());
        }
        Map<String, Object> detail = auditView(register);
        if (series != null) {
            detail.put("series_id", series.getId());
            detail.put("series_prefix", series.getPrefix());
        }
        auditService.record(instituteId, actor, location.getId(), "POS_REGISTER_SAVED", "POS_REGISTER",
                register.getId(), null, CommerceInputRules.json(detail), null);
        log.info("POS register {} ({}) created at location {} of institute {}", register.getCode(), register.getId(),
                location.getId(), instituteId);
        return register;
    }

    // ================================================================== update

    /** {@code PUT /pos/registers/{id}}: name and status; a store manager at its location, or an ADMIN. */
    public Saved update(CustomUserDetails user, String instituteId, String registerId,
                        PosDtos.RegisterUpdateRequest request) {
        if (request == null) {
            throw validation("the request has no body");
        }
        String clientKey = CommerceRequestGuard.requireClientKey(request.clientRequestId());
        String name = request.name() == null ? null : name(request.name());
        PosRegisterStatus status = null;
        if (request.status() != null) {
            status = PosRegisterStatus.of(request.status());
            if (status == null) {
                throw validation("status is ACTIVE or INACTIVE");
            }
        }
        PosRegister seen = access.register(user, instituteId, registerId, PosAccess.MANAGER);
        String actor = user.getUserId();
        PosRegisterStatus wanted = status;
        CommerceRequestGuard.Key key = new CommerceRequestGuard.Key(instituteId, clientKey, "POS_REGISTER_UPDATE",
                "POS_REGISTER", seen.getId(), CommerceRequestGuard.hash("POS_REGISTER_UPDATE", request, seen.getId()),
                actor);
        CommerceRequestGuard.Outcome<PosRegister> outcome = requestGuard.run(key, () -> {
            PosRegister register = registerRepository.findByInstituteIdAndId(instituteId, seen.getId())
                    .orElseThrow(() -> new IllegalStateException("register disappeared"));
            Map<String, Object> before = auditView(register);
            if (wanted == PosRegisterStatus.INACTIVE
                    && sessionRepository.findOpenByRegister(instituteId, register.getId()).isPresent()) {
                throw new ConflictException(REGISTER_HAS_OPEN_SESSION + ": close the open session of this register "
                        + "first");
            }
            if (name != null) {
                register.setName(name);
            }
            if (wanted != null) {
                register.setStatus(wanted.name());
            }
            register = registerRepository.saveAndFlush(register);
            auditService.record(instituteId, actor, register.getLocationId(), "POS_REGISTER_SAVED", "POS_REGISTER",
                    register.getId(), CommerceInputRules.json(before), CommerceInputRules.json(auditView(register)),
                    null);
            return register;
        }, () -> registerRepository.findByInstituteIdAndId(instituteId, seen.getId()).orElseThrow());
        return new Saved(view(user, instituteId, outcome.value()), outcome.replayed());
    }

    private static Map<String, Object> auditView(PosRegister register) {
        Map<String, Object> view = new LinkedHashMap<>();
        view.put("code", register.getCode());
        view.put("name", register.getName());
        view.put("location_id", register.getLocationId());
        view.put("status", register.getStatus());
        return view;
    }

    static InvalidRequestException validation(String message) {
        return new InvalidRequestException("VALIDATION: " + message);
    }
}
