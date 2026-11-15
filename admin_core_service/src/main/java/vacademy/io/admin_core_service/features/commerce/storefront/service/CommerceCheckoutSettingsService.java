package vacademy.io.admin_core_service.features.commerce.storefront.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.admin_core_service.features.commerce.order.checkout.BuyerIdentity;
import vacademy.io.admin_core_service.features.commerce.stock.service.CommerceStockSettings;
import vacademy.io.admin_core_service.features.commerce.storefront.model.StorefrontSettings;
import vacademy.io.admin_core_service.features.institute.repository.InstituteRepository;
import vacademy.io.admin_core_service.features.institute.setting_history.InstituteSettingWriter;
import vacademy.io.common.exceptions.InvalidRequestException;
import vacademy.io.common.exceptions.VacademyException;
import vacademy.io.common.institute.entity.Institute;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * The checkout keys of {@code COMMERCE_SETTING} for staff: buyer identity, the hourly OTP cap
 * and the cash-on-delivery limits.
 *
 * <p>A write is read-modify-write under a row lock on the institute, on the stored JSON: only
 * the keys named here change, every other key of the setting (hold time, base language,
 * limits, bot check, blocked pincodes, ...) and every other setting of the institute stays as
 * stored. A value staff typed that is not allowed is refused (400), never replaced by a
 * default.
 */
@Service
public class CommerceCheckoutSettingsService {

    /** The highest COD order value the platform allows until its owner raises it. */
    public static final BigDecimal COD_MAX_CEILING = new BigDecimal("5000.00");
    static final String KEY = CommerceStockSettings.SETTING_KEY;
    private static final ObjectMapper MAPPER = new ObjectMapper();

    private final InstituteRepository instituteRepository;
    private final InstituteSettingWriter settingWriter;
    private final CommerceStorefrontSettings storefrontSettings;

    @PersistenceContext
    private EntityManager entityManager;

    public CommerceCheckoutSettingsService(InstituteRepository instituteRepository,
                                           InstituteSettingWriter settingWriter,
                                           CommerceStorefrontSettings storefrontSettings) {
        this.instituteRepository = instituteRepository;
        this.settingWriter = settingWriter;
        this.storefrontSettings = storefrontSettings;
    }

    /** The values in force (defaults where the setting has none). */
    public Map<String, Object> get(String instituteId) {
        return view(storefrontSettings.read(instituteId));
    }

    /**
     * Writes the keys present in {@code body}; a key left out keeps its stored value.
     *
     * @throws InvalidRequestException for an unknown mode or a number out of range
     */
    @Transactional
    public Map<String, Object> update(String instituteId, String userId, JsonNode body) {
        if (body == null || !body.isObject()) {
            throw new InvalidRequestException("invalid_request: the body is a JSON object");
        }
        Institute institute = instituteRepository.findByIdForUpdate(instituteId)
                .orElseThrow(() -> new VacademyException("Institute not found"));
        if (entityManager != null) {
            // A copy loaded earlier in this request is not refreshed by the locking query.
            entityManager.refresh(institute);
        }
        ObjectNode entry = currentEntry(institute.getSetting());
        JsonNode existingData = entry.get("data");
        ObjectNode data = existingData instanceof ObjectNode o ? o : entry.putObject("data");
        StorefrontSettings current = StorefrontSettings.parse(data);

        if (body.has("buyer_identity")) {
            BuyerIdentity mode = BuyerIdentity.strict(body.path("buyer_identity").isTextual()
                    ? body.path("buyer_identity").asText() : null);
            if (mode == null) {
                throw new InvalidRequestException("invalid_request: buyer_identity is PHONE_OTP, EMAIL or EITHER");
            }
            data.put("buyerIdentity", mode.name());
        }
        if (body.has("otp_institute_hourly_cap")) {
            int cap = wholeNumber(body.path("otp_institute_hourly_cap"), "otp_institute_hourly_cap",
                    StorefrontSettings.MIN_OTP_INSTITUTE_HOURLY_CAP, StorefrontSettings.MAX_OTP_INSTITUTE_HOURLY_CAP);
            JsonNode otp = data.get("otp");
            ObjectNode otpNode = otp instanceof ObjectNode o ? o : data.putObject("otp");
            otpNode.put("instituteHourlyCap", cap);
        }
        JsonNode cod = body.get("cod");
        if (cod != null && !cod.isNull()) {
            if (!cod.isObject()) {
                throw new InvalidRequestException("invalid_request: cod is a JSON object");
            }
            JsonNode stored = data.get("cod");
            ObjectNode codNode = stored instanceof ObjectNode o ? o : data.putObject("cod");
            boolean enabled = current.cod().enabled();
            if (cod.has("enabled")) {
                if (!cod.path("enabled").isBoolean()) {
                    throw new InvalidRequestException("invalid_request: cod.enabled is true or false");
                }
                enabled = cod.path("enabled").asBoolean();
            }
            BigDecimal max = cod.has("max_order_value") ? money(cod.path("max_order_value"), "cod.max_order_value")
                    : current.cod().maxOrderValue();
            BigDecimal confirm = cod.has("staff_confirm_threshold")
                    ? money(cod.path("staff_confirm_threshold"), "cod.staff_confirm_threshold")
                    : current.cod().staffConfirmThreshold();
            if (max.compareTo(COD_MAX_CEILING) > 0) {
                throw new InvalidRequestException("invalid_request: cod.max_order_value is at most "
                        + COD_MAX_CEILING.toPlainString());
            }
            if (confirm.compareTo(max) > 0) {
                throw new InvalidRequestException(
                        "invalid_request: cod.staff_confirm_threshold is at most cod.max_order_value");
            }
            codNode.put("enabled", enabled);
            codNode.put("maxOrderValue", max);
            codNode.put("staffConfirmThreshold", confirm);
            if (cod.has("max_open_orders_per_phone")) {
                codNode.put("maxOpenOrdersPerPhone", wholeNumber(cod.path("max_open_orders_per_phone"),
                        "cod.max_open_orders_per_phone", 1, StorefrontSettings.MAX_COD_MAX_OPEN_ORDERS_PER_PHONE));
            }
            if (cod.has("max_refusals")) {
                codNode.put("maxRefusals", wholeNumber(cod.path("max_refusals"), "cod.max_refusals", 0,
                        StorefrontSettings.MAX_COD_MAX_REFUSALS));
            }
        }
        settingWriter.putSettingKey(institute, KEY, entry, InstituteSettingWriter.Actor.tenant(userId));
        return view(StorefrontSettings.parse(data));
    }

    static Map<String, Object> view(StorefrontSettings settings) {
        Map<String, Object> answer = new LinkedHashMap<>();
        answer.put("buyer_identity", (settings.buyerIdentity() == null ? BuyerIdentity.DEFAULT
                : settings.buyerIdentity()).name());
        answer.put("otp_institute_hourly_cap", settings.otpInstituteHourlyCap());
        Map<String, Object> cod = new LinkedHashMap<>();
        cod.put("enabled", settings.cod().enabled());
        cod.put("max_order_value", settings.cod().maxOrderValue());
        cod.put("staff_confirm_threshold", settings.cod().staffConfirmThreshold());
        cod.put("max_open_orders_per_phone", settings.cod().maxOpenOrdersPerPhone());
        cod.put("max_refusals", settings.cod().maxRefusals());
        answer.put("cod", cod);
        return answer;
    }

    /** A copy of the stored {key, name, data} entry, or a new one. */
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

    private static int wholeNumber(JsonNode node, String field, int min, int max) {
        if (node == null || !node.isIntegralNumber() || node.asLong() < min || node.asLong() > max) {
            throw new InvalidRequestException("invalid_request: " + field + " is a whole number from " + min
                    + " to " + max);
        }
        return node.asInt();
    }

    private static BigDecimal money(JsonNode node, String field) {
        if (node == null || !node.isNumber() || node.decimalValue().signum() <= 0
                || node.decimalValue().stripTrailingZeros().scale() > 2) {
            throw new InvalidRequestException("invalid_request: " + field + " is an amount above zero");
        }
        return node.decimalValue().setScale(2, RoundingMode.UNNECESSARY);
    }
}
