package vacademy.io.admin_core_service.features.user_subscription.util;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import lombok.extern.slf4j.Slf4j;
import vacademy.io.admin_core_service.features.user_subscription.dto.UserPlanDiscountJson;

/**
 * Reads / writes the CPO discount snapshot embedded inside
 * {@code user_plan.payment_option_json}.
 *
 * <p>The column is a snapshot of the PaymentOption entity at enrollment time.
 * To avoid adding a new column, the CPO discount state lives alongside the
 * snapshot under the {@value #DISCOUNT_KEY} key. PaymentOption is annotated
 * with {@code @JsonIgnoreProperties(ignoreUnknown = true)} so existing
 * deserializers keep working.
 *
 * <p>If {@code payment_option_json} is null, empty, or not a JSON object
 * (legacy / corrupt rows), reads return an empty discount snapshot and
 * writes initialize a fresh JSON object containing only the key.
 */
@Slf4j
public final class PaymentOptionJsonDiscountAccessor {

    public static final String DISCOUNT_KEY = "cpo_discount_state";

    // Discovers jackson-datatype-jsr310 (transitively present via spring-boot-starter-json)
    // so LocalDateTime fields on UserPlanDiscountJson can be serialized. Without this,
    // every write of an audit entry blows up with "Java 8 date/time type not supported".
    // Unknown fields are ignored: a snapshot written by a newer build (a field added later) must
    // not read back as empty here — the next recompute would then drop the discount entirely.
    private static final ObjectMapper OM = new ObjectMapper().findAndRegisterModules()
            .configure(com.fasterxml.jackson.databind.DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);

    private PaymentOptionJsonDiscountAccessor() {}

    /** Returns the embedded discount snapshot, or an empty one if none/unparseable. */
    public static UserPlanDiscountJson read(String paymentOptionJson) {
        if (paymentOptionJson == null || paymentOptionJson.isBlank()) {
            return UserPlanDiscountJson.builder().build();
        }
        try {
            JsonNode root = OM.readTree(paymentOptionJson);
            if (root == null || !root.isObject()) {
                return UserPlanDiscountJson.builder().build();
            }
            JsonNode discount = root.get(DISCOUNT_KEY);
            if (discount == null || discount.isNull()) {
                return UserPlanDiscountJson.builder().build();
            }
            UserPlanDiscountJson parsed = OM.treeToValue(discount, UserPlanDiscountJson.class);
            return parsed != null ? parsed : UserPlanDiscountJson.builder().build();
        } catch (Exception e) {
            log.warn("Failed to read cpo_discount_state from payment_option_json: {}", e.getMessage());
            return UserPlanDiscountJson.builder().build();
        }
    }

    /**
     * Returns a new payment_option_json string with the discount snapshot
     * embedded under {@link #DISCOUNT_KEY}. Preserves all other fields of the
     * existing JSON object. If the input is null/blank/non-object, produces a
     * single-key object.
     */
    public static String write(String paymentOptionJson, UserPlanDiscountJson snapshot) {
        try {
            ObjectNode root;
            if (paymentOptionJson == null || paymentOptionJson.isBlank()) {
                root = OM.createObjectNode();
            } else {
                JsonNode parsed = OM.readTree(paymentOptionJson);
                root = parsed != null && parsed.isObject() ? (ObjectNode) parsed : OM.createObjectNode();
            }
            if (snapshot == null) {
                root.remove(DISCOUNT_KEY);
            } else {
                root.set(DISCOUNT_KEY, OM.valueToTree(snapshot));
            }
            return OM.writeValueAsString(root);
        } catch (Exception e) {
            log.error("Failed to write cpo_discount_state into payment_option_json: {}", e.getMessage(), e);
            // Last-resort: if we can't merge, persist just the discount under the key
            // so the data isn't lost. Better to clobber the snapshot than to lose
            // an in-progress discount edit.
            try {
                ObjectNode fallback = OM.createObjectNode();
                if (snapshot != null) fallback.set(DISCOUNT_KEY, OM.valueToTree(snapshot));
                return OM.writeValueAsString(fallback);
            } catch (Exception inner) {
                throw new RuntimeException("Could not serialize discount snapshot", inner);
            }
        }
    }
}
