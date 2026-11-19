package vacademy.io.admin_core_service.features.commerce.otp;

import vacademy.io.admin_core_service.core.external.ExternalCallLog;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.util.LinkedMultiValueMap;
import org.springframework.util.MultiValueMap;
import org.springframework.util.StringUtils;
import org.springframework.web.client.RestTemplate;
import vacademy.io.admin_core_service.features.commerce.stock.service.CommerceStockSettings;
import vacademy.io.admin_core_service.features.institute.service.setting.InstituteSettingService;

/**
 * The bot check of the public checkout: Cloudflare Turnstile. The
 * storefront shows the widget and sends its token with the checkout; this class asks
 * Cloudflare whether the token is good.
 *
 * <p>The check is on when the server has a Turnstile secret ({@code commerce.turnstile.secret},
 * from the environment). An institute whose shop runs on a domain
 * the widget is not registered for can switch it off with
 * {@code COMMERCE_SETTING.botCheck.enabled = false}; a missing or unreadable setting leaves it
 * on.
 *
 * <p><b>When Cloudflare cannot be reached</b> the call is refused and an alert is logged.
 * Letting it through instead is a deliberate choice of the deployment
 * ({@code commerce.turnstile.fail-open=true}), never the default. A token Cloudflare answers
 * "no" to is always refused.
 *
 * <p><b>When no secret is set at all</b> {@link #notConfigured} is true and checkout answers
 * 503, unless the deployment says the check is not wanted
 * ({@code commerce.turnstile.required=false}) or the institute switched it off.
 *
 * <p>{@link #verify} makes a remote call and refuses to run inside a database transaction.
 * The secret and the token are never logged.
 */
@Slf4j
@Component
public class CommerceBotCheck {

    static final String DEFAULT_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
    private static final int MAX_TOKEN_LENGTH = 2048;

    /** The call to Cloudflare; a test puts a stub here. Returns the JSON answer. */
    @FunctionalInterface
    interface SiteVerify {
        String post(String url, String secret, String token, String remoteIp);
    }

    private final InstituteSettingService instituteSettingService;
    private final ObjectMapper objectMapper;
    private final SiteVerify siteVerify;
    private final String secret;
    private final String verifyUrl;
    private final boolean failOpen;
    private final boolean secretRequired;

    @Autowired
    public CommerceBotCheck(InstituteSettingService instituteSettingService, ObjectMapper objectMapper,
                            @Value("${commerce.turnstile.secret:}") String secret,
                            @Value("${commerce.turnstile.verify-url:" + DEFAULT_VERIFY_URL + "}") String verifyUrl,
                            @Value("${commerce.turnstile.fail-open:false}") boolean failOpen,
                            @Value("${commerce.turnstile.required:true}") boolean secretRequired) {
        this(instituteSettingService, objectMapper, CommerceBotCheck::postForm, secret, verifyUrl, failOpen,
                secretRequired);
    }

    CommerceBotCheck(InstituteSettingService instituteSettingService, ObjectMapper objectMapper,
                     SiteVerify siteVerify, String secret, String verifyUrl, boolean failOpen,
                     boolean secretRequired) {
        this.instituteSettingService = instituteSettingService;
        this.objectMapper = objectMapper;
        this.siteVerify = siteVerify;
        this.secret = secret == null ? "" : secret.trim();
        this.verifyUrl = StringUtils.hasText(verifyUrl) ? verifyUrl.trim() : DEFAULT_VERIFY_URL;
        this.failOpen = failOpen;
        this.secretRequired = secretRequired;
    }

    /**
     * True when orders must not be taken because no bot check is set up: the server has no
     * Turnstile secret, the deployment has not said that this is meant
     * ({@code commerce.turnstile.required=false}) and the institute has not switched the check
     * off itself. Without the check one script can hold the whole stock of a shop in unpaid
     * orders, so "not set up" must never quietly mean "off".
     */
    public boolean notConfigured(String instituteId) {
        return secret.isEmpty() && secretRequired && !switchedOff(instituteId);
    }


    /** True when a checkout of this institute must carry a bot-check token. */
    public boolean isRequired(String instituteId) {
        return !secret.isEmpty() && !switchedOff(instituteId);
    }

    /** Only an explicit {@code botCheck.enabled = false} in the institute's setting. */
    private boolean switchedOff(String instituteId) {
        try {
            Object data = instituteSettingService.getSettingByInstituteIdAndKey(instituteId,
                    CommerceStockSettings.SETTING_KEY);
            if (data != null) {
                JsonNode enabled = objectMapper.valueToTree(data).path("botCheck").path("enabled");
                return enabled.isBoolean() && !enabled.asBoolean();
            }
        } catch (RuntimeException e) {
            log.warn("Could not read commerce.botCheck of institute {}: {}", instituteId, e.getMessage());
        }
        return false;
    }

    /**
     * @param token    the token of the Turnstile widget, as the storefront sent it
     * @param clientIp the network address of the shopper, or null
     * @return true when the check is off for this institute or the token is good
     */
    public boolean verify(String instituteId, String token, String clientIp) {
        if (!isRequired(instituteId)) {
            return true;
        }
        if (TransactionSynchronizationManager.isActualTransactionActive()) {
            throw new IllegalStateException("The bot check calls Cloudflare and must not run in a transaction");
        }
        if (!StringUtils.hasText(token) || token.length() > MAX_TOKEN_LENGTH) {
            return false;
        }
        String answer;
        try {
            answer = siteVerify.post(verifyUrl, secret, token.trim(), StringUtils.hasText(clientIp) ? clientIp.trim()
                    : null);
        } catch (RuntimeException e) {
            log.error("COMMERCE_ALERT bot check could not reach Cloudflare ({}); the checkout is {}",
                    e.getClass().getSimpleName(), failOpen ? "let through" : "refused");
            return failOpen;
        }
        try {
            JsonNode root = objectMapper.readTree(answer == null ? "" : answer);
            if (root.path("success").asBoolean(false)) {
                return true;
            }
            log.info("Bot check refused a checkout of institute {}: {}", instituteId, root.path("error-codes"));
            return false;
        } catch (Exception e) {
            log.error("COMMERCE_ALERT bot check got an unreadable answer; the checkout is {}",
                    failOpen ? "let through" : "refused");
            return failOpen;
        }
    }

    private static String postForm(String url, String secret, String token, String remoteIp) {
        SimpleClientHttpRequestFactory factory = new SimpleClientHttpRequestFactory();
        factory.setConnectTimeout(3000);
        factory.setReadTimeout(5000);
        MultiValueMap<String, String> form = new LinkedMultiValueMap<>();
        form.add("secret", secret);
        form.add("response", token);
        if (remoteIp != null) {
            form.add("remoteip", remoteIp);
        }
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_FORM_URLENCODED);
        return ExternalCallLog.attach(new RestTemplate(factory)).postForObject(url, new HttpEntity<>(form, headers), String.class);
    }
}
