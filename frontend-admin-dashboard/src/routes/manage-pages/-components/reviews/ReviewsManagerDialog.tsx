import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { useReviewManagerStore } from '../../-stores/review-manager-store';
import { ReviewsList } from './ReviewsList';

/**
 * Site reviews moderation inside the Website Builder. Mounted by the sites
 * list and by the site editor; opened from their Reviews buttons and from the
 * Reviews & feedback / Testimonials property panels.
 */
export const ReviewsManagerDialog = () => {
    const { isOpen, close } = useReviewManagerStore();
    return (
        <Dialog open={isOpen} onOpenChange={(o) => !o && close()}>
            {/* The base DialogContent is a fixed 400px card; the list needs the room. */}
            <DialogContent
                className="flex h-5/6 w-11/12 max-w-screen-lg flex-col gap-0 overflow-hidden p-0"
                aria-describedby={undefined}
            >
                <DialogTitle className="sr-only">Reviews</DialogTitle>
                <div className="min-h-0 flex-1 overflow-y-auto bg-neutral-50">{isOpen && <ReviewsList />}</div>
            </DialogContent>
        </Dialog>
    );
};
