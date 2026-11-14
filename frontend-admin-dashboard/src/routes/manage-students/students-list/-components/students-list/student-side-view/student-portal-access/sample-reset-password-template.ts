/**
 * Sample "Reset Your Password" EMAIL template — the same "Generate sample" affordance the
 * guardian-credential picker offers (routes/settings/-components/sample-guardian-credentials-template.ts),
 * for the LEARNER_PASSWORD_RESET event.
 *
 * The point of this template is what it does NOT contain: no password. It carries
 * {{reset_password_link}}, a link that opens the learner portal login with the learner's username
 * already filled in and hands off to the update-profile screen, where they choose their own
 * password. An institute that may not put plaintext credentials in an inbox uses this instead of
 * the credentials template.
 *
 * Plain HTML (no MJML) so the admin can keep editing it in the normal template editor afterwards.
 */

import type { TFunction } from 'i18next';

export interface SampleResetPasswordTemplate {
    name: string;
    subject: string;
    content: string;
    variables: string[];
}

export const RESET_PASSWORD_VARIABLES = [
    '{{user_full_name}}',
    '{{user_name}}',
    '{{reset_password_link}}',
    '{{institute_name}}',
    '{{theme_color}}',
    '{{portal_url}}',
];

// The template markup carries the app's own {{placeholder}} tokens (substituted later, per
// learner, when the email is actually sent — not by i18next). Each is translated with an
// identity interpolation value so the token text survives translation unchanged, exactly like
// send-email-dialog.tsx / send-message-dialog.tsx do for their {{name}} tokens.
export function buildSampleResetPasswordTemplate(t: TFunction): SampleResetPasswordTemplate {
    return {
        name: t('name'),
        subject: t('subject', {
            institute_name: '{{institute_name}}',
        }),
        variables: RESET_PASSWORD_VARIABLES,
        content: t('content', {
            user_full_name: '{{user_full_name}}',
            user_name: '{{user_name}}',
            reset_password_link: '{{reset_password_link}}',
            institute_name: '{{institute_name}}',
            theme_color: '{{theme_color}}',
        }),
    };
}
