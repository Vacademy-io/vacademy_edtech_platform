# Pen faces for the checked copy

Both are SIL Open Font License 1.1 (see OFL.txt), so they may be embedded and
redistributed with this service.

- `ArchitectsDaughter.ttf` — the marker's prose hand. A second measurement
  pass settled the question the first one got wrong: the reference teacher's
  letters stand within 0-3 degrees of PAGE vertical (bowl-counter axes -1.2,
  +1.2, +2.8, -0.8), and their apparent rightward lean comes entirely from a
  baseline that climbs 10-22 degrees. Pairing a right-leaning face WITH that
  climb double-counts the lean - it measured +21 to +27 degrees of bowl tilt
  against the reference's ~0-3, which is what made the writing read as italic
  type. An upright face plus the climb reproduces the reference's mechanism.
- `Kalam.ttf` — kept as an alternative leaning hand. Chosen by measuring ten candidate
  faces against a real teacher-marked script: after de-rotating that teacher's
  comment (it is written uphill, ~10.5 degrees) their letters still lean +7.5
  degrees right, and Kalam (+11.5) was the only candidate that leans right at
  all. Every other finalist was upright or slightly back-slanted, which is the
  loudest trait in the reference hand.
- `PatrickHand.ttf` — digits only. Kalam's "1" is a bare vertical stroke,
  16px wide against its own "l" at 15px, so a mark of "10" or "1.5" is
  ambiguous. Patrick Hand flags its "1" (23px vs 17px).

`COPY_CHECK_HANDWRITING_FONT` still overrides the prose face if a deployment
wants its own hand.
