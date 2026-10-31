/**
 * Reference documents of an AI agent: upload a PDF / Word / text file, the server
 * returns its text, and the text is kept on the agent (appended to the prompt at call
 * time). The admin can read and trim each document before saving.
 */
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { CaretDown, CaretRight, FileText, SpinnerGap, Trash, UploadSimple } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import {
    KNOWLEDGE_ACCEPT,
    MAX_KNOWLEDGE_CHARS,
    MAX_KNOWLEDGE_DOCUMENTS,
    agentApiError,
    extractKnowledgeDocument,
    type AiAgentKnowledgeDocument,
} from '../-services/ai-agents';

const charsOf = (d: AiAgentKnowledgeDocument) => d.text.length;

export function AgentKnowledgeDocuments({
    instituteId,
    documents,
    onChange,
}: {
    instituteId: string;
    documents: AiAgentKnowledgeDocument[];
    onChange: (documents: AiAgentKnowledgeDocument[]) => void;
}) {
    const inputRef = useRef<HTMLInputElement | null>(null);
    const [uploading, setUploading] = useState<string | null>(null);
    const [openId, setOpenId] = useState<string | null>(null);

    const total = documents.reduce((n, d) => n + charsOf(d), 0);
    const over = total > MAX_KNOWLEDGE_CHARS;
    const full = documents.length >= MAX_KNOWLEDGE_DOCUMENTS;

    const upload = async (files: FileList | null) => {
        if (!files?.length) return;
        let next = [...documents];
        for (const file of Array.from(files)) {
            if (next.length >= MAX_KNOWLEDGE_DOCUMENTS) {
                toast.error(`Up to ${MAX_KNOWLEDGE_DOCUMENTS} documents per agent.`);
                break;
            }
            setUploading(file.name);
            try {
                const doc = await extractKnowledgeDocument(instituteId, file);
                next = [...next, doc];
                onChange(next);
                if (doc.text.length >= MAX_KNOWLEDGE_CHARS) {
                    toast.warning(
                        `${file.name} is long, so only its first ${MAX_KNOWLEDGE_CHARS.toLocaleString()} characters were kept.`
                    );
                }
            } catch (err) {
                toast.error(agentApiError(err, `Could not read ${file.name}.`));
            }
        }
        setUploading(null);
        if (inputRef.current) inputRef.current.value = '';
    };

    const update = (id: string | undefined, p: Partial<AiAgentKnowledgeDocument>) =>
        onChange(documents.map((d) => (d.id === id ? { ...d, ...p } : d)));

    return (
        <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                    <p className="text-body font-semibold text-neutral-700">Your documents</p>
                    <p className="text-caption text-neutral-500">
                        Brochures, fee structures, FAQs. AI writes the script from them, and the
                        agent keeps them on every call to answer questions, so leave them here
                        after the script is written. PDF, Word (.docx) or text, up to 10 MB each.
                    </p>
                </div>
                <input
                    ref={inputRef}
                    type="file"
                    multiple
                    accept={KNOWLEDGE_ACCEPT}
                    className="hidden"
                    onChange={(e) => void upload(e.target.files)}
                />
                <MyButton
                    type="button"
                    buttonType="secondary"
                    scale="medium"
                    disable={!!uploading || full}
                    onClick={() => inputRef.current?.click()}
                >
                    {uploading ? (
                        <SpinnerGap size={14} className="animate-spin" />
                    ) : (
                        <UploadSimple size={14} />
                    )}
                    {uploading ? 'Reading…' : 'Upload document'}
                </MyButton>
            </div>

            {documents.length > 0 && (
                <ul className="divide-y divide-neutral-100 rounded-lg border border-neutral-200">
                    {documents.map((d) => {
                        const isOpen = openId === d.id;
                        return (
                            <li key={d.id ?? d.name} className="p-2.5">
                                <div className="flex items-center gap-2">
                                    <button
                                        type="button"
                                        className="flex min-w-0 flex-1 items-center gap-2 text-left"
                                        onClick={() => setOpenId(isOpen ? null : d.id ?? null)}
                                        aria-expanded={isOpen}
                                    >
                                        {isOpen ? (
                                            <CaretDown size={14} className="shrink-0 text-neutral-500" />
                                        ) : (
                                            <CaretRight size={14} className="shrink-0 text-neutral-500" />
                                        )}
                                        <FileText size={16} className="shrink-0 text-primary-500" />
                                        <span className="truncate text-body text-neutral-800">
                                            {d.name}
                                        </span>
                                        <span className="shrink-0 text-caption text-neutral-500">
                                            {charsOf(d).toLocaleString()} characters
                                        </span>
                                    </button>
                                    <button
                                        type="button"
                                        className="rounded p-1 text-neutral-500 hover:bg-danger-50 hover:text-danger-600"
                                        title="Remove document"
                                        aria-label={`Remove ${d.name}`}
                                        onClick={() =>
                                            onChange(documents.filter((x) => x.id !== d.id))
                                        }
                                    >
                                        <Trash size={14} />
                                    </button>
                                </div>
                                {isOpen && (
                                    <div className="mt-2 space-y-1">
                                        <Textarea
                                            rows={8}
                                            value={d.text}
                                            onChange={(e) => update(d.id, { text: e.target.value })}
                                        />
                                        <p className="text-caption text-neutral-500">
                                            Trim anything callers will not ask about. Shorter
                                            documents keep the agent quick to reply.
                                        </p>
                                    </div>
                                )}
                            </li>
                        );
                    })}
                </ul>
            )}

            <p className={cn('text-caption', over ? 'text-danger-600' : 'text-neutral-500')}>
                {total.toLocaleString()} / {MAX_KNOWLEDGE_CHARS.toLocaleString()} characters used
                {over && ' — remove a document or shorten the text before saving.'}
            </p>
        </div>
    );
}
