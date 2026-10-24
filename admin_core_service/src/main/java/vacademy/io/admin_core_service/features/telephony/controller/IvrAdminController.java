package vacademy.io.admin_core_service.features.telephony.controller;

import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import vacademy.io.admin_core_service.core.security.InstituteAccessValidator;
import vacademy.io.admin_core_service.features.telephony.controller.dto.IvrMenuDTO;
import vacademy.io.admin_core_service.features.telephony.ivr.IvrMenuService;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.VacademyException;

import java.util.List;

/**
 * Admin CRUD for IVR menus (the multi-level inbound tree builder backing API).
 * JWT-protected (default Spring auth — not in ALLOWED_PATHS) and limited to STAFF of
 * the institute the menu belongs to (requireInstituteStaff, no root-user bypass: learners
 * and invited staff are root users; the dashboard sends that institute as clientId) (the request's instituteId, or the stored menu's own
 * institute for routes that carry only a menu id). Before that check any signed-in user
 * could read, rewrite or delete another institute's inbound menus. The frontend tree
 * builder reads/writes whole menus here; the inbound call flow consumes them at runtime
 * via {@link IvrMenuService}.
 */
@RestController
@RequestMapping("/admin-core-service/v1/telephony/ivr")
@RequiredArgsConstructor
public class IvrAdminController {

    private final IvrMenuService ivrMenuService;
    private final InstituteAccessValidator instituteAccessValidator;

    @GetMapping("/menus")
    public ResponseEntity<List<IvrMenuDTO>> list(@RequestParam("instituteId") String instituteId,
                                                 @RequestAttribute("user") CustomUserDetails user) {
        instituteAccessValidator.requireInstituteStaff(user, instituteId);
        return ResponseEntity.ok(ivrMenuService.listMenus(instituteId));
    }

    @GetMapping("/menus/{menuId}")
    public ResponseEntity<IvrMenuDTO> get(@PathVariable("menuId") String menuId,
                                          @RequestAttribute("user") CustomUserDetails user) {
        requireMenuAccess(menuId, user);
        return ResponseEntity.ok(ivrMenuService.getMenu(menuId));
    }

    /** Create (id null) or update (id set) a whole menu tree atomically. */
    @PostMapping("/menus")
    public ResponseEntity<IvrMenuDTO> save(@RequestBody IvrMenuDTO dto,
                                           @RequestAttribute("user") CustomUserDetails user) {
        instituteAccessValidator.requireInstituteStaff(user, dto == null ? null : dto.getInstituteId());
        return ResponseEntity.ok(ivrMenuService.saveMenu(dto));
    }

    @DeleteMapping("/menus/{menuId}")
    public ResponseEntity<Void> delete(@PathVariable("menuId") String menuId,
                                       @RequestAttribute("user") CustomUserDetails user) {
        if (ivrMenuService.menuInstitute(menuId).isEmpty()) {
            return ResponseEntity.noContent().build(); // unknown id: nothing to delete, as before
        }
        requireMenuAccess(menuId, user);
        ivrMenuService.deleteMenu(menuId);
        return ResponseEntity.noContent().build();
    }

    private void requireMenuAccess(String menuId, CustomUserDetails user) {
        String instituteId = ivrMenuService.menuInstitute(menuId)
                .orElseThrow(() -> new VacademyException("IVR menu not found"));
        instituteAccessValidator.requireInstituteStaff(user, instituteId);
    }
}
