package vacademy.io.admin_core_service.features.telephony.demo;

import jakarta.persistence.*;
import lombok.*;

import java.sql.Timestamp;

/**
 * One "Try the AI call" request from the public demo page (V679). The voice-bot
 * call-context binds it to the visitor's inbound call by the caller's number.
 */
@Entity
@Table(name = "ai_demo_call_request")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class AiDemoCallRequest {

    public static final String PENDING = "PENDING";
    public static final String CONNECTED = "CONNECTED";
    public static final String SUPERSEDED = "SUPERSEDED";

    @Id
    @Column(name = "id", length = 36, nullable = false, updatable = false)
    private String id;

    @Column(name = "institute_id", nullable = false)
    private String instituteId;

    /** Last ten digits: the inbound match key. */
    @Column(name = "phone", nullable = false, length = 10)
    private String phone;

    @Column(name = "phone_raw", length = 32)
    private String phoneRaw;

    @Column(name = "visitor_name", length = 120)
    private String visitorName;

    @Column(name = "organisation", nullable = false, length = 160)
    private String organisation;

    /** A voice-bot language key (english, hinglish, tamil...). */
    @Column(name = "language", nullable = false, length = 30)
    private String language;

    @Column(name = "status", nullable = false, length = 20)
    private String status;

    @Column(name = "call_log_id")
    private String callLogId;

    @Column(name = "source", length = 160)
    private String source;

    @Column(name = "client_ip", length = 64)
    private String clientIp;

    @Column(name = "created_at", nullable = false)
    private Timestamp createdAt;

    @Column(name = "expires_at", nullable = false)
    private Timestamp expiresAt;

    @Column(name = "connected_at")
    private Timestamp connectedAt;
}
