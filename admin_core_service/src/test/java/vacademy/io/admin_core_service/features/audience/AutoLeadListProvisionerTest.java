package vacademy.io.admin_core_service.features.audience;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.annotation.Autowired;
import vacademy.io.admin_core_service.features.audience.entity.Audience;
import vacademy.io.admin_core_service.features.audience.repository.AudienceRepository;
import vacademy.io.admin_core_service.features.audience.repository.AudienceResponseRepository;
import vacademy.io.admin_core_service.features.audience.service.AutoLeadListProvisioner;
import vacademy.io.admin_core_service.features.common.entity.CustomFields;
import vacademy.io.admin_core_service.features.common.entity.InstituteCustomField;
import vacademy.io.admin_core_service.features.common.repository.CustomFieldRepository;
import vacademy.io.admin_core_service.features.common.repository.InstituteCustomFieldRepository;
import vacademy.io.admin_core_service.features.common.util.CustomFieldKeyGenerator;

import java.lang.reflect.Field;
import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.*;

/**
 * Every public live session and every open assessment gets its own list, named after the
 * title the admin typed, found again by the id kept in its setting_json.
 */
class AutoLeadListProvisionerTest {

    private AutoLeadListProvisioner provisioner;
    private AudienceRepository audiences;
    private AudienceResponseRepository responses;
    private CustomFieldRepository fields;
    private InstituteCustomFieldRepository links;

    @BeforeEach
    void setUp() throws Exception {
        provisioner = new AutoLeadListProvisioner();
        for (Field f : AutoLeadListProvisioner.class.getDeclaredFields()) {
            if (f.isAnnotationPresent(Autowired.class)) {
                f.setAccessible(true);
                f.set(provisioner, f.getType() == CustomFieldKeyGenerator.class
                        ? new CustomFieldKeyGenerator() : mock(f.getType()));
            }
        }
        audiences = (AudienceRepository) get("audienceRepository");
        responses = (AudienceResponseRepository) get("audienceResponseRepository");
        fields = (CustomFieldRepository) get("customFieldRepository");
        links = (InstituteCustomFieldRepository) get("instituteCustomFieldRepository");
        when(audiences.save(any(Audience.class))).thenAnswer(inv -> inv.getArgument(0));
    }

    private Object get(String name) throws Exception {
        Field f = AutoLeadListProvisioner.class.getDeclaredField(name);
        f.setAccessible(true);
        return f.get(provisioner);
    }

    private static Audience list(String id, String type, String sourceId, String status) {
        Audience a = new Audience();
        a.setId(id);
        a.setInstituteId("inst-1");
        a.setStatus(status);
        a.setSettingJson("{\"autoLeadListSource\":{\"type\":\"" + type + "\",\"id\":\"" + sourceId + "\"}}");
        return a;
    }

    @Test
    void firstRegistrationCreatesTheListNamedAfterTheTitle() {
        when(audiences.findByInstituteIdAndSettingJsonContainingOrderByCreatedAtAsc("inst-1", "test-1"))
                .thenReturn(List.of());

        Audience created = provisioner.getOrCreate("inst-1", AutoLeadListProvisioner.OPEN_ASSESSMENT,
                "test-1", "  Admission Test Class 6 ");

        assertEquals("Admission Test Class 6 - Open Assessment", created.getCampaignName());
        assertEquals("Open Assessment", created.getCampaignType());
        assertEquals("ACTIVE", created.getStatus());
        assertEquals("{\"autoLeadListSource\":{\"type\":\"Open Assessment\",\"id\":\"test-1\"}}",
                created.getSettingJson());
        verify(responses).acquireTransactionLock("auto-lead-list:Open Assessment:test-1");
    }

    @Test
    void liveSessionListUsesItsOwnTypeAndSuffix() {
        when(audiences.findByInstituteIdAndSettingJsonContainingOrderByCreatedAtAsc(any(), any()))
                .thenReturn(List.of());

        Audience created = provisioner.getOrCreate("inst-1", AutoLeadListProvisioner.PUBLIC_LIVE_SESSION,
                "sess-1", "Physics Masterclass");

        assertEquals("Physics Masterclass - Public Live Session", created.getCampaignName());
        assertEquals("Public Live Session", created.getCampaignType());
    }

    @Test
    void laterRegistrationsReuseTheListEvenAfterItIsRenamed() {
        Audience existing = list("aud-1", AutoLeadListProvisioner.OPEN_ASSESSMENT, "test-1", "ACTIVE");
        existing.setCampaignName("Renamed by admin");
        when(audiences.findByInstituteIdAndSettingJsonContainingOrderByCreatedAtAsc("inst-1", "test-1"))
                .thenReturn(List.of(existing));

        Audience found = provisioner.getOrCreate("inst-1", AutoLeadListProvisioner.OPEN_ASSESSMENT,
                "test-1", "Admission Test Class 6");

        assertSame(existing, found);
        verify(audiences, never()).save(any());
        verify(responses, never()).acquireTransactionLock(anyString());
    }

    @Test
    void aListOfAnotherTypeIsNotReused() {
        when(audiences.findByInstituteIdAndSettingJsonContainingOrderByCreatedAtAsc("inst-1", "x-1"))
                .thenReturn(List.of(list("other-type", AutoLeadListProvisioner.PUBLIC_LIVE_SESSION, "x-1", "ACTIVE")));

        Audience created = provisioner.getOrCreate("inst-1", AutoLeadListProvisioner.OPEN_ASSESSMENT,
                "x-1", "Mock");

        assertNotEquals("other-type", created.getId());
        verify(audiences).save(any(Audience.class));
    }

    @Test
    void aListTheAdminDeletedIsReturnedNotRecreated() {
        Audience deleted = list("deleted", AutoLeadListProvisioner.OPEN_ASSESSMENT, "test-1", "DELETED");
        when(audiences.findByInstituteIdAndSettingJsonContainingOrderByCreatedAtAsc("inst-1", "test-1"))
                .thenReturn(List.of(deleted));

        assertSame(deleted, provisioner.getOrCreate("inst-1", AutoLeadListProvisioner.OPEN_ASSESSMENT,
                "test-1", "Admission Test Class 6"));
        verify(audiences, never()).save(any());
    }

    @Test
    void anActiveMatchWinsOverAnOlderDeletedOne() {
        Audience deleted = list("deleted", AutoLeadListProvisioner.OPEN_ASSESSMENT, "test-1", "DELETED");
        Audience active = list("active", AutoLeadListProvisioner.OPEN_ASSESSMENT, "test-1", "active");
        when(audiences.findByInstituteIdAndSettingJsonContainingOrderByCreatedAtAsc("inst-1", "test-1"))
                .thenReturn(List.of(deleted, active));

        assertSame(active, provisioner.find("inst-1", AutoLeadListProvisioner.OPEN_ASSESSMENT, "test-1")
                .orElseThrow());
    }

    @Test
    void aPausedListIsStillFoundSoTheCallerCanSkipIt() {
        Audience paused = list("paused", AutoLeadListProvisioner.OPEN_ASSESSMENT, "test-1", "INACTIVE");
        when(audiences.findByInstituteIdAndSettingJsonContainingOrderByCreatedAtAsc("inst-1", "test-1"))
                .thenReturn(List.of(paused));

        assertSame(paused, provisioner.find("inst-1", AutoLeadListProvisioner.OPEN_ASSESSMENT, "test-1")
                .orElseThrow());
    }

    @Test
    void aVeryLongTitleStillFitsTheNameColumn() {
        when(audiences.findByInstituteIdAndSettingJsonContainingOrderByCreatedAtAsc(any(), any()))
                .thenReturn(List.of());

        Audience created = provisioner.getOrCreate("inst-1", AutoLeadListProvisioner.OPEN_ASSESSMENT,
                "t", "A".repeat(400));

        assertEquals(255, created.getCampaignName().length());
        assertTrue(created.getCampaignName().endsWith(" - Open Assessment"));
    }

    @Test
    void aBlankTitleFallsBackToTheType() {
        when(audiences.findByInstituteIdAndSettingJsonContainingOrderByCreatedAtAsc(any(), any()))
                .thenReturn(List.of());

        assertEquals("Open Assessment", provisioner.getOrCreate("inst-1",
                AutoLeadListProvisioner.OPEN_ASSESSMENT, "t", "  ").getCampaignName());
    }

    private static CustomFields cf(String id, String key, String name, String status) {
        return CustomFields.builder().id(id).fieldKey(key).fieldName(name).status(status).build();
    }

    private static InstituteCustomField link(String status) {
        InstituteCustomField l = new InstituteCustomField();
        l.setStatus(status);
        return l;
    }

    @Test
    void ensureFieldReusesTheInstitutesFieldOfThatNameWithoutEditingIt() {
        CustomFields classField = cf("cf-class", "class_inst_inst-1", "Class", "ACTIVE");
        classField.setFieldType("DROPDOWN");
        when(fields.findByFieldKeyAnyStatusWithLock("class_inst_inst-1")).thenReturn(List.of(classField));
        when(links.findTopByInstituteIdAndCustomFieldIdAndTypeAndTypeIdAndStatusOrderByCreatedAtDesc(
                "inst-1", "cf-class", "AUDIENCE_FORM", "aud-1", "ACTIVE")).thenReturn(Optional.empty());

        String id = provisioner.ensureField("inst-1", "aud-1", "Class", 4);

        assertEquals("cf-class", id);
        verify(fields, never()).save(any());
        assertEquals("DROPDOWN", classField.getFieldType());
        ArgumentCaptor<InstituteCustomField> saved = ArgumentCaptor.forClass(InstituteCustomField.class);
        verify(links).save(saved.capture());
        assertEquals("aud-1", saved.getValue().getTypeId());
        assertEquals("AUDIENCE_FORM", saved.getValue().getType());
        assertEquals(4, saved.getValue().getIndividualOrder());
        verify(responses).acquireTransactionLock("custom-field-key:class_inst_inst-1");
    }

    @Test
    void ensureFieldUsesAColumnAlreadyOnTheListByName() {
        when(links.findInstituteCustomFieldsWithDetails("inst-1", "AUDIENCE_FORM", "aud-1"))
                .thenReturn(List.<Object[]>of(new Object[]{link("ACTIVE"), cf("cf-own", "x_1", " class ", "ACTIVE")}));

        assertEquals("cf-own", provisioner.ensureField("inst-1", "aud-1", "Class", 3));
        verifyNoInteractions(fields);
        verify(links, never()).save(any());
    }

    @Test
    void aColumnTheAdminRemovedFromTheListIsLeftOut() {
        when(links.findInstituteCustomFieldsWithDetails("inst-1", "AUDIENCE_FORM", "aud-1"))
                .thenReturn(List.<Object[]>of(new Object[]{link("DELETED"), cf("cf-own", "x", "Class", "ACTIVE")}));

        assertNull(provisioner.ensureField("inst-1", "aud-1", "Class", 3));
        verifyNoInteractions(fields);
        verify(links, never()).save(any());
    }

    @Test
    void ensureFieldCreatesATextFieldWhenTheInstituteHasNone() {
        when(fields.findByFieldKeyAnyStatusWithLock(any())).thenReturn(List.of());
        when(fields.save(any(CustomFields.class))).thenAnswer(inv -> {
            CustomFields c = inv.getArgument(0);
            c.setId("cf-new");
            return c;
        });
        when(links.findTopByInstituteIdAndCustomFieldIdAndTypeAndTypeIdAndStatusOrderByCreatedAtDesc(
                any(), any(), any(), any(), any())).thenReturn(Optional.empty());

        assertEquals("cf-new", provisioner.ensureField("inst-1", "aud-1", "Parent Name", 3));

        ArgumentCaptor<CustomFields> saved = ArgumentCaptor.forClass(CustomFields.class);
        verify(fields).save(saved.capture());
        assertEquals("Parent Name", saved.getValue().getFieldName());
        assertEquals("parent_name_inst_inst-1", saved.getValue().getFieldKey());
        assertEquals("TEXT", saved.getValue().getFieldType());
        assertEquals("ACTIVE", saved.getValue().getStatus());
    }

    @Test
    void aSwitchedOffFieldIsNeverReactivated() {
        CustomFields off = cf("cf-off", "class_inst_inst-1", "Class", "INACTIVE");
        when(fields.findByFieldKeyAnyStatusWithLock("class_inst_inst-1")).thenReturn(List.of(off));
        when(fields.findByFieldKeyAnyStatusWithLock("class_inst_inst-1_1")).thenReturn(List.of());
        when(fields.save(any(CustomFields.class))).thenAnswer(inv -> {
            CustomFields c = inv.getArgument(0);
            c.setId("cf-fresh");
            return c;
        });
        when(links.findTopByInstituteIdAndCustomFieldIdAndTypeAndTypeIdAndStatusOrderByCreatedAtDesc(
                any(), any(), any(), any(), any())).thenReturn(Optional.empty());

        assertEquals("cf-fresh", provisioner.ensureField("inst-1", "aud-1", "Class", 3));

        assertEquals("INACTIVE", off.getStatus());
        verify(fields, never()).save(same(off));
        verify(fields).save(argThat(c -> "class_inst_inst-1_1".equals(c.getFieldKey())));
    }

    @Test
    void aSecondListReusesTheActiveSuffixedFieldInsteadOfMakingAnother() {
        when(fields.findByFieldKeyAnyStatusWithLock("class_inst_inst-1"))
                .thenReturn(List.of(cf("cf-off", "class_inst_inst-1", "Class", "INACTIVE")));
        when(fields.findByFieldKeyAnyStatusWithLock("class_inst_inst-1_1"))
                .thenReturn(List.of(cf("cf-1", "class_inst_inst-1_1", "Class", "ACTIVE")));
        when(links.findTopByInstituteIdAndCustomFieldIdAndTypeAndTypeIdAndStatusOrderByCreatedAtDesc(
                any(), any(), any(), any(), any())).thenReturn(Optional.empty());

        assertEquals("cf-1", provisioner.ensureField("inst-1", "aud-2", "Class", 3));
        verify(fields, never()).save(any());
    }

    @Test
    void ensureFieldDoesNotLinkTwice() {
        when(fields.findByFieldKeyAnyStatusWithLock(any()))
                .thenReturn(List.of(cf("cf-1", "k", "Marks Scored", "ACTIVE")));
        when(links.findTopByInstituteIdAndCustomFieldIdAndTypeAndTypeIdAndStatusOrderByCreatedAtDesc(
                any(), any(), any(), any(), any())).thenReturn(Optional.of(new InstituteCustomField()));

        provisioner.ensureField("inst-1", "aud-1", "Marks Scored", 53);

        verify(links, never()).save(any());
    }
}
