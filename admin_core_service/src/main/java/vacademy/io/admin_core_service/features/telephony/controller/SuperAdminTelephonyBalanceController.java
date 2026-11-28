package vacademy.io.admin_core_service.features.telephony.controller;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import vacademy.io.admin_core_service.features.telephony.core.TelephonyBalanceService;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.auth.util.SuperAdminAuthUtil;

import java.util.List;
import java.util.Map;

/**
 * Platform portal: live Exotel and Plivo balances across institutes. Platform staff only
 * (SUPER_ADMIN_USER_IDS), the same gate as every other super-admin route.
 */
@RestController
@RequestMapping("/admin-core-service/super-admin/v1/external-apis")
public class SuperAdminTelephonyBalanceController {

    @Autowired private TelephonyBalanceService balanceService;

    @GetMapping("/telephony-balances")
    public ResponseEntity<Map<String, List<Map<String, Object>>>> telephonyBalances(
            @RequestAttribute("user") CustomUserDetails user,
            @RequestParam(value = "refresh", defaultValue = "false") boolean refresh) {
        SuperAdminAuthUtil.requireSuperAdmin(user);
        return ResponseEntity.ok(Map.of("balances", balanceService.balances(refresh)));
    }
}
