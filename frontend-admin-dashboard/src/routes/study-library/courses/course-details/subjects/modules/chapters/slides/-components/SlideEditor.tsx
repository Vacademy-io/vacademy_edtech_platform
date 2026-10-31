import { getPublicUrl, UploadFileInS3 } from '@/services/upload_file';
/* eslint-disable */
// @ts-nocheck
import { Excalidraw } from '@excalidraw/excalidraw';
import type { OrderedExcalidrawElement } from '@excalidraw/excalidraw/element/types';
import type { AppState, BinaryFiles, ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types';
import type React from 'react';
import { useRef, useCallback, useEffect, useState } from 'react';
import { getTokenFromCookie, getTokenDecodedData } from '@/lib/auth/sessionUtility';
import { TokenKey } from '@/constants/auth/tokens';
import { useTranslation } from 'react-i18next';

interface SlideEditorProps {
    slideId: string;
    initialData: {
        elements: any[];
        files: BinaryFiles;
        appState: Partial<AppState>;
    };
    fileId?: string; // S3 file ID to load data from
    onChange?: (elements: any[], appState: AppState, files: BinaryFiles, fileId?: string) => void;
    editable?: boolean;
    isSaving?: boolean;
    onEditorReady?: (getCurrentState: () => { elements: any[], appState: any, files: any }) => void;
    onBusyStateChange?: (isBusy: boolean) => void; // New prop to track busy state
}

const SlideEditor: React.FC<SlideEditorProps> = ({
    slideId,
    initialData,
    fileId,
    onChange,
    editable = true,
    isSaving = false,
    onEditorReady,
    onBusyStateChange,
}) => {
    const { t } = useTranslation('studyLibrarySlideEditor');
    const excalidrawRef = useRef<ExcalidrawImperativeAPI | null>(null);
    const debounceTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const rescheduleTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const isMountedRef = useRef(true);
    const [loadedData, setLoadedData] = useState<any>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [lastLoadedFileId, setLastLoadedFileId] = useState<string | undefined>(undefined);
    const [isAutoSaving, setIsAutoSaving] = useState(false);
    const [hasLoadedInitialData, setHasLoadedInitialData] = useState(false);
    const lastFileIdRef = useRef<string | undefined>(undefined);

    // Get user and institute info for S3 uploads
    const accessToken = getTokenFromCookie(TokenKey.accessToken);
    const data = getTokenDecodedData(accessToken);
    const INSTITUTE_ID = data && Object.keys(data.authorities)[0];
    const USER_ID = data?.sub;

    // Upload Excalidraw JSON to S3
    const uploadToS3 = useCallback(async (excalidrawData: any, existingFileId?: string): Promise<string | null> => {
        try {
            const jsonBlob = new Blob([JSON.stringify(excalidrawData)], { type: 'application/json' });
            
            // Use existing filename if updating, otherwise create new
            const fileName = existingFileId 
                ? `excalidraw_${slideId}_${existingFileId.slice(-8)}.json` 
                : `excalidraw_${slideId}_${Date.now()}.json`;
                
            const jsonFile = new File([jsonBlob], fileName, {
                type: 'application/json',
            });

            const uploadedFileId = await UploadFileInS3(
                jsonFile,
                () => {}, // No progress callback needed
                USER_ID || '',
                INSTITUTE_ID,
                'ADMIN',
                true // public URL
            );

            return uploadedFileId || null;
        } catch (error) {
            console.error(`[SlideEditor ${slideId}] Error uploading to S3:`, error);
            return null;
        }
    }, [slideId, USER_ID, INSTITUTE_ID]);

    useEffect(() => {
        isMountedRef.current = true;
        return () => {
            isMountedRef.current = false;
        };
    }, []);

    // Load data from S3 using fileId
    useEffect(() => {
        const loadData = async () => {
            setIsLoading(true);
            setError(null);

            try {
                if (fileId) {
                    const publicUrl = await getPublicUrl(fileId);
                    const response = await fetch(publicUrl);

                    if (!response.ok) {
                        throw new Error(`Failed to fetch data from S3: ${response.statusText}`);
                    }

                    const excalidrawData = await response.json();
                    setLoadedData(excalidrawData);
                    setLastLoadedFileId(fileId);
                } else {
                    setLoadedData(null);
                    setLastLoadedFileId(undefined);
                }
                setHasLoadedInitialData(true);
            } catch (error) {
                console.error(`[SlideEditor] Error loading slide data:`, error);
                setError(error instanceof Error ? error.message : t('unknownError'));
                setHasLoadedInitialData(true); // Set this even on error to prevent retries
            } finally {
                setIsLoading(false);
            }
        };

        // Reset hasLoadedInitialData if fileId has changed significantly
        if (fileId !== lastLoadedFileId) {
            setHasLoadedInitialData(false);
            // Track the previous fileId to prevent emergency saves during normal operations
            lastFileIdRef.current = lastLoadedFileId;
        }

        // Only load if we haven't loaded this specific fileId before
        if (!hasLoadedInitialData || fileId !== lastLoadedFileId) {
        loadData();
        }
    }, [slideId, fileId]); // Include fileId in dependency array

    const saveToS3 = useCallback(
        (elements: readonly OrderedExcalidrawElement[], appState: AppState, files: BinaryFiles) => {
            if (debounceTimeoutRef.current) {
                clearTimeout(debounceTimeoutRef.current);
            }
            if (rescheduleTimeoutRef.current) {
                clearTimeout(rescheduleTimeoutRef.current);
            }

            // Use longer delay if intensive operations are detected
            const hasIntensiveOperations = 
                appState.isLoading || 
                (appState as any).pendingImageElementId !== null ||
                elements.some(element => element.type === 'image') ||
                Object.keys(files).length > 0;
            
            const delay = hasIntensiveOperations ? 5000 : 2000; // 5s for intensive ops, 2s otherwise

            debounceTimeoutRef.current = setTimeout(async () => {
                // Check if Excalidraw is still performing intensive operations before saving
                const isPerformingIntensiveOperation = 
                    appState.isLoading || // General loading state
                    (appState as any).pendingImageElementId !== null || // Image being processed
                    elements.some(element => 
                        element.type === 'image' && 
                        (('status' in element && (element as any).status === 'pending') ||
                         ('fileId' in element && !(element as any).fileId))
                    ) || // Image elements being processed or without fileId
                    Object.values(files).some(file => 
                        file && typeof file === 'object' && 
                        (('dataURL' in file && !file.dataURL) || 
                         ('created' in file && Date.now() - (file as any).created < 3000))
                    ); // Files being loaded or recently created

                if (isPerformingIntensiveOperation) {
                    // Reschedule the save for later
                    rescheduleTimeoutRef.current = setTimeout(() => {
                        saveToS3(elements, appState, files);
                    }, 2000); // Check again in 2 seconds
                    return;
                }

                setIsAutoSaving(true);
                
                const excalidrawData = {
                    isExcalidraw: true,
                    elements,
                    files,
                    appState,
                    lastModified: Date.now(),
                };

                try {
                    // Try to update existing file first, otherwise create new
                    const uploadedFileId = await uploadToS3(excalidrawData, fileId);
                    if (uploadedFileId && isMountedRef.current) {
                        // Always trigger onChange to update the database with the fileId
                        // The parent component will handle whether this causes a re-render
                        onChange?.(elements as any[], appState, files, uploadedFileId);
                    }
                } catch (error) {
                    console.error(`[SlideEditor] Error saving to S3:`, error);
                } finally {
                    setIsAutoSaving(false);
                }
            }, delay); // Use dynamic delay
        },
        [slideId, uploadToS3, onChange, fileId]
    );

    const handleChange = useCallback(
        (elements: readonly OrderedExcalidrawElement[], appState: AppState, files: BinaryFiles) => {
            // Detect if Excalidraw is performing intensive operations
            const isPerformingIntensiveOperation = 
                appState.isLoading || // General loading state
                (appState as any).pendingImageElementId !== null || // Image being processed
                elements.some(element => 
                    element.type === 'image' && 
                    (('status' in element && (element as any).status === 'pending') ||
                     ('fileId' in element && !(element as any).fileId))
                ) || // Image elements being processed or without fileId
                Object.values(files).some(file => 
                    file && typeof file === 'object' && 
                    (('dataURL' in file && !file.dataURL) || 
                     ('created' in file && Date.now() - (file as any).created < 3000))
                ); // Files being loaded or recently created
            
            // Report busy state to parent component
            if (onBusyStateChange) {
                onBusyStateChange(isPerformingIntensiveOperation);
            }
            
            if (editable) {
                saveToS3(elements, appState, files);
            }
        },
        [saveToS3, slideId, onBusyStateChange]
    );

    useEffect(() => {
        return () => {
            if (debounceTimeoutRef.current) {
                clearTimeout(debounceTimeoutRef.current);
            }
            if (rescheduleTimeoutRef.current) {
                clearTimeout(rescheduleTimeoutRef.current);
            }
                
            // Only run emergency save if:
                // 1. Not already auto-saving
                // 2. FileId hasn't recently changed (indicating normal operation)
                // 3. This appears to be actual navigation, not a rebuild
                const fileIdRecentlyChanged = lastFileIdRef.current !== fileId && 
                                            lastFileIdRef.current !== undefined;
                
                if (excalidrawRef.current && editable && !isAutoSaving && !fileIdRecentlyChanged) {
                    try {
                        const elements = excalidrawRef.current.getSceneElements();
                        const appState = excalidrawRef.current.getAppState();
                        const files = excalidrawRef.current.getFiles();
                        
                        if (elements.length > 0) {
                            const excalidrawData = {
                                isExcalidraw: true,
                                elements,
                                files,
                                appState,
                                lastModified: Date.now(),
                            };
                            
                            // Immediate save without debounce
                            uploadToS3(excalidrawData, fileId).then((uploadedFileId) => {
                                if (uploadedFileId && isMountedRef.current) {
                                    onChange?.(elements as any[], appState, files, uploadedFileId);
                                }
                            }).catch((error) => {
                                console.error(`[SlideEditor] Emergency save failed:`, error);
                            });
                        }
                    } catch (error) {
                        console.error(`[SlideEditor] Error during emergency save:`, error);
                    }
                }
        };
    }, [slideId, uploadToS3, onChange, fileId]);

    // Create properly structured initial data
    const getInitialData = () => {
        const dataToUse = loadedData || initialData;

        // Deep clone the data to ensure complete isolation between slides
        const clonedElements = JSON.parse(JSON.stringify(dataToUse.elements || []));
        const clonedFiles = JSON.parse(JSON.stringify(dataToUse.files || {}));
        const clonedAppState = JSON.parse(JSON.stringify(dataToUse.appState || {}));

        // Ensure appState has all required properties
        const defaultAppState = {
            scrollX: 0,
            scrollY: 0,
            collaborators: new Map(), // Initialize as Map
            ...clonedAppState,
        };

        // If collaborators exists but is not a Map, convert it
        if (defaultAppState.collaborators && !(defaultAppState.collaborators instanceof Map)) {
            defaultAppState.collaborators = new Map();
        }

        const finalData = {
            elements: clonedElements,
            files: clonedFiles,
            appState: defaultAppState,
        };
        
        return finalData;
    };

    // Function to get current state from Excalidraw
    const getCurrentState = useCallback((): { elements: any[], appState: any, files: any } => {
        if (!excalidrawRef.current) {
            return { elements: [], appState: {}, files: {} };
        }
        
        try {
            const elements = excalidrawRef.current.getSceneElements() as any[];
            const appState = excalidrawRef.current.getAppState() as any;
            const files = excalidrawRef.current.getFiles() as any;
            
            return { elements, appState, files };
        } catch (error) {
            console.error('Error getting current state from Excalidraw:', error);
            return { elements: [], appState: {}, files: {} };
        }
    }, []);

    // Show loading state
    if (isLoading) {
        return (
            <div
                className="flex aspect-[4/3] w-full items-center justify-center border"
                style={{ height: '85vh' }}
            >
                <div className="text-center">
                    <div className="mx-auto mb-2 h-8 w-8 animate-spin rounded-full border-b-2 border-gray-900"></div>
                    <p className="text-gray-600">{t('loadingSlideData')}</p>
                </div>
            </div>
        );
    }

    // Show error state
    if (error) {
        return (
            <div
                className="flex aspect-[4/3] w-full items-center justify-center border"
                style={{ height: '85vh' }}
            >
                <div className="text-center text-red-600">
                    <p className="mb-2">{t('errorLoadingSlideData')}</p>
                    <p className="text-sm">{error}</p>
                    <button
                        onClick={() => window.location.reload()}
                        className="mt-4 rounded bg-red-100 px-4 py-2 text-red-700 hover:bg-red-200"
                    >
                        {t('retry')}
                    </button>
                </div>
            </div>
        );
    }

    // Show empty state if no fileId and no initial data
    if (!fileId && (!loadedData || (loadedData && 'elements' in loadedData && loadedData.elements.length === 0))) {
        return (
            <div
                className="aspect-[4/3] w-full border relative"
                style={{ 
                    height: '85vh',
                    zIndex: 9999
                }}
                onWheelCapture={(e) => e.stopPropagation()}
            >
                <Excalidraw
                    key={`excalidraw-${slideId}`}
                    excalidrawAPI={(api) => {
                        excalidrawRef.current = api;
                        if (onEditorReady) {
                            onEditorReady(getCurrentState);
                        }
                    }}
                    initialData={{
                        elements: [],
                        files: {},
                        appState: {
                            scrollX: 0,
                            scrollY: 0,
                            collaborators: new Map(),
                        },
                    }}
                    onChange={handleChange}
                    UIOptions={{
                        canvasActions: {
                            changeViewBackgroundColor: false,
                            toggleScrollBehavior: true,
                            toggleTheme: false,
                            saveToActiveFile: false,
                            clearCanvas: false,
                            export: false,
                            loadScene: false,
                        },
                    }}
                    viewModeEnabled={isSaving}
                />
            </div>
        );
    }

    return (
        <div
            className="aspect-[4/3] w-full border relative"
            style={{ 
                height: '85vh',
                zIndex: 9999 // Ensure Excalidraw toolbar appears above other elements
            }}
            onWheelCapture={(e) => e.stopPropagation()}
        >
            <Excalidraw
                key={`excalidraw-${slideId}`}
                excalidrawAPI={(api) => {
                    excalidrawRef.current = api;
                    if (onEditorReady) {
                        onEditorReady(getCurrentState);
                    }
                }}
                initialData={getInitialData()}
                onChange={handleChange}
                UIOptions={{
                    canvasActions: {
                        changeViewBackgroundColor: false,
                        toggleScrollBehavior: true,
                        toggleTheme: false,
                        saveToActiveFile: false,
                        clearCanvas: false,
                        export: false,
                        loadScene: false,
                    },
                }}
                viewModeEnabled={isSaving}
            />
        </div>
    );
};

export default SlideEditor;
