package vacademy.io.notification_service.features.chat.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;
import vacademy.io.notification_service.features.chat.dto.ChatReportResponse;
import vacademy.io.notification_service.features.chat.dto.CreateReportRequest;
import vacademy.io.notification_service.features.chat.entity.ChatConversation;
import vacademy.io.notification_service.features.chat.entity.ChatMessage;
import vacademy.io.notification_service.features.chat.entity.ChatMessageReport;
import vacademy.io.notification_service.features.chat.enums.ChatConversationType;
import vacademy.io.notification_service.features.chat.enums.ChatReportReason;
import vacademy.io.notification_service.features.chat.enums.ChatReportStatus;
import vacademy.io.notification_service.features.chat.repository.ChatConversationMemberRepository;
import vacademy.io.notification_service.features.chat.repository.ChatConversationRepository;
import vacademy.io.notification_service.features.chat.repository.ChatMessageReportRepository;
import vacademy.io.notification_service.features.chat.repository.ChatMessageRepository;
import vacademy.io.notification_service.features.chat.util.ChatTimeUtil;

import java.time.LocalDateTime;

@Service
@RequiredArgsConstructor
@Slf4j
public class ChatReportService {

    private final ChatMessageReportRepository reportRepository;
    private final ChatConversationRepository convRepository;
    private final ChatConversationMemberRepository memberRepository;
    private final ChatMessageRepository messageRepository;
    private final ChatMessageMapper messageMapper;

    @Transactional
    public ChatReportResponse createReport(String reporterId, String reporterRole, String reporterInstituteId,
                                           CreateReportRequest req) {
        if (req.getConversationId() == null) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "CONVERSATION_REQUIRED");
        }
        ChatConversation conv = convRepository.findById(req.getConversationId())
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "CONVERSATION_NOT_FOUND"));

        // Only participants can report (privacy): community is open to all institute members. An admin
        // of THIS institute also qualifies for group channels — they are shown every batch group whether
        // or not they ever joined one, so a member-only rule 403s the very people who work the queue.
        boolean isInstituteAdmin = "admin".equals(ChatPermissionService.normalizeRole(reporterRole))
                && reporterInstituteId != null && reporterInstituteId.equals(conv.getInstituteId())
                && !ChatConversationType.DIRECT.name().equals(conv.getType());
        if (!ChatConversationType.COMMUNITY.name().equals(conv.getType()) && !isInstituteAdmin
                && !memberRepository.existsByConversationIdAndUserIdAndIsActiveTrue(conv.getId(), reporterId)) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "NOT_A_MEMBER");
        }

        // A report must point at a message that actually lives in the conversation it claims.
        if (req.getMessageId() != null && messageRepository.findById(req.getMessageId())
                .filter(m -> conv.getId().equals(m.getConversationId())).isEmpty()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "MESSAGE_NOT_IN_CONVERSATION");
        }

        // Idempotent per (message, reporter): the partial unique index uq_chat_report_once would otherwise
        // turn a duplicate report into an unhandled 500. Mirror the guard in createSystemFlag.
        if (req.getMessageId() != null
                && reportRepository.existsByMessageIdAndReporterId(req.getMessageId(), reporterId)) {
            return reportRepository.findByMessageIdAndReporterId(req.getMessageId(), reporterId)
                    .map(this::toResponse)
                    .orElseThrow(() -> new ResponseStatusException(HttpStatus.CONFLICT, "REPORT_CREATE_RACE"));
        }

        String reason = parseReason(req.getReason());
        ChatMessageReport report = ChatMessageReport.builder()
                .instituteId(conv.getInstituteId())
                .conversationId(conv.getId())
                .messageId(req.getMessageId())
                .reporterId(reporterId)
                .reason(reason)
                .details(req.getDetails())
                .status(ChatReportStatus.OPEN.name())
                .createdAt(LocalDateTime.now())
                .build();
        return toResponse(reportRepository.save(report));
    }

    /** Auto-moderation flag raised by the system; idempotent per message. */
    @Transactional
    public void createSystemFlag(ChatConversation conv, ChatMessage message, String details) {
        if (message.getId() != null
                && reportRepository.existsByMessageIdAndReporterId(message.getId(), ChatMessageReport.SYSTEM_REPORTER)) {
            return;
        }
        ChatMessageReport report = ChatMessageReport.builder()
                .instituteId(conv.getInstituteId())
                .conversationId(conv.getId())
                .messageId(message.getId())
                .reporterId(ChatMessageReport.SYSTEM_REPORTER)
                .reason(ChatReportReason.AUTO_MODERATION.name())
                .details(details)
                .status(ChatReportStatus.OPEN.name())
                .createdAt(LocalDateTime.now())
                .build();
        reportRepository.save(report);
    }

    @Transactional(readOnly = true)
    public Page<ChatReportResponse> listReports(String instituteId, String status, Pageable pageable) {
        Page<ChatMessageReport> page = (status == null || status.isBlank())
                ? reportRepository.findByInstituteIdOrderByCreatedAtDesc(instituteId, pageable)
                : reportRepository.findByInstituteIdAndStatusOrderByCreatedAtDesc(instituteId, status.toUpperCase(), pageable);
        return page.map(this::toResponse);
    }

    @Transactional
    public ChatReportResponse reviewReport(String reportId, String reviewerId, String instituteId, String status) {
        ChatMessageReport report = reportRepository.findById(reportId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "REPORT_NOT_FOUND"));
        // Tenant ownership: an admin may only review reports belonging to their own institute.
        if (instituteId == null || !instituteId.equals(report.getInstituteId())) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "REPORT_NOT_FOUND");
        }
        report.setStatus(parseStatus(status));
        report.setReviewedBy(reviewerId);
        report.setReviewedAt(LocalDateTime.now());
        return toResponse(reportRepository.save(report));
    }

    private ChatReportResponse toResponse(ChatMessageReport r) {
        ChatReportResponse.ChatReportResponseBuilder b = ChatReportResponse.builder()
                .id(r.getId())
                .instituteId(r.getInstituteId())
                .conversationId(r.getConversationId())
                .conversationType(convRepository.findById(r.getConversationId())
                        .map(ChatConversation::getType).orElse(null))
                .messageId(r.getMessageId())
                .reporterId(r.getReporterId())
                .reason(r.getReason())
                .details(r.getDetails())
                .status(r.getStatus())
                .reviewedBy(r.getReviewedBy())
                .reviewedAt(ChatTimeUtil.toInstant(r.getReviewedAt()))
                .createdAt(ChatTimeUtil.toInstant(r.getCreatedAt()));
        // Only expose the single reported message — never arbitrary conversation history.
        if (r.getMessageId() != null) {
            messageRepository.findById(r.getMessageId()).ifPresent(m -> b.reportedMessage(messageMapper.toResponse(m)));
        }
        return b.build();
    }

    private String parseReason(String reason) {
        try {
            return ChatReportReason.valueOf(reason == null ? "OTHER" : reason.toUpperCase()).name();
        } catch (IllegalArgumentException e) {
            return ChatReportReason.OTHER.name();
        }
    }

    private String parseStatus(String status) {
        try {
            return ChatReportStatus.valueOf(status == null ? "REVIEWING" : status.toUpperCase()).name();
        } catch (IllegalArgumentException e) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "INVALID_STATUS");
        }
    }
}
