package vacademy.io.admin_core_service.features.admin_activity_logs.service;

import org.springframework.stereotype.Component;

import java.util.List;

/**
 * admin_core's audit-log redactor bean. The key list and logic live in common_service
 * ({@link vacademy.io.common.logging.PayloadRedactor}) so every service masks the same
 * names (credentials, payment-instrument fields and the public API's
 * {@code x-api-key}, {@code webhook_secret}, {@code signing_secret}, {@code client_secret},
 * {@code signature}). Kept as a subclass so existing injection points and tests are unchanged.
 *
 * <p>The shared list matches whole key names, so it misses the payment-gateway credential
 * fields stored in {@code institute_payment_gateway_mapping} whose names only end in a
 * secret word ({@code keySecret}, {@code webhookPassword}, ...). Those are added here so an
 * audited gateway create/update never writes a live credential into {@code admin_activity_log}.
 */
@Component
public class PayloadRedactor extends vacademy.io.common.logging.PayloadRedactor {

    /** Gateway credential keys the shared whole-name list does not cover. */
    static final List<String> PAYMENT_GATEWAY_SECRET_KEYS = List.of(
            "keySecret",
            "publishableKey",
            "encryptionKey",
            "saltKey",
            "webhookPassword");

    public PayloadRedactor() {
        super(PAYMENT_GATEWAY_SECRET_KEYS);
    }
}
