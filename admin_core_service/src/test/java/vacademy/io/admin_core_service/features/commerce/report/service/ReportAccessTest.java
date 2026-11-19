package vacademy.io.admin_core_service.features.commerce.report.service;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.commerce.report.repository.ReportReadRepository;
import vacademy.io.admin_core_service.features.commerce.security.CommerceAccessDeniedException;
import vacademy.io.admin_core_service.features.commerce.security.CommerceAccessGuard;
import vacademy.io.admin_core_service.features.commerce.security.CommerceFeature;
import vacademy.io.admin_core_service.features.commerce.stock.controller.StockAccess;
import vacademy.io.common.auth.dto.UserServiceDTO;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** Feature, role and location rules of the reports (contract section 3.5). */
class ReportAccessTest {

    private static final String INSTITUTE = "inst-1";

    private CommerceAccessGuard guard;
    private StockAccess stockAccess;
    private ReportReadRepository repository;
    private ReportAccess access;

    @BeforeEach
    void setUp() {
        guard = mock(CommerceAccessGuard.class);
        stockAccess = mock(StockAccess.class);
        repository = mock(ReportReadRepository.class);
        when(repository.locationIds(INSTITUTE)).thenReturn(List.of("L1", "L2"));
        access = new ReportAccess(guard, stockAccess, repository);
    }

    private static CustomUserDetails user(String... authorities) {
        UserServiceDTO dto = new UserServiceDTO();
        dto.setUserId("u-1");
        dto.setUsername("u-1");
        dto.setFullName("Test User");
        dto.setAuthorities(List.of(authorities));
        return new CustomUserDetails(dto);
    }

    private void assigned(CustomUserDetails user, String... locations) {
        when(stockAccess.visibleLocationIds(user, INSTITUTE)).thenReturn(new LinkedHashSet<>(List.of(locations)));
    }

    @Test
    void anAdminSeesEveryLocationAndDocumentsWithout() {
        CustomUserDetails admin = user("ADMIN");
        ReportScope scope = access.require(ReportAccess.Kind.GST, admin, INSTITUTE, null);
        assertTrue(scope.admin());
        assertTrue(scope.allLocations());
        assertNull(scope.locationIn());
        assertEquals(Set.of("L2"), access.require(ReportAccess.Kind.ORDERS, admin, INSTITUTE, "L2").locationIn());
    }

    @Test
    void anAdminNamesOnlyALocationOfTheInstitute() {
        CustomUserDetails admin = user("ADMIN");
        CommerceAccessDeniedException e = assertThrows(CommerceAccessDeniedException.class,
                () -> access.require(ReportAccess.Kind.ORDERS, admin, INSTITUTE, "L9"));
        assertEquals("LOCATION_NOT_ALLOWED", e.getCode());
        CommerceAccessDeniedException zero = assertThrows(CommerceAccessDeniedException.class,
                () -> access.require(ReportAccess.Kind.ORDERS, admin, INSTITUTE, "L1\u0000X"));
        assertEquals("LOCATION_NOT_ALLOWED", zero.getCode());
    }

    @Test
    void anInactivePlaceStillCountsForEveryLocation() {
        // L3 is INACTIVE: a reader assigned to L1 and L2 is not "every location" and sees L1 and L2 only.
        when(repository.locationIds(INSTITUTE)).thenReturn(List.of("L1", "L2", "L3"));
        CustomUserDetails manager = user("COMMERCE_STORE_MANAGER");
        assigned(manager, "L1", "L2");
        CommerceAccessDeniedException gst = assertThrows(CommerceAccessDeniedException.class,
                () -> access.gst(manager, INSTITUTE, null));
        assertEquals("LOCATION_NOT_ALLOWED", gst.getCode());
        ReportScope sales = access.require(ReportAccess.Kind.ORDERS, manager, INSTITUTE, null);
        assertFalse(sales.allLocations());
        assertEquals(Set.of("L1", "L2"), sales.locationIn());
    }

    @Test
    void anInstituteWithNoLocationGivesEveryLocationToAdminOnly() {
        when(repository.locationIds(INSTITUTE)).thenReturn(List.of());
        CustomUserDetails accountant = user("COMMERCE_ACCOUNTANT");
        assigned(accountant);
        assertThrows(CommerceAccessDeniedException.class, () -> access.gst(accountant, INSTITUTE, null));
        ReportScope scope = access.require(ReportAccess.Kind.ORDERS, accountant, INSTITUTE, null);
        assertFalse(scope.allLocations());
        assertEquals(Set.of(), scope.locationIn());
    }

    @Test
    void placesAreTheCallersLocationsWithWhatTheyMayOpen() {
        when(repository.places(INSTITUTE)).thenReturn(List.of(
                new ReportReadRepository.Place("L1", "C1", "One", "09AAACH7409R1ZZ", "ACTIVE"),
                new ReportReadRepository.Place("L2", "C2", "Two", "09AAACH7409R2ZY", "INACTIVE")));
        when(guard.featureOn(INSTITUTE, CommerceFeature.REPORTS)).thenReturn(true);
        when(guard.featureOn(INSTITUTE, CommerceFeature.ORDERS)).thenReturn(true);
        ReportAccess.Places admin = access.places(user("ADMIN"), INSTITUTE);
        assertEquals(List.of("L1", "L2"), admin.places().stream().map(ReportReadRepository.Place::id).toList());
        assertTrue(admin.allPlaces());
        assertTrue(admin.gstReports());

        CustomUserDetails accountant = user("COMMERCE_ACCOUNTANT");
        assigned(accountant, "L2");
        ReportAccess.Places mine = access.places(accountant, INSTITUTE);
        assertEquals(List.of("L2"), mine.places().stream().map(ReportReadRepository.Place::id).toList());
        assertEquals("09AAACH7409R2ZY", mine.places().get(0).gstin());
        assertFalse(mine.allPlaces());
        assertFalse(mine.gstReports(), "a location-limited reader is refused the GST reports");
        assertTrue(mine.taxReports());
        assertTrue(mine.orders());
        verify(guard).requireEither(accountant, INSTITUTE, CommerceFeature.REPORTS, ReportAccess.READERS,
                CommerceFeature.ORDERS, ReportAccess.READERS);
    }

    @Test
    void anAccountantAtEveryLocationGetsTheGstPack() {
        CustomUserDetails accountant = user("COMMERCE_ACCOUNTANT");
        assigned(accountant, "L1", "L2");
        ReportScope scope = access.gst(accountant, INSTITUTE, null);
        assertTrue(scope.allLocations());
        assertNull(scope.locationIn());
        verify(guard).require(eq(accountant), eq(INSTITUTE), eq(CommerceFeature.REPORTS), eq(ReportAccess.READERS));
    }

    @Test
    void aLocationLimitedAccountantIsRefusedTheGstPackButSeesOwnSales() {
        CustomUserDetails accountant = user("COMMERCE_ACCOUNTANT");
        assigned(accountant, "L2");
        CommerceAccessDeniedException gst = assertThrows(CommerceAccessDeniedException.class,
                () -> access.gst(accountant, INSTITUTE, null));
        assertEquals("LOCATION_NOT_ALLOWED", gst.getCode());

        ReportScope sales = access.require(ReportAccess.Kind.ORDERS, accountant, INSTITUTE, null);
        assertFalse(sales.allLocations());
        assertEquals(Set.of("L2"), sales.locationIn());
        verify(guard).require(eq(accountant), eq(INSTITUTE), eq(CommerceFeature.ORDERS), eq(ReportAccess.READERS));

        CommerceAccessDeniedException other = assertThrows(CommerceAccessDeniedException.class,
                () -> access.require(ReportAccess.Kind.ORDERS, accountant, INSTITUTE, "L1"));
        assertEquals("LOCATION_NOT_ALLOWED", other.getCode());
        assertEquals(Set.of("L2"), access.require(ReportAccess.Kind.COUNTER, accountant, INSTITUTE, "L2").locationIn());
    }

    @Test
    void aStaffMemberWithNoLocationSeesNothing() {
        CustomUserDetails manager = user("COMMERCE_STORE_MANAGER");
        assigned(manager);
        assertEquals(Set.of(), access.require(ReportAccess.Kind.ORDERS, manager, INSTITUTE, null).locationIn());
    }

    @Test
    void theGuardsRefusalStands() {
        CustomUserDetails cashier = user("COMMERCE_POS_CASHIER");
        doThrow(new CommerceAccessDeniedException(CommerceAccessDeniedException.ROLE_NOT_ALLOWED, "no"))
                .when(guard).require(eq(cashier), any(), any(), any());
        CommerceAccessDeniedException e = assertThrows(CommerceAccessDeniedException.class,
                () -> access.require(ReportAccess.Kind.COUNTER, cashier, INSTITUTE, null));
        assertEquals("ROLE_NOT_ALLOWED", e.getCode());
    }

    @Test
    void theAuditListTakesEitherFeature() {
        CustomUserDetails manager = user("COMMERCE_STORE_MANAGER");
        assigned(manager, "L1");
        access.require(ReportAccess.Kind.AUDIT, manager, INSTITUTE, null);
        verify(guard).requireEither(manager, INSTITUTE, CommerceFeature.REPORTS, ReportAccess.READERS,
                CommerceFeature.ORDERS, ReportAccess.READERS);
    }

    @Test
    void everyReportNameHasARule() {
        assertEquals(ReportAccess.Kind.GST, ReportAccess.kindOf("gst-pack"));
        assertEquals(ReportAccess.Kind.COUNTER, ReportAccess.kindOf("day-book"));
        assertEquals(ReportAccess.Kind.ORDERS, ReportAccess.kindOf("customer-dues"));
        assertNull(ReportAccess.kindOf("stock-valuation"));
        assertEquals(14, ReportAccess.REPORT_KINDS.size(), "13 reports and the GST pack");
    }
}
