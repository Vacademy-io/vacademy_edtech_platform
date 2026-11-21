package vacademy.io.community_service.feature.appregistry.build;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import vacademy.io.common.exceptions.VacademyException;
import vacademy.io.community_service.feature.appregistry.service.AppRegistryService;
import vacademy.io.community_service.feature.appregistry.store.AppStoreConnectClient.BuildInfo;
import vacademy.io.community_service.feature.appregistry.store.StoreCredentialResolver;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class IosBuildServiceTest {

    private static final ObjectMapper JSON = new ObjectMapper();

    @Mock AppRegistryService registry;
    @Mock StoreCredentialResolver credentials;
    @Mock GitHubActionsClient github;
    @Mock FirebaseAppClient firebase;
    @InjectMocks IosBuildService service;

    private static JsonNode record(String fieldsJson, String extra) throws Exception {
        return JSON.readTree("{\"basics\":{\"name\":\"Example\",\"displayName\":\"Example Academy\"},"
                + "\"platforms\":{\"IOS\":{\"fields\":" + fieldsJson + "}}" + extra + "}");
    }

    @Test
    void targetNameKeepsLettersDigitsAndSingleSpaces() {
        assertEquals("Smart AI Academy", IosBuildService.targetNameFor("Smart AI  Academy!"));
        assertEquals("Sreedhar s TTS", IosBuildService.targetNameFor("Sreedhar's TTS"));
        assertEquals("", IosBuildService.targetNameFor("  ✨ "));
    }

    @Test
    void nextBuildNumberIsHighestPlusOneWhateverTheOrder() {
        assertEquals(6, IosBuildService.nextBuildNumber(List.of(
                new BuildInfo("4", "VALID", true, ""), new BuildInfo("5", "VALID", false, ""),
                new BuildInfo("1.0.3", "VALID", false, ""))));
        assertEquals(1, IosBuildService.nextBuildNumber(List.of()));
    }

    @Test
    void brandNormalisesHostAndPrefersIosIcon() throws Exception {
        JsonNode rec = record("{\"bundle_id\":\" io.example.app \",\"app_domain\":\"https://student.example.in/login\"}",
                ",\"sourceImages\":[{\"url\":\"https://cdn/src.png\"}],"
                        + "\"assets\":[{\"specId\":\"android_app_icon\",\"url\":\"https://cdn/a.png\"},{\"specId\":\"ios_app_icon\",\"url\":\"https://cdn/i.png\"}]");
        IosBuildService.Brand b = service.brandOf(rec);
        assertEquals("io.example.app", b.bundleId());
        assertEquals("student.example.in", b.host());
        assertEquals("Example Academy", b.displayName());
        assertEquals("https://cdn/i.png", b.logoUrl());
    }

    @Test
    void startRefusesWithEveryMissingFieldNamed() throws Exception {
        when(github.isConfigured()).thenReturn(true);
        when(registry.get("a1")).thenReturn(record("{}", ""));
        VacademyException e = assertThrows(VacademyException.class, () -> service.start("a1", "1.0", "x"));
        assertTrue(e.getMessage().contains("Bundle ID"));
        assertTrue(e.getMessage().contains("App Domain"));
        assertTrue(e.getMessage().contains("build number"));
        verify(github, never()).dispatch(any());
    }

    @Test
    void existingTargetDispatchesWithoutFirebaseOrLogo() throws Exception {
        when(github.isConfigured()).thenReturn(true);
        when(registry.get("a1")).thenReturn(record(
                "{\"bundle_id\":\"io.example.app\",\"app_domain\":\"student.example.in\"}", ""));
        when(github.listRuns("a1", 5)).thenReturn(List.of());
        when(github.fileContains(eq(IosBuildService.PBXPROJ), anyString())).thenReturn(true);
        when(github.dispatch(any())).thenReturn(new GitHubActionsClient.Dispatch(42L, "https://run"));

        Map<String, Object> out = service.start("a1", "1.0.0", "6");

        assertEquals(42L, out.get("runId"));
        assertEquals(false, out.get("createsTarget"));
        verify(github).dispatch(org.mockito.ArgumentMatchers.argThat(in ->
                "io.example.app".equals(in.get("bundle_id")) && "6".equals(in.get("build_number"))
                        && !in.containsKey("firebase_plist_b64") && !in.containsKey("logo_url")));
        verify(firebase, never()).findIosApp(anyString());
    }

    @Test
    void newTargetNeedsFirebaseAppFirst() throws Exception {
        when(github.isConfigured()).thenReturn(true);
        when(registry.get("a1")).thenReturn(record(
                "{\"bundle_id\":\"io.newbrand.app\",\"app_domain\":\"student.newbrand.in\"}",
                ",\"assets\":[{\"specId\":\"ios_app_icon\",\"url\":\"https://cdn/i.png\"}]"));
        when(github.listRuns("a1", 5)).thenReturn(List.of());
        when(github.fileContains(eq(IosBuildService.PBXPROJ), anyString())).thenReturn(false);
        when(firebase.isConfigured()).thenReturn(true);
        when(firebase.findIosApp("io.newbrand.app")).thenReturn(null);

        VacademyException e = assertThrows(VacademyException.class, () -> service.start("a1", "1.0.0", "1"));
        assertTrue(e.getMessage().contains("Create Firebase app"));
        verify(github, never()).dispatch(any());
    }

    @Test
    void secondBuildWhileOneIsRunningIsRefused() throws Exception {
        when(github.isConfigured()).thenReturn(true);
        when(registry.get("a1")).thenReturn(record(
                "{\"bundle_id\":\"io.example.app\",\"app_domain\":\"student.example.in\"}", ""));
        when(github.listRuns("a1", 5)).thenReturn(List.of(
                new GitHubActionsClient.Run(1, "ios-build app:a1 x", "in_progress", "", "", "", "")));
        assertThrows(VacademyException.class, () -> service.start("a1", "1.0.0", "6"));
        verify(github, never()).dispatch(any());
    }
    @Test
    void newTargetRefusesDisplayNamesThatWouldBreakConfigFiles() throws Exception {
        when(github.isConfigured()).thenReturn(true);
        when(registry.get("a1")).thenReturn(JSON.readTree("{\"basics\":{\"displayName\":\"A & B Academy\"},"
                + "\"platforms\":{\"IOS\":{\"fields\":{\"bundle_id\":\"io.ab.app\",\"app_domain\":\"student.ab.in\"}}}}"));
        when(github.listRuns("a1", 5)).thenReturn(List.of());
        when(github.fileContains(eq(IosBuildService.PBXPROJ), anyString())).thenReturn(false);

        VacademyException e = assertThrows(VacademyException.class, () -> service.start("a1", "1.0.0", "1"));
        assertTrue(e.getMessage().contains("App Name"));
        verify(github, never()).dispatch(any());
    }

    @Test
    void statusSurvivesACredentialLookupThatThrows() throws Exception {
        when(registry.get("a1")).thenReturn(record(
                "{\"bundle_id\":\"io.example.app\",\"app_domain\":\"student.example.in\"}", ""));
        when(credentials.resolveAppStoreConnect(any(), eq("IOS"))).thenThrow(new RuntimeException("relation \"store_credential\" does not exist"));
        when(github.listRuns("a1", 8)).thenReturn(List.of());

        Map<String, Object> out = service.status("a1");

        @SuppressWarnings("unchecked")
        Map<String, Object> asc = (Map<String, Object>) out.get("appStoreConnect");
        assertEquals(false, asc.get("configured"));
        assertTrue(String.valueOf(asc.get("error")).contains("store_credential"));
        assertNotNull(out.get("runs"));
    }
}
