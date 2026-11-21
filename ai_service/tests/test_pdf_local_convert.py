"""Vsmart Extract reads digital PDFs locally (free) and sends only scanned or
mathematical pages to MathPix. These pin the page classifier, the figure
crop (a diagram is kept, page furniture is not) and the vendor tag that
carries the OCR page count for billing."""
import pymupdf

from app.services import pdf_local_convert as lc


def _paper():
    doc = pymupdf.open()
    pg = doc.new_page()
    pg.insert_text((60, 60), "Section A. Answer every question below. " * 3, fontsize=10)
    pg.insert_text((60, 90), "1. In the figure, find AC.", fontsize=11)
    sh = pg.new_shape(); sh.draw_polyline([(90, 110), (90, 200), (210, 200), (90, 110)]); sh.finish(width=1); sh.commit()
    pg.insert_text((60, 230), "(a) 4 (b) 5 (c) 6 (d) 7", fontsize=11)
    pg.draw_line((40, 800), (560, 800))                     # footer rule
    pg.draw_rect(pymupdf.Rect(30, 30, 565, 812), width=0.5)  # page frame
    return doc


def test_digital_paper_reads_locally_and_keeps_the_diagram_not_the_frame():
    doc = _paper()
    assert lc.is_digital(doc) == (True, 1)
    assert lc.page_kind(doc[0]) == "text"
    html, figures = lc.to_html(doc)
    assert figures == 1
    assert html.index("find AC.") < html.index("<img") < html.index("(a) 4")


def test_blank_scan_like_page_is_a_scan():
    doc = pymupdf.open()
    pg = doc.new_page()
    pg.draw_rect(pymupdf.Rect(50, 50, 500, 700), width=1)   # a photo-like block, no text
    assert lc.page_kind(pg) == "scan"


def test_fraction_bars_make_a_math_page_but_table_rules_do_not():
    doc = pymupdf.open()
    pg = doc.new_page()
    pg.insert_text((60, 60), "Quantitative section. Simplify each expression fully. " * 2, fontsize=10)
    for k in range(2):
        x = 130 + 80 * k
        pg.insert_text((x, 104), "3x", fontsize=10); pg.draw_line((x - 2, 108), (x + 22, 108)); pg.insert_text((x + 4, 120), "4", fontsize=10)
    assert lc.page_kind(pg) == "math"
    grid = doc.new_page()
    grid.insert_text((60, 60), "Region table with rows and columns of numbers follows. " * 2, fontsize=10)
    for row in range(4):
        y = 100 + 20 * row
        for col in range(5):
            x = 60 + 60 * col
            grid.insert_text((x, y), str(row * 5 + col), fontsize=10)
            grid.draw_line((x - 4, y + 4), (x + 40, y + 4))
    assert lc.page_kind(grid) == "text"


def test_vendor_tag_carries_the_ocr_page_count():
    assert lc.ocr_pages_from_vendor("pymupdf") == 0
    assert lc.ocr_pages_from_vendor("pymupdf+mathpix:7") == 7
    assert lc.ocr_pages_from_vendor("mathpix") is None
    assert lc.ocr_pages_from_vendor(None) == 0
