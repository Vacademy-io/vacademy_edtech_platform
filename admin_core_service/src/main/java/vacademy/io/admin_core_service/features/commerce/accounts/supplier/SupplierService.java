package vacademy.io.admin_core_service.features.commerce.accounts.supplier;

import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.persistence.OptimisticLockException;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;
import org.springframework.http.HttpStatus;
import org.springframework.orm.ObjectOptimisticLockingFailureException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;
import vacademy.io.admin_core_service.features.commerce.accounts.AccountsAuditKinds;
import vacademy.io.admin_core_service.features.commerce.accounts.crypto.CommerceFieldCipher;
import vacademy.io.admin_core_service.features.commerce.accounts.entity.CommerceAccountHead;
import vacademy.io.admin_core_service.features.commerce.accounts.entity.CommerceSupplier;
import vacademy.io.admin_core_service.features.commerce.accounts.enums.HeadNature;
import vacademy.io.admin_core_service.features.commerce.accounts.enums.HeadStatus;
import vacademy.io.admin_core_service.features.commerce.accounts.enums.SupplierStatus;
import vacademy.io.admin_core_service.features.commerce.accounts.repository.CommerceAccountHeadRepository;
import vacademy.io.admin_core_service.features.commerce.accounts.repository.CommerceSupplierLedgerRepository;
import vacademy.io.admin_core_service.features.commerce.accounts.repository.CommerceSupplierRepository;
import vacademy.io.admin_core_service.features.commerce.accounts.repository.CommerceSupplierSecretRepository;
import vacademy.io.admin_core_service.features.commerce.accounts.supplier.SupplierDtos.LookupRow;
import vacademy.io.admin_core_service.features.commerce.accounts.supplier.SupplierDtos.StatusRequest;
import vacademy.io.admin_core_service.features.commerce.accounts.supplier.SupplierDtos.SupplierRequest;
import vacademy.io.admin_core_service.features.commerce.accounts.supplier.SupplierDtos.SupplierRow;
import vacademy.io.admin_core_service.features.commerce.accounts.supplier.SupplierDtos.SupplierView;
import vacademy.io.admin_core_service.features.commerce.accounts.supplier.SupplierDtos.Warning;
import vacademy.io.admin_core_service.features.commerce.accounts.supplier.SupplierRules.Draft;
import vacademy.io.admin_core_service.features.commerce.accounts.supplier.SupplierRules.PanAction;
import vacademy.io.admin_core_service.features.commerce.audit.CommerceAuditService;
import vacademy.io.admin_core_service.features.commerce.common.request.CommerceRequestGuard;
import vacademy.io.admin_core_service.features.commerce.customer.repository.CommerceCustomerRepository;
import vacademy.io.admin_core_service.features.commerce.stock.service.CommerceCounterService;
import vacademy.io.admin_core_service.features.commerce.tax.service.CommerceInputRules;
import vacademy.io.common.exceptions.ConflictException;
import vacademy.io.common.exceptions.InvalidRequestException;
import vacademy.io.common.exceptions.VacademyException;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

/**
 * Suppliers of an institute: list, picker, detail, create, edit and status. Callers pass an
 * institute id the access guard has passed. Lists and the detail never load the encrypted PAN and
 * never call the cipher; the detail shows the last four characters only.
 */
@Service
public class SupplierService {

    public static final String COUNTER_SCOPE = "S";
    public static final String FIELD_PAN = "pan";
    public static final String HASH_PURPOSE_PAN = "pan";
    public static final String GSTIN_USED_BY = "GSTIN_USED_BY";
    static final List<String> STANDARD_GROUPS = List.of("SUPPLIER", "SERVICE_PROVIDER", "OTHER");
    private static final String ACTION_CREATE = "SUPPLIER_CREATE";
    private static final String STATUS_ALL = "ALL";
    private static final int MAX_QUERY = 100;
    private static final int LOOKUP_ROWS = 20;
    private static final int MAX_GSTIN_WARNINGS = 5;
    private static final String MASK = "******";
    private static final ObjectMapper MAPPER = new ObjectMapper();

    private final CommerceSupplierRepository supplierRepository;
    private final CommerceSupplierSecretRepository secretRepository;
    private final CommerceSupplierLedgerRepository ledgerRepository;
    private final CommerceAccountHeadRepository headRepository;
    private final CommerceCustomerRepository customerRepository;
    private final CommerceCounterService counters;
    private final CommerceAuditService auditService;
    private final CommerceFieldCipher cipher;
    private final TransactionTemplate transaction;

    public SupplierService(CommerceSupplierRepository supplierRepository,
                           CommerceSupplierSecretRepository secretRepository,
                           CommerceSupplierLedgerRepository ledgerRepository,
                           CommerceAccountHeadRepository headRepository,
                           CommerceCustomerRepository customerRepository,
                           CommerceCounterService counters,
                           CommerceAuditService auditService,
                           CommerceFieldCipher cipher,
                           PlatformTransactionManager transactionManager) {
        this.supplierRepository = supplierRepository;
        this.secretRepository = secretRepository;
        this.ledgerRepository = ledgerRepository;
        this.headRepository = headRepository;
        this.customerRepository = customerRepository;
        this.counters = counters;
        this.auditService = auditService;
        this.cipher = cipher;
        this.transaction = new TransactionTemplate(transactionManager);
    }

    // ── Reads ───────────────────────────────────────────────────────────────

    /** The list with each supplier's balance. Reads no PAN data of any kind. */
    @Transactional(readOnly = true)
    public Page<SupplierRow> list(String instituteId, String q, String group, String status, boolean hasDue,
                                  int page, int size) {
        Pageable pageable = CommerceInputRules.page(page, size, Sort.unsorted());
        String statusFilter = statusFilter(status);
        String groupFilter = SupplierRules.trim(group);
        if (groupFilter != null) {
            groupFilter = groupFilter.toUpperCase(Locale.ROOT);
            if (!SupplierRules.GROUP.matcher(groupFilter).matches()) {
                throw SupplierRules.validation("group must be 1 to 32 capital letters, digits or underscores");
            }
        }
        String query = SupplierRules.trim(q);
        if (query != null && query.length() > MAX_QUERY) {
            throw SupplierRules.validation("q must be at most " + MAX_QUERY + " characters");
        }
        String like = query == null ? null : SupplierRules.likePattern(query);
        Page<CommerceSupplier> found = supplierRepository.search(instituteId, statusFilter, groupFilter, like, query,
                hasDue, pageable);
        Map<String, BigDecimal> balances = balances(instituteId,
                found.getContent().stream().map(CommerceSupplier::getId).toList());
        return found.map(s -> row(s, balances.get(s.getId())));
    }

    /** ACTIVE suppliers whose name, code, phone or GSTIN matches, at most 20, by name. Any commerce role. */
    @Transactional(readOnly = true)
    public List<LookupRow> lookup(String instituteId, String q) {
        String query = SupplierRules.trim(q);
        if (query == null || query.length() > MAX_QUERY) {
            throw SupplierRules.validation("q must be 1 to " + MAX_QUERY + " characters");
        }
        return supplierRepository.lookup(instituteId, SupplierRules.likePattern(query), PageRequest.of(0, LOOKUP_ROWS))
                .stream().map(s -> new LookupRow(s.getId(), s.getName(), s.getGroupCode())).toList();
    }

    /** The standard groups and every group in use. */
    @Transactional(readOnly = true)
    public List<String> groups(String instituteId) {
        Set<String> out = new LinkedHashSet<>(STANDARD_GROUPS);
        out.addAll(supplierRepository.distinctGroupCodes(instituteId));
        return new ArrayList<>(out);
    }

    @Transactional(readOnly = true)
    public SupplierView get(String instituteId, String supplierId) {
        return view(instituteId, require(instituteId, supplierId), null);
    }

    // ── Create ──────────────────────────────────────────────────────────────

    /**
     * Creates a supplier. A repeat with the same {@code client_request_id} and body answers the first
     * supplier; another body under that key is 409. A PAN is refused with 503 before anything is
     * written while no encryption key is configured.
     */
    public SupplierView create(String instituteId, String actorUserId, SupplierRequest request) {
        Draft draft = SupplierRules.check(request);
        String clientRequestId = CommerceRequestGuard.requireClientKey(request.getClientRequestId());
        requireCipherFor(draft);
        String hash = CommerceRequestGuard.hash(ACTION_CREATE, hashBody(request, draft), instituteId);
        Optional<CommerceSupplier> earlier =
                supplierRepository.findByInstituteIdAndClientRequestId(instituteId, clientRequestId);
        if (earlier.isPresent()) {
            return sameRequestOrRefuse(instituteId, earlier.get(), hash);
        }
        boolean generated = draft.code == null;
        String code = generated ? counters.nextNumber(instituteId, COUNTER_SCOPE) : draft.code;
        try {
            return insert(instituteId, actorUserId, draft, code, clientRequestId, hash);
        } catch (DataIntegrityViolationException e) {
            Optional<CommerceSupplier> winner =
                    supplierRepository.findByInstituteIdAndClientRequestId(instituteId, clientRequestId);
            if (winner.isPresent()) {
                // Two deliveries of one request: the other one won the key.
                return sameRequestOrRefuse(instituteId, winner.get(), hash);
            }
            String constraint = constraintName(e);
            if (generated && constraint.contains("uq_commerce_supplier_code")) {
                // A typed code took this number: take the next one once.
                try {
                    return insert(instituteId, actorUserId, draft, counters.nextNumber(instituteId, COUNTER_SCOPE),
                            clientRequestId, hash);
                } catch (DataIntegrityViolationException again) {
                    throw conflictFor(again);
                }
            }
            throw conflictFor(e);
        }
    }

    private SupplierView insert(String instituteId, String actorUserId, Draft draft, String code,
                                String clientRequestId, String hash) {
        return transaction.execute(status -> {
            requireReferences(instituteId, draft, null);
            CommerceSupplier supplier = new CommerceSupplier();
            supplier.setId(UUID.randomUUID().toString());
            supplier.setInstituteId(instituteId);
            apply(supplier, draft, code);
            supplier.setStatus(SupplierStatus.ACTIVE.name());
            supplier.setClientRequestId(clientRequestId);
            supplier.setRequestHash(hash);
            supplier.setCreatedBy(actorUserId);
            supplier.setUpdatedBy(actorUserId);
            supplier = supplierRepository.saveAndFlush(supplier);
            String last4 = writePan(instituteId, actorUserId, supplier.getId(), draft);
            List<Warning> warnings = warnings(instituteId, supplier, draft);
            Map<String, Object> audit = auditFields(supplier);
            audit.put("pan_masked", mask(last4));
            auditService.record(instituteId, actorUserId, null, AccountsAuditKinds.SUPPLIER_CREATE,
                    AccountsAuditKinds.REF_SUPPLIER, supplier.getId(), null, CommerceInputRules.json(audit), null);
            return view(supplier, last4, BigDecimal.ZERO, warnings);
        });
    }

    private SupplierView sameRequestOrRefuse(String instituteId, CommerceSupplier earlier, String hash) {
        if (!hash.equals(earlier.getRequestHash())) {
            throw new ConflictException(CommerceRequestGuard.IDEMPOTENCY_MISMATCH
                    + ": this client_request_id was used for a different supplier");
        }
        return transaction.execute(status -> view(instituteId, earlier, null));
    }

    // ── Edit ────────────────────────────────────────────────────────────────

    /**
     * Replaces the supplier's fields. {@code version} must be the stored one (409
     * {@code SUPPLIER_CHANGED} otherwise). A blank code keeps the stored code.
     */
    public SupplierView update(String instituteId, String actorUserId, String supplierId, SupplierRequest request) {
        Draft draft = SupplierRules.check(request);
        if (request.getVersion() == null) {
            throw SupplierRules.validation("version is required");
        }
        requireCipherFor(draft);
        try {
            return transaction.execute(status -> {
                CommerceSupplier supplier = require(instituteId, supplierId);
                if (!Objects.equals(request.getVersion(), supplier.getVersion())) {
                    throw supplierChanged();
                }
                requireReferences(instituteId, draft, supplier);
                Map<String, Object> before = auditFields(supplier);
                String oldLast4 = secretRepository.findLast4(instituteId, supplier.getId()).orElse(null);
                apply(supplier, draft, draft.code == null ? supplier.getCode() : draft.code);
                Map<String, Object> after = auditFields(supplier);
                String newLast4 = switch (draft.panAction) {
                    case UNCHANGED -> oldLast4;
                    case REMOVE -> {
                        secretRepository.deleteByInstituteIdAndSupplierId(instituteId, supplier.getId());
                        yield null;
                    }
                    case SET -> writePan(instituteId, actorUserId, supplier.getId(), draft);
                };
                Map<String, Object> oldChanged = new LinkedHashMap<>();
                Map<String, Object> newChanged = new LinkedHashMap<>();
                for (Map.Entry<String, Object> entry : after.entrySet()) {
                    Object old = before.get(entry.getKey());
                    if (!Objects.equals(old, entry.getValue())) {
                        oldChanged.put(entry.getKey(), old);
                        newChanged.put(entry.getKey(), entry.getValue());
                    }
                }
                if (!Objects.equals(oldLast4, newLast4) || draft.panAction == PanAction.SET) {
                    oldChanged.put("pan_masked", mask(oldLast4));
                    newChanged.put("pan_masked", mask(newLast4));
                }
                if (!newChanged.isEmpty()) {
                    supplier.setUpdatedBy(actorUserId);
                    supplier = supplierRepository.saveAndFlush(supplier);
                    auditService.record(instituteId, actorUserId, null, AccountsAuditKinds.SUPPLIER_EDIT,
                            AccountsAuditKinds.REF_SUPPLIER, supplier.getId(), CommerceInputRules.json(oldChanged),
                            CommerceInputRules.json(newChanged), null);
                }
                return view(supplier, newLast4, balance(instituteId, supplier.getId()),
                        warnings(instituteId, supplier, draft));
            });
        } catch (ObjectOptimisticLockingFailureException | OptimisticLockException e) {
            throw supplierChanged();
        } catch (DataIntegrityViolationException e) {
            throw conflictFor(e);
        }
    }

    /** ACTIVE or INACTIVE, with an optional reason; the same status changes nothing. */
    public SupplierView setStatus(String instituteId, String actorUserId, String supplierId, StatusRequest request) {
        if (request == null) {
            throw SupplierRules.validation("request body is required");
        }
        SupplierStatus wanted = SupplierRules.status(request.getStatus());
        String reason = SupplierRules.trim(request.getReason());
        if (reason != null && reason.length() > 500) {
            throw SupplierRules.validation("reason must be at most 500 characters");
        }
        try {
            return transaction.execute(status -> {
                CommerceSupplier supplier = require(instituteId, supplierId);
                String old = supplier.getStatus();
                if (wanted.name().equals(old)) {
                    return view(instituteId, supplier, null);
                }
                supplier.setStatus(wanted.name());
                supplier.setUpdatedBy(actorUserId);
                supplier = supplierRepository.saveAndFlush(supplier);
                auditService.record(instituteId, actorUserId, null, AccountsAuditKinds.SUPPLIER_EDIT,
                        AccountsAuditKinds.REF_SUPPLIER, supplier.getId(),
                        CommerceInputRules.json(Map.of("status", old)),
                        CommerceInputRules.json(Map.of("status", wanted.name())), reason);
                return view(instituteId, supplier, null);
            });
        } catch (ObjectOptimisticLockingFailureException | OptimisticLockException e) {
            throw supplierChanged();
        }
    }

    // ── Helpers ─────────────────────────────────────────────────────────────

    /** The supplier of this institute, or 404 NOT_FOUND. */
    CommerceSupplier require(String instituteId, String supplierId) {
        String id = SupplierRules.trim(supplierId);
        if (id == null || id.length() > 36) {
            throw notFound();
        }
        return supplierRepository.findByInstituteIdAndId(instituteId, id).orElseThrow(SupplierService::notFound);
    }

    static VacademyException notFound() {
        return new VacademyException(HttpStatus.NOT_FOUND, "NOT_FOUND: no such supplier");
    }

    private static ConflictException supplierChanged() {
        return new ConflictException("SUPPLIER_CHANGED: someone else changed this supplier; reload and try again");
    }

    /** 503 before anything is written when a PAN is to be stored and no key is configured. */
    private void requireCipherFor(Draft draft) {
        if (draft.panAction == PanAction.SET && !cipher.isConfigured()) {
            throw new VacademyException(HttpStatus.SERVICE_UNAVAILABLE, CommerceFieldCipher.ENCRYPTION_NOT_CONFIGURED
                    + ": supplier PAN cannot be saved until encryption is set up; save the supplier without it");
        }
    }

    /** Stores the PAN when the draft sets one; answers the last four characters now stored (or null). */
    private String writePan(String instituteId, String actorUserId, String supplierId, Draft draft) {
        if (draft.panAction != PanAction.SET) {
            return null;
        }
        String pan = draft.pan;
        String encrypted = cipher.encrypt(pan, CommerceFieldCipher.aad(instituteId, supplierId, FIELD_PAN));
        String last4 = pan.substring(6);
        try {
            secretRepository.upsert(UUID.randomUUID().toString(), instituteId, supplierId, encrypted,
                    cipher.activeKeyId(), cipher.keyedHash(HASH_PURPOSE_PAN, instituteId, pan), last4, actorUserId);
        } catch (DataIntegrityViolationException e) {
            // A generic answer without the cause: the driver's text would repeat the stored row.
            throw new VacademyException(HttpStatus.INTERNAL_SERVER_ERROR, "PAN_NOT_STORED: the PAN could not be saved");
        }
        return last4;
    }

    /** The default head (ACTIVE, nature EXPENSE) and the linked customer belong to this institute. */
    private void requireReferences(String instituteId, Draft draft, CommerceSupplier current) {
        if (draft.defaultHeadId != null
                && (current == null || !draft.defaultHeadId.equals(current.getDefaultHeadId()))) {
            CommerceAccountHead head = headRepository.findByInstituteIdAndId(instituteId, draft.defaultHeadId)
                    .orElseThrow(() -> new VacademyException(HttpStatus.NOT_FOUND,
                            "NOT_FOUND: default_head_id is not a head of this institute"));
            if (!HeadStatus.ACTIVE.name().equals(head.getStatus()) || !HeadNature.EXPENSE.name().equals(head.getNature())) {
                throw new InvalidRequestException("VALIDATION: default_head_id must be an active expense head");
            }
        }
        if (draft.customerId != null && (current == null || !draft.customerId.equals(current.getCustomerId()))
                && customerRepository.findByIdAndInstituteId(draft.customerId, instituteId).isEmpty()) {
            throw new VacademyException(HttpStatus.NOT_FOUND, "NOT_FOUND: customer_id is not a customer of this institute");
        }
    }

    private static void apply(CommerceSupplier s, Draft d, String code) {
        s.setCode(code);
        s.setName(d.name);
        s.setLegalName(d.legalName);
        s.setNameAlt(d.nameAlt);
        s.setGroupCode(d.groupCode);
        s.setPhone(d.phone);
        s.setEmail(d.email);
        s.setAddressLine1(d.addressLine1);
        s.setAddressLine2(d.addressLine2);
        s.setCity(d.city);
        s.setCountryCode(d.countryCode);
        s.setStateCode(d.stateCode);
        s.setPincode(d.pincode);
        s.setRegistrationType(d.registrationType.name());
        s.setGstin(d.gstin);
        s.setPaymentTermsDays(d.paymentTermsDays);
        s.setTdsApplicable(d.tdsApplicable);
        s.setDefaultTdsCode(d.defaultTdsCode);
        s.setUpiId(d.upiId);
        s.setPaymentNote(d.paymentNote);
        s.setDefaultHeadId(d.defaultHeadId);
        s.setCustomerId(d.customerId);
        s.setExternalRef(d.externalRef);
        s.setNotes(d.notes);
        s.setSearchText(SupplierRules.searchText(d.name, d.legalName, d.nameAlt, code, d.phone, d.gstin));
    }

    private List<Warning> warnings(String instituteId, CommerceSupplier supplier, Draft draft) {
        List<Warning> out = new ArrayList<>(draft.warnings);
        if (supplier.getGstin() != null) {
            supplierRepository.findByInstituteIdAndGstinAndIdNot(instituteId, supplier.getGstin(), supplier.getId())
                    .stream().limit(MAX_GSTIN_WARNINGS)
                    .forEach(other -> out.add(new Warning(GSTIN_USED_BY, other.getId(), other.getCode(),
                            other.getName())));
        }
        return out;
    }

    /** The request hash body: every field, with {@code pan_set} instead of the PAN itself. */
    @SuppressWarnings("unchecked")
    private static Map<String, Object> hashBody(SupplierRequest request, Draft draft) {
        Map<String, Object> body = MAPPER.convertValue(request, Map.class);
        body.remove("pan");
        body.remove("version");
        body.put("pan_set", draft.panAction == PanAction.SET);
        return body;
    }

    private static Map<String, Object> auditFields(CommerceSupplier s) {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("code", s.getCode());
        out.put("name", s.getName());
        out.put("legal_name", s.getLegalName());
        out.put("name_alt", s.getNameAlt());
        out.put("group_code", s.getGroupCode());
        out.put("phone", s.getPhone());
        out.put("email", s.getEmail());
        out.put("address_line1", s.getAddressLine1());
        out.put("address_line2", s.getAddressLine2());
        out.put("city", s.getCity());
        out.put("country_code", s.getCountryCode());
        out.put("state_code", s.getStateCode());
        out.put("pincode", s.getPincode());
        out.put("registration_type", s.getRegistrationType());
        out.put("gstin", s.getGstin());
        out.put("payment_terms_days", s.getPaymentTermsDays());
        out.put("tds_applicable", s.isTdsApplicable());
        out.put("default_tds_code", s.getDefaultTdsCode());
        out.put("upi_id", s.getUpiId());
        out.put("payment_note", s.getPaymentNote());
        out.put("default_head_id", s.getDefaultHeadId());
        out.put("customer_id", s.getCustomerId());
        out.put("external_ref", s.getExternalRef());
        out.put("notes", s.getNotes());
        out.put("status", s.getStatus());
        return out;
    }

    private SupplierView view(String instituteId, CommerceSupplier s, List<Warning> warnings) {
        return view(s, secretRepository.findLast4(instituteId, s.getId()).orElse(null),
                balance(instituteId, s.getId()), warnings);
    }

    static SupplierView view(CommerceSupplier s, String last4, BigDecimal balance, List<Warning> warnings) {
        SupplierView v = new SupplierView();
        v.setId(s.getId());
        v.setInstituteId(s.getInstituteId());
        v.setCode(s.getCode());
        v.setName(s.getName());
        v.setLegalName(s.getLegalName());
        v.setNameAlt(s.getNameAlt());
        v.setGroupCode(s.getGroupCode());
        v.setPhone(s.getPhone());
        v.setEmail(s.getEmail());
        v.setAddressLine1(s.getAddressLine1());
        v.setAddressLine2(s.getAddressLine2());
        v.setCity(s.getCity());
        v.setCountryCode(s.getCountryCode());
        v.setStateCode(s.getStateCode());
        v.setPincode(s.getPincode());
        v.setRegistrationType(s.getRegistrationType());
        v.setGstin(s.getGstin());
        v.setPaymentTermsDays(s.getPaymentTermsDays());
        v.setTdsApplicable(s.isTdsApplicable());
        v.setDefaultTdsCode(s.getDefaultTdsCode());
        v.setUpiId(s.getUpiId());
        v.setPaymentNote(s.getPaymentNote());
        v.setDefaultHeadId(s.getDefaultHeadId());
        v.setCustomerId(s.getCustomerId());
        v.setNotes(s.getNotes());
        v.setStatus(s.getStatus());
        v.setExternalRef(s.getExternalRef());
        v.setVersion(s.getVersion());
        v.setCreatedBy(s.getCreatedBy());
        v.setUpdatedBy(s.getUpdatedBy());
        v.setCreatedAt(s.getCreatedAt());
        v.setUpdatedAt(s.getUpdatedAt());
        v.setPanMasked(mask(last4));
        v.setHasPan(last4 != null);
        v.setBalance(money(balance));
        v.setWarnings(warnings);
        return v;
    }

    private static SupplierRow row(CommerceSupplier s, BigDecimal balance) {
        SupplierRow r = new SupplierRow();
        r.setId(s.getId());
        r.setCode(s.getCode());
        r.setName(s.getName());
        r.setNameAlt(s.getNameAlt());
        r.setGroupCode(s.getGroupCode());
        r.setPhone(s.getPhone());
        r.setGstin(s.getGstin());
        r.setStateCode(s.getStateCode());
        r.setRegistrationType(s.getRegistrationType());
        r.setStatus(s.getStatus());
        r.setBalance(money(balance));
        return r;
    }

    private Map<String, BigDecimal> balances(String instituteId, List<String> supplierIds) {
        Map<String, BigDecimal> out = new HashMap<>();
        if (supplierIds.isEmpty()) {
            return out;
        }
        for (CommerceSupplierLedgerRepository.SupplierSum sum : ledgerRepository.sumBySupplierIds(instituteId, supplierIds)) {
            out.put(sum.getSupplierId(), sum.getBalance());
        }
        return out;
    }

    private BigDecimal balance(String instituteId, String supplierId) {
        return balances(instituteId, List.of(supplierId)).get(supplierId);
    }

    static String mask(String last4) {
        return last4 == null ? null : MASK + last4;
    }

    static String money(BigDecimal amount) {
        return (amount == null ? BigDecimal.ZERO : amount).setScale(2, RoundingMode.HALF_UP).toPlainString();
    }

    private static String statusFilter(String status) {
        String value = SupplierRules.trim(status);
        if (value == null) {
            return SupplierStatus.ACTIVE.name();
        }
        if (STATUS_ALL.equalsIgnoreCase(value)) {
            return null;
        }
        return SupplierRules.status(value).name();
    }

    private static RuntimeException conflictFor(DataIntegrityViolationException e) {
        String constraint = constraintName(e);
        if (constraint.contains("uq_commerce_supplier_code")) {
            return new ConflictException("DUPLICATE_CODE: another supplier of this institute has this code");
        }
        if (constraint.contains("uq_commerce_supplier_external_ref")) {
            return new ConflictException("DUPLICATE_EXTERNAL_REF: another supplier of this institute has this "
                    + "external_ref");
        }
        return e;
    }

    /** The violated constraint's name, lower-cased, or the cause messages when the driver gives no name. */
    static String constraintName(Throwable e) {
        StringBuilder text = new StringBuilder();
        for (Throwable t = e; t != null; t = t.getCause() == t ? null : t.getCause()) {
            if (t instanceof org.hibernate.exception.ConstraintViolationException cve && cve.getConstraintName() != null) {
                return cve.getConstraintName().toLowerCase(Locale.ROOT);
            }
            if (t.getMessage() != null) {
                text.append(t.getMessage()).append('\n');
            }
        }
        return text.toString().toLowerCase(Locale.ROOT);
    }
}
