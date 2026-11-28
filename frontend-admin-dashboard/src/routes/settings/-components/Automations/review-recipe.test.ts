import { describe, expect, it } from 'vitest';
import { AUTOMATION_FEATURES } from './automation-recipes';

/**
 * The "email the team when a visitor sends a review" recipe: on the admin
 * section, bound to REVIEW_SUBMITTED, and only reading keys the backend puts on
 * that trigger's context (ReviewSubmittedWorkflowNotifier) — a key that is not
 * there would render empty in every email.
 */

describe('REVIEW_SUBMITTED recipe', () => {
    it('exists in the admin section and only reads keys the backend emits', () => {
        const feature = AUTOMATION_FEATURES.find((f) => f.id === 'admin_reviews')!;
        expect(feature.section).toBe('admin');
        const recipe = feature.recipes[0]!;
        expect(recipe.triggerEvent).toBe('REVIEW_SUBMITTED');
        const { nodes } = recipe.customGenerator!({ templateName: 'Review alert' } as any);
        const send = nodes.find((n: any) => n.data?.nodeType === 'SEND_EMAIL' || n.type === 'SEND_EMAIL' || JSON.stringify(n).includes('SEND_EMAIL')) as any;
        const vars = JSON.stringify(send);
        // Keys put on the context by ReviewSubmittedWorkflowNotifier (+ engine/query keys).
        const allowed = new Set([
            'reviewId', 'rating', 'ratingStars', 'reviewerName', 'reviewText', 'courseName', 'city', 'designation',
            'siteTag', 'pageRoute', 'reviewStatus', 'submittedAt', 'answers', 'answersText',
            'instituteName', 'adminContacts', 'item',
        ]);
        const used = [...vars.matchAll(/#ctx\['([^']+)'\]/g)].map((m) => m[1]);
        expect(used.length).toBeGreaterThan(5);
        used.forEach((k) => expect(allowed.has(k!)).toBe(true));
    });
});
