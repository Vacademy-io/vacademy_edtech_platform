package vacademy.io.admin_core_service.features.telephony.controller;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import vacademy.io.admin_core_service.features.admin_activity_logs.annotation.Auditable;
import vacademy.io.admin_core_service.features.telephony.controller.dto.TelephonyProviderNumberDTO;
import vacademy.io.admin_core_service.features.telephony.core.InboundFlowAttacher;
import vacademy.io.admin_core_service.features.telephony.core.TelephonyNumberTxOps;
import vacademy.io.admin_core_service.features.telephony.persistence.entity.TelephonyProviderNumber;
import vacademy.io.admin_core_service.features.telephony.persistence.repository.TelephonyProviderNumberRepository;
import vacademy.io.common.exceptions.VacademyException;

import java.util.List;

@RestController
@RequestMapping("/admin-core-service/v1/telephony/numbers")
public class TelephonyNumberController {

    @Autowired private TelephonyProviderNumberRepository numberRepo;
    @Autowired private TelephonyNumberTxOps tx;
    @Autowired private InboundFlowAttacher flowAttacher;

    @GetMapping
    public ResponseEntity<List<TelephonyProviderNumberDTO>> list(
            @RequestParam("instituteId") String instituteId) {
        return ResponseEntity.ok(
                numberRepo.findByInstituteId(instituteId).stream()
                        .map(TelephonyProviderNumberDTO::from)
                        .toList());
    }

    @PostMapping
    @Auditable(
            entityType = "TELEPHONY_NUMBER",
            action = "CREATE",
            entityIdExpr = "#result?.body?.id",
            descriptionExpr = "'added calling number ' + (#body?.phoneNumber ?: '')")
    public ResponseEntity<TelephonyProviderNumberDTO> create(
            @RequestBody TelephonyProviderNumberDTO body) {
        if (body.getInstituteId() == null || body.getInstituteId().isBlank()) {
            throw new VacademyException("instituteId is required");
        }
        if (body.getPhoneNumber() == null || body.getPhoneNumber().isBlank()) {
            throw new VacademyException("phoneNumber is required");
        }
        // Persistence runs in its own short transaction (TxOps bean) and commits
        // BEFORE the external Exotel HTTP call so a slow Exotel API doesn't hold
        // a DB connection or turn a successful save into a phantom failure.
        TelephonyProviderNumber saved = tx.create(body);
        // Auto-attach to the institute's configured flow. Non-fatal — the row
        // is created either way; outcome lives on flow_attach_* columns and
        // is reflected in the response.
        flowAttacher.attach(saved);
        TelephonyProviderNumber refreshed = numberRepo.findById(saved.getId()).orElse(saved);
        return ResponseEntity.ok(TelephonyProviderNumberDTO.from(refreshed));
    }

    @PutMapping("/{id}")
    @Auditable(
            entityType = "TELEPHONY_NUMBER",
            action = "UPDATE",
            entityIdExpr = "#id",
            descriptionExpr = "'updated calling number ' + (#body?.phoneNumber ?: #id)")
    public ResponseEntity<TelephonyProviderNumberDTO> update(
            @PathVariable String id,
            @RequestBody TelephonyProviderNumberDTO body) {
        TelephonyProviderNumber saved = tx.update(id, body);
        // Re-attach if anything routing-relevant changed — provider_resource_id
        // is the main case (admin pasted in the ExoPhone Sid after the row was
        // created). Cheap to over-attach: PUT-based, idempotent.
        if (body.getProviderResourceId() != null) {
            flowAttacher.attach(saved);
        }
        TelephonyProviderNumber refreshed = numberRepo.findById(saved.getId()).orElse(saved);
        return ResponseEntity.ok(TelephonyProviderNumberDTO.from(refreshed));
    }

    /** Re-run the attach for a number whose last attempt was PENDING / FAILED. */
    @PostMapping("/{id}/attach")
    @Auditable(
            entityType = "TELEPHONY_NUMBER",
            action = "ATTACH",
            entityIdExpr = "#id",
            descriptionExpr = "'re-attached calling number ' + (#result?.body?.phoneNumber ?: #id) + ' to its flow'")
    public ResponseEntity<TelephonyProviderNumberDTO> retryAttach(@PathVariable String id) {
        flowAttacher.retry(id);
        return numberRepo.findById(id)
                .map(n -> ResponseEntity.ok(TelephonyProviderNumberDTO.from(n)))
                .orElseThrow(() -> new VacademyException("Number not found"));
    }

    @DeleteMapping("/{id}")
    @Auditable(
            entityType = "TELEPHONY_NUMBER",
            action = "DELETE",
            entityIdExpr = "#id",
            descriptionExpr = "'removed a calling number'")
    public ResponseEntity<Void> delete(@PathVariable String id) {
        TelephonyProviderNumber existing = numberRepo.findById(id).orElse(null);
        if (existing != null) flowAttacher.detachQuietly(existing);
        tx.delete(id, existing == null ? null : existing.getInstituteId());
        return ResponseEntity.noContent().build();
    }
}
