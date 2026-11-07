package vacademy.io.admin_core_service.features.catalogue_review.service;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.test.util.ReflectionTestUtils;
import vacademy.io.admin_core_service.features.auth_service.service.AuthService;
import vacademy.io.admin_core_service.features.catalogue_review.dto.ReviewAnswer;
import vacademy.io.admin_core_service.features.catalogue_review.entity.CatalogueReview;
import vacademy.io.admin_core_service.features.domain_routing.entity.InstituteDomainRouting;
import vacademy.io.admin_core_service.features.domain_routing.repository.InstituteDomainRoutingRepository;
import vacademy.io.admin_core_service.features.institute.entity.Template;
import vacademy.io.admin_core_service.features.institute.repository.InstituteRepository;
import vacademy.io.admin_core_service.features.institute.repository.TemplateRepository;
import vacademy.io.admin_core_service.features.notification_service.service.NotificationService;
import vacademy.io.admin_core_service.features.workflow.service.WorkflowTriggerService;
import vacademy.io.common.auth.dto.UserDTO;
import vacademy.io.common.exceptions.VacademyException;

import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/**
 * Built-in alerts for a new website review: the admins' bell always, the
 * default email unless the institute runs its own REVIEW_SUBMITTED workflow,
 * visitor text escaped, the institute's own template first, and nothing ever
 * thrown back.
 */
class ReviewAdminAlertServiceTest {

    private static final String INST = "inst-1";

    private AuthService auth;
    private NotificationService notifications;
    private TemplateRepository templates;
    private InstituteRepository institutes;
    private InstituteDomainRoutingRepository routing;
    private WorkflowTriggerService workflows;
    private ReviewAdminAlertService service;

    @BeforeEach
    void setUp() {
        auth = mock(AuthService.class);
        notifications = mock(NotificationService.class);
        templates = mock(TemplateRepository.class);
        institutes = mock(InstituteRepository.class);
        routing = mock(InstituteDomainRoutingRepository.class);
        workflows = mock(WorkflowTriggerService.class);
        service = new ReviewAdminAlertService();
        ReflectionTestUtils.setField(service, "authService", auth);
        ReflectionTestUtils.setField(service, "notificationService", notifications);
        ReflectionTestUtils.setField(service, "templateRepository", templates);
        ReflectionTestUtils.setField(service, "instituteRepository", institutes);
        ReflectionTestUtils.setField(service, "domainRoutingRepository", routing);
        ReflectionTestUtils.setField(service, "workflowTriggerService", workflows);
        when(auth.requireUsersByInstituteAndRoles(INST, List.of("ADMIN"))).thenReturn(List.of(admin("a1", "a1@x.in"), admin("a2", "a2@x.in")));
        when(institutes.findById(INST)).thenReturn(Optional.empty());
        when(templates.findByInstituteIdAndNameAndType(INST, ReviewAdminAlertService.TEMPLATE_NAME, "EMAIL")).thenReturn(Optional.empty());
        when(templates.findByInstituteIdAndNameAndType("DEFAULT", ReviewAdminAlertService.TEMPLATE_NAME, "EMAIL"))
                .thenReturn(Optional.of(template("New {{rating}}-star review from {{reviewer_name}}", "<p>Hi {{recipient_name}}</p>{{review_text}}{{details_html}}<a href=\"{{reviews_url}}\">x</a>")));
        InstituteDomainRouting admin = new InstituteDomainRouting();
        admin.setSubdomain("admin");
        admin.setDomain("parchamclasses.in");
        when(routing.findByInstituteIdAndRole(INST, "ADMIN")).thenReturn(Optional.of(admin));
    }

    private static UserDTO admin(String id, String email) {
        UserDTO u = new UserDTO();
        u.setId(id);
        u.setEmail(email);
        u.setFullName("Admin " + id);
        return u;
    }

    private static Template template(String subject, String content) {
        Template t = new Template();
        t.setSubject(subject);
        t.setContent(content);
        return t;
    }

    private static CatalogueReview review() {
        return CatalogueReview.builder().id("r1").instituteId(INST).rating(4).reviewerName("Asha <b>")
                .reviewText("Great <script>x</script>\nteacher").city("Ajmer").catalogueTag("parcham-classes").build();
    }

    @Test
    void bellAlwaysAndDefaultEmailToEveryAdmin_whenNoWorkflow() {
        service.notifyAdmins(review(), List.of(new ReviewAnswer("f_exam", "Exam", "SSC")));

        verify(notifications).createSystemAlertAnnouncement(eq(INST), eq(List.of("a1", "a2")),
                startsWith("New review ★★★★☆ from Asha"), contains("Approve it in Website Builder"),
                eq("system"), anyString(), eq("ADMIN"), anyMap(), eq("SITE_REVIEW"), eq("r1"));

        ArgumentCaptor<String> body = ArgumentCaptor.forClass(String.class);
        ArgumentCaptor<String> subject = ArgumentCaptor.forClass(String.class);
        verify(notifications, times(2)).sendHtmlEmailViaUnified(anyString(), subject.capture(), body.capture(),
                eq(INST), eq("support@vacademy.io"), isNull(), eq("UTILITY_EMAIL"));
        assertEquals("New 4-star review from Asha &lt;b&gt;", subject.getValue());
        String html = body.getValue();
        assertTrue(html.contains("Great &lt;script&gt;x&lt;/script&gt;<br>teacher"), html);
        assertFalse(html.contains("<script>"));
        assertTrue(html.contains("Ajmer") && html.contains("Exam") && html.contains("SSC"), html);
        assertTrue(html.contains("https://admin.parchamclasses.in/manage-pages?reviews=list"), html);
    }

    @Test
    void ownWorkflow_bellStillGoes_defaultEmailStandsDown() {
        when(workflows.hasActiveWorkflow(eq("REVIEW_SUBMITTED"), eq("r1"), eq(INST))).thenReturn(true);
        service.notifyAdmins(review(), null);
        verify(notifications).createSystemAlertAnnouncement(any(), any(), any(), any(), any(), any(), any(), any(), any(), any());
        verify(notifications, never()).sendHtmlEmailViaUnified(any(), any(), any(), any(), any(), any(), any());
    }

    @Test
    void institutesOwnTemplateWinsOverTheDefault() {
        when(templates.findByInstituteIdAndNameAndType(INST, ReviewAdminAlertService.TEMPLATE_NAME, "EMAIL"))
                .thenReturn(Optional.of(template("Custom {{reviewer_name}}", "custom")));
        service.notifyAdmins(review(), null);
        verify(notifications, times(2)).sendHtmlEmailViaUnified(anyString(), eq("Custom Asha &lt;b&gt;"), eq("custom"),
                any(), any(), any(), any());
    }

    @Test
    void noAdminsOrAuthDown_nothingSent_nothingThrown() {
        when(auth.requireUsersByInstituteAndRoles(INST, List.of("ADMIN"))).thenReturn(List.of());
        service.notifyAdmins(review(), null);
        when(auth.requireUsersByInstituteAndRoles(INST, List.of("ADMIN"))).thenThrow(new VacademyException("down"));
        assertDoesNotThrow(() -> service.notifyAdmins(review(), null));
        verifyNoInteractions(notifications);
    }

    @Test
    void failuresInOneChannelDoNotStopTheOther() {
        doThrow(new RuntimeException("bell down")).when(notifications)
                .createSystemAlertAnnouncement(any(), any(), any(), any(), any(), any(), any(), any(), any(), any());
        when(workflows.hasActiveWorkflow(any(), any(), any())).thenThrow(new RuntimeException("db"));
        assertDoesNotThrow(() -> service.notifyAdmins(review(), null));
        // Unknown workflow state: the default email still goes.
        verify(notifications, times(2)).sendHtmlEmailViaUnified(any(), any(), any(), any(), any(), any(), any());
    }

    @Test
    void helpers() {
        assertEquals("★★☆☆☆", ReviewAdminAlertService.stars(2));
        assertEquals("#", ReviewAdminAlertService.url("admin", "localhost"));
        assertEquals("#", ReviewAdminAlertService.url("", "student"));
        assertEquals("https://parchamclasses.in/manage-pages?reviews=list", ReviewAdminAlertService.url("*", "https://parchamclasses.in/"));
        CatalogueReview starsOnly = CatalogueReview.builder().id("r2").rating(5).reviewerName("Ravi").build();
        assertTrue(ReviewAdminAlertService.alertBody(starsOnly).startsWith("Stars only"));
        Map<String, String> v = ReviewAdminAlertService.placeholders(starsOnly, null, "Inst", "#000", "#");
        assertEquals("", v.get("details_html"));
        assertEquals("", v.get("site"));
    }
}
