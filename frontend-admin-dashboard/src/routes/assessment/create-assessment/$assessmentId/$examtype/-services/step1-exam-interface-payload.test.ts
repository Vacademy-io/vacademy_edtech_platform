import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BasicInfoFormSchema } from '../-utils/basic-info-form-schema';
import type { ExamInterfaceForm } from '@/types/assessments/exam-interface';

const axios = vi.hoisted(() => vi.fn());
vi.mock('@/lib/auth/axiosInstance', () => ({ default: axios }));

import { handlePostStep1Data } from './assessment-services';

/**
 * The Step 1 save must always carry `exam_interface`: the backend keeps the
 * stored value when the key is absent, so null is the only way back to the
 * standard screen.
 */
const formData = (examInterface?: ExamInterfaceForm, omrMode = false, resultType = 'AUTO') =>
    BasicInfoFormSchema.parse({
        status: 'INCOMPLETE',
        testCreation: {
            assessmentName: 'Mock 1',
            subject: '',
            assessmentInstructions: '',
            liveDateRange: { startDate: '', endDate: '' },
        },
        assessmentPreview: { checked: false, previewTimeLimit: '1 min' },
        reattemptCount: '1',
        submissionType: '',
        durationDistribution: '',
        evaluationType: '',
        resultType,
        omrMode,
        ...(examInterface ? { examInterface } : {}),
        switchSections: true,
        raiseReattemptRequest: true,
        raiseTimeIncreaseRequest: true,
    });

const sentBody = () => axios.mock.calls[0]?.[0]?.data as Record<string, unknown>;

describe('handlePostStep1Data exam_interface', () => {
    beforeEach(() => {
        axios.mockReset();
        axios.mockResolvedValue({ data: { assessment_id: 'a1' } });
    });

    it('sends null when the form has no exam interface (schema default)', async () => {
        await handlePostStep1Data(formData(), 'a1', 'i1', 'MOCK');
        expect(sentBody()).toHaveProperty('exam_interface', null);
    });

    it('sends the contract object for a chosen preset', async () => {
        await handlePostStep1Data(
            formData({ choice: 'jee-main-nta', strict: true, stored: null }),
            'a1',
            'i1',
            'MOCK'
        );
        expect(sentBody().exam_interface).toEqual({
            v: 1,
            preset: 'jee-main',
            layout: 'nta-mock',
            strict: true,
        });
    });

    it('sends null for a survey and for an OMR sheet exam', async () => {
        await handlePostStep1Data(
            formData({ choice: 'gate', strict: true, stored: null }),
            'a1',
            'i1',
            'SURVEY'
        );
        expect(sentBody()).toHaveProperty('exam_interface', null);

        axios.mockClear();
        await handlePostStep1Data(
            formData({ choice: 'gate', strict: true, stored: null }, true),
            'a1',
            'i1',
            'EXAM'
        );
        expect(sentBody()).toHaveProperty('exam_interface', null);
    });

    it('sends null for a teacher-checked (MANUAL) paper', async () => {
        await handlePostStep1Data(
            formData({ choice: 'jee-advanced', strict: true, stored: null }, false, 'MANUAL'),
            'a1',
            'i1',
            'EXAM'
        );
        expect(sentBody()).toHaveProperty('exam_interface', null);
        expect(sentBody()).toHaveProperty('evaluation_type', 'MANUAL');
    });

    it('sends null for homework', async () => {
        await handlePostStep1Data(
            formData({ choice: 'gate', strict: true, stored: null }),
            'a1',
            'i1',
            'HOMEWORK'
        );
        expect(sentBody()).toHaveProperty('exam_interface', null);
    });

    it('sends strict false for a practice-friendly preset', async () => {
        await handlePostStep1Data(
            formData({ choice: 'jee-advanced', strict: false, stored: null }),
            'a1',
            'i1',
            'PRACTICE'
        );
        expect(sentBody().exam_interface).toEqual({
            v: 1,
            preset: 'jee-advanced',
            strict: false,
        });
    });
});
