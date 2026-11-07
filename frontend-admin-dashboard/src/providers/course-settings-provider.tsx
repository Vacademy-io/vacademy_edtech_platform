import React, {
    createContext,
    useContext,
    useState,
    useEffect,
    ReactNode,
    useCallback,
} from 'react';
import {
    getCourseSettings,
    mergeWithDefaults,
    clearCourseSettingsCache,
} from '@/services/course-settings';
import { CourseSettingsData, DEFAULT_COURSE_SETTINGS } from '@/types/course-settings';
import { getTerminology } from '@/components/common/layout-container/sidebar/utils';
import { ContentTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';

interface CourseSettingsContextType {
    settings: CourseSettingsData;
    loading: boolean;
    error: string | null;
    refreshSettings: () => Promise<void>; // Function to force refresh from API
    clearCache: () => void; // Function to clear localStorage cache
    // Helper methods for easier access
    courseInformation: CourseSettingsData['courseInformation'];
    courseStructure: CourseSettingsData['courseStructure'];
    catalogueSettings: CourseSettingsData['catalogueSettings'];
    courseViewSettings: CourseSettingsData['courseViewSettings'];
    outlineSettings: CourseSettingsData['outlineSettings'];
    permissions: CourseSettingsData['permissions'];
    enrollmentNotifications: CourseSettingsData['enrollmentNotifications'];
}

const CourseSettingsContext = createContext<CourseSettingsContextType | undefined>(undefined);

interface CourseSettingsProviderProps {
    children: ReactNode;
}

export const CourseSettingsProvider: React.FC<CourseSettingsProviderProps> = ({ children }) => {
    const [settings, setSettings] = useState<CourseSettingsData>(DEFAULT_COURSE_SETTINGS);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const loadSettings = useCallback(async (forceRefresh = false) => {
        try {
            setLoading(true);
            setError(null);

            // Use the updated getCourseSettings with caching
            const courseSettings = await getCourseSettings(forceRefresh);
            const mergedSettings = mergeWithDefaults(courseSettings);
            setSettings(mergedSettings);
        } catch (err) {
            console.error('Error loading course settings:', err);
            setError(
                `Failed to load ${getTerminology(ContentTerms.Course, SystemTerms.Course).toLocaleLowerCase()} settings`
            );
            // Use default settings as fallback
            setSettings(DEFAULT_COURSE_SETTINGS);
        } finally {
            setLoading(false);
        }
    }, []);

    const refreshSettings = useCallback(async () => {
        await loadSettings(true); // Force refresh from API
    }, [loadSettings]);

    const clearCache = useCallback(() => {
        clearCourseSettingsCache();
    }, []);

    useEffect(() => {
        // Load settings on mount (will use cache if available)
        loadSettings(false);
    }, [loadSettings]);

    const contextValue: CourseSettingsContextType = {
        settings,
        loading,
        error,
        refreshSettings,
        clearCache,
        // Helper methods for easier access
        courseInformation: settings.courseInformation,
        courseStructure: settings.courseStructure,
        catalogueSettings: settings.catalogueSettings,
        courseViewSettings: settings.courseViewSettings,
        outlineSettings: settings.outlineSettings,
        permissions: settings.permissions,
        enrollmentNotifications: settings.enrollmentNotifications,
    };

    return (
        <CourseSettingsContext.Provider value={contextValue}>
            {children}
        </CourseSettingsContext.Provider>
    );
};

export const useCourseSettingsContext = (): CourseSettingsContextType => {
    const context = useContext(CourseSettingsContext);
    if (context === undefined) {
        throw new Error('useCourseSettingsContext must be used within a CourseSettingsProvider');
    }
    return context;
};
