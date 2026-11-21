package vacademy.io.auth_service.core.config;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.security.core.Authentication;
import org.springframework.test.util.ReflectionTestUtils;
import vacademy.io.common.core.internal_api_wrapper.ProductConfigClient;
import vacademy.io.common.product.ProductConfigDTO;

import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/** The return URL is decided before anything about the login is used or sent. */
class CustomOAuth2SuccessHandlerReturnUrlTest {

    private static final String PORTAL = "https://dash.vacademy.io";

    private final ProductConfigClient products = mock(ProductConfigClient.class);
    private final Authentication authentication = mock(Authentication.class);
    private final CustomOAuth2SuccessHandler handler = new CustomOAuth2SuccessHandler();

    @BeforeEach
    void setUp() {
        OAuthReturnUrlPolicy policy = new OAuthReturnUrlPolicy("", PORTAL, "vacademy.io");
        ReflectionTestUtils.setField(handler, "returnUrlPolicy", policy);
        ReflectionTestUtils.setField(handler, "productConfigClient", products);
        ReflectionTestUtils.setField(handler, "adminPortalClientUrl", PORTAL);
    }

    private String handle(String stateJson) throws Exception {
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.setParameter("state",
                Base64.getEncoder().encodeToString(stateJson.getBytes(StandardCharsets.UTF_8)));
        MockHttpServletResponse response = new MockHttpServletResponse();
        handler.onAuthenticationSuccess(request, response, authentication);
        return response.getRedirectedUrl();
    }

    @Test
    void anUnknownHostGetsNothingAndTheLoginIsNotRead() throws Exception {
        String redirect = handle("{\"from\":\"https://example.com/cb\",\"user_type\":\"admin\"}");

        assertThat(redirect).startsWith(PORTAL).contains("error=true").contains("invalid_return_url");
        assertThat(redirect).doesNotContain("example.com");
        verifyNoInteractions(authentication);
    }

    @Test
    void aKnownHostGoesOnToTheLogin() throws Exception {
        // Not an OAuth2 token, so the handler stops at its next check and answers on the given URL.
        String redirect = handle("{\"from\":\"https://evalezy.vacademy.io/signup/start\",\"user_type\":\"admin\"}");

        assertThat(redirect).startsWith("https://evalezy.vacademy.io/signup/start")
                .contains("invalid_authentication_type");
    }

    @Test
    void aProductsOwnReturnHostIsAccepted() throws Exception {
        when(products.get("newproduct")).thenReturn(Optional.of(ProductConfigDTO.builder()
                .productKey("newproduct").selfSignupEnabled(true).returnHosts("newproduct.com").build()));

        String redirect = handle(
                "{\"from\":\"https://app.newproduct.com/signup/start\",\"user_type\":\"admin\",\"product\":\"newproduct\"}");

        assertThat(redirect).startsWith("https://app.newproduct.com/signup/start");
    }

    @Test
    void aClosedProductsReturnHostIsRefused() throws Exception {
        when(products.get("newproduct")).thenReturn(Optional.of(ProductConfigDTO.builder()
                .productKey("newproduct").selfSignupEnabled(false).returnHosts("newproduct.com").build()));

        String redirect = handle(
                "{\"from\":\"https://app.newproduct.com/signup/start\",\"user_type\":\"admin\",\"product\":\"newproduct\"}");

        assertThat(redirect).startsWith(PORTAL).contains("invalid_return_url");
    }
}
