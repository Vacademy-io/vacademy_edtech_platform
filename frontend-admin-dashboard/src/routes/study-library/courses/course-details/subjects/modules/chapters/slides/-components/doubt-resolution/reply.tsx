import { Doubt } from '../../-types/get-doubts-type';
import { DeleteDoubt } from './DeleteDoubt';
import { formatISODateTimeReadable } from '@/helpers/formatISOTime';
import { useGetUserBasicDetails } from '@/services/get_user_basic_details';
import { getPublicUrl } from '@/services/upload_file';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { EnrollFormUploadImage } from '@/assets/svgs';
import { getUserId } from '@/utils/userDetails';
import { Trash } from '@phosphor-icons/react';

export const Reply = ({ reply, refetch }: { reply: Doubt; refetch: () => void }) => {
    const { t } = useTranslation('studyLibraryReply');
    const [imageUrl, setImageUrl] = useState<string | null>(null);
    const userId = getUserId();

    const { data: userBasicDetails } = useGetUserBasicDetails([reply.user_id]);
    useEffect(() => {
        const fetchImageUrl = async () => {
            if (userBasicDetails?.[0]?.face_file_id) {
                try {
                    const url = await getPublicUrl(userBasicDetails?.[0]?.face_file_id);
                    setImageUrl(url);
                } catch (error) {
                    console.error('Failed to fetch image URL:', error);
                }
            }
        };

        fetchImageUrl();
    }, [userBasicDetails?.[0]?.face_file_id]);

    return (
        <div className="flex flex-col gap-2 rounded-md bg-neutral-50 p-3">
            <div className="flex items-start justify-between">
                <div className="flex items-center gap-2">
                    <div className="size-7 shrink-0 rounded-full bg-neutral-200">
                        {imageUrl ? (
                            <img
                                src={imageUrl}
                                alt={reply.name}
                                className="size-full rounded-full object-cover"
                            />
                        ) : (
                            <EnrollFormUploadImage className="size-7 rounded-full object-cover p-0.5 text-neutral-400" />
                        )}
                    </div>
                    <div>
                        <p className="text-xs font-semibold text-neutral-700">
                            {userBasicDetails?.[0]?.name || t('anonymousUser')}
                        </p>
                        <p className="text-xs text-neutral-500">
                            {formatISODateTimeReadable(reply.raised_time)}
                        </p>
                    </div>
                </div>
                {/* Render DeleteDoubt more subtly if the user is the author of the reply */}
                {reply.user_id === userId && (
                    <DeleteDoubt doubt={reply} refetch={refetch} showText={false} />
                )}
            </div>

            <div
                dangerouslySetInnerHTML={{
                    __html: reply.html_text || '',
                }}
                className="custom-html-content pl-[36px] text-sm text-neutral-700" // Indent reply content
            />
        </div>
    );
};
