package vacademy.io.admin_core_service.features.telephony.core;

import lombok.RequiredArgsConstructor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import vacademy.io.admin_core_service.features.telephony.core.dto.AiCallRequestDTO;
import vacademy.io.admin_core_service.features.telephony.core.dto.AiCallResponseDTO;
import vacademy.io.admin_core_service.features.telephony.enums.CallTrigger;
import vacademy.io.admin_core_service.features.telephony.enums.ProviderType;
import vacademy.io.admin_core_service.features.telephony.persistence.entity.AiAgent;
import vacademy.io.admin_core_service.features.telephony.persistence.entity.AiAgentTestCall;
import vacademy.io.admin_core_service.features.telephony.persistence.repository.AiAgentTestCallRepository;
import vacademy.io.admin_core_service.features.telephony.queue.AiCallQueueDrainJob;
import vacademy.io.admin_core_service.features.telephony.queue.AiCallQueueService;
import vacademy.io.admin_core_service.features.telephony.queue.dto.AiCallQueueDTOs.EnqueueResult;
import vacademy.io.admin_core_service.features.telephony.spi.dto.CallSubjectType;
import vacademy.io.common.exceptions.VacademyException;

import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

/**
 * Test calls from the AI agent editor: the admin types a name and a number and the agent
 * calls it, without adding the number to a lead list first. A real, billed call through
 * the same queue as a manual lead call; the subject is AGENT_TEST, so no lead is created,
 * assigned or re-statused and no workflow resumes.
 */
@Service
@RequiredArgsConstructor
public class AiAgentTestCallService {

    private static final Logger log = LoggerFactory.getLogger(AiAgentTestCallService.class);

    private final AiAgentService agentService;
    private final AiAgentTestCallRepository repository;
    private final AiCallQueueService queueService;
    private final AiCallQueueDrainJob drainJob;

    public record TestCallInput(String phoneNumber, String name, String preferredNumberId) {}

    public AiCallResponseDTO place(String instituteId, String agentId, TestCallInput in, String actorUserId) {
        AiAgent agent = agentService.find(agentId, instituteId)
                .orElseThrow(() -> new VacademyException("Save the agent before testing it."));
        if (!Boolean.TRUE.equals(agent.getEnabled())) {
            throw new VacademyException("This agent is turned off. Turn it on to test it.");
        }
        String phone = PhoneNumbers.toE164(in == null ? null : in.phoneNumber());
        if (phone == null) throw new VacademyException("Enter a valid phone number, e.g. +91 98765 43210.");
        String name = in.name() == null ? null : in.name().trim();
        if (name != null && name.isEmpty()) name = null;
        if (name != null && name.length() > 120) name = name.substring(0, 120);

        AiAgentTestCall row = repository.save(AiAgentTestCall.builder()
                .id(UUID.randomUUID().toString())
                .instituteId(instituteId)
                .agentId(agent.getId())
                .phoneNumber(phone)
                .contactName(name)
                .createdBy(actorUserId)
                .build());

        AiCallRequestDTO req = new AiCallRequestDTO();
        req.setInstituteId(instituteId);
        req.setProvider(ProviderType.VACADEMY_AI);
        req.setPhoneNumber(phone);
        req.setUserId(testUserId(instituteId, phone));
        req.setCampaignId(agent.getId());
        req.setSubjectType(CallSubjectType.AGENT_TEST.name());
        req.setSubjectId(row.getId());
        req.setCustomerName(name);
        req.setPreferredNumberId(in.preferredNumberId() == null || in.preferredNumberId().isBlank()
                ? null : in.preferredNumberId());
        req.setMetadata(Map.of("agentTestCallId", row.getId()));

        EnqueueResult queued = queueService.enqueue(req, CallTrigger.MANUAL,
                AiCallQueueService.SOURCE_MANUAL, "agent-test:" + row.getId(), actorUserId);
        if (queued.getQueueItemId() != null) {
            Optional<AiCallResponseDTO> dialled = drainJob.dispatchNowIfLineFree(queued.getQueueItemId());
            if (dialled.isPresent()) {
                if (dialled.get().getCallLogId() != null) {
                    row.setCallLogId(dialled.get().getCallLogId());
                    repository.save(row);
                }
                log.info("ai-agent test call: agent={} institute={} callLog={}",
                        agent.getId(), instituteId, row.getCallLogId());
                return dialled.get();
            }
        }
        return AiCallResponseDTO.builder()
                .status("QUEUED")
                .dispatched(false)
                .providerMessage(queued.getMessage())
                .queueItemId(queued.getQueueItemId())
                .queuePosition(queued.getAheadInLane())
                .queueEtaMinutes(queued.getEtaMinutes())
                .build();
    }

    /**
     * A stable pseudo user id per (institute, number), like the public API contact id: the
     * duplicate window and the queue keys on the user. It never exists in auth_service.
     */
    static String testUserId(String instituteId, String phone) {
        return UUID.nameUUIDFromBytes(("ai-agent-test:" + instituteId + ":" + phone)
                .getBytes(StandardCharsets.UTF_8)).toString();
    }
}
