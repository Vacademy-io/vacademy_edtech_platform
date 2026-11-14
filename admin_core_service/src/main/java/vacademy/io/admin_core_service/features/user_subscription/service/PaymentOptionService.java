package vacademy.io.admin_core_service.features.user_subscription.service;

import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import vacademy.io.admin_core_service.features.auth_service.service.AuthService;
import vacademy.io.admin_core_service.features.common.enums.StatusEnum;
import vacademy.io.admin_core_service.features.fee_management.entity.AftInstallment;
import vacademy.io.admin_core_service.features.fee_management.entity.AssignedFeeValue;
import vacademy.io.admin_core_service.features.fee_management.entity.ComplexPaymentOption;
import vacademy.io.admin_core_service.features.fee_management.entity.FeeType;
import vacademy.io.admin_core_service.features.fee_management.repository.AftInstallmentRepository;
import vacademy.io.admin_core_service.features.fee_management.repository.AssignedFeeValueRepository;
import vacademy.io.admin_core_service.features.fee_management.repository.FeeTypeRepository;
import vacademy.io.admin_core_service.features.regional_pricing.service.RegionalPriceService;
import vacademy.io.admin_core_service.features.user_subscription.dto.PaymentOptionDTO;
import vacademy.io.admin_core_service.features.user_subscription.dto.PaymentOptionFilterDTO;
import vacademy.io.admin_core_service.features.user_subscription.entity.PaymentOption;
import vacademy.io.admin_core_service.features.user_subscription.entity.PaymentPlan;
import vacademy.io.admin_core_service.features.user_subscription.enums.PaymentOptionTag;
import vacademy.io.admin_core_service.features.user_subscription.enums.PaymentOptionType;
import vacademy.io.admin_core_service.features.user_subscription.repository.PaymentOptionRepository;
import vacademy.io.admin_core_service.features.user_subscription.repository.PaymentPlanRepository;
import vacademy.io.common.auth.dto.UserDTO;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.VacademyException;

import java.math.BigDecimal;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;

@Slf4j
@Service
public class PaymentOptionService {

    /**
     * Default exclusion: CPO mirrors are hidden from the generic /payment-options
     * listing. Callers that explicitly want CPOs pass {@code excludeTypes=[]} or
     * {@code types=['CPO']}.
     */
    private static final List<String> DEFAULT_EXCLUDE_TYPES = List.of(PaymentOptionType.CPO.name());

    @Autowired
    private PaymentOptionRepository paymentOptionRepository;

    @Autowired
    private PaymentPlanService paymentPlanService;

    @Autowired
    private PaymentPlanRepository paymentPlanRepository;

    @Autowired
    private FeeTypeRepository feeTypeRepository;

    @Autowired
    private AssignedFeeValueRepository assignedFeeValueRepository;

    @Autowired
    private AftInstallmentRepository aftInstallmentRepository;

    @Autowired
    private AuthService authService;

    @Autowired
    private RegionalPriceService regionalPriceService;

    /**
     * Creates a payment option, or — when the DTO carries the id of an existing row —
     * edits it in place (the Settings page edits through this same POST). Returns the
     * saved option so the caller and the audit log get the server-generated id.
     *
     * <p>An edit is routed through {@link #editPaymentOption} rather than merged as a
     * rebuilt entity. The merge kept every stored plan ACTIVE next to the resent copies
     * (a FREE/DONATION plan is resent without an id, so it was inserted anew on every
     * save — prod had ~2,000 options carrying duplicate live plans), and it nulled the
     * DEFAULT tag because the edit payload never carries one.
     */
    public PaymentOptionDTO savePaymentOption(PaymentOptionDTO paymentOptionDTO, CustomUserDetails userDetails) {
        if (paymentOptionDTO.getId() != null && !paymentOptionDTO.getId().isBlank()
                && paymentOptionRepository.existsById(paymentOptionDTO.getId())) {
            return editPaymentOption(paymentOptionDTO, true);
        }

        PaymentOption paymentOption = new PaymentOption(paymentOptionDTO);
        // Any id that reached here is a client placeholder (the invite flow sends
        // "plan_<timestamp>"). Clear it so the generator mints the real one and the
        // repository takes the persist path instead of merging a phantom row.
        paymentOption.setId(null);
        paymentOption.getPaymentPlans().forEach(plan -> plan.setId(null));
        // Creator is stamped from the JWT, never trusted from the client.
        paymentOption.setCreatedByUserId(userDetails != null ? userDetails.getUserId() : null);

        if (PaymentOptionType.FREE.name().equalsIgnoreCase(paymentOption.getType()) && paymentOption.getPaymentPlans().isEmpty()) {
            PaymentPlan freePlan = new PaymentPlan();
            freePlan.setName("Free Plan");
            freePlan.setStatus(StatusEnum.ACTIVE.name());
            freePlan.setPaymentOption(paymentOption);
            freePlan.setActualPrice(0.0);
            freePlan.setElevatedPrice(0.0);
            freePlan.setCurrency("INR");
            paymentOption.getPaymentPlans().add(freePlan);
        }

        PaymentOption saved = paymentOptionRepository.save(paymentOption);
        syncRegionalPrices(saved);
        return saved.mapToPaymentOptionDTO();
    }

    // -------------------------------------------------------------------------
    // Audit helpers — called from @Auditable SpEL on PaymentOptionController.
    // Every method is total: audit must never break the mutation it describes.
    // -------------------------------------------------------------------------

    /**
     * Pre-mutation snapshot for {@code captureBefore}. Null when there is no id
     * (a create) or no such row, which is how the controller tells CREATE from
     * UPDATE on the shared POST.
     */
    public PaymentOptionDTO auditSnapshot(String paymentOptionId) {
        if (paymentOptionId == null || paymentOptionId.isBlank()) return null;
        try {
            return paymentOptionRepository.findById(paymentOptionId)
                    .map(PaymentOption::mapToPaymentOptionDTO)
                    .orElse(null);
        } catch (Exception e) {
            log.warn("auditSnapshot failed for payment option {}: {}", paymentOptionId, e.getMessage());
            return null;
        }
    }

    /** Name of one option for the audit sentence, falling back to its id. */
    public String auditName(String paymentOptionId) {
        if (paymentOptionId == null || paymentOptionId.isBlank()) return null;
        try {
            return paymentOptionRepository.findById(paymentOptionId)
                    .map(PaymentOption::getName)
                    .filter(n -> n != null && !n.isBlank())
                    .orElse(paymentOptionId);
        } catch (Exception e) {
            return paymentOptionId;
        }
    }

    /**
     * "payment plan Annual Membership" for one id, "3 payment plan(s)" for several —
     * a bulk delete naming every plan would not fit the log row.
     */
    public String auditLabel(List<String> paymentOptionIds) {
        List<String> ids = paymentOptionIds == null
                ? List.of()
                : paymentOptionIds.stream().filter(Objects::nonNull).filter(id -> !id.isBlank()).distinct().toList();
        if (ids.isEmpty()) return null;
        if (ids.size() > 1) return ids.size() + " payment plan(s)";
        return "payment plan " + auditName(ids.get(0));
    }

    /**
     * Sentinel values for List parameters bound when the corresponding "has*" boolean
     * flag is false. Postgres JDBC requires non-null List bindings for IN-list
     * parameters; the boolean flag short-circuits the AND so the IN clause is never
     * actually evaluated. The sentinel value just needs to be non-empty and won't
     * match any real row.
     */
    private static final List<String> SENTINEL_LIST = List.of("__NONE__");

    public List<PaymentOptionDTO> getPaymentOptions(PaymentOptionFilterDTO paymentOptionFilterDTO, CustomUserDetails userDetails) {
        List<String> excludeTypes = resolveExcludeTypes(paymentOptionFilterDTO);
        List<String> types = paymentOptionFilterDTO.getTypes();

        boolean hasTypes = types != null && !types.isEmpty();
        boolean hasExcludeTypes = excludeTypes != null && !excludeTypes.isEmpty();
        List<String> activeStatuses = List.of(StatusEnum.ACTIVE.name());

        List<PaymentOption> paymentOptions = paymentOptionRepository.findPaymentOptionsWithPaymentPlansNative(
                hasTypes,
                hasTypes ? types : SENTINEL_LIST,
                hasExcludeTypes,
                hasExcludeTypes ? excludeTypes : SENTINEL_LIST,
                paymentOptionFilterDTO.getSource(),
                paymentOptionFilterDTO.getSourceId(),
                true,
                activeStatuses,
                true,
                activeStatuses,
                paymentOptionFilterDTO.isRequireApproval(),
                paymentOptionFilterDTO.isNotRequireApproval(),
                blankToNull(paymentOptionFilterDTO.getSearch()),
                paymentOptionFilterDTO.getLimit()
        );
        List<PaymentOptionDTO> dtos = paymentOptions.stream().map(PaymentOption::mapToPaymentOptionDTO).toList();
        // The learner app hits this same endpoint for admission payments; a learner has no
        // use for who configured the plan, so the auth_service round-trip is admin-only.
        if (!isLearnerOnly(userDetails)) {
            attachCreatorNames(dtos);
        }
        return dtos;
    }

    /** A blank search box means "no filter", not "match the empty string". */
    private static String blankToNull(String value) {
        return (value == null || value.isBlank()) ? null : value.trim();
    }

    private static final List<String> LEARNER_ROLES = List.of("STUDENT", "PARENT", "GUARDIAN");

    private boolean isLearnerOnly(CustomUserDetails user) {
        if (user == null || user.getAuthorities() == null || user.getAuthorities().isEmpty()) return false;
        return user.getAuthorities().stream()
                .allMatch(a -> a.getAuthority() != null
                        && LEARNER_ROLES.stream().anyMatch(r -> r.equalsIgnoreCase(a.getAuthority())));
    }

    /**
     * Resolves {@code createdByUserId} to a display name in one batched auth_service
     * call. Best-effort: the list must still come back when auth_service is slow or
     * down, so a failure leaves {@code createdByName} null and the UI shows the id.
     */
    private void attachCreatorNames(List<PaymentOptionDTO> dtos) {
        List<String> creatorIds = dtos.stream()
                .map(PaymentOptionDTO::getCreatedByUserId)
                .filter(Objects::nonNull)
                .filter(id -> !id.isBlank())
                .distinct()
                .toList();
        if (creatorIds.isEmpty()) return;
        Map<String, String> names = new HashMap<>();
        try {
            for (UserDTO user : authService.getUsersFromAuthServiceByUserIds(creatorIds)) {
                if (user == null || user.getId() == null) continue;
                String name = user.getFullName() != null && !user.getFullName().isBlank()
                        ? user.getFullName().trim()
                        : user.getEmail() != null && !user.getEmail().isBlank()
                                ? user.getEmail()
                                : user.getUsername();
                if (name != null) names.put(user.getId(), name);
            }
        } catch (Exception e) {
            log.warn("Could not resolve payment option creator names ({} ids): {}", creatorIds.size(), e.getMessage());
            return;
        }
        for (PaymentOptionDTO dto : dtos) {
            dto.setCreatedByName(names.get(dto.getCreatedByUserId()));
        }
    }

    public Optional<PaymentOption> getPaymentOption(String source, String sourceId, String tag, List<String> statuses) {
        boolean hasStatuses = statuses != null && !statuses.isEmpty();
        return paymentOptionRepository.findTopByFiltersWithPlans(
                source,
                sourceId,
                tag,
                true,
                DEFAULT_EXCLUDE_TYPES,
                hasStatuses,
                hasStatuses ? statuses : SENTINEL_LIST,
                hasStatuses,
                hasStatuses ? statuses : SENTINEL_LIST);
    }

    private void changeDefaultPaymentOption(String source, String sourceId) {
        Optional<PaymentOption> optionalPaymentOption = getPaymentOption(source, sourceId, PaymentOptionTag.DEFAULT.name(), List.of(StatusEnum.ACTIVE.name()));
        if (optionalPaymentOption.isPresent()) {
            PaymentOption paymentOption = optionalPaymentOption.get();
            paymentOption.setTag(null);
            paymentOptionRepository.save(paymentOption);
        }
    }

    private void makeDefaultPaymentOption(String paymentOptionId) {
        PaymentOption paymentOption = findById(paymentOptionId);
        paymentOption.setTag(PaymentOptionTag.DEFAULT.name());
        paymentOptionRepository.save(paymentOption);
    }

    public String makeDefaultPaymentOption(String paymentOptionId, String source, String sourceId) {
        changeDefaultPaymentOption(source, sourceId);
        makeDefaultPaymentOption(paymentOptionId);
        return "success";
    }

    public PaymentOption findById(String id) {
        return paymentOptionRepository.findById(id).orElseThrow(() -> new VacademyException("Payment Option not found"));
    }

    public Optional<PaymentOption> findByComplexPaymentOptionId(String complexPaymentOptionId) {
        if (complexPaymentOptionId == null) return Optional.empty();
        return paymentOptionRepository.findByComplexPaymentOptionId(complexPaymentOptionId);
    }

    public String deletePaymentOption(List<String> paymentOptionIds, CustomUserDetails userDetails) {
        List<PaymentOption> paymentOptions = paymentOptionRepository.findAllById(paymentOptionIds);
        for (PaymentOption paymentOption : paymentOptions) {
            paymentOption.setStatus(StatusEnum.DELETED.name());
        }
        paymentOptionRepository.saveAll(paymentOptions);
        return "success";
    }

    /** PUT edit: a partial payload, so null plan fields are left alone. */
    public PaymentOptionDTO editPaymentOption(PaymentOptionDTO paymentOptionDTO) {
        return editPaymentOption(paymentOptionDTO, false);
    }

    /**
     * @param fullPayload the caller resends every plan field (Settings save via POST), so a
     *                    null validity is the admin choosing "no expiry" and must be written.
     */
    private PaymentOptionDTO editPaymentOption(PaymentOptionDTO paymentOptionDTO, boolean fullPayload) {
        PaymentOption paymentOption = findById(paymentOptionDTO.getId());
        paymentOption.setName(paymentOptionDTO.getName());
        paymentOption.setType(paymentOptionDTO.getType());
        paymentOption.setPaymentOptionMetadataJson(paymentOptionDTO.getPaymentOptionMetadataJson());
        paymentOption.setRequireApproval(paymentOptionDTO.isRequireApproval());
        paymentOption.setUnit(paymentOptionDTO.getUnit());
        // Null-guarded: an edit payload that predates the plan-change feature must not
        // silently turn the master switch off for an option that already has it on.
        if (paymentOptionDTO.getPlanChangeAllowed() != null) {
            paymentOption.setPlanChangeAllowed(paymentOptionDTO.getPlanChangeAllowed());
        }
        // Same null-guard: editors that predate regional pricing must not switch it off.
        if (paymentOptionDTO.getRegionalPricingEnabled() != null) {
            paymentOption.setRegionalPricingEnabled(paymentOptionDTO.getRegionalPricingEnabled());
        }
        if (paymentOptionDTO.getRegionalPricingCurrencies() != null) {
            paymentOption.setRegionalPricingCurrencies(
                    PaymentOption.joinCurrencies(paymentOptionDTO.getRegionalPricingCurrencies()));
        }
        List<PaymentPlan> paymentPlans = paymentPlanService.editPaymentPlans(paymentOption.getPaymentPlans(), paymentOptionDTO.getPaymentPlans(), paymentOption, fullPayload);
        paymentOption.setPaymentPlans(paymentPlans);
        paymentOptionRepository.save(paymentOption);
        syncRegionalPrices(paymentOption);
        return paymentOption.mapToPaymentOptionDTO();
    }

    /**
     * Keeps regional prices in step with a just-saved option: AUTO rows follow a base-price
     * edit, MANUAL rows are flagged for review, new plans and currencies get AUTO rows. Never
     * fails the save it follows — a missing exchange rate only leaves those rows unpriced
     * until the daily job or the panel's "Refresh rates" fills them in.
     */
    private void syncRegionalPrices(PaymentOption option) {
        // Flag off (the default): do nothing at all, so saving an option is exactly as before.
        if (option == null || !Boolean.TRUE.equals(option.getRegionalPricingEnabled())) {
            return;
        }
        try {
            regionalPriceService.sync(option, false);
        } catch (Exception e) {
            log.warn("Regional price sync failed for payment option {}: {}", option.getId(), e.getMessage());
        }
    }

    // -------------------------------------------------------------------------
    // CPO mirror sync
    // -------------------------------------------------------------------------

    /**
     * Returns the existing mirror PaymentOption for the given CPO, or creates one
     * (plus a synthetic PaymentPlan) if it does not exist yet. Idempotent.
     * Called from FeeManagementService after every CPO create/update.
     */
    public PaymentOption findOrCreateMirrorForCpo(ComplexPaymentOption cpo) {
        if (cpo == null || cpo.getId() == null) {
            throw new VacademyException("Cannot create mirror PaymentOption: CPO is null");
        }

        Optional<PaymentOption> existing = paymentOptionRepository.findByComplexPaymentOptionId(cpo.getId());
        if (existing.isPresent()) {
            return syncMirrorForCpo(cpo, existing.get());
        }

        PaymentOption mirror = new PaymentOption();
        mirror.setName(cpo.getName());
        mirror.setStatus(mapCpoStatusToPaymentOptionStatus(cpo.getStatus()));
        mirror.setSource("INSTITUTE");
        mirror.setSourceId(cpo.getInstituteId());
        mirror.setType(PaymentOptionType.CPO.name());
        mirror.setRequireApproval(false);
        mirror.setComplexPaymentOptionId(cpo.getId());
        // The CPO row already knows its creator; the mirror is what the plan picker lists.
        mirror.setCreatedByUserId(cpo.getCreatedBy());

        PaymentOption saved = paymentOptionRepository.save(mirror);
        upsertSyntheticPaymentPlan(cpo, saved);
        log.info("Created mirror PaymentOption {} for CPO {}", saved.getId(), cpo.getId());
        return saved;
    }

    /**
     * Re-syncs the mirror PaymentOption + synthetic PaymentPlan with the current
     * state of the CPO (name, status, fee structure totals). Called after CPO
     * update/approve/soft-delete and after fee-type updates.
     */
    public PaymentOption syncMirrorForCpo(ComplexPaymentOption cpo) {
        if (cpo == null) return null;
        Optional<PaymentOption> existing = paymentOptionRepository.findByComplexPaymentOptionId(cpo.getId());
        if (existing.isEmpty()) {
            return findOrCreateMirrorForCpo(cpo);
        }
        return syncMirrorForCpo(cpo, existing.get());
    }

    /**
     * Sets the admin-approval flag on a CPO's mirror PaymentOption. syncMirrorForCpo
     * intentionally never touches require_approval, so this is the single place that
     * writes it for CPO-backed options (driven by the CPO create/update payload).
     */
    public void updateMirrorRequireApproval(String cpoId, boolean requireApproval) {
        paymentOptionRepository.findByComplexPaymentOptionId(cpoId).ifPresent(mirror -> {
            mirror.setRequireApproval(requireApproval);
            paymentOptionRepository.save(mirror);
        });
    }

    /** Reads the require_approval flag off a CPO's mirror PaymentOption (false if no mirror). */
    public boolean getMirrorRequireApproval(String cpoId) {
        return paymentOptionRepository.findByComplexPaymentOptionId(cpoId)
                .map(PaymentOption::isRequireApproval)
                .orElse(false);
    }

    private PaymentOption syncMirrorForCpo(ComplexPaymentOption cpo, PaymentOption mirror) {
        mirror.setName(cpo.getName());
        mirror.setStatus(mapCpoStatusToPaymentOptionStatus(cpo.getStatus()));
        // institute_id may have changed (rare but supported)
        mirror.setSourceId(cpo.getInstituteId());
        // type is fixed; never reset
        if (!PaymentOptionType.CPO.name().equals(mirror.getType())) {
            mirror.setType(PaymentOptionType.CPO.name());
        }
        PaymentOption saved = paymentOptionRepository.save(mirror);
        upsertSyntheticPaymentPlan(cpo, saved);
        return saved;
    }

    private void upsertSyntheticPaymentPlan(ComplexPaymentOption cpo, PaymentOption mirror) {
        BigDecimal total = computeTotalContractValue(cpo.getId());
        Integer validityDays = computeValidityInDays(cpo.getId());

        List<PaymentPlan> existingPlans = paymentPlanRepository.findByPaymentOption(mirror);
        PaymentPlan plan = existingPlans.stream()
                .filter(p -> !StatusEnum.DELETED.name().equalsIgnoreCase(p.getStatus()))
                .findFirst()
                .orElse(null);

        if (plan == null) {
            plan = new PaymentPlan();
            plan.setName(cpo.getName());
            plan.setStatus(StatusEnum.ACTIVE.name());
            plan.setCurrency("INR");
            plan.setDescription("Synthetic plan auto-generated for CPO-backed payment option");
            plan.setTag(PaymentOptionTag.DEFAULT.name());
            plan.setPaymentOption(mirror);
        } else {
            plan.setName(cpo.getName());
            plan.setStatus(StatusEnum.ACTIVE.name());
        }
        plan.setActualPrice(total != null ? total.doubleValue() : 0.0);
        plan.setElevatedPrice(0.0);
        plan.setValidityInDays(validityDays);
        // A system-built installment plan behind a one-time course price (V575) has no
        // installment dates to derive validity from; it takes the course plan's validity and
        // currency so the learner's membership dates and amounts match the course.
        if (cpo.getSourcePaymentPlanId() != null) {
            PaymentPlan source = paymentPlanRepository.findById(cpo.getSourcePaymentPlanId()).orElse(null);
            if (source != null) {
                plan.setValidityInDays(source.getValidityInDays());
                if (source.getCurrency() != null) {
                    plan.setCurrency(source.getCurrency());
                }
            }
        }
        paymentPlanRepository.save(plan);
    }

    /**
     * Sums all installment amounts under the CPO. Falls back to AssignedFeeValue.amount
     * for fee types that have no installments defined.
     */
    private BigDecimal computeTotalContractValue(String cpoId) {
        BigDecimal total = BigDecimal.ZERO;
        List<FeeType> feeTypes = feeTypeRepository.findByCpoId(cpoId);
        for (FeeType ft : feeTypes) {
            if (StatusEnum.DELETED.name().equalsIgnoreCase(ft.getStatus())) continue;
            List<AssignedFeeValue> afvs = assignedFeeValueRepository.findByFeeTypeId(ft.getId());
            for (AssignedFeeValue afv : afvs) {
                if (StatusEnum.DELETED.name().equalsIgnoreCase(afv.getStatus())) continue;
                List<AftInstallment> installments = aftInstallmentRepository
                        .findByAssignedFeeValueIdOrderByInstallmentNumberAsc(afv.getId());
                if (installments.isEmpty()) {
                    if (afv.getAmount() != null) total = total.add(afv.getAmount());
                } else {
                    for (AftInstallment ai : installments) {
                        if (ai.getAmount() != null) total = total.add(ai.getAmount());
                    }
                }
            }
        }
        return total;
    }

    /**
     * Returns the duration between the earliest installment start_date and the latest
     * end_date (in days). Null when no installments carry both dates.
     */
    private Integer computeValidityInDays(String cpoId) {
        List<FeeType> feeTypes = feeTypeRepository.findByCpoId(cpoId);
        java.time.LocalDate minStart = null;
        java.time.LocalDate maxEnd = null;
        for (FeeType ft : feeTypes) {
            List<AssignedFeeValue> afvs = assignedFeeValueRepository.findByFeeTypeId(ft.getId());
            for (AssignedFeeValue afv : afvs) {
                List<AftInstallment> installments = aftInstallmentRepository
                        .findByAssignedFeeValueIdOrderByInstallmentNumberAsc(afv.getId());
                for (AftInstallment ai : installments) {
                    if (ai.getStartDate() != null && (minStart == null || ai.getStartDate().isBefore(minStart))) {
                        minStart = ai.getStartDate();
                    }
                    if (ai.getEndDate() != null && (maxEnd == null || ai.getEndDate().isAfter(maxEnd))) {
                        maxEnd = ai.getEndDate();
                    }
                }
            }
        }
        if (minStart == null || maxEnd == null) return null;
        long days = ChronoUnit.DAYS.between(minStart, maxEnd);
        return days > 0 ? (int) days : null;
    }

    private String mapCpoStatusToPaymentOptionStatus(String cpoStatus) {
        if (cpoStatus == null) return StatusEnum.ACTIVE.name();
        if ("PENDING_APPROVAL".equalsIgnoreCase(cpoStatus)) return "PENDING_APPROVAL";
        if (StatusEnum.DELETED.name().equalsIgnoreCase(cpoStatus)) return StatusEnum.DELETED.name();
        return StatusEnum.ACTIVE.name();
    }

    private List<String> resolveExcludeTypes(PaymentOptionFilterDTO filter) {
        List<String> excludeTypes = filter.getExcludeTypes();
        if (excludeTypes == null) {
            // Caller did not specify → apply default: hide CPO mirrors from generic listing
            // (unless they explicitly asked for CPO via types=['CPO'])
            if (filter.getTypes() != null && filter.getTypes().contains(PaymentOptionType.CPO.name())) {
                return null;
            }
            return new ArrayList<>(DEFAULT_EXCLUDE_TYPES);
        }
        if (excludeTypes.isEmpty()) {
            // Caller explicitly disabled the default exclusion.
            return null;
        }
        return excludeTypes;
    }
}
