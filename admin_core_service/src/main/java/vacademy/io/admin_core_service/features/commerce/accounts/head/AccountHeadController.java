package vacademy.io.admin_core_service.features.commerce.accounts.head;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import vacademy.io.admin_core_service.features.commerce.accounts.AccountsAccess;
import vacademy.io.admin_core_service.features.commerce.accounts.head.AccountHeadDtos.HeadRequest;
import vacademy.io.admin_core_service.features.commerce.accounts.head.AccountHeadDtos.HeadView;
import vacademy.io.admin_core_service.features.commerce.security.CommerceAccessGuard;
import vacademy.io.admin_core_service.features.commerce.security.CommerceFeature;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.util.List;

/**
 * Account heads ({@code /commerce/v1/account-heads}). Any manager or accountant reads them (an
 * accountant at one location still picks a category); creating and editing need one who acts for
 * every location.
 */
@RestController
@RequestMapping("/admin-core-service/commerce/v1/account-heads")
public class AccountHeadController {

    private final CommerceAccessGuard accessGuard;
    private final AccountHeadService headService;

    public AccountHeadController(CommerceAccessGuard accessGuard, AccountHeadService headService) {
        this.accessGuard = accessGuard;
        this.headService = headService;
    }

    @GetMapping
    public ResponseEntity<List<HeadView>> list(@RequestAttribute("user") CustomUserDetails user,
                                               @RequestParam("instituteId") String instituteId,
                                               @RequestParam(value = "nature", required = false) String nature,
                                               @RequestParam(value = "status", required = false) String status) {
        accessGuard.require(user, instituteId, CommerceFeature.ACCOUNTS, AccountsAccess.ACCOUNTS_STAFF);
        return ResponseEntity.ok(headService.list(instituteId, user.getUserId(), nature, status));
    }

    @PostMapping
    public ResponseEntity<HeadView> create(@RequestAttribute("user") CustomUserDetails user,
                                           @RequestParam("instituteId") String instituteId,
                                           @RequestBody HeadRequest request) {
        accessGuard.requireInstituteWide(user, instituteId, CommerceFeature.ACCOUNTS, AccountsAccess.ACCOUNTS_STAFF);
        return ResponseEntity.status(HttpStatus.CREATED).body(headService.create(instituteId, user.getUserId(), request));
    }

    @PutMapping("/{headId}")
    public ResponseEntity<HeadView> update(@RequestAttribute("user") CustomUserDetails user,
                                           @RequestParam("instituteId") String instituteId,
                                           @PathVariable("headId") String headId,
                                           @RequestBody HeadRequest request) {
        accessGuard.requireInstituteWide(user, instituteId, CommerceFeature.ACCOUNTS, AccountsAccess.ACCOUNTS_STAFF);
        return ResponseEntity.ok(headService.update(instituteId, user.getUserId(), headId, request));
    }
}
