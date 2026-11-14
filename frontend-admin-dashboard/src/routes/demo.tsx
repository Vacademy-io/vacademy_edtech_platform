import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';
import { DemoSignup } from './signup/-components/DemoSignup';

const searchSchema = z.object({
    product: z.string().optional(),
    source: z.string().optional(),
    utm_source: z.string().optional(),
    campaign: z.string().optional(),
    utm_campaign: z.string().optional(),
});

/** Evalezy one-screen demo (evalezy.vacademy.io/demo): name, email, phone, then the app. */
export const Route = createFileRoute('/demo')({
    validateSearch: searchSchema,
    component: DemoPage,
});

function DemoPage() {
    const search = Route.useSearch();
    return (
        <DemoSignup
            context={{
                product: search.product || 'evalezy',
                source: search.source || search.utm_source || 'demo',
                campaign: search.campaign || search.utm_campaign,
            }}
        />
    );
}
