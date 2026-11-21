import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Form } from '@/components/ui/form';
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Trash2, Plus, Calendar, ChevronDown } from 'lucide-react';
import { UploadSimple } from '@phosphor-icons/react';
import { toast } from 'sonner';
import { getPublicUrl } from '@/services/upload_file';
import { UploadFileInS3Public } from '@/routes/signup/-services/signup-services';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Card, CardContent } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import AddCourseStep2StructureTypes from './add-course-step2-structure-types';
import { MyButton } from '@/components/design-system/button';
import SessionLevelMappingDialog from './SessionLevelMappingDialog';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import MultiSelectDropdown from '@/components/common/multi-select-dropdown';
import { fetchInstituteDashboardUsers } from '@/routes/dashboard/-services/dashboard-services';
import { getInstituteId } from '@/constants/helper';
import InviteInstructorForm from './InviteInstructorForm';
import { UserRolesDataEntry } from '@/types/dashboard/user-roles';
import { CODE_CIRCLE_INSTITUTE_ID } from '@/constants/urls';
import { ContentTerms, RoleTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';
import { getTerminology } from '@/components/common/layout-container/sidebar/utils';
import { getTokenDecodedData, getTokenFromCookie } from '@/lib/auth/sessionUtility';
import { TokenKey } from '@/constants/auth/tokens';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import { RoleTypeExceptStudent } from '@/constants/dummy-data';
import { CourseSettingsData } from '@/types/course-settings';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import type { CourseCreationSettings } from '@/types/display-settings';
import {
    buildRenameShareWarning,
    sessionKeyOf,
    validateLevelRename,
    validateSessionRename,
    type RenameRowType,
} from './rename-rules';
import { InlineNameEditor } from './inline-name-editor';
import { AuthorRoleField, authorRoleOptions } from './author-role-field';
import { RichTextEditor } from '@/components/editor/RichTextEditor';

interface Subgroup {
    id?: string;
    subgroupName: string;
}

interface Level {
    id: string;
    name: string;
    userIds: Instructor[];
    batchId: string;
    newLevel?: boolean;
    containsSubgroup: boolean;
    subgroups: Subgroup[];
}

interface Session {
    id: string;
    name: string;
    startDate: string;
    levels: Level[];
    batchId?: string;
    newSession?: boolean;
}

interface Instructor {
    id: string;
    email: string;
    name: string;
    profilePicId: string;
    roles?: string[];
    /** Optional author-profile metadata shown wherever this user is an instructor. */
    authorSubtitle?: string;
    authorDescription?: string;
    /** Display role in this course (Author / Instructor / Acharya ...). '' = institute default. */
    roleLabel?: string;
}

// Update the schema
export const step2Schema = z
    .object({
        levelStructure: z.number(),
        hasLevels: z.string(),
        hasSessions: z.string(),
        // Top-level subgroup configuration for the course. When true, the UI
        // enables subgroup configuration per level (nested under sessions[i].levels[j]).
        // The legacy top-level `subgroups` array is kept for backward compatibility
        // but is no longer required by validation.
        containsSubgroup: z.boolean().optional().default(false),
        subgroups: z
            .array(
                z.object({
                    subgroupName: z.string().min(1, 'Subgroup name is required'),
                })
            )
            .optional()
            .default([]),
        sessions: z
            .array(
                z.object({
                    id: z.string(),
                    name: z.string(),
                    startDate: z.string(),
                    newSession: z.boolean().default(false),
                    levels: z.array(
                        z.object({
                            id: z.string(),
                            name: z.string(),
                            userIds: z
                                .array(
                                    z.object({
                                        id: z.string(),
                                        email: z.string(),
                                        name: z.string(),
                                        profilePicId: z.string(),
                                        roles: z.array(z.string()).optional(),
                                        authorSubtitle: z.string().optional(),
                                        authorDescription: z.string().optional(),
                                        roleLabel: z.string().optional(),
                                    })
                                )
                                .default([]),
                            newLevel: z.boolean().default(false),
                            containsSubgroup: z.boolean().optional().default(false),
                            subgroups: z
                                .array(
                                    z.object({
                                        id: z.string().optional(),
                                        subgroupName: z
                                            .string()
                                            .min(1, 'Subgroup name is required'),
                                    })
                                )
                                .optional()
                                .default([]),
                        })
                    ),
                })
            )
            .default([]),
        selectedInstructors: z
            .array(
                z.object({
                    id: z.string(),
                    name: z.string(),
                    email: z.string(),
                    profilePicId: z.string(),
                    roles: z.array(z.string()).optional(),
                    authorSubtitle: z.string().optional(),
                    authorDescription: z.string().optional(),
                    roleLabel: z.string().optional(),
                })
            )
            .default([]),
        instructors: z
            .array(
                z.object({
                    id: z.string(),
                    name: z.string(),
                    email: z.string(),
                    profilePicId: z.string(),
                    roles: z.array(z.string()).optional(),
                    authorSubtitle: z.string().optional(),
                    authorDescription: z.string().optional(),
                    roleLabel: z.string().optional(),
                })
            )
            .optional(),
        publishToCatalogue: z.boolean(),
        // Optional per-course advanced settings JSON (package.course_setting envelope),
        // consumed by workflows. Persisted verbatim on create when present + valid.
        courseSettingJson: z.string().optional(),
    })
    .superRefine((data, ctx) => {
        if (!data.containsSubgroup) return;

        // Accept either the legacy top-level subgroups OR the new nested
        // per-level subgroups. Prefer nested validation for the new UI.
        const hasTopLevel =
            Array.isArray(data.subgroups) && data.subgroups.some((sg) => !!sg.subgroupName?.trim());
        const hasNested =
            Array.isArray(data.sessions) &&
            data.sessions.some((session) =>
                (session.levels ?? []).some(
                    (level) =>
                        Array.isArray(level.subgroups) &&
                        level.subgroups.some((sg) => !!sg.subgroupName?.trim())
                )
            );

        if (!hasTopLevel && !hasNested) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: 'Please add at least one subgroup for at least one level',
                path: ['sessions'],
            });
        }
    });

export type Step2Data = z.infer<typeof step2Schema>;

// Add this interface before the AddCourseStep2 component
interface InstructorMapping {
    id: string;
    email: string;
    sessionLevels: Array<{
        sessionId: string;
        sessionName: string;
        levelId: string;
        levelName: string;
        batchId?: string;
    }>;
}

// Define a type for batches at the top of the file:
interface PackageDTO {
    id?: string;
    package_name?: string;
    thumbnail_file_id?: string;
    is_course_published_to_catalaouge?: boolean | null;
    course_preview_image_media_id?: string | null;
    course_banner_media_id?: string | null;
    course_media_id?: string | null;
    why_learn_html?: string | null;
    who_should_learn_html?: string | null;
    about_the_course_html?: string | null;
    tags?: string[];
    course_depth?: number;
    course_html_description_html?: string | null;
}
interface Group {
    id: string;
    group_name: string;
    parent_group: string | null;
    is_root: boolean | null;
    group_value: string;
}
type ExistingBatch = {
    id: string;
    level: {
        id: string;
        level_name: string;
        duration_in_days: number | null;
        thumbnail_id: string | null;
    };
    session: { id: string; session_name: string; status: string; start_date: string };
    start_time: string | null;
    status: string;
    package_dto?: PackageDTO;
    group?: Group;
};

// Add this helper function before AddCourseStep2
function getAllSessionLevelsForInstructor(
    sessions: Session[],
    hasSessions: string,
    hasLevels: string
): Array<{
    sessionId: string;
    sessionName: string;
    levelId: string;
    levelName: string;
    batchId?: string;
}> {
    const allSessionLevels: Array<{
        sessionId: string;
        sessionName: string;
        levelId: string;
        levelName: string;
        batchId?: string;
    }> = [];
    if (hasSessions === 'yes' && hasLevels === 'yes') {
        sessions.forEach((session: Session) => {
            // Filter out default sessions
            if (session.name.toLowerCase() === 'default') {
                return;
            }
            session.levels.forEach((level: Level) => {
                // Filter out default levels
                if (level.name.toLowerCase() === 'default') {
                    return;
                }
                allSessionLevels.push({
                    sessionId: session.id,
                    sessionName: session.name,
                    levelId: level.id,
                    levelName: level.name,
                    batchId: level.batchId,
                });
            });
        });
    } else if (hasSessions === 'yes' && hasLevels !== 'yes') {
        sessions.forEach((session: Session) => {
            // Filter out default sessions
            if (session.name.toLowerCase() === 'default') {
                return;
            }
            allSessionLevels.push({
                sessionId: session.id,
                sessionName: session.name,
                levelId: 'DEFAULT',
                levelName: '',
            });
        });
    } else if (hasSessions !== 'yes' && hasLevels === 'yes') {
        const standaloneSession = sessions.find((s: Session) => s.id === 'DEFAULT');
        if (standaloneSession) {
            standaloneSession.levels.forEach((level: Level) => {
                // Filter out default levels
                if (level.name.toLowerCase() === 'default') {
                    return;
                }
                allSessionLevels.push({
                    sessionId: 'DEFAULT',
                    sessionName: '',
                    levelId: level.id,
                    levelName: level.name,
                });
            });
        }
    }
    return allSessionLevels;
}

export const AddCourseStep2 = ({
    onBack,
    onSubmit,
    initialData,
    isLoading = false,
    disableCreate = false,
    isEdit,
    courseSettings,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    settingsLoading = false,
    courseCreationDisplay,
    courseId,
    isFinalStep = true,
}: {
    onBack: () => void;
    onSubmit: (data: Step2Data) => void;
    initialData?: Step2Data;
    isLoading?: boolean;
    disableCreate?: boolean;
    isEdit?: boolean;
    courseSettings?: CourseSettingsData;
    settingsLoading?: boolean;
    courseCreationDisplay?: CourseCreationSettings;
    /** Used to exclude this course when reporting which courses share a session/level row. */
    courseId?: string;
    /**
     * False when a later step follows (the Payment & Enrolment step), so the footer reads
     * "Next" instead of "Create" and the course is not created from here.
     */
    isFinalStep?: boolean;
}) => {
    const { instituteDetails } = useInstituteDetailsStore();
    const existingBatches = instituteDetails?.batches_for_sessions || [];
    const accessToken = getTokenFromCookie(TokenKey.accessToken);
    const tokenData = getTokenDecodedData(accessToken);
    const instituteId = getInstituteId();

    // Determine initial values based on course settings
    const getInitialHasLevels = () => {
        // When editing, respect the existing course data over settings
        if (isEdit && initialData?.hasLevels) return initialData.hasLevels;
        if (courseSettings?.courseStructure?.enableLevels === false) return 'no';
        return initialData?.hasLevels || 'yes';
    };

    const getInitialHasSessions = () => {
        // When editing, respect the existing course data over settings
        if (isEdit && initialData?.hasSessions) return initialData.hasSessions;
        if (courseSettings?.courseStructure?.enableSessions === false) return 'no';
        if (instituteId === CODE_CIRCLE_INSTITUTE_ID) return 'no';
        return initialData?.hasSessions || 'yes';
    };

    const [hasLevels, setHasLevels] = useState(getInitialHasLevels());
    const [hasSessions, setHasSessions] = useState(getInitialHasSessions());
    const [sessions, setSessions] = useState<Session[]>(
        (initialData?.sessions || []).map((session) => ({
            ...session,
            levels: session.levels.map((level) => ({
                ...level,
                batchId: (level as Level).batchId || level.id,
                containsSubgroup: (level as Level).containsSubgroup ?? false,
                subgroups: (level as Level).subgroups ?? [],
            })),
        }))
    );
    const [showAddSession, setShowAddSession] = useState(false);
    const [showAddLevel, setShowAddLevel] = useState(false);
    const [newSessionName, setNewSessionName] = useState('');
    const [newSessionStartDate, setNewSessionStartDate] = useState('');
    const [newLevelName, setNewLevelName] = useState('');
    const [showInviteDialog, setShowInviteDialog] = useState(false);
    const [showMappingDialog, setShowMappingDialog] = useState(false);
    const [pendingRemoval, setPendingRemoval] = useState<{
        term: string;
        name: string;
        confirm: () => void;
    } | null>(null);
    const [selectedInstructorId, setSelectedInstructorId] = useState('');
    const [selectedInstructorEmail, setSelectedInstructorEmail] = useState('');
    const [selectedInstructors, setSelectedInstructors] = useState<Instructor[]>([]);
    const [instructorMappings, setInstructorMappings] = useState<InstructorMapping[]>([]);
    const [instructors, setInstructors] = useState<Instructor[]>([]);

    const [publishToCatalogue, setPublishToCatalogue] = useState(() => {
        // If initialData exists, use it
        if (initialData?.publishToCatalogue !== undefined) {
            return initialData.publishToCatalogue;
        }
        // If autoPublishToCatalogue is true, auto-publish
        if (courseSettings?.catalogueSettings?.autoPublishToCatalogue) {
            return true;
        }
        // Default behavior based on catalogueMode
        const catalogueMode = courseSettings?.catalogueSettings?.catalogueMode || 'ask';
        return catalogueMode === 'ask' ? true : false;
    });

    const [showAssignmentCard, setShowAssignmentCard] = useState(false);
    const [selectedSessionLevels, setSelectedSessionLevels] = useState<
        Array<{
            sessionId: string;
            sessionName: string;
            levelId: string;
            levelName: string;
            batchId?: string;
        }>
    >([]);

    const [addSessionMode, setAddSessionMode] = useState<'new' | 'existing'>('existing');
    const [selectedExistingBatchIds, setSelectedExistingBatchIds] = useState<string[]>([]);
    // Add state for addLevelMode
    const [addLevelMode, setAddLevelMode] = useState<'new' | 'existing'>('existing');
    const [selectedExistingLevelBatchIds, setSelectedExistingLevelBatchIds] = useState<string[]>(
        []
    );

    // Add state to track used existing batches
    const [usedExistingBatchIds, setUsedExistingBatchIds] = useState<Set<string>>(new Set());
    // Collapsed on create, where the basics matter first. Open when editing:
    // Add Authors lives in here, and an admin who comes back to assign an
    // author or fill a subtitle/description otherwise finds nothing on screen.
    const [showAdvanced, setShowAdvanced] = useState(Boolean(isEdit));

    const allowAdvancedSettings = courseCreationDisplay?.showAdvancedSettings !== false;
    const limitLevelsToOne = courseCreationDisplay?.limitToSingleLevel === true;
    const totalLevels = useMemo(
        () => sessions.reduce((count, session) => count + session.levels.length, 0),
        [sessions]
    );
    const canAddMoreLevels = !limitLevelsToOne || totalLevels < 1;

    // Subgroup-related controls should only be available when the global
    // course settings default filter is constrained to parents/children.
    const courseFilterType = courseSettings?.permissions?.courseFilterType;
    const enableSubgroupControls =
        courseFilterType === 'PARENTS_ONLY' || courseFilterType === 'CHILDREN_ONLY';

    useEffect(() => {
        if (!allowAdvancedSettings) {
            setShowAdvanced(false);
        }
    }, [allowAdvancedSettings]);

    const addedSessionLevelKeys = new Set(
        sessions.flatMap((s) => s.levels.map((l) => `${s.id}-${l.id}`))
    );
    const seenSessionLevelKeys = new Set<string>();

    // Filter available existing batches based on hasSessions and hasLevels values
    const eligibleExistingBatches = existingBatches.filter((batch: ExistingBatch) => {
        // Always exclude used batches
        if (usedExistingBatchIds.has(batch.id)) {
            return false;
        }

        // Case 1: hasSessions = 'yes' and hasLevels = 'yes'
        if (hasSessions === 'yes' && hasLevels === 'yes') {
            return (
                batch.session.session_name.toLowerCase() !== 'default' &&
                batch.level.level_name.toLowerCase() !== 'default'
            );
        }

        // Case 2: hasSessions = 'yes' and hasLevels = 'no'
        if (hasSessions === 'yes' && hasLevels !== 'yes') {
            return batch.session.session_name.toLowerCase() !== 'default';
        }

        // Case 3: hasSessions = 'no' and hasLevels = 'yes'
        if (hasSessions !== 'yes' && hasLevels === 'yes') {
            return batch.level.level_name.toLowerCase() !== 'default';
        }

        // Case 4: hasSessions = 'no' and hasLevels = 'no'
        // Don't filter anything, return true for all batches
        return true;
    });
    const availableExistingBatches = eligibleExistingBatches.filter((batch: ExistingBatch) => {
        // Every course has its own batch for a shared session+level, so list each pair once,
        // and hide pairs this course already has (adding them again is a no-op)
        const key = `${batch.session.id}-${batch.level.id}`;
        if (addedSessionLevelKeys.has(key) || seenSessionLevelKeys.has(key)) {
            return false;
        }
        seenSessionLevelKeys.add(key);
        return true;
    });

    // Helper function to deduplicate sessions by name when hasSessions is 'yes' and hasLevels is not 'yes'
    const getDeduplicatedSessions = (batches: ExistingBatch[]) => {
        if (hasSessions === 'yes' && hasLevels !== 'yes') {
            const seenSessionNames = new Set<string>();
            return batches.filter((batch) => {
                const sessionName = batch.session.session_name;
                // Filter out default sessions
                if (sessionName.toLowerCase() === 'default') {
                    return false;
                }
                if (seenSessionNames.has(sessionName)) {
                    return false;
                }
                seenSessionNames.add(sessionName);
                return true;
            });
        }
        return batches;
    };

    // Helper function to deduplicate levels by name when hasSessions is not 'yes' and hasLevels is 'yes'
    const getDeduplicatedLevels = (batches: ExistingBatch[]) => {
        if (hasSessions !== 'yes' && hasLevels === 'yes') {
            const seenLevelNames = new Set<string>();
            return batches.filter((batch) => {
                const levelName = batch.level.level_name;
                // Filter out default levels
                if (levelName.toLowerCase() === 'default') {
                    return false;
                }
                if (seenLevelNames.has(levelName)) {
                    return false;
                }
                seenLevelNames.add(levelName);
                return true;
            });
        }
        return batches;
    };

    // Add this before the return statement in AddCourseStep2
    const standaloneSession = sessions.find((s) => s.id === 'DEFAULT');
    const standaloneLevelIds = standaloneSession ? standaloneSession.levels.map((l) => l.id) : [];
    const availableExistingBatchesForStandalone = getDeduplicatedLevels(
        availableExistingBatches.filter((batch) => !standaloneLevelIds.includes(batch.level.id))
    );

    const form = useForm<Step2Data>({
        resolver: zodResolver(step2Schema),
        defaultValues: initialData
            ? {
                  // Use values from initialData where available. When editing, preserve the course's actual depth.
                  ...initialData,
                  levelStructure:
                      initialData.levelStructure ??
                      courseSettings?.courseStructure?.defaultDepth ??
                      2,
                  hasLevels: initialData.hasLevels ?? getInitialHasLevels(),
                  hasSessions: initialData.hasSessions ?? getInitialHasSessions(),
                  containsSubgroup: initialData.containsSubgroup ?? false,
                  subgroups: initialData.subgroups ?? [],
                  sessions: initialData.sessions ?? [],
                  selectedInstructors: initialData.selectedInstructors ?? [],
                  instructors: initialData.instructors ?? [],
                  publishToCatalogue: initialData.publishToCatalogue ?? false,
              }
            : {
                  levelStructure: courseSettings?.courseStructure?.defaultDepth || 2,
                  hasLevels: 'yes',
                  hasSessions: 'yes',
                  containsSubgroup: false,
                  subgroups: [],
                  sessions: [],
                  selectedInstructors: [],
                  instructors: [],
                  publishToCatalogue: false,
              },
    });

    const containsSubgroup = form.watch('containsSubgroup');

    const handleToggleContainsSubgroup = (value: 'yes' | 'no') => {
        const isYes = value === 'yes';
        form.setValue('containsSubgroup', isYes);

        // When turning subgroups OFF, clear all nested subgroups from every level
        // so the payload does not carry stale subgroup data.
        if (!isYes) {
            setSessions((prev) => {
                const updatedSessions = prev.map((session) => ({
                    ...session,
                    levels: session.levels.map((level) => ({
                        ...level,
                        containsSubgroup: false,
                        subgroups: [],
                    })),
                }));
                form.setValue('sessions', ensureNewSessionAndLevelFlags(updatedSessions));
                return updatedSessions;
            });
        }
    };

    // Session management functions
    const addSession = () => {
        if (newSessionName.trim() && newSessionStartDate) {
            const randomBatchId =
                typeof crypto !== 'undefined' && crypto.randomUUID
                    ? crypto.randomUUID()
                    : Date.now().toString() + Math.random().toString(36).substring(2);
            const newSession: Session & { newSession: boolean } = {
                id: Date.now().toString(),
                name: newSessionName.trim(),
                startDate: newSessionStartDate,
                levels: [],
                batchId: randomBatchId,
                newSession: true,
            };
            const updatedSessions = [...sessions, newSession];
            setSessions(updatedSessions);
            form.setValue('sessions', ensureNewSessionAndLevelFlags(updatedSessions));
            setNewSessionName('');
            setNewSessionStartDate('');
            setShowAddSession(false);
        }
    };

    const removeSession = (batchId: string) => {
        if (!batchId) return;
        // Remove the session with the given batchId
        const updatedSessions = sessions.filter(
            (session) => (session.batchId || session.id) !== batchId
        );
        setSessions(updatedSessions);
        form.setValue('sessions', ensureNewSessionAndLevelFlags(updatedSessions));
        // Remove all sessionLevels for this session from all instructors
        setInstructorMappings((prev) =>
            prev.map((instructor) => ({
                ...instructor,
                sessionLevels: instructor.sessionLevels.filter(
                    (sl) => sl.batchId !== batchId && sl.sessionId !== batchId
                ),
            }))
        );
        setUsedExistingBatchIds((prev) => {
            const newSet = new Set(prev);
            newSet.delete(batchId);
            return newSet;
        });
    };

    const addLevel = (sessionId: string, levelName: string, levelId?: string) => {
        if (limitLevelsToOne && !canAddMoreLevels) {
            return;
        }
        if (levelName.trim()) {
            const id = levelId || Date.now().toString();
            const newLevel: Level & { newLevel: boolean } = {
                id,
                name: levelName.trim(),
                userIds: [],
                batchId: id,
                newLevel: true,
                containsSubgroup: false,
                subgroups: [],
            };
            const updatedSessions = sessions.map((session) =>
                session.id === sessionId
                    ? { ...session, levels: [...session.levels, newLevel] }
                    : session
            );
            setSessions(updatedSessions);
            form.setValue('sessions', ensureNewSessionAndLevelFlags(updatedSessions));
        }
    };

    const removeLevel = (sessionId: string, batchId: string) => {
        if (!batchId) return;
        const updatedSessions = sessions.map((session) =>
            session.id === sessionId
                ? {
                      ...session,
                      levels: session.levels.filter((level) => level.batchId !== batchId),
                  }
                : session
        );
        setSessions(updatedSessions);
        form.setValue('sessions', ensureNewSessionAndLevelFlags(updatedSessions));
        // Remove this level from all instructors
        setInstructorMappings((prev) =>
            prev.map((instructor) => ({
                ...instructor,
                sessionLevels: instructor.sessionLevels.filter(
                    (sl) => sl.batchId !== batchId && sl.levelId !== batchId
                ),
            }))
        );
        setUsedExistingBatchIds((prev) => {
            const newSet = new Set(prev);
            newSet.delete(batchId);
            return newSet;
        });
    };

    // In edit mode, removing an already-saved session/level deletes its batch on
    // save, so ask first. Unsaved (new) rows are removed straight away.
    const requestRemoveSession = (batchId: string) => {
        const session = sessions.find((s) => (s.batchId || s.id) === batchId);
        if (!isEdit || !session || session.newSession === true) {
            removeSession(batchId);
            return;
        }
        setPendingRemoval({
            term: getTerminology(ContentTerms.Session, SystemTerms.Session),
            name: session.name,
            confirm: () => removeSession(batchId),
        });
    };

    const requestRemoveLevel = (sessionId: string, batchId: string) => {
        const level = sessions
            .find((s) => s.id === sessionId)
            ?.levels.find((l) => l.batchId === batchId);
        if (!isEdit || !level || level.newLevel === true) {
            removeLevel(sessionId, batchId);
            return;
        }
        setPendingRemoval({
            term: getTerminology(ContentTerms.Level, SystemTerms.Level),
            name: level.name,
            confirm: () => removeLevel(sessionId, batchId),
        });
    };

    const confirmPendingRemoval = () => {
        pendingRemoval?.confirm();
        setPendingRemoval(null);
    };

    const getRenameShareWarning = (rowType: RenameRowType, rowId?: string): string | null =>
        buildRenameShareWarning(
            existingBatches as ExistingBatch[],
            courseId,
            rowType,
            rowId,
            getTerminology(ContentTerms.Course, SystemTerms.Course)
        );

    const validateSessionName = (sessionKey: string, name: string): string | null =>
        validateSessionRename({
            sessions,
            batches: existingBatches as ExistingBatch[],
            courseId,
            sessionKey,
            name,
            term: getTerminology(ContentTerms.Session, SystemTerms.Session),
        });

    const validateLevelName = (sessionKey: string, batchId: string, name: string): string | null =>
        validateLevelRename({
            sessions,
            batches: existingBatches as ExistingBatch[],
            courseId,
            sessionKey,
            batchId,
            name,
            term: getTerminology(ContentTerms.Level, SystemTerms.Level),
        });

    const renameSession = (sessionKey: string, name: string) => {
        const trimmed = name.trim();
        if (validateSessionName(sessionKey, trimmed)) return;
        const updatedSessions = sessions.map((session) =>
            sessionKeyOf(session) === sessionKey ? { ...session, name: trimmed } : session
        );
        setSessions(updatedSessions);
        form.setValue('sessions', ensureNewSessionAndLevelFlags(updatedSessions));
    };

    const renameLevel = (sessionKey: string, batchId: string, name: string) => {
        const trimmed = name.trim();
        if (validateLevelName(sessionKey, batchId, trimmed)) return;
        const updatedSessions = sessions.map((session) =>
            sessionKeyOf(session) === sessionKey
                ? {
                      ...session,
                      levels: session.levels.map((level) =>
                          level.batchId === batchId ? { ...level, name: trimmed } : level
                      ),
                  }
                : session
        );
        setSessions(updatedSessions);
        form.setValue('sessions', ensureNewSessionAndLevelFlags(updatedSessions));
    };

    const handleSubmit = (data: Step2Data) => {
        const completeData = {
            ...data,
            levelStructure: data.levelStructure || 2,
            hasLevels: data.hasLevels,
            hasSessions: data.hasSessions,
            sessions: data.sessions,
            instructors: data.instructors,
            // The authors on screen. The auto-added creator is only in state, never
            // written to the form, so the form value alone can miss them.
            selectedInstructors: Array.isArray(selectedInstructors)
                ? selectedInstructors
                : data.selectedInstructors,
            publishToCatalogue: data.publishToCatalogue,
        };
        onSubmit(completeData);
    };

    // ---- Per-level subgroup handlers (nested model) -------------------------
    const handleAddLevelSubgroup = (sessionId: string, levelBatchId: string) => {
        setSessions((prev) => {
            const updated = prev.map((session) => {
                if (session.id !== sessionId) return session;
                return {
                    ...session,
                    levels: session.levels.map((level) => {
                        if ((level as Level).batchId !== levelBatchId) return level;
                        const currentLevel = level as Level;
                        const newSubgroups = [
                            ...(currentLevel.subgroups ?? []),
                            { subgroupName: '' },
                        ];
                        return {
                            ...currentLevel,
                            containsSubgroup: true,
                            subgroups: newSubgroups,
                        };
                    }),
                };
            });
            form.setValue('sessions', ensureNewSessionAndLevelFlags(updated));
            return updated;
        });
    };

    const handleLevelSubgroupNameChange = (
        sessionId: string,
        levelBatchId: string,
        index: number,
        name: string
    ) => {
        setSessions((prev) => {
            const updated = prev.map((session) => {
                if (session.id !== sessionId) return session;
                return {
                    ...session,
                    levels: session.levels.map((level) => {
                        if ((level as Level).batchId !== levelBatchId) return level;
                        const currentLevel = level as Level;
                        const subgroups = [...(currentLevel.subgroups ?? [])];
                        if (!subgroups[index]) return currentLevel;
                        subgroups[index] = { ...subgroups[index], subgroupName: name };
                        return {
                            ...currentLevel,
                            containsSubgroup: subgroups.length > 0,
                            subgroups,
                        };
                    }),
                };
            });
            form.setValue('sessions', ensureNewSessionAndLevelFlags(updated));
            return updated;
        });
    };

    const handleRemoveLevelSubgroupRow = (
        sessionId: string,
        levelBatchId: string,
        index: number
    ) => {
        setSessions((prev) => {
            const updated = prev.map((session) => {
                if (session.id !== sessionId) return session;
                return {
                    ...session,
                    levels: session.levels.map((level) => {
                        if ((level as Level).batchId !== levelBatchId) return level;
                        const currentLevel = level as Level;
                        const remaining = (currentLevel.subgroups ?? []).filter(
                            (_: Subgroup, i: number) => i !== index
                        );
                        return {
                            ...currentLevel,
                            containsSubgroup: remaining.length > 0,
                            subgroups: remaining,
                        };
                    }),
                };
            });
            form.setValue('sessions', ensureNewSessionAndLevelFlags(updated));
            return updated;
        });
    };

    const handleInviteSuccess = (
        id: string,
        name: string,
        email: string,
        profilePicId: string,
        roles?: string[]
    ) => {
        if (!id || !email || !name) return;

        const newInstructor: Instructor = { id, name, email, profilePicId, roles };

        // Add to available instructors if not already there
        setInstructors((prev) => {
            if (!prev.some((i) => i.email === email)) {
                return [...prev, newInstructor];
            }
            return prev;
        });

        // Add to selected instructors if not already present
        setSelectedInstructors((prev) => {
            const safePrev = Array.isArray(prev) ? prev : [];
            const alreadySelected = safePrev.some((i) => i.email === newInstructor.email);
            if (alreadySelected) return safePrev;

            // Automatically open assignment card for this instructor
            setSelectedInstructorId(newInstructor.id);
            setSelectedInstructorEmail(newInstructor.email);
            setShowAssignmentCard(true);

            // --- Assign all batches (sessions/levels) automatically ---
            const allSessionLevels: Array<{
                sessionId: string;
                sessionName: string;
                levelId: string;
                levelName: string;
                batchId?: string;
            }> = [];
            if (hasSessions === 'yes' && hasLevels === 'yes') {
                sessions.forEach((session: Session) => {
                    session.levels.forEach((level: Level) => {
                        allSessionLevels.push({
                            sessionId: session.id,
                            sessionName: session.name,
                            levelId: level.id,
                            levelName: level.name,
                            batchId: level.batchId,
                        });
                    });
                });
            } else if (hasSessions === 'yes' && hasLevels !== 'yes') {
                sessions.forEach((session: Session) => {
                    allSessionLevels.push({
                        sessionId: session.id,
                        sessionName: session.name,
                        levelId: 'DEFAULT',
                        levelName: '',
                    });
                });
            } else if (hasSessions !== 'yes' && hasLevels === 'yes') {
                const standaloneSession = sessions.find((s: Session) => s.id === 'DEFAULT');
                if (standaloneSession) {
                    standaloneSession.levels.forEach((level: Level) => {
                        allSessionLevels.push({
                            sessionId: 'DEFAULT',
                            sessionName: '',
                            levelId: level.id,
                            levelName: level.name,
                        });
                    });
                }
            }
            setSelectedSessionLevels(allSessionLevels);
            setInstructorMappings((prev) => [
                ...prev,
                {
                    id: newInstructor.id,
                    email: newInstructor.email,
                    sessionLevels: allSessionLevels,
                },
            ]);
            // Also update sessions state to reflect assignment
            setSessions((prevSessions) => {
                const updatedSessions = JSON.parse(JSON.stringify(prevSessions));
                if (hasSessions === 'yes' && hasLevels === 'yes') {
                    updatedSessions.forEach((session: Session) => {
                        session.levels.forEach((level: Level) => {
                            if (!level.userIds.some((i: Instructor) => i.id === newInstructor.id)) {
                                level.userIds.push(newInstructor);
                            }
                        });
                    });
                } else if (hasSessions === 'yes' && hasLevels !== 'yes') {
                    updatedSessions.forEach((session: Session) => {
                        if (session.levels.length === 0) {
                            session.levels = [
                                {
                                    id: 'DEFAULT',
                                    name: '',
                                    userIds: [newInstructor],
                                    batchId: 'DEFAULT',
                                    newLevel: true,
                                    containsSubgroup: false,
                                    subgroups: [],
                                },
                            ];
                        } else {
                            if (
                                session.levels[0]?.userIds &&
                                !session.levels[0].userIds.some(
                                    (i: Instructor) => i.id === newInstructor.id
                                )
                            ) {
                                session.levels[0].userIds.push(newInstructor);
                            }
                        }
                    });
                } else if (hasSessions !== 'yes' && hasLevels === 'yes') {
                    const standaloneSession = updatedSessions.find(
                        (s: Session) => s.id === 'DEFAULT'
                    );
                    if (standaloneSession) {
                        standaloneSession.levels?.forEach((level: Level) => {
                            if (!level.userIds.some((i: Instructor) => i.id === newInstructor.id)) {
                                level.userIds.push(newInstructor);
                            }
                        });
                    }
                }
                form.setValue('sessions', ensureNewSessionAndLevelFlags(updatedSessions));
                return updatedSessions;
            });
            // ---------------------------------------------------------

            return [...safePrev, newInstructor];
        });
    };

    const handleSessionLevelMappingSave = (
        mappings: Array<{
            sessionId: string;
            sessionName: string;
            levelId: string;
            levelName: string;
            batchId?: string;
        }>
    ) => {
        if (selectedInstructorEmail) {
            setInstructorMappings((prev) => {
                const existingIndex = prev.findIndex((m) => m.email === selectedInstructorEmail);
                if (existingIndex >= 0) {
                    const updated = [...prev];
                    updated[existingIndex] = {
                        id: selectedInstructorId,
                        email: selectedInstructorEmail,
                        sessionLevels: mappings,
                    };
                    return updated;
                }
                return [
                    ...prev,
                    {
                        id: selectedInstructorId,
                        email: selectedInstructorEmail,
                        sessionLevels: mappings,
                    },
                ];
            });
        }
    };

    const getInitials = (email: string) => {
        const name = email.split('@')[0];
        return name?.slice(0, 2).toUpperCase();
    };

    // Author-profile metadata (subtitle / description / photo) shown on course pages.
    // Updates the selected instructor, the form value, and every level userIds
    // entry so the metadata is carried through to the create/update payload.
    const handleAuthorMetaChange = (
        instructorId: string,
        field: 'authorSubtitle' | 'authorDescription' | 'profilePicId' | 'roleLabel',
        value: string
    ) => {
        setSelectedInstructors((prev) => {
            const safePrev = Array.isArray(prev) ? prev : [];
            const updated = safePrev.map((i) =>
                i.id === instructorId ? { ...i, [field]: value } : i
            );
            form.setValue('selectedInstructors', updated);
            return updated;
        });

        setSessions((prevSessions) => {
            const updatedSessions = prevSessions.map((session) => ({
                ...session,
                levels: session.levels.map((level) => ({
                    ...level,
                    userIds: level.userIds.map((user) =>
                        user.id === instructorId ? { ...user, [field]: value } : user
                    ),
                })),
            }));
            form.setValue('sessions', ensureNewSessionAndLevelFlags(updatedSessions));
            return updatedSessions;
        });
    };

    // Per-course role choices: presets plus any custom word already used here.
    const authorRoleChoices = useMemo(
        () =>
            authorRoleOptions(
                (Array.isArray(selectedInstructors) ? selectedInstructors : []).map(
                    (i) => i.roleLabel
                )
            ),
        [selectedInstructors]
    );

    // Author photo: uploaded like the Teams member photo, saved onto the user
    // (profile_pic_file_id) when the course is saved.
    const [authorPhotoUrls, setAuthorPhotoUrls] = useState<Record<string, string>>({});
    const [uploadingAuthorPhotoFor, setUploadingAuthorPhotoFor] = useState<string | null>(null);
    const requestedAuthorPhotoIds = useRef(new Set<string>());

    useEffect(() => {
        (Array.isArray(selectedInstructors) ? selectedInstructors : []).forEach(
            ({ profilePicId }) => {
                if (!profilePicId || requestedAuthorPhotoIds.current.has(profilePicId)) return;
                requestedAuthorPhotoIds.current.add(profilePicId);
                getPublicUrl(profilePicId)
                    .then((url) => {
                        if (url) setAuthorPhotoUrls((prev) => ({ ...prev, [profilePicId]: url }));
                    })
                    .catch(() => undefined);
            }
        );
    }, [selectedInstructors]);

    const handleAuthorPhotoUpload = async (instructorId: string, file?: File) => {
        if (!file) return;
        if (!file.type.startsWith('image/')) {
            toast.error('Please choose an image file.');
            return;
        }
        setUploadingAuthorPhotoFor(instructorId);
        try {
            const fileId = await UploadFileInS3Public(
                file,
                () => undefined,
                instituteId,
                'STUDENTS'
            );
            if (!fileId) throw new Error('no file id');
            handleAuthorMetaChange(instructorId, 'profilePicId', fileId);
        } catch {
            toast.error('Photo upload failed. Please try again.');
        } finally {
            setUploadingAuthorPhotoFor(null);
        }
    };

    const handlePublishChange = (checked: boolean | 'indeterminate') => {
        setPublishToCatalogue(checked === true);
    };

    // Add standalone level
    const addStandaloneLevel = () => {
        if (limitLevelsToOne && !canAddMoreLevels) {
            return;
        }
        if (newLevelName.trim()) {
            const id = Date.now().toString();
            const dummySession: Session & { newSession: boolean } = {
                id: 'DEFAULT',
                name: 'DEFAULT',
                startDate: new Date().toISOString(),
                levels: [],
                newSession: true,
            };
            const newLevel: Level & { newLevel: boolean } = {
                id,
                name: newLevelName.trim(),
                userIds: [],
                batchId: id,
                newLevel: true,
                containsSubgroup: false,
                subgroups: [],
            };
            const standaloneSession = sessions.find((s) => s.id === 'DEFAULT');
            if (!standaloneSession) {
                setSessions([{ ...dummySession, levels: [newLevel] }]);
                form.setValue(
                    'sessions',
                    ensureNewSessionAndLevelFlags([{ ...dummySession, levels: [newLevel] }])
                );
            } else {
                const updatedSessions = sessions.map((session) =>
                    session.id === 'DEFAULT'
                        ? { ...session, levels: [...session.levels, newLevel] }
                        : session
                );
                setSessions(updatedSessions);
                form.setValue('sessions', ensureNewSessionAndLevelFlags(updatedSessions));
            }
            setNewLevelName('');
            setShowAddLevel(false);
        }
    };

    const addExistingStandaloneLevel = (batch: ExistingBatch) => {
        if (!canAddMoreLevels) {
            return;
        }
        setSessions((prevSessions) => {
            const standaloneSession = prevSessions.find((s) => s.id === 'DEFAULT');
            const levelExists = standaloneSession?.levels.some(
                (level) => level.id === batch.level.id
            );
            if (levelExists) {
                return prevSessions;
            }

            const newLevel: Level & { newLevel: boolean } = {
                id: batch.level.id,
                name: batch.level.level_name,
                userIds: [],
                batchId: batch.id,
                newLevel: false,
                containsSubgroup: false,
                subgroups: [],
            };

            const nextSessions = standaloneSession
                ? prevSessions.map((session) =>
                      session.id === 'DEFAULT'
                          ? { ...session, levels: [...session.levels, newLevel] }
                          : session
                  )
                : [
                      ...prevSessions,
                      {
                          id: 'DEFAULT',
                          name: 'DEFAULT',
                          startDate: new Date().toISOString(),
                          levels: [newLevel],
                          newSession: true,
                      },
                  ];

            const sanitized = ensureBatchIdInLevels(nextSessions);
            form.setValue('sessions', ensureNewSessionAndLevelFlags(sanitized));
            return sanitized;
        });

        setUsedExistingBatchIds((prev) => {
            const newSet = new Set(prev);
            newSet.add(batch.id);
            return newSet;
        });

        if (limitLevelsToOne) {
            setShowAddLevel(false);
        }
    };

    // Remove standalone level
    const removeStandaloneLevel = (batchId: string) => {
        if (!batchId) return;
        const updatedSessions = sessions.map((session) =>
            session.id === 'DEFAULT'
                ? {
                      ...session,
                      levels: session.levels.filter((level) => level.batchId !== batchId),
                  }
                : session
        );
        setSessions(updatedSessions);
        form.setValue('sessions', ensureNewSessionAndLevelFlags(updatedSessions));
        // Remove this level from all instructors
        setInstructorMappings((prev) =>
            prev.map((instructor) => ({
                ...instructor,
                sessionLevels: instructor.sessionLevels.filter(
                    (sl) => sl.batchId !== batchId && sl.levelId !== batchId
                ),
            }))
        );
        setUsedExistingBatchIds((prev) => {
            const newSet = new Set(prev);
            newSet.delete(batchId);
            return newSet;
        });
    };

    // Function to handle checkbox changes
    const handleSessionLevelCheckboxChange = (
        sessionId: string,
        sessionName: string,
        levelId: string,
        levelName: string
    ) => {
        setSelectedSessionLevels((prev) => {
            const exists = prev.some(
                (item) => item.sessionId === sessionId && item.levelId === levelId
            );

            if (exists) {
                return prev.filter(
                    (item) => !(item.sessionId === sessionId && item.levelId === levelId)
                );
            } else {
                return [...prev, { sessionId, sessionName, levelId, levelName }];
            }
        });
    };

    // Function to handle assignment save
    const handleAssignmentSave = () => {
        if (selectedInstructorId && selectedInstructorEmail) {
            let updatedSessions: Session[] = [];

            if (hasSessions !== 'yes' && hasLevels !== 'yes') {
                // When both are 'no', create or update the default session with default level
                if (sessions.length === 0) {
                    // Create default session and level if they don't exist
                    updatedSessions = [
                        {
                            id: 'DEFAULT',
                            name: '',
                            startDate: '',
                            levels: [
                                {
                                    id: 'DEFAULT',
                                    name: '',
                                    userIds: selectedInstructors.map((instructor) => instructor),
                                    batchId: 'DEFAULT',
                                    containsSubgroup: false,
                                    subgroups: [],
                                },
                            ],
                        },
                    ];
                } else {
                    // Update existing default session
                    updatedSessions = sessions.map((session) => ({
                        ...session,
                        levels: session.levels.map((level) => ({
                            ...level,
                            userIds: selectedInstructors.map((instructor) => instructor),
                        })),
                    }));
                }
            } else {
                // First, remove the instructor from all levels they were previously assigned to
                updatedSessions = sessions.map((session) => ({
                    ...session,
                    levels: session.levels.map((level) => ({
                        ...level,
                        userIds: level.userIds.filter(
                            (instructor) => instructor.id !== selectedInstructorId
                        ),
                    })),
                }));

                // Then, add the instructor object to newly selected levels
                selectedSessionLevels.forEach(({ sessionId, levelId }) => {
                    const instructorObj = selectedInstructors.find(
                        (i) => i.id === selectedInstructorId
                    );
                    if (!instructorObj) return;
                    if (hasSessions === 'yes') {
                        // Handle sessions case
                        const session = updatedSessions.find((s: Session) => s.id === sessionId);
                        if (session) {
                            if (hasLevels === 'yes') {
                                // For sessions with levels, add to specific level
                                const level = session.levels.find((l: Level) => l.id === levelId);
                                if (
                                    level &&
                                    !level.userIds.some(
                                        (i: Instructor) => i.id === instructorObj.id
                                    )
                                ) {
                                    level.userIds.push(instructorObj);
                                }
                            } else {
                                // For sessions without levels, add to the default level
                                if (session.levels.length === 0) {
                                    // If no default level exists, create one
                                    session.levels = [
                                        {
                                            id: 'DEFAULT',
                                            name: '',
                                            userIds: [instructorObj],
                                            batchId: 'DEFAULT',
                                            containsSubgroup: false,
                                            subgroups: [],
                                        },
                                    ];
                                } else if (
                                    session.levels[0] &&
                                    !session.levels[0].userIds.some(
                                        (i: Instructor) => i.id === instructorObj.id
                                    )
                                ) {
                                    // Add to existing default level
                                    session.levels[0].userIds.push(instructorObj);
                                }
                            }
                        }
                    } else if (hasLevels === 'yes') {
                        // Handle levels-only case
                        const standaloneSession = updatedSessions.find(
                            (s: Session) => s.id === 'DEFAULT'
                        );
                        if (standaloneSession) {
                            const level = standaloneSession.levels.find(
                                (l: Level) => l.id === levelId
                            );
                            if (
                                level &&
                                !level.userIds.some((i: Instructor) => i.id === instructorObj.id)
                            ) {
                                level.userIds.push(instructorObj);
                            }
                        }
                    }
                });
            }

            setSessions(updatedSessions);
            form.setValue('sessions', ensureNewSessionAndLevelFlags(updatedSessions));
            form.setValue('selectedInstructors', selectedInstructors);

            // Update instructor mappings
            setInstructorMappings((prev) => {
                const existingIndex = prev.findIndex((m) => m.id === selectedInstructorId);
                if (existingIndex >= 0) {
                    const updated = [...prev];
                    updated[existingIndex] = {
                        id: selectedInstructorId,
                        email: selectedInstructorEmail,
                        sessionLevels: selectedSessionLevels,
                    };
                    return updated;
                }
                return [
                    ...prev,
                    {
                        id: selectedInstructorId,
                        email: selectedInstructorEmail,
                        sessionLevels: selectedSessionLevels,
                    },
                ];
            });
        }
        setShowAssignmentCard(false);
        setSelectedSessionLevels([]);
    };

    useEffect(() => {
        if (initialData) {
            // Deduplicate selected instructors by id
            const initialSelectedInstructors = form.getValues('selectedInstructors') || [];
            const dedupedSelectedInstructors = initialSelectedInstructors.filter(
                (instructor, idx, arr) => arr.findIndex((i) => i.id === instructor.id) === idx
            );
            setSelectedInstructors(dedupedSelectedInstructors);
            // Normalize session id for standalone levels
            // Prefer initialData.sessions when editing; fall back to current form values or state
            const sourceSessions =
                (initialData.sessions as any[]) || form.getValues('sessions') || sessions || [];
            const sessionsWithBatchIdLevels = sourceSessions.map((session) => ({
                ...session,
                id: hasSessions !== 'yes' && hasLevels === 'yes' ? 'DEFAULT' : session.id,
                name: hasSessions !== 'yes' && hasLevels === 'yes' ? 'DEFAULT' : session.name,
                levels: (session.levels || []).map((level: Level) => ({
                    ...level,
                    batchId: (level as Level).batchId || level.id,
                })),
            }));
            setSessions(sessionsWithBatchIdLevels);
            // Aggregate instructor mappings from session data
            const instructorMappingsFromSessions: InstructorMapping[] = [];
            sessionsWithBatchIdLevels.forEach((session) => {
                session.levels?.forEach((level: Level) => {
                    level.userIds?.forEach((instructor: Instructor) => {
                        const sessionLevelMapping = {
                            sessionId: session.id,
                            sessionName: session.name,
                            levelId: level.id,
                            levelName: level.name,
                            batchId: level.batchId,
                        };
                        // Find or create mapping for this instructor
                        const mapping = instructorMappingsFromSessions.find(
                            (m) => m.id === instructor.id
                        );
                        if (mapping) {
                            // Only add if not already present (dedupe by sessionId+levelId)
                            if (
                                !mapping.sessionLevels.some(
                                    (sl) => sl.sessionId === session.id && sl.levelId === level.id
                                )
                            ) {
                                mapping.sessionLevels.push(sessionLevelMapping);
                            }
                        } else {
                            instructorMappingsFromSessions.push({
                                id: instructor.id,
                                email: instructor.email,
                                sessionLevels: [sessionLevelMapping],
                            });
                        }
                    });
                });
            });
            // Merge mappings for instructors with the same id (in case of duplicates)
            const mergedMappings: InstructorMapping[] = [];
            instructorMappingsFromSessions.forEach((mapping) => {
                const existing = mergedMappings.find((m) => m.id === mapping.id);
                if (existing) {
                    // Merge and dedupe sessionLevels
                    const allSessionLevels = [...existing.sessionLevels, ...mapping.sessionLevels];
                    existing.sessionLevels = allSessionLevels.filter(
                        (sl, idx, arr) =>
                            arr.findIndex(
                                (item) =>
                                    item.sessionId === sl.sessionId && item.levelId === sl.levelId
                            ) === idx
                    );
                } else {
                    mergedMappings.push({ ...mapping });
                }
            });
            setInstructorMappings(mergedMappings);
        }
    }, [initialData]);

    // Effect to update form when state changes
    useEffect(() => {
        form.setValue('hasLevels', hasLevels);
        form.setValue('hasSessions', hasSessions);
        form.setValue('sessions', ensureNewSessionAndLevelFlags(sessions));
        form.setValue('instructors', instructors);
        form.setValue('publishToCatalogue', publishToCatalogue);
    }, [hasLevels, hasSessions, sessions, instructors, publishToCatalogue, form]);

    // Effect to handle course settings changes (only for new courses, not edits)
    useEffect(() => {
        if (!isEdit) {
            if (
                courseSettings?.courseStructure?.enableSessions === false &&
                hasSessions === 'yes'
            ) {
                setHasSessions('no');
            }
            if (courseSettings?.courseStructure?.enableLevels === false && hasLevels === 'yes') {
                setHasLevels('no');
            }
        }
        // Auto-set course depth when fixCourseDepth is true (only for new courses)
        if (courseSettings?.courseStructure?.fixCourseDepth && !isEdit) {
            const defaultDepth = courseSettings.courseStructure.defaultDepth || 3;
            form.setValue('levelStructure', defaultDepth);
        }
        // Auto-set catalogue publishing when autoPublishToCatalogue is true
        if (
            courseSettings?.catalogueSettings?.autoPublishToCatalogue &&
            !initialData?.publishToCatalogue
        ) {
            setPublishToCatalogue(true);
        }
    }, [courseSettings, hasSessions, hasLevels, form, initialData]);

    useEffect(() => {
        // Every active staff member, not the endpoint's default first 10: the author
        // picker searches this list client-side.
        fetchInstituteDashboardUsers(
            instituteId,
            {
                roles: RoleTypeExceptStudent,
                status: [{ id: '1', name: 'ACTIVE' }],
            },
            0,
            1000
        )
            .then((res) => {
                // API may return a plain array or paginated { content: [...] }
                const usersList = Array.isArray(res) ? res : res?.content || [];
                const allInstructors = usersList.map((instructor: UserRolesDataEntry) => ({
                    id: instructor.id,
                    email: instructor.email,
                    name: instructor.full_name,
                    profilePicId: instructor.profile_pic_file_id ?? '',
                    roles: instructor.roles?.map((role) => role.role_name) || [],
                    authorSubtitle: instructor.author_subtitle,
                    authorDescription: instructor.author_description,
                }));

                setInstructors(allInstructors);

                // Auto-add the current logged-in user as an instructor if they're in the list
                if (tokenData?.email && !isEdit) {
                    const currentUser = allInstructors.find(
                        (instructor: Instructor) => instructor.email === tokenData.email
                    );

                    if (currentUser) {
                        // Add current user to selected instructors automatically
                        setSelectedInstructors([currentUser]);
                    }
                }
            })
            .catch((err) => {
                console.error(err);
            });
    }, [tokenData?.email, isEdit]);

    // Auto-assign current user to all sessions and levels when creating a new course
    useEffect(() => {
        if (
            !isEdit &&
            tokenData?.email &&
            selectedInstructors.length === 1 &&
            sessions.length > 0
        ) {
            const currentUser = selectedInstructors[0];

            if (currentUser?.email === tokenData.email && instructorMappings.length === 0) {
                // Auto-assign current user to all sessions and levels
                const updatedSessions = sessions.map((session) => ({
                    ...session,
                    levels: session.levels.map((level) => ({
                        ...level,
                        userIds: [...level.userIds, currentUser],
                    })),
                }));

                setSessions(updatedSessions);

                // Add to instructor mappings
                const allSessionLevels = getAllSessionLevelsForInstructor(
                    updatedSessions,
                    hasSessions,
                    hasLevels
                );

                setInstructorMappings([
                    {
                        id: currentUser.id,
                        email: currentUser.email,
                        sessionLevels: allSessionLevels,
                    },
                ]);
            }
        }
    }, [
        tokenData?.email,
        selectedInstructors.length,
        sessions.length,
        instructorMappings.length,
        isEdit,
    ]);

    // Effect to update form when sessions change
    useEffect(() => {
        form.setValue('sessions', ensureNewSessionAndLevelFlags(sessions));
    }, [sessions, form]);

    // Auto-open panels and set default tabs based on availability
    const prevHasSessionsRef = useRef<string>(hasSessions);
    const prevHasLevelsRef = useRef<string>(hasLevels);

    useEffect(() => {
        // When sessions are turned on by the user, or already enabled on mount, open Add Session panel and choose tab
        const prevHasSessions = prevHasSessionsRef.current;
        if (
            !isEdit &&
            hasSessions === 'yes' &&
            (prevHasSessions !== 'yes' || sessions.length === 0)
        ) {
            const hasExistingOptions =
                hasLevels === 'yes'
                    ? availableExistingBatches.length > 0
                    : getDeduplicatedSessions(availableExistingBatches).length > 0;
            setShowAddSession(true);
            setAddSessionMode(hasExistingOptions ? 'existing' : 'new');
        }
        prevHasSessionsRef.current = hasSessions;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [hasSessions, hasLevels, availableExistingBatches.length]);

    useEffect(() => {
        // When levels-only mode is turned on by the user, or already enabled on mount, open Add Level panel and choose tab
        const prevHasLevels = prevHasLevelsRef.current;
        if (
            !isEdit &&
            hasSessions !== 'yes' &&
            hasLevels === 'yes' &&
            canAddMoreLevels &&
            (prevHasLevels !== 'yes' || sessions.length === 0)
        ) {
            const hasExistingLevels = availableExistingBatchesForStandalone.length > 0;
            setShowAddLevel(true);
            setAddLevelMode(hasExistingLevels ? 'existing' : 'new');
        }
        prevHasLevelsRef.current = hasLevels;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [hasLevels, hasSessions, availableExistingBatchesForStandalone.length, canAddMoreLevels]);

    return (
        <>
            <Form {...form}>
                {/* The form is a flex child of the dialog column, so it must be
                    flex-1/min-h-0 (not h-full, which ignored the dialog header and
                    overflowed) and the footer a normal shrink-0 child. It used to be
                    position:fixed, which inside the translated DialogContent is
                    resolved against that box and floated over the scrolling body --
                    a long author description rendered straight through it. */}
                <form
                    onSubmit={form.handleSubmit(handleSubmit)}
                    className="flex min-h-0 flex-1 flex-col"
                >
                    <div className="min-h-0 flex-1 overflow-y-auto pb-6">
                        <Card className="w-full rounded-none border-none bg-white shadow-sm">
                            <div className="flex items-center justify-between border-b border-gray-100 p-5">
                                <div>
                                    <div className="mt-1 flex items-center gap-2">
                                        <span className="text-sm text-gray-600">Step 2</span>
                                        <span className="text-sm font-medium text-gray-900">
                                            {getTerminology(
                                                ContentTerms.Course,
                                                SystemTerms.Course
                                            )}{' '}
                                            Structure
                                        </span>
                                    </div>
                                </div>
                            </div>

                            <CardContent className="space-y-6 p-5">
                                {/* Structure Selection */}
                                {!isEdit && !courseSettings?.courseStructure?.fixCourseDepth && (
                                    <div>
                                        <h3 className="mb-3 text-base font-medium text-gray-900">
                                            Select{' '}
                                            {getTerminology(
                                                ContentTerms.Course,
                                                SystemTerms.Course
                                            ).toLocaleLowerCase()}{' '}
                                            structure that is suitable for your institute
                                        </h3>
                                        <AddCourseStep2StructureTypes
                                            form={form}
                                            courseSettings={courseSettings}
                                        />
                                    </div>
                                )}

                                {/* Fixed Course Depth Indicator hidden intentionally when depth is fixed */}

                                {instituteId !== CODE_CIRCLE_INSTITUTE_ID &&
                                    !isEdit &&
                                    courseSettings?.courseStructure?.enableSessions !== false && (
                                        <>
                                            {!isEdit && <Separator className="bg-gray-200" />}
                                            <div className="space-y-2">
                                                <Label className="block text-base font-medium text-gray-900">
                                                    Contains{' '}
                                                    {getTerminology(
                                                        ContentTerms.Session,
                                                        SystemTerms.Session
                                                    )}
                                                    s?
                                                </Label>
                                                <p className="text-sm text-gray-600">
                                                    {getTerminology(
                                                        ContentTerms.Session,
                                                        SystemTerms.Session
                                                    )}{' '}
                                                    organize a{' '}
                                                    {getTerminology(
                                                        ContentTerms.Course,
                                                        SystemTerms.Course
                                                    ).toLocaleLowerCase()}{' '}
                                                    into different batches or time periods. For eg:
                                                    January 2025 Batch, February 2025 Batch
                                                </p>
                                                <RadioGroup
                                                    value={hasSessions}
                                                    onValueChange={(value) => {
                                                        setHasSessions(value);
                                                        // Clear sessions when switching to 'no'
                                                        if (value === 'no') {
                                                            setSessions(
                                                                sessions.map((session) => ({
                                                                    ...session,
                                                                    levels: [],
                                                                }))
                                                            );
                                                        }
                                                    }}
                                                    className="flex gap-6"
                                                >
                                                    <div className="flex items-center space-x-2">
                                                        <RadioGroupItem
                                                            value="yes"
                                                            id="sessions-yes"
                                                        />
                                                        <Label
                                                            htmlFor="sessions-yes"
                                                            className="text-sm font-normal"
                                                        >
                                                            Yes
                                                        </Label>
                                                    </div>
                                                    <div className="flex items-center space-x-2">
                                                        <RadioGroupItem
                                                            value="no"
                                                            id="sessions-no"
                                                        />
                                                        <Label
                                                            htmlFor="sessions-no"
                                                            className="text-sm font-normal"
                                                        >
                                                            No
                                                        </Label>
                                                    </div>
                                                </RadioGroup>
                                            </div>
                                        </>
                                    )}

                                {!isEdit &&
                                    courseSettings?.courseStructure?.enableLevels !== false && (
                                        <Separator className="bg-gray-200" />
                                    )}

                                {/* Contains Levels Radio */}
                                {!isEdit &&
                                    courseSettings?.courseStructure?.enableLevels !== false && (
                                        <div className="space-y-2">
                                            <Label className="block text-base font-medium text-gray-900">
                                                Contains{' '}
                                                {getTerminology(
                                                    ContentTerms.Level,
                                                    SystemTerms.Level
                                                )}
                                                s?
                                            </Label>
                                            <p className="text-sm text-gray-600">
                                                {getTerminology(
                                                    ContentTerms.Level,
                                                    SystemTerms.Level
                                                )}{' '}
                                                organize a{' '}
                                                {getTerminology(
                                                    ContentTerms.Course,
                                                    SystemTerms.Course
                                                ).toLocaleLowerCase()}{' '}
                                                into structured learning stages. These stages may
                                                represent increasing difficulty, different modules,
                                                or key milestones within the{' '}
                                                {getTerminology(
                                                    ContentTerms.Course,
                                                    SystemTerms.Course
                                                ).toLocaleLowerCase()}{' '}
                                                . For eg: Basic, Advanced
                                            </p>
                                            <RadioGroup
                                                value={hasLevels}
                                                onValueChange={(value) => {
                                                    setHasLevels(value);
                                                    // Clear levels when switching to 'no'
                                                    if (value === 'no') {
                                                        setSessions(
                                                            sessions.map((session) => ({
                                                                ...session,
                                                                levels: [],
                                                            }))
                                                        );
                                                    }
                                                }}
                                                className="flex gap-6"
                                            >
                                                <div className="flex items-center space-x-2">
                                                    <RadioGroupItem value="yes" id="levels-yes" />
                                                    <Label
                                                        htmlFor="levels-yes"
                                                        className="text-sm font-normal"
                                                    >
                                                        Yes
                                                    </Label>
                                                </div>
                                                <div className="flex items-center space-x-2">
                                                    <RadioGroupItem value="no" id="levels-no" />
                                                    <Label
                                                        htmlFor="levels-no"
                                                        className="text-sm font-normal"
                                                    >
                                                        No
                                                    </Label>
                                                </div>
                                            </RadioGroup>
                                        </div>
                                    )}

                                {/* Contains Subgroup Radio
                                 * Only show when sessions are enabled for the course
                                 * AND the global course settings default filter is
                                 * restricted to parents/children (not ALL).
                                 */}
                                {hasSessions === 'yes' && enableSubgroupControls && (
                                    <>
                                        <Separator className="bg-gray-200" />
                                        <div className="space-y-2">
                                            <Label className="block text-base font-medium text-gray-900">
                                                Contains subgroup?
                                            </Label>
                                            <p className="text-sm text-gray-600">
                                                Subgroups let you split a single batch into smaller
                                                groups (for example, Morning Batch A, Morning Batch
                                                B). All subgroups will be created under the same{' '}
                                                {getTerminology(
                                                    ContentTerms.Session,
                                                    SystemTerms.Session
                                                ).toLocaleLowerCase()}{' '}
                                                and{' '}
                                                {getTerminology(
                                                    ContentTerms.Level,
                                                    SystemTerms.Level
                                                ).toLocaleLowerCase()}{' '}
                                                configured for this{' '}
                                                {getTerminology(
                                                    ContentTerms.Course,
                                                    SystemTerms.Course
                                                ).toLocaleLowerCase()}
                                                .
                                            </p>
                                            <RadioGroup
                                                value={containsSubgroup ? 'yes' : 'no'}
                                                onValueChange={(value) =>
                                                    handleToggleContainsSubgroup(
                                                        value as 'yes' | 'no'
                                                    )
                                                }
                                                className="flex gap-6"
                                            >
                                                <div className="flex items-center space-x-2">
                                                    <RadioGroupItem value="yes" id="subgroup-yes" />
                                                    <Label
                                                        htmlFor="subgroup-yes"
                                                        className="text-sm font-normal"
                                                    >
                                                        Yes
                                                    </Label>
                                                </div>
                                                <div className="flex items-center space-x-2">
                                                    <RadioGroupItem value="no" id="subgroup-no" />
                                                    <Label
                                                        htmlFor="subgroup-no"
                                                        className="text-sm font-normal"
                                                    >
                                                        No
                                                    </Label>
                                                </div>
                                            </RadioGroup>
                                        </div>
                                    </>
                                )}

                                {/* Subgroups configuration */}
                                {hasSessions === 'yes' &&
                                    enableSubgroupControls &&
                                    containsSubgroup && (
                                        <div className="space-y-2 rounded-lg border border-gray-200 bg-gray-50 p-3">
                                            <Label className="text-base font-medium text-gray-900">
                                                Subgroups
                                            </Label>
                                            <p className="text-sm text-gray-600">
                                                Subgroups are now configured separately for each
                                                level inside the session cards below. Enable this
                                                option to reveal per-level subgroup inputs.
                                            </p>
                                        </div>
                                    )}

                                {/* Info message when both are No */}
                                {hasSessions !== 'yes' && hasLevels !== 'yes' && (
                                    <div className="rounded-lg border border-blue-200 bg-blue-50 p-3">
                                        <p className="text-sm text-blue-700">
                                            This{' '}
                                            {getTerminology(
                                                ContentTerms.Course,
                                                SystemTerms.Course
                                            ).toLocaleLowerCase()}{' '}
                                            will not have any{' '}
                                            {getTerminology(
                                                ContentTerms.Session,
                                                SystemTerms.Session
                                            )}{' '}
                                            or{' '}
                                            {getTerminology(ContentTerms.Level, SystemTerms.Level)}.
                                            {getTerminology(RoleTerms.Learner, SystemTerms.Learner)}
                                            s will directly access the{' '}
                                            {getTerminology(
                                                ContentTerms.Course,
                                                SystemTerms.Course
                                            ).toLocaleLowerCase()}{' '}
                                            content.
                                        </p>
                                    </div>
                                )}

                                {/* Sessions Management */}
                                {hasSessions === 'yes' && (
                                    <div className="space-y-3">
                                        <div className="flex items-center justify-between">
                                            <div>
                                                <Label className="text-base font-medium text-gray-900">
                                                    {getTerminology(
                                                        ContentTerms.Session,
                                                        SystemTerms.Session
                                                    )}
                                                    s
                                                </Label>
                                                <p className="text-sm text-gray-600">
                                                    {hasLevels === 'yes'
                                                        ? `Create ${getTerminology(
                                                              ContentTerms.Session,
                                                              SystemTerms.Session
                                                          )} and add ${getTerminology(
                                                              ContentTerms.Level,
                                                              SystemTerms.Level
                                                          )} within each ${getTerminology(
                                                              ContentTerms.Session,
                                                              SystemTerms.Session
                                                          )}`
                                                        : 'Create sessions for your ' +
                                                          getTerminology(
                                                              ContentTerms.Course,
                                                              SystemTerms.Course
                                                          ).toLocaleLowerCase()}
                                                </p>
                                            </div>
                                            <MyButton
                                                type="button"
                                                buttonType="secondary"
                                                scale="medium"
                                                layoutVariant="default"
                                                onClick={() => setShowAddSession(true)}
                                                className="font-light"
                                            >
                                                <Plus />
                                                Add{' '}
                                                {getTerminology(
                                                    ContentTerms.Session,
                                                    SystemTerms.Session
                                                )}
                                            </MyButton>
                                        </div>

                                        {showAddSession && (
                                            <Card className="border-gray-200">
                                                <CardContent className="p-3">
                                                    <div className="mb-3">
                                                        <RadioGroup
                                                            value={addSessionMode}
                                                            onValueChange={(val) =>
                                                                setAddSessionMode(
                                                                    val as 'new' | 'existing'
                                                                )
                                                            }
                                                            className="flex gap-6"
                                                        >
                                                            <div className="flex items-center space-x-2">
                                                                <RadioGroupItem
                                                                    value="existing"
                                                                    id="add-session-existing"
                                                                />
                                                                <Label
                                                                    htmlFor="add-session-existing"
                                                                    className="text-sm font-normal"
                                                                >
                                                                    {hasSessions === 'yes' &&
                                                                    hasLevels === 'yes'
                                                                        ? `Existing ${getTerminology(
                                                                              ContentTerms.Session,
                                                                              SystemTerms.Session
                                                                          )}s`
                                                                        : hasSessions === 'yes'
                                                                          ? `Existing ${getTerminology(
                                                                                ContentTerms.Session,
                                                                                SystemTerms.Session
                                                                            )}s`
                                                                          : `Existing ${getTerminology(
                                                                                ContentTerms.Level,
                                                                                SystemTerms.Level
                                                                            )}s`}
                                                                </Label>
                                                            </div>
                                                            <div className="flex items-center space-x-2">
                                                                <RadioGroupItem
                                                                    value="new"
                                                                    id="add-session-new"
                                                                />
                                                                <Label
                                                                    htmlFor="add-session-new"
                                                                    className="text-sm font-normal"
                                                                >
                                                                    New{' '}
                                                                    {hasSessions === 'yes' &&
                                                                    hasLevels === 'yes'
                                                                        ? `${getTerminology(
                                                                              ContentTerms.Session,
                                                                              SystemTerms.Session
                                                                          )}`
                                                                        : hasSessions === 'yes'
                                                                          ? `${getTerminology(
                                                                                ContentTerms.Session,
                                                                                SystemTerms.Session
                                                                            )}`
                                                                          : `${getTerminology(
                                                                                ContentTerms.Level,
                                                                                SystemTerms.Level
                                                                            )}`}
                                                                </Label>
                                                            </div>
                                                        </RadioGroup>
                                                    </div>
                                                    {addSessionMode === 'new' && (
                                                        <div className="grid grid-cols-2 gap-2">
                                                            {hasSessions === 'yes' && (
                                                                <div>
                                                                    <Label className="mb-1 block text-sm font-medium text-gray-700">
                                                                        {getTerminology(
                                                                            ContentTerms.Session,
                                                                            SystemTerms.Session
                                                                        )}{' '}
                                                                        Name
                                                                    </Label>
                                                                    <Input
                                                                        placeholder="e.g., January 2025 Batch"
                                                                        value={newSessionName}
                                                                        onChange={(e) =>
                                                                            setNewSessionName(
                                                                                e.target.value
                                                                            )
                                                                        }
                                                                        className="h-8 border-gray-300"
                                                                    />
                                                                </div>
                                                            )}
                                                            {hasSessions === 'yes' && (
                                                                <div>
                                                                    <Label className="mb-1 block text-sm font-medium text-gray-700">
                                                                        Start Date
                                                                    </Label>
                                                                    <Input
                                                                        type="date"
                                                                        value={newSessionStartDate}
                                                                        onChange={(e) =>
                                                                            setNewSessionStartDate(
                                                                                e.target.value
                                                                            )
                                                                        }
                                                                        className="h-8 border-gray-300"
                                                                    />
                                                                </div>
                                                            )}
                                                            {hasSessions !== 'yes' &&
                                                                hasLevels === 'yes' && (
                                                                    <div className="col-span-2">
                                                                        <Label className="mb-1 block text-sm font-medium text-gray-700">
                                                                            {getTerminology(
                                                                                ContentTerms.Level,
                                                                                SystemTerms.Level
                                                                            )}{' '}
                                                                            Name
                                                                        </Label>
                                                                        <Input
                                                                            placeholder="Enter level name (e.g., Basic)"
                                                                            value={newLevelName}
                                                                            onChange={(e) =>
                                                                                setNewLevelName(
                                                                                    e.target.value
                                                                                )
                                                                            }
                                                                            className="h-8 border-gray-300"
                                                                        />
                                                                    </div>
                                                                )}
                                                        </div>
                                                    )}
                                                    {addSessionMode === 'existing' && (
                                                        <div className="mt-2">
                                                            {/* Existing batch/session/level selection UI */}
                                                            {hasSessions === 'yes' &&
                                                                hasLevels === 'yes' && (
                                                                    <>
                                                                        <Label className="mb-2 block text-sm font-medium text-gray-700">
                                                                            Select Batches
                                                                        </Label>
                                                                        {availableExistingBatches.length ===
                                                                        0 ? (
                                                                            <div className="text-sm text-gray-500">
                                                                                No existing sessions
                                                                                found.
                                                                            </div>
                                                                        ) : (
                                                                            <>
                                                                                <div className="mb-2 flex items-center">
                                                                                    <Checkbox
                                                                                        checked={
                                                                                            availableExistingBatches.length >
                                                                                                0 &&
                                                                                            selectedExistingBatchIds.length ===
                                                                                                availableExistingBatches.length
                                                                                        }
                                                                                        onCheckedChange={() => {
                                                                                            if (
                                                                                                selectedExistingBatchIds.length ===
                                                                                                availableExistingBatches.length
                                                                                            ) {
                                                                                                setSelectedExistingBatchIds(
                                                                                                    []
                                                                                                );
                                                                                            } else {
                                                                                                setSelectedExistingBatchIds(
                                                                                                    availableExistingBatches.map(
                                                                                                        (
                                                                                                            b: ExistingBatch
                                                                                                        ) =>
                                                                                                            b.id
                                                                                                    )
                                                                                                );
                                                                                            }
                                                                                        }}
                                                                                        className="mr-2 size-4"
                                                                                        style={{
                                                                                            display:
                                                                                                availableExistingBatches.length ===
                                                                                                0
                                                                                                    ? 'none'
                                                                                                    : undefined,
                                                                                        }}
                                                                                    />
                                                                                    {availableExistingBatches.length >
                                                                                        0 && (
                                                                                        <span className="text-sm font-medium text-gray-700">
                                                                                            Select
                                                                                            All
                                                                                        </span>
                                                                                    )}
                                                                                </div>
                                                                                <div className="max-h-48 space-y-1 overflow-y-auto">
                                                                                    {availableExistingBatches.map(
                                                                                        (
                                                                                            batch: ExistingBatch
                                                                                        ) => (
                                                                                            <div
                                                                                                key={
                                                                                                    batch.id
                                                                                                }
                                                                                                className="flex items-center gap-2 rounded border border-gray-100 bg-gray-50 px-2 py-1"
                                                                                            >
                                                                                                <Checkbox
                                                                                                    checked={selectedExistingBatchIds.includes(
                                                                                                        batch.id
                                                                                                    )}
                                                                                                    onCheckedChange={() => {
                                                                                                        if (
                                                                                                            selectedExistingBatchIds.includes(
                                                                                                                batch.id
                                                                                                            )
                                                                                                        ) {
                                                                                                            setSelectedExistingBatchIds(
                                                                                                                selectedExistingBatchIds.filter(
                                                                                                                    (
                                                                                                                        id
                                                                                                                    ) =>
                                                                                                                        id !==
                                                                                                                        batch.id
                                                                                                                )
                                                                                                            );
                                                                                                        } else {
                                                                                                            setSelectedExistingBatchIds(
                                                                                                                [
                                                                                                                    ...selectedExistingBatchIds,
                                                                                                                    batch.id,
                                                                                                                ]
                                                                                                            );
                                                                                                        }
                                                                                                    }}
                                                                                                    className="size-4"
                                                                                                />
                                                                                                <span className="text-sm text-gray-700">
                                                                                                    {hasSessions ===
                                                                                                        'yes' &&
                                                                                                    hasLevels ===
                                                                                                        'yes'
                                                                                                        ? `${batch.session.session_name} - ${batch.level.level_name}`
                                                                                                        : batch
                                                                                                              .session
                                                                                                              .session_name}
                                                                                                </span>
                                                                                            </div>
                                                                                        )
                                                                                    )}
                                                                                </div>
                                                                            </>
                                                                        )}
                                                                    </>
                                                                )}
                                                            {hasSessions === 'yes' &&
                                                                hasLevels !== 'yes' && (
                                                                    <>
                                                                        <Label className="mb-2 block text-sm font-medium text-gray-700">
                                                                            Select{' '}
                                                                            {getTerminology(
                                                                                ContentTerms.Session,
                                                                                SystemTerms.Session
                                                                            )}
                                                                            s
                                                                        </Label>
                                                                        {getDeduplicatedSessions(
                                                                            availableExistingBatches
                                                                        ).length === 0 ? (
                                                                            <div className="text-sm text-gray-500">
                                                                                No existing sessions
                                                                                found.
                                                                            </div>
                                                                        ) : (
                                                                            <>
                                                                                <div className="mb-2 flex items-center">
                                                                                    <Checkbox
                                                                                        checked={
                                                                                            getDeduplicatedSessions(
                                                                                                availableExistingBatches
                                                                                            )
                                                                                                .length >
                                                                                                0 &&
                                                                                            selectedExistingBatchIds.length ===
                                                                                                getDeduplicatedSessions(
                                                                                                    availableExistingBatches
                                                                                                )
                                                                                                    .length
                                                                                        }
                                                                                        onCheckedChange={() => {
                                                                                            if (
                                                                                                selectedExistingBatchIds.length ===
                                                                                                getDeduplicatedSessions(
                                                                                                    availableExistingBatches
                                                                                                )
                                                                                                    .length
                                                                                            ) {
                                                                                                setSelectedExistingBatchIds(
                                                                                                    []
                                                                                                );
                                                                                            } else {
                                                                                                setSelectedExistingBatchIds(
                                                                                                    getDeduplicatedSessions(
                                                                                                        availableExistingBatches
                                                                                                    ).map(
                                                                                                        (
                                                                                                            b: ExistingBatch
                                                                                                        ) =>
                                                                                                            b.id
                                                                                                    )
                                                                                                );
                                                                                            }
                                                                                        }}
                                                                                        className="mr-2 size-4"
                                                                                        style={{
                                                                                            display:
                                                                                                getDeduplicatedSessions(
                                                                                                    availableExistingBatches
                                                                                                )
                                                                                                    .length ===
                                                                                                0
                                                                                                    ? 'none'
                                                                                                    : undefined,
                                                                                        }}
                                                                                    />
                                                                                    {getDeduplicatedSessions(
                                                                                        availableExistingBatches
                                                                                    ).length >
                                                                                        0 && (
                                                                                        <span className="text-sm font-medium text-gray-700">
                                                                                            Select
                                                                                            All
                                                                                        </span>
                                                                                    )}
                                                                                </div>
                                                                                <div className="max-h-48 space-y-1 overflow-y-auto">
                                                                                    {getDeduplicatedSessions(
                                                                                        availableExistingBatches
                                                                                    ).map(
                                                                                        (
                                                                                            batch: ExistingBatch
                                                                                        ) => (
                                                                                            <div
                                                                                                key={
                                                                                                    batch.id
                                                                                                }
                                                                                                className="flex items-center gap-2 rounded border border-gray-100 bg-gray-50 px-2 py-1"
                                                                                            >
                                                                                                <Checkbox
                                                                                                    checked={selectedExistingBatchIds.includes(
                                                                                                        batch.id
                                                                                                    )}
                                                                                                    onCheckedChange={() => {
                                                                                                        if (
                                                                                                            selectedExistingBatchIds.includes(
                                                                                                                batch.id
                                                                                                            )
                                                                                                        ) {
                                                                                                            setSelectedExistingBatchIds(
                                                                                                                selectedExistingBatchIds.filter(
                                                                                                                    (
                                                                                                                        id
                                                                                                                    ) =>
                                                                                                                        id !==
                                                                                                                        batch.id
                                                                                                                )
                                                                                                            );
                                                                                                        } else {
                                                                                                            setSelectedExistingBatchIds(
                                                                                                                [
                                                                                                                    ...selectedExistingBatchIds,
                                                                                                                    batch.id,
                                                                                                                ]
                                                                                                            );
                                                                                                        }
                                                                                                    }}
                                                                                                    className="size-4"
                                                                                                />
                                                                                                <span className="text-sm text-gray-700">
                                                                                                    {hasSessions ===
                                                                                                        'yes' &&
                                                                                                    hasLevels ===
                                                                                                        'yes'
                                                                                                        ? `${batch.session.session_name} - ${batch.level.level_name}`
                                                                                                        : batch
                                                                                                              .session
                                                                                                              .session_name}
                                                                                                </span>
                                                                                            </div>
                                                                                        )
                                                                                    )}
                                                                                </div>
                                                                            </>
                                                                        )}
                                                                    </>
                                                                )}
                                                            {hasSessions !== 'yes' &&
                                                                hasLevels === 'yes' && (
                                                                    <>
                                                                        <Label className="mb-2 block text-sm font-medium text-gray-700">
                                                                            Select{' '}
                                                                            {getTerminology(
                                                                                ContentTerms.Level,
                                                                                SystemTerms.Level
                                                                            )}
                                                                            s
                                                                        </Label>
                                                                        {availableExistingBatches.length ===
                                                                        0 ? (
                                                                            <div className="text-sm text-gray-500">
                                                                                No existing levels
                                                                                found.
                                                                            </div>
                                                                        ) : (
                                                                            <>
                                                                                <div className="mb-2 flex items-center">
                                                                                    <Checkbox
                                                                                        checked={
                                                                                            availableExistingBatches.length >
                                                                                                0 &&
                                                                                            selectedExistingBatchIds.length ===
                                                                                                availableExistingBatches.length
                                                                                        }
                                                                                        onCheckedChange={() => {
                                                                                            if (
                                                                                                selectedExistingBatchIds.length ===
                                                                                                availableExistingBatches.length
                                                                                            ) {
                                                                                                setSelectedExistingBatchIds(
                                                                                                    []
                                                                                                );
                                                                                            } else {
                                                                                                setSelectedExistingBatchIds(
                                                                                                    availableExistingBatches.map(
                                                                                                        (
                                                                                                            b: ExistingBatch
                                                                                                        ) =>
                                                                                                            b.id
                                                                                                    )
                                                                                                );
                                                                                            }
                                                                                        }}
                                                                                        className="mr-2 size-4"
                                                                                        style={{
                                                                                            display:
                                                                                                availableExistingBatches.length ===
                                                                                                0
                                                                                                    ? 'none'
                                                                                                    : undefined,
                                                                                        }}
                                                                                    />
                                                                                    {availableExistingBatches.length >
                                                                                        0 && (
                                                                                        <span className="text-sm font-medium text-gray-700">
                                                                                            Select
                                                                                            All
                                                                                        </span>
                                                                                    )}
                                                                                </div>
                                                                                <div className="max-h-48 space-y-1 overflow-y-auto">
                                                                                    {availableExistingBatches.map(
                                                                                        (
                                                                                            batch: ExistingBatch
                                                                                        ) => (
                                                                                            <div
                                                                                                key={
                                                                                                    batch.id
                                                                                                }
                                                                                                className="flex items-center gap-2 rounded border border-gray-100 bg-gray-50 px-2 py-1"
                                                                                            >
                                                                                                <Checkbox
                                                                                                    checked={selectedExistingBatchIds.includes(
                                                                                                        batch.id
                                                                                                    )}
                                                                                                    onCheckedChange={() => {
                                                                                                        if (
                                                                                                            selectedExistingBatchIds.includes(
                                                                                                                batch.id
                                                                                                            )
                                                                                                        ) {
                                                                                                            setSelectedExistingBatchIds(
                                                                                                                selectedExistingBatchIds.filter(
                                                                                                                    (
                                                                                                                        id
                                                                                                                    ) =>
                                                                                                                        id !==
                                                                                                                        batch.id
                                                                                                                )
                                                                                                            );
                                                                                                        } else {
                                                                                                            setSelectedExistingBatchIds(
                                                                                                                [
                                                                                                                    ...selectedExistingBatchIds,
                                                                                                                    batch.id,
                                                                                                                ]
                                                                                                            );
                                                                                                        }
                                                                                                    }}
                                                                                                    className="size-4"
                                                                                                />
                                                                                                <span className="text-sm text-gray-700">
                                                                                                    {
                                                                                                        batch
                                                                                                            .level
                                                                                                            .level_name
                                                                                                    }
                                                                                                </span>
                                                                                            </div>
                                                                                        )
                                                                                    )}
                                                                                </div>
                                                                            </>
                                                                        )}
                                                                    </>
                                                                )}
                                                        </div>
                                                    )}
                                                    <div className="mt-3 flex gap-2">
                                                        {addSessionMode === 'new' && (
                                                            <MyButton
                                                                type="button"
                                                                buttonType="primary"
                                                                scale="medium"
                                                                layoutVariant="default"
                                                                onClick={
                                                                    hasSessions === 'yes'
                                                                        ? addSession
                                                                        : addStandaloneLevel
                                                                }
                                                                disable={
                                                                    (hasSessions === 'yes' &&
                                                                        (!newSessionName.trim() ||
                                                                            !newSessionStartDate)) ||
                                                                    (hasSessions !== 'yes' &&
                                                                        hasLevels === 'yes' &&
                                                                        !newLevelName.trim())
                                                                }
                                                            >
                                                                {hasSessions === 'yes'
                                                                    ? `Add ${getTerminology(
                                                                          ContentTerms.Session,
                                                                          SystemTerms.Session
                                                                      )}`
                                                                    : `Add ${getTerminology(
                                                                          ContentTerms.Level,
                                                                          SystemTerms.Level
                                                                      )}`}
                                                            </MyButton>
                                                        )}
                                                        {addSessionMode === 'existing' && (
                                                            <MyButton
                                                                type="button"
                                                                buttonType="primary"
                                                                scale="medium"
                                                                layoutVariant="default"
                                                                onClick={() => {
                                                                    if (
                                                                        hasSessions === 'yes' &&
                                                                        hasLevels === 'yes'
                                                                    ) {
                                                                        // Add selected batches as sessions with levels
                                                                        const selectedBatches =
                                                                            availableExistingBatches.filter(
                                                                                (
                                                                                    b: ExistingBatch
                                                                                ) =>
                                                                                    selectedExistingBatchIds.includes(
                                                                                        b.id
                                                                                    )
                                                                            );
                                                                        const newSessions: Session[] =
                                                                            [];
                                                                        selectedBatches.forEach(
                                                                            (
                                                                                batch: ExistingBatch
                                                                            ) => {
                                                                                let session =
                                                                                    newSessions.find(
                                                                                        (s) =>
                                                                                            s.id ===
                                                                                            batch
                                                                                                .session
                                                                                                .id
                                                                                    );
                                                                                if (!session) {
                                                                                    session = {
                                                                                        id: batch
                                                                                            .session
                                                                                            .id,
                                                                                        name: batch
                                                                                            .session
                                                                                            .session_name,
                                                                                        startDate:
                                                                                            batch
                                                                                                .session
                                                                                                .start_date,
                                                                                        levels: [],
                                                                                        batchId:
                                                                                            batch.id, // <-- set batchId here
                                                                                        newSession:
                                                                                            false,
                                                                                    };
                                                                                    newSessions.push(
                                                                                        session
                                                                                    );
                                                                                }
                                                                                if (
                                                                                    !session.levels.some(
                                                                                        (l) =>
                                                                                            l.id ===
                                                                                            batch
                                                                                                .level
                                                                                                .id
                                                                                    )
                                                                                ) {
                                                                                    session.levels.push(
                                                                                        {
                                                                                            id: batch
                                                                                                .level
                                                                                                .id,
                                                                                            name: batch
                                                                                                .level
                                                                                                .level_name,
                                                                                            userIds:
                                                                                                [],
                                                                                            batchId:
                                                                                                batch.id, // <-- set batchId here
                                                                                            newLevel:
                                                                                                false,
                                                                                            containsSubgroup:
                                                                                                false,
                                                                                            subgroups:
                                                                                                [],
                                                                                        }
                                                                                    );
                                                                                }
                                                                            }
                                                                        );
                                                                        // Avoid duplicates in sessions list by batch id
                                                                        const sessionLevelIds =
                                                                            new Set(
                                                                                sessions.flatMap(
                                                                                    (s) =>
                                                                                        s.levels.map(
                                                                                            (l) =>
                                                                                                `${s.id}-${l.id}`
                                                                                        )
                                                                                )
                                                                            );
                                                                        newSessions.forEach((s) => {
                                                                            s.levels =
                                                                                s.levels.filter(
                                                                                    (l) =>
                                                                                        !sessionLevelIds.has(
                                                                                            `${s.id}-${l.id}`
                                                                                        )
                                                                                );
                                                                        });
                                                                        setSessions(
                                                                            ensureBatchIdInLevels([
                                                                                ...sessions,
                                                                                ...newSessions.filter(
                                                                                    (s) =>
                                                                                        s.levels
                                                                                            .length >
                                                                                        0
                                                                                ),
                                                                            ])
                                                                        );

                                                                        // Mark selected batches as used
                                                                        setUsedExistingBatchIds(
                                                                            (prev) => {
                                                                                const newSet =
                                                                                    new Set(prev);
                                                                                selectedBatches.forEach(
                                                                                    (batch) => {
                                                                                        newSet.add(
                                                                                            batch.id
                                                                                        );
                                                                                    }
                                                                                );
                                                                                return newSet;
                                                                            }
                                                                        );
                                                                    } else if (
                                                                        hasSessions === 'yes' &&
                                                                        hasLevels !== 'yes'
                                                                    ) {
                                                                        // Add selected sessions by batch id
                                                                        const selectedBatches =
                                                                            availableExistingBatches.filter(
                                                                                (
                                                                                    b: ExistingBatch
                                                                                ) =>
                                                                                    selectedExistingBatchIds.includes(
                                                                                        b.id
                                                                                    )
                                                                            );
                                                                        const newSessions: Session[] =
                                                                            [];
                                                                        selectedBatches.forEach(
                                                                            (
                                                                                batch: ExistingBatch
                                                                            ) => {
                                                                                if (
                                                                                    !sessions.some(
                                                                                        (s) =>
                                                                                            s.id ===
                                                                                            batch
                                                                                                .session
                                                                                                .id
                                                                                    )
                                                                                ) {
                                                                                    newSessions.push(
                                                                                        {
                                                                                            id: batch
                                                                                                .session
                                                                                                .id,
                                                                                            name: batch
                                                                                                .session
                                                                                                .session_name,
                                                                                            startDate:
                                                                                                batch
                                                                                                    .session
                                                                                                    .start_date,
                                                                                            levels: [],
                                                                                            batchId:
                                                                                                batch.id, // <-- set batchId here
                                                                                            newSession:
                                                                                                false,
                                                                                        }
                                                                                    );
                                                                                }
                                                                            }
                                                                        );
                                                                        setSessions(
                                                                            ensureBatchIdInLevels([
                                                                                ...sessions,
                                                                                ...newSessions,
                                                                            ])
                                                                        );

                                                                        // Mark selected batches as used
                                                                        setUsedExistingBatchIds(
                                                                            (prev) => {
                                                                                const newSet =
                                                                                    new Set(prev);
                                                                                selectedBatches.forEach(
                                                                                    (batch) => {
                                                                                        newSet.add(
                                                                                            batch.id
                                                                                        );
                                                                                    }
                                                                                );
                                                                                return newSet;
                                                                            }
                                                                        );
                                                                    } else if (
                                                                        hasSessions !== 'yes' &&
                                                                        hasLevels === 'yes'
                                                                    ) {
                                                                        // Add selected levels to standalone session by batch id
                                                                        const selectedBatches =
                                                                            availableExistingBatches.filter(
                                                                                (
                                                                                    b: ExistingBatch
                                                                                ) =>
                                                                                    selectedExistingBatchIds.includes(
                                                                                        b.id
                                                                                    )
                                                                            );
                                                                        const newLevels: Level[] =
                                                                            [];
                                                                        selectedBatches.forEach(
                                                                            (
                                                                                batch: ExistingBatch
                                                                            ) => {
                                                                                if (
                                                                                    !sessions
                                                                                        .find(
                                                                                            (s) =>
                                                                                                s.id ===
                                                                                                'DEFAULT'
                                                                                        )
                                                                                        ?.levels.some(
                                                                                            (l) =>
                                                                                                l.id ===
                                                                                                batch
                                                                                                    .level
                                                                                                    .id
                                                                                        )
                                                                                ) {
                                                                                    newLevels.push({
                                                                                        id: batch
                                                                                            .level
                                                                                            .id,
                                                                                        name: batch
                                                                                            .level
                                                                                            .level_name,
                                                                                        userIds: [],
                                                                                        batchId:
                                                                                            batch.id, // <-- set batchId here
                                                                                        newLevel:
                                                                                            false,
                                                                                        containsSubgroup:
                                                                                            false,
                                                                                        subgroups:
                                                                                            [],
                                                                                    });
                                                                                }
                                                                            }
                                                                        );
                                                                        // Add to standalone session or create it
                                                                        const standaloneSession =
                                                                            sessions.find(
                                                                                (s) =>
                                                                                    s.id ===
                                                                                    'DEFAULT'
                                                                            );
                                                                        if (standaloneSession) {
                                                                            standaloneSession.levels =
                                                                                [
                                                                                    ...standaloneSession.levels,
                                                                                    ...newLevels,
                                                                                ];
                                                                            setSessions(
                                                                                ensureBatchIdInLevels(
                                                                                    [...sessions]
                                                                                )
                                                                            );
                                                                        } else {
                                                                            setSessions([
                                                                                {
                                                                                    id: 'DEFAULT',
                                                                                    name: 'DEFAULT',
                                                                                    startDate:
                                                                                        new Date().toISOString(),
                                                                                    levels: newLevels,
                                                                                    newSession:
                                                                                        true,
                                                                                },
                                                                            ]);
                                                                        }

                                                                        // Mark selected batches as used
                                                                        setUsedExistingBatchIds(
                                                                            (prev) => {
                                                                                const newSet =
                                                                                    new Set(prev);
                                                                                selectedBatches.forEach(
                                                                                    (batch) => {
                                                                                        newSet.add(
                                                                                            batch.id
                                                                                        );
                                                                                    }
                                                                                );
                                                                                return newSet;
                                                                            }
                                                                        );
                                                                    }
                                                                    setShowAddSession(false);
                                                                    setSelectedExistingBatchIds([]);
                                                                }}
                                                                disable={
                                                                    selectedExistingBatchIds.length ===
                                                                    0
                                                                }
                                                            >
                                                                Add Selected
                                                            </MyButton>
                                                        )}
                                                        <MyButton
                                                            type="button"
                                                            buttonType="secondary"
                                                            scale="medium"
                                                            layoutVariant="default"
                                                            onClick={() => {
                                                                setShowAddSession(false);
                                                                setNewSessionName('');
                                                                setNewSessionStartDate('');
                                                                setNewLevelName('');
                                                                setAddSessionMode('new');
                                                                setSelectedExistingBatchIds([]);
                                                            }}
                                                        >
                                                            Cancel
                                                        </MyButton>
                                                    </div>
                                                </CardContent>
                                            </Card>
                                        )}

                                        {/* Session Cards */}
                                        {sessions
                                            .filter(
                                                (session) =>
                                                    session.name.toLowerCase() !== 'default'
                                            )
                                            .map((session) => (
                                                <SessionCard
                                                    key={session.batchId || session.id}
                                                    session={session}
                                                    hasLevels={hasLevels === 'yes'}
                                                    onRemoveSession={() =>
                                                        requestRemoveSession(
                                                            (
                                                                session.batchId || session.id
                                                            ).toString()
                                                        )
                                                    }
                                                    onAddLevel={addLevel}
                                                    onRemoveLevel={(sessionId, batchId) =>
                                                        requestRemoveLevel(
                                                            sessionId,
                                                            (batchId || '').toString()
                                                        )
                                                    }
                                                    onRenameSession={renameSession}
                                                    onRenameLevel={renameLevel}
                                                    onValidateSessionName={validateSessionName}
                                                    onValidateLevelName={validateLevelName}
                                                    onGetRenameShareWarning={getRenameShareWarning}
                                                    hasSessionsFlag={hasSessions === 'yes'}
                                                    containsSubgroupFlag={containsSubgroup}
                                                    enableSubgroupControlsFlag={
                                                        enableSubgroupControls
                                                    }
                                                    onAddLevelSubgroup={handleAddLevelSubgroup}
                                                    onLevelSubgroupNameChange={
                                                        handleLevelSubgroupNameChange
                                                    }
                                                    onRemoveLevelSubgroupRow={
                                                        handleRemoveLevelSubgroupRow
                                                    }
                                                    existingBatches={availableExistingBatches}
                                                    onMarkBatchesAsUsed={(batchIds) => {
                                                        setUsedExistingBatchIds((prev) => {
                                                            const newSet = new Set(prev);
                                                            batchIds.forEach((id) => {
                                                                newSet.add(id);
                                                            });
                                                            return newSet;
                                                        });
                                                    }}
                                                    limitLevelsToOne={limitLevelsToOne}
                                                    canAddMoreLevels={canAddMoreLevels}
                                                />
                                            ))}
                                    </div>
                                )}

                                {/* Standalone Levels (when sessions are disabled) */}
                                {hasSessions !== 'yes' && hasLevels === 'yes' && (
                                    <div className="space-y-3">
                                        <div className="flex items-center justify-between">
                                            <div>
                                                <Label className="text-base font-medium text-gray-900">
                                                    {getTerminology(
                                                        ContentTerms.Level,
                                                        SystemTerms.Level
                                                    )}
                                                    s
                                                </Label>
                                                <p className="text-sm text-gray-600">
                                                    Create{' '}
                                                    {getTerminology(
                                                        ContentTerms.Level,
                                                        SystemTerms.Level
                                                    )}{' '}
                                                    for your{' '}
                                                    {getTerminology(
                                                        ContentTerms.Course,
                                                        SystemTerms.Course
                                                    ).toLocaleLowerCase()}
                                                </p>
                                            </div>
                                            <MyButton
                                                type="button"
                                                buttonType="secondary"
                                                scale="medium"
                                                layoutVariant="default"
                                                onClick={() =>
                                                    canAddMoreLevels && setShowAddLevel(true)
                                                }
                                                className="font-light"
                                                disable={!canAddMoreLevels}
                                            >
                                                <Plus />
                                                Add{' '}
                                                {getTerminology(
                                                    ContentTerms.Level,
                                                    SystemTerms.Level
                                                )}
                                            </MyButton>
                                        </div>
                                        {limitLevelsToOne && !canAddMoreLevels && (
                                            <p className="text-xs text-gray-500">
                                                Only one level can be configured. Remove the
                                                existing level to change it.
                                            </p>
                                        )}

                                        {showAddLevel && (
                                            <Card className="border-gray-200">
                                                <CardContent className="p-3">
                                                    <div className="mb-3">
                                                        <RadioGroup
                                                            value={addLevelMode}
                                                            onValueChange={(val) =>
                                                                setAddLevelMode(
                                                                    val as 'new' | 'existing'
                                                                )
                                                            }
                                                            className="flex gap-6"
                                                        >
                                                            <div className="flex items-center space-x-2">
                                                                <RadioGroupItem
                                                                    value="existing"
                                                                    id="add-level-existing"
                                                                />
                                                                <Label
                                                                    htmlFor="add-level-existing"
                                                                    className="text-sm font-normal"
                                                                >
                                                                    Existing{' '}
                                                                    {getTerminology(
                                                                        ContentTerms.Level,
                                                                        SystemTerms.Level
                                                                    )}
                                                                    s
                                                                </Label>
                                                            </div>
                                                            <div className="flex items-center space-x-2">
                                                                <RadioGroupItem
                                                                    value="new"
                                                                    id="add-level-new"
                                                                />
                                                                <Label
                                                                    htmlFor="add-level-new"
                                                                    className="text-sm font-normal"
                                                                >
                                                                    New{' '}
                                                                    {getTerminology(
                                                                        ContentTerms.Level,
                                                                        SystemTerms.Level
                                                                    )}
                                                                </Label>
                                                            </div>
                                                        </RadioGroup>
                                                    </div>
                                                    {addLevelMode === 'new' && (
                                                        <div>
                                                            <Label className="mb-1 block text-sm font-medium text-gray-700">
                                                                {getTerminology(
                                                                    ContentTerms.Level,
                                                                    SystemTerms.Level
                                                                )}{' '}
                                                                Name
                                                            </Label>
                                                            <Input
                                                                placeholder="Enter level name (e.g., Basic)"
                                                                value={newLevelName}
                                                                onChange={(e) =>
                                                                    setNewLevelName(e.target.value)
                                                                }
                                                                className="h-8 border-gray-300"
                                                            />
                                                        </div>
                                                    )}
                                                    {addLevelMode === 'existing' && (
                                                        <div className="mt-2">
                                                            <Label className="mb-2 block text-sm font-medium text-gray-700">
                                                                Select{' '}
                                                                {getTerminology(
                                                                    ContentTerms.Level,
                                                                    SystemTerms.Level
                                                                )}
                                                                s
                                                            </Label>
                                                            {availableExistingBatchesForStandalone.length ===
                                                            0 ? (
                                                                <div className="text-sm text-gray-500">
                                                                    No existing{' '}
                                                                    {getTerminology(
                                                                        ContentTerms.Level,
                                                                        SystemTerms.Level
                                                                    ).toLocaleLowerCase()}
                                                                    s found.
                                                                </div>
                                                            ) : (
                                                                <div className="space-y-2">
                                                                    {availableExistingBatchesForStandalone.map(
                                                                        (batch: ExistingBatch) => (
                                                                            <button
                                                                                key={batch.id}
                                                                                type="button"
                                                                                className="flex w-full items-center justify-between rounded border border-gray-100 bg-white px-3 py-2 text-left text-sm hover:border-primary-200 hover:bg-primary-50 disabled:cursor-not-allowed disabled:opacity-60"
                                                                                onClick={() =>
                                                                                    addExistingStandaloneLevel(
                                                                                        batch
                                                                                    )
                                                                                }
                                                                                disabled={
                                                                                    !canAddMoreLevels
                                                                                }
                                                                            >
                                                                                <span className="text-gray-800">
                                                                                    {
                                                                                        batch.level
                                                                                            .level_name
                                                                                    }
                                                                                </span>
                                                                                <span className="text-xs font-medium text-primary-600">
                                                                                    Add
                                                                                </span>
                                                                            </button>
                                                                        )
                                                                    )}
                                                                </div>
                                                            )}
                                                        </div>
                                                    )}
                                                    <div className="mt-3 flex gap-2">
                                                        {addLevelMode === 'new' && (
                                                            <MyButton
                                                                type="button"
                                                                buttonType="primary"
                                                                scale="medium"
                                                                layoutVariant="default"
                                                                onClick={addStandaloneLevel}
                                                                disable={
                                                                    !newLevelName.trim() ||
                                                                    !canAddMoreLevels
                                                                }
                                                            >
                                                                Add{' '}
                                                                {getTerminology(
                                                                    ContentTerms.Level,
                                                                    SystemTerms.Level
                                                                )}
                                                            </MyButton>
                                                        )}
                                                        {addLevelMode === 'existing' && (
                                                            <MyButton
                                                                type="button"
                                                                buttonType="primary"
                                                                scale="medium"
                                                                layoutVariant="default"
                                                                onClick={() => {
                                                                    if (!canAddMoreLevels) {
                                                                        return;
                                                                    }
                                                                    // Add selected levels to standalone session by batch id
                                                                    const selectedBatches =
                                                                        availableExistingBatches.filter(
                                                                            (b: ExistingBatch) =>
                                                                                selectedExistingLevelBatchIds.includes(
                                                                                    b.id
                                                                                )
                                                                        );
                                                                    const newLevels: Level[] = [];
                                                                    selectedBatches.forEach(
                                                                        (batch: ExistingBatch) => {
                                                                            if (
                                                                                !sessions
                                                                                    .find(
                                                                                        (s) =>
                                                                                            s.id ===
                                                                                            'DEFAULT'
                                                                                    )
                                                                                    ?.levels.some(
                                                                                        (l) =>
                                                                                            l.id ===
                                                                                            batch
                                                                                                .level
                                                                                                .id
                                                                                    )
                                                                            ) {
                                                                                newLevels.push({
                                                                                    id: batch.level
                                                                                        .id,
                                                                                    name: batch
                                                                                        .level
                                                                                        .level_name,
                                                                                    userIds: [],
                                                                                    batchId:
                                                                                        batch.id, // <-- set batchId here
                                                                                    newLevel: false,
                                                                                    containsSubgroup:
                                                                                        false,
                                                                                    subgroups: [],
                                                                                });
                                                                            }
                                                                        }
                                                                    );
                                                                    // Add to standalone session or create it
                                                                    const standaloneSession =
                                                                        sessions.find(
                                                                            (s) =>
                                                                                s.id === 'DEFAULT'
                                                                        );
                                                                    if (standaloneSession) {
                                                                        standaloneSession.levels = [
                                                                            ...standaloneSession.levels,
                                                                            ...newLevels,
                                                                        ];
                                                                        setSessions(
                                                                            ensureBatchIdInLevels([
                                                                                ...sessions,
                                                                            ])
                                                                        );
                                                                    } else {
                                                                        setSessions([
                                                                            {
                                                                                id: 'DEFAULT',
                                                                                name: 'DEFAULT',
                                                                                startDate:
                                                                                    new Date().toISOString(),
                                                                                levels: newLevels,
                                                                                newSession: true,
                                                                            },
                                                                        ]);
                                                                    }

                                                                    // Mark selected batches as used
                                                                    setUsedExistingBatchIds(
                                                                        (prev) => {
                                                                            const newSet = new Set(
                                                                                prev
                                                                            );
                                                                            selectedBatches.forEach(
                                                                                (batch) => {
                                                                                    newSet.add(
                                                                                        batch.id
                                                                                    );
                                                                                }
                                                                            );
                                                                            return newSet;
                                                                        }
                                                                    );
                                                                    setShowAddLevel(false);
                                                                    setSelectedExistingLevelBatchIds(
                                                                        []
                                                                    );
                                                                    setAddLevelMode('new');
                                                                }}
                                                                disable={
                                                                    selectedExistingLevelBatchIds.length ===
                                                                    0
                                                                }
                                                            >
                                                                Add Selected
                                                            </MyButton>
                                                        )}
                                                        <MyButton
                                                            type="button"
                                                            buttonType="secondary"
                                                            scale="medium"
                                                            layoutVariant="default"
                                                            onClick={() => {
                                                                setShowAddLevel(false);
                                                                setNewLevelName('');
                                                                setAddLevelMode('new');
                                                                setSelectedExistingLevelBatchIds(
                                                                    []
                                                                );
                                                            }}
                                                        >
                                                            Cancel
                                                        </MyButton>
                                                    </div>
                                                </CardContent>
                                            </Card>
                                        )}

                                        {/* Level Cards */}
                                        {sessions
                                            .find((s) => s.id === 'DEFAULT')
                                            ?.levels.map((level) => (
                                                <div
                                                    key={level.batchId}
                                                    className="flex items-center justify-between rounded-lg border border-gray-200 bg-gray-50 p-2"
                                                >
                                                    <InlineNameEditor
                                                        value={level.name}
                                                        onSave={(name) =>
                                                            renameLevel(
                                                                'DEFAULT',
                                                                level.batchId,
                                                                name
                                                            )
                                                        }
                                                        validate={(name) =>
                                                            validateLevelName(
                                                                'DEFAULT',
                                                                level.batchId,
                                                                name
                                                            )
                                                        }
                                                        warning={getRenameShareWarning(
                                                            'level',
                                                            level.id
                                                        )}
                                                        editLabel={`Rename ${getTerminology(
                                                            ContentTerms.Level,
                                                            SystemTerms.Level
                                                        )}`}
                                                        textClassName="text-sm font-medium text-gray-900"
                                                    />
                                                    <MyButton
                                                        type="button"
                                                        buttonType="text"
                                                        scale="medium"
                                                        layoutVariant="icon"
                                                        onClick={() =>
                                                            removeStandaloneLevel(level.batchId)
                                                        }
                                                        className="text-red-600 hover:text-red-700"
                                                    >
                                                        <Trash2 className="size-3" />
                                                    </MyButton>
                                                </div>
                                            ))}
                                    </div>
                                )}

                                {allowAdvancedSettings && (
                                    <>
                                        <Separator className="bg-gray-200" />
                                        <Collapsible
                                            open={showAdvanced}
                                            onOpenChange={setShowAdvanced}
                                            className="w-full"
                                        >
                                            <CollapsibleTrigger asChild>
                                                <button className="flex w-full items-center justify-between rounded-md border border-gray-200 bg-gray-50 px-4 py-2 text-left">
                                                    <span className="text-base font-medium text-gray-900">
                                                        Advanced Settings
                                                    </span>
                                                    <ChevronDown
                                                        className={`size-4 text-gray-500 transition-transform ${showAdvanced ? 'rotate-180' : ''}`}
                                                    />
                                                </button>
                                            </CollapsibleTrigger>
                                            <CollapsibleContent className="mt-3 space-y-3">
                                                <div className="space-y-3">
                                                    <div className="flex items-center justify-between">
                                                        <Label className="text-base font-medium text-gray-900">
                                                            Add Authors to{' '}
                                                            {getTerminology(
                                                                ContentTerms.Course,
                                                                SystemTerms.Course
                                                            )}
                                                            s
                                                        </Label>
                                                        <MyButton
                                                            type="button"
                                                            buttonType="secondary"
                                                            scale="medium"
                                                            layoutVariant="default"
                                                            onClick={() =>
                                                                setShowInviteDialog(true)
                                                            }
                                                            className="font-light"
                                                        >
                                                            <Plus className="size-4" />
                                                            Invite
                                                        </MyButton>
                                                    </div>

                                                    {showInviteDialog && (
                                                        <InviteInstructorForm
                                                            onInviteSuccess={(
                                                                id,
                                                                name,
                                                                email,
                                                                profilePicId,
                                                                roles
                                                            ) => {
                                                                handleInviteSuccess(
                                                                    id,
                                                                    name,
                                                                    email,
                                                                    profilePicId,
                                                                    roles
                                                                );
                                                                setShowInviteDialog(false);
                                                            }}
                                                            onCancel={() =>
                                                                setShowInviteDialog(false)
                                                            }
                                                            existingMembers={instructors}
                                                        />
                                                    )}

                                                    {/* No assignment yet: say so, because the public
                                                        catalogue meanwhile shows the course creator as a
                                                        fallback and the two can look contradictory. */}
                                                    {isEdit &&
                                                        (!selectedInstructors ||
                                                            selectedInstructors.length === 0) && (
                                                            <p className="text-sm text-gray-600">
                                                                No authors assigned yet. Select one
                                                                below to add a subtitle and
                                                                description; until then the
                                                                catalogue shows the{' '}
                                                                {getTerminology(
                                                                    ContentTerms.Course,
                                                                    SystemTerms.Course
                                                                ).toLocaleLowerCase()}{' '}
                                                                creator.
                                                            </p>
                                                        )}

                                                    <div className="flex flex-col gap-4">
                                                        <MultiSelectDropdown
                                                            options={instructors?.map(
                                                                (instructor) => ({
                                                                    id: instructor.id,
                                                                    name: instructor.name,
                                                                    email: instructor.email,
                                                                    // shown under the name and searchable
                                                                    subtitle: instructor.email,
                                                                })
                                                            )}
                                                            searchPlaceholder="Search by name or email…"
                                                            searchSubtitle
                                                            selected={selectedInstructors?.map(
                                                                (instructor) => ({
                                                                    id: instructor.id,
                                                                    name: instructor.name,
                                                                    email: instructor.email,
                                                                })
                                                            )}
                                                            onChange={(selected) => {
                                                                // Build the new list from selected IDs, looking up full data
                                                                // from current selectedInstructors first, then instructors list
                                                                const selectedIds = new Set(
                                                                    selected?.map((s) =>
                                                                        String(s.id)
                                                                    ) || []
                                                                );
                                                                const previousIds = new Set(
                                                                    (selectedInstructors || []).map(
                                                                        (i) => i.id
                                                                    )
                                                                );

                                                                // Keep existing selected instructors that are still selected
                                                                const kept = (
                                                                    selectedInstructors || []
                                                                ).filter((i) =>
                                                                    selectedIds.has(i.id)
                                                                );
                                                                // Find newly added ones (in selected but not in previous)
                                                                const newIds = [
                                                                    ...selectedIds,
                                                                ].filter(
                                                                    (id) => !previousIds.has(id)
                                                                );
                                                                const newlyAdded: Instructor[] =
                                                                    newIds
                                                                        .map((id) => {
                                                                            const instructor =
                                                                                instructors?.find(
                                                                                    (i) =>
                                                                                        i.id === id
                                                                                );
                                                                            return instructor
                                                                                ? { ...instructor }
                                                                                : null;
                                                                        })
                                                                        .filter(
                                                                            (i): i is Instructor =>
                                                                                i !== null
                                                                        );

                                                                const selectedInstructorsList = [
                                                                    ...kept,
                                                                    ...newlyAdded,
                                                                ];

                                                                // Find removed instructors
                                                                const removedIds = new Set(
                                                                    [...previousIds].filter(
                                                                        (id) => !selectedIds.has(id)
                                                                    )
                                                                );

                                                                setSelectedInstructors(
                                                                    selectedInstructorsList
                                                                );
                                                                form.setValue(
                                                                    'selectedInstructors',
                                                                    selectedInstructorsList
                                                                );

                                                                // Clean up removed instructors from mappings and sessions
                                                                if (removedIds.size > 0) {
                                                                    setInstructorMappings((prev) =>
                                                                        prev.filter(
                                                                            (m) =>
                                                                                !removedIds.has(
                                                                                    m.id
                                                                                )
                                                                        )
                                                                    );
                                                                    const updatedSessions = form
                                                                        .getValues('sessions')
                                                                        .map((session) => ({
                                                                            ...session,
                                                                            levels: session.levels.map(
                                                                                (level) => ({
                                                                                    ...level,
                                                                                    userIds:
                                                                                        level.userIds.filter(
                                                                                            (
                                                                                                user: Instructor
                                                                                            ) =>
                                                                                                !removedIds.has(
                                                                                                    user.id
                                                                                                )
                                                                                        ),
                                                                                })
                                                                            ),
                                                                        }));
                                                                    form.setValue(
                                                                        'sessions',
                                                                        updatedSessions,
                                                                        {
                                                                            shouldDirty: true,
                                                                        }
                                                                    );
                                                                }

                                                                newlyAdded.forEach((instructor) => {
                                                                    const allSessionLevels =
                                                                        getAllSessionLevelsForInstructor(
                                                                            sessions,
                                                                            hasSessions,
                                                                            hasLevels
                                                                        );
                                                                    setInstructorMappings(
                                                                        (prev) => [
                                                                            ...prev.filter(
                                                                                (m) =>
                                                                                    m.id !==
                                                                                    instructor.id
                                                                            ),
                                                                            {
                                                                                id: instructor.id,
                                                                                email: instructor.email,
                                                                                sessionLevels:
                                                                                    allSessionLevels,
                                                                            },
                                                                        ]
                                                                    );
                                                                    setSessions((prevSessions) => {
                                                                        const updatedSessions =
                                                                            JSON.parse(
                                                                                JSON.stringify(
                                                                                    prevSessions
                                                                                )
                                                                            );
                                                                        if (
                                                                            hasSessions === 'yes' &&
                                                                            hasLevels === 'yes'
                                                                        ) {
                                                                            updatedSessions.forEach(
                                                                                (
                                                                                    session: Session
                                                                                ) => {
                                                                                    session.levels.forEach(
                                                                                        (
                                                                                            level: Level
                                                                                        ) => {
                                                                                            if (
                                                                                                !level.userIds.some(
                                                                                                    (
                                                                                                        i: Instructor
                                                                                                    ) =>
                                                                                                        i.id ===
                                                                                                        instructor.id
                                                                                                )
                                                                                            ) {
                                                                                                level.userIds.push(
                                                                                                    instructor
                                                                                                );
                                                                                            }
                                                                                        }
                                                                                    );
                                                                                }
                                                                            );
                                                                        } else if (
                                                                            hasSessions === 'yes' &&
                                                                            hasLevels !== 'yes'
                                                                        ) {
                                                                            updatedSessions.forEach(
                                                                                (
                                                                                    session: Session
                                                                                ) => {
                                                                                    if (
                                                                                        session
                                                                                            .levels
                                                                                            .length ===
                                                                                        0
                                                                                    ) {
                                                                                        session.levels =
                                                                                            [
                                                                                                {
                                                                                                    id: 'DEFAULT',
                                                                                                    name: '',
                                                                                                    userIds:
                                                                                                        [
                                                                                                            instructor,
                                                                                                        ],
                                                                                                    batchId:
                                                                                                        'DEFAULT',
                                                                                                    newLevel:
                                                                                                        true,
                                                                                                    containsSubgroup:
                                                                                                        false,
                                                                                                    subgroups:
                                                                                                        [],
                                                                                                },
                                                                                            ];
                                                                                    } else if (
                                                                                        session
                                                                                            .levels[0]
                                                                                            ?.userIds &&
                                                                                        !session.levels[0].userIds.some(
                                                                                            (
                                                                                                i: Instructor
                                                                                            ) =>
                                                                                                i.id ===
                                                                                                instructor.id
                                                                                        )
                                                                                    ) {
                                                                                        session.levels[0].userIds.push(
                                                                                            instructor
                                                                                        );
                                                                                    }
                                                                                }
                                                                            );
                                                                        } else if (
                                                                            hasSessions !== 'yes' &&
                                                                            hasLevels === 'yes'
                                                                        ) {
                                                                            const standaloneSession =
                                                                                updatedSessions.find(
                                                                                    (s: Session) =>
                                                                                        s.id ===
                                                                                        'DEFAULT'
                                                                                );
                                                                            if (standaloneSession) {
                                                                                standaloneSession.levels?.forEach(
                                                                                    (
                                                                                        level: Level
                                                                                    ) => {
                                                                                        if (
                                                                                            !level.userIds.some(
                                                                                                (
                                                                                                    i: Instructor
                                                                                                ) =>
                                                                                                    i.id ===
                                                                                                    instructor.id
                                                                                            )
                                                                                        ) {
                                                                                            level.userIds.push(
                                                                                                instructor
                                                                                            );
                                                                                        }
                                                                                    }
                                                                                );
                                                                            }
                                                                        } else {
                                                                            // Neither sessions nor levels: the course has
                                                                            // exactly one DEFAULT session/level and every
                                                                            // author belongs to it. This branch was missing,
                                                                            // so on a simple course a newly picked author
                                                                            // never reached level.userIds and the update
                                                                            // payload went out with add_faculty_to_course: [].
                                                                            // (Create reads formData.instructors instead
                                                                            // and was unaffected.)
                                                                            const defaultLevel = {
                                                                                id: 'DEFAULT',
                                                                                name: '',
                                                                                userIds: [instructor],
                                                                                batchId: 'DEFAULT',
                                                                                newLevel: true,
                                                                                containsSubgroup: false,
                                                                                subgroups: [],
                                                                            };
                                                                            if (
                                                                                updatedSessions.length ===
                                                                                0
                                                                            ) {
                                                                                updatedSessions.push({
                                                                                    id: 'DEFAULT',
                                                                                    name: '',
                                                                                    startDate: '',
                                                                                    levels: [defaultLevel],
                                                                                });
                                                                            } else {
                                                                                updatedSessions.forEach(
                                                                                    (
                                                                                        session: Session
                                                                                    ) => {
                                                                                        if (
                                                                                            session
                                                                                                .levels
                                                                                                .length ===
                                                                                            0
                                                                                        ) {
                                                                                            session.levels =
                                                                                                [
                                                                                                    defaultLevel,
                                                                                                ];
                                                                                            return;
                                                                                        }
                                                                                        session.levels.forEach(
                                                                                            (
                                                                                                level: Level
                                                                                            ) => {
                                                                                                if (
                                                                                                    !level.userIds.some(
                                                                                                        (
                                                                                                            i: Instructor
                                                                                                        ) =>
                                                                                                            i.id ===
                                                                                                            instructor.id
                                                                                                    )
                                                                                                ) {
                                                                                                    level.userIds.push(
                                                                                                        instructor
                                                                                                    );
                                                                                                }
                                                                                            }
                                                                                        );
                                                                                    }
                                                                                );
                                                                            }
                                                                        }
                                                                        form.setValue(
                                                                            'sessions',
                                                                            ensureNewSessionAndLevelFlags(
                                                                                updatedSessions
                                                                            )
                                                                        );
                                                                        return updatedSessions;
                                                                    });
                                                                });

                                                                const previousInstructorIds =
                                                                    selectedInstructors?.map(
                                                                        (i) => i.id
                                                                    ) || [];
                                                                const newlyAddedInstructors =
                                                                    selectedInstructorsList.filter(
                                                                        (instructor) =>
                                                                            !previousInstructorIds.includes(
                                                                                instructor.id
                                                                            )
                                                                    );
                                                                if (
                                                                    newlyAddedInstructors.length > 0
                                                                ) {
                                                                    const firstNewInstructor =
                                                                        newlyAddedInstructors[0];
                                                                    if (firstNewInstructor) {
                                                                        setSelectedInstructorId(
                                                                            firstNewInstructor.id
                                                                        );
                                                                        setSelectedInstructorEmail(
                                                                            firstNewInstructor.email
                                                                        );
                                                                        const allSessionLevels =
                                                                            getAllSessionLevelsForInstructor(
                                                                                sessions,
                                                                                hasSessions,
                                                                                hasLevels
                                                                            );
                                                                        setSelectedSessionLevels(
                                                                            allSessionLevels
                                                                        );
                                                                        setShowAssignmentCard(true);
                                                                    }
                                                                }
                                                            }}
                                                            placeholder="Select instructor emails"
                                                            className="w-full"
                                                        />

                                                        {selectedInstructors &&
                                                            selectedInstructors.length > 0 && (
                                                                <div className="space-y-2">
                                                                    {selectedInstructors?.map(
                                                                        (instructor) => {
                                                                            const isAssigning =
                                                                                showAssignmentCard &&
                                                                                selectedInstructorId ===
                                                                                    instructor.id;
                                                                            return (
                                                                                <Card
                                                                                    key={
                                                                                        instructor.id
                                                                                    }
                                                                                    className="border-gray-200"
                                                                                >
                                                                                    <CardContent
                                                                                        className={`p-3 ${isAssigning ? 'pb-3' : 'pb-2'}`}
                                                                                    >
                                                                                        <div className="flex items-center justify-between">
                                                                                            <div className="flex items-center gap-3">
                                                                                                <Avatar className="size-8">
                                                                                                    <AvatarImage
                                                                                                        src={
                                                                                                            authorPhotoUrls[
                                                                                                                instructor
                                                                                                                    .profilePicId
                                                                                                            ] ??
                                                                                                            ''
                                                                                                        }
                                                                                                        className="object-cover"
                                                                                                        alt={
                                                                                                            instructor.email
                                                                                                        }
                                                                                                    />
                                                                                                    <AvatarFallback className="bg-[#3B82F6] text-xs font-medium text-white">
                                                                                                        {getInitials(
                                                                                                            instructor.email
                                                                                                        )}
                                                                                                    </AvatarFallback>
                                                                                                </Avatar>
                                                                                                <div className="flex flex-col">
                                                                                                    <span className="text-sm font-medium text-gray-900">
                                                                                                        {
                                                                                                            instructor.name
                                                                                                        }{' '}
                                                                                                        ---
                                                                                                        &nbsp;
                                                                                                        {
                                                                                                            instructor.email
                                                                                                        }
                                                                                                        {instructor.roles &&
                                                                                                            instructor
                                                                                                                .roles
                                                                                                                .length >
                                                                                                                0 && (
                                                                                                                <>
                                                                                                                    {' '}
                                                                                                                    ---
                                                                                                                    &nbsp;
                                                                                                                    {instructor.roles.join(
                                                                                                                        ', '
                                                                                                                    )}
                                                                                                                </>
                                                                                                            )}
                                                                                                    </span>
                                                                                                    {(hasSessions ===
                                                                                                        'yes' ||
                                                                                                        hasLevels ===
                                                                                                            'yes') && (
                                                                                                        <span className="text-xs text-gray-500">
                                                                                                            {instructorMappings.find(
                                                                                                                (
                                                                                                                    m
                                                                                                                ) =>
                                                                                                                    m.id ===
                                                                                                                    instructor.id
                                                                                                            )
                                                                                                                ?.sessionLevels
                                                                                                                .length ||
                                                                                                                0}{' '}
                                                                                                            batches
                                                                                                            assigned
                                                                                                        </span>
                                                                                                    )}
                                                                                                </div>
                                                                                            </div>
                                                                                            <div className="flex gap-2">
                                                                                                {(hasSessions ===
                                                                                                    'yes' ||
                                                                                                    hasLevels ===
                                                                                                        'yes') && (
                                                                                                    <MyButton
                                                                                                        type="button"
                                                                                                        buttonType="secondary"
                                                                                                        scale="small"
                                                                                                        layoutVariant="default"
                                                                                                        onClick={() => {
                                                                                                            setSelectedInstructorId(
                                                                                                                instructor.id
                                                                                                            );
                                                                                                            setSelectedInstructorEmail(
                                                                                                                instructor.email
                                                                                                            );
                                                                                                            const existingMappings =
                                                                                                                instructorMappings.find(
                                                                                                                    (
                                                                                                                        m
                                                                                                                    ) =>
                                                                                                                        m.id ===
                                                                                                                        instructor.id
                                                                                                                );
                                                                                                            setSelectedSessionLevels(
                                                                                                                existingMappings?.sessionLevels ||
                                                                                                                    []
                                                                                                            );
                                                                                                            setShowAssignmentCard(
                                                                                                                true
                                                                                                            );
                                                                                                        }}
                                                                                                    >
                                                                                                        {instructorMappings.find(
                                                                                                            (
                                                                                                                m
                                                                                                            ) =>
                                                                                                                m.id ===
                                                                                                                instructor.id
                                                                                                        )
                                                                                                            ? 'Edit'
                                                                                                            : 'Assign'}
                                                                                                    </MyButton>
                                                                                                )}
                                                                                                {instructor.id !==
                                                                                                    tokenData?.user && (
                                                                                                    <MyButton
                                                                                                        type="button"
                                                                                                        buttonType="text"
                                                                                                        scale="medium"
                                                                                                        layoutVariant="icon"
                                                                                                        onClick={() => {
                                                                                                            const updatedInstructors =
                                                                                                                (
                                                                                                                    selectedInstructors: Instructor[]
                                                                                                                ) =>
                                                                                                                    selectedInstructors.filter(
                                                                                                                        (
                                                                                                                            i
                                                                                                                        ) =>
                                                                                                                            i.id !==
                                                                                                                            instructor.id
                                                                                                                    );
                                                                                                            setSelectedInstructors(
                                                                                                                updatedInstructors
                                                                                                            );
                                                                                                            form.setValue(
                                                                                                                'selectedInstructors',
                                                                                                                updatedInstructors(
                                                                                                                    selectedInstructors
                                                                                                                )
                                                                                                            );
                                                                                                            const updatedSessions =
                                                                                                                form
                                                                                                                    .getValues(
                                                                                                                        'sessions'
                                                                                                                    )
                                                                                                                    .map(
                                                                                                                        (
                                                                                                                            session
                                                                                                                        ) => ({
                                                                                                                            ...session,
                                                                                                                            levels: session.levels.map(
                                                                                                                                (
                                                                                                                                    level
                                                                                                                                ) => ({
                                                                                                                                    ...level,
                                                                                                                                    userIds:
                                                                                                                                        level.userIds.filter(
                                                                                                                                            (
                                                                                                                                                user
                                                                                                                                            ) =>
                                                                                                                                                user.id !==
                                                                                                                                                instructor.id
                                                                                                                                        ),
                                                                                                                                })
                                                                                                                            ),
                                                                                                                        })
                                                                                                                    );
                                                                                                            form.setValue(
                                                                                                                'sessions',
                                                                                                                updatedSessions,
                                                                                                                {
                                                                                                                    shouldDirty:
                                                                                                                        true,
                                                                                                                }
                                                                                                            );
                                                                                                            setInstructorMappings(
                                                                                                                (
                                                                                                                    prev
                                                                                                                ) =>
                                                                                                                    prev.filter(
                                                                                                                        (
                                                                                                                            m
                                                                                                                        ) =>
                                                                                                                            m.id !==
                                                                                                                            instructor.id
                                                                                                                    )
                                                                                                            );
                                                                                                        }}
                                                                                                        className="!size-6 text-red-600 hover:text-red-700"
                                                                                                    >
                                                                                                        <Trash2 className="size-3" />
                                                                                                    </MyButton>
                                                                                                )}
                                                                                            </div>
                                                                                        </div>

                                                                                        {/* Per-author role, photo, subtitle & description */}
                                                                                        <div className="mt-2 space-y-2">
                                                                                            <AuthorRoleField
                                                                                                value={
                                                                                                    instructor.roleLabel
                                                                                                }
                                                                                                options={
                                                                                                    authorRoleChoices
                                                                                                }
                                                                                                defaultTerm={getTerminology(
                                                                                                    RoleTerms.Teacher,
                                                                                                    SystemTerms.Teacher
                                                                                                )}
                                                                                                onChange={(
                                                                                                    role
                                                                                                ) =>
                                                                                                    handleAuthorMetaChange(
                                                                                                        instructor.id,
                                                                                                        'roleLabel',
                                                                                                        role
                                                                                                    )
                                                                                                }
                                                                                            />
                                                                                            <div>
                                                                                                <Label className="mb-1 block text-xs font-medium text-gray-700">
                                                                                                    Author
                                                                                                    Photo
                                                                                                </Label>
                                                                                                <div className="flex items-center gap-3">
                                                                                                    <Avatar className="size-12">
                                                                                                        <AvatarImage
                                                                                                            src={
                                                                                                                authorPhotoUrls[
                                                                                                                    instructor
                                                                                                                        .profilePicId
                                                                                                                ] ??
                                                                                                                ''
                                                                                                            }
                                                                                                            className="object-cover"
                                                                                                            alt={
                                                                                                                instructor.name
                                                                                                            }
                                                                                                        />
                                                                                                        <AvatarFallback className="bg-gray-100 text-xs font-medium text-gray-500">
                                                                                                            {getInitials(
                                                                                                                instructor.email
                                                                                                            )}
                                                                                                        </AvatarFallback>
                                                                                                    </Avatar>
                                                                                                    <label
                                                                                                        className={`inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md border border-gray-300 px-3 text-xs font-medium text-gray-700 hover:bg-gray-50 ${uploadingAuthorPhotoFor === instructor.id ? 'pointer-events-none opacity-60' : ''}`}
                                                                                                    >
                                                                                                        <UploadSimple
                                                                                                            size={
                                                                                                                14
                                                                                                            }
                                                                                                        />
                                                                                                        {uploadingAuthorPhotoFor ===
                                                                                                        instructor.id
                                                                                                            ? 'Uploading...'
                                                                                                            : instructor.profilePicId
                                                                                                              ? 'Change photo'
                                                                                                              : 'Upload photo'}
                                                                                                        <input
                                                                                                            type="file"
                                                                                                            accept="image/*"
                                                                                                            className="hidden"
                                                                                                            disabled={
                                                                                                                uploadingAuthorPhotoFor ===
                                                                                                                instructor.id
                                                                                                            }
                                                                                                            onChange={(
                                                                                                                e
                                                                                                            ) => {
                                                                                                                void handleAuthorPhotoUpload(
                                                                                                                    instructor.id,
                                                                                                                    e
                                                                                                                        .target
                                                                                                                        .files?.[0]
                                                                                                                );
                                                                                                                e.target.value =
                                                                                                                    '';
                                                                                                            }}
                                                                                                        />
                                                                                                    </label>
                                                                                                </div>
                                                                                                <p className="mt-1 text-xs text-gray-500">
                                                                                                    Shown
                                                                                                    with
                                                                                                    this
                                                                                                    author
                                                                                                    on
                                                                                                    every
                                                                                                    course
                                                                                                    they
                                                                                                    teach.
                                                                                                </p>
                                                                                            </div>
                                                                                            <div>
                                                                                                <Label className="mb-1 block text-xs font-medium text-gray-700">
                                                                                                    Author
                                                                                                    Subtitle
                                                                                                </Label>
                                                                                                <Input
                                                                                                    placeholder="e.g., Ph.D. in Physics, Educator & Author"
                                                                                                    value={
                                                                                                        instructor.authorSubtitle ??
                                                                                                        ''
                                                                                                    }
                                                                                                    onChange={(
                                                                                                        e
                                                                                                    ) =>
                                                                                                        handleAuthorMetaChange(
                                                                                                            instructor.id,
                                                                                                            'authorSubtitle',
                                                                                                            e
                                                                                                                .target
                                                                                                                .value
                                                                                                        )
                                                                                                    }
                                                                                                    className="h-8 border-gray-300 text-xs"
                                                                                                />
                                                                                            </div>
                                                                                            <div>
                                                                                                <Label className="mb-1 block text-xs font-medium text-gray-700">
                                                                                                    Author
                                                                                                    Description
                                                                                                </Label>
                                                                                                <RichTextEditor
                                                                                                    placeholder="Short bio / description of the author"
                                                                                                    value={
                                                                                                        instructor.authorDescription ??
                                                                                                        ''
                                                                                                    }
                                                                                                    onChange={(
                                                                                                        html
                                                                                                    ) =>
                                                                                                        handleAuthorMetaChange(
                                                                                                            instructor.id,
                                                                                                            'authorDescription',
                                                                                                            html
                                                                                                        )
                                                                                                    }
                                                                                                    minHeight={
                                                                                                        80
                                                                                                    }
                                                                                                />
                                                                                            </div>
                                                                                        </div>

                                                                                        {isAssigning && (
                                                                                            <>
                                                                                                <Separator className="my-3" />
                                                                                                <div className="grid grid-cols-2 gap-4">
                                                                                                    {hasSessions ===
                                                                                                        'yes' &&
                                                                                                        hasLevels ===
                                                                                                            'yes' &&
                                                                                                        sessions.map(
                                                                                                            (
                                                                                                                session
                                                                                                            ) => {
                                                                                                                const allLevelsSelected =
                                                                                                                    session
                                                                                                                        .levels
                                                                                                                        .length >
                                                                                                                        0 &&
                                                                                                                    session.levels.every(
                                                                                                                        (
                                                                                                                            level
                                                                                                                        ) =>
                                                                                                                            selectedSessionLevels.some(
                                                                                                                                (
                                                                                                                                    item
                                                                                                                                ) =>
                                                                                                                                    item.sessionId ===
                                                                                                                                        session.id &&
                                                                                                                                    item.levelId ===
                                                                                                                                        level.id
                                                                                                                            )
                                                                                                                    );
                                                                                                                return (
                                                                                                                    <div
                                                                                                                        key={
                                                                                                                            session.id
                                                                                                                        }
                                                                                                                    >
                                                                                                                        <div className="mb-2 flex items-center">
                                                                                                                            <Checkbox
                                                                                                                                checked={
                                                                                                                                    allLevelsSelected
                                                                                                                                }
                                                                                                                                onCheckedChange={() => {
                                                                                                                                    if (
                                                                                                                                        allLevelsSelected
                                                                                                                                    ) {
                                                                                                                                        setSelectedSessionLevels(
                                                                                                                                            (
                                                                                                                                                prev
                                                                                                                                            ) =>
                                                                                                                                                prev.filter(
                                                                                                                                                    (
                                                                                                                                                        item
                                                                                                                                                    ) =>
                                                                                                                                                        item.sessionId !==
                                                                                                                                                        session.id
                                                                                                                                                )
                                                                                                                                        );
                                                                                                                                    } else {
                                                                                                                                        setSelectedSessionLevels(
                                                                                                                                            (
                                                                                                                                                prev
                                                                                                                                            ) => {
                                                                                                                                                const newLevels =
                                                                                                                                                    session.levels
                                                                                                                                                        .filter(
                                                                                                                                                            (
                                                                                                                                                                level
                                                                                                                                                            ) =>
                                                                                                                                                                !prev.some(
                                                                                                                                                                    (
                                                                                                                                                                        item
                                                                                                                                                                    ) =>
                                                                                                                                                                        item.sessionId ===
                                                                                                                                                                            session.id &&
                                                                                                                                                                        item.levelId ===
                                                                                                                                                                            level.id
                                                                                                                                                                )
                                                                                                                                                        )
                                                                                                                                                        .map(
                                                                                                                                                            (
                                                                                                                                                                level
                                                                                                                                                            ) => ({
                                                                                                                                                                sessionId:
                                                                                                                                                                    session.id,
                                                                                                                                                                sessionName:
                                                                                                                                                                    session.name,
                                                                                                                                                                levelId:
                                                                                                                                                                    level.id,
                                                                                                                                                                levelName:
                                                                                                                                                                    level.name,
                                                                                                                                                            })
                                                                                                                                                        );
                                                                                                                                                return [
                                                                                                                                                    ...prev,
                                                                                                                                                    ...newLevels,
                                                                                                                                                ];
                                                                                                                                            }
                                                                                                                                        );
                                                                                                                                    }
                                                                                                                                }}
                                                                                                                                className="mr-2 size-4"
                                                                                                                            />
                                                                                                                            <h4 className="text-sm font-medium text-gray-700">
                                                                                                                                {
                                                                                                                                    session.name
                                                                                                                                }
                                                                                                                            </h4>
                                                                                                                        </div>
                                                                                                                        <div className="space-y-1">
                                                                                                                            {session.levels.map(
                                                                                                                                (
                                                                                                                                    level
                                                                                                                                ) => {
                                                                                                                                    const isChecked =
                                                                                                                                        selectedSessionLevels.some(
                                                                                                                                            (
                                                                                                                                                item
                                                                                                                                            ) =>
                                                                                                                                                item.sessionId ===
                                                                                                                                                    session.id &&
                                                                                                                                                item.levelId ===
                                                                                                                                                    level.id
                                                                                                                                        );
                                                                                                                                    return (
                                                                                                                                        <div
                                                                                                                                            key={`${session.id}-${level.id}`}
                                                                                                                                            className="flex items-center gap-2 rounded border border-gray-100 bg-gray-50 px-2 py-1"
                                                                                                                                        >
                                                                                                                                            <Checkbox
                                                                                                                                                checked={
                                                                                                                                                    isChecked
                                                                                                                                                }
                                                                                                                                                onCheckedChange={() =>
                                                                                                                                                    handleSessionLevelCheckboxChange(
                                                                                                                                                        session.id,
                                                                                                                                                        session.name,
                                                                                                                                                        level.id,
                                                                                                                                                        level.name
                                                                                                                                                    )
                                                                                                                                                }
                                                                                                                                                className="size-4"
                                                                                                                                            />
                                                                                                                                            <span className="text-sm text-gray-700">{`${session.name} - ${level.name}`}</span>
                                                                                                                                        </div>
                                                                                                                                    );
                                                                                                                                }
                                                                                                                            )}
                                                                                                                        </div>
                                                                                                                    </div>
                                                                                                                );
                                                                                                            }
                                                                                                        )}
                                                                                                    {hasSessions ===
                                                                                                        'yes' &&
                                                                                                        hasLevels !==
                                                                                                            'yes' &&
                                                                                                        (() => {
                                                                                                            const allSessionsSelected =
                                                                                                                sessions.length >
                                                                                                                    0 &&
                                                                                                                sessions.every(
                                                                                                                    (
                                                                                                                        session
                                                                                                                    ) =>
                                                                                                                        selectedSessionLevels.some(
                                                                                                                            (
                                                                                                                                item
                                                                                                                            ) =>
                                                                                                                                item.sessionId ===
                                                                                                                                session.id
                                                                                                                        )
                                                                                                                );
                                                                                                            return (
                                                                                                                <div className="space-y-1">
                                                                                                                    <div className="mb-2 flex items-center">
                                                                                                                        <Checkbox
                                                                                                                            checked={
                                                                                                                                allSessionsSelected
                                                                                                                            }
                                                                                                                            onCheckedChange={() => {
                                                                                                                                if (
                                                                                                                                    allSessionsSelected
                                                                                                                                ) {
                                                                                                                                    setSelectedSessionLevels(
                                                                                                                                        (
                                                                                                                                            prev
                                                                                                                                        ) =>
                                                                                                                                            prev.filter(
                                                                                                                                                (
                                                                                                                                                    item
                                                                                                                                                ) =>
                                                                                                                                                    !sessions.some(
                                                                                                                                                        (
                                                                                                                                                            session
                                                                                                                                                        ) =>
                                                                                                                                                            item.sessionId ===
                                                                                                                                                            session.id
                                                                                                                                                    )
                                                                                                                                            )
                                                                                                                                    );
                                                                                                                                } else {
                                                                                                                                    setSelectedSessionLevels(
                                                                                                                                        (
                                                                                                                                            prev
                                                                                                                                        ) => {
                                                                                                                                            const newSessions =
                                                                                                                                                sessions
                                                                                                                                                    .filter(
                                                                                                                                                        (
                                                                                                                                                            session
                                                                                                                                                        ) =>
                                                                                                                                                            !prev.some(
                                                                                                                                                                (
                                                                                                                                                                    item
                                                                                                                                                                ) =>
                                                                                                                                                                    item.sessionId ===
                                                                                                                                                                    session.id
                                                                                                                                                            )
                                                                                                                                                    )
                                                                                                                                                    .map(
                                                                                                                                                        (
                                                                                                                                                            session
                                                                                                                                                        ) => ({
                                                                                                                                                            sessionId:
                                                                                                                                                                session.id,
                                                                                                                                                            sessionName:
                                                                                                                                                                session.name,
                                                                                                                                                            levelId:
                                                                                                                                                                'DEFAULT',
                                                                                                                                                            levelName:
                                                                                                                                                                '',
                                                                                                                                                        })
                                                                                                                                                    );
                                                                                                                                            return [
                                                                                                                                                ...prev,
                                                                                                                                                ...newSessions,
                                                                                                                                            ];
                                                                                                                                        }
                                                                                                                                    );
                                                                                                                                }
                                                                                                                            }}
                                                                                                                            className="mr-2 size-4"
                                                                                                                        />
                                                                                                                        <span className="text-sm font-medium text-gray-700">
                                                                                                                            Select
                                                                                                                            All
                                                                                                                        </span>
                                                                                                                    </div>
                                                                                                                    {sessions.map(
                                                                                                                        (
                                                                                                                            session
                                                                                                                        ) => {
                                                                                                                            const isChecked =
                                                                                                                                selectedSessionLevels.some(
                                                                                                                                    (
                                                                                                                                        item
                                                                                                                                    ) =>
                                                                                                                                        item.sessionId ===
                                                                                                                                        session.id
                                                                                                                                );
                                                                                                                            return (
                                                                                                                                <div
                                                                                                                                    key={
                                                                                                                                        session.id
                                                                                                                                    }
                                                                                                                                    className="flex items-center gap-2 rounded border border-gray-100 bg-gray-50 px-2 py-1"
                                                                                                                                >
                                                                                                                                    <Checkbox
                                                                                                                                        checked={
                                                                                                                                            isChecked
                                                                                                                                        }
                                                                                                                                        onCheckedChange={() =>
                                                                                                                                            handleSessionLevelCheckboxChange(
                                                                                                                                                session.id,
                                                                                                                                                session.name,
                                                                                                                                                'DEFAULT',
                                                                                                                                                ''
                                                                                                                                            )
                                                                                                                                        }
                                                                                                                                        className="size-4"
                                                                                                                                    />
                                                                                                                                    <span className="text-sm text-gray-700">
                                                                                                                                        {
                                                                                                                                            session.name
                                                                                                                                        }
                                                                                                                                    </span>
                                                                                                                                </div>
                                                                                                                            );
                                                                                                                        }
                                                                                                                    )}
                                                                                                                </div>
                                                                                                            );
                                                                                                        })()}
                                                                                                    {hasSessions !==
                                                                                                        'yes' &&
                                                                                                        hasLevels ===
                                                                                                            'yes' &&
                                                                                                        (() => {
                                                                                                            const standaloneSession =
                                                                                                                sessions.find(
                                                                                                                    (
                                                                                                                        s
                                                                                                                    ) =>
                                                                                                                        s.id ===
                                                                                                                        'DEFAULT'
                                                                                                                );
                                                                                                            const levels =
                                                                                                                standaloneSession?.levels ||
                                                                                                                [];
                                                                                                            const allLevelsSelected =
                                                                                                                levels.length >
                                                                                                                    0 &&
                                                                                                                levels.every(
                                                                                                                    (
                                                                                                                        level
                                                                                                                    ) =>
                                                                                                                        selectedSessionLevels.some(
                                                                                                                            (
                                                                                                                                item
                                                                                                                            ) =>
                                                                                                                                item.levelId ===
                                                                                                                                level.id
                                                                                                                        )
                                                                                                                );
                                                                                                            return (
                                                                                                                <div className="space-y-1">
                                                                                                                    <div className="mb-2 flex items-center">
                                                                                                                        <Checkbox
                                                                                                                            checked={
                                                                                                                                allLevelsSelected
                                                                                                                            }
                                                                                                                            onCheckedChange={() => {
                                                                                                                                if (
                                                                                                                                    allLevelsSelected
                                                                                                                                ) {
                                                                                                                                    setSelectedSessionLevels(
                                                                                                                                        (
                                                                                                                                            prev
                                                                                                                                        ) =>
                                                                                                                                            prev.filter(
                                                                                                                                                (
                                                                                                                                                    item
                                                                                                                                                ) =>
                                                                                                                                                    !levels.some(
                                                                                                                                                        (
                                                                                                                                                            level
                                                                                                                                                        ) =>
                                                                                                                                                            item.levelId ===
                                                                                                                                                            level.id
                                                                                                                                                    )
                                                                                                                                            )
                                                                                                                                    );
                                                                                                                                } else {
                                                                                                                                    setSelectedSessionLevels(
                                                                                                                                        (
                                                                                                                                            prev
                                                                                                                                        ) => {
                                                                                                                                            const newLevels =
                                                                                                                                                levels
                                                                                                                                                    .filter(
                                                                                                                                                        (
                                                                                                                                                            level
                                                                                                                                                        ) =>
                                                                                                                                                            !prev.some(
                                                                                                                                                                (
                                                                                                                                                                    item
                                                                                                                                                                ) =>
                                                                                                                                                                    item.levelId ===
                                                                                                                                                                    level.id
                                                                                                                                                            )
                                                                                                                                                    )
                                                                                                                                                    .map(
                                                                                                                                                        (
                                                                                                                                                            level
                                                                                                                                                        ) => ({
                                                                                                                                                            sessionId:
                                                                                                                                                                'DEFAULT',
                                                                                                                                                            sessionName:
                                                                                                                                                                '',
                                                                                                                                                            levelId:
                                                                                                                                                                level.id,
                                                                                                                                                            levelName:
                                                                                                                                                                level.name,
                                                                                                                                                        })
                                                                                                                                                    );
                                                                                                                                            return [
                                                                                                                                                ...prev,
                                                                                                                                                ...newLevels,
                                                                                                                                            ];
                                                                                                                                        }
                                                                                                                                    );
                                                                                                                                }
                                                                                                                            }}
                                                                                                                            className="mr-2 size-4"
                                                                                                                        />
                                                                                                                        <span className="text-sm font-medium text-gray-700">
                                                                                                                            Select
                                                                                                                            All
                                                                                                                        </span>
                                                                                                                    </div>
                                                                                                                    {levels.map(
                                                                                                                        (
                                                                                                                            level
                                                                                                                        ) => {
                                                                                                                            const isChecked =
                                                                                                                                selectedSessionLevels.some(
                                                                                                                                    (
                                                                                                                                        item
                                                                                                                                    ) =>
                                                                                                                                        item.levelId ===
                                                                                                                                        level.id
                                                                                                                                );
                                                                                                                            return (
                                                                                                                                <div
                                                                                                                                    key={
                                                                                                                                        level.id
                                                                                                                                    }
                                                                                                                                    className="flex items-center gap-2 rounded border border-gray-100 bg-gray-50 px-2 py-1"
                                                                                                                                >
                                                                                                                                    <Checkbox
                                                                                                                                        checked={
                                                                                                                                            isChecked
                                                                                                                                        }
                                                                                                                                        onCheckedChange={() =>
                                                                                                                                            handleSessionLevelCheckboxChange(
                                                                                                                                                'DEFAULT',
                                                                                                                                                '',
                                                                                                                                                level.id,
                                                                                                                                                level.name
                                                                                                                                            )
                                                                                                                                        }
                                                                                                                                        className="size-4"
                                                                                                                                    />
                                                                                                                                    <span className="text-sm text-gray-700">
                                                                                                                                        {
                                                                                                                                            level.name
                                                                                                                                        }
                                                                                                                                    </span>
                                                                                                                                </div>
                                                                                                                            );
                                                                                                                        }
                                                                                                                    )}
                                                                                                                </div>
                                                                                                            );
                                                                                                        })()}
                                                                                                </div>
                                                                                                <div className="mt-3 flex justify-end gap-2">
                                                                                                    <MyButton
                                                                                                        type="button"
                                                                                                        buttonType="secondary"
                                                                                                        scale="small"
                                                                                                        layoutVariant="default"
                                                                                                        onClick={() => {
                                                                                                            setShowAssignmentCard(
                                                                                                                false
                                                                                                            );
                                                                                                            setSelectedSessionLevels(
                                                                                                                []
                                                                                                            );
                                                                                                        }}
                                                                                                    >
                                                                                                        Cancel
                                                                                                    </MyButton>
                                                                                                    <MyButton
                                                                                                        type="button"
                                                                                                        buttonType="primary"
                                                                                                        scale="small"
                                                                                                        layoutVariant="default"
                                                                                                        onClick={
                                                                                                            handleAssignmentSave
                                                                                                        }
                                                                                                        disable={
                                                                                                            !instructorMappings.find(
                                                                                                                (
                                                                                                                    m
                                                                                                                ) =>
                                                                                                                    m.id ===
                                                                                                                    selectedInstructorId
                                                                                                            ) &&
                                                                                                            selectedSessionLevels.length ===
                                                                                                                0
                                                                                                        }
                                                                                                    >
                                                                                                        Save
                                                                                                    </MyButton>
                                                                                                </div>
                                                                                            </>
                                                                                        )}
                                                                                    </CardContent>
                                                                                </Card>
                                                                            );
                                                                        }
                                                                    )}
                                                                </div>
                                                            )}
                                                    </div>
                                                </div>
                                            </CollapsibleContent>
                                        </Collapsible>
                                    </>
                                )}

                                {!courseSettings?.catalogueSettings?.autoPublishToCatalogue ? (
                                    <>
                                        <Separator className="bg-gray-200" />

                                        {/* Course Catalogue Section */}
                                        <div className="space-y-2">
                                            <div className="flex items-center space-x-3">
                                                <Checkbox
                                                    id="publish-catalogue"
                                                    checked={publishToCatalogue}
                                                    onCheckedChange={handlePublishChange}
                                                    className="data-[state=checked]:border-[#3B82F6] data-[state=checked]:bg-[#3B82F6]"
                                                />
                                                <Label
                                                    htmlFor="publish-catalogue"
                                                    className="text-base font-medium text-gray-900"
                                                >
                                                    Publish to{' '}
                                                    {getTerminology(
                                                        ContentTerms.Course,
                                                        SystemTerms.Course
                                                    )}{' '}
                                                    Catalogue
                                                </Label>
                                            </div>
                                            <p className="ml-7 text-sm text-gray-600">
                                                The{' '}
                                                {getTerminology(
                                                    ContentTerms.Course,
                                                    SystemTerms.Course
                                                ).toLocaleLowerCase()}{' '}
                                                will be added to the{' '}
                                                {getTerminology(
                                                    ContentTerms.Course,
                                                    SystemTerms.Course
                                                ).toLocaleLowerCase()}{' '}
                                                catalogue which will be viewed by the learners.
                                            </p>
                                        </div>

                                        <Separator className="bg-gray-200" />
                                    </>
                                ) : null}
                            </CardContent>
                        </Card>

                        {/* Advanced Settings (per-course course_setting JSON) */}
                        {!isEdit && (
                            <Card className="mt-6">
                                <CardContent className="pt-6">
                                    <Collapsible>
                                        <CollapsibleTrigger className="flex w-full items-center justify-between text-left">
                                            <span className="font-semibold text-neutral-700">
                                                Advanced Settings (JSON, optional)
                                            </span>
                                            <span className="text-xs text-primary-500">
                                                Show / hide
                                            </span>
                                        </CollapsibleTrigger>
                                        <CollapsibleContent className="mt-3 space-y-2">
                                            <p className="text-xs text-muted-foreground">
                                                Advanced per-
                                                {getTerminology(
                                                    ContentTerms.Course,
                                                    SystemTerms.Course
                                                ).toLocaleLowerCase()}{' '}
                                                settings used by workflows (LMS config, retention,
                                                etc.). Must be a JSON object wrapped in a{' '}
                                                <code>{'{ "setting": { ... } }'}</code> envelope.
                                                You can also edit this later from the{' '}
                                                {getTerminology(
                                                    ContentTerms.Course,
                                                    SystemTerms.Course
                                                ).toLocaleLowerCase()}
                                                &apos;s Settings tab. Leave empty to skip.
                                            </p>
                                            <Textarea
                                                spellCheck={false}
                                                placeholder={'{\n  "setting": {}\n}'}
                                                className="min-h-[180px] font-mono text-xs"
                                                value={form.watch('courseSettingJson') ?? ''}
                                                onChange={(e) =>
                                                    form.setValue(
                                                        'courseSettingJson',
                                                        e.target.value
                                                    )
                                                }
                                            />
                                        </CollapsibleContent>
                                    </Collapsible>
                                </CardContent>
                            </Card>
                        )}
                    </div>

                    {/* Footer */}
                    <div className="shrink-0 border-t bg-white px-8 py-4">
                        <div className="flex justify-between">
                            <MyButton
                                type="button"
                                buttonType="secondary"
                                scale="large"
                                layoutVariant="default"
                                onClick={onBack}
                            >
                                Back
                            </MyButton>
                            <MyButton
                                type="button"
                                buttonType="primary"
                                scale="large"
                                layoutVariant="default"
                                onClick={(e) => {
                                    e.preventDefault();
                                    handleSubmit(form.getValues());
                                }}
                                disable={
                                    disableCreate ||
                                    (hasSessions === 'yes' && hasLevels === 'yes'
                                        ? sessions.length === 0 ||
                                          sessions.every((s) => !s.levels || s.levels.length === 0)
                                        : hasSessions === 'yes'
                                          ? sessions.length === 0
                                          : hasLevels === 'yes'
                                            ? !sessions.find((s) => s.id === 'DEFAULT') ||
                                              sessions.find((s) => s.id === 'DEFAULT')?.levels
                                                  .length === 0
                                            : false)
                                }
                            >
                                {isLoading ? (
                                    <span className="flex items-center gap-2">
                                        <span className="size-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                                        {isEdit ? 'Updating...' : 'Creating...'}
                                    </span>
                                ) : !isFinalStep ? (
                                    'Next'
                                ) : (
                                    <>
                                        {!isEdit && <Plus />}
                                        {isEdit ? 'Edit' : 'Create'}
                                    </>
                                )}
                            </MyButton>
                        </div>
                    </div>
                </form>
            </Form>

            {/* Move dialogs outside the Form component */}
            <SessionLevelMappingDialog
                open={showMappingDialog}
                onOpenChange={setShowMappingDialog}
                sessions={sessions}
                onSave={handleSessionLevelMappingSave}
            />
            <AlertDialog
                open={pendingRemoval !== null}
                onOpenChange={(next) => !next && setPendingRemoval(null)}
            >
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>
                            Remove {pendingRemoval?.term} &quot;{pendingRemoval?.name}&quot;?
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                            This {pendingRemoval?.term.toLowerCase()} is already saved. When you
                            save the course, its batch is deleted and the course stops showing it to
                            admins and learners. To keep it, choose Cancel.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                            className="bg-danger-600 hover:bg-danger-500"
                            onClick={confirmPendingRemoval}
                        >
                            Remove
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </>
    );
};

export default AddCourseStep2;

// Update SessionCard component to conditionally show level functionality
const SessionCard: React.FC<{
    session: Session;
    hasLevels: boolean;
    onRemoveSession: (sessionId: string, batchId?: string) => void;
    onAddLevel: (sessionId: string, levelName: string, levelId?: string) => void;
    onRemoveLevel: (sessionId: string, batchId: string) => void;
    onRenameSession: (sessionId: string, name: string) => void;
    onRenameLevel: (sessionId: string, batchId: string, name: string) => void;
    onValidateSessionName: (sessionId: string, name: string) => string | null;
    onValidateLevelName: (sessionId: string, batchId: string, name: string) => string | null;
    onGetRenameShareWarning: (rowType: 'session' | 'level', rowId?: string) => string | null;
    hasSessionsFlag: boolean;
    containsSubgroupFlag: boolean;
    enableSubgroupControlsFlag: boolean;
    onAddLevelSubgroup: (sessionId: string, levelBatchId: string) => void;
    onLevelSubgroupNameChange: (
        sessionId: string,
        levelBatchId: string,
        index: number,
        name: string
    ) => void;
    onRemoveLevelSubgroupRow: (sessionId: string, levelBatchId: string, index: number) => void;
    existingBatches?: ExistingBatch[];
    onMarkBatchesAsUsed?: (batchIds: string[]) => void;
    limitLevelsToOne: boolean;
    canAddMoreLevels: boolean;
}> = ({
    session,
    hasLevels,
    onRemoveSession,
    onAddLevel,
    onRemoveLevel,
    onRenameSession,
    onRenameLevel,
    onValidateSessionName,
    onValidateLevelName,
    onGetRenameShareWarning,
    hasSessionsFlag,
    containsSubgroupFlag,
    enableSubgroupControlsFlag,
    onAddLevelSubgroup,
    onLevelSubgroupNameChange,
    onRemoveLevelSubgroupRow,
    existingBatches = [],
    onMarkBatchesAsUsed,
    limitLevelsToOne,
    canAddMoreLevels,
}) => {
    const [showAddLevel, setShowAddLevel] = useState(false);
    const [newLevelName, setNewLevelName] = useState('');
    const [addLevelMode, setAddLevelMode] = useState<'new' | 'existing'>('existing');
    const [selectedExistingLevelBatchIds, setSelectedExistingLevelBatchIds] = useState<string[]>(
        []
    );

    // Auto-open Add Level dialog on mount if hasLevels is true
    useEffect(() => {
        if (hasLevels && canAddMoreLevels) {
            setShowAddLevel(true);
        }
    }, [hasLevels, canAddMoreLevels]);

    const handleAddLevel = () => {
        if (!canAddMoreLevels) {
            return;
        }
        if (newLevelName.trim()) {
            onAddLevel(session.id, newLevelName);
            setNewLevelName('');
            setShowAddLevel(false);
        }
    };

    // Get existing levels for this specific session that are not already added
    const getExistingLevelsForSession = (sessionId: string) => {
        const allBatchesForSession = existingBatches.filter(
            (batch) =>
                batch.session.id === sessionId && batch.level.level_name.toLowerCase() !== 'default'
        );
        // Filter out levels that are already added to this session
        return allBatchesForSession.filter(
            (batch) => !session.levels.some((level) => level.id === batch.level.id)
        );
    };

    const existingLevelsForSession = getExistingLevelsForSession(session.id);

    return (
        <Card className="border-gray-200">
            <CardContent className="p-3">
                <div className="mb-3 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <Calendar className="size-4 text-[#3B82F6]" />
                        <div className="flex items-center gap-2">
                            <InlineNameEditor
                                value={session.name}
                                onSave={(name) => onRenameSession(sessionKeyOf(session), name)}
                                validate={(name) =>
                                    onValidateSessionName(sessionKeyOf(session), name)
                                }
                                warning={onGetRenameShareWarning('session', session.id)}
                                editLabel={`Rename ${getTerminology(
                                    ContentTerms.Session,
                                    SystemTerms.Session
                                )}`}
                                textClassName="text-sm font-medium text-gray-900"
                            />
                            <span className="text-xs text-gray-500">
                                {new Date(session.startDate).toLocaleDateString()}
                            </span>
                        </div>
                    </div>
                    <div className="flex gap-2">
                        {hasLevels && (
                            <MyButton
                                type="button"
                                buttonType="secondary"
                                scale="medium"
                                layoutVariant="default"
                                onClick={() => canAddMoreLevels && setShowAddLevel(true)}
                                className="font-light"
                                disable={!canAddMoreLevels}
                            >
                                <Plus />
                                Add {getTerminology(ContentTerms.Level, SystemTerms.Level)}
                            </MyButton>
                        )}
                        <MyButton
                            type="button"
                            buttonType="text"
                            scale="medium"
                            layoutVariant="icon"
                            onClick={() =>
                                onRemoveSession((session.batchId || session.id).toString())
                            }
                            className="text-red-600 hover:text-red-700"
                        >
                            <Trash2 className="size-3" />
                        </MyButton>
                    </div>
                </div>

                {limitLevelsToOne && !canAddMoreLevels && (
                    <p className="mb-2 text-xs text-gray-500">
                        Only one level can be configured. Remove an existing level to make changes.
                    </p>
                )}

                {hasLevels && (
                    <>
                        {showAddLevel && (
                            <div className="mb-3 rounded-lg border bg-gray-50 p-3">
                                <div className="mb-3">
                                    <RadioGroup
                                        value={addLevelMode}
                                        onValueChange={(val) =>
                                            setAddLevelMode(val as 'new' | 'existing')
                                        }
                                        className="flex gap-6"
                                    >
                                        <div className="flex items-center space-x-2">
                                            <RadioGroupItem
                                                value="existing"
                                                id={`add-level-existing-${session.id}`}
                                            />
                                            <Label
                                                htmlFor={`add-level-existing-${session.id}`}
                                                className="text-sm font-normal"
                                            >
                                                Existing Levels
                                            </Label>
                                        </div>
                                        <div className="flex items-center space-x-2">
                                            <RadioGroupItem
                                                value="new"
                                                id={`add-level-new-${session.id}`}
                                            />
                                            <Label
                                                htmlFor={`add-level-new-${session.id}`}
                                                className="text-sm font-normal"
                                            >
                                                New Level
                                            </Label>
                                        </div>
                                    </RadioGroup>
                                </div>

                                {addLevelMode === 'new' && (
                                    <div>
                                        <Label className="mb-1 block text-sm font-medium text-gray-700">
                                            Level Name
                                        </Label>
                                        <Input
                                            placeholder="Enter level name (e.g., Basic)"
                                            value={newLevelName}
                                            onChange={(e) => setNewLevelName(e.target.value)}
                                            className="h-8 border-gray-300"
                                        />
                                    </div>
                                )}

                                {addLevelMode === 'existing' && (
                                    <div className="mt-2">
                                        <Label className="mb-2 block text-sm font-medium text-gray-700">
                                            Select Levels
                                        </Label>
                                        {existingLevelsForSession.length === 0 ? (
                                            <div className="text-sm text-gray-500">
                                                No existing levels found for this session.
                                            </div>
                                        ) : limitLevelsToOne ? (
                                            <RadioGroup
                                                value={selectedExistingLevelBatchIds[0] || ''}
                                                onValueChange={(val) =>
                                                    setSelectedExistingLevelBatchIds(
                                                        val ? [val] : []
                                                    )
                                                }
                                                className="space-y-1"
                                            >
                                                {existingLevelsForSession.map(
                                                    (batch: ExistingBatch) => (
                                                        <label
                                                            key={batch.id}
                                                            className="flex items-center gap-2 rounded border border-gray-100 bg-gray-50 px-2 py-1"
                                                        >
                                                            <RadioGroupItem
                                                                value={batch.id}
                                                                className="size-4"
                                                            />
                                                            <span className="text-sm text-gray-700">
                                                                {batch.level.level_name}
                                                            </span>
                                                        </label>
                                                    )
                                                )}
                                            </RadioGroup>
                                        ) : (
                                            <>
                                                <div className="mb-2 flex items-center">
                                                    <Checkbox
                                                        checked={
                                                            existingLevelsForSession.length > 0 &&
                                                            selectedExistingLevelBatchIds.length ===
                                                                existingLevelsForSession.length
                                                        }
                                                        onCheckedChange={() => {
                                                            if (
                                                                selectedExistingLevelBatchIds.length ===
                                                                existingLevelsForSession.length
                                                            ) {
                                                                setSelectedExistingLevelBatchIds(
                                                                    []
                                                                );
                                                            } else {
                                                                setSelectedExistingLevelBatchIds(
                                                                    existingLevelsForSession.map(
                                                                        (batch: ExistingBatch) =>
                                                                            batch.id
                                                                    )
                                                                );
                                                            }
                                                        }}
                                                        className="mr-2 size-4"
                                                    />
                                                    <span className="text-sm font-medium text-gray-700">
                                                        Select All
                                                    </span>
                                                </div>
                                                <div className="max-h-48 space-y-1 overflow-y-auto">
                                                    {existingLevelsForSession.map(
                                                        (batch: ExistingBatch) => (
                                                            <div
                                                                key={batch.id}
                                                                className="flex items-center gap-2 rounded border border-gray-100 bg-gray-50 px-2 py-1"
                                                            >
                                                                <Checkbox
                                                                    checked={selectedExistingLevelBatchIds.includes(
                                                                        batch.id
                                                                    )}
                                                                    onCheckedChange={() => {
                                                                        if (
                                                                            selectedExistingLevelBatchIds.includes(
                                                                                batch.id
                                                                            )
                                                                        ) {
                                                                            setSelectedExistingLevelBatchIds(
                                                                                selectedExistingLevelBatchIds.filter(
                                                                                    (id) =>
                                                                                        id !==
                                                                                        batch.id
                                                                                )
                                                                            );
                                                                        } else {
                                                                            setSelectedExistingLevelBatchIds(
                                                                                [
                                                                                    ...selectedExistingLevelBatchIds,
                                                                                    batch.id,
                                                                                ]
                                                                            );
                                                                        }
                                                                    }}
                                                                    className="size-4"
                                                                />
                                                                <span className="text-sm text-gray-700">
                                                                    {batch.level.level_name}
                                                                </span>
                                                            </div>
                                                        )
                                                    )}
                                                </div>
                                            </>
                                        )}
                                    </div>
                                )}

                                <div className="mt-3 flex gap-2">
                                    {addLevelMode === 'new' && (
                                        <MyButton
                                            type="button"
                                            buttonType="primary"
                                            scale="medium"
                                            layoutVariant="default"
                                            onClick={handleAddLevel}
                                            disable={!newLevelName.trim() || !canAddMoreLevels}
                                        >
                                            Add Level
                                        </MyButton>
                                    )}
                                    {addLevelMode === 'existing' && (
                                        <MyButton
                                            type="button"
                                            buttonType="primary"
                                            scale="medium"
                                            layoutVariant="default"
                                            onClick={() => {
                                                if (!canAddMoreLevels) {
                                                    return;
                                                }
                                                // Add selected existing levels to this session
                                                const selectedBatches =
                                                    existingLevelsForSession.filter(
                                                        (batch: ExistingBatch) =>
                                                            selectedExistingLevelBatchIds.includes(
                                                                batch.id
                                                            )
                                                    );

                                                selectedBatches.forEach((batch: ExistingBatch) => {
                                                    // Check if this level already exists in the session
                                                    const levelExists = session.levels.some(
                                                        (level) => level.id === batch.level.id
                                                    );

                                                    if (!levelExists) {
                                                        onAddLevel(
                                                            session.id,
                                                            batch.level.level_name,
                                                            batch.level.id
                                                        );
                                                    }
                                                });

                                                // Mark selected batches as used
                                                if (onMarkBatchesAsUsed) {
                                                    onMarkBatchesAsUsed(
                                                        selectedBatches.map((batch) => batch.id)
                                                    );
                                                }

                                                setShowAddLevel(false);
                                                setSelectedExistingLevelBatchIds([]);
                                                setAddLevelMode('new');
                                            }}
                                            disable={
                                                selectedExistingLevelBatchIds.length === 0 ||
                                                !canAddMoreLevels
                                            }
                                        >
                                            Add Selected
                                        </MyButton>
                                    )}
                                    <MyButton
                                        type="button"
                                        buttonType="secondary"
                                        scale="medium"
                                        layoutVariant="default"
                                        onClick={() => {
                                            setShowAddLevel(false);
                                            setNewLevelName('');
                                            setAddLevelMode('new');
                                            setSelectedExistingLevelBatchIds([]);
                                        }}
                                    >
                                        Cancel
                                    </MyButton>
                                </div>
                            </div>
                        )}

                        {session.levels.length > 0 && (
                            <div className="space-y-3">
                                {session.levels.map((level) => {
                                    const levelSubgroups = (level as Level).subgroups ?? [];
                                    return (
                                        <div
                                            key={level.batchId}
                                            className="space-y-2 rounded-lg border border-gray-200 bg-gray-50 p-2"
                                        >
                                            <div className="flex items-center justify-between">
                                                <InlineNameEditor
                                                    value={level.name}
                                                    onSave={(name) =>
                                                        onRenameLevel(
                                                            sessionKeyOf(session),
                                                            level.batchId,
                                                            name
                                                        )
                                                    }
                                                    validate={(name) =>
                                                        onValidateLevelName(
                                                            sessionKeyOf(session),
                                                            level.batchId,
                                                            name
                                                        )
                                                    }
                                                    warning={onGetRenameShareWarning(
                                                        'level',
                                                        level.id
                                                    )}
                                                    editLabel={`Rename ${getTerminology(
                                                        ContentTerms.Level,
                                                        SystemTerms.Level
                                                    )}`}
                                                    textClassName="text-sm font-medium text-gray-900"
                                                />
                                                <MyButton
                                                    type="button"
                                                    buttonType="text"
                                                    scale="medium"
                                                    layoutVariant="icon"
                                                    onClick={() =>
                                                        onRemoveLevel(session.id, level.batchId)
                                                    }
                                                    className="text-red-600 hover:text-red-700"
                                                >
                                                    <Trash2 className="size-3" />
                                                </MyButton>
                                            </div>

                                            {/* Per-level subgroups UI (new nested model).
                                             * Only shown when global "Contains subgroup?"
                                             * is enabled and subgroup controls are allowed
                                             * by course settings.
                                             */}
                                            {hasSessionsFlag &&
                                                hasLevels &&
                                                enableSubgroupControlsFlag &&
                                                containsSubgroupFlag && (
                                                    <div className="mt-1 space-y-2 rounded-md border border-dashed border-gray-200 bg-white p-2">
                                                        <div className="flex items-center justify-between gap-2">
                                                            <div>
                                                                <Label className="text-xs font-medium text-gray-800">
                                                                    Subgroups
                                                                </Label>
                                                                <p className="text-xs text-gray-500">
                                                                    Add subgroup names for this
                                                                    level in this session.
                                                                </p>
                                                            </div>
                                                            <MyButton
                                                                type="button"
                                                                buttonType="secondary"
                                                                scale="small"
                                                                layoutVariant="default"
                                                                onClick={() =>
                                                                    onAddLevelSubgroup(
                                                                        session.id,
                                                                        level.batchId as string
                                                                    )
                                                                }
                                                            >
                                                                <Plus className="mr-1 h-3 w-3" />
                                                                Add subgroup
                                                            </MyButton>
                                                        </div>
                                                        {levelSubgroups.length === 0 && (
                                                            <p className="text-xs text-gray-400">
                                                                No subgroups added yet.
                                                            </p>
                                                        )}
                                                        <div className="space-y-1">
                                                            {levelSubgroups.map((sg, sgIndex) => (
                                                                <div
                                                                    key={sgIndex}
                                                                    className="flex items-center gap-2"
                                                                >
                                                                    <Input
                                                                        placeholder="e.g., Morning Batch A"
                                                                        value={sg.subgroupName}
                                                                        onChange={(e) =>
                                                                            onLevelSubgroupNameChange(
                                                                                session.id,
                                                                                level.batchId as string,
                                                                                sgIndex,
                                                                                e.target.value
                                                                            )
                                                                        }
                                                                        className="h-8 flex-1 border-gray-300 text-xs"
                                                                    />
                                                                    <MyButton
                                                                        type="button"
                                                                        buttonType="text"
                                                                        scale="small"
                                                                        layoutVariant="default"
                                                                        onClick={() =>
                                                                            onRemoveLevelSubgroupRow(
                                                                                session.id,
                                                                                level.batchId as string,
                                                                                sgIndex
                                                                            )
                                                                        }
                                                                        className="px-1 text-red-600 hover:text-red-700"
                                                                    >
                                                                        <Trash2 className="h-3 w-3" />
                                                                    </MyButton>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    </div>
                                                )}
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </>
                )}
            </CardContent>
        </Card>
    );
};

// Utility to ensure all levels in sessions have batchId
function ensureBatchIdInLevels(sessions: Session[]): Session[] {
    return sessions.map((session) => ({
        ...session,
        levels: session.levels.map((level) => ({
            ...level,
            batchId: (level as Level).batchId || level.id,
            containsSubgroup: (level as Level).containsSubgroup ?? false,
            subgroups: (level as Level).subgroups ?? [],
        })),
    }));
}

// Utility to deeply ensure newSession and newLevel are always present and boolean
function ensureNewSessionAndLevelFlags(sessions: Session[]) {
    return sessions.map((session) => ({
        ...session,
        newSession: session.newSession === true,
        levels: session.levels.map((level) => ({
            ...level,
            newLevel: level.newLevel === true,
            containsSubgroup: (level as Level).containsSubgroup ?? false,
            subgroups: (level as Level).subgroups ?? [],
        })),
    }));
}
