package vacademy.io.admin_core_service.features.commerce.order.pincode;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** The state of a pincode from its first digits, and "not known" where a prefix is shared. */
class PincodeStatesTest {

    @Test
    void wellKnownPincodesGiveTheirGstStateCode() {
        assertEquals("07", PincodeStates.stateCode("110001")); // New Delhi
        assertEquals("27", PincodeStates.stateCode("400001")); // Mumbai
        assertEquals("09", PincodeStates.stateCode("226001")); // Lucknow
        assertEquals("29", PincodeStates.stateCode("560001")); // Bengaluru
        assertEquals("33", PincodeStates.stateCode("600001")); // Chennai
        assertEquals("19", PincodeStates.stateCode("700001")); // Kolkata
        assertEquals("36", PincodeStates.stateCode("500001")); // Hyderabad
        assertEquals("37", PincodeStates.stateCode("520001")); // Vijayawada
        assertEquals("24", PincodeStates.stateCode("380001")); // Ahmedabad
        assertEquals("08", PincodeStates.stateCode("302001")); // Jaipur
        assertEquals("32", PincodeStates.stateCode("695001")); // Thiruvananthapuram
        assertEquals("10", PincodeStates.stateCode("800001")); // Patna
        assertEquals("18", PincodeStates.stateCode("781001")); // Guwahati
        assertEquals("21", PincodeStates.stateCode("751001")); // Bhubaneswar
        assertEquals("23", PincodeStates.stateCode("462001")); // Bhopal
        assertEquals("22", PincodeStates.stateCode("492001")); // Raipur
    }

    @Test
    void threeDigitPrefixesOverrideTheirRegion() {
        assertEquals("30", PincodeStates.stateCode("403001")); // Goa inside the Maharashtra region
        assertEquals("05", PincodeStates.stateCode("248001")); // Dehradun inside the Uttar Pradesh region
        assertEquals("20", PincodeStates.stateCode("834001")); // Ranchi inside the Bihar region
        assertEquals("11", PincodeStates.stateCode("737101")); // Gangtok inside the West Bengal region
        assertEquals("35", PincodeStates.stateCode("744101")); // Port Blair
        assertEquals("38", PincodeStates.stateCode("194101")); // Leh
        assertEquals("17", PincodeStates.stateCode("793001")); // Shillong
        assertEquals("16", PincodeStates.stateCode("799001")); // Agartala
    }

    @Test
    void aPrefixSharedByTwoStatesIsNotGuessed() {
        assertNull(PincodeStates.stateCode("160017")); // Chandigarh and Punjab
        assertNull(PincodeStates.stateCode("605001")); // Puducherry and Tamil Nadu
        assertNull(PincodeStates.stateCode("396210")); // Daman and Gujarat
        assertNull(PincodeStates.stateCode("247667")); // Roorkee (Uttarakhand) and Saharanpur (Uttar Pradesh)
        assertNull(PincodeStates.stateCode("900001")); // army post
    }

    @Test
    void aMalformedPincodeHasNoState() {
        assertFalse(PincodeStates.isValid("12345"));
        assertFalse(PincodeStates.isValid("012345"));
        assertFalse(PincodeStates.isValid("1234567"));
        assertFalse(PincodeStates.isValid("12a456"));
        assertFalse(PincodeStates.isValid(null));
        assertNull(PincodeStates.stateCode("12345"));
        assertTrue(PincodeStates.isValid("110001"));
    }

    @Test
    void stateCodesHaveNames() {
        assertEquals("Uttar Pradesh", PincodeStates.stateName("09"));
        assertEquals("Maharashtra", PincodeStates.stateName("27"));
        assertNull(PincodeStates.stateName("99"));
        assertTrue(PincodeStates.isStateCode("27"));
        assertFalse(PincodeStates.isStateCode("MH"));
        assertFalse(PincodeStates.isStateCode(null));
    }
}
