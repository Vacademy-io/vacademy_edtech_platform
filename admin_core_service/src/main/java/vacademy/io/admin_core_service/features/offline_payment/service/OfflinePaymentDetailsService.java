package vacademy.io.admin_core_service.features.offline_payment.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.offline_payment.dto.OfflinePaymentDetailsDTO;
import vacademy.io.admin_core_service.features.offline_payment.dto.OfflinePaymentModesDTO;
import vacademy.io.admin_core_service.features.user_subscription.entity.PaymentLog;
import vacademy.io.admin_core_service.features.user_subscription.repository.PaymentLogRepository;
import vacademy.io.common.exceptions.VacademyException;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * Validates and stores how an admin says an offline payment was made (mode, sub-option,
 * reference, extras). Every admin record-payment path calls {@link #resolve} before it creates
 * the PaymentLog — so a bad request leaves nothing behind — and {@link #apply} right after.
 * See docs/OFFLINE_PAYMENT_RECORDING.md §5.
 */
@Service
@Slf4j
@RequiredArgsConstructor
public class OfflinePaymentDetailsService {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    /** How the built-in extras are named in error messages. */
    private static final Map<String, String> EXTRA_LABELS =
            Map.of("cheque_date", "cheque date", "bank_name", "bank", "payer_name", "payer name");

    private final OfflinePaymentModeService modeService;
    private final PaymentLogRepository paymentLogRepository;

    /** Field-injected so the constructor (and its tests) stay as they are; null in unit tests. */
    @org.springframework.beans.factory.annotation.Autowired
    private vacademy.io.admin_core_service.features.invoice.service.NumberingFieldService numberingFieldService;

    /** Validates the numbering-series value of a payment (throws when it is not a choice). */
    public void validateNumberingValue(String instituteId, OfflinePaymentDetailsDTO details) {
        if (numberingFieldService != null && details != null) {
            numberingFieldService.validate(instituteId, details.getNumberingValue());
        }
    }

    /**
     * Pins the numbering-series value picked with a payment on its enrolment (first payment
     * only; an enrolment that already has one keeps it). Call before writing the payment.
     */
    public void pinNumberingValue(String instituteId, String userPlanId, String userId,
                                  OfflinePaymentDetailsDTO details) {
        if (numberingFieldService != null && details != null) {
            numberingFieldService.pin(instituteId, userPlanId, userId, details.getNumberingValue());
        }
    }

    /** Validated details with the labels in force when the payment was recorded. */
    public record Resolved(String mode, String modeLabel, String subMode, String subModeLabel,
                           String reference, LocalDate paymentDate, String notes, String proofFileId,
                           Map<String, String> extra, List<CustomValue> custom) {

        /** "UPI · PhonePe", "Cash", or null when no mode was given. */
        public String describe() {
            if (modeLabel == null) return null;
            return subModeLabel != null ? modeLabel + " · " + subModeLabel : modeLabel;
        }
    }

    /** A custom field's value with the field's label as it was when the payment was recorded. */
    public record CustomValue(String key, String label, String value) {
    }

    /**
     * Checks the details against the institute's modes. {@code legacyReference} is the
     * free-text reference older request fields carry (transaction id, payment reference); it is
     * used when the details give none. Returns null when there is nothing to record.
     */
    public Resolved resolve(String instituteId, OfflinePaymentDetailsDTO details, String legacyReference) {
        return resolve(instituteId, details, legacyReference, true);
    }

    /**
     * As {@link #resolve(String, OfflinePaymentDetailsDTO, String)}; with
     * {@code enforceRequireMode = false} a missing mode is accepted even when the institute
     * requires one — for paths whose request cannot carry a mode (a payment date from a CSV
     * column). A mode that IS given is still validated in full.
     */
    public Resolved resolve(String instituteId, OfflinePaymentDetailsDTO details, String legacyReference,
                            boolean enforceRequireMode) {
        OfflinePaymentModesDTO modes = modeService.getEffective(instituteId);
        String modeCode = details != null && StringUtils.hasText(details.getMode())
                ? details.getMode().trim().toUpperCase(Locale.ROOT) : null;
        String reference = details != null && StringUtils.hasText(details.getReference())
                ? details.getReference().trim()
                : StringUtils.hasText(legacyReference) ? legacyReference.trim() : null;
        if (reference != null && reference.length() > 255) {
            throw new VacademyException("The payment reference is longer than 255 characters");
        }

        if (modeCode == null) {
            if (modes.isRequireMode() && enforceRequireMode) {
                throw new VacademyException("Choose how the payment was made");
            }
            if (details != null && StringUtils.hasText(details.getSubMode())) {
                throw new VacademyException("Choose the payment mode for the selected option");
            }
            if (reference == null && (details == null || isEmpty(details))) {
                return null;
            }
            return new Resolved(null, null, null, null, reference,
                    details != null ? details.getPaymentDate() : null,
                    details != null ? trim(details.getNotes(), 1000) : null,
                    details != null ? trim(details.getProofFileId(), 255) : null,
                    Map.of(), List.of());
        }

        OfflinePaymentModesDTO.Mode mode = modes.getModes().stream()
                .filter(m -> m.getCode().equalsIgnoreCase(modeCode))
                .findFirst()
                .orElseThrow(() -> new VacademyException("Unknown payment mode: " + modeCode));
        if (!mode.isActive()) {
            throw new VacademyException(mode.getLabel() + " is switched off in Payment Settings");
        }

        String subCode = StringUtils.hasText(details.getSubMode())
                ? details.getSubMode().trim().toUpperCase(Locale.ROOT) : null;
        String subLabel = null;
        if (subCode != null) {
            OfflinePaymentModesDTO.SubMode sub = mode.getSubModes().stream()
                    .filter(s -> s.getCode().equalsIgnoreCase(subCode))
                    .findFirst()
                    .orElseThrow(() -> new VacademyException("Unknown option under " + mode.getLabel() + ": " + subCode));
            if (!sub.isActive()) {
                throw new VacademyException(sub.getLabel() + " is switched off in Payment Settings");
            }
            subLabel = sub.getLabel();
        } else if (mode.isSubModeRequired()
                && mode.getSubModes().stream().anyMatch(OfflinePaymentModesDTO.SubMode::isActive)) {
            throw new VacademyException("Choose the " + (StringUtils.hasText(mode.getSubModeLabel())
                    ? mode.getSubModeLabel() : "option") + " for " + mode.getLabel());
        }
        if (mode.isReferenceRequired() && reference == null) {
            throw new VacademyException("Enter the " + (mode.getReferenceLabel() != null
                    ? mode.getReferenceLabel() : "reference") + " for " + mode.getLabel());
        }
        if (mode.isProofRequired() && !StringUtils.hasText(details.getProofFileId())) {
            throw new VacademyException("Attach proof of payment for " + mode.getLabel());
        }

        // Keep only the extras this mode asks for.
        Map<String, String> extra = new LinkedHashMap<>();
        if (details.getExtra() != null) {
            for (String key : mode.getExtraFields()) {
                String v = details.getExtra().get(key);
                if (StringUtils.hasText(v)) extra.put(key, trim(v, 255));
            }
        }
        for (String key : mode.getRequiredExtraFields() == null ? List.<String>of() : mode.getRequiredExtraFields()) {
            if (mode.getExtraFields().contains(key) && !extra.containsKey(key)) {
                throw new VacademyException("Enter the " + EXTRA_LABELS.getOrDefault(key, key) + " for " + mode.getLabel());
            }
        }
        List<CustomValue> custom = resolveCustom(mode, details.getCustom());
        return new Resolved(mode.getCode(), mode.getLabel(), subCode, subLabel, reference,
                details.getPaymentDate(), trim(details.getNotes(), 1000), trim(details.getProofFileId(), 255),
                extra, custom);
    }

    /** The mode's active custom fields, checked for required, date, number and dropdown values. */
    private static List<CustomValue> resolveCustom(OfflinePaymentModesDTO.Mode mode, Map<String, String> given) {
        List<CustomValue> out = new ArrayList<>();
        if (mode.getCustomFields() == null) return out;
        for (OfflinePaymentModesDTO.CustomField f : mode.getCustomFields()) {
            if (f == null || !f.isActive()) continue;
            String raw = given != null ? given.get(f.getKey()) : null;
            String v = StringUtils.hasText(raw) ? raw.trim() : null;
            if (v == null) {
                if (f.isRequired()) {
                    throw new VacademyException("Enter " + f.getLabel() + " for " + mode.getLabel());
                }
                continue;
            }
            String type = f.getType() == null ? "TEXT" : f.getType();
            switch (type) {
                case "DATE" -> {
                    try {
                        LocalDate.parse(v);
                    } catch (DateTimeParseException e) {
                        throw new VacademyException(f.getLabel() + " must be a date (YYYY-MM-DD)");
                    }
                }
                case "NUMBER" -> {
                    try {
                        new BigDecimal(v);
                    } catch (NumberFormatException e) {
                        throw new VacademyException(f.getLabel() + " must be a number");
                    }
                }
                case "SELECT" -> {
                    String value = v;
                    v = (f.getOptions() == null ? List.<String>of() : f.getOptions()).stream()
                            .filter(o -> o.equalsIgnoreCase(value))
                            .findFirst()
                            .orElseThrow(() -> new VacademyException(
                                    "\"" + value + "\" is not a choice for " + f.getLabel()));
                }
                default -> {
                }
            }
            out.add(new CustomValue(f.getKey(), f.getLabel(), trim(v, 255)));
        }
        return out;
    }

    /** Writes the resolved details onto the PaymentLog. A null {@code resolved} only stamps who recorded it. */
    public void apply(String paymentLogId, Resolved resolved, String recordedByUserId) {
        PaymentLog log = paymentLogRepository.findById(paymentLogId)
                .orElseThrow(() -> new VacademyException("Payment not found: " + paymentLogId));
        log.setRecordedByUserId(recordedByUserId);
        if (resolved != null) {
            log.setPaymentMode(resolved.mode());
            log.setPaymentSubMode(resolved.subMode());
            log.setPaymentReference(resolved.reference());
            ObjectNode json = MAPPER.createObjectNode();
            putIfText(json, "mode_label", resolved.modeLabel());
            putIfText(json, "sub_mode_label", resolved.subModeLabel());
            putIfText(json, "notes", resolved.notes());
            putIfText(json, "proof_file_id", resolved.proofFileId());
            resolved.extra().forEach((k, v) -> putIfText(json, k, v));
            if (!resolved.custom().isEmpty()) {
                // Nested so an institute's field key can never shadow mode_label, notes ...
                ArrayNode custom = json.putArray("custom_fields");
                resolved.custom().forEach(c -> custom.addObject()
                        .put("key", c.key()).put("label", c.label()).put("value", c.value()));
            }
            log.setPaymentDetailsJson(json.isEmpty() ? null : json.toString());
            log.setPaymentSpecificData(withTransactionId(log.getPaymentSpecificData(), resolved.reference()));
        }
        paymentLogRepository.save(log);
    }

    /** Older readers look for the reference at payment_specific_data.transaction_id. */
    private static String withTransactionId(String paymentSpecificData, String reference) {
        if (!StringUtils.hasText(reference)) return paymentSpecificData;
        try {
            ObjectNode root = StringUtils.hasText(paymentSpecificData)
                    && MAPPER.readTree(paymentSpecificData) instanceof ObjectNode existing
                    ? existing : MAPPER.createObjectNode();
            if (!root.hasNonNull("transaction_id")) {
                root.put("transaction_id", reference);
            }
            return root.toString();
        } catch (Exception e) {
            return paymentSpecificData;
        }
    }

    private static boolean isEmpty(OfflinePaymentDetailsDTO d) {
        return !StringUtils.hasText(d.getNotes()) && !StringUtils.hasText(d.getProofFileId())
                && d.getPaymentDate() == null && (d.getExtra() == null || d.getExtra().isEmpty())
                && (d.getCustom() == null || d.getCustom().isEmpty());
    }

    private static void putIfText(ObjectNode json, String key, String value) {
        if (StringUtils.hasText(value)) json.put(key, value);
    }

    private static String trim(String value, int max) {
        if (!StringUtils.hasText(value)) return null;
        String v = value.trim();
        return v.length() > max ? v.substring(0, max) : v;
    }
}
