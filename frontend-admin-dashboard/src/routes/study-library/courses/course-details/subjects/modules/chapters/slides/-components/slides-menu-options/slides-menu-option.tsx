import { MyButton } from '@/components/design-system/button';
import { MyDropdown } from '@/components/design-system/dropdown';
import { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { getSlidesMenuOptions } from '@/routes/study-library/courses/course-details/subjects/modules/chapters/slides/-constants/slides-menu-options';
import { DotsThree } from '@phosphor-icons/react';
import { CopyToDialog } from './copy-dialog';
import { MoveToDialog } from './move-dialog';
import { DeleteDialog } from './delete-dialog';
import { useContentStore } from '../../-stores/chapter-sidebar-store';
import { useRouter } from '@tanstack/react-router';
import { SlideDripConditionDialog } from '@/routes/study-library/courses/course-details/-components/SlideDripConditionDialog';
import { OfflineAvailabilityDialog } from '@/routes/study-library/courses/course-details/-components/OfflineAvailabilityDialog';
import { getCourseSettings, saveCourseSettings } from '@/services/course-settings';
import type { DripCondition } from '@/types/course-settings';
import { toast } from 'sonner';
import type { DropdownItem } from '@/components/design-system/utils/types/dropdown-types';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import { useOfflineAccessEnabled } from '@/routes/settings/-hooks/use-offline-access-enabled';

export const SlidesMenuOption = ({
    extraOptions = [],
    onExtraSelect,
}: {
    /**
     * Occasional-use actions relocated from the header (Activity Stats,
     * History, Export…) — prepended above the base copy/move/delete options.
     */
    extraOptions?: DropdownItem[];
    onExtraSelect?: (value: string) => void;
} = {}) => {
    const { t } = useTranslation('studyLibrarySlidesMenuOption');
    const [openDialog, setOpenDialog] = useState<
        'copy' | 'move' | 'delete' | 'drip-conditions' | 'offline-availability' | null
    >(null);
    const [dripConditions, setDripConditions] = useState<DripCondition[]>([]);
    const [loadingDripConditions, setLoadingDripConditions] = useState(false);
    const [dripConditionsEnabled, setDripConditionsEnabled] = useState(true);
    const offlineAccessEnabled = useOfflineAccessEnabled();

    const { activeItem, items } = useContentStore();
    const router = useRouter();
    const searchParams = router.state.location.search;
    const courseId: string = searchParams.courseId || '';
    const slideId: string = activeItem?.id || '';
    const slideName: string = activeItem?.title || t('slide');
    const { getPackageSessionId } = useInstituteDetailsStore();
    const packageSessionId =
        getPackageSessionId({
            courseId,
            sessionId: searchParams.sessionId || '',
            levelId: searchParams.levelId || '',
        }) || '';

    // Get all slides in the current chapter for prerequisite selection
    const allSlides = items.map((slide) => ({
        id: slide.id,
        heading: slide.title || t('untitledSlide'),
    }));

    // Load course settings to check if drip conditions are enabled
    useEffect(() => {
        const loadDripConditionsSettings = async () => {
            try {
                const settings = await getCourseSettings();
                setDripConditionsEnabled(settings.dripConditions?.enabled !== false);
            } catch (error) {
                console.error('Failed to load drip conditions settings:', error);
                // Default to true on error
                setDripConditionsEnabled(true);
            }
        };
        loadDripConditionsSettings();
    }, []);

    // Filter menu options by the settings that gate them: drip conditions by the
    // course setting, Offline Availability by the institute OFFLINE_ACCESS_SETTING
    // master switch (with it off the resolver denies every node, so a slide rule
    // saved here could never take effect).
    const menuOptions = useMemo<DropdownItem[]>(() => {
        const filtered = getSlidesMenuOptions(t).filter((item) => {
            if (item.value === 'drip-conditions') return dripConditionsEnabled;
            if (item.value === 'offline-availability') return offlineAccessEnabled;
            return true;
        });
        return [...extraOptions, ...filtered];
    }, [dripConditionsEnabled, offlineAccessEnabled, extraOptions, t]);

    const handleSelect = async (value: string) => {
        switch (value) {
            case 'copy':
                setOpenDialog('copy');
                break;
            case 'move':
                setOpenDialog('move');
                break;
            case 'delete':
                setOpenDialog('delete');
                break;
            case 'drip-conditions':
                await loadDripConditions();
                setOpenDialog('drip-conditions');
                break;
            case 'offline-availability':
                setOpenDialog('offline-availability');
                break;
            default:
                // Relocated header actions (activity-stats / history / export…)
                onExtraSelect?.(value);
        }
    };

    const loadDripConditions = async () => {
        try {
            setLoadingDripConditions(true);
            const settings = await getCourseSettings();
            setDripConditions(settings.dripConditions.conditions || []);
        } catch (error) {
            console.error('Failed to load drip conditions:', error);
            toast.error(t('loadDripConditionsFailed'));
            setDripConditions([]);
        } finally {
            setLoadingDripConditions(false);
        }
    };

    const handleSaveDripConditions = async (updatedConditions: DripCondition[]) => {
        try {
            const settings = await getCourseSettings();
            const updatedSettings = {
                ...settings,
                dripConditions: {
                    ...settings.dripConditions,
                    conditions: updatedConditions,
                },
            };
            await saveCourseSettings(updatedSettings);
            setDripConditions(updatedConditions);
            toast.success(t('dripConditionsSaved'));
        } catch (error) {
            console.error('Failed to save drip conditions:', error);
            toast.error(t('saveDripConditionsFailed'));
            throw error;
        }
    };

    return (
        <>
            {menuOptions.length > 0 && (
                <MyDropdown dropdownList={menuOptions} onSelect={handleSelect}>
                    <MyButton buttonType="secondary" scale="large" layoutVariant="icon">
                        <DotsThree />
                    </MyButton>
                </MyDropdown>
            )}

            {/* Copy Dialog */}
            <CopyToDialog openDialog={openDialog} setOpenDialog={setOpenDialog} />

            {/* Move Dialog */}
            <MoveToDialog openDialog={openDialog} setOpenDialog={setOpenDialog} />

            {/* Delete Dialog */}
            <DeleteDialog openDialog={openDialog} setOpenDialog={setOpenDialog} />

            {/* Drip Conditions Dialog */}
            {!loadingDripConditions && (
                <SlideDripConditionDialog
                    open={openDialog === 'drip-conditions'}
                    onClose={() => setOpenDialog(null)}
                    slideId={slideId}
                    slideName={slideName}
                    packageId={courseId}
                    dripConditions={dripConditions}
                    onSave={handleSaveDripConditions}
                    allSlides={allSlides}
                />
            )}

            {/* Offline Availability Dialog */}
            {packageSessionId && (
                <OfflineAvailabilityDialog
                    open={openDialog === 'offline-availability'}
                    onClose={() => setOpenDialog(null)}
                    sourceType="SLIDE"
                    sourceId={slideId}
                    packageSessionId={packageSessionId}
                    nodeName={slideName}
                />
            )}
        </>
    );
};
