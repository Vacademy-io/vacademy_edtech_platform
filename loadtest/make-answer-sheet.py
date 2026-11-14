#!/usr/bin/env python3
"""Generates answer-sheet.pdf — a valid multi-page PDF sized like a scanned
answer sheet, for the PDF-upload load test. Kept as a generator rather than a
committed binary. Size only affects the S3 leg (bytes go direct to S3), so a
smaller file is fine when the test machine's uplink is the constraint.

  python3 make-answer-sheet.py [pages] [pad_kb_per_page]
"""
import sys, zlib, random

pages = int(sys.argv[1]) if len(sys.argv) > 1 else 6
pad_kb = int(sys.argv[2]) if len(sys.argv) > 2 else 156
random.seed(7)
objs = []
kids = " ".join(f"{4 + 2 * i} 0 R" for i in range(pages))
objs.append(b"<< /Type /Catalog /Pages 2 0 R >>")
objs.append(f"<< /Type /Pages /Kids [{kids}] /Count {pages} >>".encode())
objs.append(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
for i in range(pages):
    objs.append((f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources "
                 f"<< /Font << /F1 3 0 R >> >> /Contents {5 + 2 * i} 0 R >>").encode())
    txt = f"BT /F1 14 Tf 60 760 Td (Answer Sheet - Page {i + 1}) Tj ET\n"
    for line in range(28):
        txt += f"BT /F1 11 Tf 60 {730 - 22 * line} Td (Q{i + 1}.{line + 1}  {'x' * random.randint(40, 72)}) Tj ET\n"
    comp = zlib.compress(txt.encode())
    pad = bytes(random.getrandbits(8) for _ in range(pad_kb * 1024))
    objs.append(b"<< /Length " + str(len(comp)).encode() + b" /Filter /FlateDecode >>\nstream\n"
                + comp + b"\nendstream\n% padding " + pad)

out = bytearray(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
offsets = []
for n, body in enumerate(objs, start=1):
    offsets.append(len(out))
    out += f"{n} 0 obj\n".encode() + body + b"\nendobj\n"
xref = len(out)
out += f"xref\n0 {len(objs) + 1}\n".encode() + b"0000000000 65535 f \n"
for off in offsets:
    out += f"{off:010d} 00000 n \n".encode()
out += f"trailer\n<< /Size {len(objs) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode()
open("answer-sheet.pdf", "wb").write(out)
print(f"answer-sheet.pdf: {len(out)} bytes ({len(out)/1024/1024:.2f} MB), {pages} pages")
