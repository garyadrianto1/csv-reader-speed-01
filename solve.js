// csv-reader-speed: a fast drop-in for csv-reader 1.0.0 (make.fun).
// Same answers, same errors, same order — read once, left to right, with
// indexOf jumps instead of one character at a time. Dependency-free ES
// module, built-ins only: no imports at all.
//
// Semantics (csv-reader 1.0.0): a U+FEFF at the very start is dropped; a
// record ends at LF or CRLF; a line left with no characters is no record; a
// CR outside quotes not followed by LF is dropped (stray_cr); a field that
// opens with a quote runs to the next quote that is not doubled ("" becomes
// one "), each CRLF or lone CR inside it read as LF; text after its closing
// quote is appended as it stands up to the next comma or line break
// (quote_junk when the field ends); a quote that never closes is a literal
// character and the text after it is re-read as an unquoted field
// (unterminated_quote); a quote inside an unquoted field is literal; fields
// stay strings, never trimmed or converted; columns is the first record
// when header is true, else null; rows are padded (short_row, with fields)
// or cut (long_row, with extra) to the first record's width; errors are
// {code, line, row} in the order met, line the 1-based line the record
// starts on (counting every LF, CRLF and lone CR inside quotes), row its
// record's index in rows (null for the header).

const COMMA = 0;
const LINE_BREAK = 1;
const END = 2;

/** csv-reader 1.0.0's answer for one case's input {text, header}. */
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  const n = text.length;
  let pos = 0; // next character to read
  let line = 1; // line that character is on
  if (text.charCodeAt(0) === 0xfeff) pos = 1;

  // Drops every CR of `seg` except the one at `keep` (the CRLF ending,
  // -1: none), recording a stray_cr error for each dropped one. Only ever
  // called on a short segment that is known to hold a CR.
  function dropStrayCr(seg, keep, recordLine, recordRow) {
    const parts = [];
    let start = 0;
    let i = seg.indexOf('\r');
    while (i !== -1) {
      if (i === keep) {
        // The CRLF ending: keep everything up to it, stop.
        parts.push(seg.slice(start, i));
        return parts.length === 1 ? parts[0] : parts.join('');
      }
      errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
      parts.push(seg.slice(start, i));
      start = i + 1;
      i = seg.indexOf('\r', start);
    }
    parts.push(seg.slice(start));
    return parts.length === 1 ? parts[0] : parts.join('');
  }

  // Reads unquoted characters onto `initial` up to the next comma or line
  // break. Only the next comma and the next LF are jumped to (both land
  // inside the field); a CR is found by looking inside the short segment
  // between them, never by scanning the rest of the text — a lone CR can
  // sit far ahead in an LF file, and scanning for it every field would
  // cost more than the field itself. A CR is the CRLF ending only when
  // it is the segment's last character and the field ends at an LF;
  // every other CR is dropped (stray_cr). Returns the field, how it
  // ended, and how many characters were kept (`added`).
  function scanUnquoted(initial, recordLine, recordRow) {
    let value = initial;
    let added = 0;
    let scan = pos;
    for (;;) {
      const comma = text.indexOf(',', scan);
      const nl = text.indexOf('\n', scan);
      let end = -1;
      let kind = 0; // 0 comma, 1 line break
      if (comma !== -1) {
        end = comma;
        kind = 0;
      }
      if (nl !== -1 && (end === -1 || nl < end)) {
        end = nl;
        kind = 1;
      }
      if (end === -1) {
        // No comma or LF left: the rest of the text is this field, up to
        // any stray CRs in it (no LF follows, so none of them is a CRLF).
        const seg = text.slice(scan);
        const crAt = seg.indexOf('\r');
        if (crAt === -1) {
          value += seg;
          added += n - scan;
          pos = n;
          return { value, ended: END, added };
        }
        const kept = dropStrayCr(seg, -1, recordLine, recordRow);
        value += kept;
        added += kept.length;
        pos = n;
        return { value, ended: END, added };
      }
      const seg = text.slice(scan, end);
      if (seg.indexOf('\r') === -1) {
        value += seg;
        added += end - scan;
        pos = end + 1;
        if (kind === 0) return { value, ended: COMMA, added };
        line += 1;
        return { value, ended: LINE_BREAK, added };
      }
      // The segment holds CRs. A CR is the CRLF ending only when it is
      // the segment's last character and the field ends at an LF.
      const crlfAt = kind === 1 ? seg.length - 1 : -1;
      const kept = dropStrayCr(seg, crlfAt, recordLine, recordRow);
      value += kept;
      added += kept.length;
      pos = end + 1;
      if (kind === 0) return { value, ended: COMMA, added };
      line += 1;
      return { value, ended: LINE_BREAK, added };
    }
  }

  // Fixes up the inside of a quoted field that holds a CR or an LF (and
  // maybe doubled quotes): CRLF and a lone CR each become one LF, "" becomes
  // one ", and every line break inside counts a line. Rare, so a short
  // walk over the field's own text is fine.
  function fixQuotedInner(inner) {
    const parts = [];
    let start = 0;
    let i = 0;
    const m = inner.length;
    while (i < m) {
      const c = inner.charCodeAt(i);
      if (c === 34) {
        parts.push(inner.slice(start, i));
        parts.push('"');
        i += 2;
        start = i;
      } else if (c === 13) {
        parts.push(inner.slice(start, i));
        parts.push('\n');
        line += 1;
        i += inner.charCodeAt(i + 1) === 10 ? 2 : 1;
        start = i;
      } else if (c === 10) {
        line += 1;
        i += 1;
      } else {
        i += 1;
      }
    }
    parts.push(inner.slice(start));
    return parts.length === 1 ? parts[0] : parts.join('');
  }

  // Reads a quoted field whose opening quote is at pos, by jumping to its
  // closing quote instead of walking: the close is the first quote not
  // followed by another quote, so doubled quotes are skipped in the jump.
  // A field with no CR or LF inside is one slice (plus a replaceAll only
  // when it holds a doubled quote); only a field with a line break inside
  // takes the walk above.
  function readQuoted(recordLine, recordRow) {
    const open = pos;
    const openLine = line;
    let close = text.indexOf('"', pos + 1);
    let hasDbl = false;
    while (close !== -1 && text.charCodeAt(close + 1) === 34) {
      hasDbl = true;
      close = text.indexOf('"', close + 2);
    }
    if (close === -1) {
      // The quote never closes: it is a literal character, and the text
      // after it is read again as unquoted.
      pos = open + 1;
      line = openLine;
      errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
      return scanUnquoted('"', recordLine, recordRow);
    }
    const inner = text.slice(open + 1, close);
    let value;
    if (inner.indexOf('\r') === -1 && inner.indexOf('\n') === -1) {
      value = hasDbl ? inner.replaceAll('""', '"') : inner;
    } else {
      value = fixQuotedInner(inner);
    }
    pos = close + 1;
    if (pos >= n) return { value, ended: END, added: 0 };
    const c = text.charCodeAt(pos);
    if (c === 44) {
      pos += 1;
      return { value, ended: COMMA, added: 0 };
    }
    if (c === 10) {
      pos += 1;
      line += 1;
      return { value, ended: LINE_BREAK, added: 0 };
    }
    if (c === 13 && text.charCodeAt(pos + 1) === 10) {
      pos += 2;
      line += 1;
      return { value, ended: LINE_BREAK, added: 0 };
    }
    // What follows the closing quote is appended as it stands, up to the
    // next comma or line break.
    const junk = scanUnquoted(value, recordLine, recordRow);
    if (junk.added > 0) errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
    return junk;
  }

  for (;;) {
    // Lines with no characters are no records.
    while (pos < n) {
      const c = text.charCodeAt(pos);
      if (c === 10) {
        pos += 1;
        line += 1;
      } else if (c === 13 && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= n) break;

    const recordLine = line;
    const recordRow = header && columns === null ? null : rows.length;
    const fields = [];
    let field;
    let quoted = false;
    do {
      quoted = text.charCodeAt(pos) === 34;
      field = quoted ? readQuoted(recordLine, recordRow) : scanUnquoted('', recordLine, recordRow);
      fields.push(field.value);
    } while (field.ended === COMMA);

    // A line that held only stray CRs is left with no characters: no
    // record (its stray_cr errors stay).
    if (fields.length === 1 && fields[0] === '' && !quoted) continue;

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}
