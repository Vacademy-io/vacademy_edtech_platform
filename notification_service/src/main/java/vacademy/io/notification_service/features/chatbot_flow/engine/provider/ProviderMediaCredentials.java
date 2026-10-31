package vacademy.io.notification_service.features.chatbot_flow.engine.provider;

/**
 * What it takes to read a learner's attachment back from the provider: the API base URL and the
 * institute's bearer token. Never sent to the browser — the Inbox media endpoint uses it server-side.
 */
public record ProviderMediaCredentials(String apiUrl, String token) {}
