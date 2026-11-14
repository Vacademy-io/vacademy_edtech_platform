package vacademy.io.admin_core_service.features.admin_activity_logs.service;

import org.springframework.stereotype.Component;

/**
 * admin_core's audit-log redactor bean. The key list and logic live in common_service
 * ({@link vacademy.io.common.logging.PayloadRedactor}) so every service masks the same
 * names (credentials, payment-instrument fields and the public API's
 * {@code x-api-key}, {@code webhook_secret}, {@code signing_secret}, {@code client_secret},
 * {@code signature}). Kept as a subclass so existing injection points and tests are unchanged.
 */
@Component
public class PayloadRedactor extends vacademy.io.common.logging.PayloadRedactor {

    public PayloadRedactor() {
        super();
    }
}
