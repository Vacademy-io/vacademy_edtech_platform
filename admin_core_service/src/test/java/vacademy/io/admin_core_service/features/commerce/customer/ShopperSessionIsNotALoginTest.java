package vacademy.io.admin_core_service.features.commerce.customer;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockFilterChain;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import vacademy.io.admin_core_service.features.commerce.customer.repository.CommerceCustomerRepository;
import vacademy.io.common.auth.entity.User;
import vacademy.io.common.auth.filter.JwtAuthFilter;
import vacademy.io.common.auth.service.JwtService;

import java.time.Clock;
import java.util.HashMap;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verifyNoInteractions;

/**
 * A shopper session sent as {@code Authorization: Bearer} authenticates nobody: the platform's
 * JWT filter (learner and staff routes) cannot read it, finds no user and leaves the request
 * anonymous, so every authenticated route refuses it.
 */
class ShopperSessionIsNotALoginTest {

    @AfterEach
    void tearDown() {
        SecurityContextHolder.clearContext();
    }

    private static String session() {
        CommerceShopperSessions sessions = new CommerceShopperSessions(mock(CommerceCustomerRepository.class),
                new TransactionTemplate(mock(PlatformTransactionManager.class)), Clock.systemUTC(),
                "unit-test-only-not-a-secret");
        return sessions.sign("inst-1", "cust-1", "919876543210", 0).token();
    }

    @Test
    void theJwtServiceCannotReadASession() {
        // Control: the same service reads a token it signed itself.
        User someone = new User();
        someone.setUsername("someone");
        JwtService jwt = new JwtService();
        assertEquals("someone", jwt.extractUsername(jwt.generateRefreshToken(new HashMap<>(), someone)));

        String token = session();
        assertThrows(Exception.class, () -> jwt.extractUsername(token));
    }

    @Test
    void theJwtFilterLeavesASessionBearerAnonymous() throws Exception {
        JwtAuthFilter filter = new JwtAuthFilter();
        UserDetailsService users = mock(UserDetailsService.class);
        ReflectionTestUtils.setField(filter, "jwtService", new JwtService());
        ReflectionTestUtils.setField(filter, "userDetailsService", users);
        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/admin-core-service/learner/v1/anything");
        request.addHeader("Authorization", "Bearer " + session());
        request.addHeader("clientId", "inst-1");
        MockFilterChain chain = new MockFilterChain();

        filter.doFilter(request, new MockHttpServletResponse(), chain);

        assertNull(SecurityContextHolder.getContext().getAuthentication(), "nobody is signed in");
        assertNotNull(chain.getRequest(), "the request goes on, anonymous, to the route's own rules");
        verifyNoInteractions(users);
    }
}
