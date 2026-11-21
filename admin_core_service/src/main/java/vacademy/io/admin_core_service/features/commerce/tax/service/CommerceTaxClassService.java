package vacademy.io.admin_core_service.features.commerce.tax.service;

import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Sort;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.admin_core_service.features.commerce.audit.CommerceAuditService;
import vacademy.io.admin_core_service.features.commerce.tax.calc.TaxClassRef;
import vacademy.io.admin_core_service.features.commerce.tax.calc.TaxRateRule;
import vacademy.io.admin_core_service.features.commerce.tax.dto.TaxClassDTO;
import vacademy.io.admin_core_service.features.commerce.tax.dto.TaxRateRuleDTO;
import vacademy.io.admin_core_service.features.commerce.tax.entity.CommerceTaxClass;
import vacademy.io.admin_core_service.features.commerce.tax.entity.CommerceTaxRateRule;
import vacademy.io.admin_core_service.features.commerce.tax.enums.TaxClassStatus;
import vacademy.io.admin_core_service.features.commerce.tax.enums.TaxMode;
import vacademy.io.admin_core_service.features.commerce.tax.repository.CommerceTaxClassRepository;
import vacademy.io.admin_core_service.features.commerce.tax.repository.CommerceTaxRateRuleRepository;
import vacademy.io.common.exceptions.ConflictException;
import vacademy.io.common.exceptions.InvalidRequestException;
import vacademy.io.common.exceptions.ResourceNotFoundException;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Pattern;
import java.util.stream.Collectors;

import static vacademy.io.admin_core_service.features.commerce.tax.service.CommerceInputRules.enumValue;
import static vacademy.io.admin_core_service.features.commerce.tax.service.CommerceInputRules.require;
import static vacademy.io.admin_core_service.features.commerce.tax.service.CommerceInputRules.trimToNull;

/**
 * Tax classes and their rate rules. Rates, HSN codes and slab limits are data the institute
 * types in from its CA; nothing here supplies a default. Every change is audited.
 */
@Service
@RequiredArgsConstructor
public class CommerceTaxClassService {

    private static final String ENTITY_CLASS = "TAX_CLASS";
    private static final String ENTITY_RULE = "TAX_RATE_RULE";
    private static final Pattern CODE = Pattern.compile("^[a-z0-9]+(_[a-z0-9]+)*$");
    private static final Pattern HSN = Pattern.compile("^[0-9]{4,8}$");
    private static final BigDecimal HUNDRED = BigDecimal.valueOf(100);

    private final CommerceTaxClassRepository taxClassRepository;
    private final CommerceTaxRateRuleRepository rateRuleRepository;
    private final CommerceTaxSettingService taxSettingService;
    private final CommerceAuditService auditService;

    // ------------------------------------------------------------------ reads

    @Transactional(readOnly = true)
    public Page<TaxClassDTO> list(String instituteId, int page, int size) {
        Page<CommerceTaxClass> classes = taxClassRepository.findByInstituteId(instituteId,
                CommerceInputRules.page(page, size, Sort.by(Sort.Order.asc("code"))));
        List<String> ids = classes.getContent().stream().map(CommerceTaxClass::getId).toList();
        Map<String, List<CommerceTaxRateRule>> rules = rulesByClass(instituteId, ids);
        return classes.map(c -> toDto(c, rules.getOrDefault(c.getId(), List.of())));
    }

    @Transactional(readOnly = true)
    public TaxClassDTO get(String instituteId, String taxClassId) {
        CommerceTaxClass taxClass = requireClass(instituteId, taxClassId);
        return toDto(taxClass, rateRuleRepository
                .findByInstituteIdAndTaxClassIdOrderByEffectiveFromAscMinUnitPriceAsc(instituteId, taxClassId));
    }

    /**
     * The tax classes the calculator needs, by id, each with all its rules (the calculator
     * picks the ones in force on the document date). An id that is not of this institute is
     * simply absent from the map.
     */
    @Transactional(readOnly = true)
    public Map<String, TaxClassRef> loadRefs(String instituteId, Collection<String> taxClassIds) {
        List<String> ids = taxClassIds == null ? List.of()
                : taxClassIds.stream().filter(id -> id != null && !id.isBlank()).distinct().toList();
        if (ids.isEmpty()) {
            return Map.of();
        }
        Map<String, List<CommerceTaxRateRule>> rules = rulesByClass(instituteId, ids);
        Map<String, TaxClassRef> out = new LinkedHashMap<>();
        for (CommerceTaxClass taxClass : taxClassRepository.findByInstituteIdAndIdIn(instituteId, ids)) {
            out.put(taxClass.getId(), TaxClassRef.builder()
                    .id(taxClass.getId())
                    .code(taxClass.getCode())
                    .hsnCode(taxClass.getHsnCode())
                    .unit(taxClass.getUnit())
                    .rules(rules.getOrDefault(taxClass.getId(), List.of()).stream()
                            .map(CommerceTaxClassService::toCalcRule).toList())
                    .build());
        }
        return out;
    }

    // ------------------------------------------------------------------ hooks for the catalogue

    /**
     * For a product save: a tax class id must be an ACTIVE class of this institute. Null passes
     * (a draft may have none).
     */
    @Transactional(readOnly = true)
    public void requireUsableTaxClass(String instituteId, String taxClassId) {
        if (trimToNull(taxClassId) == null) {
            return;
        }
        CommerceTaxClass taxClass = taxClassRepository.findByInstituteIdAndId(instituteId, taxClassId.trim())
                .orElseThrow(() -> new InvalidRequestException("tax_class_id is not a tax class of this institute"));
        require(TaxClassStatus.ACTIVE.name().equals(taxClass.getStatus()), "the tax class is archived");
    }

    /**
     * For publishing a product: in REGULAR tax mode the product must have a tax class, and that
     * class must have a rate in force today. In the other modes nothing is required.
     */
    @Transactional(readOnly = true)
    public void requireTaxClassForPublish(String instituteId, String taxClassId, LocalDate today) {
        if (taxSettingService.context(instituteId).getMode() != TaxMode.REGULAR) {
            return;
        }
        require(trimToNull(taxClassId) != null, "the product needs a tax class before it is published");
        requireUsableTaxClass(instituteId, taxClassId);
        boolean hasRate = rateRuleRepository
                .findByInstituteIdAndTaxClassIdOrderByEffectiveFromAscMinUnitPriceAsc(instituteId, taxClassId.trim())
                .stream().anyMatch(r -> !r.getEffectiveFrom().isAfter(today)
                        && (r.getEffectiveTo() == null || !r.getEffectiveTo().isBefore(today)));
        require(hasRate, "the tax class of the product has no rate in force today");
    }

    // ------------------------------------------------------------------ writes: class

    @Transactional
    public TaxClassDTO create(String instituteId, String actorUserId, TaxClassDTO request) {
        require(request != null, "request body is required");
        String code = trimToNull(request.getCode());
        require(code != null, "code is required");
        code = code.toLowerCase(Locale.ROOT);
        require(code.length() <= 64 && CODE.matcher(code).matches(),
                "code may hold lower-case letters, digits and underscores only");
        if (taxClassRepository.findByInstituteIdAndCode(instituteId, code).isPresent()) {
            throw new ConflictException("A tax class with the code " + code + " already exists");
        }
        CommerceTaxClass taxClass = new CommerceTaxClass();
        taxClass.setInstituteId(instituteId);
        taxClass.setCode(code);
        taxClass.setStatus(TaxClassStatus.ACTIVE.name());
        require(trimToNull(request.getName()) != null, "name is required");
        applyFields(instituteId, taxClass, request);
        taxClass = taxClassRepository.save(taxClass);
        auditService.record(instituteId, actorUserId, null, "TAX_CLASS_SAVED", ENTITY_CLASS, taxClass.getId(),
                null, CommerceInputRules.json(auditView(taxClass)), null);
        if (request.getRules() != null && !request.getRules().isEmpty()) {
            replaceRules(instituteId, actorUserId, taxClass.getId(), request.getRules());
            return get(instituteId, taxClass.getId());
        }
        return toDto(taxClass, List.of());
    }

    /** The code is fixed. A null field keeps its value. */
    @Transactional
    public TaxClassDTO update(String instituteId, String actorUserId, String taxClassId, TaxClassDTO request) {
        require(request != null, "request body is required");
        CommerceTaxClass taxClass = requireClass(instituteId, taxClassId);
        String before = CommerceInputRules.json(auditView(taxClass));
        applyFields(instituteId, taxClass, request);
        taxClass = taxClassRepository.save(taxClass);
        auditService.record(instituteId, actorUserId, null, "TAX_CLASS_SAVED", ENTITY_CLASS, taxClass.getId(),
                before, CommerceInputRules.json(auditView(taxClass)), null);
        if (request.getRules() != null) {
            replaceRules(instituteId, actorUserId, taxClassId, request.getRules());
        }
        return get(instituteId, taxClassId);
    }

    /**
     * The rules sent with a tax class are its FULL set: a rule with an id of this class is
     * changed, a rule with no id is added, and a stored rule that is not in the list is removed.
     * Here a null {@code max_unit_price} or {@code effective_to} means "open", unlike the
     * single-rule update where null keeps the value. The overlap rule is checked on the
     * finished set, so slabs can be re-cut in one save.
     */
    private void replaceRules(String instituteId, String actorUserId, String taxClassId,
                              List<TaxRateRuleDTO> requested) {
        require(requested.size() <= 200, "a tax class can hold at most 200 rate rules");
        Map<String, CommerceTaxRateRule> stored = new LinkedHashMap<>();
        for (CommerceTaxRateRule rule : rateRuleRepository
                .findByInstituteIdAndTaxClassIdOrderByEffectiveFromAscMinUnitPriceAsc(instituteId, taxClassId)) {
            stored.put(rule.getId(), rule);
        }
        List<CommerceTaxRateRule> finished = new ArrayList<>();
        List<String> befores = new ArrayList<>();
        for (TaxRateRuleDTO dto : requested) {
            require(dto != null, "a rate rule is empty");
            String id = trimToNull(dto.getId());
            CommerceTaxRateRule rule;
            if (id != null) {
                rule = stored.remove(id);
                if (rule == null) {
                    throw new ResourceNotFoundException("Rate rule not found");
                }
                befores.add(CommerceInputRules.json(auditView(rule)));
            } else {
                rule = new CommerceTaxRateRule();
                rule.setInstituteId(instituteId);
                rule.setTaxClassId(taxClassId);
                befores.add(null);
            }
            require(dto.getRatePercent() != null, "rate_percent is required");
            require(dto.getEffectiveFrom() != null, "effective_from is required");
            rule.setMinUnitPrice(dto.getMinUnitPrice() == null ? BigDecimal.ZERO.setScale(2)
                    : amount(dto.getMinUnitPrice(), "min_unit_price"));
            rule.setMaxUnitPrice(dto.getMaxUnitPrice() == null ? null
                    : amount(dto.getMaxUnitPrice(), "max_unit_price"));
            rule.setRatePercent(percent(dto.getRatePercent(), "rate_percent"));
            rule.setCessPercent(dto.getCessPercent() == null ? BigDecimal.ZERO
                    : percent(dto.getCessPercent(), "cess_percent"));
            rule.setEffectiveFrom(dto.getEffectiveFrom());
            rule.setEffectiveTo(dto.getEffectiveTo());
            require(rule.getMaxUnitPrice() == null
                            || rule.getMaxUnitPrice().compareTo(rule.getMinUnitPrice()) >= 0,
                    "max_unit_price cannot be below min_unit_price");
            require(rule.getEffectiveTo() == null || !rule.getEffectiveTo().isBefore(rule.getEffectiveFrom()),
                    "effective_to cannot be before effective_from");
            finished.add(rule);
        }
        for (int i = 0; i < finished.size(); i++) {
            for (int j = i + 1; j < finished.size(); j++) {
                if (overlaps(finished.get(i), finished.get(j))) {
                    throw new ConflictException("TAX_RULE_OVERLAP: two rules of this tax class overlap"
                            + " (same dates and an overlapping price slab)");
                }
            }
        }
        // Removals first, so a re-cut slab never meets its old self in the table.
        for (CommerceTaxRateRule removed : stored.values()) {
            rateRuleRepository.delete(removed);
            auditService.record(instituteId, actorUserId, null, "TAX_RATE_RULE_DELETED", ENTITY_RULE,
                    removed.getId(), CommerceInputRules.json(auditView(removed)), null, null);
        }
        for (int i = 0; i < finished.size(); i++) {
            CommerceTaxRateRule saved = rateRuleRepository.save(finished.get(i));
            String after = CommerceInputRules.json(auditView(saved));
            if (!after.equals(befores.get(i))) {
                auditService.record(instituteId, actorUserId, null, "TAX_RATE_RULE_SAVED", ENTITY_RULE,
                        saved.getId(), befores.get(i), after, null);
            }
        }
    }

    private void applyFields(String instituteId, CommerceTaxClass taxClass, TaxClassDTO request) {
        if (request.getName() != null) {
            String name = trimToNull(request.getName());
            require(name != null && name.length() <= 255, "name must be 1 to 255 characters");
            taxClass.setName(name);
        }
        if (request.getHsnCode() != null) {
            String hsn = trimToNull(request.getHsnCode());
            require(hsn == null || HSN.matcher(hsn).matches(), "hsn_code must be 4 to 8 digits");
            taxClass.setHsnCode(hsn);
        }
        if (request.getUnit() != null) {
            String unit = trimToNull(request.getUnit());
            require(unit == null || unit.length() <= 32, "unit is longer than 32 characters");
            taxClass.setUnit(unit == null ? null : unit.toUpperCase(Locale.ROOT));
        }
        TaxClassStatus status = enumValue(TaxClassStatus.class, request.getStatus(), "status");
        if (status != null && !status.name().equals(taxClass.getStatus())) {
            if (status == TaxClassStatus.ARCHIVED && taxClass.getId() != null
                    && taxClassRepository.countActiveProductsUsing(instituteId, taxClass.getId()) > 0) {
                throw new ConflictException("The tax class is used by published products and cannot be archived");
            }
            taxClass.setStatus(status.name());
        }
    }

    // ------------------------------------------------------------------ writes: rules

    @Transactional
    public TaxClassDTO addRule(String instituteId, String actorUserId, String taxClassId, TaxRateRuleDTO request) {
        require(request != null, "request body is required");
        requireClass(instituteId, taxClassId);
        CommerceTaxRateRule rule = new CommerceTaxRateRule();
        rule.setInstituteId(instituteId);
        rule.setTaxClassId(taxClassId);
        rule.setMinUnitPrice(BigDecimal.ZERO.setScale(2));
        rule.setCessPercent(BigDecimal.ZERO);
        applyRule(rule, request, true);
        requireNoOverlap(instituteId, rule);
        rule = rateRuleRepository.save(rule);
        auditService.record(instituteId, actorUserId, null, "TAX_RATE_RULE_SAVED", ENTITY_RULE, rule.getId(),
                null, CommerceInputRules.json(auditView(rule)), null);
        return get(instituteId, taxClassId);
    }

    @Transactional
    public TaxClassDTO updateRule(String instituteId, String actorUserId, String taxClassId, String ruleId,
                                  TaxRateRuleDTO request) {
        require(request != null, "request body is required");
        requireClass(instituteId, taxClassId);
        CommerceTaxRateRule rule = requireRule(instituteId, taxClassId, ruleId);
        String before = CommerceInputRules.json(auditView(rule));
        applyRule(rule, request, false);
        requireNoOverlap(instituteId, rule);
        rule = rateRuleRepository.save(rule);
        auditService.record(instituteId, actorUserId, null, "TAX_RATE_RULE_SAVED", ENTITY_RULE, rule.getId(),
                before, CommerceInputRules.json(auditView(rule)), null);
        return get(instituteId, taxClassId);
    }

    /** Documents keep their own tax snapshot, so removing a rule never changes an issued document. */
    @Transactional
    public TaxClassDTO deleteRule(String instituteId, String actorUserId, String taxClassId, String ruleId) {
        requireClass(instituteId, taxClassId);
        CommerceTaxRateRule rule = requireRule(instituteId, taxClassId, ruleId);
        String before = CommerceInputRules.json(auditView(rule));
        rateRuleRepository.delete(rule);
        auditService.record(instituteId, actorUserId, null, "TAX_RATE_RULE_DELETED", ENTITY_RULE, ruleId,
                before, null, null);
        return get(instituteId, taxClassId);
    }

    /** In an update a null field keeps its value, so an open end cannot be re-opened: add a new rule instead. */
    private static void applyRule(CommerceTaxRateRule rule, TaxRateRuleDTO request, boolean creating) {
        if (request.getMinUnitPrice() != null) {
            rule.setMinUnitPrice(amount(request.getMinUnitPrice(), "min_unit_price"));
        }
        if (request.getMaxUnitPrice() != null) {
            rule.setMaxUnitPrice(amount(request.getMaxUnitPrice(), "max_unit_price"));
        }
        if (request.getRatePercent() != null) {
            rule.setRatePercent(percent(request.getRatePercent(), "rate_percent"));
        }
        if (request.getCessPercent() != null) {
            rule.setCessPercent(percent(request.getCessPercent(), "cess_percent"));
        }
        if (request.getEffectiveFrom() != null) {
            rule.setEffectiveFrom(request.getEffectiveFrom());
        }
        if (request.getEffectiveTo() != null) {
            rule.setEffectiveTo(request.getEffectiveTo());
        }
        if (creating) {
            require(rule.getRatePercent() != null, "rate_percent is required");
            require(rule.getEffectiveFrom() != null, "effective_from is required");
        }
        require(rule.getMaxUnitPrice() == null || rule.getMaxUnitPrice().compareTo(rule.getMinUnitPrice()) >= 0,
                "max_unit_price cannot be below min_unit_price");
        require(rule.getEffectiveTo() == null || !rule.getEffectiveTo().isBefore(rule.getEffectiveFrom()),
                "effective_to cannot be before effective_from");
    }

    /** Invariant: slabs in force on one date do not overlap. */
    private void requireNoOverlap(String instituteId, CommerceTaxRateRule candidate) {
        List<CommerceTaxRateRule> others = rateRuleRepository
                .findByInstituteIdAndTaxClassIdOrderByEffectiveFromAscMinUnitPriceAsc(instituteId,
                        candidate.getTaxClassId());
        for (CommerceTaxRateRule other : others) {
            if (other.getId() != null && other.getId().equals(candidate.getId())) {
                continue;
            }
            if (overlaps(candidate, other)) {
                throw new ConflictException("TAX_RULE_OVERLAP: the rule overlaps another rule of this tax class"
                        + " (same dates and an overlapping price slab)");
            }
        }
    }

    static boolean overlaps(CommerceTaxRateRule a, CommerceTaxRateRule b) {
        boolean dates = (a.getEffectiveTo() == null || !a.getEffectiveTo().isBefore(b.getEffectiveFrom()))
                && (b.getEffectiveTo() == null || !b.getEffectiveTo().isBefore(a.getEffectiveFrom()));
        boolean slabs = (a.getMaxUnitPrice() == null || a.getMaxUnitPrice().compareTo(b.getMinUnitPrice()) >= 0)
                && (b.getMaxUnitPrice() == null || b.getMaxUnitPrice().compareTo(a.getMinUnitPrice()) >= 0);
        return dates && slabs;
    }

    // ------------------------------------------------------------------ helpers

    private CommerceTaxClass requireClass(String instituteId, String taxClassId) {
        return taxClassRepository.findByInstituteIdAndId(instituteId, taxClassId)
                .orElseThrow(() -> new ResourceNotFoundException("Tax class not found"));
    }

    private CommerceTaxRateRule requireRule(String instituteId, String taxClassId, String ruleId) {
        CommerceTaxRateRule rule = rateRuleRepository.findByInstituteIdAndId(instituteId, ruleId)
                .orElseThrow(() -> new ResourceNotFoundException("Rate rule not found"));
        if (!taxClassId.equals(rule.getTaxClassId())) {
            throw new ResourceNotFoundException("Rate rule not found");
        }
        return rule;
    }

    private Map<String, List<CommerceTaxRateRule>> rulesByClass(String instituteId, List<String> classIds) {
        if (classIds.isEmpty()) {
            return Map.of();
        }
        return rateRuleRepository
                .findByInstituteIdAndTaxClassIdInOrderByEffectiveFromAscMinUnitPriceAsc(instituteId, classIds)
                .stream().collect(Collectors.groupingBy(CommerceTaxRateRule::getTaxClassId));
    }

    private static BigDecimal amount(BigDecimal value, String field) {
        require(value.signum() >= 0, field + " cannot be negative");
        require(value.stripTrailingZeros().scale() <= 2, field + " has more than two decimals");
        require(value.precision() - value.scale() <= 10, field + " is too large");
        return value.setScale(2, java.math.RoundingMode.UNNECESSARY);
    }

    private static BigDecimal percent(BigDecimal value, String field) {
        require(value.signum() >= 0 && value.compareTo(HUNDRED) <= 0, field + " must be between 0 and 100");
        require(value.stripTrailingZeros().scale() <= 3, field + " has more than three decimals");
        return value;
    }

    private static TaxRateRule toCalcRule(CommerceTaxRateRule rule) {
        return TaxRateRule.builder()
                .minUnitPrice(rule.getMinUnitPrice())
                .maxUnitPrice(rule.getMaxUnitPrice())
                .ratePercent(rule.getRatePercent())
                .cessPercent(rule.getCessPercent())
                .effectiveFrom(rule.getEffectiveFrom())
                .effectiveTo(rule.getEffectiveTo())
                .build();
    }

    private static TaxClassDTO toDto(CommerceTaxClass taxClass, List<CommerceTaxRateRule> rules) {
        List<TaxRateRuleDTO> ruleDtos = new ArrayList<>();
        for (CommerceTaxRateRule rule : rules) {
            ruleDtos.add(TaxRateRuleDTO.builder()
                    .id(rule.getId())
                    .minUnitPrice(rule.getMinUnitPrice())
                    .maxUnitPrice(rule.getMaxUnitPrice())
                    .ratePercent(rule.getRatePercent())
                    .cessPercent(rule.getCessPercent())
                    .effectiveFrom(rule.getEffectiveFrom())
                    .effectiveTo(rule.getEffectiveTo())
                    .build());
        }
        return TaxClassDTO.builder()
                .id(taxClass.getId())
                .code(taxClass.getCode())
                .name(taxClass.getName())
                .hsnCode(taxClass.getHsnCode())
                .unit(taxClass.getUnit())
                .status(taxClass.getStatus())
                .rules(ruleDtos)
                .build();
    }

    private static Map<String, Object> auditView(CommerceTaxClass taxClass) {
        Map<String, Object> view = new LinkedHashMap<>();
        view.put("code", taxClass.getCode());
        view.put("name", taxClass.getName());
        view.put("hsn_code", taxClass.getHsnCode());
        view.put("unit", taxClass.getUnit());
        view.put("status", taxClass.getStatus());
        return view;
    }

    private static Map<String, Object> auditView(CommerceTaxRateRule rule) {
        Map<String, Object> view = new LinkedHashMap<>();
        view.put("tax_class_id", rule.getTaxClassId());
        view.put("min_unit_price", String.valueOf(rule.getMinUnitPrice()));
        view.put("max_unit_price", rule.getMaxUnitPrice() == null ? null : String.valueOf(rule.getMaxUnitPrice()));
        view.put("rate_percent", String.valueOf(rule.getRatePercent()));
        view.put("cess_percent", String.valueOf(rule.getCessPercent()));
        view.put("effective_from", String.valueOf(rule.getEffectiveFrom()));
        view.put("effective_to", rule.getEffectiveTo() == null ? null : String.valueOf(rule.getEffectiveTo()));
        return view;
    }
}
