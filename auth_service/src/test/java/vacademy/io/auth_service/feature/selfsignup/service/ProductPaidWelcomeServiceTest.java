package vacademy.io.auth_service.feature.selfsignup.service;

import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import vacademy.io.auth_service.feature.auth.service.AuthService;
import vacademy.io.common.auth.entity.User;
import vacademy.io.common.auth.entity.UserRole;
import vacademy.io.common.auth.repository.UserRepository;
import vacademy.io.common.core.internal_api_wrapper.ProductConfigClient;
import vacademy.io.common.exceptions.VacademyException;
import vacademy.io.common.product.ProductConfigDTO;

import java.util.HashSet;
import java.util.List;
import java.util.Optional;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class ProductPaidWelcomeServiceTest {

    JdbcTemplate jdbc = mock(JdbcTemplate.class);
    UserRepository users = mock(UserRepository.class);
    AuthService authService = mock(AuthService.class);
    ProductConfigClient products = mock(ProductConfigClient.class);
    ProductPaidWelcomeService service = new ProductPaidWelcomeService(jdbc, users, authService, products);
    ProductConfigDTO evalezy = ProductConfigDTO.builder().productKey("evalezy").displayName("Evalezy")
            .fromEmail("hello@evalezy.com").build();

    @Test
    void theOwnerGetsTheProductsLoginMailWithOnlyThisInstitutesRoles() {
        when(products.get("evalezy")).thenReturn(Optional.of(evalezy));
        when(jdbc.queryForList(eq(ProductPaidWelcomeService.OWNER), eq(String.class), eq("inst-1")))
                .thenReturn(List.of("u-1"));
        User owner = new User();
        owner.setId("u-1");
        UserRole here = new UserRole();
        here.setInstituteId("inst-1");
        UserRole elsewhere = new UserRole();
        elsewhere.setInstituteId("inst-2");
        owner.setRoles(new HashSet<>(Set.of(here, elsewhere)));
        when(users.findById("u-1")).thenReturn(Optional.of(owner));

        service.sendWelcome("evalezy", "inst-1");

        verify(authService).sendWelcomeMailToUser(same(owner), eq("inst-1"), eq(Set.of(here)), same(evalezy));
    }

    @Test
    void noAdminNoMail() {
        when(products.get("evalezy")).thenReturn(Optional.of(evalezy));
        when(jdbc.queryForList(anyString(), eq(String.class), any())).thenReturn(List.of());
        assertThrows(VacademyException.class, () -> service.sendWelcome("evalezy", "inst-1"));
        verifyNoInteractions(authService);
    }

    @Test
    void unknownProductNoMail() {
        when(products.get("nope")).thenReturn(Optional.empty());
        assertThrows(VacademyException.class, () -> service.sendWelcome("nope", "inst-1"));
        verifyNoInteractions(authService);
    }
}
