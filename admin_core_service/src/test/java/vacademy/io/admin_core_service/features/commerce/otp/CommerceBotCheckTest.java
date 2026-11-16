package vacademy.io.admin_core_service.features.commerce.otp;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import vacademy.io.admin_core_service.features.institute.service.setting.InstituteSettingService;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/** Turnstile behind a setting: off without a secret; Cloudflare is a stub in every test. */
class CommerceBotCheckTest {

    private InstituteSettingService settings;
    private final List<String[]> calls = new ArrayList<>();
    private String answer = "{\"success\":true}";
    private RuntimeException failure;

    @BeforeEach
    void setUp() {
        settings = mock(InstituteSettingService.class);
    }

    @AfterEach
    void tearDown() {
        TransactionSynchronizationManager.setActualTransactionActive(false);
    }

    private CommerceBotCheck check(String secret, boolean failOpen) {
        return check(secret, failOpen, true);
    }

    private CommerceBotCheck check(String secret, boolean failOpen, boolean secretRequired) {
        return new CommerceBotCheck(settings, new ObjectMapper(), (url, s, token, ip) -> {
            calls.add(new String[] {url, s, token, ip});
            if (failure != null) {
                throw failure;
            }
            return answer;
        }, secret, null, failOpen, secretRequired);
    }

    @Test
    void noSecretIsNotTheSameAsOff_checkoutMustBeToldSo() {
        when(settings.getSettingByInstituteIdAndKey("inst-off", "COMMERCE_SETTING"))
                .thenReturn(Map.of("botCheck", Map.of("enabled", false)));

        // No secret and nobody said that this is meant: orders must not be taken.
        assertTrue(check("", false).notConfigured("inst-1"));
        // The deployment said so, or the institute switched the check off itself.
        assertFalse(check("", false, false).notConfigured("inst-1"));
        assertFalse(check("", false).notConfigured("inst-off"));
        // With a secret the check simply runs.
        assertFalse(check("turnstile-secret", false).notConfigured("inst-1"));
    }

    @Test
    void theDefaultOfTheDeploymentIsToRefuseWhenCloudflareCannotBeReached() throws Exception {
        java.lang.reflect.Constructor<CommerceBotCheck> wired = CommerceBotCheck.class.getConstructor(
                InstituteSettingService.class, ObjectMapper.class, String.class, String.class, boolean.class,
                boolean.class);
        org.springframework.beans.factory.annotation.Value failOpen = wired.getParameters()[4]
                .getAnnotation(org.springframework.beans.factory.annotation.Value.class);
        org.springframework.beans.factory.annotation.Value required = wired.getParameters()[5]
                .getAnnotation(org.springframework.beans.factory.annotation.Value.class);

        assertEquals("${commerce.turnstile.fail-open:false}", failOpen.value());
        assertEquals("${commerce.turnstile.required:true}", required.value());
    }

    @Test
    void withoutASecretTheCheckIsOffAndCloudflareIsNeverCalled() {
        CommerceBotCheck check = check("", true);

        assertFalse(check.isRequired("inst-1"));
        assertTrue(check.verify("inst-1", null, "203.0.113.7"));
        assertTrue(calls.isEmpty());
    }

    @Test
    void aGoodTokenPassesAndIsSentWithTheSecretAndTheAddress() {
        CommerceBotCheck check = check("turnstile-secret", true);

        assertTrue(check.isRequired("inst-1"));
        assertTrue(check.verify("inst-1", " token-1 ", "203.0.113.7"));
        assertEquals(1, calls.size());
        assertEquals(CommerceBotCheck.DEFAULT_VERIFY_URL, calls.get(0)[0]);
        assertEquals("turnstile-secret", calls.get(0)[1]);
        assertEquals("token-1", calls.get(0)[2]);
        assertEquals("203.0.113.7", calls.get(0)[3]);
    }

    @Test
    void aTokenCloudflareRefusesIsRefused() {
        answer = "{\"success\":false,\"error-codes\":[\"invalid-input-response\"]}";

        assertFalse(check("turnstile-secret", true).verify("inst-1", "token-1", null));
    }

    @Test
    void aMissingTokenIsRefusedWithoutACall() {
        CommerceBotCheck check = check("turnstile-secret", true);

        assertFalse(check.verify("inst-1", null, null));
        assertFalse(check.verify("inst-1", "  ", null));
        assertFalse(check.verify("inst-1", "x".repeat(3000), null));
        assertTrue(calls.isEmpty());
    }

    @Test
    void whenCloudflareCannotBeReachedTheSettingDecides() {
        failure = new IllegalStateException("timeout");

        assertTrue(check("turnstile-secret", true).verify("inst-1", "token-1", null));
        assertFalse(check("turnstile-secret", false).verify("inst-1", "token-1", null));
    }

    @Test
    void anInstituteCanSwitchItOffOnlyWithAnExplicitFalse() {
        CommerceBotCheck check = check("turnstile-secret", true);

        when(settings.getSettingByInstituteIdAndKey("inst-off", "COMMERCE_SETTING"))
                .thenReturn(Map.of("botCheck", Map.of("enabled", false)));
        when(settings.getSettingByInstituteIdAndKey("inst-text", "COMMERCE_SETTING"))
                .thenReturn(Map.of("botCheck", Map.of("enabled", "no")));
        when(settings.getSettingByInstituteIdAndKey("inst-broken", "COMMERCE_SETTING"))
                .thenThrow(new IllegalStateException("unreadable"));

        assertFalse(check.isRequired("inst-off"));
        assertTrue(check.isRequired("inst-text"));
        assertTrue(check.isRequired("inst-broken"));
        assertTrue(check.isRequired("inst-none"));
    }

    @Test
    void itRefusesToCallCloudflareInsideATransaction() {
        TransactionSynchronizationManager.setActualTransactionActive(true);

        assertThrows(IllegalStateException.class,
                () -> check("turnstile-secret", true).verify("inst-1", "token-1", null));
        assertTrue(calls.isEmpty());
    }
}
