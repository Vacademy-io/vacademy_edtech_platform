import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowSquareOut, Trash, Info } from '@phosphor-icons/react';
import { useContentStore } from '../../-stores/chapter-sidebar-store';
import { useMediaNavigationStore } from '../../-stores/media-navigation-store';
import { useSidebar } from '@/components/ui/sidebar';
import { Doubt as DoubtType } from '../../-types/get-doubts-type';
import { useRouter } from '@tanstack/react-router';
import { FacultyFilterParams } from '@/routes/dashboard/-services/dashboard-services';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import { ShowReplies } from './ShowReplies';
import { DeleteDoubt } from './DeleteDoubt';
import { MarkAsResolved } from './MarkAsResolved';
import { formatISODateTimeReadable } from '@/helpers/formatISOTime';
import { useGetUserBasicDetails } from '@/services/get_user_basic_details';
import { EnrollFormUploadImage } from '@/assets/svgs';
import { getPublicUrl } from '@/services/upload_file';
import { TeacherSelection } from './TeacherSelection';
import { formatTime } from '@/helpers/formatYoutubeVideoTime';
import { getUserId, isUserAdmin, isUserTeacher } from '@/utils/userDetails';
import { useInstituteAssignees } from '@/routes/dashboard/-hooks/useInstituteAssignees';
import { getInstituteId } from '@/constants/helper';

const StatusIndicator = ({ status }: { status: 'RESOLVED' | 'ACTIVE' | 'DELETED' }) => {
    const { t } = useTranslation('studyLibraryHandleAddReply');
    let color = 'bg-neutral-400';
    let text = t('doubt.status.unknown');
    if (status === 'RESOLVED') {
        color = 'bg-green-500';
        text = t('doubt.status.resolved');
    } else if (status === 'ACTIVE') {
        color = 'bg-blue-500';
        text = t('doubt.status.unresolved');
    }

    return (
        <div className="flex items-center gap-1.5">
            <div className={`size-2 rounded-full ${color}`}></div>
            <span className="text-xs font-medium text-neutral-600">{text}</span>
        </div>
    );
};

export const Doubt = ({ doubt, refetch }: { doubt: DoubtType; refetch: () => void }) => {
    const { t } = useTranslation('studyLibraryHandleAddReply');
    const [imageUrl, setImageUrl] = useState<string | null>(null);
    const { activeItem } = useContentStore();
    const { navigateToTimestamp } = useMediaNavigationStore();
    const { setOpen } = useSidebar();
    const router = useRouter();
    const { getPackageSessionId } = useInstituteDetailsStore();
    const userId = getUserId();
    const isAdmin = isUserAdmin();
    const isTeacher = isUserTeacher();
    const { courseId, sessionId, levelId, subjectId } = router.state.location.search;
    const pksId = getPackageSessionId({
        courseId: courseId || '',
        sessionId: sessionId || '',
        levelId: levelId || '',
    });
    const filters: FacultyFilterParams = {
        name: '',
        batches: pksId ? [pksId] : [],
        subjects: subjectId ? [subjectId] : [],
        status: [],
        sort_columns: { name: 'DESC' },
    };

    const { assignees: instituteAssignees } = useInstituteAssignees(getInstituteId());

    const { data: userBasicDetails } = useGetUserBasicDetails([doubt.user_id]);

    const handleTimeStampClick = (timestamp: number) => {
        if (activeItem?.source_type === 'VIDEO') {
            navigateToTimestamp(timestamp, 'VIDEO');
        } else if (activeItem?.source_type === 'DOCUMENT') {
            navigateToTimestamp(timestamp, 'DOCUMENT');
        }
        setOpen(false);
    };

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

    const canMarkAsResolved =
        isAdmin ||
        isTeacher ||
        (userId &&
            doubt.all_doubt_assignee?.some(
                (assignee) => assignee.source === 'USER' && assignee.source_id === userId
            ));

    return (
        <div className="flex flex-col gap-3 rounded-lg border border-neutral-200 bg-white p-4 shadow-sm transition-shadow hover:shadow-md">
            {/* Header Section */}
            <div className="flex w-full items-start justify-between">
                <div className="flex items-center gap-3">
                    <div className="size-9 shrink-0 rounded-full bg-neutral-200">
                        {imageUrl ? (
                            <img
                                src={imageUrl}
                                alt={doubt.name}
                                className="size-full rounded-full object-cover"
                            />
                        ) : (
                            <EnrollFormUploadImage className="size-9 rounded-full object-cover p-1 text-neutral-400" />
                        )}
                    </div>
                    <div>
                        <div className="text-sm font-semibold text-neutral-800">
                            {userBasicDetails?.[0]?.name || t('doubt.anonymousUser')}
                        </div>
                        <p className="text-xs text-neutral-500">
                            {formatISODateTimeReadable(doubt.raised_time)}
                        </p>
                    </div>
                </div>

                <div className="flex flex-col items-end gap-1">
                    <StatusIndicator status={doubt.status as 'RESOLVED' | 'ACTIVE' | 'DELETED'} />
                    {(activeItem?.source_type === 'VIDEO' ||
                        (activeItem?.source_type === 'DOCUMENT' &&
                            activeItem?.document_slide?.type === 'PDF')) && (
                        <div
                            className="flex cursor-pointer items-center gap-1 text-xs text-blue-600 hover:underline"
                            onClick={() => handleTimeStampClick(parseInt(doubt.content_position))}
                        >
                            <span>
                                {activeItem?.source_type === 'VIDEO'
                                    ? t('doubt.timestampLabel', {
                                          time: formatTime(
                                              parseInt(doubt.content_position) / 1000
                                          ),
                                      })
                                    : t('doubt.pageLabel', {
                                          page: parseInt(doubt.content_position) + 1,
                                      })}
                            </span>
                            <ArrowSquareOut size={14} weight="bold" />
                        </div>
                    )}
                </div>
            </div>

            {/* Doubt Content */}
            <div
                dangerouslySetInnerHTML={{ __html: doubt.html_text || '' }}
                className="custom-html-content py-1 text-sm text-neutral-700"
            />

            {/* Actions Bar: MarkAsResolved and DeleteDoubt (if admin) */}
            <div className="mt-2 flex items-center justify-between gap-3 border-b border-neutral-100 pb-3">
                <div>{canMarkAsResolved && <MarkAsResolved doubt={doubt} refetch={refetch} />}</div>
                {isAdmin && <DeleteDoubt doubt={doubt} refetch={refetch} showText={false} />}
            </div>

            {/* Teacher Assignment - now more subtle and integrated */}
            <div className="pt-2">
                <TeacherSelection
                    doubt={doubt}
                    filters={filters}
                    canChange={isAdmin || false}
                    teachersOverride={instituteAssignees}
                />
            </div>

            {/* Replies Section */}
            <div className="mt-1 border-t border-neutral-100 pt-3">
                <ShowReplies parent={doubt} refetch={refetch} />
            </div>
        </div>
    );
};
