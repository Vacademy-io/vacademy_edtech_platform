package vacademy.io.admin_core_service.features.commerce.stock.opening;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;
import vacademy.io.admin_core_service.features.capabilities.service.CapabilityResolver;
import vacademy.io.admin_core_service.features.commerce.security.CommerceAccessDeniedException;
import vacademy.io.admin_core_service.features.commerce.security.CommerceAccessGuard;
import vacademy.io.admin_core_service.features.commerce.security.repository.CommerceStaffLocationRepository;
import vacademy.io.admin_core_service.features.commerce.stock.dto.StockOpsDtos;
import vacademy.io.admin_core_service.features.commerce.stock.entity.StockLocation;
import vacademy.io.admin_core_service.features.commerce.stock.opening.OpeningReadinessMath.Items;
import vacademy.io.admin_core_service.features.commerce.stock.opening.OpeningReadinessMath.LaterCount;
import vacademy.io.admin_core_service.features.commerce.stock.opening.OpeningReadinessMath.Receipts;
import vacademy.io.admin_core_service.features.commerce.stock.opening.OpeningReadinessMath.Recount;
import vacademy.io.admin_core_service.features.commerce.stock.repository.StockLocationRepository;
import vacademy.io.common.auth.dto.UserServiceDTO;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.InvalidRequestException;

import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/** The readiness read: who may ask, for which location, and who sees the money. */
class OpeningStockServiceTest {

    private static final String INST = "inst-1";
    private static final String LOC = "loc-1";
    private static final LocalDateTime RECEIVED = LocalDateTime.of(2026, 11, 20, 10, 0);

    private CapabilityResolver capabilities;
    private CommerceStaffLocationRepository staffLocations;
    private StockLocationRepository locations;
    private OpeningReadRepository reads;
    private OpeningStockService service;

    @BeforeEach
    void setUp() {
        capabilities = mock(CapabilityResolver.class);
        staffLocations = mock(CommerceStaffLocationRepository.class);
        locations = mock(StockLocationRepository.class);
        reads = mock(OpeningReadRepository.class);
        service = new OpeningStockService(new CommerceAccessGuard(capabilities, staffLocations), locations, reads);

        when(capabilities.isFeatureGranted(eq(INST), anyString())).thenReturn(true);
        when(staffLocations.existsByInstituteIdAndUserIdAndLocationId(INST, "u-1", LOC)).thenReturn(true);
        StockLocation store = new StockLocation();
        store.setId(LOC);
        when(locations.findByInstituteIdAndId(INST, LOC)).thenReturn(Optional.of(store));

        when(reads.items(INST, LOC)).thenReturn(new Items(20, 20, List.of(), 0, 3));
        when(reads.receipts(INST, LOC)).thenReturn(new Receipts(1, 20, 40, 40, new BigDecimal("4000.00"),
                RECEIVED, List.of()));
        when(reads.countsAfter(INST, LOC, RECEIVED)).thenReturn(List.of(
                new LaterCount("c-1", "COUNT", "POSTED", RECEIVED.plusHours(1)),
                new LaterCount("rc-1", "RECOUNT", "POSTED", RECEIVED.plusHours(2))));
        when(reads.latestRecount(INST, LOC, RECEIVED)).thenReturn(new Recount("rc-1", "CNT-000002", "c-1",
                "CNT-000001", 20, 2, 2, new BigDecimal("100.0"), true, "POSTED"));

        MockHttpServletRequest request = new MockHttpServletRequest();
        request.addHeader("clientId", INST);
        RequestContextHolder.setRequestAttributes(new ServletRequestAttributes(request));
    }

    @AfterEach
    void tearDown() {
        RequestContextHolder.resetRequestAttributes();
    }

    private static CustomUserDetails user(String... authorities) {
        UserServiceDTO dto = new UserServiceDTO();
        dto.setUserId("u-1");
        dto.setUsername("u-1");
        dto.setFullName("Test User");
        dto.setAuthorities(List.of(authorities));
        return new CustomUserDetails(dto);
    }

    @Test
    @SuppressWarnings("unchecked")
    void aManagerSeesTheVerdictAndTheValue() {
        Map<String, Object> answer = service.readiness(user("COMMERCE_STORE_MANAGER"), INST, LOC);

        assertEquals("PASSED", answer.get("status"));
        assertEquals(true, answer.get("ready"));
        Map<String, Object> receipts = (Map<String, Object>) answer.get("receipts");
        assertEquals(new BigDecimal("4000.00"), receipts.get("value"));
        Map<String, Object> recount = (Map<String, Object>) answer.get("recount");
        assertEquals(new BigDecimal("10.0"), recount.get("sample_percent"));
        assertEquals(true, recount.get("passes"));
        Map<String, Object> items = (Map<String, Object>) answer.get("items");
        assertEquals(0L, items.get("without_cost"), "the location's goods are all costed");
        assertEquals(3L, items.get("institute_without_cost"), "other items of the shop, for information");
    }

    @Test
    @SuppressWarnings("unchecked")
    void warehouseStaffGetNoValue() {
        Map<String, Object> answer = service.readiness(user("COMMERCE_WAREHOUSE_STAFF"), INST, LOC);

        Map<String, Object> receipts = (Map<String, Object>) answer.get("receipts");
        assertFalse(receipts.containsKey("value"));
        assertEquals(40L, receipts.get("units_costed"));
        assertEquals(false, answer.get("sees_cost"));
        assertEquals("PASSED", answer.get("status"));
    }

    @Test
    @SuppressWarnings("unchecked")
    void theAccountantSeesTheValue() {
        Map<String, Object> answer = service.readiness(user("COMMERCE_ACCOUNTANT"), INST, LOC);
        assertTrue(((Map<String, Object>) answer.get("receipts")).containsKey("value"));
    }

    @Test
    void anotherLocationIsRefused() {
        CommerceAccessDeniedException refused = assertThrows(CommerceAccessDeniedException.class,
                () -> service.readiness(user("COMMERCE_STORE_MANAGER"), INST, "loc-2"));
        assertEquals(CommerceAccessDeniedException.LOCATION_NOT_ALLOWED, refused.getCode());
        verifyNoInteractions(reads);
    }

    @Test
    void theCashierIsRefused() {
        CommerceAccessDeniedException refused = assertThrows(CommerceAccessDeniedException.class,
                () -> service.readiness(user("COMMERCE_POS_CASHIER"), INST, LOC));
        assertEquals(CommerceAccessDeniedException.ROLE_NOT_ALLOWED, refused.getCode());
    }

    @Test
    void withTheSwitchOverFeatureOffItIsRefused() {
        when(capabilities.isFeatureGranted(INST, "commerce.migration")).thenReturn(false);
        CommerceAccessDeniedException refused = assertThrows(CommerceAccessDeniedException.class,
                () -> service.readiness(user("ADMIN"), INST, LOC));
        assertEquals(CommerceAccessDeniedException.FEATURE_DISABLED, refused.getCode());
        verifyNoInteractions(reads);
    }

    @Test
    void anAdminNamingALocationOfAnotherInstituteIsRefused() {
        assertThrows(InvalidRequestException.class, () -> service.readiness(user("ADMIN"), INST, "loc-x"));
        verifyNoInteractions(reads);
    }

    @Test
    void noOpeningReceiptReadsNoCounts() {
        when(reads.receipts(INST, LOC)).thenReturn(new Receipts(0, 0, 0, 0, null, null, List.of()));
        Map<String, Object> answer = service.readiness(user("ADMIN"), INST, LOC);
        assertEquals("NOT_STARTED", answer.get("status"));
        assertEquals(null, answer.get("recount"));
    }

    @Test
    void theStoredRecountSummaryIsReadByItsFieldNames() throws Exception {
        String summary = new ObjectMapper().writeValueAsString(Map.of("lines", 2, "agreement",
                new StockOpsDtos.Agreement(2, 2, new BigDecimal("100.0"), true)));
        var agreement = OpeningReadRepository.agreementOf(summary);
        assertEquals(2, agreement.path("compared").asInt());
        assertEquals(2, agreement.path("agreeing").asInt());
        assertEquals(new BigDecimal("100.0"), OpeningReadRepository.percentOf(agreement));
        assertTrue(agreement.path("passes").asBoolean());
        assertEquals(new BigDecimal("0.0"), OpeningReadRepository.percentOf(OpeningReadRepository.agreementOf("{")));
    }
}
