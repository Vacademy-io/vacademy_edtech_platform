/**
 * Membership merge tags the notification service fills per recipient when an email is sent
 * (it asks admin-core for the member's practice, plan end date and subscriptions-page link).
 * The browser cannot know these, so send dialogs must leave them as {{token}} in the outgoing
 * subject/body instead of mapping them or replacing them with an empty string — an empty
 * replacement is how the reminder's "click here" link went out as href="".
 */
export const SERVER_RESOLVED_EMAIL_VARIABLES = [
    'learner_name',
    'practice_name',
    'expiry_date',
    'expiry_date_long',
    'subscription_link',
] as const;

export function isServerResolvedEmailVariable(key: string): boolean {
    return (SERVER_RESOLVED_EMAIL_VARIABLES as readonly string[]).includes(key);
}
