import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useRouterState } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { ChatCircleText, Sparkle } from '@phosphor-icons/react';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { ASSISTANT_CAPABILITIES } from '@/constants/urls';
import { useAssistDock } from '@/components/assist-dock/store';
import { cn } from '@/lib/utils';
import type { AssistantCapabilities } from './types';
import { useInstituteChatbotName } from './useInstituteChatbotName';
import { questionKey, questionsFor, topicForPath } from './page-ask';

/**
 * "Ask" next to the page heading on pages where people look for answers in long
 * lists (leads, learners, fees, assessments). It offers questions about that
 * page, answered by the tools this user has; the chat also receives the route.
 * Shown only where the floating assistant button is.
 */
export function PageAskButton({ compact = false }: { compact?: boolean }) {
    const { t } = useTranslation('dashboardIndex');
    const chatbotName = useInstituteChatbotName();
    const pathname = useRouterState({ select: (s) => s.location.pathname });
    const enabled = useAssistDock((s) => s.assistantFabEnabled);
    const askAssistant = useAssistDock((s) => s.askAssistant);
    const setPanel = useAssistDock((s) => s.setPanel);
    const topic = topicForPath(pathname);

    // The same query (key and freshness) as the floating button and the panel.
    const { data: capabilities } = useQuery<AssistantCapabilities>({
        queryKey: ['assistant-capabilities'],
        queryFn: async () => (await authenticatedAxiosInstance.get(ASSISTANT_CAPABILITIES)).data,
        enabled: enabled && topic !== null,
        staleTime: 5 * 60 * 1000,
        refetchOnWindowFocus: false,
    });

    const questions = useMemo(
        () => (topic ? questionsFor(topic, capabilities) : []),
        [topic, capabilities]
    );

    if (!enabled || !topic || questions.length === 0) return null;

    return (
        <DropdownMenu>
            <DropdownMenuTrigger
                aria-label={t('assistant.pageAsk.buttonLabel', { chatbotName })}
                className={cn(
                    'flex shrink-0 items-center gap-1 rounded-full border border-primary-200 bg-primary-50 font-medium text-primary-600 outline-none transition-colors hover:bg-primary-100 focus-visible:ring-2 focus-visible:ring-primary-300 motion-reduce:transition-none',
                    compact ? 'px-2 py-0.5 text-xs' : 'px-2.5 py-1 text-caption'
                )}
            >
                <Sparkle size={compact ? 12 : 14} weight="fill" aria-hidden="true" />
                <span className="hidden sm:inline">{t('assistant.pageAsk.button')}</span>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-72">
                <DropdownMenuLabel className="text-caption font-normal text-neutral-500">
                    {t('assistant.pageAsk.menuTitle', { chatbotName })}
                </DropdownMenuLabel>
                {questions.map((q) => {
                    const text = t(questionKey(q.key));
                    return (
                        <DropdownMenuItem
                            key={q.key}
                            onSelect={() => askAssistant(text)}
                            className="cursor-pointer items-start gap-2 whitespace-normal py-2 text-body"
                        >
                            <Sparkle
                                size={14}
                                className="mt-0.5 shrink-0 text-primary-500"
                                aria-hidden="true"
                            />
                            <span>{text}</span>
                        </DropdownMenuItem>
                    );
                })}
                <DropdownMenuSeparator />
                <DropdownMenuItem
                    onSelect={() => setPanel('assistant')}
                    className="cursor-pointer gap-2 text-body text-neutral-600"
                >
                    <ChatCircleText size={14} className="shrink-0" aria-hidden="true" />
                    {t('assistant.pageAsk.somethingElse')}
                </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
