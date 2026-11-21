import { lazy, Suspense } from 'react';
const TipTapEditor = lazy(() => import('@/components/tiptap/TipTapEditor').then(module => ({ default: module.TipTapEditor })));
import { useState } from 'react';
import {
    Dialog,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { MyButton } from '@/components/design-system/button';

export type RichTextEditorProps = {
    value: string | null | undefined;
    onChange: (html: string) => void;
    onBlur?: () => void;
    placeholder?: string;
    minHeight?: number | string;
    className?: string;
    enableModalCompose?: boolean;
    modalMinHeight?: number | string;
    /** Hide the toolbar for compact / inline use (e.g. answer options). */
    hideToolbar?: boolean;
    /** Show the toolbar only while this editor is in use, for screens that stack several. */
    toolbarOnFocus?: boolean;
    /** Show a slim, Slack-style toolbar (text formatting + lists + code only). */
    minimalToolbar?: boolean;
    /** Drop the editor chrome so the surrounding card reads as the input. */
    borderless?: boolean;
};

/**
 * RichTextEditor
 *
 * A thin wrapper around TipTapEditor to provide a stable import path and
 * a future place for feature flags without changing call sites.
 */
export function RichTextEditor({
    value,
    onChange,
    onBlur,
    placeholder,
    minHeight,
    className,
    enableModalCompose = false,
    modalMinHeight = 360,
    hideToolbar = false,
    toolbarOnFocus = false,
    minimalToolbar = false,
    borderless = false,
}: RichTextEditorProps) {
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [draft, setDraft] = useState<string>('');
    const safeValue = value ?? '';

    return (
        <div className={`relative w-full min-w-0 overflow-y-auto ${className ?? ''}`.trim()}>
            <Suspense fallback={<div className="h-20 w-full animate-pulse rounded bg-gray-100" />}>
                <TipTapEditor
                    value={safeValue}
                    onChange={onChange}
                    onBlur={onBlur}
                    placeholder={placeholder}
                    minHeight={minHeight ?? 70}
                    hideToolbar={hideToolbar}
                    toolbarOnFocus={toolbarOnFocus}
                    minimalToolbar={minimalToolbar}
                    borderless={borderless}
                />
            </Suspense>
            {enableModalCompose && (
                <MyButton
                    type="button"
                    layoutVariant="icon"
                    buttonType="secondary"
                    scale="small"
                    className="absolute bottom-2 right-2 z-10 rounded-full p-1.5"
                    title="Expand editor"
                    onClick={() => {
                        setDraft(value || '');
                        setIsModalOpen(true);
                    }}
                >
                    ↗
                </MyButton>
            )}

            {enableModalCompose && (
                <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
                    <DialogContent className="flex max-h-[90vh] max-w-[90vw] flex-col">
                        <DialogHeader>
                            <DialogTitle>Compose</DialogTitle>
                        </DialogHeader>
                        <div className="mt-2 min-h-0 flex-1 overflow-auto">
                            <Suspense fallback={<div className="h-64 w-full animate-pulse rounded bg-gray-100" />}>
                                <TipTapEditor
                                    value={draft}
                                    onChange={setDraft}
                                    onBlur={() => { }}
                                    placeholder={placeholder}
                                    minHeight={modalMinHeight}
                                />
                            </Suspense>
                        </div>
                        <DialogFooter className="mt-3 flex shrink-0 justify-end gap-2">
                            <MyButton
                                type="button"
                                buttonType="secondary"
                                onClick={() => setIsModalOpen(false)}
                            >
                                Cancel
                            </MyButton>
                            <MyButton
                                type="button"
                                buttonType="primary"
                                onClick={() => {
                                    onChange(draft);
                                    setIsModalOpen(false);
                                }}
                                disable={!draft.trim()}
                            >
                                Save
                            </MyButton>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>
            )}
        </div>
    );
}

export default RichTextEditor;
