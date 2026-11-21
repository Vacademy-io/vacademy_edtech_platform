import { Switch } from '@/components/ui/switch';
import { Doubt } from '../../-types/get-doubts-type';
import { useEffect, useState } from 'react';
import { DoubtType } from '../../-types/add-doubt-type';
import { useAddReply } from '../../-services/AddReply';
import { handleAddReply } from '../../-helper/handleAddReply';
import { useTranslation } from 'react-i18next';

export const MarkAsResolved = ({ doubt, refetch }: { doubt: Doubt; refetch: () => void }) => {
    const { t } = useTranslation('studyLibraryHandleAddReply');
    const [resolved, setResolved] = useState(doubt.status === 'RESOLVED');
    const addReply = useAddReply();

    useEffect(() => {
        setResolved(doubt.status === 'RESOLVED');
    }, [doubt.status]);

    const handleDoubtResolve = async () => {
        const newResolvedStatus = !resolved;
        setResolved(newResolvedStatus);
        const replyData: DoubtType = {
            id: doubt.id,
            user_id: doubt.user_id,
            name: doubt.name,
            source: doubt.source,
            source_id: doubt.source_id,
            raised_time: doubt.raised_time,
            resolved_time: newResolvedStatus ? new Date().toISOString() : null,
            content_position: doubt.content_position,
            content_type: doubt.content_type,
            html_text: doubt.html_text,
            status: newResolvedStatus ? 'RESOLVED' : 'ACTIVE',
            parent_id: doubt.parent_id,
            parent_level: doubt.parent_level,
            doubt_assignee_request_user_ids: doubt.doubt_assignee_request_user_ids,
            all_doubt_assignee: doubt.all_doubt_assignee,
            delete_assignee_request: doubt.delete_assignee_request,
        };
        await handleAddReply({ replyData, addReply, refetch, id: doubt.id, t });
    };

    return (
        <div className="flex items-center gap-2">
            <Switch
                id={`mark-resolved-${doubt.id}`}
                checked={resolved}
                onCheckedChange={handleDoubtResolve}
                className="scale-90 data-[state=checked]:bg-green-600 data-[state=unchecked]:bg-neutral-300"
            />
            <label
                htmlFor={`mark-resolved-${doubt.id}`}
                className="cursor-pointer select-none text-xs font-medium text-neutral-700 hover:text-neutral-900"
            >
                {resolved ? 'Resolved' : 'Mark as Resolved'}
            </label>
        </div>
    );
};
