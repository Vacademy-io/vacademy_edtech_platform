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

/** The self-serve ai_calling product (Telleo API keys). */
class InstituteApiKeyServiceAiCallingTest {

    private static final String INSTITUTE = "inst-1";
    private static final Instant NOW = Instant.parse("2026-10-13T10:00:00Z");

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
        IssueApiKeyRequest r = IssueApiKeyRequest.builder().name("CRM").product("ai_calling").scopes(scopes).build();
        InstituteApiKeyService.IssuedKey issued = service.issue(INSTITUTE, r, admin(), InstituteApiKey.VIA_DASHBOARD);
        ArgumentCaptor<InstituteApiKey> saved = ArgumentCaptor.forClass(InstituteApiKey.class);
        verify(keyRepository).save(saved.capture());
        assertTrue(issued.plaintext().matches("^vak_call_[0-9a-f]{48}$"), issued.plaintext());
        assertEquals(ApiKeySecrets.sha256Hex(issued.plaintext()), saved.getValue().getKeyHash());
        return saved.getValue();
    }

    @Test
    void selfServeNeedsNoAccessRowAndGetsEveryScopeByDefault() {
        InstituteApiKey row = issue(null);
        verify(accessRepository, never()).findForUpdate(anyString(), anyString());
        assertArrayEquals(new String[]{"ai_calling"}, row.getProducts());
        assertArrayEquals(new String[]{"calls:read", "calls:write", "webhooks:manage"}, row.getScopes());
        assertNull(row.getDailyCopyCap());
    }

    @Test
    void humanCallScopesAreOnlyGrantedWhenNamed() {
        // A default key (and every key issued before v1.2) cannot ring staff or list them.
        InstituteApiKey row = issue(List.of("calls:read", "calls:write", "webhooks:manage",
                "human_calls:read", "human_calls:write"));
        assertArrayEquals(new String[]{"calls:read", "calls:write", "webhooks:manage", "human_calls:read",
                "human_calls:write"}, row.getScopes());
        assertFalse(InstituteApiKeyService.AI_CALLING_SCOPES.contains("human_calls:write"));
        assertFalse(InstituteApiKeyService.AI_CALLING_SCOPES.contains("human_calls:read"));
    }

    @Test
    void managementScopesAreOptInAndAccepted() {
        InstituteApiKey row = issue(List.of("calls:read", "counsellors:manage", "agents:manage"));
        assertArrayEquals(new String[]{"calls:read", "counsellors:manage", "agents:manage"}, row.getScopes());
        assertFalse(InstituteApiKeyService.AI_CALLING_SCOPES.contains("counsellors:manage"));
        assertFalse(InstituteApiKeyService.AI_CALLING_SCOPES.contains("agents:manage"));
    }

    @Test
    void scopesCanBeNarrowed() {
        InstituteApiKey row = issue(List.of("calls:read"));
        assertArrayEquals(new String[]{"calls:read"}, row.getScopes());
    }

    @Test
    void evaluationScopesAreRefusedOnAnAiCallingKey() {
        IssueApiKeyRequest r = IssueApiKeyRequest.builder().name("CRM").product("ai_calling")
                .scopes(List.of("evaluation:read")).build();
        VacademyException e = assertThrows(VacademyException.class,
                () -> service.issue(INSTITUTE, r, admin(), InstituteApiKey.VIA_DASHBOARD));
        assertEquals(HttpStatus.BAD_REQUEST, e.getStatus());
        verify(keyRepository, never()).save(any());
    }

    @Test
    void verifyReportsAnAiCallingKeyAsEnabledWithoutAnAccessRow() {
        InstituteApiKey key = InstituteApiKey.builder().id("k1").instituteId(INSTITUTE).name("CRM")
                .keyPrefix("vak_call_0123456").keyHash("a".repeat(64))
                .products(new String[]{"ai_calling"}).scopes(new String[]{"calls:read"})
                .status(InstituteApiKey.STATUS_ACTIVE).createdAt(NOW).build();
        when(keyRepository.findByKeyHash("a".repeat(64))).thenReturn(Optional.of(key));
        ApiKeyVerifyResponse v = service.verify("a".repeat(64), null).orElseThrow();
        assertEquals(INSTITUTE, v.instituteId());
        assertEquals(List.of("ai_calling"), v.products());
        assertTrue(v.accessEnabled());
        verify(accessRepository, never()).findByInstituteIdAndProduct(anyString(), anyString());
    }
}
