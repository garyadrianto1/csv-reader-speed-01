# csv-reader-speed

A fast drop-in for csv-reader 1.0.0 (make.fun bounty
`csv-reader-speed-01-run-20261121`): `solve.js` returns exactly
csv-reader 1.0.0's answer `{columns, rows, errors}` for every input
`{text, header}`, and does it several times faster.

## How it works

One pass, left to right, with `indexOf` jumps instead of one character
at a time:

- Unquoted fields jump to the next comma or LF; a CR is found by looking
  inside the short segment between them, never by scanning the rest of
  the text (a lone CR can sit far ahead in an LF file).
- Quoted fields jump to their closing quote (the first quote not
  followed by another quote), so doubled quotes are skipped in the jump;
  a field with no CR or LF inside is one `slice` (plus a `replaceAll`
  only when it holds a doubled quote).
- Only a quoted field with a line break inside takes a short walk
  (CRLF / lone CR become LF, `""` becomes `"`).

Broken-row policy, error objects, error order and line counting match
csv-reader 1.0.0 exactly, including BOM, stray CRs, quote junk,
unterminated quotes, and short/long rows.

## Layout

- `solve.js` — the entry: `run(input)` (dependency-free ES module,
  built-ins only, no imports).
- `main.ts` — the driver the harness runs: reads `/input/cases.json`,
  answers each case alone with `run`, writes `/output/answers.json`.

## Local results (this VM, Node 24, practice set, 10.19 MB)

- `grade-local`: 6/6 cases identical, `passed: 1`, L1 regrade
  reproduced byte for byte.
- Fuzz vs the reference: 0 divergences over 20,210 cases (210
  hand-written edge cases + 20,000 random token-soup inputs) and 12
  fresh full-size cases drawn with the kit's own generator.
- Speed, trimmed mean over 9 timed rounds: ~117 ms vs ~620–780 ms for
  csv-reader 1.0.0 — about **5–6x faster** locally.

## License

MIT. See `LICENSE`.
