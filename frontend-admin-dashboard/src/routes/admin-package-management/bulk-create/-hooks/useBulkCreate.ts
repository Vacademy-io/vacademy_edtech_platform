import { useState, useCallback, useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { v4 as uuidv4 } from 'uuid';
import { toast } from 'sonner';
import {
    BulkCourseItem,
    GlobalDefaults,
    BulkCreateRequest,
    ValidationError,
    PaymentOptionItem,
    BatchConfig,
    PaymentConfig,
} from '../-types/bulk-create-types';
import { bulkCreateCourses, fetchPaymentOptions } from '../-services/bulk-create-service';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import {
    getTerminology,
    getTerminologyPlural,
} from '@/components/common/layout-container/sidebar/utils';
import { ContentTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';

const DEFAULT_COURSE_ITEM: Omit<BulkCourseItem, 'id'> = {
    course_name: '',
    course_type: 'COURSE',
    tags: [],
    publish_to_catalogue: true,
    batches: [],
    payment_config: {
        payment_type: 'FREE',
    },
    course_depth: 5,
};

const DEFAULT_GLOBAL_DEFAULTS: GlobalDefaults = {
    enabled: true,
    batches: [],
    payment_config: {
        payment_type: 'FREE',
    },
    inventory_config: {
        max_slots: null,
        available_slots: null,
    },
    course_type: 'COURSE',
    course_depth: 5,
    tags: [],
    publish_to_catalogue: true,
};

export const useBulkCreate = () => {
    const queryClient = useQueryClient();
    const { getAllLevels, getAllSessions } = useInstituteDetailsStore();

    const [courses, setCourses] = useState<BulkCourseItem[]>([
        { id: uuidv4(), ...DEFAULT_COURSE_ITEM },
    ]);
    const [globalDefaults, setGlobalDefaults] = useState<GlobalDefaults>(DEFAULT_GLOBAL_DEFAULTS);
    const [showPreview, setShowPreview] = useState(false);
    const [validationErrors, setValidationErrors] = useState<ValidationError[]>([]);

    const levels = useMemo(() => {
        return getAllLevels().map((level) => ({
            id: level.id,
            name: level.level_name,
        }));
    }, [getAllLevels]);

    const sessions = useMemo(() => {
        return getAllSessions().map((session) => ({
            id: session.id,
            name: session.session_name,
        }));
    }, [getAllSessions]);

    const { data: paymentOptions = [], isLoading: isLoadingPaymentOptions } = useQuery({
        queryKey: ['payment-options-bulk'],
        queryFn: fetchPaymentOptions,
        staleTime: 5 * 60 * 1000,
    });

    const addCourse = useCallback(() => {
        setCourses((prev) => [...prev, { id: uuidv4(), ...DEFAULT_COURSE_ITEM }]);
    }, []);

    const importCourses = useCallback((newCourses: BulkCourseItem[]) => {
        setCourses((prev) => [...prev, ...newCourses]);
    }, []);

    const removeCourse = useCallback((id: string) => {
        setCourses((prev) => {
            if (prev.length <= 1) {
                toast.error(
                    `At least one ${getTerminology(ContentTerms.Course, SystemTerms.Course).toLocaleLowerCase()} is required`
                );
                return prev;
            }
            return prev.filter((course) => course.id !== id);
        });
    }, []);

    const duplicateCourse = useCallback((id: string) => {
        setCourses((prev) => {
            const courseIndex = prev.findIndex((c) => c.id === id);
            if (courseIndex === -1) return prev;

            const courseToDuplicate = prev[courseIndex];
            if (!courseToDuplicate) return prev;

            const newCourse: BulkCourseItem = {
                id: uuidv4(),
                course_name: `${courseToDuplicate.course_name} (Copy)`,
                course_type: courseToDuplicate.course_type,
                tags: [...courseToDuplicate.tags],
                publish_to_catalogue: courseToDuplicate.publish_to_catalogue,
                batches: [...courseToDuplicate.batches],
                payment_config: { ...courseToDuplicate.payment_config },
                inventory_config: courseToDuplicate.inventory_config
                    ? { ...courseToDuplicate.inventory_config }
                    : undefined,
                course_depth: courseToDuplicate.course_depth,
            };

            const newCourses = [...prev];
            newCourses.splice(courseIndex + 1, 0, newCourse);
            return newCourses;
        });
    }, []);

    const updateCourse = useCallback((id: string, updates: Partial<BulkCourseItem>) => {
        setCourses((prev) =>
            prev.map((course) => (course.id === id ? { ...course, ...updates } : course))
        );
        setValidationErrors((prev) => prev.filter((e) => e.courseId !== id));
    }, []);

    const updateGlobalDefaults = useCallback((updates: Partial<GlobalDefaults>) => {
        setGlobalDefaults((prev) => ({ ...prev, ...updates }));
    }, []);

    const validateCourses = useCallback((): boolean => {
        const errors: ValidationError[] = [];

        courses.forEach((course, index) => {
            if (!course.course_name.trim()) {
                errors.push({
                    courseId: course.id,
                    rowIndex: index,
                    field: 'course_name',
                    message: `${getTerminology(ContentTerms.Course, SystemTerms.Course)} name is required`,
                });
            }

            const effectivePayment = course.payment_config.payment_type
                ? course.payment_config
                : globalDefaults.enabled
                  ? globalDefaults.payment_config
                  : course.payment_config;

            if (
                effectivePayment.payment_type === 'ONE_TIME' ||
                effectivePayment.payment_type === 'SUBSCRIPTION'
            ) {
                if (!effectivePayment.price && effectivePayment.price !== 0) {
                    errors.push({
                        courseId: course.id,
                        rowIndex: index,
                        field: 'payment_config.price',
                        message: `Price is required for paid ${getTerminologyPlural(ContentTerms.Course, SystemTerms.Course).toLocaleLowerCase()}`,
                    });
                }
            }
        });

        setValidationErrors(errors);
        return errors.length === 0;
    }, [courses, globalDefaults]);

    const buildRequest = useCallback(
        (dryRun: boolean): BulkCreateRequest => {
            const mapPaymentToApi = (config: PaymentConfig): PaymentConfig => {
                if (config.payment_option_id) {
                    return {
                        payment_option_id: config.payment_option_id,
                        payment_type: config.payment_type,
                    };
                }
                return {
                    payment_type: config.payment_type,
                    price: config.price,
                    elevated_price: config.elevated_price,
                    currency: config.currency || 'INR',
                    validity_in_days: config.validity_in_days,
                    require_approval: config.require_approval,
                };
            };

            const mapBatchToApi = (batch: BatchConfig) => ({
                level_id: batch.level_id,
                session_id: batch.session_id,
                inventory_config: batch.inventory_config,
                payment_config: batch.payment_config
                    ? mapPaymentToApi(batch.payment_config)
                    : undefined,
            });

            return {
                apply_to_all: {
                    enabled: globalDefaults.enabled,
                    batches: globalDefaults.batches.map(mapBatchToApi),
                    payment_config: mapPaymentToApi(globalDefaults.payment_config),
                    inventory_config: globalDefaults.inventory_config,
                    course_type: globalDefaults.course_type,
                    course_depth: globalDefaults.course_depth,
                    tags: globalDefaults.tags,
                    publish_to_catalogue: globalDefaults.publish_to_catalogue,
                },
                courses: courses.map((course) => {
                    const mappedBatches = course.batches.map(mapBatchToApi);

                    // Check if batches have their own configs - if so, don't override with course-level
                    const hasBatchLevelPayment = mappedBatches.some(
                        (b) => b.payment_config !== undefined
                    );
                    const hasBatchLevelInventory = mappedBatches.some(
                        (b) => b.inventory_config !== undefined
                    );

                    return {
                        course_name: course.course_name,
                        course_type: course.course_type,
                        tags: course.tags,
                        publish_to_catalogue: course.publish_to_catalogue,
                        batches: mappedBatches,
                        // Only send course-level configs if batches don't have their own
                        payment_config: hasBatchLevelPayment
                            ? undefined
                            : mapPaymentToApi(course.payment_config),
                        inventory_config: hasBatchLevelInventory
                            ? undefined
                            : course.inventory_config,
                        thumbnail_file_id: course.thumbnail_file_id,
                        course_preview_image_media_id: course.course_preview_image_media_id,
                        course_banner_media_id: course.course_banner_media_id,
                        course_media_id: course.course_media_id,
                        why_learn_html: course.why_learn_html,
                        who_should_learn_html: course.who_should_learn_html,
                        about_the_course_html: course.about_the_course_html,
                        course_html_description: course.course_html_description,
                        faculty_user_ids: course.faculty_user_ids,
                        course_depth: course.course_depth,
                    };
                }),
                dry_run: dryRun,
            };
        },
        [courses, globalDefaults]
    );

    const getErrorMessage = (error: unknown): string => {
        if (error && typeof error === 'object') {
            const axiosError = error as {
                response?: { data?: { message?: string } };
                message?: string;
            };
            return axiosError.response?.data?.message || axiosError.message || 'An error occurred';
        }
        return 'An error occurred';
    };

    const dryRunMutation = useMutation({
        mutationFn: () => bulkCreateCourses(buildRequest(true)),
        onSuccess: (response) => {
            if (response.failure_count > 0) {
                const errors: ValidationError[] = response.results
                    .filter((r) => r.status === 'FAILED')
                    .map((r) => ({
                        courseId: courses[r.index]?.id || '',
                        rowIndex: r.index,
                        field: 'general',
                        message: r.error_message || 'Unknown error',
                    }));
                setValidationErrors(errors);
                toast.error(
                    `Validation failed for ${response.failure_count} ${getTerminology(ContentTerms.Course, SystemTerms.Course).toLocaleLowerCase()}(s)`
                );
            } else {
                setValidationErrors([]);
                setShowPreview(true);
                toast.success('Validation passed! Review and submit.');
            }
        },
        onError: (error: unknown) => {
            toast.error(`Validation failed: ${getErrorMessage(error)}`);
        },
    });

    const submitMutation = useMutation({
        mutationFn: () => bulkCreateCourses(buildRequest(false)),
        onSuccess: (response) => {
            if (response.success_count > 0) {
                toast.success(
                    `Successfully created ${response.success_count} ${getTerminology(ContentTerms.Course, SystemTerms.Course).toLocaleLowerCase()}(s)`
                );
                queryClient.invalidateQueries({ queryKey: ['package-sessions'] });
                queryClient.invalidateQueries({ queryKey: ['batches-summary'] });
            }
            if (response.failure_count > 0) {
                toast.error(
                    `Failed to create ${response.failure_count} ${getTerminology(ContentTerms.Course, SystemTerms.Course).toLocaleLowerCase()}(s)`
                );
            }
            setShowPreview(false);
        },
        onError: (error: unknown) => {
            toast.error(`Submission failed: ${getErrorMessage(error)}`);
        },
    });

    const handleValidate = useCallback(() => {
        if (!validateCourses()) {
            toast.error('Please fix validation errors before proceeding');
            return;
        }
        dryRunMutation.mutate();
    }, [validateCourses, dryRunMutation]);

    const handleSubmit = useCallback(() => {
        submitMutation.mutate();
    }, [submitMutation]);

    const resetForm = useCallback(() => {
        setCourses([{ id: uuidv4(), ...DEFAULT_COURSE_ITEM }]);
        setGlobalDefaults(DEFAULT_GLOBAL_DEFAULTS);
        setValidationErrors([]);
        setShowPreview(false);
    }, []);

    const getErrorsForCourse = useCallback(
        (courseId: string) => {
            return validationErrors.filter((e) => e.courseId === courseId);
        },
        [validationErrors]
    );

    return {
        courses,
        globalDefaults,
        levels,
        sessions,
        paymentOptions,
        isLoadingPaymentOptions,
        validationErrors,
        showPreview,
        isValidating: dryRunMutation.isPending,
        isSubmitting: submitMutation.isPending,
        dryRunResult: dryRunMutation.data,
        submitResult: submitMutation.data,
        addCourse,
        importCourses,
        removeCourse,

        duplicateCourse,
        updateCourse,
        updateGlobalDefaults,
        handleValidate,
        handleSubmit,
        resetForm,
        setShowPreview,
        getErrorsForCourse,
    };
};
