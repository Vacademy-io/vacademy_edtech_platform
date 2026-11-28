import { useQuery } from '@tanstack/react-query';
import { Info } from '@phosphor-icons/react';

import { Checkbox } from '@/components/ui/checkbox';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { ASSESSMENT_LINKED_SLIDES_URL } from '@/constants/urls';
import { getTerminology } from '@/components/common/layout-container/sidebar/utils';
import { ContentTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';

/**
 * An assessment created from a course slide exists in two halves: the assessment
 * itself (assessment_service) and the slide that launches it (admin_core). They
 * live in separate databases, so nothing deletes the other automatically —
 * delete one and the other is stranded, either a slide that can never open or an
 * assessment nobody can reach.
 *
 * This module is the shared half of the fix: look up the link, show the admin
 * what the cascade will take, and delete the slide side on request. Both delete
 * dialogs (Assessments tab and the course slide menu) use it so the two
 * directions behave identically.
 */
export interface LinkedAssessmentSlide {
    slide_id: string;
    slide_title: string | null;
    chapter_id: string | null;
    chapter_name: string | null;
}

export const getLinkedAssessmentSlides = async (
    assessmentId: string
): Promise<LinkedAssessmentSlide[]> => {
    const response = await authenticatedAxiosInstance({
        method: 'GET',
        url: ASSESSMENT_LINKED_SLIDES_URL,
        params: { assessmentId },
    });
    return response?.data ?? [];
};

/** @returns how many slides were deleted */
export const deleteLinkedAssessmentSlides = async (assessmentId: string): Promise<number> => {
    const response = await authenticatedAxiosInstance({
        method: 'DELETE',
        url: ASSESSMENT_LINKED_SLIDES_URL,
        params: { assessmentId },
    });
    return response?.data ?? 0;
};

/**
 * The course slides that launch this assessment. Kept out of the render path's
 * way — an assessment with no slides resolves to an empty list and every
 * consumer then renders exactly what it rendered before this feature.
 */
export const useLinkedAssessmentSlides = (assessmentId: string | undefined) =>
    useQuery<LinkedAssessmentSlide[]>({
        queryKey: ['ASSESSMENT_LINKED_SLIDES', assessmentId],
        queryFn: () => getLinkedAssessmentSlides(assessmentId as string),
        enabled: Boolean(assessmentId),
        staleTime: 30 * 1000,
    });

interface AssessmentSlideCascadeOptionProps {
    linkedSlides: LinkedAssessmentSlide[];
    checked: boolean;
    onCheckedChange: (checked: boolean) => void;
    isLoading?: boolean;
}

/**
 * Opt-out (default on) for removing the linked course slides alongside the
 * assessment. Renders nothing when the assessment isn't used in any course, so
 * the ordinary delete dialog is untouched.
 */
export const AssessmentSlideCascadeOption = ({
    linkedSlides,
    checked,
    onCheckedChange,
    isLoading,
}: AssessmentSlideCascadeOptionProps) => {
    if (isLoading || linkedSlides.length === 0) return null;

    const count = linkedSlides.length;
    const chapters = Array.from(
        new Set(linkedSlides.map((slide) => slide.chapter_name).filter(Boolean))
    ) as string[];

    return (
        <div className="flex flex-col gap-2 rounded-md border border-warning-200 bg-warning-50 p-3">
            <div className="flex items-start gap-2">
                <Checkbox
                    id="delete-linked-slides"
                    checked={checked}
                    onCheckedChange={(value) => onCheckedChange(value === true)}
                    className="mt-0.5"
                />
                <label htmlFor="delete-linked-slides" className="cursor-pointer text-sm">
                    Also delete{' '}
                    <span className="font-semibold">
                        {count}{' '}
                        {getTerminology(
                            ContentTerms.Course,
                            SystemTerms.Course
                        ).toLocaleLowerCase()}{' '}
                        {count === 1 ? 'slide' : 'slides'}
                    </span>{' '}
                    that {count === 1 ? 'launches' : 'launch'} this assessment
                </label>
            </div>
            {chapters.length > 0 && (
                <p className="ps-6 text-caption text-neutral-500">In {chapters.join(', ')}</p>
            )}
            {!checked && (
                <p className="flex items-start gap-1.5 ps-6 text-caption text-warning-700">
                    <Info size={14} className="mt-0.5 shrink-0" />
                    Learners will keep seeing{' '}
                    {count === 1 ? 'this slide, but it' : 'these slides, but they'} will no longer
                    open.
                </p>
            )}
        </div>
    );
};
