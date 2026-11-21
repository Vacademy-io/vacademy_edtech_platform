package vacademy.io.admin_core_service.features.commerce.pos.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.admin_core_service.features.commerce.audit.CommerceAuditService;
import vacademy.io.admin_core_service.features.commerce.pos.dto.PosDtos;
import vacademy.io.admin_core_service.features.commerce.stock.service.CommerceStockSettings;
import vacademy.io.admin_core_service.features.commerce.tax.service.CommerceInputRules;
import vacademy.io.admin_core_service.features.institute.repository.InstituteRepository;
import vacademy.io.admin_core_service.features.institute.service.setting.InstituteSettingService;
import vacademy.io.admin_core_service.features.institute.setting_history.InstituteSettingWriter;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.InvalidRequestException;
import vacademy.io.common.exceptions.VacademyException;
import vacademy.io.common.institute.entity.Institute;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * The counter's limits in {@code COMMERCE_SETTING.limits}: {@code cashierDiscountPercent},
 * {@code cashRefundLimit}, {@code cashVarianceLimit}. Read here only (the stock settings read
 * their own two keys of {@code limits}, which every write here leaves as stored).
 *
 * <p>Unset or unreadable values are safe: the discount a cashier may give is 5 % of the bill, a
 * cash refund and a non-zero close difference by a cashier need a manager's PIN (limit 0).
 * A write is read-modify-write under the institute row lock, as the other commerce setting
 * writers do: only these three keys change.
 */
@Slf4j
@Service
public class PosSettingsService {

    public static final BigDecimal DEFAULT_DISCOUNT_PERCENT = new BigDecimal("5.00");
    static final String KEY = CommerceStockSettings.SETTING_KEY;
    static final String LIMITS = "limits";
    static final String DISCOUNT = "cashierDiscountPercent";
    static final String REFUND = "cashRefundLimit";
    static final String VARIANCE = "cashVarianceLimit";
    private static final BigDecimal MAX_AMOUNT = new BigDecimal("9999999.99");
    private static final BigDecimal HUNDRED = new BigDecimal("100");
    private static final BigDecimal ZERO = BigDecimal.ZERO.setScale(2);
    private static final ObjectMapper MAPPER = new ObjectMapper();

    private final InstituteSettingService instituteSettingService;
    private final InstituteRepository instituteRepository;
    private final InstituteSettingWriter settingWriter;
    private final CommerceAuditService auditService;
    private final PosAccess access;

    @PersistenceContext
    private EntityManager entityManager;

    public PosSettingsService(InstituteSettingService instituteSettingService, InstituteRepository instituteRepository,
                              InstituteSettingWriter settingWriter, CommerceAuditService auditService,
                              PosAccess access) {
        this.instituteSettingService = instituteSettingService;
        this.instituteRepository = instituteRepository;
        this.settingWriter = settingWriter;
        this.auditService = auditService;
        this.access = access;
    }

    /** The limits in force. */
    public record Limits(BigDecimal cashierDiscountPercent, BigDecimal cashRefundLimit, BigDecimal cashVarianceLimit,
                         boolean configured) {

        PosDtos.SettingsView view() {
            return new PosDtos.SettingsView(cashierDiscountPercent, cashRefundLimit, cashVarianceLimit, configured);
        }
    }

    /** {@code GET /pos/settings}: anyone at a till. */
    public PosDtos.SettingsView get(CustomUserDetails user, String instituteId) {
        access.require(user, instituteId, PosAccess.TILL);
        return limits(instituteId).view();
    }

    /** {@code PUT /pos/settings}: an institute ADMIN only. */
    @Transactional
    public PosDtos.SettingsView update(CustomUserDetails user, String instituteId, PosDtos.SettingsRequest request) {
        access.require(user, instituteId, PosAccess.ADMIN_ONLY);
        if (request == null) {
            throw new InvalidRequestException("VALIDATION: the request has no body");
        }
        BigDecimal percent = percent(request.cashierDiscountPercent());
        BigDecimal refund = amount(request.cashRefundLimit(), "cash_refund_limit");
        BigDecimal variance = amount(request.cashVarianceLimit(), "cash_variance_limit");

        Institute institute = instituteRepository.findByIdForUpdate(instituteId)
                .orElseThrow(() -> new VacademyException("Institute not found"));
        if (entityManager != null) {
            entityManager.refresh(institute);
        }
        ObjectNode entry = currentEntry(institute.getSetting());
        JsonNode existingData = entry.get("data");
        ObjectNode data = existingData instanceof ObjectNode o ? o : entry.putObject("data");
        JsonNode existingLimits = data.get(LIMITS);
        ObjectNode limits = existingLimits instanceof ObjectNode o ? o : data.putObject(LIMITS);
        Limits before = parse(limits);
        limits.put(DISCOUNT, percent);
        limits.put(REFUND, refund);
        limits.put(VARIANCE, variance);
        settingWriter.putSettingKey(institute, KEY, entry, InstituteSettingWriter.Actor.tenant(user.getUserId()));

        Limits after = new Limits(percent, refund, variance, true);
        auditService.record(instituteId, user.getUserId(), null, "POS_LIMITS_CHANGED", "INSTITUTE", instituteId,
                CommerceInputRules.json(auditView(before)), CommerceInputRules.json(auditView(after)), null);
        return after.view();
    }

    /** The limits in force for an institute; the safe defaults where nothing (readable) is stored. */
    public Limits limits(String instituteId) {
        try {
            Object data = instituteSettingService.getSettingByInstituteIdAndKey(instituteId, KEY);
            JsonNode root = data == null ? MAPPER.createObjectNode() : MAPPER.valueToTree(data);
            return parse(root.path(LIMITS));
        } catch (RuntimeException e) {
            log.warn("Could not read the counter limits of institute {}; the safe defaults apply: {}", instituteId,
                    e.getMessage());
            return new Limits(DEFAULT_DISCOUNT_PERCENT, ZERO, ZERO, false);
        }
    }

    /** The three keys of a stored {@code limits} object; a missing or unreadable key takes its default. */
    static Limits parse(JsonNode limits) {
        BigDecimal percent = read(limits, DISCOUNT);
        BigDecimal refund = read(limits, REFUND);
        BigDecimal variance = read(limits, VARIANCE);
        boolean configured = percent != null || refund != null || variance != null;
        if (percent == null || percent.signum() < 0 || percent.compareTo(HUNDRED) > 0) {
            percent = DEFAULT_DISCOUNT_PERCENT;
        }
        if (refund == null || refund.signum() < 0) {
            refund = ZERO;
        }
        if (variance == null || variance.signum() < 0) {
            variance = ZERO;
        }
        return new Limits(percent.setScale(2, RoundingMode.HALF_UP), refund.setScale(2, RoundingMode.HALF_UP),
                variance.setScale(2, RoundingMode.HALF_UP), configured);
    }

    private static BigDecimal read(JsonNode limits, String key) {
        JsonNode node = limits == null ? null : limits.get(key);
        if (node == null || node.isNull() || node.isMissingNode()) {
            return null;
        }
        try {
            if (node.isNumber()) {
                return node.decimalValue();
            }
            if (node.isTextual() && !node.asText().isBlank()) {
                return new BigDecimal(node.asText().trim());
            }
        } catch (NumberFormatException e) {
            return null;
        }
        return null;
    }

    private static BigDecimal percent(BigDecimal value) {
        if (value == null || value.signum() < 0 || value.compareTo(HUNDRED) > 0
                || value.stripTrailingZeros().scale() > 2) {
            throw new InvalidRequestException("VALIDATION: cashier_discount_percent is 0 to 100 with at most two "
                    + "decimals");
        }
        return value.setScale(2, RoundingMode.UNNECESSARY);
    }

    private static BigDecimal amount(BigDecimal value, String field) {
        if (value == null || value.signum() < 0 || value.compareTo(MAX_AMOUNT) > 0
                || value.stripTrailingZeros().scale() > 2) {
            throw new InvalidRequestException("VALIDATION: " + field + " is an amount from 0 to 9999999.99");
        }
        return value.setScale(2, RoundingMode.UNNECESSARY);
    }

    private static Map<String, Object> auditView(Limits limits) {
        Map<String, Object> view = new LinkedHashMap<>();
        view.put("cashier_discount_percent", limits.cashierDiscountPercent().toPlainString());
        view.put("cash_refund_limit", limits.cashRefundLimit().toPlainString());
        view.put("cash_variance_limit", limits.cashVarianceLimit().toPlainString());
        return view;
    }

    /** A copy of the stored {key, name, data} entry of {@code COMMERCE_SETTING}, or a new one. */
    static ObjectNode currentEntry(String settingJson) {
        JsonNode existing = null;
        if (settingJson != null && !settingJson.isBlank()) {
            try {
                JsonNode root = MAPPER.readTree(settingJson);
                existing = root == null || root.get("setting") == null ? null : root.get("setting").get(KEY);
            } catch (Exception e) {
                throw new VacademyException("Institute settings are not valid JSON; refusing to overwrite them.");
            }
        }
        if (existing instanceof ObjectNode o) {
            return o.deepCopy();
        }
        ObjectNode entry = MAPPER.createObjectNode();
        entry.put("key", KEY);
        entry.put("name", "Commerce Settings");
        entry.putObject("data");
        return entry;
    }
}
