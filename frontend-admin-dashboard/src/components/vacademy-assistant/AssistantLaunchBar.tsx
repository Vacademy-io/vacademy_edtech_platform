import { useId, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ArrowUp, ChatCircleDots, Sparkle } from '@phosphor-icons/react';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { MyButton } from '@/components/design-system/button';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { ASSISTANT_CAPABILITIES } from '@/constants/urls';
import { useAssistDock } from '@/components/assist-dock/store';
import type { AssistantCapabilities } from './types';
import { useInstituteChatbotName } from './useInstituteChatbotName';
import { useEntitlement } from '@/lib/capabilities/use-entitlement';
import { pickStarters, starterPromptKey } from './launch-bar-starters';

/** Dashboard composer. Sends through the same dock and session as the global assistant. */
export function AssistantLaunchBar() {
    const { t } = useTranslation('dashboardIndex');
    const chatbotName = useInstituteChatbotName();
    const entitlement = useEntitlement();
    const [question, setQuestion] = useState('');
    const inputRef = useRef<HTMLTextAreaElement>(null);
    const id = useId();
    const askAssistant = useAssistDock((s) => s.askAssistant);
    const setPanel = useAssistDock((s) => s.setPanel);

    const {
        data: capabilities,
        isPending,
        isError,
        isFetching,
        refetch,
    } = useQuery<AssistantCapabilities>({
        queryKey: ['assistant-capabilities'],
        queryFn: async () => (await authenticatedAxiosInstance.get(ASSISTANT_CAPABILITIES)).data,
        staleTime: 5 * 60 * 1000,
    });

    if (isPending) {
        return (
            <div
                className="mt-5 space-y-4 rounded-xl border border-neutral-200 bg-white p-5 sm:p-6"
                role="status"
                aria-label={t('assistant.loading')}
            >
                <span className="sr-only">{t('assistant.loading')}</span>
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-7 w-3/4" />
                <Skeleton className="h-32 w-full rounded-xl" />
                <div className="flex gap-2" aria-hidden="true">
                    <Skeleton className="h-9 w-28" />
                    <Skeleton className="h-9 w-28" />
                </div>
            </div>
        );
    }

    if (isError && !capabilities) {
        return (
            <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-neutral-200 bg-white p-4">
                <p role="status" className="text-sm text-neutral-600">
                    {t('assistant.unavailable')}
                </p>
                <MyButton
                    buttonType="secondary"
                    scale="medium"
                    disable={isFetching}
                    onClick={() => void refetch()}
                >
                    {t('assistant.retry')}
                </MyButton>
            </div>
        );
    }

    if (!capabilities?.groups?.length) return null;

    // Plan filter (MANAGED only: group + the chip's own features) before the
    // four-slot cut, so the slots are backfilled with chips the institute can use.
    const suggestions = pickStarters(capabilities, entitlement);

    const submit = () => {
        const text = question.trim();
        if (!text) return;
        askAssistant(text);
        setQuestion('');
    };

    return (
        <section
            aria-labelledby={`${id}-heading`}
            className="mt-5 rounded-xl border border-primary-100 bg-primary-50/40 p-4 sm:p-5"
        >
            <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2 text-xs font-semibold text-neutral-700">
                    <span
                        className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary-100"
                        aria-hidden="true"
                    >
                        <Sparkle size={16} weight="fill" />
                    </span>
                    <span className="min-w-0 break-words">{chatbotName}</span>
                </div>
                <button
                    type="button"
                    onClick={() => setPanel('assistant')}
                    className="flex min-h-9 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-neutral-600 transition-colors hover:bg-white hover:text-neutral-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-500"
                >
                    <ChatCircleDots size={16} aria-hidden="true" />
                    {t('assistant.openChat')}
                </button>
            </div>
            <h2
                id={`${id}-heading`}
                className="text-xl font-semibold tracking-tight text-neutral-900 sm:text-2xl"
            >
                {t('assistant.heading')}
            </h2>
            <p id={`${id}-description`} className="mt-1 text-sm text-neutral-600">
                {t('assistant.description')}
            </p>

            <form
                onSubmit={(event) => {
                    event.preventDefault();
                    submit();
                }}
                className="mt-4 rounded-xl border border-neutral-300 bg-white shadow-sm transition-colors focus-within:border-neutral-500 focus-within:ring-2 focus-within:ring-primary-200"
            >
                <label htmlFor={`${id}-question`} className="sr-only">
                    {t('assistant.inputLabel', { chatbotName })}
                </label>
                <Textarea
                    ref={inputRef}
                    id={`${id}-question`}
                    value={question}
                    onChange={(event) => setQuestion(event.target.value)}
                    onKeyDown={(event) => {
                        if (
                            event.key === 'Enter' &&
                            !event.shiftKey &&
                            !event.nativeEvent.isComposing &&
                            event.keyCode !== 229
                        ) {
                            event.preventDefault();
                            submit();
                        }
                    }}
                    placeholder={
                        suggestions[0]
                            ? t(starterPromptKey(suggestions[0].key, entitlement))
                            : t('assistant.placeholder')
                    }
                    aria-describedby={`${id}-description ${id}-hint`}
                    rows={2}
                    className="min-h-16 resize-none rounded-t-xl border-0 px-4 pt-4 text-neutral-900 shadow-none placeholder:text-neutral-500 focus-visible:ring-0 sm:px-5"
                />
                <div className="flex items-center justify-end gap-3 px-3 pb-3 sm:justify-between sm:px-4">
                    <span id={`${id}-hint`} className="hidden text-2xs text-neutral-500 sm:inline">
                        {t('assistant.inputHint')}
                    </span>
                    <MyButton
                        type="submit"
                        buttonType="primary"
                        scale="medium"
                        disable={!question.trim()}
                        className="shrink-0 rounded-lg bg-neutral-900 !text-white hover:bg-neutral-800 focus-visible:ring-2 focus-visible:ring-neutral-500 focus-visible:ring-offset-2 active:bg-neutral-800 disabled:bg-neutral-100 disabled:!text-neutral-500"
                    >
                        {t('assistant.submit')}
                        <ArrowUp size={16} weight="bold" aria-hidden="true" />
                    </MyButton>
                </div>
            </form>

            {suggestions.length > 0 && (
                <div
                    className="mt-3 flex flex-wrap items-center gap-2"
                    role="group"
                    aria-label={t('assistant.suggestionsLabel')}
                >
                    {suggestions.map(({ key, Icon }) => (
                        <button
                            key={key}
                            type="button"
                            onClick={() => {
                                setQuestion(t(starterPromptKey(key, entitlement)));
                                inputRef.current?.focus();
                            }}
                            className="flex min-h-9 items-center gap-2 rounded-lg border border-neutral-200 bg-white px-3 py-2 text-xs font-medium text-neutral-700 transition-colors hover:border-primary-300 hover:bg-primary-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-500 active:bg-primary-100"
                        >
                            <Icon size={15} aria-hidden="true" />
                            {t(`assistant.starters.${key}.label`)}
                        </button>
                    ))}
                </div>
            )}
        </section>
    );
}
