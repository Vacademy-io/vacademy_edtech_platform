# Scan Station scan fixtures

`expected_11_18.json` is the truth for the live scan test of 2026-11-18. The
images themselves are **not in git**. They are scans of answer sheets, and real
copies will carry real students' names and work. Never commit a scan, a crop,
a header strip or a built PDF.

## Pointing the tests at the scans

`tests/test_copy_check_scan_replay.py` is skipped unless `SCAN_FIXTURES_DIR` is
set. It must point at a folder that holds the two pass folders named in
`pass_dirs`:

```
$SCAN_FIXTURES_DIR/1-fronts/Scan.jpeg ... Scan 5.jpeg   # pass 1
$SCAN_FIXTURES_DIR/2-backs/Scan.jpeg  ... Scan 5.jpeg   # pass 2
```

On the owner's Mac that folder is `~/Desktop/scan-test`. The folder names were
the owner's guesses at scan time and they are the wrong way round:
`1-fronts` holds pass 1, which is the **backs** (last sheet first), and
`2-backs` holds pass 2, which is the **fronts** in forward order. The test
checks every file's sha256 against the JSON, so a wrong folder fails loudly
instead of testing the wrong pages.

The Docker test image cannot see the Mac's `/private/tmp` or Desktop (colima),
so stream the scans in together with the tree:

```sh
# from the repo root; prints pytest's tail
( COPYFILE_DISABLE=1 tar --no-xattrs -cf - --exclude='*.npz' --exclude='__pycache__' ai_service ;
  COPYFILE_DISABLE=1 tar --no-xattrs -C ~/Desktop -cf - scan-test/1-fronts scan-test/2-backs ) |
docker run --rm -i --network none -e PYTHONPATH=/src/ai_service -e SCAN_FIXTURES_DIR=/src/scan-test vac-ai-test \
  sh -c 'mkdir -p /src && cd /src && tar -xf - --ignore-zeros && cd ai_service &&
         python -m pytest -q -p no:cacheprovider tests/test_copy_check_scan_replay.py'
```

## The replay tool

`tools/scan_replay.py` runs the real analyse-load in-process on any local
two-pass folder. It prints the layout, the per-sheet pair scores, the
per-page ink and class, the flags, the timing, the calibration margins and the
copies the planner would make. With `--build-out` it also writes the copy PDFs,
with uploads stubbed. It never calls the vision model unless you pass `--model`.
Run `python tools/scan_replay.py --help` for every option.

```sh
python tools/scan_replay.py --fixtures-dir "$SCAN_FIXTURES_DIR" \
  --expected tests/fixtures/scan/expected_11_18.json \
  --matrix --dpi-sweep 100,150,200,300 --fade --cuts --build-out /tmp/copies --json /tmp/report.json
```

For a new pile, use `--pass1 DIR --pass2 DIR`. Pass `--model <name> --record reads.json`
once, with the ai_service env and database, and the vision model's answers are
saved. Later runs use `--reads reads.json` and replay those answers for free.

## Calibration on the 11-18 scans (current defaults)

The 11-18 test used 3 printed test copies. The writing is handwriting fonts in
blue and black, and one "pencil" side was printed in grey `#9a9a9a`. The paper
was 75 gsm office paper, scanned at 300 DPI in colour by macOS Image Capture.
The replay reproduces the truth exactly:

- pass 2 holds the fronts, upright
- the backs run REVERSED and upright
- 6 of 6 pairs are their row's maximum
- the 2 blank backs are classed BLANK and every other page is WRITTEN
- no flags are raised
- 3 copies are built, with 4, 4 and 2 pages

| What | Measured | Threshold | Room |
|---|---|---|---|
| darkest blank back, ink per 10k | 0.147 | `SCAN_BLANK_INK` 1.0 | 6.8x |
| largest blob on a blank back | 1.10 mm² | `SCAN_BLOB_MM2` 4.0 | 3.6x |
| faintest written page (the grey "pencil" back) | 10.84 | `SCAN_UNSURE_INK` 3.0 | 3.6x |
| order margin (REVERSED, rot 0: 0.480 vs SAME rot 0: 0.329) | 0.31 | `SCAN_ORDER_MIN_MARGIN` 0.15 | 2.1x |
| closest true pair vs best neighbour within ±2 | 0.457 vs 0.432 (5% relative, 0.025 absolute) | `SHIFT_MIN_LEAD` 0.02 | thin |
| full 6x6 matrix: worst row lead / column lead | 0.024 / 0.032 | none | thin |
| labelled fronts vs template (leave one out) | 0.67 to 0.75 | `SCAN_LABEL_SIM_MIN` 0.35 | fine |
| ordinary backs vs label template (best way up) | at most 0.37 | `SCAN_BACK_LABEL_SIM` 0.6 | fine |
| a turned-over labelled front, as a back | 0.67 | `SCAN_BACK_LABEL_SIM` 0.6 | 0.07 only |

Faults planted on the same real images:

| Planted fault | Result |
|---|---|
| sheet 0 turned over (front and back swapped) | BACK_HAS_LABEL, BLOCKED |
| one sheet lost in each pass, at sheets 1 and 4 | PAIR_SHIFT_DETECTED from sheet 1, BLOCKED (also ORDER_UNCERTAIN at 0.12) |
| one sheet lost in each pass, near the end (sheets 3 and 5) | only PAIR_NOT_ROW_MAX on sheet 3 (REVIEW). The last row still looks like a row maximum (0.377 vs 0.371), so no shift is found. **Gap: a skip in the last two sheets is REVIEW, not BLOCK.** |
| fronts fed upside-down, backs, or both | rotation found, same pairs, OK |
| both passes scanned in Grey | the blank backs score 1.04 to 1.11, so they become UNSURE and are kept (the safe direction). Pairing gets worse: 2 rows are not their row maximum and the order margin drops to 0.17. With no colour, the blue rules can no longer be painted out. |

None of these runs called the vision model. Its answers came from the
fixture's truth: labels on the upright fronts, NONE everywhere else. So the
model's own reading has not been tested on these scans: the name box, names,
upside-down strips, and "Name the…" lines.

### Where the room really is: the luma cut, not the ink thresholds

The 73x gap between blank (0.15) and faint (10.8) is misleading. The ink score
counts pixels darker than a fixed cut, `ink.NEUTRAL_INK_Y` = 180. That cut is
a constant, not an env var. Both sides of the cut sit close to it:

- **Blank backs:** show-through starts at Y 185 to 200. With the cut moved to
  190, blanks score 0.73 to 0.84 (still BLANK). At 200 they score 3.9 to 4.5
  (WRITTEN).
- **The grey "pencil" page:** its strokes sit at Y 170 to 200. It scores 2.5
  below 170, 10.8 below 180 and 28 below 190.
- **The same page, faded toward the paper** (`--fade`):

| Faded by | 300 DPI | 200 and 150 DPI | 100 DPI |
|---|---|---|---|
| 10% | 3.95 (WRITTEN, barely) | UNSURE | BLANK |
| 15% | 1.8 (UNSURE) | UNSURE / BLANK | BLANK |
| 20% (darkest pixel Y 152) | BLANK | BLANK | BLANK |

So writing about 20% lighter than this printed grey is classed BLANK and
**left out of the copy**. Light real pencil can easily be that light. Only
the clerk's BLANKS_TO_CONFIRM check stands between such a page and a lost
answer.

The scan DPI matters too. Ink is measured at the scan's own DPI, capped at
300. At 100 DPI the faint page scores 4.5 instead of 10.8, and DPI_LOW only
fires below 150.

### Values proposed for T2's defaults (not applied here)

- `SCAN_BLANK_INK` 1.0, `SCAN_UNSURE_INK` 3.0, `SCAN_BLOB_MM2` 4.0: keep them
  until real pencil is measured. Raising them buys little, because the cut
  decides which pixels count as ink at all.
- Make `NEUTRAL_INK_Y` an env var (default 180), so the cut can be tuned per
  pilot without a release. On this paper it has about 10 luma levels of room.
  At 190 the blanks are still BLANK, but only just (ink 0.84 against 1.0, blob
  3.5 against 4.0 mm²). At 200 they are WRITTEN.
- Pencil is sharp and show-through is blurred. Consider a sharpness-aware ink
  test, such as a stroke count on a high-pass image, if real pencil sits above
  Y 180.
- DPI_LOW: raise it from below 150 to below 200, and tell clerks to scan at
  300 DPI.
- `SCAN_ORDER_MIN_MARGIN` 0.15: keep it.
- `SCAN_BACK_LABEL_SIM`: lower it from 0.6 to 0.5, the midpoint of 0.37 (backs)
  and 0.67 (a turned-over front). Unlabelled fronts reach 0.56, so a
  turned-over continuation sheet would also block, which is acceptable.
- `SCAN_LABEL_SIM_MIN` 0.35: keep it.
- Shift detection: treat PAIR_NOT_ROW_MAX in the first or last row of a load
  as a possible shift (BLOCK, or at least a stronger REVIEW).
- Grey or B&W scans: flag a load in which no page has any tinted pixels
  (`SCAN_NOT_COLOUR`). In grey the blue-rule masking stops working. In B&W
  there is no show-through left to pair on.
- The printed header box shows through onto every back. That puts the
  off-diagonal pair scores at 0.3 to 0.43, close to the true pairs (0.42 to
  0.54). Masking the header band out of the show-through map should widen the
  pairing margin. Re-measure before and after.

## Re-measure on REAL handwritten copies before any pilot

These scans were printed, not handwritten. Before any institute uses Scan
Station, run the acceptance pile from PLAN.json T6 step 4 on the Brother. Use
`tools/scan_replay.py --model … --record …`, `--matrix --dpi-sweep 200,300 --fade --cuts`,
and save each report JSON. Measure:

1. **Real pencil**: HB and 2B, light pressure, a short answer and a lone digit
   on an otherwise blank back. Record the ink, the blob size and the luma
   profile (`--cuts`), and how far `--fade` goes before UNSURE. Pass mark: no
   written page is BLANK, and the faintest written page is at least 3x
   `SCAN_UNSURE_INK`.
2. **Blue ballpoint and black gel show-through onto blank backs**, on the
   institute's real paper. Exam booklets are often 50 to 60 gsm. Blue
   show-through is tinted, and tinted pixels darker than Y 160 count as ink.
   Record the darkest blank back and its largest blob. A heavy bleed that makes
   a blank back UNSURE or WRITTEN is safe, but each such back costs credits.
3. **Blue ballpoint writing on a back.** Light blue is tinted with Y above 160,
   which is not ink. Check that a short blue answer is never BLANK.
4. **Pairing on real handwriting.** Sparse answers make weak show-through.
   Record the order margin, the band margins and the full-matrix leads.
   Re-check `SHIFT_MIN_LEAD` (0.02) against the closest true pair.
5. **The header guard on the institute's own answer-sheet header.** Record the
   label template similarities, the score of a turned-over sheet's front, and
   a supplementary sheet that carries its own name box.
6. **The real vision model on real strips.** Check the name box, empty name
   boxes, "Name the…" answer lines and an upside-down load. Record the answers
   once, then replay them.
7. **Scanner settings.** Compare 200 and 300 DPI, JPEG and scanner-saved PDF,
   and Colour against Grey. Never use B&W.
8. **Timing on a full feeder load and at the 100-page cap.** Features cost
   about 0.35 s per page per worker at 300 DPI (12 pages took 2.1 to 4.2 s on
   2 workers, including the spawn). That is about 35 s for 2 x 100 pages,
   against the 240 s budget.

Before any pilot, all of these must hold: 100% pairing, no written page classed
BLANK, and every planted fault flagged. The planted faults are the double-feed,
the turned-over sheet, the upside-down load and the load that starts in the
middle of a copy.
