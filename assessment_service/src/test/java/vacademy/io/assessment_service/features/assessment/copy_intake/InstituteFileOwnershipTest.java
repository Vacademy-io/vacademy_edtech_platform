package vacademy.io.assessment_service.features.assessment.copy_intake;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.client.HttpClientErrorException;
import org.springframework.web.client.HttpServerErrorException;
import org.springframework.web.client.ResourceAccessException;
import vacademy.io.assessment_service.features.assessment.copy_intake.service.InstituteFileOwnership;
import vacademy.io.common.core.internal_api_wrapper.InternalClientUtils;
import vacademy.io.common.exceptions.VacademyException;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.ArgumentMatchers.startsWith;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Gate G12 / T0.32: copy-intake takes only files media recorded for the institute -
 * dashboard uploads (source = institute) and partner uploads (AI_EVAL_API, source_id =
 * institute) - and refuses when media cannot be asked.
 */
class InstituteFileOwnershipTest {

        private InternalClientUtils internal;
        private InstituteFileOwnership ownership;

        @BeforeEach
        void setUp() {
                internal = mock(InternalClientUtils.class);
                ownership = new InstituteFileOwnership(internal, new ObjectMapper(), "http://media", "assessment_service");
        }

        private void listAnswers(String body) {
                when(internal.makeHmacRequest(eq("assessment_service"), eq("GET"), eq("http://media"),
                                startsWith("/media-service/internal/get-details/ids?fileIds="), isNull()))
                                .thenReturn(ResponseEntity.ok(body));
        }

        @Test
        void dashboardUploadsAndPartnerUploadsOfTheInstituteAreItsOwn() {
                listAnswers("[{\"id\":\"f1\",\"source\":\"inst-1\",\"source_id\":\"ASSESSMENT_OFFLINE_ENTRY\"},"
                                + "{\"id\":\"f2\",\"source\":\"AI_EVAL_API\",\"source_id\":\"inst-1\"}]");

                assertThat(ownership.notOwnedBy("inst-1", List.of("f1", "f2"))).isEmpty();
                verify(internal).makeHmacRequest("assessment_service", "GET", "http://media",
                                "/media-service/internal/get-details/ids?fileIds=f1,f2&expiryDays=1", null);
        }

        @Test
        void anotherInstitutesFilesAreNot() {
                listAnswers("[{\"id\":\"f1\",\"source\":\"inst-2\",\"source_id\":\"ASSESSMENT_OFFLINE_ENTRY\"},"
                                + "{\"id\":\"f2\",\"source\":\"AI_EVAL_API\",\"source_id\":\"inst-2\"},"
                                + "{\"id\":\"f3\",\"source\":\"FLOOR_DOCUMENTS\",\"source_id\":\"STUDENTS\"},"
                                + "{\"id\":\"f4\",\"source\":\"inst-1\",\"source_id\":\"x\"}]");

                assertThat(ownership.notOwnedBy("inst-1", List.of("f1", "f2", "f3", "f4")))
                                .containsExactly("f1", "f2", "f3");
        }

        @Test
        void theOwnershipRule() {
                assertThat(InstituteFileOwnership.owned("inst-1", "inst-1", "anything")).isTrue();
                assertThat(InstituteFileOwnership.owned("inst-1", "AI_EVAL_API", "inst-1")).isTrue();
                // An institute id in source_id is NOT enough for any other source (anyone can
                // pick source_id on the user presign endpoint, and a source naming another
                // institute is that institute's file).
                assertThat(InstituteFileOwnership.owned("inst-1", "FLOOR_DOCUMENTS", "inst-1")).isFalse();
                assertThat(InstituteFileOwnership.owned("inst-1", null, null)).isFalse();
                assertThat(InstituteFileOwnership.owned(null, null, null)).isFalse();
        }

        @Test
        void anUnknownIdMakesMediaRefuseTheListSoEachIdIsAskedAlone() {
                when(internal.makeHmacRequest(any(), eq("GET"), any(),
                                startsWith("/media-service/internal/get-details/ids"), isNull()))
                                .thenThrow(HttpServerErrorException.create(HttpStatus.INTERNAL_SERVER_ERROR, "boom", null,
                                                null, null));
                when(internal.makeHmacRequest(any(), eq("GET"), any(),
                                eq("/media-service/internal/get-details/id?fileId=f1&expiryDays=1"), isNull()))
                                .thenReturn(ResponseEntity.ok("{\"id\":\"f1\",\"source\":\"inst-1\",\"source_id\":\"S\"}"));
                when(internal.makeHmacRequest(any(), eq("GET"), any(),
                                eq("/media-service/internal/get-details/id?fileId=ghost&expiryDays=1"), isNull()))
                                .thenThrow(HttpServerErrorException.create(HttpStatus.NOT_EXTENDED, "File Not Found", null,
                                                null, null));

                assertThat(ownership.notOwnedBy("inst-1", List.of("f1", "ghost"))).containsExactly("ghost");
        }

        @Test
        void anIdThatIsNotAMediaIdNeverReachesTheQueryString() {
                listAnswers("[]");

                assertThat(ownership.notOwnedBy("inst-1", List.of("f1&expiryDays=999", "a,b"))).hasSize(2);
                verify(internal, never()).makeHmacRequest(anyString(), anyString(), anyString(), anyString(), any());
        }

        @Test
        void mediaUnreachableRefusesInsteadOfGuessing() {
                when(internal.makeHmacRequest(any(), eq("GET"), any(), anyString(), isNull()))
                                .thenThrow(new ResourceAccessException("connection refused"));

                assertThatThrownBy(() -> ownership.notOwnedBy("inst-1", List.of("f1")))
                                .isInstanceOfSatisfying(VacademyException.class,
                                                e -> assertThat(e.getStatus()).isEqualTo(HttpStatus.SERVICE_UNAVAILABLE));
        }

        @Test
        void thisServiceNotRegisteredWithMediaIsAnOutageNotAForeignFile() {
                when(internal.makeHmacRequest(any(), eq("GET"), any(), anyString(), isNull()))
                                .thenThrow(HttpClientErrorException.create(HttpStatus.UNAUTHORIZED, "no", null, null, null));

                assertThatThrownBy(() -> ownership.notOwnedBy("inst-1", List.of("f1")))
                                .isInstanceOfSatisfying(VacademyException.class,
                                                e -> assertThat(e.getStatus()).isEqualTo(HttpStatus.SERVICE_UNAVAILABLE));
        }

        @Test
        void largeUploadsAreAskedInChunks() {
                listAnswers("[]");
                List<String> ids = new java.util.ArrayList<>();
                for (int i = 0; i < 120; i++) ids.add("f" + i);

                assertThat(ownership.notOwnedBy("inst-1", ids)).hasSize(120);
                verify(internal, org.mockito.Mockito.times(3)).makeHmacRequest(any(), eq("GET"), any(),
                                startsWith("/media-service/internal/get-details/ids"), isNull());
        }
}
