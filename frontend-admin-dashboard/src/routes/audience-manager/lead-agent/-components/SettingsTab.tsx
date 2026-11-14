import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useNavigate } from '@tanstack/react-router';
import { Archive, Pause, Play, Lightning } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Form } from '@/components/ui/form';
import type { LeadAgent } from '../-types';
import {
    agentFormSchema,
    formValuesFromAgent,
    payloadFromForm,
    type AgentFormValues,
} from '../-utils/agent-form';
import {
    useLeadAgents,
    useRunNow,
    useSetAgentStatus,
    useUpdateAgent,
} from '../-hooks/use-lead-agent';
import { useLeadListOptions } from '../-hooks/use-lead-list-options';
import {
    AudienceSection,
    AutomationWarning,
    BasicsSection,
    PacingSection,
} from './AgentFormSections';
import { TurnOnDialog } from './AgentStatusControls';

const Panel = ({ title, children }: { title: string; children: React.ReactNode }) => (
    <section className="flex flex-col gap-4 rounded-lg border border-neutral-200 bg-card p-4 sm:p-6">
        <h2 className="text-title font-semibold text-neutral-800">{title}</h2>
        {children}
    </section>
);

/** Edit the agent, pause / resume it, run it now or archive it. */
export function SettingsTab({ agent }: { agent: LeadAgent }) {
    const navigate = useNavigate();
    const agents = useLeadAgents();
    const lists = useLeadListOptions(agents.data, agent.audience_id);
    const update = useUpdateAgent(agent.id);
    const setStatus = useSetAgentStatus();
    const runNow = useRunNow();
    const [turnOnOpen, setTurnOnOpen] = useState(false);
    const [archiveOpen, setArchiveOpen] = useState(false);

    const form = useForm<AgentFormValues>({
        resolver: zodResolver(agentFormSchema),
        defaultValues: formValuesFromAgent(agent),
        mode: 'onTouched',
    });

    // A fresh copy from the server (after save, or a teammate's change) resets an untouched form.
    useEffect(() => {
        if (!form.formState.isDirty) form.reset(formValuesFromAgent(agent));
    }, [agent, form]);

    const save = form.handleSubmit(async (values) => {
        const saved = await update.mutateAsync(payloadFromForm(values)).catch(() => null);
        if (saved) form.reset(formValuesFromAgent(saved));
    });

    const archived = agent.status === 'ARCHIVED';
    const active = agent.status === 'ACTIVE';

    return (
        <div className="flex flex-col gap-6">
            <Panel title="Controls">
                <div className="flex flex-wrap gap-3">
                    {active ? (
                        <MyButton
                            type="button"
                            buttonType="secondary"
                            disable={setStatus.isPending}
                            onClick={() =>
                                setStatus.mutate({ agentId: agent.id, status: 'PAUSED' })
                            }
                        >
                            <Pause className="size-4" /> Pause
                        </MyButton>
                    ) : (
                        !archived && (
                            <MyButton
                                type="button"
                                buttonType="secondary"
                                disable={setStatus.isPending}
                                onClick={() => setTurnOnOpen(true)}
                            >
                                <Play className="size-4" /> Turn on
                            </MyButton>
                        )
                    )}
                    <MyButton
                        type="button"
                        buttonType="secondary"
                        disable={runNow.isPending || archived}
                        onClick={() => runNow.mutate(agent.id)}
                    >
                        <Lightning className="size-4" />{' '}
                        {runNow.isPending ? 'Starting…' : 'Run now'}
                    </MyButton>
                    {!archived && (
                        <MyButton
                            type="button"
                            buttonType="secondary"
                            disable={setStatus.isPending}
                            onClick={() => setArchiveOpen(true)}
                            className="text-danger-600"
                        >
                            <Archive className="size-4" /> Archive
                        </MyButton>
                    )}
                </div>
                <p className="text-caption text-neutral-500">
                    Run now starts a search and research round straight away. Delivery still waits
                    for the delivery window and the daily limit.
                </p>
            </Panel>

            <Form {...form}>
                <form
                    onSubmit={(e) => {
                        e.preventDefault();
                        void save();
                    }}
                    className="flex flex-col gap-6"
                >
                    <Panel title="List & product">
                        <BasicsSection
                            form={form}
                            leadLists={lists.options}
                            leadListsLoading={lists.isLoading}
                        />
                    </Panel>
                    <Panel title="Who to find">
                        <AudienceSection form={form} />
                    </Panel>
                    <Panel title="Pace & quality">
                        <PacingSection form={form} />
                    </Panel>
                    <AutomationWarning />
                    <div className="sticky bottom-0 flex justify-end gap-3 border-t border-neutral-200 bg-background py-3">
                        <MyButton
                            type="button"
                            buttonType="secondary"
                            disable={!form.formState.isDirty || update.isPending}
                            onClick={() => form.reset(formValuesFromAgent(agent))}
                        >
                            Discard changes
                        </MyButton>
                        <MyButton
                            type="submit"
                            buttonType="primary"
                            disable={!form.formState.isDirty || update.isPending || archived}
                        >
                            {update.isPending ? 'Saving…' : 'Save'}
                        </MyButton>
                    </div>
                </form>
            </Form>

            <TurnOnDialog open={turnOnOpen} onOpenChange={setTurnOnOpen} agent={agent} />
            <AlertDialog open={archiveOpen} onOpenChange={setArchiveOpen}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Archive {agent.name}?</AlertDialogTitle>
                        <AlertDialogDescription>
                            It stops for good. Leads already delivered stay in the list. You can
                            then create a new agent for this list.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={setStatus.isPending}>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                            disabled={setStatus.isPending}
                            className="bg-danger-600 hover:bg-danger-500"
                            onClick={(e) => {
                                e.preventDefault();
                                setStatus.mutate(
                                    { agentId: agent.id, status: 'ARCHIVED' },
                                    {
                                        onSuccess: () => {
                                            setArchiveOpen(false);
                                            void navigate({ to: '/audience-manager/lead-agent' });
                                        },
                                    }
                                );
                            }}
                        >
                            {setStatus.isPending ? 'Archiving…' : 'Archive'}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
}
