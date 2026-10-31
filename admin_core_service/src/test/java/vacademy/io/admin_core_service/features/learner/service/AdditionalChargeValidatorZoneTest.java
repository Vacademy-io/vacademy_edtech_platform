package vacademy.io.admin_core_service.features.learner.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;
import vacademy.io.admin_core_service.features.course_catalogue.entity.CatalogueInstituteMapping;
import vacademy.io.admin_core_service.features.course_catalogue.entity.CourseCatalogue;
import vacademy.io.admin_core_service.features.course_catalogue.repository.CatalogueInstituteMappingRepository;
import vacademy.io.admin_core_service.features.learner.dto.v2.LearnerPackageSessionEnrollmentItemDTO;
import vacademy.io.admin_core_service.features.stock_hold.service.RepeatPurchasePolicyService;
import vacademy.io.common.exceptions.InvalidRequestException;

import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * Zone-priced shipping on a storefront order: the charge line must carry the plan of the zone
 * that serves the delivery PIN — once per order, whatever the copies — and the order cannot skip
 * the PIN or the line. Tier-priced charges (one plan per range of copies) must keep working as
 * before, since live stores price shipping that way.
 */
class AdditionalChargeValidatorZoneTest {

    private static final String INSTITUTE = "inst-1";
    private static final String TAG = "store";
    private static final String BOOK = "ps-book";
    private static final String SHIPPING = "ps-ship";

    private static final String ZONE_CATALOGUE = """
            {"globalSettings": {"payment": {"additionalCharges": [{
              "key": "SHIPPING", "label": "Shipping", "applicableTo": ["COURSE"],
              "packageSessionId": "ps-ship", "enrollInviteId": "inv-ship", "paymentOptionId": "po-ship",
              "tiers": [{"minQty": 1, "maxQty": null, "planId": "plan-tier-ignored", "amount": 50}],
              "planId": "plan-flat-ignored", "amount": 40,
              "zones": [
                {"key": "MAHARASHTRA", "label": "Within Maharashtra",
                 "pinPrefixes": ["40", "41", "42", "43", "44"], "excludePinPrefixes": ["403"],
                 "planId": "plan-mh", "amount": 70},
                {"key": "REST_OF_INDIA", "label": "Rest of India", "planId": "plan-roi", "amount": 90}
              ]}]}}}
            """;

    /** Same charge, but Maharashtra only: there is no catch-all zone. */
    private static final String ZONE_CATALOGUE_NO_CATCH_ALL = """
            {"globalSettings": {"payment": {"additionalCharges": [{
              "key": "SHIPPING", "applicableTo": ["COURSE"],
              "packageSessionId": "ps-ship", "enrollInviteId": "inv-ship", "paymentOptionId": "po-ship",
              "zones": [{"key": "MAHARASHTRA", "pinPrefixes": ["40", "41", "42", "43", "44"],
                         "excludePinPrefixes": ["403"], "planId": "plan-mh", "amount": 70}]}]}}}
            """;

    /** Copies-priced shipping: 1–2 copies one rate, 3+ another. */
    private static final String TIER_CATALOGUE = """
            {"globalSettings": {"payment": {"additionalCharges": [{
              "key": "DELIVERY", "applicableTo": ["COURSE", "MEMBERSHIP"],
              "packageSessionId": "ps-ship", "enrollInviteId": "inv-ship", "paymentOptionId": "po-ship",
              "tiers": [{"minQty": 1, "maxQty": 2, "planId": "plan-small", "amount": 60},
                        {"minQty": 3, "maxQty": null, "planId": "plan-large", "amount": 100}]}]}}}
            """;

    private CatalogueInstituteMappingRepository catalogueRepository;
    private RepeatPurchasePolicyService repeatPurchasePolicyService;
    private AdditionalChargeValidator validator;

    @BeforeEach
    void setUp() {
        catalogueRepository = mock(CatalogueInstituteMappingRepository.class);
        repeatPurchasePolicyService = mock(RepeatPurchasePolicyService.class);
        validator = new AdditionalChargeValidator();
        ReflectionTestUtils.setField(validator, "catalogueInstituteMappingRepository", catalogueRepository);
        ReflectionTestUtils.setField(validator, "repeatPurchasePolicyService", repeatPurchasePolicyService);
        ReflectionTestUtils.setField(validator, "objectMapper", new ObjectMapper());
    }

    private void catalogue(String json) {
        CourseCatalogue courseCatalogue = new CourseCatalogue();
        courseCatalogue.setCatalogueJson(json);
        CatalogueInstituteMapping mapping = new CatalogueInstituteMapping();
        mapping.setCourseCatalogue(courseCatalogue);
        when(catalogueRepository.findByInstituteIdAndTagName(eq(INSTITUTE), eq(TAG), anyList()))
                .thenReturn(Optional.of(mapping));
        when(catalogueRepository.findByInstituteIdAndStatusIn(eq(INSTITUTE), anyList()))
                .thenReturn(List.of(mapping));
    }

    private static LearnerPackageSessionEnrollmentItemDTO line(String packageSessionId, String planId, int quantity) {
        LearnerPackageSessionEnrollmentItemDTO item = new LearnerPackageSessionEnrollmentItemDTO();
        item.setPackageSessionId(packageSessionId);
        item.setPlanId(planId);
        item.setRequestedQuantity(quantity);
        return item;
    }

    private static List<LearnerPackageSessionEnrollmentItemDTO> order(int copies, String shippingPlan) {
        return shippingPlan == null
                ? List.of(line(BOOK, "plan-book", copies))
                : List.of(line(BOOK, "plan-book", copies), line(SHIPPING, shippingPlan, 1));
    }

    private String rejection(String tag, List<LearnerPackageSessionEnrollmentItemDTO> items, String pin) {
        return assertThrows(InvalidRequestException.class,
                () -> validator.validate(INSTITUTE, tag, items, pin)).getMessage();
    }

    // ---- zone charges ----

    @Test
    @DisplayName("the plan of the PIN's zone passes, once per order whatever the copies")
    void rightZonePlanPasses() {
        catalogue(ZONE_CATALOGUE);
        assertDoesNotThrow(() -> validator.validate(INSTITUTE, TAG, order(1, "plan-mh"), "400001"));
        assertDoesNotThrow(() -> validator.validate(INSTITUTE, TAG, order(7, "plan-mh"), "411001"));
        assertDoesNotThrow(() -> validator.validate(INSTITUTE, TAG, order(2, "plan-roi"), "403001"));
        assertDoesNotThrow(() -> validator.validate(INSTITUTE, TAG, order(3, "plan-roi"), " 110001 "));
    }

    @Test
    @DisplayName("another zone's plan is a mismatch — and so are the ignored tier and flat plans")
    void wrongZonePlanIsRejected() {
        catalogue(ZONE_CATALOGUE);
        assertEquals(AdditionalChargeValidator.ZONE_MISMATCH_MESSAGE,
                rejection(TAG, order(1, "plan-mh"), "110001"));
        assertEquals(AdditionalChargeValidator.ZONE_MISMATCH_MESSAGE,
                rejection(TAG, order(1, "plan-roi"), "400001"));
        assertEquals(AdditionalChargeValidator.ZONE_MISMATCH_MESSAGE,
                rejection(TAG, order(1, "plan-tier-ignored"), "400001"));
        assertEquals(AdditionalChargeValidator.ZONE_MISMATCH_MESSAGE,
                rejection(TAG, order(1, "plan-flat-ignored"), "400001"));
    }

    @Test
    @DisplayName("a zone charge needs a valid six-digit PIN")
    void missingOrInvalidPinIsRejected() {
        catalogue(ZONE_CATALOGUE);
        assertEquals(AdditionalChargeValidator.PIN_INVALID_MESSAGE, rejection(TAG, order(1, "plan-mh"), null));
        assertEquals(AdditionalChargeValidator.PIN_INVALID_MESSAGE, rejection(TAG, order(1, "plan-mh"), ""));
        assertEquals(AdditionalChargeValidator.PIN_INVALID_MESSAGE, rejection(TAG, order(1, "plan-mh"), "4000"));
        // Dropping the charge line does not dodge the PIN either.
        assertEquals(AdditionalChargeValidator.PIN_INVALID_MESSAGE, rejection(TAG, order(1, null), "abcdef"));
    }

    @Test
    @DisplayName("a PIN no zone serves is not deliverable, with or without the charge line")
    void unservedPinIsRejected() {
        catalogue(ZONE_CATALOGUE_NO_CATCH_ALL);
        assertEquals(AdditionalChargeValidator.PIN_NOT_SERVED_MESSAGE, rejection(TAG, order(1, "plan-mh"), "110001"));
        assertEquals(AdditionalChargeValidator.PIN_NOT_SERVED_MESSAGE, rejection(TAG, order(1, null), "403001"));
        assertDoesNotThrow(() -> validator.validate(INSTITUTE, TAG, order(1, "plan-mh"), "440001"));
    }

    @Test
    @DisplayName("a serving zone without a plan is not deliverable: no free shipping, no fall-through")
    void unpricedZoneIsNotDeliverable() {
        catalogue("""
                {"globalSettings": {"payment": {"additionalCharges": [{
                  "key": "SHIPPING", "applicableTo": ["COURSE"],
                  "packageSessionId": "ps-ship", "enrollInviteId": "inv-ship", "paymentOptionId": "po-ship",
                  "zones": [{"key": "MAHARASHTRA", "pinPrefixes": ["40"], "amount": 70},
                            {"key": "REST_OF_INDIA", "planId": "plan-roi", "amount": 90}]}]}}}
                """);
        assertEquals(AdditionalChargeValidator.PIN_NOT_SERVED_MESSAGE, rejection(TAG, order(1, null), "400001"));
        assertEquals(AdditionalChargeValidator.PIN_NOT_SERVED_MESSAGE, rejection(TAG, order(1, "plan-roi"), "400001"));
        assertDoesNotThrow(() -> validator.validate(INSTITUTE, TAG, order(1, "plan-roi"), "110001"));
    }

    @Test
    @DisplayName("an order with copies cannot drop the zone charge line, tagged or not")
    void missingZoneChargeIsRejected() {
        catalogue(ZONE_CATALOGUE);
        assertEquals(AdditionalChargeValidator.CHARGE_MISSING_MESSAGE, rejection(TAG, order(2, null), "400001"));
        assertEquals(AdditionalChargeValidator.CHARGE_MISSING_MESSAGE, rejection(null, order(2, null), "560001"));
    }

    @Test
    @DisplayName("a tag-less order is judged against every catalogue of the institute")
    void tagLessZoneOrderIsValidated() {
        catalogue(ZONE_CATALOGUE);
        when(repeatPurchasePolicyService.isChargePackageSession(SHIPPING)).thenReturn(true);
        assertDoesNotThrow(() -> validator.validate(INSTITUTE, null, order(1, "plan-roi"), "560001"));
        assertEquals(AdditionalChargeValidator.ZONE_MISMATCH_MESSAGE,
                rejection(null, order(1, "plan-roi"), "400001"));
        assertEquals(AdditionalChargeValidator.PIN_INVALID_MESSAGE, rejection(null, order(1, "plan-roi"), null));
    }

    // ---- tier charges (unchanged behaviour) ----

    @Test
    @DisplayName("tier charges still follow the copies, and never read the PIN")
    void tierChargesAreValidatedAsBefore() {
        catalogue(TIER_CATALOGUE);
        assertDoesNotThrow(() -> validator.validate(INSTITUTE, TAG, order(2, "plan-small"), null));
        assertDoesNotThrow(() -> validator.validate(INSTITUTE, TAG, order(3, "plan-large"), "not-a-pin"));
        assertEquals(AdditionalChargeValidator.CHARGE_MISMATCH_MESSAGE,
                rejection(TAG, order(3, "plan-small"), null));
        assertEquals(AdditionalChargeValidator.CHARGE_MISMATCH_MESSAGE,
                rejection(TAG, order(1, "plan-large"), "400001"));
        assertEquals(AdditionalChargeValidator.CHARGE_MISSING_MESSAGE, rejection(TAG, order(1, null), null));
        assertEquals(AdditionalChargeValidator.CHARGE_MISSING_MESSAGE, rejection(null, order(4, null), null));
    }
}
