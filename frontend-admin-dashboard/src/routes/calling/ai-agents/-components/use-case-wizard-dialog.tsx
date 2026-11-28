/**
 * Use-case setup wizard.
 *
 * Three or four questions → a plain-English brief → the same
 * /ai-agents/assist/draft call the prompt assistant uses → a fully populated
 * agent draft handed to the editor for review. If the AI call fails (no
 * credits, model down) we fall back to the use case's built-in template so the
 * admin still ends up with a working agent instead of a dead end.
 */
import { useEffect, useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Sparkle, SpinnerGap } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { MyDialog } from '@/components/design-system/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { getCurrentInstituteId } from '@/lib/auth/instituteUtils';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import {
    AGENT_ASSIST_CREDIT_COST,
    runAssistJob,
} from '@/routes/settings/-services/ai-agent-assist';
import { blankAgent, type AiAgent } from '../-services/ai-agents';
import type { AgentUseCase } from '../-constants/use-cases';

/** Language answer ("Hinglish") → the agent's language field ("hinglish"). */
const toLanguageField = (answer?: string) => (answer || 'Hinglish').trim().toLowerCase();

export function UseCaseWizardDialog({
    useCase,
    open,
    onOpenChange,
    onDrafted,
}: {
    useCase: AgentUseCase | null;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** Hands the populated draft to the editor dialog for review + save. */
    onDrafted: (agent: AiAgent) => void;
}) {
    const instituteId = getCurrentInstituteId() ?? '';
    const instituteName = useInstituteDetailsStore((s) => s.instituteDetails?.institute_name ?? '');

    const [answers, setAnswers] = useState<Record<string, string>>({});

    // Seed defaults each time a use case is opened: the institute's own name and
    // the first option of every select, so the form is answerable in one pass.
    useEffect(() => {
        if (!useCase) return;
        const seeded: Record<string, string> = {};
        useCase.questions.forEach((q) => {
            if (q.id === 'institute' && instituteName) seeded[q.id] = instituteName;
            else if (q.type === 'select' && q.options?.length)
                seeded[q.id] = q.options[0] as string;
        });
        setAnswers(seeded);
    }, [useCase, instituteName]);

    const missing = useMemo(() => {
        if (!useCase) return [] as string[];
        return useCase.questions
            .filter((q) => q.required && !(answers[q.id] || '').trim())
            .map((q) => q.label);
    }, [useCase, answers]);

    /** Build the agent from the template alone — also the AI-failure fallback. */
    const templateAgent = (uc: AgentUseCase): AiAgent => ({
        ...blankAgent(instituteId),
        ...uc.defaults,
        name: uc.defaults.name,
        language: toLanguageField(answers.language),
        systemPrompt: uc.fallbackPrompt(answers),
        openingLine: uc.fallbackOpeningLine(answers),
    });

    const generate = useMutation({
        mutationFn: async (uc: AgentUseCase) => {
            const base = templateAgent(uc);
            return runAssistJob('draft', {
                instituteId,
                brief: uc.brief(answers),
                agentName: base.name,
                language: base.language,
                openingLine: base.openingLine,
                extractionQuestions: base.extractionQuestions,
                dispositions: base.dispositions,
            });
        },
        onSuccess: (res, uc) => {
            const base = templateAgent(uc);
            onDrafted({
                ...base,
                systemPrompt: res.prompt?.trim() || base.systemPrompt,
                openingLine:
                    (res.opening_line ?? res.derived?.opening_line)?.trim() || base.openingLine,
                extractionQuestions: res.derived?.extraction_questions?.length
                    ? res.derived.extraction_questions
                    : base.extractionQuestions,
                dispositions: res.derived?.dispositions?.length
                    ? res.derived.dispositions
                    : base.dispositions,
            });
            onOpenChange(false);
            toast.success('Draft ready — review it and save');
        },
        onError: (err: unknown, uc) => {
            const status = (err as { response?: { status?: number } })?.response?.status;
            toast.warning(
                status === 402
                    ? 'Not enough AI credits — starting you off with the ready-made template instead'
                    : 'The AI assistant is unavailable — starting you off with the ready-made template instead'
            );
            onDrafted(templateAgent(uc));
            onOpenChange(false);
        },
    });

    if (!useCase) return null;

    const set = (id: string, value: string) => setAnswers((prev) => ({ ...prev, [id]: value }));

    return (
        <MyDialog
            open={open}
            onOpenChange={onOpenChange}
            heading={`Set up: ${useCase.title}`}
            dialogWidth="max-w-2xl"
            footer={
                <div className="flex w-full items-center justify-between gap-2">
                    <span className="text-caption text-neutral-500">
                        Writing the prompt uses {AGENT_ASSIST_CREDIT_COST} AI credit
                    </span>
                    <div className="flex items-center gap-2">
                        <MyButton
                            buttonType="secondary"
                            scale="medium"
                            disable={generate.isPending || missing.length > 0}
                            onClick={() => {
                                onDrafted(templateAgent(useCase));
                                onOpenChange(false);
                            }}
                        >
                            Use template
                        </MyButton>
                        <MyButton
                            buttonType="primary"
                            scale="medium"
                            disable={generate.isPending || missing.length > 0}
                            onClick={() => generate.mutate(useCase)}
                        >
                            {generate.isPending ? (
                                <SpinnerGap className="mr-1 size-4 animate-spin" />
                            ) : (
                                <Sparkle className="mr-1 size-4" />
                            )}
                            {generate.isPending ? 'Writing the agent…' : 'Write it with AI'}
                        </MyButton>
                    </div>
                </div>
            }
        >
            <div className="space-y-4">
                <p className="text-body text-neutral-500">{useCase.tagline}</p>

                {useCase.questions.map((q) => (
                    <div key={q.id} className="space-y-1.5">
                        <Label>
                            {q.label}
                            {q.required && <span className="text-danger-600">*</span>}
                        </Label>
                        {q.type === 'select' ? (
                            <Select
                                value={answers[q.id] ?? q.options?.[0] ?? ''}
                                onValueChange={(v) => set(q.id, v)}
                            >
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {(q.options ?? []).map((o) => (
                                        <SelectItem key={o} value={o}>
                                            {o}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        ) : q.type === 'textarea' ? (
                            <Textarea
                                rows={3}
                                value={answers[q.id] ?? ''}
                                placeholder={q.placeholder}
                                onChange={(e) => set(q.id, e.target.value)}
                            />
                        ) : (
                            <Input
                                value={answers[q.id] ?? ''}
                                placeholder={q.placeholder}
                                onChange={(e) => set(q.id, e.target.value)}
                            />
                        )}
                        {q.help && <p className="text-caption text-neutral-500">{q.help}</p>}
                    </div>
                ))}

                <div className="rounded-md border border-neutral-200 bg-neutral-50 p-3">
                    <p className="text-caption font-medium text-neutral-600">What happens next</p>
                    <p className="mt-1 text-caption text-neutral-500">
                        We turn your answers into a brief, the AI writes the system prompt, opening
                        line, what each call should find out and the call outcomes — then the full
                        editor opens so you can read every word, test the voice, and save. Nothing
                        calls anyone until you save it.
                    </p>
                </div>
            </div>
        </MyDialog>
    );
}
