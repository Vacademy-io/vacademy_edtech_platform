/**
 * Saves a printable report as an A4 PDF: every element marked {@code data-report-page} under
 * {@code root} becomes one page. A page taller than A4 is scaled down to fit rather than cut.
 */
export const exportReportPdf = async (root: HTMLElement, fileName: string) => {
    const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
        import('html2canvas'),
        import('jspdf'),
    ]);
    const pages = Array.from(root.querySelectorAll<HTMLElement>('[data-report-page]'));
    if (pages.length === 0) throw new Error('Nothing to export');

    const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
    const pageW = pdf.internal.pageSize.getWidth();
    const pageH = pdf.internal.pageSize.getHeight();

    for (const [i, page] of pages.entries()) {
        const canvas = await html2canvas(page, {
            scale: 2,
            useCORS: true,
            backgroundColor: '#ffffff',
            logging: false,
        });
        const image = canvas.toDataURL('image/jpeg', 0.92);
        const h = (canvas.height * pageW) / canvas.width;
        if (i > 0) pdf.addPage();
        if (h <= pageH) {
            pdf.addImage(image, 'JPEG', 0, 0, pageW, h);
        } else {
            const w = (canvas.width * pageH) / canvas.height;
            pdf.addImage(image, 'JPEG', (pageW - w) / 2, 0, w, pageH);
        }
    }
    pdf.save(fileName.endsWith('.pdf') ? fileName : `${fileName}.pdf`);
};

export const safeFileName = (s: string) =>
    s
        .replace(/[^a-z0-9\-_ ]/gi, '')
        .trim()
        .replace(/\s+/g, '-')
        .slice(0, 80) || 'report';
