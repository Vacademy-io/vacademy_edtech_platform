package vacademy.io.admin_core_service.features.fee_management.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import lombok.extern.slf4j.Slf4j;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.fee_management.dto.FlexibleScheduleDefaultsDTO;
import vacademy.io.admin_core_service.features.fee_management.entity.ComplexPaymentOption;
import vacademy.io.admin_core_service.features.fee_management.enums.InstallmentIntervalUnit;
import vacademy.io.common.exceptions.VacademyException;

/**
 * Reads and writes a FLEXIBLE fee plan's defaults in {@code metadata_json.flexible_defaults},
 * leaving any other keys in the metadata untouched.
 */
@Slf4j
public final class CpoFlexibleDefaults {

    static final String KEY = "flexible_defaults";
    private static final ObjectMapper MAPPER = new ObjectMapper();

    private CpoFlexibleDefaults() {
    }

    /** The plan's defaults, or null when none are stored or the metadata is unreadable. */
    public static FlexibleScheduleDefaultsDTO read(ComplexPaymentOption cpo) {
        if (cpo == null || !StringUtils.hasText(cpo.getMetadataJson())) return null;
        try {
            var node = MAPPER.readTree(cpo.getMetadataJson()).get(KEY);
            return node != null && node.isObject() ? MAPPER.treeToValue(node, FlexibleScheduleDefaultsDTO.class) : null;
        } catch (Exception e) {
            log.warn("Unreadable metadata_json on fee plan {}: {}", cpo.getId(), e.getMessage());
            return null;
        }
    }

    /** Validates and stores the defaults on the entity (not saved). Null removes them. */
    public static void write(ComplexPaymentOption cpo, FlexibleScheduleDefaultsDTO defaults) {
        if (defaults != null) validate(defaults);
        try {
            ObjectNode root = StringUtils.hasText(cpo.getMetadataJson())
                    && MAPPER.readTree(cpo.getMetadataJson()) instanceof ObjectNode existing
                    ? existing
                    : MAPPER.createObjectNode();
            if (defaults == null) {
                root.remove(KEY);
            } else {
                root.set(KEY, MAPPER.valueToTree(defaults));
            }
            cpo.setMetadataJson(MAPPER.writeValueAsString(root));
        } catch (VacademyException e) {
            throw e;
        } catch (Exception e) {
            throw new VacademyException("Could not save the plan's installment defaults: " + e.getMessage());
        }
    }

    static void validate(FlexibleScheduleDefaultsDTO d) {
        int limit = InstallmentScheduleService.MAX_INSTALLMENTS;
        if (d.getMaxCount() != null && (d.getMaxCount() < 1 || d.getMaxCount() > limit)) {
            throw new VacademyException("Maximum installments must be between 1 and " + limit);
        }
        int max = d.getMaxCount() != null ? d.getMaxCount() : limit;
        if (d.getCount() != null && (d.getCount() < 1 || d.getCount() > max)) {
            throw new VacademyException("Default installments must be between 1 and " + max);
        }
        if (d.getInterval() != null) {
            try {
                InstallmentIntervalUnit.valueOf(d.getInterval().getUnit() == null ? ""
                        : d.getInterval().getUnit().trim().toUpperCase());
            } catch (IllegalArgumentException e) {
                throw new VacademyException("Default gap must be in DAYS or MONTHS");
            }
            boolean days = InstallmentIntervalUnit.DAYS.name().equalsIgnoreCase(d.getInterval().getUnit().trim());
            int maxGap = days ? InstallmentScheduleService.MAX_INTERVAL_DAYS : InstallmentScheduleService.MAX_INTERVAL_MONTHS;
            if (d.getInterval().getValue() == null || d.getInterval().getValue() < 1
                    || d.getInterval().getValue() > maxGap) {
                throw new VacademyException("Default gap must be between 1 and " + maxGap
                        + (days ? " days" : " months"));
            }
        }
    }
}
