package vacademy.io.admin_core_service.features.telleo.controller;

import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import vacademy.io.admin_core_service.features.telleo.service.TelleoTrialService;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.auth.util.SuperAdminAuthUtil;
import vacademy.io.common.exceptions.VacademyException;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Staff only: read and move a Telleo self sign-up between TRIAL, LIVE and SUSPENDED. Going live
 * is meant to happen automatically after payment (not built yet: the gateway is not chosen), so
 * until then this is how an account is opened up; SUSPENDED stops all its real calls at once.
 *
 * <pre>
 *   GET /admin-core-service/super-admin/v1/telleo/{instituteId}/state
 *   PUT /admin-core-service/super-admin/v1/telleo/{instituteId}/state   {"state":"LIVE"}
 * </pre>
 */
@RestController
@RequestMapping("/admin-core-service/super-admin/v1/telleo")
@RequiredArgsConstructor
public class SuperAdminTelleoController {

    private final TelleoTrialService trialService;

    @GetMapping("/{instituteId}/state")
    public Map<String, Object> get(@PathVariable("instituteId") String instituteId,
                                   @RequestAttribute("user") CustomUserDetails user) {
        SuperAdminAuthUtil.requireSuperAdmin(user);
        return view(trialService.find(instituteId).orElseThrow(() ->
                new VacademyException(HttpStatus.NOT_FOUND, "This institute is not a Telleo self sign-up")));
    }

    @PutMapping("/{instituteId}/state")
    public Map<String, Object> set(@PathVariable("instituteId") String instituteId,
                                   @RequestBody Map<String, String> body,
                                   @RequestAttribute("user") CustomUserDetails user) {
        SuperAdminAuthUtil.requireSuperAdmin(user);
        String state = body == null ? null : body.get("state");
        return view(trialService.setState(instituteId, state, "super-admin:" + user.getUserId()));
    }

    private static Map<String, Object> view(TelleoTrialService.TrialInfo info) {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("institute_id", info.instituteId());
        out.put("state", info.state());
        out.put("verified_phone", info.phoneE164());
        out.put("trial_ends_at", info.trialEndsAt() == null ? null : info.trialEndsAt().toString());
        return out;
    }
}
