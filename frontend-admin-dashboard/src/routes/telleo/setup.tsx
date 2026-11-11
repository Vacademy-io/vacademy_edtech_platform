import { useState } from 'react';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { CheckCircle, CircleNotch, Phone, Warning } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { MyInput } from '@/components/design-system/input';
import { DashboardLoader } from '@/components/core/dashboard-loader';
import { getInstituteId } from '@/constants/helper';
import {
    callMeNow,
    fetchOnboarding,
    onboardingErrorMessage,
    retryOnboarding,
    submitAnswers,
    type TelleoAnswers,
    type TelleoOnboardingStatus,
} from './-services/telleo-onboarding';

/**
 * Where a new Telleo sign-up lands (the product's app_path): a few business questions, then the
 * account is set up (trial line, settings, a draft agent) and the agent calls the phone the user
 * verified at sign-up. Outside the dashboard layout on purpose: it is a one-time setup screen,
 * and the display-settings page block only governs pages inside the layout.
 */
export const Route = createFileRoute('/telleo/setup')({
    component: TelleoSetupPage,
});

const GOALS: TelleoAnswers['goal'][] = [
    'QUALIFY_LEADS',
    'BOOK_APPOINTMENTS',
    'PAYMENT_REMINDERS',
    'FEEDBACK',
    'OTHER',
];
const OUTCOMES: TelleoAnswers['success_outcome'][] = [
    'INTERESTED',
    'BOOKED',
    'TRANSFER',
    'DETAILS_COLLECTED',
];
const LANGUAGES: TelleoAnswers['language'][] = ['english', 'hinglish', 'hindi'];

const QUERY_KEY = 'TELLEO_ONBOARDING';

function TelleoSetupPage() {
    const { t } = useTranslation('telleoSetup');
    const instituteId = getInstituteId() ?? '';
    const status = useQuery({
        queryKey: [QUERY_KEY, instituteId],
        queryFn: () => fetchOnboarding(instituteId),
        enabled: !!instituteId,
        retry: false,
        // While the account is being set up, check every few seconds.
        refetchInterval: (query) => (query.state.data?.status === 'RUNNING' ? 3000 : false),
    });

    if (!instituteId || status.isLoading) return <DashboardLoader />;
    if (status.isError || !status.data) {
        return (
            <Shell title={t('notTelleo.title', 'Nothing to set up here')}>
                <p className="text-body text-neutral-600">
                    {onboardingErrorMessage(status.error) ??
                        t(
                            'notTelleo.body',
                            'This workspace was not created through Telleo sign-up.'
                        )}
                </p>
                <GoToDashboard />
            </Shell>
        );
    }

    const data = status.data;
    if (data.status === 'NEW') return <QuestionsStep status={data} />;
    if (data.status === 'RUNNING') return <BuildingStep status={data} />;
    if (data.status === 'FAILED') return <FailedStep status={data} />;
    return <ReadyStep status={data} />;
}

const Shell = ({
    title,
    subtitle,
    children,
}: {
    title: string;
    subtitle?: string;
    children?: React.ReactNode;
}) => (
    <main className="min-h-screen-safe flex w-full min-w-0 flex-col items-center bg-neutral-50 p-4 sm:justify-center">
        <div className="flex w-full max-w-lg flex-col gap-4 rounded-lg border border-neutral-200 bg-white p-5 sm:p-6">
            <div className="flex flex-col gap-1">
                <h1 className="text-h3 font-semibold text-neutral-800">{title}</h1>
                {subtitle && <p className="text-body text-neutral-500">{subtitle}</p>}
            </div>
            {children}
        </div>
    </main>
);

const GoToDashboard = () => {
    const { t } = useTranslation('telleoSetup');
    const navigate = useNavigate();
    return (
        <MyButton
            type="button"
            buttonType="secondary"
            scale="large"
            className="w-full"
            onClick={() => navigate({ to: '/calling/dashboard' })}
        >
            {t('goToDashboard', 'Go to your dashboard')}
        </MyButton>
    );
};

const fieldClass =
    'w-full rounded-md border border-neutral-300 px-3 py-2 text-body text-neutral-800 focus:border-primary-500 focus:outline-none';

const Label = ({ children, htmlFor }: { children: React.ReactNode; htmlFor: string }) => (
    <label htmlFor={htmlFor} className="text-subtitle font-medium text-neutral-700">
        {children}
    </label>
);

const QuestionsStep = ({ status }: { status: TelleoOnboardingStatus }) => {
    const { t } = useTranslation('telleoSetup');
    const queryClient = useQueryClient();
    const saved = status.answers;
    const [answers, setAnswers] = useState<TelleoAnswers>({
        business_description: saved?.business_description ?? '',
        website: saved?.website ?? '',
        goal: saved?.goal ?? 'QUALIFY_LEADS',
        goal_detail: saved?.goal_detail ?? '',
        audience: saved?.audience ?? '',
        success_outcome: saved?.success_outcome ?? 'INTERESTED',
        pricing: saved?.pricing ?? '',
        language: saved?.language ?? 'english',
        voice_gender: saved?.voice_gender ?? 'female',
        agent_name: saved?.agent_name ?? '',
    });
    const [error, setError] = useState<string | null>(null);
    const set = <K extends keyof TelleoAnswers>(key: K, value: TelleoAnswers[K]) =>
        setAnswers((a) => ({ ...a, [key]: value }));

    const submit = useMutation({
        mutationFn: () => submitAnswers(status.institute_id, answers),
        onSuccess: (next) => queryClient.setQueryData([QUERY_KEY, status.institute_id], next),
        onError: (err) =>
            setError(
                onboardingErrorMessage(err) ?? t('submitFailed', 'That did not save. Try again.')
            ),
    });

    const ready =
        answers.business_description.trim().length > 0 &&
        answers.audience.trim().length > 0 &&
        (answers.goal !== 'OTHER' || (answers.goal_detail ?? '').trim().length > 0);

    return (
        <Shell
            title={t('questions.title', "Let's build your first AI agent")}
            subtitle={t(
                'questions.subtitle',
                'Answer a few questions (under a minute). We write a draft agent from them, and it calls your phone so you can hear it.'
            )}
        >
            {error && (
                <p
                    role="alert"
                    className="rounded-md bg-danger-50 p-2 text-caption text-danger-700"
                >
                    {error}
                </p>
            )}
            <form
                className="flex flex-col gap-4"
                onSubmit={(event) => {
                    event.preventDefault();
                    if (!ready) return;
                    setError(null);
                    submit.mutate();
                }}
            >
                <div className="flex flex-col gap-1">
                    <Label htmlFor="tl-business">
                        {t('questions.business', 'What does your business do?')}
                    </Label>
                    <textarea
                        id="tl-business"
                        className={fieldClass}
                        rows={2}
                        maxLength={400}
                        placeholder={t(
                            'questions.businessPlaceholder',
                            'e.g. We sell 2 and 3 BHK flats in Pune.'
                        )}
                        value={answers.business_description}
                        onChange={(e) => set('business_description', e.target.value)}
                    />
                </div>
                <MyInput
                    label={t('questions.website', 'Website (optional)')}
                    inputType="url"
                    inputPlaceholder="https://"
                    input={answers.website ?? ''}
                    onChangeFunction={(e) => set('website', e.target.value)}
                    className="w-full sm:w-full"
                />
                <div className="flex flex-col gap-1">
                    <Label htmlFor="tl-goal">
                        {t('questions.goal', 'What should the agent do?')}
                    </Label>
                    <select
                        id="tl-goal"
                        className={fieldClass}
                        value={answers.goal}
                        onChange={(e) => set('goal', e.target.value as TelleoAnswers['goal'])}
                    >
                        {GOALS.map((g) => (
                            <option key={g} value={g}>
                                {t(`goals.${g}`, g)}
                            </option>
                        ))}
                    </select>
                    {answers.goal === 'OTHER' && (
                        <input
                            className={fieldClass}
                            maxLength={400}
                            placeholder={t('questions.goalDetail', 'Tell us what it should do')}
                            value={answers.goal_detail ?? ''}
                            onChange={(e) => set('goal_detail', e.target.value)}
                        />
                    )}
                </div>
                <div className="flex flex-col gap-1">
                    <Label htmlFor="tl-audience">
                        {t(
                            'questions.audience',
                            'Who will it call, and why do they expect the call?'
                        )}
                    </Label>
                    <textarea
                        id="tl-audience"
                        className={fieldClass}
                        rows={2}
                        maxLength={400}
                        placeholder={t(
                            'questions.audiencePlaceholder',
                            'e.g. People who filled our Facebook ad form for a site visit.'
                        )}
                        value={answers.audience}
                        onChange={(e) => set('audience', e.target.value)}
                    />
                </div>
                <div className="flex flex-col gap-1">
                    <Label htmlFor="tl-outcome">
                        {t('questions.outcome', 'What counts as a good call?')}
                    </Label>
                    <select
                        id="tl-outcome"
                        className={fieldClass}
                        value={answers.success_outcome}
                        onChange={(e) =>
                            set(
                                'success_outcome',
                                e.target.value as TelleoAnswers['success_outcome']
                            )
                        }
                    >
                        {OUTCOMES.map((o) => (
                            <option key={o} value={o}>
                                {t(`outcomes.${o}`, o)}
                            </option>
                        ))}
                    </select>
                </div>
                <div className="flex flex-col gap-1">
                    <Label htmlFor="tl-pricing">
                        {t(
                            'questions.pricing',
                            'What may it say about price or offers? (optional)'
                        )}
                    </Label>
                    <textarea
                        id="tl-pricing"
                        className={fieldClass}
                        rows={2}
                        maxLength={400}
                        placeholder={t(
                            'questions.pricingPlaceholder',
                            'Leave blank and the agent says your team will confirm.'
                        )}
                        value={answers.pricing ?? ''}
                        onChange={(e) => set('pricing', e.target.value)}
                    />
                </div>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div className="flex flex-col gap-1">
                        <Label htmlFor="tl-language">{t('questions.language', 'Language')}</Label>
                        <select
                            id="tl-language"
                            className={fieldClass}
                            value={answers.language}
                            onChange={(e) =>
                                set('language', e.target.value as TelleoAnswers['language'])
                            }
                        >
                            {LANGUAGES.map((l) => (
                                <option key={l} value={l}>
                                    {t(`languages.${l}`, l)}
                                </option>
                            ))}
                        </select>
                    </div>
                    <div className="flex flex-col gap-1">
                        <Label htmlFor="tl-voice">{t('questions.voice', 'Voice')}</Label>
                        <select
                            id="tl-voice"
                            className={fieldClass}
                            value={answers.voice_gender}
                            onChange={(e) =>
                                set('voice_gender', e.target.value as TelleoAnswers['voice_gender'])
                            }
                        >
                            <option value="female">{t('voices.female', 'Female')}</option>
                            <option value="male">{t('voices.male', 'Male')}</option>
                        </select>
                    </div>
                </div>
                <MyButton
                    type="submit"
                    buttonType="primary"
                    scale="large"
                    className="w-full"
                    disabled={!ready || submit.isPending}
                >
                    {submit.isPending
                        ? t('questions.saving', 'Saving…')
                        : t('questions.build', 'Build my agent')}
                </MyButton>
            </form>
        </Shell>
    );
};

const StepLine = ({ label, state }: { label: string; state: string }) => (
    <li className="flex items-center gap-2 text-body text-neutral-700">
        {state === 'DONE' ? (
            <CheckCircle size={18} weight="fill" className="text-success-600" />
        ) : state === 'FAILED' ? (
            <Warning size={18} weight="fill" className="text-danger-600" />
        ) : (
            <CircleNotch size={18} className="animate-spin text-neutral-400" />
        )}
        {label}
    </li>
);

const Steps = ({ status }: { status: TelleoOnboardingStatus }) => {
    const { t } = useTranslation('telleoSetup');
    return (
        <ul className="flex flex-col gap-2">
            <StepLine
                label={t('steps.line', 'Your trial calling line')}
                state={status.line_status}
            />
            <StepLine
                label={t('steps.settings', 'Your workspace')}
                state={status.settings_status}
            />
            <StepLine label={t('steps.agent', 'Your draft agent')} state={status.agent_status} />
        </ul>
    );
};

const BuildingStep = ({ status }: { status: TelleoOnboardingStatus }) => {
    const { t } = useTranslation('telleoSetup');
    return (
        <Shell
            title={t('building.title', 'Building your agent…')}
            subtitle={t(
                'building.subtitle',
                'This usually takes under a minute. You can keep this page open.'
            )}
        >
            <Steps status={status} />
        </Shell>
    );
};

const FailedStep = ({ status }: { status: TelleoOnboardingStatus }) => {
    const { t } = useTranslation('telleoSetup');
    const queryClient = useQueryClient();
    const retry = useMutation({
        mutationFn: () => retryOnboarding(status.institute_id),
        onSuccess: (next) => queryClient.setQueryData([QUERY_KEY, status.institute_id], next),
    });
    return (
        <Shell
            title={t('failed.title', 'We could not finish setting up')}
            subtitle={status.error ?? undefined}
        >
            <Steps status={status} />
            <MyButton
                type="button"
                buttonType="primary"
                scale="large"
                className="w-full"
                disabled={retry.isPending}
                onClick={() => retry.mutate()}
            >
                {t('failed.retry', 'Try again')}
            </MyButton>
            <GoToDashboard />
        </Shell>
    );
};

const ReadyStep = ({ status }: { status: TelleoOnboardingStatus }) => {
    const { t, i18n } = useTranslation('telleoSetup');
    const navigate = useNavigate();
    const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
    const phone = status.verified_phone ?? '';
    const call = useMutation({
        mutationFn: () => callMeNow(status.institute_id),
        onSuccess: (result) =>
            setMessage({
                ok: true,
                text: result.dispatched
                    ? t('ready.calling', { phone, defaultValue: 'Calling {{phone}} now. Pick up!' })
                    : t('ready.queued', {
                          defaultValue: 'Your call is queued and will ring {{phone}} shortly.',
                          phone,
                      }),
            }),
        onError: (err) =>
            setMessage({
                ok: false,
                text:
                    onboardingErrorMessage(err) ??
                    t('ready.callFailed', 'The call could not be placed. Try again.'),
            }),
    });
    const trialEnds = status.trial_ends_at ? new Date(status.trial_ends_at) : null;

    return (
        <Shell
            title={t('ready.title', 'Your agent is ready')}
            subtitle={
                status.agent_source === 'TEMPLATE'
                    ? t(
                          'ready.subtitleTemplate',
                          'We started you from a template for your use case. Edit the script any time.'
                      )
                    : t(
                          'ready.subtitle',
                          'We wrote a draft from your answers. Edit the script any time.'
                      )
            }
        >
            <MyButton
                type="button"
                buttonType="primary"
                scale="large"
                className="w-full"
                disabled={call.isPending || status.account_state === 'SUSPENDED'}
                onClick={() => {
                    setMessage(null);
                    call.mutate();
                }}
            >
                <Phone size={18} weight="fill" />
                {call.isPending
                    ? t('ready.placing', 'Placing the call…')
                    : t('ready.callMe', { phone, defaultValue: 'Call me now on {{phone}}' })}
            </MyButton>
            {message && (
                <p
                    role="status"
                    className={`rounded-md p-2 text-caption ${
                        message.ok
                            ? 'bg-success-50 text-success-700'
                            : 'bg-danger-50 text-danger-700'
                    }`}
                >
                    {message.text}
                </p>
            )}
            {status.account_state === 'TRIAL' && (
                <p className="text-caption text-neutral-500">
                    {trialEnds
                        ? t('ready.trialNoteWithDate', {
                              date: trialEnds.toLocaleDateString(i18n.language),
                              defaultValue:
                                  'During your free trial (until {{date}}) the agent can only call this number. Upgrade to call your leads.',
                          })
                        : t(
                              'ready.trialNote',
                              'During your free trial the agent can only call this number. Upgrade to call your leads.'
                          )}
                </p>
            )}
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <MyButton
                    type="button"
                    buttonType="secondary"
                    scale="medium"
                    className="w-full"
                    onClick={() => navigate({ to: '/calling/ai-agents' })}
                >
                    {t('ready.editAgent', 'Edit the script and voice')}
                </MyButton>
                <MyButton
                    type="button"
                    buttonType="secondary"
                    scale="medium"
                    className="w-full"
                    onClick={() =>
                        navigate({ to: '/settings', search: { selectedTab: 'aiCalling' } as never })
                    }
                >
                    {t('ready.apiKeys', 'API keys')}
                </MyButton>
            </div>
            <GoToDashboard />
        </Shell>
    );
};
