/**
 * Main resolver manager that coordinates all variable resolvers
 * Implements lazy loading - only calls resolvers when variables are used
 */

import {
    VariableResolver,
    ResolvedVariable,
    VariableContext,
    VariableResolutionResult,
} from './types';
import { variableCache } from './cache';
import { ComputedVariableResolver } from './resolvers/computed-resolver';
import { InstituteVariableResolver } from './resolvers/institute-resolver';
import { StudentVariableResolver } from './resolvers/student-resolver';
import { CourseVariableResolver } from './resolvers/course-resolver';
import { BatchVariableResolver } from './resolvers/batch-resolver';
import { AttendanceVariableResolver } from './resolvers/attendance-resolver';
import { isServerResolvedEmailVariable } from '@/lib/email-templates/server-resolved-variables';

export class TemplateVariableResolverManager {
    private resolvers: VariableResolver[] = [];
    private resolverMap = new Map<string, VariableResolver>();
    private initialized = false;

    constructor() {
        this.initializeResolvers();
    }

    private initializeResolvers() {
        if (this.initialized) return;

        // Add resolvers in priority order (highest first)
        this.resolvers = [
            new ComputedVariableResolver(), // Priority 100
            new InstituteVariableResolver(), // Priority 80
            new StudentVariableResolver(), // Priority 70
            new CourseVariableResolver(), // Priority 60
            new BatchVariableResolver(), // Priority 50
            new AttendanceVariableResolver(), // Priority 40
        ];

        // Sort by priority (highest first)
        this.resolvers.sort((a, b) => b.getPriority() - a.getPriority());

        // Build resolver map for quick lookup
        this.resolvers.forEach((resolver) => {
            const supportedVars = resolver.getSupportedVariables();
            supportedVars.forEach((variable) => {
                // Map both with and without brackets for flexibility
                this.resolverMap.set(variable, resolver);
                this.resolverMap.set(`{{${variable}}}`, resolver);
            });
        });

        this.initialized = true;
    }

    /**
     * Extract variables from template content
     */
    extractVariables(templateContent: string): string[] {
        const variables: string[] = [];

        // Extract {{variable}} format
        const doubleBraceRegex = /\{\{([^}]+)\}\}/g;
        let match;
        while ((match = doubleBraceRegex.exec(templateContent)) !== null) {
            const variableName = `{{${match[1]}}}`;
            if (!variables.includes(variableName)) {
                variables.push(variableName);
            }
        }

        // Extract {variable} format
        const singleBraceRegex = /\{([^}]+)\}/g;
        while ((match = singleBraceRegex.exec(templateContent)) !== null) {
            const variableName = `{${match[1]}}`;
            if (!variables.includes(variableName)) {
                variables.push(variableName);
            }
        }

        console.log('🔍 Extracted variables from template:', variables);
        return variables;
    }

    /**
     * Resolve a single variable (lazy loading)
     */
    async resolveVariable(
        variableName: string,
        context?: VariableContext
    ): Promise<ResolvedVariable | null> {
        // Check cache first
        const cacheKey = `${variableName}:${JSON.stringify(context || {})}`;
        const cached = variableCache.get(cacheKey);
        if (cached) {
            return cached.variable;
        }

        // Find the appropriate resolver (try both formats)
        let resolver = this.resolverMap.get(variableName);
        if (!resolver) {
            // Try without brackets
            const cleanName = variableName.replace(/[{}]/g, '');
            resolver = this.resolverMap.get(cleanName);
        }

        if (!resolver) {
            console.warn(`No resolver found for variable: ${variableName}`);
            return null;
        }

        try {
            // Debug context passing
            console.log(`🔍 Resolving ${variableName} with context:`, {
                hasContext: !!context,
                pageContext: context?.pageContext,
                hasStudentData: !!context?.studentData,
                studentId: context?.studentId
            });

            // Resolve the variable
            const resolved = await resolver.resolve(variableName, context);

            if (resolved) {
                // Cache the result
                variableCache.set(cacheKey, resolved);
            }

            return resolved;
        } catch (error) {
            console.warn(`Error resolving variable ${variableName}:`, error);
            return null;
        }
    }

    /**
     * Resolve multiple variables from template content
     */
    async resolveTemplateVariables(
        templateContent: string,
        context?: VariableContext
    ): Promise<VariableResolutionResult> {
        // Membership tags are filled per recipient by the notification service on send, so they
        // are neither resolvable here nor missing.
        const variables = this.extractVariables(templateContent).filter(
            (v) => !isServerResolvedEmailVariable(v)
        );
        const availableVariables: Record<string, string> = {};
        const missingVariables: string[] = [];
        const warnings: string[] = [];
        const cachedVariables: Record<string, ResolvedVariable> = {};

        console.log(`🔍 Resolving ${variables.length} variables from template`);
        console.log(`📄 Page context: ${context?.pageContext || 'not specified'}`);

        // Process variables in parallel for better performance
        const resolutionPromises = variables.map(async (variable) => {
            try {
                const resolved = await this.resolveVariable(variable, context);

                if (resolved) {
                    availableVariables[variable] = resolved.value;
                    cachedVariables[variable] = resolved;
                    console.log(`✅ ${variable}: ${resolved.value} (from ${resolved.source})`);
                } else {
                    missingVariables.push(variable);
                    console.log(`❌ ${variable}: Not available`);
                }
            } catch (error) {
                console.warn(`⚠️ Error resolving variable ${variable}:`, error);
                missingVariables.push(variable);
                warnings.push(
                    `Failed to resolve variable ${variable}: ${error instanceof Error ? error.message : 'Unknown error'}`
                );
            }
        });

        await Promise.all(resolutionPromises);

        const success = missingVariables.length === 0;

        if (!success) {
            console.warn(
                `🚫 Template validation failed: ${missingVariables.length} missing variables`
            );
        } else {
            console.log('✅ All template variables resolved successfully.');
        }

        return {
            success,
            availableVariables,
            missingVariables,
            warnings,
            cachedVariables,
        };
    }

    /**
     * Get all supported variables across all resolvers
     */
    getAllSupportedVariables(): string[] {
        const allVariables = new Set<string>();
        this.resolvers.forEach((resolver) => {
            resolver.getSupportedVariables().forEach((variable) => {
                allVariables.add(variable);
            });
        });
        return Array.from(allVariables);
    }

    /**
     * Get variables by category
     */
    getVariablesByCategory(category: string): string[] {
        const categoryVariables: string[] = [];
        this.resolvers.forEach((resolver) => {
            if (
                (resolver as any).getMetadata &&
                (resolver as any).getMetadata().category === category
            ) {
                categoryVariables.push(...resolver.getSupportedVariables());
            }
        });
        return categoryVariables;
    }

    /**
     * Get resolver metadata
     */
    getResolverMetadata() {
        return this.resolvers.map((resolver) => ({
            name: resolver.constructor.name,
            priority: resolver.getPriority(),
            supportedVariables: resolver.getSupportedVariables(),
            metadata: (resolver as any).getMetadata ? (resolver as any).getMetadata() : null,
        }));
    }

    /**
     * Clear cache
     */
    clearCache(): void {
        variableCache.clear();
    }

    /**
     * Clear expired cache entries
     */
    clearExpiredCache(): void {
        variableCache.clearExpired();
    }

    /**
     * Get cache statistics
     */
    getCacheStats() {
        return variableCache.getStats();
    }

    /**
     * Check if a variable is supported
     */
    isVariableSupported(variableName: string): boolean {
        return this.resolverMap.has(variableName);
    }

    /**
     * Get resolver for a specific variable
     */
    getResolverForVariable(variableName: string): VariableResolver | null {
        return this.resolverMap.get(variableName) || null;
    }
}

// Singleton instance
export const templateVariableResolverManager = new TemplateVariableResolverManager();
