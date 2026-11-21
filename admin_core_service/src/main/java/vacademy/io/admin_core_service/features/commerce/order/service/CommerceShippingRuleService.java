package vacademy.io.admin_core_service.features.commerce.order.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.admin_core_service.features.commerce.audit.CommerceAuditService;
import vacademy.io.admin_core_service.features.commerce.order.dto.ShippingRuleDTO;
import vacademy.io.admin_core_service.features.commerce.order.entity.CommerceShippingRule;
import vacademy.io.admin_core_service.features.commerce.order.repository.CommerceShippingRuleRepository;
import vacademy.io.admin_core_service.features.commerce.order.shipping.CommerceShippingCalculator;
import vacademy.io.admin_core_service.features.commerce.tax.enums.TaxMode;
import vacademy.io.admin_core_service.features.commerce.tax.service.CommerceTaxClassService;
import vacademy.io.admin_core_service.features.commerce.tax.service.CommerceTaxSettingService;
import vacademy.io.common.exceptions.InvalidRequestException;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * Reads and saves the institute's shipping rule. A save archives the live row and inserts a
 * new one, so a rule an order was priced with is never rewritten.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class CommerceShippingRuleService {

    static final String ACTIVE = "ACTIVE";

    private final CommerceShippingRuleRepository ruleRepository;
    private final CommerceTaxClassService taxClassService;
    private final CommerceTaxSettingService taxSettingService;
    private final CommerceAuditService auditService;
    private final ObjectMapper objectMapper;

    /** The live rule as the calculator reads it; null when the seller has saved none. */
    @Transactional(readOnly = true)
    public CommerceShippingCalculator.Rule activeRule(String instituteId) {
        return ruleRepository.findFirstByInstituteIdAndStatusOrderByCreatedAtDesc(instituteId, ACTIVE)
                .map(CommerceShippingRuleService::toRule)
                .orElse(null);
    }

    /** The live rule for the settings screen; an empty object when none was saved. */
    @Transactional(readOnly = true)
    public ShippingRuleDTO get(String instituteId) {
        return ruleRepository.findFirstByInstituteIdAndStatusOrderByCreatedAtDesc(instituteId, ACTIVE)
                .map(CommerceShippingRuleService::toDto)
                .orElseGet(() -> ShippingRuleDTO.builder().build());
    }

    @Transactional
    public ShippingRuleDTO save(String instituteId, String actorUserId, ShippingRuleDTO request) {
        if (request == null) {
            throw new InvalidRequestException("a shipping rule is required");
        }
        CommerceShippingCalculator.Basis basis = basis(request.getBasis());
        List<CommerceShippingCalculator.Tier> tiers;
        try {
            tiers = CommerceShippingCalculator.parseTiers(basis, request.getTiers());
        } catch (IllegalArgumentException e) {
            throw new InvalidRequestException(e.getMessage());
        }
        BigDecimal freeAbove = amount(request.getFreeAbove(), "free_above");
        BigDecimal codCharge = amount(request.getCodCharge(), "cod_charge");
        String taxClassId = request.getTaxClassId() == null || request.getTaxClassId().isBlank()
                ? null : request.getTaxClassId().trim();
        taxClassService.requireUsableTaxClass(instituteId, taxClassId);
        boolean charges = (codCharge != null && codCharge.signum() > 0)
                || tiers.stream().anyMatch(t -> t.charge().signum() > 0);
        if (charges && taxClassId == null && taxSettingService.context(instituteId).getMode() == TaxMode.REGULAR) {
            // In REGULAR mode every charged line needs a tax class, or no cart with delivery can be priced.
            throw new InvalidRequestException(
                    "tax_class_id is required: a delivery or COD charge is taxed and needs a tax class");
        }

        ruleRepository.archiveActive(instituteId);
        CommerceShippingRule rule = new CommerceShippingRule();
        rule.setInstituteId(instituteId);
        rule.setBasis(basis.name());
        List<Map<String, Object>> stored = new ArrayList<>();
        for (CommerceShippingCalculator.Tier tier : tiers) {
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("up_to", tier.upTo());
            row.put("charge", tier.charge());
            stored.add(row);
        }
        rule.setTiersJson(stored);
        rule.setFreeAbove(freeAbove);
        rule.setCodCharge(codCharge == null ? BigDecimal.ZERO.setScale(2) : codCharge);
        rule.setTaxClassId(taxClassId);
        rule.setStatus(ACTIVE);
        rule.setCreatedBy(actorUserId);
        CommerceShippingRule saved = ruleRepository.save(rule);
        ShippingRuleDTO dto = toDto(saved);
        auditService.record(instituteId, actorUserId, "SHIPPING_RULE_SAVED", "SHIPPING_RULE", saved.getId(),
                json(dto));
        return dto;
    }

    private static CommerceShippingCalculator.Basis basis(String raw) {
        try {
            return CommerceShippingCalculator.Basis.valueOf(raw == null ? "" : raw.trim().toUpperCase(Locale.ROOT));
        } catch (IllegalArgumentException e) {
            throw new InvalidRequestException("basis must be FLAT, ORDER_VALUE or WEIGHT");
        }
    }

    private static BigDecimal amount(BigDecimal value, String field) {
        if (value == null) {
            return null;
        }
        if (value.signum() < 0 || value.stripTrailingZeros().scale() > 2
                || value.compareTo(new BigDecimal("9999999999.99")) > 0) {
            throw new InvalidRequestException(field + " must be an amount of zero or more with at most two decimals");
        }
        return value.setScale(2, RoundingMode.UNNECESSARY);
    }

    static CommerceShippingCalculator.Rule toRule(CommerceShippingRule rule) {
        CommerceShippingCalculator.Basis basis = CommerceShippingCalculator.Basis.valueOf(rule.getBasis());
        return new CommerceShippingCalculator.Rule(rule.getId(), basis,
                CommerceShippingCalculator.parseTiers(basis, rule.getTiersJson()), rule.getFreeAbove(),
                rule.getCodCharge() == null ? BigDecimal.ZERO.setScale(2) : rule.getCodCharge(),
                rule.getTaxClassId());
    }

    private static ShippingRuleDTO toDto(CommerceShippingRule rule) {
        return ShippingRuleDTO.builder()
                .id(rule.getId())
                .basis(rule.getBasis())
                .tiers(rule.getTiersJson())
                .freeAbove(rule.getFreeAbove())
                .codCharge(rule.getCodCharge())
                .taxClassId(rule.getTaxClassId())
                .status(rule.getStatus())
                .build();
    }

    private String json(Object value) {
        try {
            return objectMapper.writeValueAsString(value);
        } catch (Exception e) {
            return null;
        }
    }
}
