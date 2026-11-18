package vacademy.io.admin_core_service.features.commerce.pos.service;

import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import vacademy.io.admin_core_service.features.auth_service.service.AuthService;
import vacademy.io.admin_core_service.features.commerce.customer.CommercePhones;
import vacademy.io.admin_core_service.features.commerce.customer.entity.CommerceCustomer;
import vacademy.io.admin_core_service.features.commerce.customer.service.CommerceCustomerService;
import vacademy.io.admin_core_service.features.commerce.pos.dto.PosDtos;
import vacademy.io.admin_core_service.features.commerce.pos.entity.PosRegister;
import vacademy.io.admin_core_service.features.commerce.pos.entity.PosSession;
import vacademy.io.admin_core_service.features.commerce.pos.repository.PosReadRepository;
import vacademy.io.admin_core_service.features.commerce.security.CommerceRole;
import vacademy.io.admin_core_service.features.commerce.stock.service.StockQueryService;
import vacademy.io.admin_core_service.features.commerce.storefront.service.StorefrontSnapshotLoader;
import vacademy.io.admin_core_service.features.commerce.storefront.service.StorefrontSnapshotLoader.CartVariant;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.InvalidRequestException;
import vacademy.io.common.exceptions.VacademyException;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.Date;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * The reads a cashier needs at the till: the catalogue of the register's location (the price
 * the sale charges, never a cost), a scan of a label, the name of a known phone, and the
 * managers who can approve. Read-only transactions; the remote calls run outside them.
 */
@Slf4j
@Service
public class PosCatalogueService {

    public static final int MAX_CATALOGUE = 5000;
    public static final int MAX_SEARCH = 50;
    public static final String CODE_NOT_FOUND = "CODE_NOT_FOUND";

    private final PosAccess access;
    private final PosReadRepository readRepository;
    private final StorefrontSnapshotLoader variantLoader;
    private final StockQueryService stockQueryService;
    private final CommerceCustomerService customerService;
    private final AuthService authService;
    private final PosUserNames userNames;
    private final TransactionTemplate readOnly;

    public PosCatalogueService(PosAccess access, PosReadRepository readRepository,
                               StorefrontSnapshotLoader variantLoader, StockQueryService stockQueryService,
                               CommerceCustomerService customerService, AuthService authService,
                               PosUserNames userNames, PlatformTransactionManager transactionManager) {
        this.access = access;
        this.readRepository = readRepository;
        this.variantLoader = variantLoader;
        this.stockQueryService = stockQueryService;
        this.customerService = customerService;
        this.authService = authService;
        this.userNames = userNames;
        this.readOnly = new TransactionTemplate(transactionManager);
        this.readOnly.setReadOnly(true);
    }

    // ================================================================== catalogue

    /**
     * {@code GET /pos/registers/{id}/catalogue[?q=]}: every ACTIVE variant (at most 5000, then
     * {@code truncated}), or with {@code q} at most 50 found by name or SKU prefix.
     */
    public PosDtos.CatalogueAnswer catalogue(CustomUserDetails user, String instituteId, String registerId, String q) {
        PosRegister register = access.register(user, instituteId, registerId, PosAccess.TILL);
        String text = q == null ? null : q.trim();
        if (text != null && (text.length() < 2 || text.length() > 64)) {
            throw new InvalidRequestException("VALIDATION: q is 2 to 64 characters");
        }
        List<PosReadRepository.VariantCodes> codes = readOnly.execute(status -> text == null
                ? readRepository.activeVariants(instituteId, MAX_CATALOGUE + 1)
                : readRepository.searchVariants(instituteId, text, MAX_SEARCH));
        boolean truncated = text == null && codes.size() > MAX_CATALOGUE;
        if (truncated) {
            codes = codes.subList(0, MAX_CATALOGUE);
        }
        List<PosDtos.CatalogueItem> items = items(instituteId, register.getLocationId(), codes);
        return new PosDtos.CatalogueAnswer(register.getId(), register.getLocationId(), new Date(), truncated, items);
    }

    /** Items in the order of {@code codes}; a variant the cart cannot price as ACTIVE is left out. */
    List<PosDtos.CatalogueItem> items(String instituteId, String locationId, List<PosReadRepository.VariantCodes> codes) {
        if (codes.isEmpty()) {
            return List.of();
        }
        Set<String> ids = new LinkedHashSet<>();
        codes.forEach(c -> ids.add(c.packageSessionId()));
        Map<String, CartVariant> variants = variantLoader.cartVariants(instituteId, ids, Set.of());
        Map<String, Integer> onHand = readOnly.execute(status -> readRepository.onHandAt(instituteId, locationId));
        List<PosDtos.CatalogueItem> out = new ArrayList<>();
        for (PosReadRepository.VariantCodes code : codes) {
            CartVariant variant = variants.get(code.packageSessionId());
            if (variant == null || !variant.productActive() || !variant.variantActive()) {
                continue;
            }
            out.add(item(variant, code, onHand));
        }
        return out;
    }

    static PosDtos.CatalogueItem item(CartVariant variant, PosReadRepository.VariantCodes code,
                                      Map<String, Integer> onHand) {
        return new PosDtos.CatalogueItem(variant.packageSessionId(), code.productId(), variant.sku(),
                code.labelCode(), code.barcode(), variant.names() == null ? Map.of() : variant.names(),
                variantLabels(variant), variant.unit(), Math.max(1, variant.qtyScale()),
                Math.max(1, variant.qtyStep()), variant.piece() ? "PIECE" : "QUANTITY", variant.tracked(),
                variant.price(), variant.mrp(), variant.currency() == null ? "INR" : variant.currency(),
                variant.tracked() ? onHand.getOrDefault(variant.packageSessionId(), 0) : null);
    }

    /** "Red / M" per language, from the option values in option order; else the stored variant name. */
    static Map<String, String> variantLabels(CartVariant variant) {
        Map<String, String> out = new LinkedHashMap<>();
        List<StorefrontSnapshotLoader.OptionLabel> options = variant.options() == null ? List.of() : variant.options();
        if (!options.isEmpty()) {
            Set<String> locales = new LinkedHashSet<>();
            for (StorefrontSnapshotLoader.OptionLabel option : options) {
                if (option.labelI18n() != null) {
                    locales.addAll(option.labelI18n().keySet());
                }
            }
            if (locales.isEmpty()) {
                locales.add("en");
            }
            for (String locale : locales) {
                List<String> parts = new ArrayList<>();
                for (StorefrontSnapshotLoader.OptionLabel option : options) {
                    String label = option.labelI18n() == null ? null : option.labelI18n().get(locale);
                    if (label == null) {
                        label = option.code();
                    }
                    if (label != null) {
                        parts.add(label);
                    }
                }
                if (!parts.isEmpty()) {
                    out.put(locale, String.join(" / ", parts));
                }
            }
            return out;
        }
        String legacy = variant.legacyName();
        if (legacy != null && !legacy.equals(variant.sku())) {
            out.put("en", legacy);
        }
        return out;
    }

    // ================================================================== scan

    /** {@code GET /pos/registers/{id}/scan/{code}}: a piece, a label code or a barcode. */
    public PosDtos.ScanAnswer scan(CustomUserDetails user, String instituteId, String registerId, String code) {
        PosRegister register = access.register(user, instituteId, registerId, PosAccess.TILL);
        Map<String, Object> found;
        try {
            found = stockQueryService.scan(instituteId, code, true, false);
        } catch (VacademyException e) {
            if (e.getStatus() == HttpStatus.NOT_FOUND) {
                throw codeNotFound();
            }
            throw e;
        } catch (InvalidRequestException e) {
            throw new InvalidRequestException("VALIDATION: a code of at most 100 characters is required");
        }
        String kind = String.valueOf(found.get("kind"));
        Object variantView = found.get("variant");
        String packageSessionId = variantView instanceof Map<?, ?> map ? String.valueOf(map.get("package_session_id"))
                : null;
        if (packageSessionId == null) {
            throw codeNotFound();
        }
        List<PosReadRepository.VariantCodes> codes = readOnly.execute(status ->
                readRepository.variantCodes(instituteId, List.of(packageSessionId)));
        List<PosDtos.CatalogueItem> items = items(instituteId, register.getLocationId(), codes);
        if (items.isEmpty()) {
            // A DRAFT or ARCHIVED product cannot be sold: the same answer as an unknown code.
            throw codeNotFound();
        }
        PosDtos.ScanPiece piece = null;
        if ("PIECE".equals(kind) && found.get("piece") instanceof Map<?, ?> p) {
            String status = p.get("status") == null ? null : String.valueOf(p.get("status"));
            String location = p.get("location_id") == null ? null : String.valueOf(p.get("location_id"));
            piece = new PosDtos.ScanPiece(String.valueOf(p.get("id")), String.valueOf(p.get("code")), status,
                    "IN_STOCK".equals(status) && register.getLocationId().equals(location));
        }
        return new PosDtos.ScanAnswer("PIECE".equals(kind) ? "PIECE" : "VARIANT", items.get(0), piece);
    }

    private static VacademyException codeNotFound() {
        return new VacademyException(HttpStatus.NOT_FOUND, CODE_NOT_FOUND + ": no item has this code");
    }

    // ================================================================== customer lookup

    /** {@code GET /pos/customers/lookup}: the name the shop knows for a phone, nothing else. */
    public PosDtos.CustomerLookupAnswer lookupCustomer(CustomUserDetails user, String instituteId, String sessionId,
                                                       String phone) {
        access.session(user, instituteId, sessionId);
        String normalised = CommercePhones.normalise(phone);
        if (normalised == null) {
            throw new InvalidRequestException("VALIDATION: phone is not a valid phone number");
        }
        CommerceCustomer customer = readOnly.execute(status -> customerService.findByPhone(instituteId, normalised)
                .orElse(null));
        return customer == null ? new PosDtos.CustomerLookupAnswer(false, null)
                : new PosDtos.CustomerLookupAnswer(true, customer.getName());
    }

    // ================================================================== approvers

    /**
     * {@code GET /pos/registers/{id}/approvers}: staff with a PIN who are ADMIN, or store manager
     * assigned to the register's location; by name. A failure of the account service answers an
     * empty list.
     */
    public PosDtos.ApproversAnswer approvers(CustomUserDetails user, String instituteId, String registerId) {
        PosRegister register = access.register(user, instituteId, registerId, PosAccess.TILL);
        record Candidates(List<String> withPin, Set<String> atLocation) {
        }
        Candidates candidates = readOnly.execute(status -> new Candidates(readRepository.pinHolders(instituteId),
                readRepository.staffAt(instituteId, register.getLocationId())));
        if (candidates.withPin().isEmpty()) {
            return new PosDtos.ApproversAnswer(List.of());
        }
        Map<String, List<String>> roles;
        try {
            roles = authService.getInstituteRoles(instituteId, candidates.withPin());
        } catch (RuntimeException e) {
            log.warn("POS: the approvers' roles could not be read ({})", e.getClass().getSimpleName());
            return new PosDtos.ApproversAnswer(List.of());
        }
        if (roles == null) {
            return new PosDtos.ApproversAnswer(List.of());
        }
        List<String> approvers = new ArrayList<>();
        for (String userId : candidates.withPin()) {
            List<String> held = roles.get(userId);
            if (held == null) {
                continue;
            }
            boolean admin = held.stream().anyMatch("ADMIN"::equalsIgnoreCase);
            boolean manager = held.stream().anyMatch(CommerceRole.STORE_MANAGER.authority()::equalsIgnoreCase);
            if (admin || (manager && candidates.atLocation().contains(userId))) {
                approvers.add(userId);
            }
        }
        Map<String, String> names = userNames.names(approvers);
        List<PosDtos.Approver> out = new ArrayList<>();
        for (String userId : approvers) {
            out.add(new PosDtos.Approver(userId, names.getOrDefault(userId, "")));
        }
        out.sort(Comparator.comparing(PosDtos.Approver::fullName, String.CASE_INSENSITIVE_ORDER));
        return new PosDtos.ApproversAnswer(out);
    }

    /** The session a lookup names, for callers that already hold it. */
    PosSession session(CustomUserDetails user, String instituteId, String sessionId) {
        return access.session(user, instituteId, sessionId);
    }
}
