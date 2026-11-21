package vacademy.io.notification_service.features.email_sending_controls.service;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.notification_service.features.email_sending_controls.entity.DeferredEmail;
import vacademy.io.notification_service.features.email_sending_controls.repository.DeferredEmailRepository;

import java.time.LocalDateTime;
import java.util.List;
import java.util.UUID;

/** Persists sends that exceeded a sender's daily cap so nothing is silently dropped. */
@Service
@RequiredArgsConstructor
@Slf4j
public class DeferredEmailService {

    private final DeferredEmailRepository repository;
    private final ObjectMapper objectMapper;

    @Transactional
    public DeferredEmail defer(String senderKey, LocalDateTime sendAfter, String instituteId, String emailType,
                               String to, String subject, String body, String service,
                               String customFromEmail, String customFromName, String correlationId, String userId,
                               List<String> cc, String ccMode) {
        DeferredEmail d = new DeferredEmail();
        d.setId(UUID.randomUUID().toString());
        d.setSenderKey(senderKey);
        d.setSendAfter(sendAfter);
        d.setInstituteId(instituteId);
        d.setEmailType(emailType);
        d.setToEmail(to);
        d.setSubject(subject);
        d.setBody(body);
        d.setService(service);
        d.setCustomFromEmail(customFromEmail);
        d.setCustomFromName(customFromName);
        d.setCorrelationId(correlationId);
        d.setUserId(userId);
        d.setCcMode(ccMode);
        if (cc != null && !cc.isEmpty()) {
            try { d.setCc(objectMapper.writeValueAsString(cc)); } catch (Exception ignored) { }
        }
        DeferredEmail saved = repository.save(d);
        log.info("Deferred email to {} for sender {} until {}", to, senderKey, sendAfter);
        return saved;
    }

    public List<String> ccOf(DeferredEmail d) {
        if (d.getCc() == null || d.getCc().isBlank()) return List.of();
        try { return objectMapper.readValue(d.getCc(), new TypeReference<List<String>>() {}); }
        catch (Exception e) { return List.of(); }
    }

    public long pendingForSender(String senderKey) { return repository.countBySenderKeyAndStatus(senderKey, "PENDING"); }

    /** @return how many queued emails were called off. */
    @Transactional
    public int cancelPending(String senderKey, String reason) {
        int n = repository.cancelPending(senderKey, reason == null ? "Cancelled by an admin" : reason);
        log.info("Cancelled {} queued email(s) for sender {}", n, senderKey);
        return n;
    }

    public long pendingForInstitute(String instituteId) { return repository.countByInstituteIdAndStatus(instituteId, "PENDING"); }
}
