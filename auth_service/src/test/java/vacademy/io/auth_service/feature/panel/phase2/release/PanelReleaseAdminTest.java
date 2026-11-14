package vacademy.io.auth_service.feature.panel.phase2.release;

import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import vacademy.io.auth_service.feature.panel.dto.PanelDtos.ReleaseCreateRequest;
import vacademy.io.auth_service.feature.panel.dto.PanelDtos.ReleasePatchRequest;
import vacademy.io.auth_service.feature.panel.phase2.PanelCompat;
import vacademy.io.auth_service.feature.panel.phase2.PanelPhase2ExceptionAdvice;
import vacademy.io.auth_service.feature.panel.phase2.PanelPhase2Properties;
import vacademy.io.auth_service.feature.panel.phase2.release.PanelReleaseRepository.ReleaseRow;
import vacademy.io.auth_service.feature.panel.service.PanelApiException;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.auth.util.SuperAdminAuthUtil;

import java.sql.Timestamp;
import java.util.HashMap;
import java.util.Map;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** What the release registry accepts, without a database. */
class PanelReleaseAdminTest {

    static final String HOST = PanelReleaseOfferTest.HOST;
    static final String CERT = "AB:".repeat(31) + "AB";
    static final String CERT_HEX = "ab".repeat(32);
    static final String URL = "https://" + HOST + "/classroom-releases/direct/4-aaaaaaaa.apk";

    private PanelReleaseRepository repository;

    @BeforeEach
    void setUp() {
        repository = mock(PanelReleaseRepository.class);
    }

    private PanelReleaseAdminService admin(boolean enabled, boolean withCert) {
        Map<String, String> values = new HashMap<>();
        values.put("panel.releases.allowed-hosts", HOST);
        if (withCert) {
            values.put("panel.releases.signing-cert-sha256", CERT);
        }
        PanelReleaseSettings settings = PanelReleaseSettings.of(values);
        PanelPhase2Properties phase2 = enabled ? PanelPhase2Properties.of(Map.of("panel.releases.enabled", "true"))
                : PanelPhase2Properties.allOff();
        PanelReleaseService releases = new PanelReleaseService(repository, phase2,
                PanelReleaseOfferTest.properties(1), settings, new PanelCompat());
        return new PanelReleaseAdminService(repository, releases, settings, phase2);
    }

    static ReleaseCreateRequest direct(String url, String sha, Long size, String pkg, String cert) {
        return new ReleaseCreateRequest("DIRECT", 4, "0.4.0", url, sha, size, 24, 5, false, null, pkg, cert);
    }

    static ReleaseCreateRequest goodDirect() {
        return direct(URL, "F".repeat(64), 23_456_789L, "io.vacademy.classroom.direct", CERT);
    }

    private static ReleaseRow row(String id, String channel, String status, String url) {
        Timestamp now = new Timestamp(System.currentTimeMillis());
        return new ReleaseRow(id, channel, 4, "0.4.0", url, "f".repeat(64), 1L, 24, 5, false, status, null, "staff",
                now, null, now);
    }

    private static String code(Runnable call) {
        try {
            call.run();
        } catch (PanelApiException e) {
            return e.getCode();
        }
        return "OK";
    }

    @Test
    void everyCallAnswersFeatureOffWhileReleasesAreOff() {
        PanelReleaseAdminService admin = admin(false, true);
        assertThat(code(admin::list)).isEqualTo("FEATURE_OFF");
        assertThat(code(() -> admin.create("staff", goodDirect()))).isEqualTo("FEATURE_OFF");
        assertThat(code(() -> admin.patch("r-1", new ReleasePatchRequest("LIVE", null, null))))
                .isEqualTo("FEATURE_OFF");
        verifyNoInteractions(repository);
    }

    @Test
    void aDirectReleaseIsStoredAsDraftWithTheNormalisedDigest() {
        when(repository.insert(any())).thenReturn(1);
        when(repository.findById(anyString())).thenAnswer(call -> Optional.of(row(call.getArgument(0), "DIRECT",
                "DRAFT", URL)));
        var response = admin(true, true).create("staff", goodDirect());
        assertThat(response.status()).isEqualTo("DRAFT");
        assertThat(response.packageName()).isEqualTo("io.vacademy.classroom.direct");
        assertThat(response.signingCertSha256()).isEqualTo(CERT_HEX);
        verify(repository).insert(org.mockito.ArgumentMatchers.argThat(r -> r.sha256().equals("f".repeat(64))
                && r.channel().equals("DIRECT") && r.rolloutPercent() == 5 && r.createdBy().equals("staff")));
    }

    @Test
    void aDirectReleaseMustCarryAnAllowedLinkTheFileDigestAndSizeAndTheBuildIdentity() {
        when(repository.insert(any())).thenReturn(1);
        PanelReleaseAdminService admin = admin(true, true);
        String sha = "F".repeat(64);
        String pkg = "io.vacademy.classroom.direct";
        assertThat(code(() -> admin.create("s", direct(null, sha, 1L, pkg, CERT)))).isEqualTo("BAD_REQUEST");
        assertThat(code(() -> admin.create("s", direct("https://other.example.test/a.apk", sha, 1L, pkg, CERT))))
                .isEqualTo("BAD_REQUEST");
        assertThat(code(() -> admin.create("s", direct("http://" + HOST + "/a.apk", sha, 1L, pkg, CERT))))
                .isEqualTo("BAD_REQUEST");
        assertThat(code(() -> admin.create("s", direct(URL, "abc", 1L, pkg, CERT)))).isEqualTo("BAD_REQUEST");
        assertThat(code(() -> admin.create("s", direct(URL, sha, null, pkg, CERT)))).isEqualTo("BAD_REQUEST");
        assertThat(code(() -> admin.create("s", direct(URL, sha, 0L, pkg, CERT)))).isEqualTo("BAD_REQUEST");
        assertThat(code(() -> admin.create("s", direct(URL, sha, 1L << 40, pkg, CERT)))).isEqualTo("BAD_REQUEST");
        assertThat(code(() -> admin.create("s", direct(URL, sha, 1L, "io.vacademy.classroom", CERT))))
                .isEqualTo("BAD_REQUEST");
        assertThat(code(() -> admin.create("s", direct(URL, sha, 1L, pkg, "cd".repeat(32)))))
                .isEqualTo("BAD_REQUEST");
        assertThat(code(() -> admin.create("s", direct(URL, sha, 1L, pkg, null)))).isEqualTo("BAD_REQUEST");
        verify(repository, never()).insert(any());
    }

    @Test
    void withoutAConfiguredSigningIdentityNoDirectReleaseIsAccepted() {
        assertThat(code(() -> admin(true, false).create("s", goodDirect()))).isEqualTo("SIGNING_IDENTITY_UNSET");
        verify(repository, never()).insert(any());
    }

    @Test
    void playRowsCarryNoLinkAndOtherFieldsAreRangeChecked() {
        when(repository.insert(any())).thenReturn(1);
        PanelReleaseAdminService admin = admin(true, true);
        assertThat(code(() -> admin.create("s", new ReleaseCreateRequest("PLAY", 4, "0.4.0", URL, null, null, null,
                null, null, null)))).isEqualTo("BAD_REQUEST");
        assertThat(code(() -> admin.create("s", new ReleaseCreateRequest("BETA", 4, "0.4.0", null, null, null, null,
                null, null, null)))).isEqualTo("BAD_REQUEST");
        assertThat(code(() -> admin.create("s", new ReleaseCreateRequest("PLAY", 0, "0.4.0", null, null, null, null,
                null, null, null)))).isEqualTo("BAD_REQUEST");
        assertThat(code(() -> admin.create("s", new ReleaseCreateRequest("PLAY", 4, "bad name", null, null, null,
                null, null, null, null)))).isEqualTo("BAD_REQUEST");
        assertThat(code(() -> admin.create("s", new ReleaseCreateRequest("PLAY", 4, "0.4.0", null, null, null, 24,
                101, null, null)))).isEqualTo("BAD_REQUEST");
        assertThat(code(() -> admin.create("s", new ReleaseCreateRequest("PLAY", 4, "0.4.0", null, null, null, 24,
                0, null, "line\u0000break")))).isEqualTo("BAD_REQUEST");
        verify(repository, never()).insert(any());
    }

    @Test
    void aDuplicateVersionCodeIsAConflict() {
        when(repository.insert(any())).thenReturn(0);
        assertThat(code(() -> admin(true, true).create("s", goodDirect()))).isEqualTo("RELEASE_EXISTS");
    }

    @Test
    void statusMovesForwardOnlyAndPulledIsFinal() {
        when(repository.findById("draft")).thenReturn(Optional.of(row("draft", "DIRECT", "DRAFT", URL)));
        when(repository.findById("live")).thenReturn(Optional.of(row("live", "DIRECT", "LIVE", URL)));
        when(repository.findById("pulled")).thenReturn(Optional.of(row("pulled", "DIRECT", "PULLED", URL)));
        when(repository.update(anyString(), anyString(), anyString(), anyInt(), anyBoolean())).thenReturn(1);
        PanelReleaseAdminService admin = admin(true, true);
        assertThat(code(() -> admin.patch("live", new ReleasePatchRequest("DRAFT", null, null))))
                .isEqualTo("BAD_STATUS");
        assertThat(code(() -> admin.patch("pulled", new ReleasePatchRequest("LIVE", null, null))))
                .isEqualTo("BAD_STATUS");
        assertThat(code(() -> admin.patch("pulled", new ReleasePatchRequest(null, 100, null))))
                .isEqualTo("BAD_STATUS");
        assertThat(code(() -> admin.patch("live", new ReleasePatchRequest(null, 101, null))))
                .isEqualTo("BAD_REQUEST");
        assertThat(code(() -> admin.patch("missing", new ReleasePatchRequest("LIVE", null, null))))
                .isEqualTo("NOT_FOUND");
        assertThat(code(() -> admin.patch("draft", new ReleasePatchRequest("LIVE", 25, null)))).isEqualTo("OK");
        verify(repository).update("draft", "DRAFT", "LIVE", 25, false);
        assertThat(code(() -> admin.patch("live", new ReleasePatchRequest("PULLED", null, null)))).isEqualTo("OK");
        verify(repository).update("live", "LIVE", "PULLED", 5, false);
    }

    @Test
    void makingADirectBuildRequiredIsRefusedWhilePanelsBelowItCannotBeOfferedItUnlessForced() {
        when(repository.findById("draft")).thenReturn(Optional.of(row("draft", "DIRECT", "DRAFT", URL)));
        when(repository.findById("live")).thenReturn(Optional.of(row("live", "DIRECT", "LIVE", URL)));
        when(repository.update(anyString(), anyString(), anyString(), anyInt(), anyBoolean())).thenReturn(1);
        when(repository.countPanelsBelowWithoutUpdate(4, 24, 3)).thenReturn(7);
        PanelReleaseAdminService admin = admin(true, true);

        try {
            admin.patch("live", new ReleasePatchRequest(null, null, true));
            throw new AssertionError("expected a refusal");
        } catch (PanelApiException e) {
            assertThat(e.getCode()).isEqualTo("FLOOR_WITHOUT_UPDATE");
            assertThat(e.getExtras()).containsEntry("panels", 7);
        }
        assertThat(code(() -> admin.patch("draft", new ReleasePatchRequest("LIVE", null, true))))
                .isEqualTo("FLOOR_WITHOUT_UPDATE");
        verify(repository, never()).update(anyString(), anyString(), anyString(), anyInt(), anyBoolean());

        // Not required, or explicitly forced: no refusal.
        assertThat(code(() -> admin.patch("draft", new ReleasePatchRequest("LIVE", null, false)))).isEqualTo("OK");
        assertThat(code(() -> admin.patch("live", new ReleasePatchRequest(null, null, true, true)))).isEqualTo("OK");
        verify(repository).update("live", "LIVE", "LIVE", 5, true);

        when(repository.countPanelsBelowWithoutUpdate(4, 24, 3)).thenReturn(0);
        assertThat(code(() -> admin.patch("draft", new ReleasePatchRequest("LIVE", null, true)))).isEqualTo("OK");
    }

    @Test
    void aDirectReleaseCannotGoLiveOnceItsHostIsNoLongerAllowed() {
        when(repository.findById("draft")).thenReturn(Optional.of(row("draft", "DIRECT", "DRAFT",
                "https://old-host.example.test/a.apk")));
        assertThat(code(() -> admin(true, true).patch("draft", new ReleasePatchRequest("LIVE", null, null))))
                .isEqualTo("BAD_REQUEST");
        verify(repository, never()).update(anyString(), anyString(), anyString(), anyInt(), anyBoolean());
    }

    @Test
    void aConcurrentChangeIsReportedNotOverwritten() {
        when(repository.findById("draft")).thenReturn(Optional.of(row("draft", "DIRECT", "DRAFT", URL)));
        when(repository.update(anyString(), anyString(), anyString(), anyInt(), anyBoolean())).thenReturn(0);
        assertThat(code(() -> admin(true, true).patch("draft", new ReleasePatchRequest("LIVE", null, null))))
                .isEqualTo("TRY_AGAIN");
    }

    @Test
    void theEndpointsRefuseAnyoneNotOnThePlatformStaffList() throws Exception {
        Assumptions.assumeTrue(System.getenv(SuperAdminAuthUtil.ALLOWLIST_ENV) == null,
                "runs only where the staff list is unset, which refuses everyone");
        PanelReleaseAdminService admin = mock(PanelReleaseAdminService.class);
        MockMvc mvc = MockMvcBuilders.standaloneSetup(new PanelReleaseSuperAdminController(admin))
                .setControllerAdvice(new PanelPhase2ExceptionAdvice()).build();
        CustomUserDetails user = mock(CustomUserDetails.class);
        when(user.getUserId()).thenReturn("u-admin");
        String base = "/auth-service/super-admin/v1/panel/releases";
        mvc.perform(get(base).requestAttr("user", user))
                .andExpect(status().isForbidden()).andExpect(jsonPath("$.code").value("FORBIDDEN"));
        mvc.perform(post(base).requestAttr("user", user).contentType(MediaType.APPLICATION_JSON)
                .content("{\"channel\":\"PLAY\",\"version_code\":4,\"version_name\":\"0.4.0\"}"))
                .andExpect(status().isForbidden());
        mvc.perform(patch(base + "/r-1").requestAttr("user", user).contentType(MediaType.APPLICATION_JSON)
                .content("{\"status\":\"LIVE\"}"))
                .andExpect(status().isForbidden());
        verifyNoInteractions(admin);
    }
}
