package vacademy.io.admin_core_service.features.commerce.stock.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import vacademy.io.admin_core_service.features.institute.service.setting.InstituteSettingService;

import java.math.BigDecimal;

/**
 * The commerce settings the stock code reads, from the institute setting {@code COMMERCE_SETTING}:
 * <pre>
 * { "holdMinutes": 15,
 *   "defaultFulfilmentLocationId": "...",
 *   "limits": { "adjustmentQuantity": 20, "adjustmentValue": 5000 } }
 * </pre>
 * These are {@code commerce.holdMinutes}, {@code commerce.defaultFulfilmentLocationId} and
 * {@code commerce.limits.*} of the design. When one of the two limits is set, the other one
 * that is not set means "no limit" of that kind. When neither is set, or a limit cannot be
 * read, both are zero, so every adjustment by a non-manager needs a manager: a missing or
 * broken setting must not switch the approval off.
 */
@Slf4j
@Component
public class CommerceStockSettings {

    public static final String SETTING_KEY = "COMMERCE_SETTING";
    public static final int DEFAULT_HOLD_MINUTES = 15;
    private static final int MAX_HOLD_MINUTES = 24 * 60;

    private final InstituteSettingService instituteSettingService;
    private final ObjectMapper objectMapper;

    public CommerceStockSettings(InstituteSettingService instituteSettingService, ObjectMapper objectMapper) {
        this.instituteSettingService = instituteSettingService;
        this.objectMapper = objectMapper;
    }

    /** The two limits on a single stock adjustment; null means no limit of that kind. */
    public record AdjustmentLimits(Integer quantity, BigDecimal value) {
    }

    public AdjustmentLimits adjustmentLimits(String instituteId) {
        JsonNode limits;
        try {
            limits = read(instituteId).path("limits");
        } catch (RuntimeException e) {
            log.warn("Could not read commerce limits of institute {}; every adjustment needs a manager: {}",
                    instituteId, e.getMessage());
            return new AdjustmentLimits(0, BigDecimal.ZERO);
        }
        Integer quantity;
        BigDecimal value;
        try {
            quantity = number(limits.path("adjustmentQuantity")) == null ? null
                    : number(limits.path("adjustmentQuantity")).intValue();
            value = number(limits.path("adjustmentValue"));
        } catch (RuntimeException e) {
            log.warn("Commerce limits of institute {} are not numbers; every adjustment needs a manager: {}",
                    instituteId, e.getMessage());
            return new AdjustmentLimits(0, BigDecimal.ZERO);
        }
        if (quantity == null && value == null) {
            // Nothing configured is not "no limit": until the institute sets its limits, every
            // adjustment by someone who is not a manager needs a manager's approval.
            return new AdjustmentLimits(0, BigDecimal.ZERO);
        }
        return new AdjustmentLimits(quantity, value);
    }

    /** {@code commerce.holdMinutes}; 15 when it is not set, cannot be read or is out of range. */
    public int holdMinutes(String instituteId) {
        try {
            BigDecimal minutes = number(read(instituteId).path("holdMinutes"));
            if (minutes != null && minutes.intValue() >= 1 && minutes.intValue() <= MAX_HOLD_MINUTES) {
                return minutes.intValue();
            }
        } catch (RuntimeException e) {
            log.warn("Could not read commerce.holdMinutes of institute {}: {}", instituteId, e.getMessage());
        }
        return DEFAULT_HOLD_MINUTES;
    }

    /** {@code commerce.defaultFulfilmentLocationId}, or null. */
    public String defaultFulfilmentLocationId(String instituteId) {
        try {
            JsonNode node = read(instituteId).path("defaultFulfilmentLocationId");
            return node.isTextual() && !node.asText().isBlank() ? node.asText().trim() : null;
        } catch (RuntimeException e) {
            log.warn("Could not read commerce.defaultFulfilmentLocationId of institute {}: {}", instituteId,
                    e.getMessage());
            return null;
        }
    }

    private JsonNode read(String instituteId) {
        Object data = instituteSettingService.getSettingByInstituteIdAndKey(instituteId, SETTING_KEY);
        return data == null ? objectMapper.createObjectNode() : objectMapper.valueToTree(data);
    }

    /** A number, or a string holding one (settings are hand-edited JSON in places). */
    private static BigDecimal number(JsonNode node) {
        if (node == null || node.isMissingNode() || node.isNull()) {
            return null;
        }
        if (node.isNumber()) {
            return node.decimalValue();
        }
        if (node.isTextual() && !node.asText().isBlank()) {
            return new BigDecimal(node.asText().trim());
        }
        throw new IllegalArgumentException("a commerce setting is not a number");
    }
}
