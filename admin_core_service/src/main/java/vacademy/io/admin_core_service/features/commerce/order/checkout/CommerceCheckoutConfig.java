package vacademy.io.admin_core_service.features.commerce.order.checkout;

import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.commerce.customer.CommerceShopperSessions;
import vacademy.io.admin_core_service.features.commerce.order.cod.CommerceCodAvailability;
import vacademy.io.admin_core_service.features.commerce.otp.CommerceBotCheck;
import vacademy.io.admin_core_service.features.commerce.stock.service.CommerceStockSettings;
import vacademy.io.admin_core_service.features.commerce.storefront.model.StorefrontSettings;
import vacademy.io.admin_core_service.features.commerce.storefront.service.CommerceStorefrontSettings;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * What the storefront needs to draw the checkout of a shop ({@code GET /checkout/config}): the
 * buyer-identity mode, the OTP step, the bot check, the payment methods and the hold time.
 * Nothing secret and no institute id: the Turnstile site key is a public value.
 */
@Slf4j
@Component
public class CommerceCheckoutConfig {

    static final String OTP_CHANNEL = "WHATSAPP";
    static final int OTP_CODE_LENGTH = 6;
    static final int OTP_RESEND_AFTER_SECONDS = 60;
    static final String CURRENCY = "INR";

    private final CommerceStorefrontSettings storefrontSettings;
    private final CommerceStockSettings stockSettings;
    private final CommerceBotCheck botCheck;
    private final CommerceCodAvailability codAvailability;
    private final String turnstileSiteKey;

    public CommerceCheckoutConfig(CommerceStorefrontSettings storefrontSettings, CommerceStockSettings stockSettings,
                                  CommerceBotCheck botCheck, CommerceCodAvailability codAvailability,
                                  @Value("${commerce.turnstile.site-key:}") String turnstileSiteKey) {
        this.storefrontSettings = storefrontSettings;
        this.stockSettings = stockSettings;
        this.botCheck = botCheck;
        this.codAvailability = codAvailability;
        this.turnstileSiteKey = StringUtils.hasText(turnstileSiteKey) ? turnstileSiteKey.trim() : null;
    }

    public Map<String, Object> config(String instituteId) {
        StorefrontSettings settings = storefrontSettings.read(instituteId);
        StorefrontSettings.Cod cod = settings.cod();
        // Online only when the deployment switch (COMMERCE_COD_PLACEMENT_ENABLED) and the shop
        // both say so; "enabled" below is the shop's own setting.
        boolean codOffered = codAvailability != null && codAvailability.effective(cod);

        Map<String, Object> answer = new LinkedHashMap<>();
        answer.put("buyer_identity", (settings.buyerIdentity() == null ? BuyerIdentity.DEFAULT
                : settings.buyerIdentity()).name());

        Map<String, Object> otp = new LinkedHashMap<>();
        otp.put("channel", OTP_CHANNEL);
        otp.put("code_length", OTP_CODE_LENGTH);
        otp.put("resend_after", OTP_RESEND_AFTER_SECONDS);
        answer.put("otp", otp);

        Map<String, Object> bot = new LinkedHashMap<>();
        boolean required;
        try {
            required = botCheck.isRequired(instituteId);
        } catch (RuntimeException e) {
            // A check that cannot be read is asked for: the server refuses without it anyway.
            log.warn("Could not read the bot check of institute {}: {}", instituteId, e.getClass().getSimpleName());
            required = true;
        }
        bot.put("required", required);
        bot.put("site_key", turnstileSiteKey);
        answer.put("bot_check", bot);

        List<String> methods = new ArrayList<>();
        methods.add("PREPAID");
        if (codOffered) {
            methods.add("COD");
        }
        answer.put("payment_methods", methods);

        Map<String, Object> codView = new LinkedHashMap<>();
        codView.put("enabled", cod.enabled());
        codView.put("online", codOffered);
        codView.put("max_order_value", cod.maxOrderValue());
        codView.put("staff_confirm_threshold", cod.staffConfirmThreshold());
        answer.put("cod", codView);

        answer.put("hold_minutes", stockSettings.holdMinutes(instituteId));
        answer.put("session_days", CommerceShopperSessions.LIFETIME.toDays());
        answer.put("currency", CURRENCY);
        return answer;
    }
}
