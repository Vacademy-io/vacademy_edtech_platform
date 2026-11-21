import { useEffect, useId, useState } from 'react';
import axios from 'axios';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { CalendarBlank, CheckCircle, Sparkle, WarningCircle } from '@phosphor-icons/react';
import { BASE_URL } from '@/constants/urls';
import { MyButton } from '@/components/design-system/button';
import { Skeleton } from '@/components/ui/skeleton';

const OPEN = `${BASE_URL}/admin-core-service/open/engagement/planning/v1`;
const TOPIC_MAX = 2000;
const POLL_MS = 5000;

type Status = 'SENT' | 'SUBMITTED' | 'DRAFTING' | 'DRAFTED' | 'PUBLISHED' | 'FAILED' | 'EXPIRED';

interface PlanningView {
    instituteName: string | null;
    teacherFirstName: string | null;
    batchLabel: string | null;
    subjects: string | null;
    weekStart: string;
    weekEnd: string;
    status: Status;
    topic: string | null;
    error: string | null;
    canSubmit: boolean;
    autoPublish: boolean;
    tasksPerDay: number;
    runDates: string[];
}

// Plain axios: the visitor is not signed in, and the token goes in the body so it
// stays out of URLs and access logs.
async function fetchView(token: string): Promise<PlanningView> {
    const { data } = await axios.post<PlanningView>(`${OPEN}/view`, { token });
    return data;
}

async function submitTopic(token: string, topic: string): Promise<PlanningView> {
    const { data } = await axios.post<PlanningView>(`${OPEN}/submit`, { token, topic });
    return data;
}

/** The server's sentence (ErrorInfo.ex), else the fallback. */
function getBackendErrorMessage(error: unknown, fallback: string): string {
    if (axios.isAxiosError(error)) {
        const body = error.response?.data as { ex?: unknown; message?: unknown } | undefined;
        if (typeof body?.ex === 'string' && body.ex.trim()) return body.ex;
        if (typeof body?.message === 'string' && body.message.trim()) return body.message;
    }
    return fallback;
}

function formatDay(iso: string, lang: string): string {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(y ?? 2000, (m ?? 1) - 1, d ?? 1).toLocaleDateString(lang, {
        day: 'numeric',
        month: 'short',
    });
}

/** The one-box page a teacher reaches from the weekly planning email. */
export function PlanWeekPage({ token }: { token?: string }) {
    const { t, i18n } = useTranslation('engagement');
    const lang = i18n.resolvedLanguage || i18n.language || 'en';
    const queryClient = useQueryClient();
    const fieldId = useId();
    const [topic, setTopic] = useState('');

    const view = useQuery({
        queryKey: ['plan-week', token],
        queryFn: () => fetchView(token!),
        enabled: Boolean(token),
        retry: false,
        refetchInterval: (query) => {
            const status = query.state.data?.status;
            return status === 'SUBMITTED' || status === 'DRAFTING' ? POLL_MS : false;
        },
    });

    // A failed draft keeps the teacher's words, so sending again is one click.
    useEffect(() => {
        if (view.data?.topic && view.data.status === 'FAILED') setTopic(view.data.topic);
    }, [view.data?.topic, view.data?.status]);

    const submit = useMutation({
        mutationFn: () => submitTopic(token!, topic.trim()),
        onSuccess: (data) => queryClient.setQueryData(['plan-week', token], data),
    });

    const data = view.data;
    const tooShort = topic.trim().length < 3;

    let body: JSX.Element;
    if (!token || view.isError) {
        body = (
            <Notice
                tone="warning"
                title={t('planWeek.invalidTitle')}
                text={
                    token && axios.isAxiosError(view.error) && view.error.response?.status !== 404
                        ? getBackendErrorMessage(view.error, t('planWeek.loadFailed'))
                        : t('planWeek.invalidText')
                }
            />
        );
    } else if (view.isPending || !data) {
        body = (
            <div className="space-y-3" aria-busy>
                <Skeleton className="h-6 w-2/3" />
                <Skeleton className="h-4 w-1/2" />
                <Skeleton className="h-32 w-full" />
            </div>
        );
    } else if (data.status === 'SUBMITTED' || data.status === 'DRAFTING') {
        body = (
            <Notice
                tone="progress"
                title={t('planWeek.draftingTitle')}
                text={t('planWeek.draftingText')}
                quote={data.topic}
            />
        );
    } else if (data.status === 'DRAFTED' || data.status === 'PUBLISHED') {
        body = (
            <Notice
                tone="done"
                title={t(
                    data.status === 'PUBLISHED' ? 'planWeek.liveTitle' : 'planWeek.readyTitle'
                )}
                text={t(data.status === 'PUBLISHED' ? 'planWeek.liveText' : 'planWeek.readyText')}
                quote={data.topic}
                action={{ href: '/engagement', label: t('planWeek.openApp') }}
            />
        );
    } else if (!data.canSubmit) {
        body = (
            <Notice
                tone="warning"
                title={t('planWeek.closedTitle')}
                text={t('planWeek.closedText')}
                action={{ href: '/engagement', label: t('planWeek.openApp') }}
            />
        );
    } else {
        const days = data.runDates.length;
        body = (
            <form
                className="space-y-4"
                onSubmit={(e) => {
                    e.preventDefault();
                    if (!tooShort && !submit.isPending) submit.mutate();
                }}
            >
                {data.status === 'FAILED' && data.error && (
                    <p
                        role="alert"
                        className="flex items-start gap-2 rounded-md border border-danger-200 bg-danger-50 p-3 text-body text-danger-700"
                    >
                        <WarningCircle size={18} className="mt-0.5 shrink-0" aria-hidden />
                        {data.error}
                    </p>
                )}
                <div className="space-y-2">
                    <label
                        htmlFor={fieldId}
                        className="block text-subtitle font-semibold text-neutral-900"
                    >
                        {t('planWeek.question', {
                            batch: data.batchLabel || t('list.unknownBatch'),
                        })}
                    </label>
                    <textarea
                        id={fieldId}
                        value={topic}
                        maxLength={TOPIC_MAX}
                        rows={5}
                        onChange={(e) => setTopic(e.target.value)}
                        placeholder={t('planWeek.placeholder')}
                        className="w-full rounded-md border border-neutral-300 p-3 text-body text-neutral-900 placeholder:text-neutral-400 focus:border-primary-300 focus:outline-none focus:ring-2 focus:ring-primary-100"
                    />
                    <p className="text-caption text-neutral-500">
                        {t('planWeek.hint', { perDay: data.tasksPerDay, count: days })}{' '}
                        {t(data.autoPublish ? 'planWeek.hintAuto' : 'planWeek.hintReview')}
                    </p>
                </div>
                {submit.isError && (
                    <p role="alert" className="text-body text-danger-600">
                        {getBackendErrorMessage(submit.error, t('planWeek.submitFailed'))}
                    </p>
                )}
                <MyButton
                    type="submit"
                    buttonType="primary"
                    scale="large"
                    layoutVariant="default"
                    disable={tooShort || submit.isPending}
                    className="w-full sm:w-auto"
                >
                    <Sparkle size={18} aria-hidden />
                    {submit.isPending ? t('planWeek.sending') : t('planWeek.submit')}
                </MyButton>
            </form>
        );
    }

    return (
        <main className="flex min-h-screen items-start justify-center bg-neutral-50 px-4 py-10 sm:py-16">
            <div className="w-full max-w-xl space-y-6 rounded-lg border border-neutral-200 bg-white p-6 sm:p-8">
                {data && (
                    <header className="space-y-1">
                        {data.instituteName && (
                            <p className="text-caption font-semibold uppercase tracking-wide text-neutral-500">
                                {data.instituteName}
                            </p>
                        )}
                        <h1 className="text-h3 font-semibold text-neutral-900">
                            {t('planWeek.greeting', { name: data.teacherFirstName || '' })}
                        </h1>
                        <p className="flex flex-wrap items-center gap-1.5 text-body text-neutral-600">
                            <CalendarBlank size={16} aria-hidden />
                            {t('planWeek.week', {
                                from: formatDay(data.weekStart, lang),
                                to: formatDay(data.weekEnd, lang),
                            })}
                            {data.subjects && <span>· {data.subjects}</span>}
                        </p>
                    </header>
                )}
                {body}
                <p className="text-caption text-neutral-400">{t('planWeek.privacy')}</p>
            </div>
        </main>
    );
}

function Notice({
    tone,
    title,
    text,
    quote,
    action,
}: {
    tone: 'warning' | 'progress' | 'done';
    title: string;
    text: string;
    quote?: string | null;
    action?: { href: string; label: string };
}) {
    const Icon = tone === 'done' ? CheckCircle : tone === 'progress' ? Sparkle : WarningCircle;
    const color =
        tone === 'done'
            ? 'text-success-600'
            : tone === 'progress'
              ? 'text-primary-500'
              : 'text-warning-600';
    return (
        <div className="space-y-3" role={tone === 'warning' ? 'alert' : 'status'}>
            <h2 className="flex items-center gap-2 text-subtitle font-semibold text-neutral-900">
                <Icon
                    size={22}
                    weight="fill"
                    className={`${color} ${tone === 'progress' ? 'animate-pulse' : ''}`}
                    aria-hidden
                />
                {title}
            </h2>
            <p className="text-body text-neutral-600">{text}</p>
            {quote && (
                <blockquote className="whitespace-pre-wrap rounded-md border-s-4 border-primary-200 bg-neutral-50 p-3 text-body text-neutral-700">
                    {quote}
                </blockquote>
            )}
            {action && (
                <a
                    href={action.href}
                    className="inline-block text-body font-semibold text-primary-500 hover:underline"
                >
                    {action.label}
                </a>
            )}
        </div>
    );
}
