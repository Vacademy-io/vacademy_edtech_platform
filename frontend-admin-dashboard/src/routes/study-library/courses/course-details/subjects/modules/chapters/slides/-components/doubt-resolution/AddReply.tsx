import { RichTextEditor } from '@/components/editor/RichTextEditor';
import { MyButton } from '@/components/design-system/button';
import { PaperPlaneTilt } from '@phosphor-icons/react';
import { handleAddReply } from '../../-helper/handleAddReply';
import { DoubtType } from '../../-types/add-doubt-type';
import { useContentStore } from '../../-stores/chapter-sidebar-store';
import { useState } from 'react';
import { useAddReply } from '../../-services/AddReply';
import { getUserId, getUserName } from '@/utils/userDetails';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from '@/components/ui/dialog';
import { MyButton as Button } from '@/components/design-system/button';
import { useTranslation } from 'react-i18next';

export const AddReply = ({ parent, refetch }: { parent: DoubtType; refetch: () => void }) => {
    const { t } = useTranslation('studyLibraryHandleAddReply');
    const userId = getUserId();
    const userName = getUserName();
    const { activeItem } = useContentStore();
    const [teacherReply, setTeacherReply] = useState<string>('');
    const addReply = useAddReply();
    const [showComposer, setShowComposer] = useState(false);
    const [composerDraft, setComposerDraft] = useState<string>('');

    const submitReply = async () => {
        if (!teacherReply.trim()) return;

        const replyData: DoubtType = {
            user_id: userId || '',
            name: userName || '',
            source: 'SLIDE',
            source_id: activeItem?.id || '',
            raised_time: new Date().toISOString(),
            resolved_time: null,
            content_position: parent.content_position,
            content_type: (activeItem?.source_type == 'DOCUMENT'
                ? activeItem.document_slide?.type
                : activeItem?.source_type || '') as string,
            html_text: teacherReply,
            status: 'ACTIVE',
            parent_id: parent.id || null,
            parent_level: parent.parent_level + 1,
            doubt_assignee_request_user_ids: parent.doubt_assignee_request_user_ids,
            delete_assignee_request: parent.delete_assignee_request,
            all_doubt_assignee: parent.all_doubt_assignee,
        };
        await handleAddReply({ replyData, addReply, setReply: setTeacherReply, refetch, t });
    };

    return (
        <div className="relative flex w-full items-center gap-2">
            <RichTextEditor
                value={teacherReply}
                onBlur={() => {}}
                onChange={setTeacherReply}
                className="max-h-[150px] min-h-[70px] w-full grow text-sm"
                placeholder="Type your reply..."
            />
            <MyButton
                layoutVariant="icon"
                buttonType="secondary"
                className="absolute bottom-3 right-12 rounded-full p-1.5 shadow-md transition-shadow hover:shadow-lg"
                onClick={() => {
                    setComposerDraft(teacherReply);
                    setShowComposer(true);
                }}
                title="Expand"
            >
                ↗
            </MyButton>
            <MyButton
                layoutVariant="icon"
                buttonType="primary"
                className="absolute bottom-3 right-2 rounded-full p-1.5 shadow-md transition-shadow hover:shadow-lg"
                onClick={submitReply}
                disabled={!teacherReply.trim()}
            >
                <PaperPlaneTilt size={18} weight="fill" />
            </MyButton>

            <Dialog open={showComposer} onOpenChange={setShowComposer}>
                <DialogContent className="max-w-3xl">
                    <DialogHeader>
                        <DialogTitle>Compose Reply</DialogTitle>
                    </DialogHeader>
                    <div className="mt-2">
                        <RichTextEditor
                            value={composerDraft}
                            onChange={setComposerDraft}
                            onBlur={() => {}}
                            placeholder="Write your detailed reply..."
                            minHeight={300}
                            className="h-[60vh]"
                        />
                    </div>
                    <DialogFooter className="mt-3 flex justify-end gap-2">
                        <Button
                            type="button"
                            buttonType="secondary"
                            onClick={() => setShowComposer(false)}
                        >
                            Cancel
                        </Button>
                        <Button
                            type="button"
                            buttonType="primary"
                            onClick={() => {
                                setTeacherReply(composerDraft);
                                setShowComposer(false);
                            }}
                            disable={!composerDraft.trim()}
                        >
                            Save
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
};
