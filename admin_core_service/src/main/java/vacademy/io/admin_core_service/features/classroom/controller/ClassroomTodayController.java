package vacademy.io.admin_core_service.features.classroom.controller;

import lombok.RequiredArgsConstructor;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import vacademy.io.admin_core_service.core.security.InstituteAccessValidator;
import vacademy.io.admin_core_service.features.classroom.dto.ClassroomTodayResponse;
import vacademy.io.admin_core_service.features.classroom.service.ClassroomTodayService;
import vacademy.io.common.auth.model.CustomUserDetails;

/**
 * Today's live classes for a classroom panel or the teacher's phone page.
 *
 * <p>Marked no-store: a panel's WebView is shared between teachers, so one teacher's list
 * must never be answered from another's cache.
 */
@RestController
@RequestMapping("/admin-core-service/classroom/v1")
@RequiredArgsConstructor
public class ClassroomTodayController {

    private final InstituteAccessValidator instituteAccessValidator;
    private final ClassroomTodayService classroomTodayService;

    @GetMapping("/today")
    public ResponseEntity<ClassroomTodayResponse> today(
            @RequestParam("instituteId") String instituteId,
            @RequestParam(value = "scope", required = false, defaultValue = ClassroomTodayService.SCOPE_MINE) String scope,
            @RequestAttribute("user") CustomUserDetails user) {
        instituteAccessValidator.requireInstituteStaff(user, instituteId);
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(classroomTodayService.today(instituteId, scope, user));
    }
}
