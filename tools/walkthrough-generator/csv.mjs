// Minimal, dependency-free CSV parser.
// Handles quoted fields, escaped quotes (""), and commas/newlines inside quotes.
export function parseCsv(text) {
    const rows = [];
    let row = [];
    let field = '';
    let inQuotes = false;
    const src = text.replace(/\r\n?/g, '\n');

    for (let i = 0; i < src.length; i++) {
        const c = src[i];
        if (inQuotes) {
            if (c === '"') {
                if (src[i + 1] === '"') {
                    field += '"';
                    i++;
                } else {
                    inQuotes = false;
                }
            } else {
                field += c;
            }
            continue;
        }
        if (c === '"') {
            inQuotes = true;
        } else if (c === ',') {
            row.push(field);
            field = '';
        } else if (c === '\n') {
            row.push(field);
            rows.push(row);
            row = [];
            field = '';
        } else {
            field += c;
        }
    }
    // Trailing field / row (file may not end in a newline).
    if (field.length > 0 || row.length > 0) {
        row.push(field);
        rows.push(row);
    }
    // Drop fully-empty rows.
    return rows.filter((r) => r.some((cell) => cell.trim().length > 0));
}
