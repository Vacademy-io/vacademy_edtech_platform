import { describe, expect, it } from 'vitest';
import type { TFunction } from 'i18next';
import { parseScheduleCsv } from './bulkCsv';

const t = ((key: string) => key) as unknown as TFunction;

const parse = (csv: string) =>
    parseScheduleCsv(
        new File([csv], 'schedule.csv', { type: 'text/csv' }),
        { batches: [], allowedPlatforms: [] },
        t
    );

describe('parseScheduleCsv — teacher column', () => {
    it('reads teacher_emails split by | ; or , and drops repeats', async () => {
        const result = await parse(
            'title,start_date,start_time,platform,teacher_emails\n' +
                'Algebra,2026-10-01,10:00,bbb,"a@school.org, b@school.org|a@school.org;ravik"\n'
        );
        expect(result.errors).toEqual([]);
        expect(result.validRows[0]!.instructorIdentifiers).toEqual([
            'a@school.org',
            'b@school.org',
            'ravik',
        ]);
    });

    it('still reads templates downloaded with the old `instructors` header', async () => {
        const result = await parse(
            'title,start_date,start_time,platform,instructors\n' +
                'Algebra,2026-10-01,10:00,bbb,a@school.org\n'
        );
        expect(result.validRows[0]!.instructorIdentifiers).toEqual(['a@school.org']);
    });

    it('accepts a plain "Teacher" header and an empty cell', async () => {
        const result = await parse(
            'Title,Start Date,Start Time,Platform,Teacher\n' +
                'Algebra,2026-10-01,10:00,bbb,ravi@school.org\n' +
                'Geometry,2026-10-02,10:00,bbb,\n'
        );
        expect(result.validRows.map((r) => r.instructorIdentifiers)).toEqual([
            ['ravi@school.org'],
            [],
        ]);
    });
});
