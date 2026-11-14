import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';
import { SelfSignupFlow } from './-components/SelfSignupFlow';

// Google adds its own params on the way back: the flow reads and clears those itself.
const searchSchema = z.object({
    product: z.string().optional(),
    plan: z.string().optional(),
    // "Buy <plan>" on the website: sign up, then that plan's checkout. Not part of the sign-up
    // context (plan= alone stays a trial, as older links and trial buttons send it).
    buy: z.string().optional(),
    source: z.string().optional(),
    utm_source: z.string().optional(),
    campaign: z.string().optional(),
    utm_campaign: z.string().optional(),
});

export const Route = createFileRoute('/signup/start')({
    validateSearch: searchSchema,
    component: SignupStartPage,
});

function SignupStartPage() {
    const search = Route.useSearch();
    return (
        <SelfSignupFlow
            context={{
                product: search.product || 'evalezy',
                plan: search.plan,
                source: search.source || search.utm_source,
                campaign: search.campaign || search.utm_campaign,
            }}
            buy={search.buy}
        />
    );
}
