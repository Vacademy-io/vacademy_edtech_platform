package vacademy.io.admin_core_service.features.institute_api.service;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.http.HttpStatus;
import vacademy.io.admin_core_service.features.institute_api.dto.ApiKeyVerifyResponse;
import vacademy.io.admin_core_service.features.institute_api.dto.IssueApiKeyRequest;
import vacademy.io.admin_core_service.features.institute_api.entity.InstituteApiKey;
import vacademy.io.admin_core_service.features.institute_api.repository.InstituteApiAccessRepository;
import vacademy.io.admin_core_service.features.institute_api.repository.InstituteApiKeyRepository;
import vacademy.io.common.auth.dto.UserServiceDTO;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.VacademyException;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.*;

/** The self-serve catalog product (publishable Catalogue API keys, vak_pub_). */
class InstituteApiKeyServiceCatalogTest {

    private static final String INSTITUTE = "inst-1";
    private static final Instant NOW = Instant.parse("2026-10-15T10:00:00Z");

    private InstituteApiKeyRepository keyRepository;
    private InstituteApiAccessRepository accessRepository;
    private InstituteApiKeyService service;

    @BeforeEach
    void setUp() {
        keyRepository = mock(InstituteApiKeyRepository.class);
        accessRepository = mock(InstituteApiAccessRepository.class);
        service = new InstituteApiKeyService(keyRepository, accessRepository, mock(InstituteApiAuditWriter.class));
        service.setClock(Clock.fixed(NOW, ZoneOffset.UTC));
    }

    private static CustomUserDetails admin() {
        UserServiceDTO dto = new UserServiceDTO();
        dto.setUserId("admin-1");
        dto.setUsername("admin@school.test");
        dto.setAuthorities(List.of("ADMIN"));
        return new CustomUserDetails(dto);
    }

    private InstituteApiKey issue(List<String> scopes) {
        IssueApiKeyRequest r = IssueApiKeyRequest.builder().name("Website").product("catalog").scopes(scopes).build();
        InstituteApiKeyService.IssuedKey issued = service.issue(INSTITUTE, r, admin(), InstituteApiKey.VIA_DASHBOARD);
        ArgumentCaptor<InstituteApiKey> saved = ArgumentCaptor.forClass(InstituteApiKey.class);
        verify(keyRepository).save(saved.capture());
        assertTrue(issued.plaintext().matches("^vak_pub_[0-9a-f]{48}$"), issued.plaintext());
        assertEquals(ApiKeySecrets.sha256Hex(issued.plaintext()), saved.getValue().getKeyHash());
        assertFalse(saved.getValue().getKeyHash().contains(issued.plaintext()));
        return saved.getValue();
    }

    @Test
    void selfServeWithBothScopesByDefault() {
        InstituteApiKey row = issue(null);
        verify(accessRepository, never()).findForUpdate(anyString(), anyString());
        assertArrayEquals(new String[]{"catalog"}, row.getProducts());
        assertArrayEquals(new String[]{"catalog:read", "leads:write"}, row.getScopes());
        assertTrue(row.getKeyPrefix().startsWith("vak_pub_"));
        assertNull(row.getDailyCopyCap());
    }

    @Test
    void scopesCanBeNarrowedToReadOnly() {
        assertArrayEquals(new String[]{"catalog:read"}, issue(List.of("catalog:read")).getScopes());
    }

    @Test
    void otherProductsScopesAreRefused() {
        IssueApiKeyRequest r = IssueApiKeyRequest.builder().name("Website").product("catalog")
                .scopes(List.of("calls:write")).build();
        VacademyException e = assertThrows(VacademyException.class,
                () -> service.issue(INSTITUTE, r, admin(), InstituteApiKey.VIA_DASHBOARD));
        assertEquals(HttpStatus.BAD_REQUEST, e.getStatus());
        verify(keyRepository, never()).save(any());
    }

    @Test
    void verifyReportsACatalogKeyAsEnabledWithoutAnAccessRow() {
        InstituteApiKey key = InstituteApiKey.builder().id("k1").instituteId(INSTITUTE).name("Website")
                .keyPrefix("vak_pub_01234567").keyHash("b".repeat(64))
                .products(new String[]{"catalog"}).scopes(new String[]{"catalog:read", "leads:write"})
                .status(InstituteApiKey.STATUS_ACTIVE).createdAt(NOW).build();
        when(keyRepository.findByKeyHash("b".repeat(64))).thenReturn(Optional.of(key));
        ApiKeyVerifyResponse v = service.verify("b".repeat(64), null).orElseThrow();
        assertEquals(List.of("catalog"), v.products());
        assertTrue(v.accessEnabled());
        verify(accessRepository, never()).findByInstituteIdAndProduct(anyString(), anyString());
    }
}
