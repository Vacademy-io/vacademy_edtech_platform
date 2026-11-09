import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';

/**
 * URL state for the Social accounts & posts screen.
 *   view   — right-hand tab: the post calendar (default) or the New post composer.
 *   status — optional calendar filter (a SocialPostStatus, e.g. NEEDS_APPROVAL).
 *   month  — month shown in the calendar (yyyy-MM, local).
 * The OAuth return params (mkt_session, mkt_provider, mkt_error) are read straight from
 * window.location by use-oauth-return, not through this schema.
 */
export const SOCIAL_VIEWS = ['calendar', 'new'] as const;
export type SocialView = (typeof SOCIAL_VIEWS)[number];

const SocialPostsSearchSchema = z.object({
    view: z.enum(SOCIAL_VIEWS).optional().catch(undefined),
    status: z.string().optional().catch(undefined),
    month: z
        .string()
        .regex(/^\d{4}-\d{2}$/)
        .optional()
        .catch(undefined),
});

export type SocialPostsSearch = z.infer<typeof SocialPostsSearchSchema>;

export const Route = createFileRoute('/audience-manager/social-posts/')({
    component: () => null,
    validateSearch: SocialPostsSearchSchema,
});
