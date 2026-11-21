import { Trash } from '@phosphor-icons/react';
import { Doubt } from '../../-types/get-doubts-type';
import { useAddReply } from '../../-services/AddReply';
import { DoubtType } from '../../-types/add-doubt-type';
import { handleAddReply } from '../../-helper/handleAddReply';
import { MyDialog } from '@/components/design-system/dialog';
import { useState } from 'react';
import { MyButton } from '@/components/design-system/button';
import React from 'react';
import { useTranslation } from 'react-i18next';

export const DeleteDoubt = ({
    doubt,
    refetch,
    showText = true,
}: {
    doubt: Doubt;
    refetch: () => void;
    showText?: boolean;
}) => {
    const { t } = useTranslation('studyLibraryHandleAddReply');
    const [isDialogOpen, setIsDialogOpen] = useState(false);
    const addReply = useAddReply();

    const submitReply = async () => {
        const replyData: DoubtType = {
            id: doubt.id,
            user_id: doubt.user_id,
            name: doubt.name,
            source: doubt.source,
            source_id: doubt.source_id,
            raised_time: doubt.raised_time,
            resolved_time: doubt.resolved_time,
            content_position: doubt.content_position,
            content_type: doubt.content_type,
            html_text: doubt.html_text,
            status: 'DELETED',
            parent_id: doubt.parent_id,
            parent_level: doubt.parent_level,
            doubt_assignee_request_user_ids: doubt.doubt_assignee_request_user_ids,
            all_doubt_assignee: doubt.all_doubt_assignee,
            delete_assignee_request: doubt.delete_assignee_request,
        };
        await handleAddReply({ replyData, addReply, refetch, id: doubt.id, t });
        setIsDialogOpen(false);
    };

    return (
        <>
            <div
                className={`flex cursor-pointer items-center gap-1 ${
                    showText
                        ? 'rounded-md p-2 text-danger-500 hover:bg-danger-50 hover:text-danger-600'
                        : 'text-neutral-500 hover:text-danger-500'
                }`}
                onClick={() => setIsDialogOpen(true)}
                data-delete-doubt
            >
                <Trash size={showText ? 18 : 16} />
                {showText && <p className="text-sm font-medium">Delete</p>}
            </div>

            <MyDialog
                open={isDialogOpen}
                onOpenChange={setIsDialogOpen}
                heading="Delete Doubt"
                content={
                    <div className="py-4">
                        <p className="text-sm text-neutral-600">
                            Are you sure you want to delete this doubt? This action cannot be
                            undone.
                        </p>
                    </div>
                }
                footer={
                    <div className="flex justify-end gap-2 pt-2">
                        <MyButton buttonType="secondary" onClick={() => setIsDialogOpen(false)}>
                            Cancel
                        </MyButton>
                        <MyButton
                            buttonType="primary"
                            className="bg-danger-500 text-white hover:bg-danger-600"
                            onClick={submitReply}
                        >
                            Delete
                        </MyButton>
                    </div>
                }
            />
        </>
    );
};
