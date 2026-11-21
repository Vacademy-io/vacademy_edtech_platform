package vacademy.io.admin_core_service.features.commerce.accounts.supplier;

import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import vacademy.io.admin_core_service.features.commerce.accounts.enums.RegistrationType;
import vacademy.io.admin_core_service.features.commerce.accounts.supplier.SupplierDtos.SupplierRequest;
import vacademy.io.admin_core_service.features.commerce.accounts.supplier.SupplierRules.Draft;
import vacademy.io.admin_core_service.features.commerce.accounts.supplier.SupplierRules.PanAction;
import vacademy.io.admin_core_service.features.commerce.tax.service.GstinValidator;
import vacademy.io.admin_core_service.features.platform_billing.service.IndianStates;
import vacademy.io.common.exceptions.InvalidRequestException;
import vacademy.io.common.exceptions.VacademyException;

import java.util.function.Consumer;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class SupplierRulesTest {

    static final String PAN = TestGstin.pan("AAAPZ", 1234, 'C');
    static final String GSTIN = TestGstin.valid("27", PAN);

    static SupplierRequest base() {
        SupplierRequest r = new SupplierRequest();
        r.setName("Test Supplier One");
        r.setCity("Test City");
        r.setPincode("100001");
        r.setStateCode("27");
        return r;
    }

    private static SupplierRequest with(Consumer<SupplierRequest> change) {
        SupplierRequest r = base();
        change.accept(r);
        return r;
    }

    private static String validation(SupplierRequest r) {
        InvalidRequestException e = assertThrows(InvalidRequestException.class, () -> SupplierRules.check(r));
        assertTrue(e.getMessage().startsWith("VALIDATION: "), e.getMessage());
        return e.getMessage();
    }

    private static VacademyException unprocessable(SupplierRequest r, String code) {
        VacademyException e = assertThrows(VacademyException.class, () -> SupplierRules.check(r));
        assertEquals(HttpStatus.UNPROCESSABLE_ENTITY, e.getStatus());
        assertTrue(e.getMessage().startsWith(code + ": "), e.getMessage());
        return e;
    }

    // ── GSTIN ───────────────────────────────────────────────────────────────

    @Test
    void validGstinDefaultsToRegularAndDerivesTheState() {
        Draft d = SupplierRules.check(with(r -> {
            r.setStateCode(null);
            r.setGstin(" " + GSTIN.toLowerCase() + " ");
        }));
        assertEquals(GSTIN, d.gstin);
        assertEquals("27", d.stateCode);
        assertEquals(RegistrationType.REGULAR, d.registrationType);
        assertEquals("IN", d.countryCode);
    }

    @Test
    void gstinWithWrongCheckDigitIsInvalidGstin() {
        String wrong = TestGstin.withWrongCheck("27", PAN);
        unprocessable(with(r -> r.setGstin(wrong)), SupplierRules.INVALID_GSTIN);
    }

    @Test
    void sameValuePassesTheCreditsRule() {
        String wrong = TestGstin.withWrongCheck("27", PAN);
        // The credits flow checks shape and state only, and stays as it is.
        assertTrue(IndianStates.isValidGstin(wrong));
        assertFalse(GstinValidator.isValid(wrong));
        assertFalse(SupplierRules.isValidSupplierGstin(wrong));
        assertTrue(SupplierRules.isValidSupplierGstin(GSTIN));
    }

    @Test
    void unknownStateIsInvalidGstin() {
        // 99 has a valid check character but is not a known state code.
        String unknown = TestGstin.valid("99", PAN);
        assertTrue(GstinValidator.isValid(unknown));
        unprocessable(with(r -> {
            r.setStateCode(null);
            r.setGstin(unknown);
        }), SupplierRules.INVALID_GSTIN);
    }

    @Test
    void stateMismatchIs422() {
        unprocessable(with(r -> {
            r.setStateCode("29");
            r.setGstin(GSTIN);
        }), SupplierRules.GSTIN_STATE_MISMATCH);
    }

    @Test
    void registrationTypeAndGstinMustAgree() {
        validation(with(r -> r.setRegistrationType("REGULAR")));
        validation(with(r -> r.setRegistrationType("COMPOSITION")));
        validation(with(r -> {
            r.setRegistrationType("UNREGISTERED");
            r.setGstin(GSTIN);
        }));
        validation(with(r -> r.setRegistrationType("OTHER")));
        Draft composition = SupplierRules.check(with(r -> {
            r.setRegistrationType("composition");
            r.setGstin(GSTIN);
        }));
        assertEquals(RegistrationType.COMPOSITION, composition.registrationType);
        Draft unregistered = SupplierRules.check(base());
        assertEquals(RegistrationType.UNREGISTERED, unregistered.registrationType);
        assertNull(unregistered.gstin);
    }

    @Test
    void stateAndCountryRules() {
        validation(with(r -> r.setStateCode(null)));
        validation(with(r -> r.setStateCode("00")));
        validation(with(r -> r.setCountryCode("India")));
        // Outside India: no state code, no GSTIN.
        validation(with(r -> r.setCountryCode("AE")));
        Draft abroad = SupplierRules.check(with(r -> {
            r.setCountryCode("ae");
            r.setStateCode(null);
        }));
        assertEquals("AE", abroad.countryCode);
        assertNull(abroad.stateCode);
        validation(with(r -> {
            r.setCountryCode("AE");
            r.setStateCode(null);
            r.setGstin(GSTIN);
        }));
    }

    // ── PAN ─────────────────────────────────────────────────────────────────

    @Test
    void panIsNormalisedAndItsAbsenceOrBlankMeanUnchangedOrRemove() {
        assertEquals(PanAction.UNCHANGED, SupplierRules.check(base()).panAction);
        Draft remove = SupplierRules.check(with(r -> r.setPan("")));
        assertEquals(PanAction.REMOVE, remove.panAction);
        assertNull(remove.pan);
        Draft set = SupplierRules.check(with(r -> r.setPan(" " + PAN.toLowerCase() + " ")));
        assertEquals(PanAction.SET, set.panAction);
        assertEquals(PAN, set.pan);
        assertFalse(set.toString().contains(PAN));
    }

    @Test
    void invalidPanIs422WithoutTheValue() {
        for (String bad : new String[]{"AAAPZ1234", "AAAP71234C", "1AAPZ1234C", PAN + "X"}) {
            VacademyException e = unprocessable(with(r -> r.setPan(bad)), SupplierRules.INVALID_PAN);
            assertFalse(e.getMessage().contains(bad));
            assertEquals("INVALID_PAN: pan is not a valid PAN", e.getMessage());
        }
    }

    @Test
    void panThatDiffersFromTheGstinIsAWarning() {
        Draft same = SupplierRules.check(with(r -> {
            r.setGstin(GSTIN);
            r.setPan(PAN);
        }));
        assertTrue(same.warnings.isEmpty());
        String other = TestGstin.pan("BBBPZ", 4321, 'D');
        Draft differs = SupplierRules.check(with(r -> {
            r.setGstin(GSTIN);
            r.setPan(other);
        }));
        assertEquals(1, differs.warnings.size());
        assertEquals(SupplierRules.PAN_DIFFERS_FROM_GSTIN, differs.warnings.get(0).getCode());
    }

    // ── Other fields ────────────────────────────────────────────────────────

    @Test
    void codeAndGroupAreUpperCased() {
        Draft d = SupplierRules.check(with(r -> {
            r.setCode(" st-01_a ");
            r.setGroupCode("service_provider");
        }));
        assertEquals("ST-01_A", d.code);
        assertEquals("SERVICE_PROVIDER", d.groupCode);
        Draft defaults = SupplierRules.check(base());
        assertNull(defaults.code);
        assertEquals("SUPPLIER", defaults.groupCode);
        assertEquals(0, defaults.paymentTermsDays);
        assertFalse(defaults.tdsApplicable);
        validation(with(r -> r.setCode("bad code")));
        validation(with(r -> r.setCode("x".repeat(33))));
        validation(with(r -> r.setGroupCode("bad-group")));
    }

    @Test
    void everyLengthLimit() {
        validation(with(r -> r.setName(" ")));
        validation(with(r -> r.setName("n".repeat(256))));
        SupplierRules.check(with(r -> r.setName("n".repeat(255))));
        validation(with(r -> r.setLegalName("n".repeat(256))));
        validation(with(r -> r.setNameAlt("n".repeat(256))));
        validation(with(r -> r.setAddressLine1("a".repeat(256))));
        validation(with(r -> r.setAddressLine2("a".repeat(256))));
        validation(with(r -> r.setCity("c".repeat(101))));
        validation(with(r -> r.setPincode("1".repeat(11))));
        validation(with(r -> r.setEmail("a".repeat(250) + "@x.com")));
        validation(with(r -> r.setPaymentNote("p".repeat(501))));
        validation(with(r -> r.setExternalRef("e".repeat(101))));
        validation(with(r -> r.setNotes("n".repeat(2001))));
        SupplierRules.check(with(r -> r.setNotes("n".repeat(2000))));
        validation(with(r -> r.setDefaultHeadId("h".repeat(37))));
        validation(with(r -> r.setCustomerId("c".repeat(37))));
        validation(with(r -> r.setUpiId("a".repeat(98) + "@bk")));
        validation(with(r -> r.setPaymentTermsDays(-1)));
        validation(with(r -> r.setPaymentTermsDays(366)));
        assertEquals(365, SupplierRules.check(with(r -> r.setPaymentTermsDays(365))).paymentTermsDays);
        validation(with(r -> r.setDefaultTdsCode("bad code")));
        assertEquals("S194C", SupplierRules.check(with(r -> r.setDefaultTdsCode("s194c"))).defaultTdsCode);
    }

    @Test
    void upiPhoneAndEmailShapes() {
        SupplierRules.check(with(r -> r.setUpiId("test.supplier-1@okbank")));
        validation(with(r -> r.setUpiId("no-at-sign")));
        validation(with(r -> r.setUpiId("a@b")));
        validation(with(r -> r.setUpiId("ab@bank.name")));
        SupplierRules.check(with(r -> r.setPhone("+91 98765-43210")));
        validation(with(r -> r.setPhone("12345")));
        validation(with(r -> r.setPhone("phone-number")));
        SupplierRules.check(with(r -> r.setEmail("accounts@sample-traders.test")));
        validation(with(r -> r.setEmail("two@at@signs.test")));
        validation(with(r -> r.setEmail("with space@x.test")));
        validation(with(r -> r.setEmail("@x.test")));
        validation(with(r -> r.setEmail("x@")));
    }

    @Test
    void blankTextBecomesNullAndTextIsTrimmed() {
        Draft d = SupplierRules.check(with(r -> {
            r.setLegalName("  ");
            r.setNameAlt("  Sample Traders  ");
        }));
        assertNull(d.legalName);
        assertEquals("Sample Traders", d.nameAlt);
    }

    @Test
    void searchTextAndLikePattern() {
        assertEquals("test supplier one sample traders s-000001 98765 " + GSTIN.toLowerCase(),
                SupplierRules.searchText("Test Supplier One", null, "Sample Traders", "S-000001", "98765", GSTIN));
        assertEquals("%50\\%\\_off\\\\x%", SupplierRules.likePattern("50%_OFF\\x"));
    }

    @Test
    void statusValues() {
        assertEquals("INACTIVE", SupplierRules.status(" inactive ").name());
        for (String bad : new String[]{null, " ", "DELETED"}) {
            InvalidRequestException e = assertThrows(InvalidRequestException.class, () -> SupplierRules.status(bad));
            assertTrue(e.getMessage().startsWith("VALIDATION: "));
        }
    }
}
