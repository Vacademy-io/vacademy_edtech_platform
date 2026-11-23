package vacademy.io.admin_core_service.features.marketing.service;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.audience.entity.OAuthConnectState;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class MarketingOAuthBrowserBindingTest {

    @Test
    @DisplayName("The callback is accepted only from the browser holding the initiate cookie")
    void browserBinding() {
        OAuthConnectState state = OAuthConnectState.builder()
                .browserNonceHash(MarketingOAuthService.sha256Hex("nonce-abc")).build();

        assertTrue(MarketingOAuthService.browserMatches(state, "nonce-abc"));
        assertFalse(MarketingOAuthService.browserMatches(state, "nonce-abd"));
        assertFalse(MarketingOAuthService.browserMatches(state, null));
        assertFalse(MarketingOAuthService.browserMatches(state, ""));
        assertFalse(MarketingOAuthService.browserMatches(OAuthConnectState.builder().build(), "nonce-abc"));
    }
}
