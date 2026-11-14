import { useCallback } from 'react';
import { z } from 'zod';
import i18n from '@/i18n';

// Validation schemas
export const emailSchema = z.string().email(i18n.t("authExtraB:common.emailInvalid"));
export const usernameSchema = z.string().min(3, i18n.t("authExtraB:common.usernameMinLength")).max(30, i18n.t("authExtraB:validation.usernameMaxLength"));
export const fullNameSchema = z.string().min(2, i18n.t("authExtraB:common.fullNameMinLength")).max(100, i18n.t("authExtraB:validation.fullNameMaxLength"));
export const passwordSchema = z.string().min(8, i18n.t("authExtraB:common.passwordMinLength")).regex(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/, i18n.t("authExtraB:validation.passwordComplexity"));

// Complete registration validation schema
export const registrationSchema = z.object({
  email: emailSchema,
  full_name: fullNameSchema,
  username: usernameSchema.optional(),
  password: passwordSchema.optional(),
  instituteId: z.string().uuid(i18n.t("authExtraB:validation.instituteIdInvalid")),
});

export type RegistrationValidationData = z.infer<typeof registrationSchema>;

export interface ValidationResult {
  isValid: boolean;
  errors: Record<string, string>;
  data?: RegistrationValidationData;
}

export function useRegistrationValidation() {
  const validateEmail = useCallback((email: string): { isValid: boolean; error?: string } => {
    try {
      emailSchema.parse(email);
      return { isValid: true };
    } catch (error) {
      if (error instanceof z.ZodError) {
        return { isValid: false, error: error.errors[0].message };
      }
      return { isValid: false, error: i18n.t("authExtraB:validation.emailFormatError") };
    }
  }, []);

  const validateUsername = useCallback((username: string): { isValid: boolean; error?: string } => {
    try {
      usernameSchema.parse(username);
      return { isValid: true };
    } catch (error) {
      if (error instanceof z.ZodError) {
        return { isValid: false, error: error.errors[0].message };
      }
      return { isValid: false, error: i18n.t("authExtraB:validation.usernameFormatError") };
    }
  }, []);

  const validateFullName = useCallback((fullName: string): { isValid: boolean; error?: string } => {
    try {
      fullNameSchema.parse(fullName);
      return { isValid: true };
    } catch (error) {
      if (error instanceof z.ZodError) {
        return { isValid: false, error: error.errors[0].message };
      }
      return { isValid: false, error: i18n.t("authExtraB:validation.fullNameFormatError") };
    }
  }, []);

  const validatePassword = useCallback((password: string): { isValid: boolean; error?: string } => {
    try {
      passwordSchema.parse(password);
      return { isValid: true };
    } catch (error) {
      if (error instanceof z.ZodError) {
        return { isValid: false, error: error.errors[0].message };
      }
      return { isValid: false, error: i18n.t("authExtraB:validation.passwordFormatError") };
    }
  }, []);

  const validateInstituteId = useCallback((instituteId: string): { isValid: boolean; error?: string } => {
    try {
      z.string().uuid().parse(instituteId);
      return { isValid: true };
    } catch (error) {
      return { isValid: false, error: i18n.t("authExtraB:validation.instituteIdFormatError") };
    }
  }, []);

  const validateRegistrationData = useCallback((data: Partial<RegistrationValidationData>): ValidationResult => {
    try {
      const validatedData = registrationSchema.parse(data);
      return {
        isValid: true,
        errors: {},
        data: validatedData,
      };
    } catch (error) {
      if (error instanceof z.ZodError) {
        const errors: Record<string, string> = {};
        error.errors.forEach((err) => {
          if (err.path[0]) {
            errors[err.path[0] as string] = err.message;
          }
        });
        return {
          isValid: false,
          errors,
        };
      }
      return {
        isValid: false,
        errors: { general: i18n.t("authExtraB:validation.generalFailed") },
      };
    }
  }, []);

  const validatePartialData = useCallback((data: Partial<RegistrationValidationData>): ValidationResult => {
    const errors: Record<string, string> = {};
    let hasErrors = false;

    // Validate only provided fields
    if (data.email !== undefined) {
      const emailValidation = validateEmail(data.email);
      if (!emailValidation.isValid) {
        errors.email = emailValidation.error!;
        hasErrors = true;
      }
    }

    if (data.full_name !== undefined) {
      const fullNameValidation = validateFullName(data.full_name);
      if (!fullNameValidation.isValid) {
        errors.full_name = fullNameValidation.error!;
        hasErrors = true;
      }
    }

    if (data.username !== undefined) {
      const usernameValidation = validateUsername(data.username);
      if (!usernameValidation.isValid) {
        errors.username = usernameValidation.error!;
        hasErrors = true;
      }
    }

    if (data.password !== undefined) {
      const passwordValidation = validatePassword(data.password);
      if (!passwordValidation.isValid) {
        errors.password = passwordValidation.error!;
        hasErrors = true;
      }
    }

    if (data.instituteId !== undefined) {
      const instituteIdValidation = validateInstituteId(data.instituteId);
      if (!instituteIdValidation.isValid) {
        errors.instituteId = instituteIdValidation.error!;
        hasErrors = true;
      }
    }

    return {
      isValid: !hasErrors,
      errors,
      data: hasErrors ? undefined : data as RegistrationValidationData,
    };
  }, [validateEmail, validateUsername, validateFullName, validatePassword, validateInstituteId]);

  return {
    validateEmail,
    validateUsername,
    validateFullName,
    validatePassword,
    validateInstituteId,
    validateRegistrationData,
    validatePartialData,
    schemas: {
      email: emailSchema,
      username: usernameSchema,
      fullName: fullNameSchema,
      password: passwordSchema,
      registration: registrationSchema,
    },
  };
}
