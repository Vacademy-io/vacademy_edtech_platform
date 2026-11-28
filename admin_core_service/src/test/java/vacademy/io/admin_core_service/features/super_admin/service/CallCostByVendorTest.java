package vacademy.io.admin_core_service.features.super_admin.service;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;

/** Call cost by vendor: every Sarvam TTS engine counts as Sarvam, so its total is one figure. */
class CallCostByVendorTest {

    @Test
    void ttsEnginesMapToTheCompanyThatBillsThem() {
        assertEquals("sarvam", SuperAdminCallService.ttsVendor("sarvam"));
        assertEquals("sarvam", SuperAdminCallService.ttsVendor("sarvam_v4"));
        assertEquals("smallest", SuperAdminCallService.ttsVendor("smallest_pro"));
        assertEquals("rumik", SuperAdminCallService.ttsVendor("rumik"));
        assertEquals("tts", SuperAdminCallService.ttsVendor(null));
    }
}
