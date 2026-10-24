package vacademy.io.admin_core_service.features.audience.controller;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import vacademy.io.admin_core_service.features.audience.dto.WhatsAppFlowLeadRequestDTO;
import vacademy.io.admin_core_service.features.audience.dto.WhatsAppFlowLeadResultDTO;
import vacademy.io.admin_core_service.features.audience.service.WhatsAppFlowLeadService;

/**
 * Called by notification_service's chatbot engine (HMAC-signed internal calls) to turn a
 * WhatsApp chatbot conversation into a CRM lead. See {@link WhatsAppFlowLeadService}.
 */
@RestController
@RequestMapping("/admin-core-service/internal/whatsapp-flow-lead")
public class WhatsAppFlowLeadInternalController {

    @Autowired
    private WhatsAppFlowLeadService whatsAppFlowLeadService;

    /** CRM_LEAD_CHECK node: existing lead (recorded as a repeat contact) or a new lead created now. */
    @PostMapping("/check")
    public ResponseEntity<WhatsAppFlowLeadResultDTO> check(@RequestBody WhatsAppFlowLeadRequestDTO request) {
        return ResponseEntity.ok(whatsAppFlowLeadService.checkOrCreate(request));
    }

    /** ASK_FIELD (one answer) and SAVE_TO_CRM (all answers + completion). */
    @PostMapping("/save")
    public ResponseEntity<WhatsAppFlowLeadResultDTO> save(@RequestBody WhatsAppFlowLeadRequestDTO request) {
        return ResponseEntity.ok(whatsAppFlowLeadService.save(request));
    }
}
