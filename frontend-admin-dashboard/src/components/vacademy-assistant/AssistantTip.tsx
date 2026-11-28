import { useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Sparkle, X } from '@phosphor-icons/react';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { ASSISTANT_CAPABILITIES } from '@/constants/urls';
import { useAssistDock } from '@/components/assist-dock/store';
import type { AssistantCapabilities } from './types';
import { isAskTopic, questionKey, questionsFor, recordTipShown, turnTipsOff } from './page-ask';

/** How long a tip stays up when the user does nothing with it. */
export const TIP_VISIBLE_MS = 30 * 1000;

/**
 * A one-line suggestion above the floating assistant button after a manual task
 * (see nudgeAssistant): the question that would have answered it, ready to ask.
 * Rendered by the floating button, so it shows only where that button does.
 */
export function AssistantTip() {
    const { t } = useTranslation('dashboardIndex');
    const tipTopic = useAssistDock((s) => s.tipTopic);
    const clearTip = useAssistDock((s) => s.clearTip);
    const askAssistant = useAssistDock((s) => s.askAssistant);
    const topic = isAskTopic(tipTopic) ? tipTopic : null;

    const { data: capabilities, isSuccess } = useQuery<AssistantCapabilities>({
        queryKey: ['assistant-capabilities'],
        queryFn: async () => (await authenticatedAxiosInstance.get(ASSISTANT_CAPABILITIES)).data,
        enabled: topic !== null,
        staleTime: 5 * 60 * 1000,
        refetchOnWindowFocus: false,
    });
    const question = useMemo(
        () => (topic ? questionsFor(topic, capabilities, 1)[0] : undefined),
        [topic, capabilities]
    );

    // Count the tip once it is actually on screen; drop one with nothing to suggest.
    const recorded = useRef<string | null>(null);
    useEffect(() => {
        if (!topic) {
            recorded.current = null;
            if (tipTopic) clearTip();
            return undefined;
        }
        if (!question) {
            if (isSuccess) clearTip();
            return undefined;
        }
        if (recorded.current !== topic) {
            recorded.current = topic;
            recordTipShown(topic);
        }
        const timer = window.setTimeout(clearTip, TIP_VISIBLE_MS);
        return () => window.clearTimeout(timer);
    }, [topic, question, isSuccess, tipTopic, clearTip]);

    if (!topic || !question) return null;
    const text = t(questionKey(question.key));

    return (
        <div
            role="status"
            className="pointer-events-auto absolute bottom-full end-0 mb-3 w-72 rounded-lg border border-neutral-200 bg-white p-3 shadow-lg"
        >
            <div className="flex items-start gap-2">
                <Sparkle
                    size={16}
                    weight="fill"
                    className="mt-0.5 shrink-0 text-primary-500"
                    aria-hidden="true"
                />
                <div className="min-w-0 flex-1">
                    <p className="text-caption text-neutral-500">
                        {t('assistant.pageAsk.tip.lead')}
                    </p>
                    <p className="mt-0.5 text-body font-medium text-neutral-800">“{text}”</p>
                </div>
                <button
                    type="button"
                    aria-label={t('assistant.pageAsk.tip.dismiss')}
                    onClick={clearTip}
                    className="flex size-6 shrink-0 items-center justify-center rounded-md text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300 motion-reduce:transition-none"
                >
                    <X size={12} aria-hidden="true" />
                </button>
            </div>
            <div className="mt-2 flex items-center justify-between gap-2 ps-6">
                <button
                    type="button"
                    onClick={() => {
                        turnTipsOff();
                        clearTip();
                    }}
                    className="rounded-sm text-caption text-neutral-500 hover:text-neutral-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300"
                >
                    {t('assistant.pageAsk.tip.stop')}
                </button>
                <button
                    type="button"
                    onClick={() => {
                        clearTip();
                        askAssistant(text);
                    }}
                    className="rounded-md bg-primary-500 px-3 py-1 text-caption font-medium text-white transition-colors hover:bg-primary-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300 focus-visible:ring-offset-1 motion-reduce:transition-none"
                >
                    {t('assistant.pageAsk.tip.ask')}
                </button>
            </div>
        </div>
    );
}
