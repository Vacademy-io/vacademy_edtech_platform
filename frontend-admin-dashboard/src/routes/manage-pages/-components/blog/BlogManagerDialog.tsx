import { useRef } from 'react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { useBlogManagerStore } from '../../-stores/blog-manager-store';
import { BlogPostsList } from './BlogPostsList';
import { BlogPostEditor } from './BlogPostEditor';

/**
 * The whole blog workflow — list, write, publish — inside the Website Builder.
 * Mounted by the sites list and by the site editor; opened from the toolbar
 * Blog button, from a Blog section's property panel, or by a deep link
 * (`/manage-pages?blog=<postId>`, what the MCP tools hand out).
 */
export const BlogManagerDialog = () => {
    const { isOpen, postId, open, showList, close } = useBlogManagerStore();
    // Set by the editor; closing the dialog with unsaved changes asks first,
    // the same way the editor's own back button does.
    const dirtyRef = useRef(false);

    const requestClose = () => {
        if (dirtyRef.current && !window.confirm('Discard unsaved changes?')) return;
        dirtyRef.current = false;
        close();
    };

    return (
        <Dialog open={isOpen} onOpenChange={(o) => !o && requestClose()}>
            {/* The base DialogContent is a fixed 400px card; without the width override
                the editor's 340px meta rail lands on top of the title and body. */}
            <DialogContent
                className="flex h-[92vh] w-[96vw] max-w-screen-xl flex-col gap-0 overflow-hidden p-0"
                onInteractOutside={(e) => e.preventDefault()}
                aria-describedby={undefined}
            >
                <DialogTitle className="sr-only">Blog posts</DialogTitle>
                <div className="min-h-0 flex-1 overflow-y-auto bg-neutral-50">
                    {postId ? (
                        <BlogPostEditor
                            key={postId}
                            postId={postId}
                            onBack={showList}
                            onCreated={(id) => open(id)}
                            onDirtyChange={(d) => {
                                dirtyRef.current = d;
                            }}
                        />
                    ) : (
                        <BlogPostsList onOpenPost={open} />
                    )}
                </div>
            </DialogContent>
        </Dialog>
    );
};
