package vacademy.io.admin_core_service.features.enroll_invite.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;
import vacademy.io.admin_core_service.features.enroll_invite.entity.EnrollInvite;
import vacademy.io.admin_core_service.features.enroll_invite.repository.EnrollInviteRepository;
import vacademy.io.admin_core_service.features.institute.entity.Template;
import vacademy.io.admin_core_service.features.institute.repository.TemplateRepository;

import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class EnrollInviteEmailOverrideServiceTest {

    private EnrollInviteEmailOverrideService service;
    private TemplateRepository templates;
    private EnrollInviteRepository invites;

    @BeforeEach
    void setUp() {
        service = new EnrollInviteEmailOverrideService();
        templates = mock(TemplateRepository.class);
        invites = mock(EnrollInviteRepository.class);
        ReflectionTestUtils.setField(service, "templateRepository", templates);
        ReflectionTestUtils.setField(service, "enrollInviteRepository", invites);
        ReflectionTestUtils.setField(service, "objectMapper", new ObjectMapper());
    }

    private static EnrollInvite invite(String settingJson) {
        EnrollInvite invite = new EnrollInvite();
        invite.setId("invite-1");
        invite.setInstituteId("inst-1");
        invite.setSettingJson(settingJson);
        return invite;
    }

    private static Template template(String instituteId, String type, String content) {
        Template t = new Template();
        t.setId("tpl-1");
        t.setInstituteId(instituteId);
        t.setType(type);
        t.setContent(content);
        return t;
    }

    private static final String CUSTOM_ONLY = "{\"postformfillConfiguration\":{},\"setting\":"
            + "{\"ENROLLMENT_EMAIL_SETTING\":{\"MODE\":\"CUSTOM_ONLY\",\"TEMPLATE_ID\":\"tpl-1\"}}}";

    @Test
    @DisplayName("CUSTOM_ONLY with an EMAIL template of the same institute returns it")
    void customOnly() {
        Template t = template("inst-1", "EMAIL", "<p>Thanks</p>");
        when(templates.findById("tpl-1")).thenReturn(Optional.of(t));
        assertSame(t, service.customOnlyTemplate(invite(CUSTOM_ONLY)).orElseThrow());
    }

    @Test
    @DisplayName("looked up by invite id")
    void byInviteId() {
        when(invites.findById("invite-1")).thenReturn(Optional.of(invite(CUSTOM_ONLY)));
        when(templates.findById("tpl-1")).thenReturn(Optional.of(template("inst-1", "EMAIL", "x")));
        assertTrue(service.customOnlyTemplate("invite-1").isPresent());
        assertTrue(service.customOnlyTemplate((String) null).isEmpty());
    }

    @Test
    @DisplayName("no setting, another mode or bad JSON keep the default emails")
    void defaults() {
        assertTrue(service.customOnlyTemplate(invite(null)).isEmpty());
        assertTrue(service.customOnlyTemplate(invite("{\"postformfillConfiguration\":{}}")).isEmpty());
        assertTrue(service.customOnlyTemplate(invite("{\"setting\":{\"ENROLLMENT_EMAIL_SETTING\":"
                + "{\"MODE\":\"DEFAULT\",\"TEMPLATE_ID\":\"tpl-1\"}}}")).isEmpty());
        assertTrue(service.customOnlyTemplate(invite("{not json")).isEmpty());
        verifyNoInteractions(templates);
    }

    @Test
    @DisplayName("a template that is missing, foreign, not EMAIL or empty falls back to the defaults")
    void unusableTemplate() {
        when(templates.findById("tpl-1")).thenReturn(Optional.empty());
        assertTrue(service.customOnlyTemplate(invite(CUSTOM_ONLY)).isEmpty());

        when(templates.findById("tpl-1")).thenReturn(Optional.of(template("other-inst", "EMAIL", "x")));
        assertTrue(service.customOnlyTemplate(invite(CUSTOM_ONLY)).isEmpty());

        when(templates.findById("tpl-1")).thenReturn(Optional.of(template("inst-1", "WHATSAPP", "x")));
        assertTrue(service.customOnlyTemplate(invite(CUSTOM_ONLY)).isEmpty());

        when(templates.findById("tpl-1")).thenReturn(Optional.of(template("inst-1", "EMAIL", " ")));
        assertTrue(service.customOnlyTemplate(invite(CUSTOM_ONLY)).isEmpty());
    }
}
