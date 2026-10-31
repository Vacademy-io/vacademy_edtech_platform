import { useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { CircleNotch, PaperPlaneRight, Sparkle } from '@phosphor-icons/react';
import { useToast } from '@/hooks/use-toast';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import { getTerminology } from '@/components/common/layout-container/sidebar/utils';
import { ContentTerms, RoleTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';
import { useEditorStore } from '../-stores/editor-store';
import { editSiteChrome } from '../-services/ai-page-service';

/**
 * AI for Global Settings — header, footer and theme.
 *
 * These are the site's shared parts, and they were the one place the copilot
 * could not reach: it emits component OPS, but the global header/footer live on
 * globalSettings.layout.*, outside any page's component tree. So the screen
 * with the most tedious hand-entry (a footer with four link columns, a nav that
 * must mirror every page) offered no help at all.
 *
 * Changes land as a normal config update — undoable with Ctrl+Z, saved with the
 * draft, published deliberately. The server restricts what may change: header,
 * footer, theme, fonts and motion only. Analytics IDs, lead-collection wiring
 * and the WhatsApp number are never AI-writable.
 */

const SUGGESTIONS = [
    'Put every page in the menu, and add a Login button',
    'Build a footer with a short about blurb and a links column',
    'Make the header white with dark text and a sticky bar',
    'Give the site a calm, premium feel with a serif heading font',
];

export const AiChromePanel = () => {
    const { config, updateConfig } = useEditorStore();
    const { instituteDetails } = useInstituteDetailsStore();
    const { toast } = useToast();
    const [input, setInput] = useState('');
    const [messages, setMessages] = useState<Array<{ role: 'user' | 'assistant'; content: string }>>([]);

    const terminology = useMemo(
        () => ({
            course: getTerminology(ContentTerms.Course, SystemTerms.Course),
            batch: getTerminology(ContentTerms.Batch, SystemTerms.Batch),
            learner: getTerminology(RoleTerms.Learner, SystemTerms.Learner),
        }),
        []
    );

    const mutation = useMutation({
        mutationFn: (instruction: string) =>
            editSiteChrome({
                instruction,
                global_settings: (config?.globalSettings || {}) as Record<string, any>,
                pages: (config?.pages || []).map((p) => ({ route: p.route, title: p.title })),
                institute_name: (instituteDetails as any)?.institute_name || undefined,
                terminology,
                history: messages.slice(-6),
            }),
        onSuccess: (res) => {
            if (!config) return;
            // Whole-config update so undo/redo and the dirty flag behave exactly
            // as they do for a manual edit.
            updateConfig({ ...config, globalSettings: res.global_settings as any });
            setMessages((m) => [...m, { role: 'assistant', content: res.reply }]);
            if (res.warnings?.length) {
                toast({ title: 'Applied with notes', description: res.warnings.join(' · ') });
            }
        },
        onError: (err: any) => {
            const detail = err?.response?.data?.detail;
            setMessages((m) => [
                ...m,
                {
                    role: 'assistant',
                    content:
                        typeof detail === 'string'
                            ? detail
                            : 'That did not work — try describing the change differently.',
                },
            ]);
        },
    });

    const send = (text: string) => {
        const instruction = text.trim();
        if (!instruction || mutation.isPending) return;
        setMessages((m) => [...m, { role: 'user', content: instruction }]);
        setInput('');
        mutation.mutate(instruction);
    };

    if (!config) {
        return <div className="p-4 text-sm text-gray-400">Loading your site…</div>;
    }

    return (
        // min-h-0 flex-1, not h-full: the rail also holds a tab strip, so a
        // 100%-height panel overflowed it and hid the send button.
        <div className="flex min-h-0 flex-1 flex-col">
            <div className="shrink-0 border-b p-3">
                <p className="flex items-center gap-1.5 text-sm font-medium text-gray-700">
                    <Sparkle className="size-4 text-primary-500" weight="duotone" />
                    Header, footer &amp; theme
                </p>
                <p className="mt-0.5 text-caption text-gray-400">
                    Describe what you want. Changes apply to every page and can be undone.
                </p>
            </div>

            <div className="flex-1 space-y-3 overflow-y-auto p-3">
                {messages.length === 0 ? (
                    <div className="space-y-1.5">
                        {SUGGESTIONS.map((s) => (
                            <button
                                key={s}
                                type="button"
                                onClick={() => send(s)}
                                className="w-full rounded border border-gray-200 bg-white px-2.5 py-2 text-left text-caption text-gray-600 hover:border-primary-300 hover:bg-primary-50"
                            >
                                {s}
                            </button>
                        ))}
                    </div>
                ) : (
                    messages.map((m, i) => (
                        <div
                            key={i}
                            className={`max-w-full rounded-lg px-3 py-2 text-sm ${
                                m.role === 'user'
                                    ? 'ml-auto w-fit bg-primary-500 text-white'
                                    : 'bg-gray-100 text-gray-700'
                            }`}
                        >
                            {m.content}
                        </div>
                    ))
                )}
                {mutation.isPending && (
                    <div className="flex items-center gap-2 text-caption text-gray-500">
                        <CircleNotch className="size-4 animate-spin" /> Updating your settings…
                    </div>
                )}
            </div>

            <div className="shrink-0 border-t p-3">
                <Textarea
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            send(input);
                        }
                    }}
                    rows={2}
                    placeholder="e.g. add Programs and Contact to the menu"
                    className="max-h-40 min-h-9 w-full resize-none text-xs"
                />
                <div className="mt-2 flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-caption text-gray-500">
                        Enter to send
                    </span>
                    <Button
                        size="sm"
                        className="h-8 shrink-0 px-3"
                        onClick={() => send(input)}
                        disabled={!input.trim() || mutation.isPending}
                    >
                        {mutation.isPending ? (
                            <CircleNotch className="size-4 animate-spin" />
                        ) : (
                            <PaperPlaneRight className="size-4" />
                        )}
                        Send
                    </Button>
                </div>
                <p className="mt-1.5 text-caption text-gray-400">
                    Analytics IDs, lead forms and your WhatsApp number are never changed by AI.
                </p>
            </div>
        </div>
    );
};

export default AiChromePanel;
