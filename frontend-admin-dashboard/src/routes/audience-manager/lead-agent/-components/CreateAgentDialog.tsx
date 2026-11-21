import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useNavigate } from '@tanstack/react-router';
import { MyButton } from '@/components/design-system/button';
import { MyDialog } from '@/components/design-system/dialog';
import { Form } from '@/components/ui/form';
import { cn } from '@/lib/utils';
import { CreateCampaignDialog } from '@/routes/audience-manager/list/-components/create-campaign-dialog/CreateCampaignDialog';
import type { LeadAgent } from '../-types';
import {
    agentFormSchema,
    defaultFormValues,
    payloadFromForm,
    STEP_FIELDS,
    type AgentFormValues,
} from '../-utils/agent-form';
import { MODE_LABEL, WEEKDAYS } from '../-utils/lead-agent-options';
import { useCreateAgent } from '../-hooks/use-lead-agent';
import { useLeadListOptions } from '../-hooks/use-lead-list-options';
import {
    AudienceSection,
    AutomationWarning,
    BasicsSection,
    PacingSection,
} from './AgentFormSections';

const STEPS = ['List & product', 'Who to find', 'Pace & quality', 'Check & save'];

function ReviewStep({ values, listName }: { values: AgentFormValues; listName: string }) {
    const rows: [string, string][] = [
        ['Lead list', listName],
        ['Name', values.name],
        ['What you sell', values.offer_name],
        ['Industries', values.industries.map((i) => i.name).join(', ') || '—'],
        ['Fit signals', values.fit_signals.map((f) => f.label).join(', ') || '—'],
        [
            'Markets',
            values.markets
                .map((m) => [m.city, m.state, m.country].filter(Boolean).join(', '))
                .join(' · '),
        ],
        ['Leads per day', String(values.daily_quota)],
        [
            'Delivery window',
            `${values.start}–${values.end} ${values.tz}, ${WEEKDAYS.filter((d) =>
                values.days.includes(d.value)
            )
                .map((d) => d.label)
                .join(' ')}`,
        ],
        ['Where it runs', MODE_LABEL[values.mode]],
        [
            'Minimum score to send',
            Number.isFinite(values.send_score) ? String(values.send_score) : '—',
        ],
        [
            'Approval',
            values.require_approval
                ? 'You approve each lead before it is sent'
                : 'Not needed, the best leads are sent automatically',
        ],
        ['Monthly credit cap', values.monthly_credit_cap || 'No cap'],
    ];
    return (
        <div className="flex flex-col gap-4">
            <dl className="grid grid-cols-1 gap-x-6 gap-y-2 rounded-lg border border-neutral-200 p-4 sm:grid-cols-3">
                {rows.map(([k, v]) => (
                    <div key={k} className="contents">
                        <dt className="text-caption text-neutral-500">{k}</dt>
                        <dd className="break-words text-body text-neutral-800 sm:col-span-2">
                            {v}
                        </dd>
                    </div>
                ))}
            </dl>
            <AutomationWarning />
            <p className="text-body text-neutral-600">
                The agent is saved <span className="font-semibold">paused</span>. Turn it on from
                its page when you are ready.
            </p>
        </div>
    );
}

/** "New Lead Agent": a 4-step dialog. Saves a PAUSED agent and opens its page. */
export function CreateAgentDialog({
    open,
    onOpenChange,
    agents,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    agents: LeadAgent[] | undefined;
}) {
    const navigate = useNavigate();
    const [step, setStep] = useState(0);
    const [createListOpen, setCreateListOpen] = useState(false);
    const create = useCreateAgent();
    const lists = useLeadListOptions(agents);
    const form = useForm<AgentFormValues>({
        resolver: zodResolver(agentFormSchema),
        defaultValues: defaultFormValues(),
        mode: 'onTouched',
    });

    useEffect(() => {
        if (!open) {
            setStep(0);
            setCreateListOpen(false);
            form.reset(defaultFormValues());
        }
    }, [open, form]);

    const next = async () => {
        const fields = STEP_FIELDS[step];
        const ok = fields ? await form.trigger(fields, { shouldFocus: true }) : true;
        if (ok) setStep((s) => Math.min(s + 1, STEPS.length - 1));
    };

    const save = form.handleSubmit(
        async (values) => {
            const agent = await create.mutateAsync(payloadFromForm(values)).catch(() => null);
            if (!agent) return;
            onOpenChange(false);
            if (agent.id) {
                void navigate({
                    to: '/audience-manager/lead-agent/$agentId',
                    params: { agentId: agent.id },
                });
            }
        },
        (errors) => {
            // Jump back to the first step that has a problem.
            const bad = STEP_FIELDS.findIndex((fields) => fields.some((f) => f in errors));
            if (bad >= 0) setStep(bad);
        }
    );

    const values = form.watch();
    const listName = lists.options.find((l) => l.id === values.audience_id)?.name ?? '—';
    const last = step === STEPS.length - 1;

    return (
        <MyDialog
            heading="New Lead Agent"
            open={open}
            onOpenChange={onOpenChange}
            dialogWidth="max-w-3xl"
            footerLeft={
                <span className="text-caption text-neutral-500">
                    Step {step + 1} of {STEPS.length}
                </span>
            }
            footer={
                <div className="flex justify-end gap-3">
                    {step > 0 ? (
                        <MyButton
                            type="button"
                            buttonType="secondary"
                            onClick={() => setStep((s) => s - 1)}
                            disable={create.isPending}
                        >
                            Back
                        </MyButton>
                    ) : (
                        <MyButton
                            type="button"
                            buttonType="secondary"
                            onClick={() => onOpenChange(false)}
                        >
                            Cancel
                        </MyButton>
                    )}
                    {last ? (
                        <MyButton
                            type="button"
                            buttonType="primary"
                            onClick={() => void save()}
                            disable={create.isPending}
                        >
                            {create.isPending ? 'Saving…' : 'Save agent'}
                        </MyButton>
                    ) : (
                        <MyButton type="button" buttonType="primary" onClick={() => void next()}>
                            Next
                        </MyButton>
                    )}
                </div>
            }
        >
            <Form {...form}>
                <form
                    onSubmit={(e) => {
                        e.preventDefault();
                        if (last) void save();
                        else void next();
                    }}
                    className="flex flex-col gap-6"
                >
                    <ol className="grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label="Steps">
                        {STEPS.map((label, i) => (
                            <li
                                key={label}
                                aria-current={i === step ? 'step' : undefined}
                                className={cn(
                                    'flex items-center gap-2 border-t-2 pt-2 text-caption',
                                    i <= step
                                        ? 'border-primary-500 text-neutral-800'
                                        : 'border-neutral-200 text-neutral-500'
                                )}
                            >
                                <span className="font-semibold">{i + 1}</span>
                                {label}
                            </li>
                        ))}
                    </ol>
                    {step === 0 && (
                        <BasicsSection
                            form={form}
                            leadLists={lists.options}
                            leadListsLoading={lists.isLoading}
                            onCreateList={() => setCreateListOpen(true)}
                        />
                    )}
                    {step === 1 && <AudienceSection form={form} />}
                    {step === 2 && <PacingSection form={form} />}
                    {step === 3 && <ReviewStep values={values} listName={listName} />}
                </form>
            </Form>
            {/* Outside <Form>/<form>: React events bubble through portals, so the list
                form's submit must not reach the agent form's onSubmit. Still inside
                MyDialog, so the two Radix dialogs stack. */}
            <CreateCampaignDialog
                isOpen={createListOpen}
                onClose={() => setCreateListOpen(false)}
                onCreated={(id) =>
                    form.setValue('audience_id', id, { shouldDirty: true, shouldValidate: true })
                }
                onSaveFailed={() => setCreateListOpen(false)}
            />
        </MyDialog>
    );
}
