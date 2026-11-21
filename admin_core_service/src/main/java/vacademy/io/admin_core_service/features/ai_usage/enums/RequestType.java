package vacademy.io.admin_core_service.features.ai_usage.enums;

/**
 * Enum for request types.
 * Matches the Python RequestType enum.
 */
public enum RequestType {
    // Original types
    OUTLINE("outline"),
    IMAGE("image"),
    CONTENT("content"),
    VIDEO("video"),

    // New types for comprehensive logging
    TTS("tts"), // Text-to-Speech
    EMBEDDING("embedding"), // Embedding generation
    EVALUATION("evaluation"), // Answer evaluation
    PRESENTATION("presentation"), // Presentation generation
    CONVERSATION("conversation"), // Chat/conversation
    LECTURE("lecture"), // Lecture generation
    COURSE_CONTENT("course_content"), // Course content generation
    PDF_QUESTIONS("pdf_questions"), // PDF to questions processing
    AGENT("agent"), // AI Agent interactions
    ANALYTICS("analytics"), // Student analytics
    COPILOT("copilot"), // Instructor copilot
    CALL_INTELLIGENCE("call_intelligence"), // CRM call recording transcription + analysis
    CHATBOT("chatbot"); // Automations chatbot flow AI_RESPONSE turn (WhatsApp)

    private final String value;

    RequestType(String value) {
        this.value = value;
    }

    public String getValue() {
        return value;
    }

    public static RequestType fromValue(String value) {
        for (RequestType type : values()) {
            if (type.value.equalsIgnoreCase(value)) {
                return type;
            }
        }
        throw new IllegalArgumentException("Unknown request type: " + value);
    }
}
