package io.vacademy.admin.app.panel.update;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import org.junit.Test;

/** The updater's acceptance rules (direct build type only). */
public class UpdateRulesTest {

    private static final List<String> HOSTS = UpdateRules.parseHosts(" Updates.Example.org , ,cdn.example.net");
    private static final String SHA = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    private static final List<String> KEY_A = Collections.singletonList("aa11");
    private static final List<String> KEY_B = Collections.singletonList("bb22");

    @Test
    public void hostsAreTrimmedLowerCasedAndBlanksDropped() {
        assertEquals(Arrays.asList("updates.example.org", "cdn.example.net"), HOSTS);
        assertTrue(UpdateRules.parseHosts("").isEmpty());
        assertTrue(UpdateRules.parseHosts(null).isEmpty());
    }

    @Test
    public void acceptsHttpsOnAnAllowedHost() {
        assertNotNull(UpdateRules.allowedDownloadUri("https://updates.example.org/classroom/3-abcd1234.apk", HOSTS));
        assertNotNull(UpdateRules.allowedDownloadUri("https://CDN.example.net/a.apk", HOSTS));
        assertNotNull(UpdateRules.allowedDownloadUri("https://cdn.example.net:443/a.apk", HOSTS));
    }

    @Test
    public void refusesEverythingElse() {
        String[] bad = {
            null,
            "",
            "http://updates.example.org/a.apk",
            "ftp://updates.example.org/a.apk",
            "https://evil.example.com/a.apk",
            "https://updates.example.org.evil.example.com/a.apk",
            "https://sub.updates.example.org/a.apk",
            "https://user@updates.example.org/a.apk",
            "https://updates.example.org:8443/a.apk",
            " https://updates.example.org/a.apk",
            "https://updates.example.org/a b.apk",
            "https://updates.example.org\\@evil.example.com/a.apk",
            "//updates.example.org/a.apk",
            "/a.apk",
            "https:updates.example.org/a.apk",
            "https://updates.example.org/é.apk",
        };
        for (String url : bad) {
            assertNull(String.valueOf(url), UpdateRules.allowedDownloadUri(url, HOSTS));
        }
    }

    @Test
    public void noHostsMeansNoDownloads() {
        assertNull(UpdateRules.allowedDownloadUri("https://updates.example.org/a.apk", Collections.<String>emptyList()));
        assertNull(UpdateRules.allowedDownloadUri("https://updates.example.org/a.apk", null));
    }

    @Test
    public void sha256MustBe64Hex() {
        assertEquals(SHA, UpdateRules.normalizeSha256(SHA.toUpperCase()));
        assertNull(UpdateRules.normalizeSha256(SHA.substring(1)));
        assertNull(UpdateRules.normalizeSha256(SHA.substring(1) + "g"));
        assertNull(UpdateRules.normalizeSha256(null));
    }

    @Test
    public void wholeNumbersFromJson() {
        assertEquals(Long.valueOf(3), UpdateRules.wholeNumber(3));
        assertEquals(Long.valueOf(23456789012L), UpdateRules.wholeNumber(23456789012L));
        assertEquals(Long.valueOf(4), UpdateRules.wholeNumber(4.0d));
        assertNull(UpdateRules.wholeNumber(4.5d));
        assertNull(UpdateRules.wholeNumber("4"));
        assertNull(UpdateRules.wholeNumber(null));
        assertNull(UpdateRules.wholeNumber(Double.NaN));
    }

    @Test
    public void sizeCap() {
        assertFalse(UpdateRules.isAcceptableSize(0));
        assertTrue(UpdateRules.isAcceptableSize(25_000_000L));
        assertFalse(UpdateRules.isAcceptableSize(UpdateRules.MAX_APK_BYTES + 1));
        assertFalse(UpdateRules.exceedsAnnounced(1000 + UpdateRules.SIZE_SLACK_BYTES, 1000));
        assertTrue(UpdateRules.exceedsAnnounced(1001 + UpdateRules.SIZE_SLACK_BYTES, 1000));
    }

    @Test
    public void hex() {
        assertEquals("00ff10", UpdateRules.toHex(new byte[] { 0, (byte) 0xff, 0x10 }));
    }

    @Test
    public void archiveThatMatchesIsAccepted() {
        assertNull(problem("io.vacademy.classroom.direct", 4, 4, KEY_A, 24, 28));
    }

    @Test
    public void archiveProblems() {
        assertEquals(UpdateErrors.INVALID_APK, problem(null, 4, 4, KEY_A, 24, 28));
        assertEquals(UpdateErrors.PACKAGE_MISMATCH, problem("io.vacademy.classroom", 4, 4, KEY_A, 24, 28));
        assertEquals(UpdateErrors.VERSION_MISMATCH, problem("io.vacademy.classroom.direct", 5, 4, KEY_A, 24, 28));
        assertEquals(UpdateErrors.NOT_NEWER, problem("io.vacademy.classroom.direct", 3, 3, KEY_A, 24, 28));
        assertEquals(UpdateErrors.NOT_NEWER, problem("io.vacademy.classroom.direct", 2, 2, KEY_A, 24, 28));
        assertEquals(UpdateErrors.SIGNATURE_MISMATCH, problem("io.vacademy.classroom.direct", 4, 4, KEY_B, 24, 28));
        assertEquals(UpdateErrors.SIGNATURE_MISMATCH, problem("io.vacademy.classroom.direct", 4, 4, Collections.<String>emptyList(), 24, 28));
        assertEquals(UpdateErrors.SIGNATURE_MISMATCH, problem("io.vacademy.classroom.direct", 4, 4, null, 24, 28));
        assertEquals(UpdateErrors.SDK_TOO_LOW, problem("io.vacademy.classroom.direct", 4, 4, KEY_A, 30, 28));
    }

    @Test
    public void signerSetsMustBeEqual() {
        assertTrue(UpdateRules.sameSigners(Arrays.asList("AA", "bb"), Arrays.asList("bb", "aa")));
        assertTrue(UpdateRules.sameSigners(Arrays.asList("aa", "aa"), Collections.singletonList("aa")));
        assertFalse(UpdateRules.sameSigners(Arrays.asList("aa", "bb"), Collections.singletonList("aa")));
        assertFalse(UpdateRules.sameSigners(Collections.singletonList("aa"), Arrays.asList("aa", "bb")));
        assertFalse(UpdateRules.sameSigners(Collections.<String>emptyList(), Collections.<String>emptyList()));
        assertFalse(UpdateRules.sameSigners(Collections.singletonList(""), Collections.singletonList("")));
    }

    private static String problem(String archivePackage, long archiveCode, long expectedCode, List<String> archiveSigners, int minSdk, int deviceSdk) {
        return UpdateRules.archiveProblem("io.vacademy.classroom.direct", 3, KEY_A, archivePackage, archiveCode, expectedCode, archiveSigners, minSdk, deviceSdk);
    }
}
