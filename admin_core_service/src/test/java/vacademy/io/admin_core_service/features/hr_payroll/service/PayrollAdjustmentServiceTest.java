package vacademy.io.admin_core_service.features.hr_payroll.service;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;

/**
 * Unit tests for the static, package-private
 * {@link PayrollAdjustmentService#sanitizeCode} normalizer that turns
 * free-text adjustment labels into stable component codes.
 */
@DisplayName("PayrollAdjustmentService.sanitizeCode")
class PayrollAdjustmentServiceTest {

    @Test
    @DisplayName("'Diwali Bonus!' normalizes to DIWALI_BONUS (uppercased, punctuation collapsed, edges trimmed)")
    void normalizesLabelToCode() {
        assertEquals("DIWALI_BONUS", PayrollAdjustmentService.sanitizeCode("Diwali Bonus!"));
    }

    @Test
    @DisplayName("blank input falls back to ADJUSTMENT")
    void blankFallsBackToAdjustment() {
        assertEquals("ADJUSTMENT", PayrollAdjustmentService.sanitizeCode("   "));
    }

    @Test
    @DisplayName("input that sanitizes to nothing (only punctuation) also falls back to ADJUSTMENT")
    void punctuationOnlyFallsBackToAdjustment() {
        assertEquals("ADJUSTMENT", PayrollAdjustmentService.sanitizeCode("!!!"));
    }

    @Test
    @DisplayName("codes longer than 30 characters are truncated to exactly 30")
    void truncatesToThirtyCharacters() {
        String fortyAs = "A".repeat(40);
        String sanitized = PayrollAdjustmentService.sanitizeCode(fortyAs);
        assertEquals(30, sanitized.length());
        assertEquals("A".repeat(30), sanitized);
    }

    @Test
    @DisplayName("a mixed long label keeps only its first 30 sanitized characters")
    void truncatesMixedLongLabel() {
        // Sanitized form is PERFORMANCE_BONUS_FOR_QUARTER_FOUR_2026 (39 chars);
        // truncation happens after edge-trimming, so the 30-char prefix survives
        // even though it happens to end in an underscore.
        assertEquals("PERFORMANCE_BONUS_FOR_QUARTER_",
                PayrollAdjustmentService.sanitizeCode("Performance Bonus for Quarter Four 2026"));
    }
}
