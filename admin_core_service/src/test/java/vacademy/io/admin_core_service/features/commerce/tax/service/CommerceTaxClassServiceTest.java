package vacademy.io.admin_core_service.features.commerce.tax.service;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.commerce.audit.CommerceAuditService;
import vacademy.io.admin_core_service.features.commerce.tax.dto.TaxRateRuleDTO;
import vacademy.io.admin_core_service.features.commerce.tax.dto.TaxSettingDTO;
import vacademy.io.admin_core_service.features.commerce.tax.entity.CommerceTaxClass;
import vacademy.io.admin_core_service.features.commerce.tax.entity.CommerceTaxRateRule;
import vacademy.io.admin_core_service.features.commerce.tax.entity.CommerceTaxSetting;
import vacademy.io.admin_core_service.features.commerce.tax.enums.TaxMode;
import vacademy.io.admin_core_service.features.commerce.tax.repository.CommerceTaxClassRepository;
import vacademy.io.admin_core_service.features.commerce.tax.repository.CommerceTaxRateRuleRepository;
import vacademy.io.admin_core_service.features.commerce.tax.repository.CommerceTaxSettingRepository;
import vacademy.io.common.exceptions.ConflictException;
import vacademy.io.common.exceptions.InvalidRequestException;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** Tax classes, rate rules, tax mode settings and the publish rule. Rates here are TEST placeholders. */
class CommerceTaxClassServiceTest {

    private static final String INST = "inst-1";
    private static final LocalDate APRIL = LocalDate.of(2026, 4, 1);
    private static final LocalDate TODAY = LocalDate.of(2026, 11, 14);

    private CommerceTaxClassRepository classes;
    private CommerceTaxRateRuleRepository rules;
    private CommerceTaxSettingRepository settings;
    private CommerceAuditService audit;
    private CommerceTaxSettingService settingService;
    private CommerceTaxClassService service;

    private final List<CommerceTaxRateRule> stored = new ArrayList<>();

    @BeforeEach
    void setUp() {
        classes = mock(CommerceTaxClassRepository.class);
        rules = mock(CommerceTaxRateRuleRepository.class);
        settings = mock(CommerceTaxSettingRepository.class);
        audit = mock(CommerceAuditService.class);
        settingService = new CommerceTaxSettingService(settings, classes, audit);
        service = new CommerceTaxClassService(classes, rules, settingService, audit);

        CommerceTaxClass taxClass = new CommerceTaxClass();
        taxClass.setId("tc-1");
        taxClass.setInstituteId(INST);
        taxClass.setCode("slabbed_test");
        taxClass.setName("Slabbed TEST");
        taxClass.setStatus("ACTIVE");
        when(classes.findByInstituteIdAndId(INST, "tc-1")).thenReturn(Optional.of(taxClass));
        when(classes.findByInstituteIdAndId(eq("another-institute"), anyString())).thenReturn(Optional.empty());
        when(rules.findByInstituteIdAndTaxClassIdOrderByEffectiveFromAscMinUnitPriceAsc(INST, "tc-1"))
                .thenAnswer(inv -> new ArrayList<>(stored));
        when(rules.save(any(CommerceTaxRateRule.class))).thenAnswer(inv -> {
            CommerceTaxRateRule rule = inv.getArgument(0);
            if (rule.getId() == null) {
                rule.setId("rule-" + (stored.size() + 1));
                stored.add(rule);
            }
            return rule;
        });
        when(settings.save(any(CommerceTaxSetting.class))).thenAnswer(inv -> {
            CommerceTaxSetting setting = inv.getArgument(0);
            setting.setId("setting-1");
            when(settings.findByInstituteId(INST)).thenReturn(Optional.of(setting));
            return setting;
        });
        when(settings.findByInstituteId(INST)).thenReturn(Optional.empty());
    }

    private static TaxRateRuleDTO rule(String min, String max, String rate, LocalDate from, LocalDate to) {
        return TaxRateRuleDTO.builder()
                .minUnitPrice(new BigDecimal(min)).maxUnitPrice(max == null ? null : new BigDecimal(max))
                .ratePercent(new BigDecimal(rate)).effectiveFrom(from).effectiveTo(to).build();
    }

    @Test
    void slabsInForceOnOneDateMayNotOverlap() {
        service.addRule(INST, "manager-1", "tc-1", rule("0", "1000.00", "5", APRIL, null));
        service.addRule(INST, "manager-1", "tc-1", rule("1000.01", null, "12", APRIL, null));
        assertEquals(2, stored.size());

        // A slab that shares the limit 1000.00 with the first one.
        ConflictException refused = assertThrows(ConflictException.class,
                () -> service.addRule(INST, "manager-1", "tc-1", rule("1000.00", "2000.00", "18", APRIL, null)));
        assertTrue(refused.getMessage().startsWith("TAX_RULE_OVERLAP"));
        assertEquals(2, stored.size());
    }

    @Test
    void theSameSlabMayHaveAnotherRateInAnotherSpanOfDates() {
        service.addRule(INST, "manager-1", "tc-1", rule("0", null, "12", APRIL, LocalDate.of(2026, 9, 30)));
        service.addRule(INST, "manager-1", "tc-1", rule("0", null, "5", LocalDate.of(2026, 10, 1), null));
        assertEquals(2, stored.size());

        assertThrows(ConflictException.class, () -> service.addRule(INST, "manager-1", "tc-1",
                rule("0", null, "18", LocalDate.of(2026, 9, 30), LocalDate.of(2026, 9, 30))));
    }

    @Test
    void aRuleNeedsARateAStartDateAndASaneSlab() {
        assertThrows(InvalidRequestException.class, () -> service.addRule(INST, "m", "tc-1",
                TaxRateRuleDTO.builder().effectiveFrom(APRIL).build()));
        assertThrows(InvalidRequestException.class, () -> service.addRule(INST, "m", "tc-1",
                TaxRateRuleDTO.builder().ratePercent(new BigDecimal("5")).build()));
        assertThrows(InvalidRequestException.class,
                () -> service.addRule(INST, "m", "tc-1", rule("500", "100", "5", APRIL, null)));
        assertThrows(InvalidRequestException.class,
                () -> service.addRule(INST, "m", "tc-1", rule("0", null, "101", APRIL, null)));
        assertThrows(InvalidRequestException.class,
                () -> service.addRule(INST, "m", "tc-1", rule("0", null, "5", APRIL, LocalDate.of(2026, 3, 31))));
        assertThrows(vacademy.io.common.exceptions.ResourceNotFoundException.class,
                () -> service.addRule("another-institute", "m", "tc-1", rule("0", null, "5", APRIL, null)));
        verify(rules, never()).save(any());
    }

    @Test
    void overlapIsAboutDatesAndSlabsTogether() {
        CommerceTaxRateRule a = entity("0", "1000.00", APRIL, null);
        assertTrue(CommerceTaxClassService.overlaps(a, entity("1000.00", null, APRIL, null)));
        assertFalse(CommerceTaxClassService.overlaps(a, entity("1000.01", null, APRIL, null)));
        assertFalse(CommerceTaxClassService.overlaps(entity("0", null, APRIL, LocalDate.of(2026, 9, 30)),
                entity("0", null, LocalDate.of(2026, 10, 1), null)));
        assertTrue(CommerceTaxClassService.overlaps(entity("0", null, APRIL, null),
                entity("5000", null, LocalDate.of(2030, 1, 1), null)));
    }

    private static CommerceTaxRateRule entity(String min, String max, LocalDate from, LocalDate to) {
        CommerceTaxRateRule rule = new CommerceTaxRateRule();
        rule.setMinUnitPrice(new BigDecimal(min));
        rule.setMaxUnitPrice(max == null ? null : new BigDecimal(max));
        rule.setEffectiveFrom(from);
        rule.setEffectiveTo(to);
        return rule;
    }

    // ------------------------------------------------------------------ publish rule

    @Test
    void publishingNeedsATaxClassWithARateOnlyInRegularMode() {
        // Nothing saved: UNREGISTERED by default, nothing is required.
        service.requireTaxClassForPublish(INST, null, TODAY);

        settingService.update(INST, "manager-1", TaxSettingDTO.builder().taxMode("REGULAR")
                .sellerGstin("27AAPFU0939F1ZV").build());
        assertEquals(TaxMode.REGULAR, settingService.context(INST).getMode());

        assertThrows(InvalidRequestException.class, () -> service.requireTaxClassForPublish(INST, null, TODAY));
        assertThrows(InvalidRequestException.class,
                () -> service.requireTaxClassForPublish(INST, "tc-of-another-institute", TODAY));
        assertThrows(InvalidRequestException.class, () -> service.requireTaxClassForPublish(INST, "tc-1", TODAY),
                "the class has no rate in force");

        service.addRule(INST, "manager-1", "tc-1", rule("0", null, "5", APRIL, null));
        service.requireTaxClassForPublish(INST, "tc-1", TODAY);
    }

    @Test
    void rulesSentWithTheTaxClassAreItsFullSetAndAreCheckedTogether() {
        when(rules.save(any(CommerceTaxRateRule.class))).thenAnswer(inv -> {
            CommerceTaxRateRule rule = inv.getArgument(0);
            if (rule.getId() == null) {
                rule.setId("rule-" + java.util.UUID.randomUUID());
                stored.add(rule);
            }
            return rule;
        });
        org.mockito.Mockito.doAnswer(inv -> stored.remove((CommerceTaxRateRule) inv.getArgument(0)))
                .when(rules).delete(any(CommerceTaxRateRule.class));
        when(classes.save(any(CommerceTaxClass.class))).thenAnswer(inv -> inv.getArgument(0));

        var request = vacademy.io.admin_core_service.features.commerce.tax.dto.TaxClassDTO.builder()
                .rules(List.of(rule("0", "1000.00", "5", APRIL, null), rule("1000.01", null, "12", APRIL, null)))
                .build();
        var saved = service.update(INST, "manager-1", "tc-1", request);
        assertEquals(2, saved.getRules().size());
        String lowId = stored.get(0).getId();

        // Re-cut both slabs in one save: the limit moves to 2500, the upper rule is replaced.
        TaxRateRuleDTO low = rule("0", "2500.00", "5", APRIL, null);
        low.setId(lowId);
        service.update(INST, "manager-1", "tc-1", vacademy.io.admin_core_service.features.commerce.tax.dto
                .TaxClassDTO.builder().rules(List.of(low, rule("2500.01", null, "18", APRIL, null))).build());
        assertEquals(2, stored.size());
        assertEquals(new BigDecimal("2500.00"), stored.get(0).getMaxUnitPrice());
        assertEquals(lowId, stored.get(0).getId());
        assertEquals(0, new BigDecimal("18").compareTo(stored.get(1).getRatePercent()));

        // An overlapping set is refused whole and nothing changes.
        ConflictException refused = assertThrows(ConflictException.class, () -> service.update(INST, "m", "tc-1",
                vacademy.io.admin_core_service.features.commerce.tax.dto.TaxClassDTO.builder()
                        .rules(List.of(rule("0", "100.00", "5", APRIL, null), rule("100.00", null, "12", APRIL, null)))
                        .build()));
        assertTrue(refused.getMessage().startsWith("TAX_RULE_OVERLAP"));
        assertEquals(2, stored.size());

        // A rule id of another class is not found; rules absent leaves the set alone.
        TaxRateRuleDTO foreign = rule("0", null, "5", APRIL, null);
        foreign.setId("rule-of-another-class");
        assertThrows(vacademy.io.common.exceptions.ResourceNotFoundException.class, () -> service.update(INST, "m",
                "tc-1", vacademy.io.admin_core_service.features.commerce.tax.dto.TaxClassDTO.builder()
                        .rules(List.of(foreign)).build()));
        service.update(INST, "m", "tc-1",
                vacademy.io.admin_core_service.features.commerce.tax.dto.TaxClassDTO.builder().name("Renamed").build());
        assertEquals(2, stored.size());
    }

    // ------------------------------------------------------------------ tax mode settings

    @Test
    void regularModeNeedsAValidGstinAndTakesTheStateFromIt() {
        assertFalse(settingService.get(INST).getConfigured());
        // Nothing saved: no field is shown as chosen, and the code works as UNREGISTERED.
        assertEquals(null, settingService.get(INST).getTaxMode());
        assertEquals(TaxMode.UNREGISTERED, settingService.context(INST).getMode());

        assertThrows(InvalidRequestException.class, () -> settingService.update(INST, "m",
                TaxSettingDTO.builder().taxMode("REGULAR").build()));
        assertThrows(InvalidRequestException.class, () -> settingService.update(INST, "m",
                TaxSettingDTO.builder().taxMode("REGULAR").sellerGstin("27AAPFU0939F1ZX").build()));
        assertThrows(InvalidRequestException.class, () -> settingService.update(INST, "m",
                TaxSettingDTO.builder().taxMode("REGULAR").sellerGstin("27AAPFU0939F1ZV").sellerStateCode("09")
                        .build()));

        TaxSettingDTO saved = settingService.update(INST, "m", TaxSettingDTO.builder().taxMode("regular")
                .sellerGstin("27aapfu0939f1zv").roundTotalTo("RUPEE").build());
        assertTrue(saved.getConfigured());
        assertEquals("REGULAR", saved.getTaxMode());
        assertEquals("27", saved.getSellerStateCode());
        assertEquals("RUPEE", saved.getRoundTotalTo());
        assertEquals("NET_UNIT_PRICE", saved.getSlabBasis());
        assertEquals("PACKED", saved.getInvoiceAt());
        assertEquals(4, saved.getFyStartMonth().intValue());
        verify(audit).record(eq(INST), eq("m"), any(), eq("TAX_SETTING_CHANGED"), eq("TAX_SETTING"), any(),
                anyString(), anyString(), any());
    }

    @Test
    void switchingToRegularIsRefusedWhilePublishedProductsHaveNoTaxClass() {
        when(classes.countActiveProductsWithoutTaxClass(INST)).thenReturn(3L);

        ConflictException refused = assertThrows(ConflictException.class, () -> settingService.update(INST, "m",
                TaxSettingDTO.builder().taxMode("REGULAR").sellerGstin("27AAPFU0939F1ZV").build()));

        assertTrue(refused.getMessage().startsWith("TAX_CLASS_MISSING"));
        verify(settings, never()).save(any());

        // The other modes ask for nothing.
        assertEquals("COMPOSITION",
                settingService.update(INST, "m", TaxSettingDTO.builder().taxMode("COMPOSITION").build()).getTaxMode());
    }
}
