import { createFileRoute } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { ArrowSquareOut, BookOpen, Phone, Robot } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { AiCallingApiCard } from '@/routes/settings/-components/AiCallingApiCard';
import {
    AI_CALLING_API_BASE,
    AI_CALLING_DOCS_URL,
} from '@/routes/settings/-services/ai-calling-api';

/**
 * Telleo API access: where an API account makes its keys and finds the docs. It is the same
 * "AI calling API" card as Settings → AI calling (keys, agent ids, webhook, an example call), on a
 * page of its own, because there it sits under a sub-tab an API account would never find. API
 * accounts land here after login (TelleoDisplaySettings.API_POST_LOGIN_ROUTE).
 */
export const Route = createFileRoute('/telleo/api')({
    component: TelleoApiPage,
});

function TelleoApiPage() {
    const { t } = useTranslation('telleoSetup');
    // Full navigations: these pages sit inside the dashboard layout, this one does not.
    const go = (path: string) => window.location.assign(path);
    return (
        <main className="min-h-screen-safe flex w-full min-w-0 flex-col items-center bg-neutral-50 p-4">
            <div className="flex w-full max-w-4xl flex-col gap-4">
                <header className="flex flex-col gap-3 rounded-lg border border-neutral-200 bg-white p-5 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex min-w-0 flex-col gap-1">
                        <h1 className="text-h3 font-semibold text-neutral-800">
                            {t('api.title', 'API access')}
                        </h1>
                        <p className="text-body text-neutral-500">
                            {t(
                                'api.subtitle',
                                'Create a key, then call {{base}} from your own software.',
                                { base: AI_CALLING_API_BASE }
                            )}
                        </p>
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-2">
                        <MyButton
                            type="button"
                            buttonType="primary"
                            scale="medium"
                            onClick={() =>
                                window.open(AI_CALLING_DOCS_URL, '_blank', 'noopener,noreferrer')
                            }
                        >
                            <BookOpen size={16} />
                            {t('api.docs', 'API documentation')}
                            <ArrowSquareOut size={14} />
                        </MyButton>
                        <MyButton
                            type="button"
                            buttonType="secondary"
                            scale="medium"
                            onClick={() => go('/calling/ai-agents')}
                        >
                            <Robot size={16} />
                            {t('api.agents', 'AI agents')}
                        </MyButton>
                        <MyButton
                            type="button"
                            buttonType="secondary"
                            scale="medium"
                            onClick={() => go('/audience-manager/call-log')}
                        >
                            <Phone size={16} />
                            {t('api.callLog', 'Call log')}
                        </MyButton>
                    </div>
                </header>
                <AiCallingApiCard />
            </div>
        </main>
    );
}
