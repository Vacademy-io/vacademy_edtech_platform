import { useState } from 'react';
import { Plus, Trash, SpinnerGap } from '@phosphor-icons/react';
import { toast } from 'sonner';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { updateRules, type ChatRulesDto, type ChatRulesResponse } from '@/services/chat/chatApi';

interface RulesEditorProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    conversationId: string;
    initial: ChatRulesResponse;
    onSaved: (updated: ChatRulesResponse) => void;
}

interface FormState {
    title: string;
    items: string[];
    acknowledgementRequired: boolean;
    slowModeSeconds: number;
    allowLinks: boolean;
    allowAttachments: boolean;
    newMemberReadonlyMinutes: number;
    bannedKeywords: string[];
    action: 'BLOCK' | 'FLAG';
}

const toFormState = (res: ChatRulesResponse): FormState => {
    const r = res.rules || {};
    return {
        title: r.guidelines?.title ?? 'Community Guidelines',
        items: r.guidelines?.items ?? [],
        acknowledgementRequired: r.acknowledgement_required ?? false,
        slowModeSeconds: r.posting?.slow_mode_seconds ?? 0,
        allowLinks: r.posting?.allow_links ?? true,
        allowAttachments: r.posting?.allow_attachments ?? true,
        newMemberReadonlyMinutes: r.posting?.new_member_readonly_minutes ?? 0,
        bannedKeywords: r.auto_moderation?.banned_keywords ?? [],
        action: r.auto_moderation?.action ?? 'FLAG',
    };
};

const numberOrZero = (value: string): number => {
    const n = Number(value);
    return Number.isFinite(n) && n >= 0 ? n : 0;
};

export function RulesEditor({
    open,
    onOpenChange,
    conversationId,
    initial,
    onSaved,
}: RulesEditorProps) {
    const [form, setForm] = useState<FormState>(() => toFormState(initial));
    const [newItem, setNewItem] = useState('');
    const [newKeyword, setNewKeyword] = useState('');
    const [isSaving, setIsSaving] = useState(false);

    const addItem = () => {
        const v = newItem.trim();
        if (!v) return;
        setForm((f) => ({ ...f, items: [...f.items, v] }));
        setNewItem('');
    };

    const removeItem = (idx: number) => {
        setForm((f) => ({ ...f, items: f.items.filter((_, i) => i !== idx) }));
    };

    const addKeyword = () => {
        const v = newKeyword.trim().toLowerCase();
        if (!v || form.bannedKeywords.includes(v)) {
            setNewKeyword('');
            return;
        }
        setForm((f) => ({ ...f, bannedKeywords: [...f.bannedKeywords, v] }));
        setNewKeyword('');
    };

    const removeKeyword = (kw: string) => {
        setForm((f) => ({ ...f, bannedKeywords: f.bannedKeywords.filter((k) => k !== kw) }));
    };

    const handleSave = async () => {
        const dto: ChatRulesDto = {
            guidelines: { title: form.title.trim() || undefined, items: form.items },
            acknowledgement_required: form.acknowledgementRequired,
            posting: {
                slow_mode_seconds: form.slowModeSeconds,
                allow_links: form.allowLinks,
                allow_attachments: form.allowAttachments,
                new_member_readonly_minutes: form.newMemberReadonlyMinutes,
            },
            auto_moderation: {
                banned_keywords: form.bannedKeywords,
                action: form.action,
            },
        };
        setIsSaving(true);
        try {
            const updated = await updateRules(conversationId, dto);
            toast.success('Rules updated.');
            onSaved(updated);
            onOpenChange(false);
        } catch {
            toast.error('Failed to save rules.');
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="flex max-h-[90vh] w-full max-w-xl flex-col p-0">{/* design-lint-ignore: vh-based dialog height matches MyDialog primitive */}
                <DialogHeader className="border-b border-neutral-200 px-5 py-4">
                    <DialogTitle className="text-base font-semibold text-neutral-700">
                        Edit Community Rules
                    </DialogTitle>
                </DialogHeader>

                <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
                    {/* Guidelines */}
                    <section>
                        <label className="mb-1 block text-sm font-medium text-neutral-700">
                            Guidelines title
                        </label>
                        <Input
                            value={form.title}
                            onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                            placeholder="Community Guidelines"
                        />

                        <label className="mb-1 mt-3 block text-sm font-medium text-neutral-700">
                            Guideline items
                        </label>
                        <div className="space-y-2">
                            {form.items.map((item, idx) => (
                                <div key={idx} className="flex items-center gap-2">
                                    <span className="flex-1 rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm text-neutral-600">
                                        {item}
                                    </span>
                                    <button
                                        type="button"
                                        onClick={() => removeItem(idx)}
                                        className="text-neutral-400 hover:text-danger-500"
                                        aria-label="Remove item"
                                    >
                                        <Trash size={16} />
                                    </button>
                                </div>
                            ))}
                            <div className="flex items-center gap-2">
                                <Input
                                    value={newItem}
                                    onChange={(e) => setNewItem(e.target.value)}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter') {
                                            e.preventDefault();
                                            addItem();
                                        }
                                    }}
                                    placeholder="Add a guideline..."
                                />
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="icon"
                                    onClick={addItem}
                                    aria-label="Add guideline"
                                >
                                    <Plus size={16} />
                                </Button>
                            </div>
                        </div>
                    </section>

                    {/* Acknowledgement */}
                    <section className="flex items-center justify-between rounded-md border border-neutral-200 px-3 py-2.5">
                        <div>
                            <div className="text-sm font-medium text-neutral-700">
                                Require acknowledgement
                            </div>
                            <div className="text-xs text-neutral-500">
                                Members must accept the rules before posting.
                            </div>
                        </div>
                        <Switch
                            checked={form.acknowledgementRequired}
                            onCheckedChange={(v) =>
                                setForm((f) => ({ ...f, acknowledgementRequired: v }))
                            }
                        />
                    </section>

                    {/* Posting */}
                    <section className="space-y-3">
                        <h3 className="text-sm font-semibold text-neutral-700">Posting controls</h3>
                        <div className="grid grid-cols-2 gap-3">
                            <div>
                                <label className="mb-1 block text-xs font-medium text-neutral-600">
                                    Slow mode (seconds)
                                </label>
                                <Input
                                    type="number"
                                    min={0}
                                    value={form.slowModeSeconds}
                                    onChange={(e) =>
                                        setForm((f) => ({
                                            ...f,
                                            slowModeSeconds: numberOrZero(e.target.value),
                                        }))
                                    }
                                />
                            </div>
                            <div>
                                <label className="mb-1 block text-xs font-medium text-neutral-600">
                                    New-member read-only (minutes)
                                </label>
                                <Input
                                    type="number"
                                    min={0}
                                    value={form.newMemberReadonlyMinutes}
                                    onChange={(e) =>
                                        setForm((f) => ({
                                            ...f,
                                            newMemberReadonlyMinutes: numberOrZero(e.target.value),
                                        }))
                                    }
                                />
                            </div>
                        </div>
                        <div className="flex items-center justify-between rounded-md border border-neutral-200 px-3 py-2">
                            <span className="text-sm text-neutral-700">Allow links</span>
                            <Switch
                                checked={form.allowLinks}
                                onCheckedChange={(v) => setForm((f) => ({ ...f, allowLinks: v }))}
                            />
                        </div>
                        <div className="flex items-center justify-between rounded-md border border-neutral-200 px-3 py-2">
                            <span className="text-sm text-neutral-700">Allow attachments</span>
                            <Switch
                                checked={form.allowAttachments}
                                onCheckedChange={(v) =>
                                    setForm((f) => ({ ...f, allowAttachments: v }))
                                }
                            />
                        </div>
                    </section>

                    {/* Auto-moderation */}
                    <section className="space-y-3">
                        <h3 className="text-sm font-semibold text-neutral-700">Auto-moderation</h3>
                        <div>
                            <label className="mb-1 block text-xs font-medium text-neutral-600">
                                Banned keywords
                            </label>
                            <div className="mb-2 flex flex-wrap gap-2">
                                {form.bannedKeywords.map((kw) => (
                                    <span
                                        key={kw}
                                        className="flex items-center gap-1 rounded-full bg-danger-50 px-2.5 py-1 text-xs text-danger-600"
                                    >
                                        {kw}
                                        <button
                                            type="button"
                                            onClick={() => removeKeyword(kw)}
                                            className="hover:text-danger-700"
                                            aria-label={`Remove ${kw}`}
                                        >
                                            <Trash size={12} />
                                        </button>
                                    </span>
                                ))}
                            </div>
                            <div className="flex items-center gap-2">
                                <Input
                                    value={newKeyword}
                                    onChange={(e) => setNewKeyword(e.target.value)}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter') {
                                            e.preventDefault();
                                            addKeyword();
                                        }
                                    }}
                                    placeholder="Add a keyword..."
                                />
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="icon"
                                    onClick={addKeyword}
                                    aria-label="Add keyword"
                                >
                                    <Plus size={16} />
                                </Button>
                            </div>
                        </div>
                        <div>
                            <label className="mb-1 block text-xs font-medium text-neutral-600">
                                Action on match
                            </label>
                            <Select
                                value={form.action}
                                onValueChange={(v) =>
                                    setForm((f) => ({ ...f, action: v as 'BLOCK' | 'FLAG' }))
                                }
                            >
                                <SelectTrigger className="w-full">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="FLAG">Flag for review</SelectItem>
                                    <SelectItem value="BLOCK">Block the message</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                    </section>
                </div>

                <DialogFooter className="border-t border-neutral-200 px-5 py-3">
                    <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>
                        Cancel
                    </Button>
                    <Button
                        onClick={handleSave}
                        disabled={isSaving}
                        className="bg-primary-500 text-white hover:opacity-90"
                    >
                        {isSaving ? <SpinnerGap size={16} className="animate-spin" /> : 'Save rules'}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
