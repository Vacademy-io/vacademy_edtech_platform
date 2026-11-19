package vacademy.io.common.external;

import org.junit.jupiter.api.Test;

import java.nio.file.Path;

import static org.junit.jupiter.api.Assertions.*;

class VendorCallCoverageTest {

    @Test
    void aFileNamingAVendorHostMustRecord() {
        String client = "class Plivo { String base = \"https://api.plivo.com/v1\"; }";
        assertEquals("api.plivo.com", VendorCallCoverage.vendorUse(client));
        assertFalse(VendorCallCoverage.records(client));

        String recording = client + " void f(){ VendorCallLog.failed(base, \"call\", null, e); }";
        assertTrue(VendorCallCoverage.records(recording));
    }

    @Test
    void sdkImportsCount() {
        assertEquals("com.razorpay", VendorCallCoverage.vendorUse("import com.razorpay.Order;\nclass A {}"));
        assertNotNull(VendorCallCoverage.vendorUse("import org.springframework.mail.javamail.JavaMailSender;"));
    }

    @Test
    void aVendorAddressFromASettingCounts() {
        assertEquals("${telephony.plivo.base-url}", VendorCallCoverage.vendorUse(
                "class P { @Value(\"${telephony.plivo.base-url}\") String base; }"));
        assertNotNull(VendorCallCoverage.vendorUse("@Value(\"${meta.whatsapp.api.base.url:x}\") String u;"));
        assertNull(VendorCallCoverage.vendorUse("@Value(\"${razorpay.webhook.secret}\") String s;"));
        assertNull(VendorCallCoverage.vendorUse("@Value(\"${bbb.server.url}\") String s;"));
        assertNull(VendorCallCoverage.vendorUse("@Value(\"${zoom.oauth.redirect.uri}\") String s;"));
        assertNull(VendorCallCoverage.vendorUse("@Value(\"${google.oauth.frontend.callback.url}\") String s;"));
    }

    @Test
    void commentsAndOtherHostsDoNotCount() {
        assertNull(VendorCallCoverage.vendorUse("// see https://api.plivo.com/docs\nclass A {}"));
        assertNull(VendorCallCoverage.vendorUse("/** https://api.razorpay.com */ class A {}"));
        assertNull(VendorCallCoverage.vendorUse("class A { String u = \"https://vacademy.io/x\"; }"));
        assertNull(VendorCallCoverage.vendorUse("class A { String u = \"http://admin-core-service:8072\"; }"));
    }

    @Test
    void theMarkerExplainsAFileThatMakesNoCall() {
        assertTrue(VendorCallCoverage.records("// vendor-call-log: recorded in PlivoHttpClient\nclass Dto {}"));
    }

    /** common_service itself makes no vendor calls; every service runs the same check in its tests. */
    @Test
    void commonServiceHasNoUnrecordedVendorCalls() throws Exception {
        assertEquals(java.util.List.of(), VendorCallCoverage.unrecorded(Path.of("src/main/java")));
    }
}
