package vacademy.io.assessment_service.features.assessment.copy_intake.service;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Service;
import org.springframework.web.client.HttpStatusCodeException;
import vacademy.io.common.core.internal_api_wrapper.InternalClientUtils;
import vacademy.io.common.exceptions.VacademyException;

import java.util.ArrayList;
import java.util.Collection;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * Is an uploaded file the institute's own (gate G12, T0.32)?
 *
 * <p>Copy-intake used to take any fileId it was given, so a member of one institute
 * could feed another institute's answer sheet through the AI reader and onto their
 * own exam. Every file is now looked up in media_service's {@code file_metadata}
 * (internal HMAC route) and accepted only when it was recorded for this institute:
 * <ul>
 *   <li>a dashboard upload - the bulk-check dialog uploads with
 *       {@code source = <institute id>} (and {@code source_id = ASSESSMENT_OFFLINE_ENTRY});</li>
 *   <li>a partner API upload - {@code source = AI_EVAL_API},
 *       {@code source_id = <institute id>} (C3).</li>
 * </ul>
 * A file media does not know, or recorded for anyone else, is not the institute's.
 * When media cannot be reached at all the caller is refused (fail closed): this is
 * a tenancy check, and grading needs media anyway.
 */
@Slf4j
@Service
public class InstituteFileOwnership {

        /** Reserved source of partner API uploads (media C3); its source_id is the institute. */
        public static final String EVAL_API_SOURCE = "AI_EVAL_API";

        static final String DETAILS_ROUTE = "/media-service/internal/get-details/ids";
        static final String DETAIL_ROUTE = "/media-service/internal/get-details/id";
        static final int CHUNK = 50;

        /** A file id as media issues it; anything else never reaches the query string. */
        private static final Pattern FILE_ID = Pattern.compile("^[A-Za-z0-9_-]{1,64}$");

        private final InternalClientUtils internalClientUtils;
        private final ObjectMapper objectMapper;
        private final String mediaServiceBaseUrl;
        private final String clientName;

        public InstituteFileOwnership(InternalClientUtils internalClientUtils, ObjectMapper objectMapper,
                        @Value("${media.service.baseurl}") String mediaServiceBaseUrl,
                        @Value("${spring.application.name:assessment_service}") String clientName) {
                this.internalClientUtils = internalClientUtils;
                this.objectMapper = objectMapper;
                this.mediaServiceBaseUrl = mediaServiceBaseUrl;
                this.clientName = clientName;
        }

        /**
         * The ids in {@code fileIds} that are NOT recorded for {@code instituteId}, in input
         * order. Empty = every file is the institute's.
         *
         * @throws VacademyException (503) when media_service could not be asked
         */
        public List<String> notOwnedBy(String instituteId, Collection<String> fileIds) {
                Set<String> notOwned = new LinkedHashSet<>();
                List<String> lookup = new ArrayList<>();
                for (String id : fileIds) {
                        if (id == null || !FILE_ID.matcher(id).matches() || instituteId == null || instituteId.isBlank()) {
                                notOwned.add(id);
                        } else if (!lookup.contains(id)) {
                                lookup.add(id);
                        }
                }
                for (int from = 0; from < lookup.size(); from += CHUNK) {
                        List<String> chunk = lookup.subList(from, Math.min(lookup.size(), from + CHUNK));
                        Map<String, Map<String, Object>> found = details(chunk);
                        for (String id : chunk) {
                                Map<String, Object> row = found.get(id);
                                if (row == null || !owned(instituteId, str(row.get("source")), str(row.get("source_id")))) {
                                        notOwned.add(id);
                                }
                        }
                }
                return new ArrayList<>(notOwned);
        }

        /** The two shapes a file recorded for the institute has (see the class doc). */
        public static boolean owned(String instituteId, String source, String sourceId) {
                if (instituteId == null || instituteId.isBlank()) {
                        return false;
                }
                if (instituteId.equals(source)) {
                        return true;
                }
                return EVAL_API_SOURCE.equals(source) && instituteId.equals(sourceId);
        }

        /**
         * Metadata rows by id for one chunk. media fails the whole list when any id is
         * unknown, so a refused list is retried id by id; an unknown id then simply has
         * no row.
         */
        private Map<String, Map<String, Object>> details(List<String> ids) {
                Map<String, Map<String, Object>> out = new java.util.HashMap<>();
                try {
                        ResponseEntity<String> response = internalClientUtils.makeHmacRequest(clientName, "GET",
                                        mediaServiceBaseUrl, DETAILS_ROUTE + "?fileIds=" + String.join(",", ids) + "&expiryDays=1",
                                        null);
                        for (Map<String, Object> row : parseList(response.getBody())) {
                                if (row.get("id") != null) out.put(row.get("id").toString(), row);
                        }
                        return out;
                } catch (HttpStatusCodeException listRefused) {
                        // An unknown id in the list (or a list media would not serve): ask one by one.
                } catch (Exception e) {
                        throw unavailable(e);
                }
                for (String id : ids) {
                        try {
                                ResponseEntity<String> response = internalClientUtils.makeHmacRequest(clientName, "GET",
                                                mediaServiceBaseUrl, DETAIL_ROUTE + "?fileId=" + id + "&expiryDays=1", null);
                                Map<String, Object> row = parseOne(response.getBody());
                                if (row != null) out.put(id, row);
                        } catch (HttpStatusCodeException e) {
                                // media answers an unknown id with 510 ("File Not Found"); a 404 means
                                // the same. Anything else (401: this service not registered; 5xx) is
                                // media failing, not the file being foreign.
                                int code = e.getStatusCode().value();
                                if (code != HttpStatus.NOT_FOUND.value() && code != HttpStatus.NOT_EXTENDED.value()) {
                                        throw unavailable(e);
                                }
                        } catch (Exception e) {
                                throw unavailable(e);
                        }
                }
                return out;
        }

        private List<Map<String, Object>> parseList(String body) throws Exception {
                if (body == null || body.isBlank()) return List.of();
                List<Map<String, Object>> rows = objectMapper.readValue(body, new TypeReference<List<Map<String, Object>>>() {
                });
                return rows != null ? rows : List.of();
        }

        private Map<String, Object> parseOne(String body) throws Exception {
                if (body == null || body.isBlank()) return null;
                return objectMapper.readValue(body, new TypeReference<Map<String, Object>>() {
                });
        }

        private static VacademyException unavailable(Exception e) {
                log.error("[copy-intake] could not verify uploaded files with media-service: {}", e.getMessage());
                return new VacademyException(HttpStatus.SERVICE_UNAVAILABLE,
                                "Could not verify the uploaded files right now; please try again in a minute.");
        }

        private static String str(Object value) {
                return value == null ? null : value.toString();
        }
}
