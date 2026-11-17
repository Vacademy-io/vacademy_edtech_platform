package vacademy.io.admin_core_service.features.commerce.customer;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.transaction.PlatformTransactionManager;
import vacademy.io.admin_core_service.features.commerce.customer.dto.CustomerDtos;
import vacademy.io.admin_core_service.features.commerce.customer.entity.CommerceCustomerAddress;
import vacademy.io.admin_core_service.features.commerce.customer.repository.CommerceCustomerAddressRepository;
import vacademy.io.admin_core_service.features.commerce.customer.repository.CommerceCustomerRepository;
import vacademy.io.admin_core_service.features.commerce.customer.service.CommerceCustomerQueryService;

import java.math.BigDecimal;
import java.util.Date;
import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * The staff customer search: a typed phone matches the stored spelling, LIKE wildcards in a name
 * are taken literally, page and size are clamped, and no search lists every customer. Rows and the
 * profile map to snake_case with the profile-only fields left out of list rows.
 */
class CommerceCustomerQueryServiceTest {

    private static final String INST = "inst-1";

    private CommerceCustomerRepository customers;
    private CommerceCustomerAddressRepository addresses;
    private CommerceCustomerQueryService service;

    @BeforeEach
    void setUp() {
        customers = mock(CommerceCustomerRepository.class);
        addresses = mock(CommerceCustomerAddressRepository.class);
        when(customers.staffSearch(eq(INST), any(), any(), anyInt(), anyLong())).thenReturn(List.of());
        service = new CommerceCustomerQueryService(customers, addresses, mock(PlatformTransactionManager.class));
    }

    @Test
    void aTypedIndianMobileMatchesTheStoredPhone() {
        CommerceCustomerQueryService.Search search = CommerceCustomerQueryService.search(" +91 98765 43210 ");
        assertEquals("919876543210", search.phone());
        assertEquals("%+91 98765 43210%", search.namePattern());
        assertEquals("919876543210", CommerceCustomerQueryService.search("09876543210").phone());

        service.list(INST, "+91 98765 43210", 0, 50);
        verify(customers).staffSearch(INST, "919876543210", "%+91 98765 43210%", 50, 0L);
        verify(customers).staffCount(INST, "919876543210", "%+91 98765 43210%");
    }

    @Test
    void aNameIsMatchedInLowerCaseWithWildcardsTakenLiterally() {
        CommerceCustomerQueryService.Search search = CommerceCustomerQueryService.search("Asha_100%\\x");
        assertNull(search.phone());
        assertEquals("%asha\\_100\\%\\\\x%", search.namePattern());
    }

    @Test
    void aLongSearchIsCutTo64Characters() {
        String pattern = CommerceCustomerQueryService.search("a".repeat(100)).namePattern();
        assertEquals(64 + 2, pattern.length());
    }

    @Test
    void noSearchListsEveryCustomer() {
        CommerceCustomerQueryService.Search blank = CommerceCustomerQueryService.search("   ");
        assertNull(blank.phone());
        assertNull(blank.namePattern());
        service.list(INST, null, 0, 50);
        verify(customers).staffSearch(INST, null, null, 50, 0L);
        verify(customers).staffCount(INST, null, null);
    }

    @Test
    void pageAndSizeAreClamped() {
        CustomerDtos.CustomerPage big = service.list(INST, null, 3, 500);
        assertEquals(50, big.getPageSize());
        assertEquals(3, big.getPage());
        verify(customers).staffSearch(INST, null, null, 50, 150L);

        CustomerDtos.CustomerPage small = service.list(INST, null, -4, 0);
        assertEquals(1, small.getPageSize());
        assertEquals(0, small.getPage());
        verify(customers).staffSearch(INST, null, null, 1, 0L);
    }

    private static CommerceCustomerRepository.StaffRow row() {
        CommerceCustomerRepository.StaffRow row = mock(CommerceCustomerRepository.StaffRow.class);
        when(row.getId()).thenReturn("cust-1");
        when(row.getName()).thenReturn("Asha");
        when(row.getPhone()).thenReturn("919876543210");
        when(row.getOrdersCount()).thenReturn(3L);
        when(row.getTotalSpent()).thenReturn(new BigDecimal("2500.00"));
        when(row.getDues()).thenReturn(new BigDecimal("400.00"));
        when(row.getLastOrderAt()).thenReturn(new Date(1_763_200_000_000L));
        when(row.getCreatedAt()).thenReturn(new Date(1_763_000_000_000L));
        when(row.getCodRefusals()).thenReturn(1);
        when(row.getMarketingConsent()).thenReturn(true);
        when(row.getConsentAt()).thenReturn(new Date(1_763_100_000_000L));
        when(row.getConsentSource()).thenReturn("CHECKOUT");
        when(row.getNotes()).thenReturn("Prefers evening delivery");
        return row;
    }

    @Test
    void listRowsCarryTheTotalsButNotTheProfileFields() {
        CommerceCustomerRepository.StaffRow row = row();
        when(customers.staffSearch(INST, null, null, 50, 0L)).thenReturn(List.of(row));
        when(customers.staffCount(INST, null, null)).thenReturn(1L);

        CustomerDtos.CustomerPage page = service.list(INST, "", 0, 50);

        assertEquals(1L, page.getTotal());
        CustomerDtos.CustomerRow r = page.getCustomers().get(0);
        assertEquals(3L, r.getOrdersCount());
        assertEquals(new BigDecimal("2500.00"), r.getTotalSpent());
        assertEquals(new BigDecimal("400.00"), r.getDues());
        assertEquals("2025-11-15T09:46:40Z", r.getLastOrderAt());
        assertEquals(Boolean.FALSE, r.getAnonymised());
        assertNull(r.getNotes());
        assertNull(r.getConsentAt());
        JsonNode json = new ObjectMapper().valueToTree(page);
        for (String key : List.of("customers", "page", "page_size", "total")) {
            assertTrue(json.has(key), key);
        }
        JsonNode first = json.get("customers").get(0);
        for (String key : List.of("id", "name", "phone", "orders_count", "total_spent", "dues", "last_order_at",
                "cod_refusals", "marketing_consent", "anonymised", "created_at")) {
            assertTrue(first.has(key), key);
        }
        assertFalse(first.has("notes"));
        assertFalse(first.has("email"), "null fields are left out");
    }

    @Test
    void theProfileAddsNotesConsentAndTheActiveAddresses() {
        CommerceCustomerRepository.StaffRow row = row();
        when(customers.findStaffRow(INST, "cust-1")).thenReturn(Optional.of(row));
        CommerceCustomerAddress home = new CommerceCustomerAddress();
        home.setId("addr-1");
        home.setLabel("Home");
        home.setLine1("12 Main Road");
        home.setCity("Test City");
        home.setStateCode("ZZ");
        home.setPincode("100001");
        home.setIsDefault(true);
        when(addresses.findByInstituteIdAndCustomerIdAndStatusOrderByIsDefaultDescCreatedAtDesc(INST, "cust-1",
                CommerceCustomerAddress.STATUS_ACTIVE)).thenReturn(List.of(home));

        CustomerDtos.CustomerProfile profile = service.profile(INST, "cust-1");

        assertEquals("Prefers evening delivery", profile.getCustomer().getNotes());
        assertEquals("CHECKOUT", profile.getCustomer().getConsentSource());
        assertEquals(1, profile.getAddresses().size());
        JsonNode json = new ObjectMapper().valueToTree(profile);
        assertTrue(json.get("customer").has("consent_at"));
        JsonNode address = json.get("addresses").get(0);
        assertEquals("ZZ", address.get("state_code").asText());
        assertTrue(address.get("is_default").asBoolean());
    }

    @Test
    void anUnknownOrOverlongIdIsNotFoundWithoutAQueryForTheLongOne() {
        when(customers.findStaffRow(INST, "nope")).thenReturn(Optional.empty());
        assertTrue(org.junit.jupiter.api.Assertions.assertThrows(vacademy.io.common.exceptions.VacademyException.class,
                () -> service.profile(INST, "nope")).getMessage().startsWith("CUSTOMER_NOT_FOUND:"));
        org.junit.jupiter.api.Assertions.assertThrows(vacademy.io.common.exceptions.VacademyException.class,
                () -> service.profile(INST, "x".repeat(37)));
        verify(customers, org.mockito.Mockito.never()).findStaffRow(INST, "x".repeat(37));
    }
}
