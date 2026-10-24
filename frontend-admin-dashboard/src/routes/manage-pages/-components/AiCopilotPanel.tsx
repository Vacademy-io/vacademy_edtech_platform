/**
 * AI Copilot (Phase B) — conversational editing of the current page.
 * The admin types an instruction; ai_service returns a small list of ops;
 * we apply them to a SHADOW copy and show a plain-language diff card with
 * Apply / Discard. Apply commits via updateConfig (undo-able); nothing
 * touches the page until then.
 */
import React, { useMemo, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
    Sparkle, CircleNotch, PaperPlaneRight, Plus, PencilSimple,
    Trash, ArrowsDownUp, Palette, Check, X, Target, Image as ImageIcon,
} from '@phosphor-icons/react';
import { useToast } from '@/hooks/use-toast';
import { useFileUpload } from '@/hooks/use-file-upload';
import { getPublicUrl } from '@/services/upload_file';
import { getUserId } from '@/utils/userDetails';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import { getTerminology } from '@/components/common/layout-container/sidebar/utils';
import { ContentTerms, RoleTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';
import { useEditorStore } from '../-stores/editor-store';
import {
    editAiPage, applyOps, deriveBrandKit, brandKitToGlobalPatch,
    EditOp, EditChatTurn, BrandKit,
} from '../-services/ai-page-service';
import { CatalogueConfig } from '../-types/editor-types';

/** Representative primary swatch per theme preset (for the kit card dot).
 *  These are preview-only representations of each preset's hue, not UI chrome. */
const PRESET_SWATCH: Record<string, string> = {
    default: '#EA7A1E', ocean: '#0EA5E9', forest: '#22C55E', sunset: '#F97316', // design-lint-ignore: theme-preset preview swatches
    midnight: '#7C3AED', rose: '#E11D6F', violet: '#8B5CF6', amber: '#F59E0B', slate: '#334155', // design-lint-ignore: theme-preset preview swatches
};

interface ChatMessage {
    role: 'user' | 'assistant';
    content: string;
    /** Images the admin attached to this instruction (already on our S3). */
    images?: string[];
}

interface PendingEdit {
    ops: EditOp[];
    shadow: CatalogueConfig;
    warnings: string[];
}

const OP_ICON: Record<EditOp['op'], React.ComponentType<any>> = {
    insert: Plus,
    update: PencilSimple,
    remove: Trash,
    move: ArrowsDownUp,
    updateGlobalSettings: Palette,
};

const opLabel = (op: EditOp): string => {
    if (op.note) return op.note;
    switch (op.op) {
        case 'insert': return `Add a ${op.component.type} section`;
        case 'update': return `Update ${op.id}`;
        case 'remove': return `Remove ${op.id}`;
        case 'move': return `Reorder ${op.id}`;
        case 'updateGlobalSettings': return 'Update site theme';
    }
};

export const AiCopilotPanel = () => {
    const { config, selectedPageId, selectedComponentId, updateConfig } = useEditorStore();
    const { instituteDetails } = useInstituteDetailsStore();
    const { toast } = useToast();

    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [input, setInput] = useState('');
    const [pending, setPending] = useState<PendingEdit | null>(null);
    const [brandKits, setBrandKits] = useState<BrandKit[] | null>(null);
    // Images staged on the composer — sent with the next instruction so the
    // copilot can place them on the page ("use this photo in the hero").
    const [pendingImages, setPendingImages] = useState<string[]>([]);
    const [uploadBusy, setUploadBusy] = useState(false);
    // A file drag is over the panel. dragenter/dragleave also fire for every
    // child element the pointer crosses, so we count depth instead of toggling
    // — otherwise the overlay flickers off the moment the cursor enters a bubble.
    const [dragOver, setDragOver] = useState(false);
    const dragDepth = useRef(0);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const { uploadFile } = useFileUpload();
    const scrollRef = useRef<HTMLDivElement>(null);

    const terminology = useMemo(
        () => ({
            course: getTerminology(ContentTerms.Course, SystemTerms.Course),
            level: getTerminology(ContentTerms.Level, SystemTerms.Level),
            batch: getTerminology(ContentTerms.Batch, SystemTerms.Batch),
            learner: getTerminology(RoleTerms.Learner, SystemTerms.Learner),
        }),
        []
    );

    const selectedComponent = useMemo(() => {
        if (!selectedComponentId || !config) return null;
        const page = config.pages.find((p) => p.id === selectedPageId);
        return page?.components.find((c) => c.id === selectedComponentId) || null;
    }, [config, selectedPageId, selectedComponentId]);

    const scrollToEnd = () => {
        requestAnimationFrame(() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight }));
    };

    const editMutation = useMutation({
        mutationFn: ({ instruction, images }: { instruction: string; images: string[] }) => {
            const page = config!.pages.find((p) => p.id === selectedPageId)!;
            const history: EditChatTurn[] = messages.slice(-6).map((m) => ({ role: m.role, content: m.content }));
            return editAiPage({
                page: { id: page.id, components: page.components },
                instruction,
                selected_component_id: selectedComponentId || undefined,
                institute_name: (instituteDetails as any)?.institute_name || undefined,
                terminology,
                history,
                images: images.map((url) => ({ url, kind: 'photo' as const })),
            });
        },
        onSuccess: (res) => {
            setMessages((m) => [...m, { role: 'assistant', content: res.reply || 'Done.' }]);
            if (res.ops.length && config && selectedPageId) {
                setPending({ ops: res.ops, shadow: applyOps(config, selectedPageId, res.ops), warnings: res.warnings });
            } else {
                setPending(null);
            }
            scrollToEnd();
        },
        onError: (err: any) => {
            const detail = err?.response?.data?.detail;
            setMessages((m) => [...m, { role: 'assistant', content: typeof detail === 'string' ? detail : 'Something went wrong — please try again.' }]);
            scrollToEnd();
        },
    });

    const send = () => {
        const text = input.trim() || (pendingImages.length ? 'Place the attached image(s) where they fit best on this page.' : '');
        if (!text || !config || !selectedPageId || editMutation.isPending) return;
        const images = pendingImages;
        setMessages((m) => [...m, { role: 'user', content: text, ...(images.length ? { images } : {}) }]);
        setInput('');
        setPendingImages([]);
        setPending(null);
        setBrandKits(null);
        editMutation.mutate({ instruction: text, images });
        scrollToEnd();
    };

    // One upload path for all three ways an image arrives — the file picker, a
    // drag-and-drop, and a pasted screenshot. Stages EVERY image for the next
    // send (admins share several screenshots at once; forcing one-by-one
    // uploads was the field complaint).
    const uploadImages = async (files: File[]) => {
        const images = files.filter((f) => f.type.startsWith('image/'));
        if (images.length === 0) {
            if (files.length > 0) {
                toast({
                    title: 'Images only',
                    description:
                        'Drop a PNG, JPG or screenshot — other files are not supported here.',
                    variant: 'destructive',
                });
            }
            return;
        }
        const userId = getUserId();
        if (!userId) return;
        try {
            setUploadBusy(true);
            for (const file of images) {
                const fileId = await uploadFile({
                    file,
                    setIsUploading: () => {},
                    userId,
                    source: 'CATALOGUE_IMAGES',
                    sourceId: 'ADMIN',
                    publicUrl: true,
                });
                if (fileId) {
                    const url = (await getPublicUrl(fileId)) || fileId;
                    setPendingImages((p) => (p.includes(url) ? p : [...p, url]));
                }
            }
        } catch {
            toast({ title: 'Upload failed', description: 'Some images may not have uploaded — please retry.', variant: 'destructive' });
        } finally {
            setUploadBusy(false);
        }
    };

    const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
        await uploadImages(Array.from(e.target.files || []));
        if (fileInputRef.current) fileInputRef.current.value = '';
    };

    /** Only OS file drags open the drop zone — dnd-kit's component drags are
     *  pointer-based and never set a `Files` type, so they pass through. */
    const isFileDrag = (e: React.DragEvent) =>
        Array.from(e.dataTransfer?.types || []).includes('Files');

    const handleDragEnter = (e: React.DragEvent) => {
        if (!isFileDrag(e)) return;
        e.preventDefault();
        dragDepth.current += 1;
        setDragOver(true);
    };

    const handleDragOver = (e: React.DragEvent) => {
        if (!isFileDrag(e)) return;
        // Without this the browser navigates away to the dropped file.
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
    };

    const handleDragLeave = (e: React.DragEvent) => {
        if (!isFileDrag(e)) return;
        dragDepth.current = Math.max(0, dragDepth.current - 1);
        if (dragDepth.current === 0) setDragOver(false);
    };

    const handleDrop = (e: React.DragEvent) => {
        if (!isFileDrag(e)) return;
        e.preventDefault();
        dragDepth.current = 0;
        setDragOver(false);
        void uploadImages(Array.from(e.dataTransfer.files || []));
    };

    /** ⌘V straight from a screenshot — the fastest path, and the one admins
     *  reach for first. Text pastes are left alone. */
    const handlePaste = (e: React.ClipboardEvent) => {
        const files = Array.from(e.clipboardData?.files || []).filter((f) =>
            f.type.startsWith('image/')
        );
        if (files.length === 0) return;
        e.preventDefault();
        void uploadImages(files);
    };

    const brandMutation = useMutation({
        mutationFn: () =>
            deriveBrandKit({
                institute_name: (instituteDetails as any)?.institute_name || undefined,
                brief: `Catalogue website for ${(instituteDetails as any)?.institute_name || 'an institute'}`,
            }),
        onSuccess: (res) => {
            setBrandKits(res.kits);
            setMessages((m) => [...m, { role: 'assistant', content: 'Here are a few theme directions — pick one to preview it.' }]);
            scrollToEnd();
        },
        onError: (err: any) => {
            const detail = err?.response?.data?.detail;
            setMessages((m) => [...m, { role: 'assistant', content: typeof detail === 'string' ? detail : 'Could not fetch theme ideas.' }]);
            scrollToEnd();
        },
    });

    const pickKit = (kit: BrandKit) => {
        if (!config || !selectedPageId) return;
        const op: EditOp = { op: 'updateGlobalSettings', patch: brandKitToGlobalPatch(kit), note: `Apply theme: ${kit.label}` };
        setPending({ ops: [op], shadow: applyOps(config, selectedPageId, [op]), warnings: [] });
        setBrandKits(null);
        scrollToEnd();
    };

    const applyPending = () => {
        if (!pending) return;
        updateConfig(pending.shadow);
        setMessages((m) => [...m, { role: 'assistant', content: '✓ Applied to your page.' }]);
        setPending(null);
        scrollToEnd();
    };

    if (!config || !selectedPageId) {
        return <div className="p-4 text-sm text-gray-400">Select a page to start editing with AI.</div>;
    }

    return (
        <div
            className="relative flex min-h-0 flex-1 flex-col"
            onDragEnter={handleDragEnter}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
        >
            {/* Drop zone — covers the whole panel so an admin can fling a
                screenshot anywhere on it, not just onto the composer. */}
            {dragOver && (
                <div className="pointer-events-none absolute inset-2 z-20 flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-primary-400 bg-primary-50 text-center">
                    <ImageIcon className="size-7 text-primary-600" weight="duotone" />
                    <p className="text-sm font-semibold text-gray-800">Drop to attach</p>
                    <p className="px-4 text-caption text-gray-600">
                        Screenshots, PNG or JPG — they are uploaded and staged for your next
                        instruction.
                    </p>
                </div>
            )}

            {/* Thread */}
            <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto p-3">
                {messages.length === 0 && (
                    <div className="rounded-lg border border-dashed border-gray-200 p-3 text-xs text-gray-500">
                        <p className="mb-1 flex items-center gap-1 font-medium text-gray-700">
                            <Sparkle className="size-3.5 text-primary-500" weight="duotone" /> Ask AI to edit this page
                        </p>
                        <p>Try: “make the hero darker”, “add a testimonials section after the courses”, “rewrite the FAQ answers to be friendlier”.</p>
                    </div>
                )}
                {messages.map((m, i) => (
                    <div key={i} className={m.role === 'user' ? 'text-right' : 'text-left'}>
                        <span
                            className={`inline-block max-w-64 rounded-lg px-3 py-2 text-xs ${
                                m.role === 'user' ? 'bg-primary-500 text-white' : 'bg-gray-100 text-gray-800'
                            }`}
                        >
                            {m.content}
                            {m.images && m.images.length > 0 && (
                                <span className="mt-1.5 flex gap-1.5">
                                    {m.images.map((u, j) => (
                                        <img key={j} src={u} alt="" className="size-12 rounded object-cover" />
                                    ))}
                                </span>
                            )}
                        </span>
                    </div>
                ))}
                {(editMutation.isPending || brandMutation.isPending) && (
                    <div className="flex items-center gap-2 text-xs text-gray-400">
                        <CircleNotch className="size-4 animate-spin" /> Thinking…
                    </div>
                )}

                {/* Brand kit cards */}
                {brandKits && (
                    <div className="space-y-2">
                        {brandKits.map((kit, i) => (
                            <button
                                key={i}
                                onClick={() => pickKit(kit)}
                                className="flex w-full items-start gap-2.5 rounded-lg border border-gray-200 bg-white p-2.5 text-left transition-colors hover:border-primary-300 hover:bg-primary-50"
                            >
                                <span
                                    className="mt-0.5 size-6 shrink-0 rounded-full border border-black/5"
                                    style={{ backgroundColor: PRESET_SWATCH[kit.themePreset] || '#999' /* design-lint-ignore: preset swatch preview */ }}
                                />
                                <span className="min-w-0">
                                    <span className="block text-xs font-semibold text-gray-800">{kit.label}</span>
                                    <span className="block text-caption text-gray-500">
                                        {kit.fontFamily} · {kit.atmosphere.canvas}
                                    </span>
                                    <span className="mt-0.5 block text-caption text-gray-400">{kit.rationale}</span>
                                </span>
                            </button>
                        ))}
                    </div>
                )}

                {/* Diff card */}
                {pending && (
                    <div className="rounded-lg border border-primary-200 bg-primary-50 p-3">
                        <p className="mb-2 text-xs font-semibold text-primary-600">Proposed changes</p>
                        <ul className="space-y-1.5">
                            {pending.ops.map((op, i) => {
                                const Icon = OP_ICON[op.op];
                                return (
                                    <li key={i} className="flex items-start gap-2 text-xs text-gray-700">
                                        <Icon className="mt-0.5 size-3.5 shrink-0 text-primary-500" />
                                        <span>{opLabel(op)}</span>
                                    </li>
                                );
                            })}
                        </ul>
                        {pending.warnings.length > 0 && (
                            <p className="mt-2 text-caption text-warning-600">
                                {pending.warnings.length} item(s) were auto-cleaned.
                            </p>
                        )}
                        <div className="mt-3 flex gap-2">
                            <Button size="sm" onClick={applyPending} className="h-7">
                                <Check className="mr-1 size-3.5" /> Apply
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => setPending(null)} className="h-7">
                                <X className="mr-1 size-3.5" /> Discard
                            </Button>
                        </div>
                    </div>
                )}
            </div>

            {/* Composer */}
            <div className="shrink-0 border-t p-3">
                <div className="mb-2 flex items-center justify-between">
                    {selectedComponent ? (
                        <div className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-caption text-gray-600">
                            <Target className="size-3" /> editing: {selectedComponent.type}
                        </div>
                    ) : <span />}
                    <button
                        onClick={() => brandMutation.mutate()}
                        disabled={brandMutation.isPending}
                        className="inline-flex items-center gap-1 text-caption font-medium text-primary-500 hover:text-primary-400 disabled:opacity-50"
                    >
                        <Palette className="size-3" /> Theme ideas
                    </button>
                </div>
                {pendingImages.length > 0 && (
                    <div className="mb-2 flex flex-wrap gap-1.5">
                        {pendingImages.map((u, i) => (
                            <div key={i} className="relative">
                                <img src={u} alt="" className="size-12 rounded border border-gray-200 object-cover" />
                                <button
                                    onClick={() => setPendingImages((p) => p.filter((x) => x !== u))}
                                    className="absolute -right-1.5 -top-1.5 rounded-full bg-danger-500 p-0.5 text-white"
                                >
                                    <X className="size-3" />
                                </button>
                            </div>
                        ))}
                    </div>
                )}
                <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    multiple
                    className="hidden"
                    onChange={handleFile}
                />
                {/* Textarea on its own row: in a 320px rail the old single-row
                    layout squeezed the send button off the edge, so the only way
                    to submit was a keyboard Enter nobody could see. */}
                <Textarea
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onPaste={handlePaste}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            send();
                        }
                    }}
                    rows={2}
                    placeholder={
                        pendingImages.length
                            ? 'Where should these images go?'
                            : 'Describe a change…'
                    }
                    className="w-full resize-none text-xs"
                />
                <div className="mt-2 flex items-center gap-2">
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="size-8 shrink-0 p-0"
                        title="Attach an image — you can also drag one in or paste with ⌘V"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={uploadBusy}
                    >
                        {uploadBusy ? (
                            <CircleNotch className="size-4 animate-spin" />
                        ) : (
                            <ImageIcon className="size-4" />
                        )}
                    </Button>
                    <span className="min-w-0 flex-1 truncate text-caption text-gray-500">
                        {uploadBusy
                            ? 'Uploading…'
                            : pendingImages.length
                              ? `${pendingImages.length} attached`
                              : 'Enter to send'}
                    </span>
                    <Button
                        size="sm"
                        onClick={send}
                        disabled={
                            (!input.trim() && pendingImages.length === 0) || editMutation.isPending
                        }
                        className="h-8 shrink-0 px-3"
                    >
                        {editMutation.isPending ? (
                            <CircleNotch className="size-4 animate-spin" />
                        ) : (
                            <PaperPlaneRight className="size-4" />
                        )}
                        Send
                    </Button>
                </div>
                <p className="mt-1.5 text-caption text-gray-500">
                    Drag an image in, or paste one with ⌘V.
                </p>
            </div>
        </div>
    );
};
