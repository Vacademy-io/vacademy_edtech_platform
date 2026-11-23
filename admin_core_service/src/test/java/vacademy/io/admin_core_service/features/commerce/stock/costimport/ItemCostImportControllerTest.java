package vacademy.io.admin_core_service.features.commerce.stock.costimport;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.ResponseEntity;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;
import vacademy.io.admin_core_service.features.capabilities.catalog.CapabilityCatalogRegistry;
import vacademy.io.admin_core_service.features.capabilities.entity.InstituteModuleEntitlement;
import vacademy.io.admin_core_service.features.capabilities.repository.InstituteModuleEntitlementRepository;
import vacademy.io.admin_core_service.features.capabilities.repository.InstituteModulePolicyRepository;
import vacademy.io.admin_core_service.features.capabilities.service.CapabilityResolver;
import vacademy.io.admin_core_service.features.commerce.catalogue.importer.file.ImportFileParser;
import vacademy.io.admin_core_service.features.commerce.security.CommerceAccessDeniedException;
import vacademy.io.admin_core_service.features.commerce.security.CommerceAccessGuard;
import vacademy.io.admin_core_service.features.commerce.security.CommerceRole;
import vacademy.io.admin_core_service.features.commerce.security.repository.CommerceStaffLocationRepository;
import vacademy.io.common.auth.dto.UserServiceDTO;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.InvalidRequestException;

import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/**
 * The item-costs routes with the real guard and resolver over the shipped catalogue: both the
 * inventory and the switch-over feature are needed, and only the manager, the accountant and an
 * institute ADMIN pass.
 */
class ItemCostImportControllerTest {

    private static final String INSTITUTE = "inst-1";

    private InstituteModuleEntitlementRepository entitlements;
    private CapabilityResolver resolver;
    private ItemCostImportService service;
    private ItemCostImportController controller;
    private MockMultipartFile file;

    @BeforeEach
    void setUp() {
        InstituteModulePolicyRepository policies = mock(InstituteModulePolicyRepository.class);
        when(policies.findById(any())).thenReturn(Optional.empty());
        entitlements = mock(InstituteModuleEntitlementRepository.class);
        resolver = new CapabilityResolver(new CapabilityCatalogRegistry(), policies, entitlements);
        CommerceAccessGuard guard = new CommerceAccessGuard(resolver, mock(CommerceStaffLocationRepository.class));
        service = mock(ItemCostImportService.class);
        controller = new ItemCostImportController(service, guard);
        file = new MockMultipartFile("file", "costs.csv", "text/csv",
                "sku,purchase_price,includes_tax\nTST-0001,10,no\n".getBytes(StandardCharsets.UTF_8));
        grant(true);
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.addHeader("clientId", INSTITUTE);
        RequestContextHolder.setRequestAttributes(new ServletRequestAttributes(request));
    }

    @AfterEach
    void tearDown() {
        RequestContextHolder.resetRequestAttributes();
    }

    private void grant(boolean migration) {
        List<InstituteModuleEntitlement> rows = new ArrayList<>();
        rows.add(row("commerce"));
        if (migration) {
            rows.add(row("commerce.migration"));
        }
        when(entitlements.findByInstituteIdOrderByKeyAsc(INSTITUTE)).thenReturn(rows);
        resolver.evict(INSTITUTE);
    }

    private static InstituteModuleEntitlement row(String key) {
        return InstituteModuleEntitlement.builder().instituteId(INSTITUTE).key(key).enabled(true)
                .updatedAt(Instant.parse("2026-11-20T00:00:00Z")).build();
    }

    private static CustomUserDetails principal(String... authorities) {
        UserServiceDTO dto = new UserServiceDTO();
        dto.setUserId("u-1");
        dto.setUsername("u-1");
        dto.setFullName("Test User");
        dto.setAuthorities(List.of(authorities));
        return new CustomUserDetails(dto);
    }

    private String refusal(CustomUserDetails user) {
        String validate = assertThrows(CommerceAccessDeniedException.class,
                () -> controller.importCosts(user, INSTITUTE, "validate", null, file)).getCode();
        String commit = assertThrows(CommerceAccessDeniedException.class,
                () -> controller.importCosts(user, INSTITUTE, "commit", "t", file)).getCode();
        String template = assertThrows(CommerceAccessDeniedException.class,
                () -> controller.template(user, INSTITUTE, "csv")).getCode();
        assertEquals(validate, commit);
        assertEquals(validate, template);
        return validate;
    }

    @Test
    void warehouseStaffAndTheCashierAreRefused() {
        assertEquals(CommerceAccessDeniedException.ROLE_NOT_ALLOWED,
                refusal(principal(CommerceRole.WAREHOUSE_STAFF.authority())));
        assertEquals(CommerceAccessDeniedException.ROLE_NOT_ALLOWED,
                refusal(principal(CommerceRole.POS_CASHIER.authority())));
        assertEquals(CommerceAccessDeniedException.ROLE_NOT_ALLOWED, refusal(principal("STUDENT")));
        verifyNoInteractions(service);
    }

    @Test
    void withTheSwitchOverFeatureOffEveryRouteIsFeatureDisabled() {
        grant(false);
        assertEquals(CommerceAccessDeniedException.FEATURE_DISABLED, refusal(principal("ADMIN")));
        assertEquals(CommerceAccessDeniedException.FEATURE_DISABLED,
                refusal(principal(CommerceRole.STORE_MANAGER.authority())));
        verifyNoInteractions(service);
    }

    @Test
    void anotherInstitutesCallerIsRefused() {
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.addHeader("clientId", "inst-2");
        RequestContextHolder.setRequestAttributes(new ServletRequestAttributes(request));
        assertEquals(CommerceAccessDeniedException.ACCESS_DENIED, refusal(principal("ADMIN")));
        verifyNoInteractions(service);
    }

    @Test
    void theManagerTheAccountantAndAnAdminPass() {
        for (String authority : List.of(CommerceRole.STORE_MANAGER.authority(), CommerceRole.ACCOUNTANT.authority(),
                "ADMIN")) {
            CustomUserDetails user = principal(authority);
            controller.importCosts(user, INSTITUTE, "validate", null, file);
            controller.importCosts(user, INSTITUTE, "commit", "tok", file);
        }
        verify(service, org.mockito.Mockito.times(3)).validate(any(), any(), any());
        verify(service, org.mockito.Mockito.times(3)).commit(any(), any(), any(), any(), any());
        assertThrows(InvalidRequestException.class,
                () -> controller.importCosts(principal("ADMIN"), INSTITUTE, "apply", null, file));
    }

    @Test
    void theTemplatesHoldTheHeaderTheImportReads() {
        CustomUserDetails admin = principal("ADMIN");
        for (String format : List.of("csv", "xlsx")) {
            ResponseEntity<byte[]> answer = controller.template(admin, INSTITUTE, format);
            List<List<String>> table = ImportFileParser.readTable("t." + format, answer.getBody());
            assertEquals(List.of("sku", "variant_external_ref", "purchase_price", "includes_tax",
                    "gst_rate_percent", "note"), table.get(0));
            ItemCostSheet.Parsed parsed = ItemCostSheet.read(table);
            assertEquals(0, parsed.rows().size());
            assertTrue(answer.getHeaders().getFirst("Content-Disposition").contains("item-costs-template." + format));
        }
        assertThrows(InvalidRequestException.class, () -> controller.template(admin, INSTITUTE, "pdf"));
    }
}
