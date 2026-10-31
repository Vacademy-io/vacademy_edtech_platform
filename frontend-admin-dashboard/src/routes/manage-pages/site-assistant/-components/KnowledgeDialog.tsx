import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { MyButton } from '@/components/design-system/button';
import { MyDialog } from '@/components/design-system/dialog';
import { MyInput } from '@/components/design-system/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import {
    KNOWLEDGE_ERROR_TEXT,
    MAX_KNOWLEDGE_BODY,
    SITE_ASSISTANT_QUERY_KEY,
    createKnowledge,
    updateKnowledge,
    validateKnowledgeInput,
    type KnowledgeInput,
    type KnowledgeInputError,
    type KnowledgeItem,
} from '../-services/site-assistant-service';

export const emptyKnowledgeInput = (
    kind: KnowledgeInput['kind'],
    prefill?: Partial<KnowledgeInput>
): KnowledgeInput => ({
    kind,
    title: '',
    body: '',
    active: true,
    allSites: false,
    startDate: '',
    endDate: '',
    ...prefill,
});

interface KnowledgeDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    siteTag: string;
    siteLabel: string;
    /** The form's starting values (new item, a prefilled FAQ, or the item being edited). */
    initial: KnowledgeInput;
    /** Set when editing an existing FAQ / notice. */
    editing?: KnowledgeItem | null;
    onSaved?: (item: KnowledgeItem | null) => void;
}

/**
 * Add or edit one FAQ or notice. Text is stored and shown as plain text (no
 * HTML), so it is safe to paste from anywhere; links can be written as
 * https://… and the assistant passes them on.
 */
export const KnowledgeDialog = ({
    open,
    onOpenChange,
    siteTag,
    siteLabel,
    initial,
    editing,
    onSaved,
}: KnowledgeDialogProps) => {
    const queryClient = useQueryClient();
    const [form, setForm] = useState<KnowledgeInput>(initial);
    const [error, setError] = useState<KnowledgeInputError | null>(null);
    const isFaq = form.kind === 'FAQ';
    const set = (patch: Partial<KnowledgeInput>) => {
        setForm((f) => ({ ...f, ...patch }));
        setError(null);
    };

    const save = useMutation({
        mutationFn: () =>
            editing ? updateKnowledge(siteTag, editing.id, form) : createKnowledge(siteTag, form),
        onSuccess: (item) => {
            toast.success(editing ? 'Saved.' : isFaq ? 'FAQ added.' : 'Notice added.');
            void queryClient.invalidateQueries({ queryKey: [SITE_ASSISTANT_QUERY_KEY] });
            onSaved?.(item);
            onOpenChange(false);
        },
        onError: () => {
            toast.error('Could not save. Check your connection and try again.');
        },
    });

    const submit = async () => {
        const problem = validateKnowledgeInput(form);
        if (problem) {
            setError(problem);
            return;
        }
        await save.mutateAsync().catch(() => undefined);
    };

    const heading = editing
        ? isFaq
            ? 'Edit FAQ'
            : 'Edit notice'
        : isFaq
          ? 'Add an FAQ'
          : 'Add a notice';

    return (
        <MyDialog
            heading={heading}
            open={open}
            onOpenChange={onOpenChange}
            dialogWidth="max-w-xl"
            footerLeft={
                error ? (
                    <p role="alert" className="text-caption text-danger-600">
                        {KNOWLEDGE_ERROR_TEXT[error]}
                    </p>
                ) : undefined
            }
            footer={
                <>
                    <MyButton buttonType="secondary" onClick={() => onOpenChange(false)}>
                        Cancel
                    </MyButton>
                    <MyButton buttonType="primary" onAsyncClick={submit} loadingText="Saving…">
                        Save
                    </MyButton>
                </>
            }
        >
            <div className="flex flex-col gap-4">
                <MyInput
                    label={isFaq ? 'Question' : 'Title'}
                    required
                    className="sm:w-full"
                    inputPlaceholder={
                        isFaq ? 'e.g. Do you give a certificate?' : 'e.g. New batch starts 1 Nov'
                    }
                    input={form.title}
                    onChangeFunction={(e) => set({ title: e.target.value })}
                />
                <div className="flex flex-col gap-1">
                    <Label htmlFor="sa-knowledge-body">
                        {isFaq ? 'Answer' : 'Details'}
                        <span className="text-danger-600"> *</span>
                    </Label>
                    <Textarea
                        id="sa-knowledge-body"
                        rows={5}
                        maxLength={MAX_KNOWLEDGE_BODY}
                        placeholder={
                            isFaq
                                ? 'Write the answer as you would say it to a visitor.'
                                : 'What visitors should know. Add a link (https://…) if there is one.'
                        }
                        value={form.body}
                        onChange={(e) => set({ body: e.target.value })}
                    />
                    <p className="text-caption text-neutral-400">
                        Plain text. The assistant uses it word for word for facts like dates and
                        prices.
                    </p>
                </div>

                <div className="flex flex-col gap-2">
                    <Label>Use it on</Label>
                    <RadioGroup
                        value={form.allSites ? 'all' : 'this'}
                        onValueChange={(v) => set({ allSites: v === 'all' })}
                        className="flex flex-col gap-2 sm:flex-row sm:gap-6"
                    >
                        <label className="flex cursor-pointer items-center gap-2 text-body">
                            <RadioGroupItem value="this" aria-label="This site only" />
                            This site only ({siteLabel})
                        </label>
                        <label className="flex cursor-pointer items-center gap-2 text-body">
                            <RadioGroupItem value="all" aria-label="All my sites" />
                            All my sites
                        </label>
                    </RadioGroup>
                </div>

                <div className="flex flex-col gap-2">
                    <Label>
                        {isFaq ? 'Only between these dates (optional)' : 'Show from / until'}
                    </Label>
                    <div className="flex flex-col gap-3 sm:flex-row">
                        <MyInput
                            label="From"
                            inputType="date"
                            input={form.startDate}
                            onChangeFunction={(e) => set({ startDate: e.target.value })}
                        />
                        <MyInput
                            label="Until"
                            inputType="date"
                            input={form.endDate}
                            onChangeFunction={(e) => set({ endDate: e.target.value })}
                        />
                    </div>
                    {!isFaq && !form.endDate && (
                        <p className="text-caption text-warning-600">
                            Tip: give a notice an end date so the assistant stops mentioning it when
                            it is over.
                        </p>
                    )}
                </div>

                <div className="flex items-center justify-between gap-3">
                    <div>
                        <Label htmlFor="sa-knowledge-active">Switched on</Label>
                        <p className="text-caption text-neutral-500">
                            Off keeps it here without the assistant using it.
                        </p>
                    </div>
                    <Switch
                        id="sa-knowledge-active"
                        checked={form.active}
                        onCheckedChange={(on) => set({ active: on })}
                    />
                </div>
            </div>
        </MyDialog>
    );
};
