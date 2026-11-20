package vacademy.io.admin_core_service.features.commerce.accounts.head;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;
import vacademy.io.admin_core_service.features.commerce.accounts.AccountsAuditKinds;
import vacademy.io.admin_core_service.features.commerce.accounts.entity.CommerceAccountHead;
import vacademy.io.admin_core_service.features.commerce.accounts.enums.ExpenseKind;
import vacademy.io.admin_core_service.features.commerce.accounts.enums.HeadNature;
import vacademy.io.admin_core_service.features.commerce.accounts.enums.HeadStatus;
import vacademy.io.admin_core_service.features.commerce.accounts.enums.ItcEligibility;
import vacademy.io.admin_core_service.features.commerce.accounts.head.AccountHeadDtos.HeadRequest;
import vacademy.io.admin_core_service.features.commerce.accounts.head.AccountHeadDtos.HeadView;
import vacademy.io.admin_core_service.features.commerce.accounts.repository.CommerceAccountHeadRepository;
import vacademy.io.admin_core_service.features.commerce.audit.CommerceAuditService;
import vacademy.io.admin_core_service.features.commerce.common.request.CommerceRequestGuard;
import vacademy.io.common.exceptions.ConflictException;
import vacademy.io.common.exceptions.InvalidRequestException;
import vacademy.io.common.exceptions.VacademyException;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;
import java.util.regex.Pattern;

/**
 * Account heads: what a money entry was for. The starter list is seeded on the first heads call
 * of an institute; heads are then listed, created and edited. System heads keep their nature,
 * status, parent, capital flag and expense kind (later postings look them up by code). One level
 * of parent, of the same nature.
 */
@Service
public class AccountHeadService {

    public static final String REFERENCE_TYPE = "ACCOUNT_HEAD";
    static final String CREATE_ACTION = "HEAD_CREATE";
    static final Pattern CODE = Pattern.compile("^[A-Z0-9_]{1,32}$");
    static final Pattern LANGUAGE = Pattern.compile("^[a-z]{2}$");
    static final Pattern HSN = Pattern.compile("^[0-9]{4,8}$");
    static final int MAX_NAME = 100;
    static final int MAX_LANGUAGES = 5;
    static final int MAX_POSITION = 1_000_000;
    private static final ObjectMapper MAPPER = new ObjectMapper();

    private final CommerceAccountHeadRepository headRepository;
    private final CommerceAuditService auditService;
    private final CommerceRequestGuard requestGuard;
    private final List<AccountHeadUsage> usages;
    private final TransactionTemplate transaction;
    private final TransactionTemplate seedTransaction;

    public AccountHeadService(CommerceAccountHeadRepository headRepository,
                              CommerceAuditService auditService,
                              CommerceRequestGuard requestGuard,
                              PlatformTransactionManager transactionManager,
                              List<AccountHeadUsage> usages) {
        this.headRepository = headRepository;
        this.auditService = auditService;
        this.requestGuard = requestGuard;
        this.usages = usages == null ? List.of() : List.copyOf(usages);
        this.transaction = new TransactionTemplate(transactionManager);
        this.seedTransaction = new TransactionTemplate(transactionManager);
        this.seedTransaction.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
    }

    // ------------------------------------------------------------------ seed

    /** Seeds the starter list when the institute lacks any of it (no actor recorded); answers how many were inserted. */
    public int ensureSeeded(String instituteId) {
        return ensureSeeded(instituteId, null);
    }

    /**
     * Inserts the starter heads the institute does not have yet, in a transaction of its own
     * ({@code ON CONFLICT DO NOTHING}: concurrent first calls insert each code once), and writes
     * one ACCOUNT_HEADS_SEED audit row when anything was inserted. Answers how many were inserted.
     */
    public int ensureSeeded(String instituteId, String actorUserId) {
        if (headRepository.countByInstituteIdAndCodeIn(instituteId, StarterHeads.CODES) == StarterHeads.ALL.size()) {
            return 0;
        }
        Integer inserted = seedTransaction.execute(status -> {
            int n = 0;
            for (StarterHeads.Starter s : StarterHeads.ALL) {
                Map<String, String> names = new LinkedHashMap<>();
                names.put("en", s.en());
                names.put("hi", s.hi());
                n += headRepository.seedStarter(UUID.randomUUID().toString(), instituteId, s.code(), toJson(names),
                        s.nature(), s.expenseKind(), s.capital(), s.system(), s.position(), actorUserId);
            }
            if (n > 0) {
                Map<String, Object> detail = new LinkedHashMap<>();
                detail.put("inserted", n);
                auditService.record(instituteId, actorUserId, null, AccountsAuditKinds.ACCOUNT_HEADS_SEED,
                        REFERENCE_TYPE, instituteId, null, toJson(detail), null);
            }
            return n;
        });
        return inserted == null ? 0 : inserted;
    }

    // ------------------------------------------------------------------ list

    /** Heads of the institute ordered by nature, position, code; {@code nature}/{@code status} blank = any. */
    public List<HeadView> list(String instituteId, String actorUserId, String nature, String status) {
        HeadNature natureFilter = enumOrNull(HeadNature.class, nature, "nature");
        HeadStatus statusFilter = enumOrNull(HeadStatus.class, status, "status");
        ensureSeeded(instituteId, actorUserId);
        return headRepository.findForList(instituteId, natureFilter == null ? null : natureFilter.name(),
                        statusFilter == null ? null : statusFilter.name())
                .stream().map(HeadView::of).toList();
    }

    // ------------------------------------------------------------------ create

    /**
     * Creates a head once per client key (a repeat with the same body answers the head the first
     * call created; another body is 409 IDEMPOTENCY_MISMATCH).
     *
     * @throws ConflictException 409 DUPLICATE_CODE
     */
    public HeadView create(String instituteId, String actorUserId, HeadRequest request) {
        if (request == null) {
            throw invalid("the request body is required");
        }
        String clientKey = CommerceRequestGuard.requireClientKey(request.getClientRequestId());
        String code = normaliseCode(request.getCode());
        Map<String, String> names = normaliseNames(request.getNameI18n());
        HeadNature nature = requireEnum(HeadNature.class, request.getNature(), "nature");
        ExpenseKind kind = expenseKindFor(nature, request.getExpenseKind(), null);
        ItcEligibility itc = enumOrNull(ItcEligibility.class, request.getDefaultItcEligibility(),
                "default_itc_eligibility");
        String hsn = normaliseHsn(request.getDefaultHsnCode());
        int position = normalisePosition(request.getPosition(), 0);
        HeadStatus status = request.getStatus() == null ? HeadStatus.ACTIVE
                : requireEnum(HeadStatus.class, request.getStatus(), "status");
        String parentId = trimToNull(request.getParentId());
        boolean capital = Boolean.TRUE.equals(request.getIsCapital());

        ensureSeeded(instituteId, actorUserId);
        String hash = CommerceRequestGuard.hash(CREATE_ACTION, request, instituteId);
        CommerceRequestGuard.Key key = new CommerceRequestGuard.Key(instituteId, clientKey, CREATE_ACTION,
                REFERENCE_TYPE, null, hash, actorUserId);
        try {
            return requestGuard.run(key, () -> {
                if (headRepository.existsByInstituteIdAndCode(instituteId, code)) {
                    throw duplicateCode(code);
                }
                if (parentId != null) {
                    checkParent(instituteId, null, parentId, nature);
                }
                CommerceAccountHead head = new CommerceAccountHead();
                head.setInstituteId(instituteId);
                head.setCode(code);
                head.setNameI18n(names);
                head.setParentId(parentId);
                head.setNature(nature.name());
                head.setExpenseKind(kind == null ? null : kind.name());
                head.setCapital(capital);
                head.setDefaultItcEligibility(itc == null ? null : itc.name());
                head.setDefaultHsnCode(hsn);
                head.setSystem(false);
                head.setPosition(position);
                head.setStatus(status.name());
                head.setCreatedBy(actorUserId);
                head.setUpdatedBy(actorUserId);
                CommerceAccountHead saved = headRepository.saveAndFlush(head);
                HeadView view = HeadView.of(saved);
                auditService.record(instituteId, actorUserId, null, AccountsAuditKinds.ACCOUNT_HEAD_EDIT,
                        REFERENCE_TYPE, saved.getId(), null, toJson(asMap(view)), null);
                return view;
            }, () -> byCode(instituteId, code)).value();
        } catch (DataIntegrityViolationException e) {
            if (mentions(e, "uq_commerce_account_head_code")) {
                throw duplicateCode(code);
            }
            throw e;
        }
    }

    // ------------------------------------------------------------------ edit

    /**
     * Edits a head (see {@link HeadRequest} for absent fields). No change writes nothing.
     *
     * @throws VacademyException 404 NOT_FOUND when the head (or the parent) is not the institute's
     * @throws ConflictException 409 SYSTEM_HEAD, HEAD_HAS_CHILDREN or HEAD_IN_USE
     */
    public HeadView update(String instituteId, String actorUserId, String headId, HeadRequest request) {
        if (request == null) {
            throw invalid("the request body is required");
        }
        Map<String, String> names = normaliseNames(request.getNameI18n());
        HeadNature nature = requireEnum(HeadNature.class, request.getNature(), "nature");
        ItcEligibility itc = enumOrNull(ItcEligibility.class, request.getDefaultItcEligibility(),
                "default_itc_eligibility");
        String hsn = normaliseHsn(request.getDefaultHsnCode());
        HeadStatus requestedStatus = enumOrNull(HeadStatus.class, request.getStatus(), "status");
        String parentId = trimToNull(request.getParentId());
        String typedCode = trimToNull(request.getCode());

        ensureSeeded(instituteId, actorUserId);
        return transaction.execute(status -> {
            CommerceAccountHead head = headRepository.findByInstituteIdAndId(instituteId, headId)
                    .orElseThrow(AccountHeadService::notFound);
            if (typedCode != null && !typedCode.toUpperCase(Locale.ROOT).equals(head.getCode())) {
                throw invalid("code cannot be changed");
            }
            ExpenseKind kind = expenseKindFor(nature, request.getExpenseKind(),
                    HeadNature.EXPENSE.name().equals(head.getNature()) ? head.getExpenseKind() : null);
            String newKind = kind == null ? null : kind.name();
            boolean capital = request.getIsCapital() == null ? head.isCapital() : request.getIsCapital();
            int position = normalisePosition(request.getPosition(), head.getPosition());
            String newStatus = requestedStatus == null ? head.getStatus() : requestedStatus.name();
            boolean natureChanged = !nature.name().equals(head.getNature());
            boolean statusChanged = !newStatus.equals(head.getStatus());

            if (head.isSystem() && (natureChanged || statusChanged || !Objects.equals(parentId, head.getParentId())
                    || capital != head.isCapital() || !Objects.equals(newKind, head.getExpenseKind()))) {
                throw new ConflictException("SYSTEM_HEAD: the nature, status, parent, capital flag and expense kind "
                        + "of a system head cannot change; its name, position and defaults can");
            }
            if (natureChanged) {
                if (headRepository.existsByInstituteIdAndParentId(instituteId, headId)) {
                    throw new ConflictException("HEAD_HAS_CHILDREN: a head with sub-heads cannot change its nature");
                }
                for (AccountHeadUsage usage : usages) {
                    if (usage.isUsed(instituteId, headId)) {
                        throw new ConflictException("HEAD_IN_USE: this head is used by entries; its nature cannot "
                                + "change");
                    }
                }
            }
            if (statusChanged && HeadStatus.INACTIVE.name().equals(newStatus)
                    && headRepository.existsByInstituteIdAndParentIdAndStatus(instituteId, headId,
                    HeadStatus.ACTIVE.name())) {
                throw new ConflictException("HEAD_HAS_CHILDREN: deactivate its active sub-heads first");
            }
            if (parentId != null) {
                checkParent(instituteId, headId, parentId, nature);
            }

            HeadView before = HeadView.of(head);
            head.setNameI18n(names);
            head.setParentId(parentId);
            head.setNature(nature.name());
            head.setExpenseKind(newKind);
            head.setCapital(capital);
            head.setDefaultItcEligibility(itc == null ? null : itc.name());
            head.setDefaultHsnCode(hsn);
            head.setPosition(position);
            head.setStatus(newStatus);
            HeadView after = HeadView.of(head);

            Map<String, Object> oldValues = asMap(before);
            Map<String, Object> newValues = asMap(after);
            Map<String, Object> oldChanged = new LinkedHashMap<>();
            Map<String, Object> newChanged = new LinkedHashMap<>();
            for (Map.Entry<String, Object> e : newValues.entrySet()) {
                Object old = oldValues.get(e.getKey());
                if (!Objects.equals(old, e.getValue())) {
                    oldChanged.put(e.getKey(), old);
                    newChanged.put(e.getKey(), e.getValue());
                }
            }
            if (newChanged.isEmpty()) {
                return before;
            }
            head.setUpdatedBy(actorUserId);
            CommerceAccountHead saved = headRepository.saveAndFlush(head);
            auditService.record(instituteId, actorUserId, null, AccountsAuditKinds.ACCOUNT_HEAD_EDIT, REFERENCE_TYPE,
                    headId, toJson(oldChanged), toJson(newChanged), null);
            return HeadView.of(saved);
        });
    }

    // ------------------------------------------------------------------ rules

    /** The parent is a head of the institute, has no parent itself, has the same nature; the child has no children. */
    private void checkParent(String instituteId, String headId, String parentId, HeadNature nature) {
        if (parentId.equals(headId)) {
            throw invalid("a head cannot be its own parent");
        }
        CommerceAccountHead parent = headRepository.findByInstituteIdAndId(instituteId, parentId)
                .orElseThrow(AccountHeadService::notFound);
        if (parent.getParentId() != null) {
            throw invalid("the parent is itself a sub-head; one level of parent only");
        }
        if (!nature.name().equals(parent.getNature())) {
            throw invalid("the parent has another nature");
        }
        if (headId != null && headRepository.existsByInstituteIdAndParentId(instituteId, headId)) {
            throw invalid("a head with sub-heads cannot get a parent");
        }
    }

    private HeadView byCode(String instituteId, String code) {
        return headRepository.findForList(instituteId, null, null).stream()
                .filter(h -> code.equals(h.getCode()))
                .findFirst()
                .map(HeadView::of)
                .orElseThrow(() -> new IllegalStateException("account head of a finished request not found"));
    }

    static String normaliseCode(String raw) {
        String code = trimToNull(raw);
        if (code == null) {
            throw invalid("code is required");
        }
        code = code.toUpperCase(Locale.ROOT);
        if (!CODE.matcher(code).matches()) {
            throw invalid("code must be 1 to 32 capital letters, digits or underscores");
        }
        return code;
    }

    /** {@code en} required, other keys two lower-case letters, at most 5 languages, each name 1-100 characters. */
    static Map<String, String> normaliseNames(Map<String, String> raw) {
        if (raw == null || raw.isEmpty()) {
            throw invalid("name_i18n is required with an \"en\" name");
        }
        if (raw.size() > MAX_LANGUAGES) {
            throw invalid("name_i18n has at most " + MAX_LANGUAGES + " languages");
        }
        Map<String, String> out = new LinkedHashMap<>();
        String en = trimToNull(raw.get("en"));
        if (en == null) {
            throw invalid("name_i18n.en is required");
        }
        for (Map.Entry<String, String> e : raw.entrySet()) {
            String language = e.getKey();
            if (language == null || !LANGUAGE.matcher(language).matches()) {
                throw invalid("name_i18n keys are two lower-case letters");
            }
            String name = trimToNull(e.getValue());
            if (name == null || name.length() > MAX_NAME) {
                throw invalid("name_i18n." + language + " must be 1 to " + MAX_NAME + " characters");
            }
        }
        out.put("en", en);
        for (Map.Entry<String, String> e : raw.entrySet()) {
            if (!"en".equals(e.getKey())) {
                out.put(e.getKey(), e.getValue().trim());
            }
        }
        return out;
    }

    /**
     * EXPENSE heads have a kind (the typed one, else {@code current}, else INDIRECT); other natures
     * have none and refuse one.
     */
    static ExpenseKind expenseKindFor(HeadNature nature, String typed, String current) {
        ExpenseKind kind = enumOrNull(ExpenseKind.class, typed, "expense_kind");
        if (nature != HeadNature.EXPENSE) {
            if (kind != null) {
                throw invalid("expense_kind is only for EXPENSE heads");
            }
            return null;
        }
        if (kind != null) {
            return kind;
        }
        return current != null ? ExpenseKind.valueOf(current) : ExpenseKind.INDIRECT;
    }

    static String normaliseHsn(String raw) {
        String hsn = trimToNull(raw);
        if (hsn != null && !HSN.matcher(hsn).matches()) {
            throw invalid("default_hsn_code must be 4 to 8 digits");
        }
        return hsn;
    }

    static int normalisePosition(Integer raw, int current) {
        if (raw == null) {
            return current;
        }
        if (raw < 0 || raw > MAX_POSITION) {
            throw invalid("position must be between 0 and " + MAX_POSITION);
        }
        return raw;
    }

    private static <E extends Enum<E>> E requireEnum(Class<E> type, String raw, String field) {
        E value = enumOrNull(type, raw, field);
        if (value == null) {
            throw invalid(field + " is required");
        }
        return value;
    }

    private static <E extends Enum<E>> E enumOrNull(Class<E> type, String raw, String field) {
        String value = trimToNull(raw);
        if (value == null) {
            return null;
        }
        try {
            return Enum.valueOf(type, value.toUpperCase(Locale.ROOT));
        } catch (IllegalArgumentException e) {
            throw invalid(field + " has an unknown value");
        }
    }

    private static String trimToNull(String value) {
        if (value == null) {
            return null;
        }
        String trimmed = value.trim();
        return trimmed.isEmpty() ? null : trimmed;
    }

    private static Map<String, Object> asMap(HeadView view) {
        return MAPPER.convertValue(view, new TypeReference<LinkedHashMap<String, Object>>() {
        });
    }

    private static String toJson(Object value) {
        try {
            return MAPPER.writeValueAsString(value);
        } catch (JsonProcessingException e) {
            throw new IllegalStateException("account head JSON is not serialisable", e);
        }
    }

    private static boolean mentions(Throwable e, String constraint) {
        for (Throwable t = e; t != null; t = t.getCause()) {
            if (t.getMessage() != null && t.getMessage().contains(constraint)) {
                return true;
            }
            if (t.getCause() == t) {
                break;
            }
        }
        return false;
    }

    private static ConflictException duplicateCode(String code) {
        return new ConflictException("DUPLICATE_CODE: a head with code " + code + " already exists");
    }

    private static VacademyException notFound() {
        return new VacademyException(HttpStatus.NOT_FOUND, "NOT_FOUND: no such account head");
    }

    private static InvalidRequestException invalid(String message) {
        return new InvalidRequestException("VALIDATION: " + message);
    }
}
