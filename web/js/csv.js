// Algemene CSV-hulpfuncties: tokenizer, scheidingsteken, decimaalteken, getallen en datums.
// Geen afhankelijkheden, zodat dit los te testen is (zie web/tests/).

/** Bepaalt het scheidingsteken aan de hand van de eerste regel (buiten aanhalingstekens). */
export function detectDelimiter(text) {
  const firstLine = text.replace(/^﻿/, '').split(/\r?\n/, 1)[0] ?? '';
  const counts = { ',': 0, ';': 0, '\t': 0 };
  let inQuotes = false;
  for (const ch of firstLine) {
    if (ch === '"') inQuotes = !inQuotes;
    else if (!inQuotes && ch in counts) counts[ch]++;
  }
  const [best, n] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  return n > 0 ? best : ',';
}

/** Zet CSV-tekst om in een array van rijen (arrays van strings). Ondersteunt "..."-velden en "" als escape. */
export function parseCsv(text, delimiter = detectDelimiter(text)) {
  text = text.replace(/^﻿/, '');
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      row.push(field); field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      rows.push(row); row = [];
    } else {
      field += ch;
    }
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }

  // lege regels weg
  return rows.filter(r => r.some(c => c.trim() !== ''));
}

const NUMERIC_RE = /^[-+]?[\d.,]+$/;

/**
 * Bepaalt of een bestand komma of punt als decimaalteken gebruikt, op basis van alle getal-achtige cellen.
 * Een scheider die gevolgd wordt door precies 3 cijfers is dubbelzinnig (duizendtal of decimaal);
 * die tellen we alleen als er niets anders is.
 */
export function detectDecimalSeparator(cells) {
  let comma = 0, dot = 0, ambiguousComma = 0, ambiguousDot = 0;
  for (const raw of cells) {
    const s = String(raw ?? '').trim().replace(/\s/g, '');
    if (!s || !NUMERIC_RE.test(s)) continue;
    const lastComma = s.lastIndexOf(',');
    const lastDot = s.lastIndexOf('.');
    if (lastComma >= 0 && lastDot >= 0) {
      lastComma > lastDot ? comma++ : dot++;
    } else if (lastComma >= 0) {
      const decimals = s.length - lastComma - 1;
      if ((s.match(/,/g) || []).length > 1) dot++;          // 1,234,567 -> komma is duizendtal
      else if (decimals === 3) ambiguousComma++;
      else comma++;
    } else if (lastDot >= 0) {
      const decimals = s.length - lastDot - 1;
      if ((s.match(/\./g) || []).length > 1) comma++;       // 1.234.567 -> punt is duizendtal
      else if (decimals === 3) ambiguousDot++;
      else dot++;
    }
  }
  if (comma !== dot) return comma > dot ? ',' : '.';
  if (ambiguousComma !== ambiguousDot) return ambiguousComma > ambiguousDot ? ',' : '.';
  return ',';
}

/** Zet "1.234,56" / "1,234.56" / "-83,76" om in een getal. Lege waarde -> null. */
export function parseNumber(raw, decimal = ',') {
  if (raw == null) return null;
  let s = String(raw).trim().replace(/\s| /g, '');
  if (s === '' || s === '-') return null;
  const thousands = decimal === ',' ? '.' : ',';
  s = s.split(thousands).join('');
  if (decimal === ',') s = s.replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Herkent dd-mm-jjjj, dd/mm/jjjj, dd.mm.jjjj en jjjj-mm-dd. Geeft {y, m, d} of null. */
export function parseDate(raw) {
  const s = String(raw ?? '').trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return valid(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/);
  if (m) return valid(+m[3], +m[2], +m[1]);
  return null;
}

function valid(y, m, d) {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  return { y, m, d };
}

/** "09:05" -> {h, min}; leeg -> 00:00. */
export function parseTime(raw) {
  const m = String(raw ?? '').trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  return m ? { h: +m[1], min: +m[2], s: +(m[3] ?? 0) } : { h: 0, min: 0, s: 0 };
}

/**
 * Lokale tijd in Amsterdam (zoals DEGIRO die exporteert) -> ISO-string in UTC.
 * Houdt rekening met zomer- en wintertijd via Intl.
 */
export function amsterdamToIso({ y, m, d }, { h = 0, min = 0, s = 0 } = {}) {
  const asUtc = Date.UTC(y, m - 1, d, h, min, s);
  const offset = tzOffsetMs(asUtc, 'Europe/Amsterdam');
  let ts = asUtc - offset;
  // tweede iteratie voor tijden vlak rond de omschakeling
  const offset2 = tzOffsetMs(ts, 'Europe/Amsterdam');
  if (offset2 !== offset) ts = asUtc - offset2;
  return new Date(ts).toISOString();
}

function tzOffsetMs(ts, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(ts));
  const get = t => +parts.find(p => p.type === t).value;
  const local = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return local - ts;
}
