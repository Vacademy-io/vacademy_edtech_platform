import {
    DripAnchor,
    DripCondition,
    DripConditionBehavior,
    DripConditionContentLevel,
    DripConditionLevel,
    DripConditionRule,
    DripConditionRuleType,
    DripScheduleDefaults,
    RelativeDateParams,
} from '@/types/course-settings';
import {
    getTerminology,
    getTerminologyPlural,
} from '@/components/common/layout-container/sidebar/utils';
import { ContentTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';

/**
 * Rules that wait on the learner doing something, as opposed to the clock.
 *
 * Only these sit behind the institute's "apply progress rules" opt-in on the
 * learner side; date and day-wise rules are enforced as soon as they are saved.
 */
export const isProgressRule = (rule: DripConditionRule): boolean =>
    rule.type !== 'date_based' && rule.type !== 'relative_date';

/**
 * Generate a unique ID for drip conditions
 */
export const generateDripConditionId = (): string => {
    return `drip-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
};

/**
 * Format drip condition rule for display
 */
export const formatDripRule = (rule: DripConditionRule): string => {
    switch (rule.type) {
        case 'date_based': {
            const params = rule.params as { unlock_date: string };
            const date = new Date(params.unlock_date);
            return `Unlocks on ${date.toLocaleDateString()} at ${date.toLocaleTimeString()}`;
        }
        case 'relative_date': {
            const params = rule.params as RelativeDateParams;
            const day = params.unlock_on_day ?? 1;
            const anchor =
                params.anchor === 'session_start' ? 'batch start' : 'enrollment';
            const time = params.unlock_time && params.unlock_time !== '00:00'
                ? ` at ${params.unlock_time}`
                : '';
            return day <= 1
                ? `Available from day 1 (${anchor})`
                : `Unlocks on day ${day} after ${anchor}${time}`;
        }
        case 'completion_based': {
            const compParams = rule.params as {
                metric: string;
                count?: number;
                threshold: number;
            };
            if (compParams.metric === 'average_of_last_n') {
                return `Average of last ${compParams.count} items ≥ ${compParams.threshold}%`;
            }
            return `Average of all items ≥ ${compParams.threshold}%`;
        }
        case 'prerequisite': {
            const preqParams = rule.params as {
                required_chapters?: string[];
                required_slides?: string[];
                threshold: number;
            };
            const items = preqParams.required_chapters || preqParams.required_slides || [];
            const type = preqParams.required_chapters ? 'chapters' : 'slides';
            return `${items.length} ${type} completed ≥ ${preqParams.threshold}%`;
        }
        case 'sequential': {
            const seqParams = rule.params as { threshold: number };
            return `Previous item completed ≥ ${seqParams.threshold}%`;
        }
        default:
            return 'Custom rule';
    }
};

/**
 * Format behavior for display
 */
export const formatBehavior = (behavior: DripConditionBehavior): string => {
    switch (behavior) {
        case 'lock':
            return 'Visible but Locked';
        case 'hide':
            return 'Hidden';
        case 'both':
            return 'Progressive Unlock';
        default:
            return behavior;
    }
};

/**
 * Get behavior icon
 */
export const getBehaviorIcon = (behavior: DripConditionBehavior): string => {
    switch (behavior) {
        case 'lock':
            return '🔒';
        case 'hide':
            return '👁️';
        case 'both':
            return '🔓';
        default:
            return '⚙️';
    }
};

/**
 * Get level display name
 */
export const getLevelDisplayName = (level: DripConditionLevel): string => {
    switch (level) {
        case 'package':
            return getTerminology(ContentTerms.Course, SystemTerms.Course);
        case 'subject':
            return 'Subject';
        case 'module':
            return 'Module';
        case 'chapter':
            return getTerminology(ContentTerms.Chapters, SystemTerms.Chapters);
        case 'slide':
            return 'Slide';
        default:
            return level;
    }
};

/**
 * Get level color for badges
 */
export const getLevelColor = (level: DripConditionLevel): string => {
    switch (level) {
        case 'package':
            return 'bg-purple-100 text-purple-800 border-purple-200';
        case 'subject':
            return 'bg-orange-100 text-orange-800 border-orange-200';
        case 'module':
            return 'bg-teal-100 text-teal-800 border-teal-200';
        case 'chapter':
            return 'bg-blue-100 text-blue-800 border-blue-200';
        case 'slide':
            return 'bg-green-100 text-green-800 border-green-200';
        default:
            return 'bg-gray-100 text-gray-800 border-gray-200';
    }
};

/**
 * Validate drip condition
 */
export const validateDripCondition = (
    condition: Partial<DripCondition>
): { valid: boolean; errors: string[] } => {
    const errors: string[] = [];

    if (!condition.level) {
        errors.push('Level is required');
    }

    if (!condition.level_id || condition.level_id.trim() === '') {
        errors.push('Level ID is required');
    }

    if (!condition.drip_condition || !Array.isArray(condition.drip_condition)) {
        errors.push('Drip condition configuration must be an array');
        return { valid: false, errors };
    }

    if (condition.drip_condition.length === 0) {
        errors.push('At least one drip condition configuration is required');
        return { valid: false, errors };
    }

    // Validate each config in the array
    condition.drip_condition.forEach((config, configIndex) => {
        const prefix = `Config ${configIndex + 1}:`;

        // Validate target is required
        if (!config.target) {
            errors.push(
                `${prefix} Target is required (subject, module, ${getTerminology(ContentTerms.Chapters, SystemTerms.Chapters).toLocaleLowerCase()} or slide)`
            );
        }

        // Validate behavior
        if (!config.behavior || !['lock', 'hide', 'both'].includes(config.behavior)) {
            errors.push(`${prefix} Valid behavior is required (lock, hide, or both)`);
        }

        // Validate rules
        if (!config.rules || config.rules.length === 0) {
            errors.push(`${prefix} At least one rule is required`);
        } else {
            config.rules.forEach((rule, index) => {
                const ruleErrors = validateRule(rule, index);
                errors.push(...ruleErrors.map((err) => `${prefix} ${err}`));
            });
        }
    });

    return { valid: errors.length === 0, errors };
};

/**
 * Validate individual rule
 */
const validateRule = (rule: DripConditionRule, index: number): string[] => {
    const errors: string[] = [];
    const prefix = `Rule ${index + 1}:`;

    if (!rule.type) {
        errors.push(`${prefix} Rule type is required`);
        return errors;
    }

    switch (rule.type) {
        case 'date_based': {
            const dateParams = rule.params as { unlock_date?: string };
            if (!dateParams.unlock_date) {
                errors.push(`${prefix} Unlock date is required`);
            } else {
                const date = new Date(dateParams.unlock_date);
                if (isNaN(date.getTime())) {
                    errors.push(`${prefix} Invalid date format`);
                }
            }
            break;
        }
        case 'relative_date': {
            const relParams = rule.params as Partial<RelativeDateParams>;
            const day = relParams.unlock_on_day;
            if (day === undefined || !Number.isFinite(day) || day < 1) {
                errors.push(`${prefix} Day must be 1 or greater`);
            }
            if (relParams.unlock_time && !/^\d{2}:\d{2}$/.test(relParams.unlock_time)) {
                errors.push(`${prefix} Unlock time must be in HH:mm format`);
            }
            break;
        }
        case 'completion_based': {
            const compParams = rule.params as {
                metric?: string;
                count?: number;
                threshold?: number;
            };
            if (!compParams.metric) {
                errors.push(`${prefix} Metric is required`);
            }
            if (
                compParams.metric === 'average_of_last_n' &&
                (!compParams.count || compParams.count < 1)
            ) {
                errors.push(`${prefix} Count must be greater than 0 for average_of_last_n`);
            }
            if (
                compParams.threshold === undefined ||
                compParams.threshold < 0 ||
                compParams.threshold > 100
            ) {
                errors.push(`${prefix} Threshold must be between 0 and 100`);
            }
            break;
        }
        case 'prerequisite': {
            const preqParams = rule.params as {
                required_chapters?: string[];
                required_slides?: string[];
                threshold?: number;
            };
            if (!preqParams.required_chapters && !preqParams.required_slides) {
                errors.push(
                    `${prefix} Required ${getTerminologyPlural(ContentTerms.Chapters, SystemTerms.Chapters).toLocaleLowerCase()} or slides must be specified`
                );
            }
            if (
                (preqParams.required_chapters && preqParams.required_chapters.length === 0) ||
                (preqParams.required_slides && preqParams.required_slides.length === 0)
            ) {
                errors.push(`${prefix} At least one required item must be specified`);
            }
            if (
                preqParams.threshold === undefined ||
                preqParams.threshold < 0 ||
                preqParams.threshold > 100
            ) {
                errors.push(`${prefix} Threshold must be between 0 and 100`);
            }
            break;
        }
        case 'sequential': {
            const seqParams = rule.params as { threshold?: number };
            if (
                seqParams.threshold === undefined ||
                seqParams.threshold < 0 ||
                seqParams.threshold > 100
            ) {
                errors.push(`${prefix} Threshold must be between 0 and 100`);
            }
            break;
        }
    }

    return errors;
};

/**
 * Get rule type display name
 */
export const getRuleTypeDisplayName = (type: DripConditionRuleType): string => {
    switch (type) {
        case 'date_based':
            return 'Fixed Date';
        case 'relative_date':
            return 'Day-Wise (after enrollment)';
        case 'completion_based':
            return 'Completion-Based';
        case 'prerequisite':
            return 'Prerequisite';
        case 'sequential':
            return 'Sequential';
        default:
            return type;
    }
};

/**
 * Create default rule based on type
 */
export const createDefaultRule = (type: DripConditionRuleType): DripConditionRule => {
    switch (type) {
        case 'date_based':
            return {
                type: 'date_based',
                params: {
                    unlock_date: new Date().toISOString(),
                },
            };
        case 'relative_date':
            return {
                type: 'relative_date',
                params: {
                    unlock_on_day: 1,
                    anchor: 'enrollment',
                    unlock_time: '00:00',
                },
            };
        case 'completion_based':
            return {
                type: 'completion_based',
                params: {
                    metric: 'average_of_all',
                    threshold: 75,
                },
            };
        case 'prerequisite':
            return {
                type: 'prerequisite',
                params: {
                    required_chapters: [],
                    threshold: 100,
                },
            };
        case 'sequential':
            return {
                type: 'sequential',
                params: {
                    requires_previous: true,
                    threshold: 100,
                },
            };
    }
};

/**
 * Create empty drip condition
 */
export const createEmptyDripCondition = (): Partial<DripCondition> => {
    return {
        id: generateDripConditionId(),
        level: 'chapter',
        level_id: '',
        drip_condition: [
            {
                target: 'chapter',
                behavior: 'lock',
                is_enabled: true,
                rules: [],
            },
        ],
        enabled: true,
        created_at: new Date().toISOString(),
    };
};

// ---------------------------------------------------------------------------
// Day-wise schedule generator
// ---------------------------------------------------------------------------

export interface DripScheduleItem {
    id: string;
    name: string;
}

export interface DripScheduleEntry extends DripScheduleItem {
    /** 1-based day of access this item opens on. */
    day: number;
}

/**
 * Which day each item lands on, in content order.
 *
 * Split out from the condition builder so the dialog can show the admin the
 * whole "Day 1 → Introduction, Day 2 → …" table before anything is saved — a
 * 30-item schedule is far too easy to get off by one otherwise.
 */
export const previewDripSchedule = (
    items: DripScheduleItem[],
    options: Pick<DripScheduleDefaults, 'startDay' | 'intervalDays'>
): DripScheduleEntry[] => {
    const startDay = Math.max(1, Math.round(options.startDay || 1));
    const intervalDays = Math.max(1, Math.round(options.intervalDays || 1));
    return items.map((item, index) => ({
        ...item,
        day: startDay + index * intervalDays,
    }));
};

/**
 * Turn an ordered list of content into one day-wise drip condition per item.
 *
 * Every item gets its own condition rather than one condition on the course:
 * a course-level rule can only say "everything at this level unlocks on day N",
 * which is the one thing a staggered schedule must not do.
 */
export const buildDripSchedule = (
    items: DripScheduleItem[],
    level: DripConditionContentLevel,
    options: DripScheduleDefaults
): DripCondition[] => {
    const now = new Date().toISOString();
    const anchor: DripAnchor = options.anchor || 'enrollment';
    const unlockTime = options.unlockTime || '00:00';

    return previewDripSchedule(items, options).map((entry) => ({
        id: generateDripConditionId(),
        level,
        level_id: entry.id,
        enabled: true,
        created_at: now,
        updated_at: now,
        drip_condition: [
            {
                target: level,
                behavior: options.behavior,
                is_enabled: true,
                rules: [
                    {
                        type: 'relative_date',
                        params: {
                            unlock_on_day: entry.day,
                            anchor,
                            unlock_time: unlockTime,
                        } satisfies RelativeDateParams,
                    },
                ],
            },
        ],
    }));
};

/**
 * Drop every existing condition for these items at this level, then add the
 * new ones — so re-running the generator replaces the old schedule instead of
 * stacking a second one on top of it (two conditions on the same chapter both
 * apply, and the learner sees whichever is found first).
 */
export const applyDripSchedule = (
    existing: DripCondition[],
    level: DripConditionContentLevel,
    generated: DripCondition[]
): DripCondition[] => {
    const scheduledIds = new Set(generated.map((condition) => condition.level_id));
    const kept = existing.filter(
        (condition) => !(condition.level === level && scheduledIds.has(condition.level_id))
    );
    return [...kept, ...generated];
};

/**
 * Remove a whole generated schedule again ("Clear schedule").
 */
export const clearDripSchedule = (
    existing: DripCondition[],
    level: DripConditionContentLevel,
    itemIds: string[]
): DripCondition[] => {
    const ids = new Set(itemIds);
    return existing.filter(
        (condition) => !(condition.level === level && ids.has(condition.level_id))
    );
};
