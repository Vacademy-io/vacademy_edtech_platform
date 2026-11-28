package vacademy.io.admin_core_service.features.certificate.service;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.auth_service.service.AuthService;
import vacademy.io.admin_core_service.features.certificate.dto.CertificateVerificationDto;
import vacademy.io.admin_core_service.features.certificate.entity.IssuedCertificate;
import vacademy.io.admin_core_service.features.certificate.repository.IssuedCertificateRepository;
import vacademy.io.admin_core_service.features.institute.repository.InstituteRepository;
import vacademy.io.common.auth.dto.UserDTO;
import vacademy.io.common.institute.entity.Institute;

import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * The opt-in that lets an institute show the learner's record on the
 * verification page and document instead of the masked name.
 *
 * <p>The default has to stay exactly as private as before: an institute that
 * never sets the flag must not start publishing usernames or emails.
 */
class CertificateVerificationFullDetailsTest {

    private static final String NUMBER = "EDU2026001";
    private static final String TOKEN = "Ab3xY9kLmN0pQrStUvWxYz";

    private static final String DOCUMENT = "<p>{{STUDENT_NAME}}|{{USERNAME}}|{{FIRST_NAME}}|"
            + "{{LAST_NAME}}|{{EMAIL}}|{{COURSE_NAME}}</p>";

    private InstituteRepository institutes;
    private CertificateVerificationService service;

    @BeforeEach
    void setUp() {
        IssuedCertificateRepository certificates = mock(IssuedCertificateRepository.class);
        institutes = mock(InstituteRepository.class);
        AuthService authService = mock(AuthService.class);
        when(authService.getUsersFromAuthServiceByUserIds(any())).thenReturn(List.of(UserDTO.builder()
                .id("user-1")
                .fullName("Alex Quinn Sample")
                .username("2025/04/001")
                .email("alex.sample@example.com")
                .build()));
        when(certificates.findByCertificateIdAndVerificationToken(NUMBER, TOKEN))
                .thenReturn(Optional.of(IssuedCertificate.builder()
                        .id(NUMBER)
                        .certificateId(NUMBER)
                        .instituteId("inst-1")
                        .userId("user-1")
                        .courseName("Sample Course")
                        .verificationToken(TOKEN)
                        .build()));
        when(certificates.findByCertificateIdAndShortCode(anyString(), anyString()))
                .thenReturn(Optional.empty());

        service = new CertificateVerificationService(certificates, institutes, authService);
    }

    private void settings(String certificateConfigJson) {
        Institute institute = new Institute();
        institute.setInstituteName("Sample Institute");
        institute.setSetting("{\"setting\":{\"CERTIFICATE_SETTING\":{\"data\":{\"data\":[{"
                + "\"key\":\"COURSE_COMPLETION\"," + certificateConfigJson + "}]}}}}");
        when(institutes.findById("inst-1")).thenReturn(Optional.of(institute));
    }

    private static String documentConfig(boolean fullDetails) {
        return "\"verificationMode\":\"DOCUMENT\","
                + "\"verificationDocumentHtml\":\"" + DOCUMENT + "\","
                + "\"verificationShowFullDetails\":" + fullDetails;
    }

    @Test
    void masksAndWithholdsTheRecordByDefault() {
        settings("\"verificationMode\":\"PAGE\"");

        CertificateVerificationDto dto = service.verify(NUMBER, TOKEN).orElseThrow();

        assertEquals("A··· Q···· S·····", dto.getLearnerName());
        assertNull(dto.getLearnerUsername());
        assertNull(dto.getLearnerFirstName());
        assertNull(dto.getLearnerLastName());
        assertNull(dto.getLearnerEmail());
    }

    @Test
    void showsTheRecordWhenTheInstituteOptsIn() {
        settings("\"verificationShowFullDetails\":true");

        CertificateVerificationDto dto = service.verify(NUMBER, TOKEN).orElseThrow();

        assertEquals("Alex Quinn Sample", dto.getLearnerName());
        assertEquals("2025/04/001", dto.getLearnerUsername());
        assertEquals("Alex", dto.getLearnerFirstName());
        assertEquals("Sample", dto.getLearnerLastName());
        assertEquals("alex.sample@example.com", dto.getLearnerEmail());
    }

    @Test
    void documentCarriesTheRecordWhenOptedIn() {
        settings(documentConfig(true));

        String html = service.renderVerificationDocument(NUMBER, TOKEN).orElseThrow();

        assertEquals("<p>Alex Quinn Sample|2025/04/001|Alex|Sample|alex.sample@example.com|Sample Course</p>",
                html);
    }

    /** A document that places the new tokens must still print nothing extra without the opt-in. */
    @Test
    void documentBlanksTheRecordWithoutTheOptIn() {
        settings(documentConfig(false));

        String html = service.renderVerificationDocument(NUMBER, TOKEN).orElseThrow();

        assertEquals("<p>A··· Q···· S·····|||||Sample Course</p>", html);
    }

    @Test
    void splitsFirstAndLastName() {
        assertEquals("Alex", CertificateVerificationService.firstName("  Alex   Quinn Sample "));
        assertEquals("Sample", CertificateVerificationService.lastName("  Alex   Quinn Sample "));
        assertEquals("Alex", CertificateVerificationService.firstName("Alex"));
        assertEquals("", CertificateVerificationService.lastName("Alex"));
        assertEquals("", CertificateVerificationService.firstName(null));
        assertEquals("", CertificateVerificationService.lastName(""));
    }
}
