package vacademy.io.admin_core_service.features.offline_payment.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.offline_payment.dto.OfflinePaymentModesDTO;
import vacademy.io.admin_core_service.features.offline_payment.entity.InstituteOfflinePaymentSetting;
import vacademy.io.admin_core_service.features.offline_payment.repository.InstituteOfflinePaymentSettingRepository;
import vacademy.io.common.exceptions.VacademyException;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * The offline payment modes (and their sub-options) an institute offers when an admin records
 * a payment. Stored per institute in {@code institute_offline_payment_setting}; an institute
 * that never saved its own gets {@link #systemDefaults()}. See docs/OFFLINE_PAYMENT_RECORDING.md.
 */
@Service
@Slf4j
@RequiredArgsConstructor
public class OfflinePaymentModeService {

    /** Extra inputs a mode can ask for. */
    public static final Set<String> EXTRA_FIELDS = Set.of("cheque_date", "bank_name", "payer_name");

    /** Types a custom field can have. */
    public static final Set<String> CUSTOM_FIELD_TYPES = Set.of("TEXT", "DATE", "NUMBER", "SELECT");

    private static final int MAX_MODES = 30;
    private static final int MAX_SUB_MODES = 50;
    private static final int MAX_CUSTOM_FIELDS = 20;
    private static final int MAX_FIELD_OPTIONS = 50;
    private static final Pattern FIELD_KEY = Pattern.compile("^[a-z0-9_]{1,40}$");
    private static final Pattern MODE_CODE = Pattern.compile("^[A-Z0-9_]{1,40}$");
    private static final Pattern SUB_MODE_CODE = Pattern.compile("^[A-Z0-9_]{1,80}$");
    private static final ObjectMapper MAPPER = new ObjectMapper();

    private final InstituteOfflinePaymentSettingRepository repository;

    /** The institute's modes, or the system defaults when it has not saved its own. */
    @Transactional(readOnly = true)
    public OfflinePaymentModesDTO getEffective(String instituteId) {
        if (!StringUtils.hasText(instituteId)) {
            return systemDefaults();
        }
        return repository.findById(instituteId)
                .map(row -> parse(row.getSettingJson(), instituteId))
                .orElseGet(OfflinePaymentModeService::systemDefaults);
    }

    /** Validates, normalises (codes from labels, trimmed text) and stores the institute's modes. */
    @Transactional
    public OfflinePaymentModesDTO save(String instituteId, OfflinePaymentModesDTO request, String userId) {
        if (!StringUtils.hasText(instituteId)) {
            throw new VacademyException("instituteId is required");
        }
        OfflinePaymentModesDTO normalized = normalize(request);
        InstituteOfflinePaymentSetting row = repository.findById(instituteId).orElseGet(() -> {
            InstituteOfflinePaymentSetting fresh = new InstituteOfflinePaymentSetting();
            fresh.setInstituteId(instituteId);
            return fresh;
        });
        try {
            row.setSettingJson(MAPPER.writeValueAsString(normalized));
        } catch (Exception e) {
            throw new VacademyException("Could not save payment modes: " + e.getMessage());
        }
        row.setUpdatedByUserId(userId);
        repository.save(row);
        return normalized;
    }

    /** The modes offered until an institute saves its own. */
    public static OfflinePaymentModesDTO systemDefaults() {
        List<OfflinePaymentModesDTO.Mode> modes = new ArrayList<>();
        modes.add(mode("CASH", "Cash", null, List.of(), List.of()));
        modes.add(mode("UPI", "UPI", "UPI transaction ID", List.of(),
                List.of(sub("PHONEPE", "PhonePe"), sub("GPAY", "Google Pay"), sub("PAYTM", "Paytm"))));
        modes.add(mode("BANK_TRANSFER", "Bank transfer (NEFT/IMPS/RTGS)", "UTR number", List.of(), List.of()));
        modes.add(mode("CHEQUE", "Cheque", "Cheque number", List.of("cheque_date", "bank_name"), List.of()));
        modes.add(mode("DD", "Demand draft", "DD number", List.of("bank_name"), List.of()));
        modes.add(mode("CARD_POS", "Card (POS machine)", "Approval code", List.of(), List.of()));
        return OfflinePaymentModesDTO.builder().requireMode(false).defaultMode("CASH").modes(modes).build();
    }

    // ------------------------------------------------------------------

    static OfflinePaymentModesDTO normalize(OfflinePaymentModesDTO request) {
        if (request == null || request.getModes() == null) {
            throw new VacademyException("Add at least one payment mode");
        }
        if (request.getModes().size() > MAX_MODES) {
            throw new VacademyException("At most " + MAX_MODES + " payment modes");
        }
        List<OfflinePaymentModesDTO.Mode> modes = new ArrayList<>();
        Set<String> codes = new HashSet<>();
        for (OfflinePaymentModesDTO.Mode in : request.getModes()) {
            if (in == null) continue;
            String label = requireText(in.getLabel(), "Every payment mode needs a name", 80);
            String code = StringUtils.hasText(in.getCode()) ? in.getCode().trim().toUpperCase(Locale.ROOT) : codeFrom(label, 40);
            if (!MODE_CODE.matcher(code).matches()) {
                throw new VacademyException("Invalid code for payment mode \"" + label + "\"");
            }
            if (!codes.add(code)) {
                throw new VacademyException("Two payment modes share the code " + code);
            }
            List<String> extras = new ArrayList<>();
            for (String f : in.getExtraFields() == null ? List.<String>of() : in.getExtraFields()) {
                String key = f == null ? "" : f.trim().toLowerCase(Locale.ROOT);
                if (!EXTRA_FIELDS.contains(key)) {
                    throw new VacademyException("Unknown extra field \"" + f + "\" on " + label);
                }
                if (!extras.contains(key)) extras.add(key);
            }
            List<String> requiredExtras = new ArrayList<>();
            for (String f : in.getRequiredExtraFields() == null ? List.<String>of() : in.getRequiredExtraFields()) {
                String key = f == null ? "" : f.trim().toLowerCase(Locale.ROOT);
                if (extras.contains(key) && !requiredExtras.contains(key)) requiredExtras.add(key);
            }
            List<OfflinePaymentModesDTO.CustomField> customFields = normalizeCustomFields(in.getCustomFields(), label);
            List<OfflinePaymentModesDTO.SubMode> subs = new ArrayList<>();
            Set<String> subCodes = new HashSet<>();
            List<OfflinePaymentModesDTO.SubMode> inSubs = in.getSubModes() == null ? List.of() : in.getSubModes();
            if (inSubs.size() > MAX_SUB_MODES) {
                throw new VacademyException("At most " + MAX_SUB_MODES + " options under " + label);
            }
            for (OfflinePaymentModesDTO.SubMode s : inSubs) {
                if (s == null) continue;
                String subLabel = requireText(s.getLabel(), "Every option under " + label + " needs a name", 80);
                String subCode = StringUtils.hasText(s.getCode()) ? s.getCode().trim().toUpperCase(Locale.ROOT) : codeFrom(subLabel, 80);
                if (!SUB_MODE_CODE.matcher(subCode).matches()) {
                    throw new VacademyException("Invalid code for option \"" + subLabel + "\"");
                }
                if (!subCodes.add(subCode)) {
                    throw new VacademyException("Two options under " + label + " share the code " + subCode);
                }
                subs.add(sub(subCode, subLabel, s.isActive()));
            }
            OfflinePaymentModesDTO.Mode out = mode(code, label, trimToNull(in.getReferenceLabel(), 80), extras, subs);
            out.setActive(in.isActive());
            out.setReferenceRequired(in.isReferenceRequired());
            out.setProofRequired(in.isProofRequired());
            out.setRequiredExtraFields(requiredExtras);
            out.setCustomFields(customFields);
            out.setSubModeLabel(trimToNull(in.getSubModeLabel(), 80));
            out.setSubModeRequired(in.isSubModeRequired());
            modes.add(out);
        }
        if (modes.stream().noneMatch(OfflinePaymentModesDTO.Mode::isActive)) {
            throw new VacademyException("Keep at least one payment mode switched on");
        }
        String defaultMode = StringUtils.hasText(request.getDefaultMode())
                ? request.getDefaultMode().trim().toUpperCase(Locale.ROOT) : null;
        if (defaultMode != null && modes.stream().noneMatch(m -> m.isActive() && m.getCode().equals(defaultMode))) {
            throw new VacademyException("The default payment mode must be one of the active modes");
        }
        return OfflinePaymentModesDTO.builder()
                .requireMode(request.isRequireMode())
                .defaultMode(defaultMode)
                .modes(modes)
                .build();
    }

    private static List<OfflinePaymentModesDTO.CustomField> normalizeCustomFields(
            List<OfflinePaymentModesDTO.CustomField> in, String modeLabel) {
        List<OfflinePaymentModesDTO.CustomField> out = new ArrayList<>();
        if (in == null) return out;
        if (in.size() > MAX_CUSTOM_FIELDS) {
            throw new VacademyException("At most " + MAX_CUSTOM_FIELDS + " fields under " + modeLabel);
        }
        Set<String> keys = new HashSet<>();
        for (OfflinePaymentModesDTO.CustomField f : in) {
            if (f == null) continue;
            String label = requireText(f.getLabel(), "Every field under " + modeLabel + " needs a name", 80);
            String key = StringUtils.hasText(f.getKey())
                    ? f.getKey().trim().toLowerCase(Locale.ROOT)
                    : codeFrom(label, 40).toLowerCase(Locale.ROOT);
            if (!FIELD_KEY.matcher(key).matches()) {
                throw new VacademyException("Invalid key for field \"" + label + "\" under " + modeLabel);
            }
            if (!keys.add(key)) {
                throw new VacademyException("Two fields under " + modeLabel + " share the key " + key);
            }
            String type = StringUtils.hasText(f.getType()) ? f.getType().trim().toUpperCase(Locale.ROOT) : "TEXT";
            if (!CUSTOM_FIELD_TYPES.contains(type)) {
                throw new VacademyException("Unknown type \"" + f.getType() + "\" for field " + label);
            }
            List<String> options = new ArrayList<>();
            if ("SELECT".equals(type)) {
                for (String o : f.getOptions() == null ? List.<String>of() : f.getOptions()) {
                    if (!StringUtils.hasText(o)) continue;
                    String option = requireText(o, "", 80);
                    if (options.stream().noneMatch(option::equalsIgnoreCase)) options.add(option);
                }
                if (options.isEmpty()) {
                    throw new VacademyException("Add at least one choice to the dropdown " + label + " under " + modeLabel);
                }
                if (options.size() > MAX_FIELD_OPTIONS) {
                    throw new VacademyException("At most " + MAX_FIELD_OPTIONS + " choices in " + label);
                }
            }
            out.add(OfflinePaymentModesDTO.CustomField.builder()
                    .key(key).label(label).type(type).required(f.isRequired()).active(f.isActive())
                    .options(options).build());
        }
        return out;
    }

    /** "Google Pay (merchant)" → GOOGLE_PAY_MERCHANT. */
    static String codeFrom(String label, int max) {
        String code = label.trim().toUpperCase(Locale.ROOT).replaceAll("[^A-Z0-9]+", "_").replaceAll("^_+|_+$", "");
        if (code.isEmpty()) code = "MODE";
        return code.length() > max ? code.substring(0, max) : code;
    }

    private static OfflinePaymentModesDTO parse(String json, String instituteId) {
        try {
            return MAPPER.readValue(json, OfflinePaymentModesDTO.class);
        } catch (Exception e) {
            log.error("Unreadable offline payment modes for institute {}; using defaults: {}", instituteId, e.getMessage());
            return systemDefaults();
        }
    }

    private static String requireText(String value, String message, int max) {
        String v = value == null ? "" : value.trim();
        if (v.isEmpty()) throw new VacademyException(message);
        if (v.length() > max) throw new VacademyException("\"" + v + "\" is longer than " + max + " characters");
        return v;
    }

    private static String trimToNull(String value, int max) {
        if (!StringUtils.hasText(value)) return null;
        String v = value.trim();
        return v.length() > max ? v.substring(0, max) : v;
    }

    private static OfflinePaymentModesDTO.Mode mode(String code, String label, String referenceLabel,
                                                    List<String> extras, List<OfflinePaymentModesDTO.SubMode> subs) {
        return OfflinePaymentModesDTO.Mode.builder()
                .code(code).label(label).active(true).referenceLabel(referenceLabel)
                .extraFields(new ArrayList<>(extras)).subModes(new ArrayList<>(subs))
                .build();
    }

    private static OfflinePaymentModesDTO.SubMode sub(String code, String label) {
        return sub(code, label, true);
    }

    private static OfflinePaymentModesDTO.SubMode sub(String code, String label, boolean active) {
        return OfflinePaymentModesDTO.SubMode.builder().code(code).label(label).active(active).build();
    }
}
