package vacademy.io.assessment_service.features.open_evaluation.auth;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;
import vacademy.io.common.auth.apikey.ApiKeyAuthentication;
import vacademy.io.common.auth.apikey.ApiKeyPrincipal;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/** Scope checks by type, and the synthetic manager principal that never enters the context. */
class ApiScopesAndActorTest {

    private final ApiScopes scopes = new ApiScopes();

    @AfterEach
    void clear() {
        SecurityContextHolder.clearContext();
        RequestContextHolder.resetRequestAttributes();
    }

    private static ApiKeyPrincipal key(List<String> scopeList) {
        return ApiKeyPrincipal.builder().keyId("k1").instituteId("inst-1").name("ERP prod")
                .scopes(scopeList).products(List.of("evaluation")).status("ACTIVE").accessEnabled(true).build();
    }

    @Test
    void key_with_the_scope_passes() {
        SecurityContextHolder.getContext().setAuthentication(new ApiKeyAuthentication(key(List.of("evaluation:read"))));
        assertThat(scopes.has("evaluation:read")).isTrue();
    }

    @Test
    void key_without_the_scope_fails_and_records_what_was_needed() {
        MockHttpServletRequest request = new MockHttpServletRequest();
        RequestContextHolder.setRequestAttributes(new ServletRequestAttributes(request));
        SecurityContextHolder.getContext().setAuthentication(new ApiKeyAuthentication(key(List.of("evaluation:read"))));

        assertThat(scopes.has("evaluation:finalize")).isFalse();
        assertThat(request.getAttribute(ApiScopes.REQUIRED_SCOPE_ATTRIBUTE)).isEqualTo("evaluation:finalize");
    }

    @Test
    void a_jwt_user_never_passes_even_with_a_matching_authority() {
        SecurityContextHolder.getContext().setAuthentication(new UsernamePasswordAuthenticationToken("u", null,
                List.of(new SimpleGrantedAuthority("evaluation:write"), new SimpleGrantedAuthority("ADMIN"))));
        assertThat(scopes.has("evaluation:write")).isFalse();
    }

    @Test
    void synthetic_principal_is_an_admin_named_after_the_key_and_stays_out_of_the_context() {
        CustomUserDetails user = ApiActorPrincipals.forKey(key(List.of()));

        assertThat(user.getUserId()).isEqualTo("apikey:k1");
        assertThat(user.getUsername()).isEqualTo("apikey:k1");
        assertThat(user.getFullName()).isEqualTo("API · ERP prod");
        assertThat(user.isRootUser()).isFalse();
        assertThat(user.getAuthorities()).extracting(Object::toString).containsExactly("ADMIN");
        assertThat(SecurityContextHolder.getContext().getAuthentication()).isNull();
    }

    @Test
    void synthetic_principal_needs_a_key_id() {
        assertThatThrownBy(() -> ApiActorPrincipals.forKey(ApiKeyPrincipal.builder().instituteId("i").build()))
                .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void caller_is_required_on_partner_controllers() {
        assertThatThrownBy(OpenApiCaller::require)
                .isInstanceOfSatisfying(vacademy.io.assessment_service.features.open_evaluation.error.OpenApiException.class,
                        e -> assertThat(e.getStatus().value()).isEqualTo(401));
        SecurityContextHolder.getContext().setAuthentication(new ApiKeyAuthentication(key(List.of())));
        assertThat(OpenApiCaller.require().getInstituteId()).isEqualTo("inst-1");
    }
}
