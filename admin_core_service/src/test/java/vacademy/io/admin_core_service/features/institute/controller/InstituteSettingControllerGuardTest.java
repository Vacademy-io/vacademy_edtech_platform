package vacademy.io.admin_core_service.features.institute.controller;

import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;
import vacademy.io.admin_core_service.features.institute.dto.settings.GenericSettingRequest;
import vacademy.io.admin_core_service.features.institute.dto.settings.SwitchWhatsAppProviderRequest;
import vacademy.io.admin_core_service.features.institute.dto.settings.WhatsAppProviderCredentialsRequest;
import vacademy.io.admin_core_service.features.institute.service.setting.WhatsAppSettingService;
import vacademy.io.admin_core_service.features.institute.dto.settings.custom_field.CustomFieldSettingRequest;
import vacademy.io.admin_core_service.features.institute.dto.settings.naming.NameSettingRequest;
import vacademy.io.admin_core_service.features.institute.manager.InstituteSettingManager;
import vacademy.io.admin_core_service.features.institute.service.setting.InstituteSettingAccessGuard;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.ForbiddenException;

import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;

/** Every settings write (and the whole-blob reads) consults the guard before touching the manager. */
class InstituteSettingControllerGuardTest {

    private static final String INSTITUTE = "inst-1";

    private final InstituteSettingManager manager = mock(InstituteSettingManager.class);
    private final InstituteSettingAccessGuard guard = mock(InstituteSettingAccessGuard.class);
    private final CustomUserDetails caller = new CustomUserDetails();
    private final InstituteSettingController controller = new InstituteSettingController();

    InstituteSettingControllerGuardTest() {
        ReflectionTestUtils.setField(controller, "instituteSettingManager", manager);
        ReflectionTestUtils.setField(controller, "instituteSettingAccessGuard", guard);
    }

    private static ForbiddenException denied() {
        return new ForbiddenException("no");
    }

    @Test
    void saveSettingChecksTheRequestedKeyFirst() {
        doThrow(denied()).when(guard).requireCanWrite(caller, INSTITUTE, "ROLE_DISPLAY_SETTINGS");
        assertThrows(ForbiddenException.class, () -> controller.saveSetting(caller, INSTITUTE,
                "ROLE_DISPLAY_SETTINGS", new GenericSettingRequest()));
        verifyNoInteractions(manager);
    }

    @Test
    void namingWritesAreCheckedAsNamingSetting() {
        doThrow(denied()).when(guard).requireCanWrite(caller, INSTITUTE, "NAMING_SETTING");
        assertThrows(ForbiddenException.class,
                () -> controller.newNamingSetting(caller, INSTITUTE, new NameSettingRequest()));
        assertThrows(ForbiddenException.class,
                () -> controller.updateNamingSetting(caller, INSTITUTE, new NameSettingRequest()));
        verifyNoInteractions(manager);
    }

    @Test
    void allowedSaveReachesTheManager() {
        GenericSettingRequest body = new GenericSettingRequest();
        controller.saveSetting(caller, INSTITUTE, "COURSE_SETTING", body);
        verify(guard).requireCanWrite(caller, INSTITUTE, "COURSE_SETTING");
        verify(manager).saveGenericSetting(eq(caller), eq(INSTITUTE), eq("COURSE_SETTING"), any());
    }

    @Test
    void wholeBlobReadsAreChecked() {
        doThrow(denied()).when(guard).requireCanReadAll(caller, INSTITUTE);
        assertThrows(ForbiddenException.class, () -> controller.getAllSettings(caller, INSTITUTE));
        assertThrows(ForbiddenException.class, () -> controller.getSettingsAsRawJson(caller, INSTITUTE));
        verifyNoInteractions(manager);
    }

    @Test
    void perKeyReadsAreCheckedForTheRequestedKey() {
        doThrow(denied()).when(guard).requireCanReadKey(caller, INSTITUTE, "WHATSAPP_SETTING");
        assertThrows(ForbiddenException.class,
                () -> controller.getSpecificSetting(caller, INSTITUTE, "WHATSAPP_SETTING"));
        assertThrows(ForbiddenException.class,
                () -> controller.getSettingData(caller, INSTITUTE, "WHATSAPP_SETTING"));
        verifyNoInteractions(manager);
    }

    @Test
    void allowedPerKeyReadReachesTheManager() {
        controller.getSpecificSetting(caller, INSTITUTE, "STUDENT_DISPLAY_SETTINGS");
        verify(guard).requireCanReadKey(caller, INSTITUTE, "STUDENT_DISPLAY_SETTINGS");
        verify(manager).getSpecificSetting(caller, INSTITUTE, "STUDENT_DISPLAY_SETTINGS");
    }

    @Test
    void whatsAppConfigRoutesAreChecked() {
        WhatsAppSettingService whatsApp = mock(WhatsAppSettingService.class);
        InstituteWhatsAppSettingController whatsAppController = new InstituteWhatsAppSettingController(whatsApp, guard);
        doThrow(denied()).when(guard).requireCanReadKey(caller, INSTITUTE, "WHATSAPP_SETTING");
        doThrow(denied()).when(guard).requireCanWrite(caller, INSTITUTE, "WHATSAPP_SETTING");
        assertThrows(ForbiddenException.class, () -> whatsAppController.getProviderStatus(caller, INSTITUTE));
        assertThrows(ForbiddenException.class,
                () -> whatsAppController.switchProvider(caller, INSTITUTE, new SwitchWhatsAppProviderRequest()));
        assertThrows(ForbiddenException.class,
                () -> whatsAppController.updateCredentials(caller, INSTITUTE, new WhatsAppProviderCredentialsRequest()));
        assertThrows(ForbiddenException.class, () -> whatsAppController.removeCredentials(caller, INSTITUTE, "meta"));
        verifyNoInteractions(whatsApp);
    }

    @Test
    void customFieldSaveIsChecked() {
        InstituteCustomFieldSettingController customFields = new InstituteCustomFieldSettingController(manager, guard);
        doThrow(denied()).when(guard).requireCanWrite(caller, INSTITUTE, "CUSTOM_FIELD_SETTING");
        assertThrows(ForbiddenException.class, () -> customFields.updateCustomFieldSetting(caller, INSTITUTE,
                new CustomFieldSettingRequest(), "true"));
        verifyNoInteractions(manager);
    }
}
