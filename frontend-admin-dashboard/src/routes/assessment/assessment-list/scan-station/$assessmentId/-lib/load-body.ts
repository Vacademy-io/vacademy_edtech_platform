import type {
    ScanClientWarning,
    ScanFileKind,
    ScanIntakeMode,
    ScanLoadBody,
    ScanOrderSource,
} from '../-services/scan-station-services';

/** One pass's files after ordering, upload and the page count. */
export interface UploadedPassFile {
    file: { name: string; lastModified: number };
    fileId: string;
    kind: ScanFileKind;
    pageCount: number;
}

/** The C3 load body, passes numbered 1 and 2 in the clerk's order (pass 1 only for ONE_SIDED). */
export const buildLoadBody = (
    passes: [UploadedPassFile[], UploadedPassFile[]],
    intakeMode: ScanIntakeMode,
    orderSource: ScanOrderSource,
    clientWarnings: ScanClientWarning[]
): ScanLoadBody => ({
    // One-sided copies are a single pass: the empty second pass is not sent.
    passes: (intakeMode === 'ONE_SIDED' ? passes.slice(0, 1) : passes).map((files, p) => ({
        pass_no: p + 1,
        files: files.map((f, i) => ({
            file_id: f.fileId,
            file_name: f.file.name,
            kind: f.kind,
            order_index: i,
            last_modified: f.file.lastModified,
            page_count: f.pageCount,
        })),
    })),
    intake_mode: intakeMode,
    order_source: orderSource,
    client_warnings: [...new Set(clientWarnings)],
});
