package vacademy.io.admin_core_service.features.learner.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.Spy;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;
import vacademy.io.admin_core_service.features.course_catalogue.entity.CatalogueInstituteMapping;
import vacademy.io.admin_core_service.features.course_catalogue.entity.CourseCatalogue;
import vacademy.io.admin_core_service.features.course_catalogue.repository.CatalogueInstituteMappingRepository;
import vacademy.io.admin_core_service.features.learner.dto.SecurityDepositStatusDTO;
import vacademy.io.admin_core_service.features.learner.dto.v2.LearnerPackageSessionEnrollmentItemDTO;
import vacademy.io.admin_core_service.features.learner.service.SecurityDepositDueService.Person;
import vacademy.io.admin_core_service.features.packages.repository.PackageSessionRepository;
import vacademy.io.common.auth.dto.UserDTO;
import vacademy.io.common.exceptions.InvalidRequestException;

import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyCollection;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Rent orders (a MEMBERSHIP line) against the catalogue's rent-mode charges: the once-per-user
 * security deposit must be there exactly when it is due, and nothing changes for buy orders or for
 * institutes whose catalogues link no rent charge.
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class AdditionalChargeValidatorRentModeTest {

    private static final String INSTITUTE = "inst-1";
    private static final String TAG = "readonrent";

    private static final String SHIPPING = """
            {"key":"SHIPPING","label":"Shipping","applicableTo":["COURSE"],
             "packageSessionId":"ps-ship","enrollInviteId":"inv-ship","paymentOptionId":"po-ship",
             "tiers":[{"minQty":1,"maxQty":1,"planId":"plan-ship-1","amount":40},
                      {"minQty":2,"maxQty":null,"planId":"plan-ship-2","amount":60}]}""";
    private static final String DEPOSIT = """
            {"key":"SECURITY_DEPOSIT","label":"Refundable security deposit","applicableTo":["MEMBERSHIP"],
             "oncePerUser":true,"refundable":true,
             "packageSessionId":"ps-dep","enrollInviteId":"inv-dep","paymentOptionId":"po-dep",
             "planId":"plan-dep","amount":300}""";
    private static final String RENT_DELIVERY = """
            {"key":"RENT_DELIVERY","label":"Home delivery","applicableTo":["MEMBERSHIP"],
             "packageSessionId":"ps-rent-del","enrollInviteId":"inv-rd","paymentOptionId":"po-rd",
             "planId":"plan-rent-del","amount":50}""";

    @Mock private CatalogueInstituteMappingRepository catalogueInstituteMappingRepository;
    @Mock private PackageSessionRepository packageSessionRepository;
    @Mock private SecurityDepositDueService securityDepositDueService;
    @Spy private ObjectMapper objectMapper = new ObjectMapper();
    @InjectMocks private AdditionalChargeValidator validator;

    private final UserDTO buyer = new UserDTO();

    @BeforeEach
    void setUp() {
        Map<String, String> types = Map.of(
                "ps-mem", "MEMBERSHIP",
                "ps-dep", "SECURITY_DEPOSIT",
                "ps-ship", "DELIVERY_CHARGE",
                "ps-rent-del", "DELIVERY_CHARGE",
                "ps-book", "COURSE");
        when(packageSessionRepository.findStockInfoByIds(anyCollection())).thenAnswer(invocation -> {
            Collection<String> ids = invocation.getArgument(0);
            List<PackageSessionRepository.StockInfoProjection> rows = new ArrayList<>();
            for (String id : ids) {
                if (types.containsKey(id)) {
                    rows.add(stockInfo(id, types.get(id)));
                }
            }
            return rows;
        });
        when(securityDepositDueService.buyer(any(), anyString())).thenReturn(new Person("", "9876543210"));
        when(securityDepositDueService.signedInUser(anyString(), anyString())).thenReturn(new Person("u-1", ""));
        catalogue(SHIPPING, DEPOSIT);
    }

    private static PackageSessionRepository.StockInfoProjection stockInfo(String id, String packageType) {
        PackageSessionRepository.StockInfoProjection info = mock(PackageSessionRepository.StockInfoProjection.class);
        when(info.getPackageSessionId()).thenReturn(id);
        when(info.getPackageType()).thenReturn(packageType);
        return info;
    }

    /** The tagged catalogue, which is also the institute's only one, with these charges. */
    private void catalogue(String... charges) {
        CourseCatalogue catalogue = new CourseCatalogue();
        catalogue.setCatalogueJson("{\"globalSettings\":{\"payment\":{\"additionalCharges\":["
                + String.join(",", charges) + "]}}}");
        CatalogueInstituteMapping mapping = new CatalogueInstituteMapping();
        mapping.setCourseCatalogue(catalogue);
        when(catalogueInstituteMappingRepository.findByInstituteIdAndTagName(eq(INSTITUTE), eq(TAG), anyList()))
                .thenReturn(Optional.of(mapping));
        when(catalogueInstituteMappingRepository.findByInstituteIdAndStatusIn(eq(INSTITUTE), anyList()))
                .thenReturn(List.of(mapping));
    }

    private void depositDue(boolean due) {
        when(securityDepositDueService.isDue(any(), eq(INSTITUTE))).thenReturn(due);
    }

    private static LearnerPackageSessionEnrollmentItemDTO line(String packageSessionId, String planId) {
        LearnerPackageSessionEnrollmentItemDTO item = new LearnerPackageSessionEnrollmentItemDTO();
        item.setPackageSessionId(packageSessionId);
        item.setPlanId(planId);
        item.setRequestedQuantity(1);
        return item;
    }

    private static final LearnerPackageSessionEnrollmentItemDTO MEMBERSHIP = line("ps-mem", "plan-mem");

    /** Both checks, as MultiPackageLearnerEnrollService runs them on a paid storefront order. */
    private void checkOrder(String tag, List<LearnerPackageSessionEnrollmentItemDTO> items) {
        validator.validate(INSTITUTE, tag, items);
        validator.validateRentMode(INSTITUTE, tag, items, buyer);
    }

    @Test
    void aDueDepositInTheOrderPasses() {
        depositDue(true);

        assertDoesNotThrow(() -> checkOrder(TAG, List.of(MEMBERSHIP, line("ps-dep", "plan-dep"))));
    }

    @Test
    void aDueDepositMissingIsRefused() {
        depositDue(true);

        InvalidRequestException e = assertThrows(InvalidRequestException.class,
                () -> checkOrder(TAG, List.of(MEMBERSHIP)));
        assertTrue(e.getMessage().startsWith("SECURITY_DEPOSIT_MISSING"), e.getMessage());
    }

    @Test
    void aDepositNotDueInTheOrderIsRefused() {
        depositDue(false);

        InvalidRequestException e = assertThrows(InvalidRequestException.class,
                () -> checkOrder(TAG, List.of(MEMBERSHIP, line("ps-dep", "plan-dep"))));
        assertTrue(e.getMessage().startsWith("SECURITY_DEPOSIT_NOT_DUE"), e.getMessage());
    }

    @Test
    void aMembershipAloneWhenNotDuePassesAndIsNoCopyForShipping() {
        // The shipping tier covers 1 copy: counting the membership as a copy would demand it.
        depositDue(false);

        assertDoesNotThrow(() -> checkOrder(TAG, List.of(MEMBERSHIP)));
    }

    @Test
    void aDepositOnTheWrongPlanIsRefused() {
        depositDue(true);

        InvalidRequestException e = assertThrows(InvalidRequestException.class,
                () -> checkOrder(TAG, List.of(MEMBERSHIP, line("ps-dep", "plan-cheap"))));
        assertEquals(AdditionalChargeValidator.RENT_CHARGE_MISMATCH_MESSAGE, e.getMessage());
    }

    @Test
    void droppingTheTagDoesNotSkipTheDeposit() {
        depositDue(true);

        InvalidRequestException e = assertThrows(InvalidRequestException.class,
                () -> checkOrder(null, List.of(MEMBERSHIP)));
        assertTrue(e.getMessage().startsWith("SECURITY_DEPOSIT_MISSING"), e.getMessage());
    }

    @Test
    void aRentChargeThatIsNotOncePerUserIsAlwaysRequired() {
        catalogue(SHIPPING, DEPOSIT, RENT_DELIVERY);
        depositDue(false);

        InvalidRequestException e = assertThrows(InvalidRequestException.class,
                () -> checkOrder(TAG, List.of(MEMBERSHIP)));
        assertEquals(AdditionalChargeValidator.RENT_CHARGE_MISSING_MESSAGE, e.getMessage());

        assertDoesNotThrow(() -> checkOrder(TAG, List.of(MEMBERSHIP, line("ps-rent-del", "plan-rent-del"))));
    }

    @Test
    void anInstituteWithoutRentChargesIsUnaffected() {
        catalogue(SHIPPING);

        assertDoesNotThrow(() -> checkOrder(TAG, List.of(MEMBERSHIP)));
        // Buy orders are judged exactly as before: shipping still required and still tiered.
        InvalidRequestException missing = assertThrows(InvalidRequestException.class,
                () -> checkOrder(TAG, List.of(line("ps-book", "plan-book"))));
        assertEquals(AdditionalChargeValidator.CHARGE_MISSING_MESSAGE, missing.getMessage());
        LearnerPackageSessionEnrollmentItemDTO twoCopies = line("ps-book", "plan-book");
        twoCopies.setRequestedQuantity(2);
        InvalidRequestException wrongTier = assertThrows(InvalidRequestException.class,
                () -> checkOrder(TAG, List.of(twoCopies, line("ps-ship", "plan-ship-1"))));
        assertEquals(AdditionalChargeValidator.CHARGE_MISMATCH_MESSAGE, wrongTier.getMessage());
        assertDoesNotThrow(() -> checkOrder(TAG, List.of(twoCopies, line("ps-ship", "plan-ship-2"))));

        verify(securityDepositDueService, never()).isDue(any(), any());
    }

    @Test
    void aBuyOrderNeverAsksAboutTheDeposit() {
        assertDoesNotThrow(() -> checkOrder(TAG, List.of(line("ps-book", "plan-book"), line("ps-ship", "plan-ship-1"))));

        verify(securityDepositDueService, never()).isDue(any(), any());
        verify(securityDepositDueService, never()).buyer(any(), any());
    }

    @Test
    void statusReportsTheDepositAndWhetherItIsDue() {
        depositDue(true);

        SecurityDepositStatusDTO status = validator.securityDepositStatus(INSTITUTE, TAG, "u-1");

        assertTrue(status.isDue());
        assertEquals("SECURITY_DEPOSIT", status.getChargeKey());
        assertEquals(300.0, status.getAmount());
        verify(securityDepositDueService).signedInUser("u-1", INSTITUTE);
    }

    @Test
    void statusWithoutAOncePerUserRentChargeIsNotDue() {
        catalogue(SHIPPING, RENT_DELIVERY);

        SecurityDepositStatusDTO status = validator.securityDepositStatus(INSTITUTE, TAG, "u-1");

        assertFalse(status.isDue());
        assertNull(status.getChargeKey());
        assertEquals(0.0, status.getAmount());
        verify(securityDepositDueService, never()).isDue(any(), any());
    }
}
