package vacademy.io.admin_core_service.features.hr_attendance.controller;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import vacademy.io.admin_core_service.core.security.HrAccessGuard;
import vacademy.io.admin_core_service.features.admin_activity_logs.annotation.Auditable;
import vacademy.io.admin_core_service.features.hr_attendance.dto.HolidayDTO;
import vacademy.io.admin_core_service.features.hr_attendance.service.HolidayService;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.util.List;

@RestController
@RequestMapping("/admin-core-service/api/v1/hr/holidays")
public class HolidayController {

    @Autowired
    private HolidayService holidayService;

    @Autowired
    private HrAccessGuard hrAccessGuard;

    @PostMapping
    @Auditable(
            entityType = "HR_HOLIDAY",
            action = "CREATE",
            entityIdExpr = "#result?.body")
    public ResponseEntity<String> createHoliday(
            @RequestBody HolidayDTO holidayDTO,
            @RequestParam("instituteId") String instituteId,
            @RequestAttribute("user") CustomUserDetails user) {
        hrAccessGuard.requireHrAdmin(user, instituteId);
        return ResponseEntity.ok(holidayService.createHoliday(holidayDTO, instituteId));
    }

    @GetMapping
    public ResponseEntity<List<HolidayDTO>> getHolidays(
            @RequestParam("instituteId") String instituteId,
            @RequestParam("year") Integer year,
            @RequestAttribute("user") CustomUserDetails user) {
        // Any member of the institute may see its holiday calendar
        hrAccessGuard.validateMember(user, instituteId);
        return ResponseEntity.ok(holidayService.getHolidays(instituteId, year));
    }

    @PutMapping("/{id}")
    @Auditable(
            entityType = "HR_HOLIDAY",
            action = "UPDATE",
            entityIdExpr = "#id")
    public ResponseEntity<String> updateHoliday(
            @PathVariable("id") String id,
            @RequestBody HolidayDTO holidayDTO,
            @RequestParam("instituteId") String instituteId,
            @RequestAttribute("user") CustomUserDetails user) {
        hrAccessGuard.requireHrAdmin(user, instituteId);
        return ResponseEntity.ok(holidayService.updateHoliday(id, holidayDTO, instituteId));
    }

    @DeleteMapping("/{id}")
    @Auditable(
            entityType = "HR_HOLIDAY",
            action = "DELETE",
            entityIdExpr = "#id")
    public ResponseEntity<Void> deleteHoliday(
            @PathVariable("id") String id,
            @RequestParam("instituteId") String instituteId,
            @RequestAttribute("user") CustomUserDetails user) {
        hrAccessGuard.requireHrAdmin(user, instituteId);
        holidayService.deleteHoliday(id, instituteId);
        return ResponseEntity.noContent().build();
    }

    @PostMapping("/bulk")
    @Auditable(
            entityType = "HR_HOLIDAY",
            action = "BULK_CREATE",
            entityIdExpr = "#instituteId")
    public ResponseEntity<String> bulkCreateHolidays(
            @RequestBody List<HolidayDTO> holidays,
            @RequestParam("instituteId") String instituteId,
            @RequestAttribute("user") CustomUserDetails user) {
        hrAccessGuard.requireHrAdmin(user, instituteId);
        return ResponseEntity.ok(holidayService.bulkCreateHolidays(holidays, instituteId));
    }
}
