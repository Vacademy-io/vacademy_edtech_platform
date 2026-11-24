package vacademy.io.admin_core_service.features.member_api;

import com.fasterxml.jackson.databind.JsonNode;
import jakarta.servlet.http.HttpServletRequest;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Public Member Lookup API, for an institute's own systems (CRM, another LMS) to cross-check
 * users against the platform: does the user exist, who are they (profile + custom fields),
 * what membership do they hold and until when, and where do they sit in a sub-org.
 *
 * <pre>
 * GET  /admin-core-service/open/members/v1/lookup?email=…   (or phone= / username= / user_id=)
 * POST /admin-core-service/open/members/v1/lookup/bulk      {"identifiers":[{"email":"…"},{"phone":"…"}]}
 * GET  /admin-core-service/open/members/v1/sub-orgs/{subOrgId}/members?page=0&amp;size=100
 * X-API-Key: vak_login_…   (Settings → Security → Login links)
 * </pre>
 *
 * Read-only. The institute always comes from the key ({@link MemberApiAuth}); a user, a
 * sub-org or a custom field of another institute is never visible.
 */
@Slf4j
@RestController
@RequestMapping("/admin-core-service/open/members/v1")
@RequiredArgsConstructor
public class PublicMemberApiController {

    static final int MAX_BULK = 100;

    private final MemberApiAuth auth;
    private final MemberLookupService service;

    @GetMapping("/lookup")
    public ResponseEntity<Map<String, Object>> lookup(
            HttpServletRequest request,
            @RequestParam(value = "user_id", required = false) String userId,
            @RequestParam(value = "email", required = false) String email,
            @RequestParam(value = "username", required = false) String username,
            @RequestParam(value = "phone", required = false) String phone,
            @RequestParam(value = "include_team_members", defaultValue = "true") boolean includeTeamMembers) {
        MemberApiAuth.Principal p = auth.authenticate(request);
        MemberLookupService.Identifier id = MemberLookupService.Identifier.of(userId, email, username, phone);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("query", id.view());
        out.putAll(service.lookup(p.instituteId(), id, includeTeamMembers));
        return noStore(out);
    }

    /**
     * Up to {@value #MAX_BULK} identifiers per call, each {"email"|"phone"|"username"|"user_id": "…"}.
     * Results come back in request order; a malformed entry gets an "error" instead of failing
     * the batch. Team member lists are off by default here (member_count is always given).
     */
    @PostMapping("/lookup/bulk")
    public ResponseEntity<Map<String, Object>> bulk(HttpServletRequest request,
                                                    @RequestBody(required = false) JsonNode body) {
        MemberApiAuth.Principal p = auth.authenticate(request);
        JsonNode list = body == null ? null : body.get("identifiers");
        if (list == null || !list.isArray() || list.isEmpty()) {
            throw new MemberApiException(HttpStatus.BAD_REQUEST, "invalid_request",
                    "Send {\"identifiers\": [{\"email\": \"…\"}, …]}.");
        }
        if (list.size() > MAX_BULK) {
            throw new MemberApiException(HttpStatus.BAD_REQUEST, "invalid_request",
                    "At most " + MAX_BULK + " identifiers per call.");
        }
        boolean includeTeam = body.path("include_team_members").asBoolean(false);
        List<Map<String, Object>> results = new ArrayList<>();
        int found = 0;
        for (JsonNode item : list) {
            Map<String, Object> r = new LinkedHashMap<>();
            try {
                MemberLookupService.Identifier id = MemberLookupService.Identifier.of(
                        text(item, "user_id"), text(item, "email"), text(item, "username"), text(item, "phone"));
                r.put("query", id.view());
                r.putAll(service.lookup(p.instituteId(), id, includeTeam));
                if (Boolean.TRUE.equals(r.get("found"))) found++;
            } catch (MemberApiException e) {
                r.put("query", item);
                r.put("found", false);
                r.put("error", Map.of("code", e.getCode(), "message", e.getMessage()));
            }
            results.add(r);
        }
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("count", results.size());
        out.put("found_count", found);
        out.put("results", results);
        return noStore(out);
    }

    @GetMapping("/sub-orgs/{subOrgId}/members")
    public ResponseEntity<Map<String, Object>> subOrgMembers(
            HttpServletRequest request,
            @PathVariable("subOrgId") String subOrgId,
            @RequestParam(value = "page", defaultValue = "0") int page,
            @RequestParam(value = "size", defaultValue = "100") int size) {
        MemberApiAuth.Principal p = auth.authenticate(request);
        if (page < 0 || size < 1 || size > MemberLookupService.MAX_TEAM_PAGE_SIZE) {
            throw new MemberApiException(HttpStatus.BAD_REQUEST, "invalid_request",
                    "page must be >= 0 and size between 1 and " + MemberLookupService.MAX_TEAM_PAGE_SIZE + ".");
        }
        return noStore(service.subOrgTeam(p.instituteId(), subOrgId.trim(), page, size));
    }

    private static String text(JsonNode item, String field) {
        JsonNode n = item == null ? null : item.get(field);
        return n == null || n.isNull() ? null : n.asText();
    }

    private static ResponseEntity<Map<String, Object>> noStore(Map<String, Object> body) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(body);
    }
}
