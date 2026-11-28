package vacademy.io.admin_core_service.features.commerce.document.service;

import jakarta.persistence.EntityManager;
import jakarta.persistence.Query;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;
import vacademy.io.admin_core_service.features.commerce.tax.calc.CommerceTaxCalculator;
import vacademy.io.admin_core_service.features.commerce.tax.enums.TaxHead;
import vacademy.io.admin_core_service.features.commerce.tax.enums.TaxMode;
import vacademy.io.admin_core_service.features.commerce.tax.service.CommerceTaxContext;
import vacademy.io.common.exceptions.ConflictException;
import vacademy.io.common.exceptions.InvalidRequestException;

import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/** Who the seller is on a document, and in which state. GSTINs here are made-up TEST values. */
class CommerceSellerLookupTest {

    private static final String INST = "inst-1";
    private static final String MH_GSTIN = "27AAACH7409R1ZZ";
    private static final String DL_GSTIN = "07AAACH7409R1ZZ";

    private final List<Object[]> locationRows = new ArrayList<>();
    private CommerceSellerLookup lookup;

    @BeforeEach
    void setUp() {
        EntityManager entityManager = mock(EntityManager.class);
        Query query = mock(Query.class);
        when(entityManager.createNativeQuery(anyString())).thenReturn(query);
        when(query.setParameter(anyInt(), any())).thenReturn(query);
        when(query.getResultList()).thenAnswer(inv -> new ArrayList<>(locationRows));
        lookup = new CommerceSellerLookup();
        ReflectionTestUtils.setField(lookup, "entityManager", entityManager);
    }

    private void location(String stateCode, String gstin) {
        locationRows.clear();
        locationRows.add(new Object[]{stateCode, gstin, "1 Test Road", null, "Test City", "110001"});
    }

    private static CommerceTaxContext settings(TaxMode mode) {
        return CommerceTaxContext.builder().configured(true).mode(mode)
                .sellerGstin(MH_GSTIN).sellerStateCode("27").sellerLegalName("Test Seller TEST")
                .sellerAddress("Head office").fyStartMonth(4).build();
    }

    /**
     * A stall in Delhi under the Maharashtra GSTIN, buyer in Delhi. The seller state used to be
     * taken from the location (07), which made the sale look local: CGST and SGST printed under
     * a Maharashtra GSTIN. A supply under that registration to Delhi is inter-state.
     */
    @Test
    void aLocationInAnotherStateWithoutItsOwnGstinIsRefusedForARegularSeller() {
        location("07", null);

        ConflictException refused = assertThrows(ConflictException.class,
                () -> lookup.resolve(INST, "loc-delhi", settings(TaxMode.REGULAR)));

        assertTrue(refused.getMessage().startsWith("LOCATION_NEEDS_GSTIN"));
    }

    @Test
    void withItsOwnGstinTheLocationIsTheSellerInItsOwnState() {
        location("07", DL_GSTIN);

        CommerceSellerLookup.Seller seller = lookup.resolve(INST, "loc-delhi", settings(TaxMode.REGULAR));

        assertEquals(DL_GSTIN, seller.getGstin());
        assertEquals("07", seller.getStateCode());
        // A buyer at the stall is then a local sale under the Delhi registration.
        assertEquals(TaxHead.CGST_SGST, new CommerceTaxCalculator().taxHead(TaxMode.REGULAR, seller.getStateCode(), "07"));
    }

    @Test
    void aLocationInTheStateOfTheInstituteGstinSellsUnderIt() {
        location("27", null);

        CommerceSellerLookup.Seller seller = lookup.resolve(INST, "loc-pune", settings(TaxMode.REGULAR));

        assertEquals(MH_GSTIN, seller.getGstin());
        assertEquals("27", seller.getStateCode());
        assertEquals("1 Test Road, Test City, 110001", seller.getAddress());
    }

    @Test
    void inARegularSellerTheStateIsAlwaysTheStateOfTheGstinUsed() {
        for (String[] place : new String[][]{{"27", null}, {"07", DL_GSTIN}, {null, null}, {null, DL_GSTIN}}) {
            location(place[0], place[1]);
            CommerceSellerLookup.Seller seller = lookup.resolve(INST, "loc-x", settings(TaxMode.REGULAR));
            assertEquals(seller.getGstin().substring(0, 2), seller.getStateCode());
        }
    }

    @Test
    void aSellerWhoChargesNoTaxIsNotHeldToTheRule() {
        location("07", null);

        assertEquals("07", lookup.resolve(INST, "loc-delhi", settings(TaxMode.UNREGISTERED)).getStateCode());
    }

    @Test
    void noLocationGivesTheInstituteSellerAndAForeignLocationIsRefused() {
        assertEquals("27", lookup.resolve(INST, null, settings(TaxMode.REGULAR)).getStateCode());

        locationRows.clear();
        assertThrows(InvalidRequestException.class, () -> lookup.resolve(INST, "loc-foreign", settings(TaxMode.REGULAR)));
    }
}
