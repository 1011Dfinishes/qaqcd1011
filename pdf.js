// Tiny PDF writer (JPEG images, lines, filled boxes, Times text, links, bookmarks) and the two reports:
// one unit (letterhead, details, the full checklist with Y / N / N/A boxes, deficiencies with photos, comments, sign-off)
// and a whole floor (cover with every unit, punch list, then each unit's report).
'use strict';

// character widths of the three Times fonts (from the Finishes app)
const TIMES_WIDTHS = {"Times-Roman": [250, 333, 408, 500, 500, 833, 778, 180, 333, 333, 500, 564, 250, 333, 250, 278, 500, 500, 500, 500, 500, 500, 500, 500, 500, 500, 278, 278, 564, 564, 564, 444, 921, 722, 667, 667, 722, 611, 556, 722, 722, 333, 389, 722, 611, 889, 722, 722, 556, 722, 667, 556, 611, 722, 722, 944, 722, 722, 611, 333, 278, 333, 469, 500, 333, 444, 500, 444, 500, 444, 333, 500, 500, 278, 278, 500, 278, 778, 500, 500, 500, 500, 333, 389, 278, 500, 500, 722, 500, 500, 444, 480, 200, 480, 541], "Times-Bold": [250, 333, 555, 500, 500, 1000, 833, 278, 333, 333, 500, 570, 250, 333, 250, 278, 500, 500, 500, 500, 500, 500, 500, 500, 500, 500, 333, 333, 570, 570, 570, 500, 930, 722, 667, 722, 722, 667, 611, 778, 778, 389, 500, 778, 667, 944, 722, 778, 611, 778, 722, 556, 667, 722, 722, 1000, 722, 722, 667, 333, 278, 333, 581, 500, 333, 500, 556, 444, 556, 444, 333, 500, 556, 278, 333, 556, 278, 833, 556, 500, 556, 556, 444, 389, 333, 556, 500, 722, 500, 500, 444, 394, 220, 394, 520], "Times-Italic": [250, 333, 420, 500, 500, 833, 778, 214, 333, 333, 500, 675, 250, 333, 250, 278, 500, 500, 500, 500, 500, 500, 500, 500, 500, 500, 333, 333, 675, 675, 675, 500, 920, 611, 611, 667, 722, 611, 611, 722, 722, 333, 444, 667, 556, 833, 667, 722, 611, 722, 611, 500, 556, 722, 611, 833, 611, 556, 556, 389, 278, 389, 422, 500, 333, 500, 500, 444, 500, 444, 278, 500, 500, 278, 278, 444, 278, 722, 500, 500, 500, 500, 389, 389, 278, 500, 444, 667, 444, 444, 389, 400, 275, 400, 541]};

const PDF_FONTS = { R: 'Times-Roman', B: 'Times-Bold', I: 'Times-Italic' };        // width tables
const TNR = { R: ['TimesNewRomanPSMT', 34, 0, 82], B: ['TimesNewRomanPS-BoldMT', 34 + 262144, 0, 136], I: ['TimesNewRomanPS-ItalicMT', 98, -16.33, 76] };
const WINANSI = { '–': 150, '—': 151, '‘': 145, '’': 146, '“': 147, '”': 148, '•': 149, '…': 133, '€': 128 };

function pdfBytes(str) {                       // text -> WinAnsi bytes (anything else prints as ?)
  const out = [];
  for (const ch of String(str)) {
    const c = ch.codePointAt(0);
    if (WINANSI[ch]) out.push(WINANSI[ch]);
    else if (c === 9) out.push(32);
    else if (c >= 32 && c < 127) out.push(c);
    else if (c >= 160 && c < 256) out.push(c);
    else out.push(63);
  }
  return out;
}

function pdfStr(str) {
  let s = '(';
  for (const b of pdfBytes(str)) {
    if (b === 40 || b === 41 || b === 92) s += '\\' + String.fromCharCode(b);
    else if (b < 32 || b > 126) s += '\\' + b.toString(8).padStart(3, '0');
    else s += String.fromCharCode(b);
  }
  return s + ')';
}

function textWidth(str, font, size) {
  const w = TIMES_WIDTHS[PDF_FONTS[font]];
  let t = 0;
  for (const b of pdfBytes(str)) t += (b >= 32 && b <= 126) ? w[b - 32] : b === 183 ? 250 : b === 160 ? 250 : b === 150 ? 500 : b === 151 || b === 133 ? 1000 : b === 149 ? 350 : b >= 145 && b <= 148 ? 333 : 500;
  return t * size / 1000;
}

// lines that fit maxW; keeps the writer's line breaks, and breaks a word that is wider than the whole line
function wrapText(str, font, size, maxW) {
  const out = [];
  String(str == null ? '' : str).replace(/\r\n?/g, '\n').split('\n').forEach(para => {
    const words = para.split(/[ \t]+/).filter(Boolean);
    if (!words.length) { out.push(''); return; }
    let cur = '';
    for (let w of words) {
      while (textWidth(w, font, size) > maxW && w.length > 1) {       // a very long word: cut it
        if (cur) { out.push(cur); cur = ''; }
        let k = w.length - 1;
        while (k > 1 && textWidth(w.slice(0, k), font, size) > maxW) k--;
        out.push(w.slice(0, k)); w = w.slice(k);
      }
      const t = cur ? cur + ' ' + w : w;
      if (!cur || textWidth(t, font, size) <= maxW) cur = t;
      else { out.push(cur); cur = w; }
    }
    if (cur) out.push(cur);
  });
  while (out.length > 1 && out[out.length - 1] === '') out.pop();
  return out;
}

// cut a line to fit, with … at the end
function fitText(str, font, size, maxW) {
  str = String(str == null ? '' : str).replace(/\s+/g, ' ').trim();
  if (textWidth(str, font, size) <= maxW) return str;
  while (str.length > 1 && textWidth(str + '…', font, size) > maxW) str = str.slice(0, -1);
  return str.replace(/\s+$/, '') + '…';
}

function jpegInfo(bytes) {
  let i = 2;
  while (i < bytes.length) {
    if (bytes[i] !== 0xFF) { i++; continue; }
    const m = bytes[i + 1];
    if (m === 0xD8 || (m >= 0xD0 && m <= 0xD7) || m === 0x01 || m === 0xFF) { i += m === 0xFF ? 1 : 2; continue; }
    const len = (bytes[i + 2] << 8) | bytes[i + 3];
    if ((m >= 0xC0 && m <= 0xC3) || (m >= 0xC5 && m <= 0xC7) || (m >= 0xC9 && m <= 0xCB) || (m >= 0xCD && m <= 0xCF)) {
      return { h: (bytes[i + 5] << 8) | bytes[i + 6], w: (bytes[i + 7] << 8) | bytes[i + 8], comps: bytes[i + 9] };
    }
    i += 2 + len;
  }
  throw new Error('Not a JPEG image');
}

const f2 = n => (Math.round(n * 100) / 100).toString();

class PdfDoc {
  constructor(title) { this.title = title || ''; this.images = []; this.pages = []; this.outline = []; }

  addJpeg(bytes) {
    const info = jpegInfo(bytes);
    const img = Object.assign({ name: 'Im' + (this.images.length + 1), bytes }, info);
    this.images.push(img);
    return img;
  }

  page() {
    const p = { ops: [], imgs: new Set(), links: [] };
    this.pages.push(p);
    return p;
  }

  bookmark(title, pageIndex) { this.outline.push({ title, pageIndex }); }

  save() {
    const enc = new TextEncoder();
    const chunks = [], offsets = [];
    let pos = 0;
    const put = (x) => { const b = typeof x === 'string' ? enc.encode(x) : x; chunks.push(b); pos += b.length; };
    const latin = (s) => { const b = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 255; return b; };
    let n = 0;
    const alloc = () => ++n;
    const catalog = alloc(), pagesObj = alloc(), info = alloc();
    const outlinesObj = this.outline.length ? alloc() : 0;
    const outlineObjs = this.outline.map(() => alloc());
    const fontObj = { R: alloc(), B: alloc(), I: alloc() }, descObj = { R: alloc(), B: alloc(), I: alloc() };
    const imgObj = this.images.map(() => alloc());
    const pageObjs = this.pages.map(p => ({ page: alloc(), content: alloc(), links: p.links.map(() => alloc()) }));
    const dest = i => '[' + pageObjs[i].page + ' 0 R /Fit]';

    put('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
    const begin = (num) => { offsets[num] = pos; put(num + ' 0 obj\n'); };
    const end = () => put('\nendobj\n');

    begin(catalog);
    put('<< /Type /Catalog /Pages ' + pagesObj + ' 0 R' + (outlinesObj ? ' /Outlines ' + outlinesObj + ' 0 R /PageMode /UseOutlines' : '') + ' >>'); end();
    begin(pagesObj); put('<< /Type /Pages /Count ' + this.pages.length + ' /Kids [' + pageObjs.map(p => p.page + ' 0 R').join(' ') + '] >>'); end();
    begin(info); put('<< /Title ' + pdfStr(this.title) + ' /Author (Donato Plumbing Group Inc.) /Creator (Donato Plumbing Group Inc.) >>'); end();
    if (outlinesObj) {
      begin(outlinesObj); put('<< /Type /Outlines /First ' + outlineObjs[0] + ' 0 R /Last ' + outlineObjs[outlineObjs.length - 1] + ' 0 R /Count ' + outlineObjs.length + ' >>'); end();
      this.outline.forEach((o, i) => {
        begin(outlineObjs[i]);
        put('<< /Title ' + pdfStr(o.title) + ' /Parent ' + outlinesObj + ' 0 R /Dest ' + dest(o.pageIndex) +
            (i > 0 ? ' /Prev ' + outlineObjs[i - 1] + ' 0 R' : '') + (i < outlineObjs.length - 1 ? ' /Next ' + outlineObjs[i + 1] + ' 0 R' : '') + ' >>');
        end();
      });
    }
    // Times New Roman, named so the phone or computer uses its own copy (it has the same letter widths as Times)
    for (const k of Object.keys(fontObj)) {
      const [name, flags, angle, stem] = TNR[k], w = [];
      for (let c = 32; c <= 255; c++) w.push(Math.round(textWidth(String.fromCharCode(c === 133 ? 8230 : c === 145 ? 8216 : c === 146 ? 8217 : c === 147 ? 8220 : c === 148 ? 8221 : c === 150 ? 8211 : c === 151 ? 8212 : c === 149 ? 8226 : c), k, 1000)));
      begin(fontObj[k]); put('<< /Type /Font /Subtype /TrueType /BaseFont /' + name + ' /FirstChar 32 /LastChar 255 /Widths [' + w.join(' ') + '] /FontDescriptor ' + descObj[k] + ' 0 R /Encoding /WinAnsiEncoding >>'); end();
      begin(descObj[k]); put('<< /Type /FontDescriptor /FontName /' + name + ' /Flags ' + flags + ' /FontBBox [-568 -307 2000 1007] /ItalicAngle ' + angle + ' /Ascent 891 /Descent -216 /CapHeight 662 /StemV ' + stem + ' >>'); end();
    }
    this.images.forEach((im, i) => {
      const cs = im.comps === 1 ? '/DeviceGray' : im.comps === 4 ? '/DeviceCMYK' : '/DeviceRGB';
      begin(imgObj[i]);
      put('<< /Type /XObject /Subtype /Image /Width ' + im.w + ' /Height ' + im.h + ' /ColorSpace ' + cs +
          ' /BitsPerComponent 8 /Filter /DCTDecode' + (im.comps === 4 ? ' /Decode [1 0 1 0 1 0 1 0]' : '') + ' /Length ' + im.bytes.length + ' >>\nstream\n');
      put(im.bytes); put('\nendstream'); end();
    });
    const fontRes = '/Font << /F1 ' + fontObj.R + ' 0 R /F2 ' + fontObj.B + ' 0 R /F3 ' + fontObj.I + ' 0 R >>';
    this.pages.forEach((p, i) => {
      const o = pageObjs[i];
      const xo = [...p.imgs].map(im => '/' + im.name + ' ' + imgObj[this.images.indexOf(im)] + ' 0 R').join(' ');
      begin(o.page);
      put('<< /Type /Page /Parent ' + pagesObj + ' 0 R /MediaBox [0 0 612 792] /Contents ' + o.content +
          ' 0 R /Resources << ' + fontRes + (xo ? ' /XObject << ' + xo + ' >>' : '') + ' >>' +
          (o.links.length ? ' /Annots [' + o.links.map(l => l + ' 0 R').join(' ') + ']' : '') + ' >>');
      end();
      p.links.forEach((l, j) => {
        begin(o.links[j]);
        put('<< /Type /Annot /Subtype /Link /Rect [' + l.rect.map(f2).join(' ') + '] /Border [0 0 0] /Dest ' + dest(l.page) + ' >>');
        end();
      });
      const body = latin(p.ops.join('\n'));
      begin(o.content); put('<< /Length ' + body.length + ' >>\nstream\n'); put(body); put('\nendstream'); end();
    });
    const xref = pos;
    let x = 'xref\n0 ' + (n + 1) + '\n0000000000 65535 f \n';
    for (let i = 1; i <= n; i++) x += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
    put(x + 'trailer\n<< /Size ' + (n + 1) + ' /Root ' + catalog + ' 0 R /Info ' + info + ' 0 R >>\nstartxref\n' + xref + '\n%%EOF\n');
    const out = new Uint8Array(pos);
    let off = 0;
    for (const c of chunks) { out.set(c, off); off += c.length; }
    return out;
  }
}

// ---------- drawing helpers (PDF points, origin bottom-left). A colour is a grey level 0..1 or [r, g, b].
const fontKey = { R: 'F1', B: 'F2', I: 'F3' };
const fillC = c => Array.isArray(c) ? c.map(f2).join(' ') + ' rg' : f2(c) + ' g';
const strokeC = c => Array.isArray(c) ? c.map(f2).join(' ') + ' RG' : f2(c) + ' G';
function pText(p, x, y, s, font, size, color) { if (s === '' || s == null) return; p.ops.push('BT /' + fontKey[font] + ' ' + size + ' Tf ' + fillC(color || 0) + ' 1 0 0 1 ' + f2(x) + ' ' + f2(y) + ' Tm ' + pdfStr(s) + ' Tj ET'); }
function pTextR(p, x, y, s, font, size, color) { pText(p, x - textWidth(s, font, size), y, s, font, size, color); }
function pTextC(p, x, y, s, font, size, color) { pText(p, x - textWidth(s, font, size) / 2, y, s, font, size, color); }
function pLine(p, x1, y1, x2, y2, w, color) { p.ops.push(strokeC(color) + ' ' + f2(w) + ' w [] 0 d 0 J ' + f2(x1) + ' ' + f2(y1) + ' m ' + f2(x2) + ' ' + f2(y2) + ' l S'); }
function pDots(p, x1, x2, y, color) { if (x2 > x1) p.ops.push(strokeC(color) + ' 1 w 1 J [0.1 3.4] 0 d ' + f2(x1) + ' ' + f2(y) + ' m ' + f2(x2) + ' ' + f2(y) + ' l S [] 0 d 0 J'); }
function pRect(p, x, y, w, h, lw, color) { p.ops.push(strokeC(color) + ' ' + f2(lw) + ' w [] 0 d ' + f2(x) + ' ' + f2(y) + ' ' + f2(w) + ' ' + f2(h) + ' re S'); }
function pFill(p, x, y, w, h, color) { p.ops.push(fillC(color) + ' ' + f2(x) + ' ' + f2(y) + ' ' + f2(w) + ' ' + f2(h) + ' re f'); }
function pImage(p, im, x, y, w, h) { p.imgs.add(im); p.ops.push('q ' + f2(w) + ' 0 0 ' + f2(h) + ' ' + f2(x) + ' ' + f2(y) + ' cm /' + im.name + ' Do Q'); }
function pCross(p, x, y, s, w, color) {         // an X inside the square at (x, y) with side s
  const a = s * 0.24, b = s * 0.76;
  p.ops.push(strokeC(color) + ' ' + f2(w) + ' w [] 0 d 1 J ' + f2(x + a) + ' ' + f2(y + a) + ' m ' + f2(x + b) + ' ' + f2(y + b) + ' l ' + f2(x + a) + ' ' + f2(y + b) + ' m ' + f2(x + b) + ' ' + f2(y + a) + ' l S 0 J');
}

// The box filled in with a pen: back-and-forth strokes in dark ink that cover the box.
function pFillPen(p, bx, by, s, seed) {
  const r = k => { const v = Math.sin(seed * 12.9898 + k * 78.233) * 43758.5453; return (v - Math.floor(v)) - 0.5; };
  let d = ''; const n = 9;
  for (let i = 0; i <= n; i++) {
    const yy = by + 0.9 + i / n * (s - 1.8) + 0.15 * r(i + 9), L = bx + 0.9 + 0.35 * r(i), R = bx + s - 0.9 + 0.35 * r(i + 20);
    d += (i ? f2(i % 2 ? R : L) + ' ' + f2(yy) + ' l ' : f2(L) + ' ' + f2(yy) + ' m ') + f2(i % 2 ? L : R) + ' ' + f2(yy + 0.15 * r(i + 40)) + ' l ';
  }
  p.ops.push('0.1 0.12 0.22 RG 1.25 w 1 J 1 j ' + d + 'S 0 J 0 j');
}

// ---------- page layout (US Letter, same frame as the Finishes photo book)
const PW = 612, PH = 792, PL = 54, PR = 558, PTW = PR - PL;
const FOOTER_Y = 46, BOTTOM = FOOTER_Y + 16;
const GREY = 0x4D / 255, RULE = 0x22 / 255, FRAME = 0x6F / 255, DOTS = 0x8C / 255, HAIR = 0.8, LIGHT = 0.62;
const NAVY = [31 / 255, 78 / 255, 121 / 255], RED = [179 / 255, 38 / 255, 30 / 255], GREEN = [31 / 255, 107 / 255, 53 / 255], AMBER = [138 / 255, 101 / 255, 16 / 255];
const SEC_FILL = [0.925, 0.942, 0.962], DEF_FILL = [0.99, 0.93, 0.925], OK_FILL = [0.92, 0.958, 0.928], WARN_FILL = [0.995, 0.962, 0.875];
const LDW = 360, LDH = 360 * 195 / 1377;
const RESULT_TEXT = { pass: 'PASS', fail: 'FAIL', prog: 'IN PROGRESS', none: 'NOT STARTED' };
const RESULT_COLOR = { pass: GREEN, fail: RED, prog: NAVY, none: GREY };
const STATUS_TEXT = { open: 'OPEN', overdue: 'OVERDUE', closed: 'CLOSED' };
const STATUS_COLOR = { open: AMBER, overdue: RED, closed: GREEN };
const STATUS_FILL = { open: WARN_FILL, overdue: DEF_FILL, closed: OK_FILL };

function letterhead(p, lh) {
  pImage(p, lh, PL, PH - 38 - LDH, LDW, LDH);
  const y = PH - 38 - LDH - 10;
  pLine(p, PL, y, PR, y, 1.5, RULE);
  pLine(p, PL, y - 3, PR, y - 3, 0.5, RULE);
  return y - 3;
}

// letterhead + "PLUMBING ROUGH-IN QA/QC ... FLOOR 6 · UNIT 4"; returns where the page's content starts
function pageHeader(p, lh, right) {
  const y = letterhead(p, lh) - 26;
  pText(p, PL, y, right, 'B', 15);
  pLine(p, PL, y - 6, PR, y - 6, 0.5, RULE);
  return y - 6 - 16;
}

// page numbers go on last, once the number of pages is known
function addFooters(doc, exported) {
  const total = doc.pages.length;
  doc.pages.forEach((p, i) => {
    pLine(p, PL, FOOTER_Y, PR, FOOTER_Y, 0.5, RULE);
    pText(p, PL, FOOTER_Y - 12, fitText('Donato Plumbing Group Inc.  ·  ' + (p.foot || 'Plumbing Rough-In QA/QC'), 'R', 9, 300), 'R', 9, GREY);
    pTextR(p, PR, FOOTER_Y - 12, (exported ? 'Exported ' + exported + '   ·   ' : '') + 'Page ' + (i + 1) + ' of ' + total, 'R', 9, GREY);
  });
}

// Fills pages top to bottom; starts a new page (with its header) whenever the next piece does not fit.
class Flow {
  constructor(doc, lh, right, foot) { this.doc = doc; this.lh = lh; this.right = right; this.foot = foot; this.cont = null; this.p = null; this.y = 0; }
  page() {
    this.p = this.doc.page();
    this.p.foot = this.foot;
    this.y = pageHeader(this.p, this.lh, this.right);
    if (this.cont) this.cont();
    return this.p;
  }
  room() { return this.y - BOTTOM; }
  ensure(h) { if (this.y - h < BOTTOM) { this.page(); return true; } return false; }
}

function heading(fl, title, right) {
  const p = fl.p;
  pText(p, PL, fl.y - 12, title, 'B', 12);
  if (right) pTextR(p, PR, fl.y - 12, right, 'R', 9.5, GREY);
  pLine(p, PL, fl.y - 17, PR, fl.y - 17, 0.5, RULE);
  fl.y -= 27;
}

// a row of small boxes with a number and a label (used for the totals)
function statBoxes(fl, cells) {
  const p = fl.p, w = PTW / cells.length, h = 40, top = fl.y;
  cells.forEach((c, i) => {
    const x = PL + i * w;
    pRect(p, x, top - h, w, h, 0.6, RULE);
    pTextC(p, x + w / 2, top - 13, c.label, 'B', 7);
    pTextC(p, x + w / 2, top - 32, c.value, 'R', c.value.length > 7 ? 12 : 15);
  });
  fl.y -= h;
}

// "Label: value" on a ruled line; returns nothing, draws at baseline y
function formField(p, x, y, label, value, endX, opts) {
  pText(p, x, y, label, 'B', 11);
  const vx = x + textWidth(label, 'B', 11) + 6;
  pLine(p, vx - 2, y - 2.5, endX, y - 2.5, 0.6, 0);
  if (value) pText(p, vx, y, fitText(value, opts && opts.font || 'R', 11, endX - vx - 2), opts && opts.font || 'R', 11, opts && opts.color || 0);
}

// ---------- one unit's report
// u: {floor, unit, project, inspectedOn, inspectedBy, comments, stats:{total, answered, ok, na, defs, open, overdue, closed, result},
//     sections:[{name, items:[{n, question, answer, res}]}], defs:[{ref, section, n, question, st, notes, corrective, responsible, due, corrected, verified, photos:[{img|null, w, h, label}]}],
//     sigs:{donato:{name, date, img, w, h}, ccm:{...}}}
// Images must already be added to the document (img = doc.addJpeg(...)).
function unitReport(doc, lh, u) {
  const right = 'FLOOR ' + u.floor + ' · UNIT ' + u.unit, st = u.stats;
  const fl = new Flow(doc, lh, right, 'Floor ' + u.floor + ', Unit ' + u.unit);
  fl.page();
  const first = doc.pages.length - 1;
  let p = fl.p;

  // details
  let y = fl.y - 6;
  formField(p, PL, y, 'Project / Location:', u.project, PR);
  y -= 26;
  formField(p, PL, y, 'Floor:', String(u.floor), PL + 120);
  formField(p, PL + 140, y, 'Unit:', String(u.unit), PL + 250);
  formField(p, PL + 270, y, 'Result:', RESULT_TEXT[st.result], PR, { font: 'B' });
  y -= 26;
  formField(p, PL, y, 'Inspected on:', u.inspectedOn, PL + 230);
  formField(p, PL + 250, y, 'Inspected by:', u.inspectedBy, PR);
  fl.y = y - 22;
  y = fl.y + 22 - 26;
  formField(p, PL, y, 'Answered:', st.answered + ' of ' + st.total, PL + 150);
  formField(p, PL + 168, y, 'Errors:', String(st.defs), PL + 290);
  formField(p, PL + 308, y, 'Open:', st.open + (st.overdue ? ' (' + st.overdue + ' overdue)' : ''), PL + 400);
  formField(p, PL + 418, y, 'Closed:', String(st.closed), PR);
  fl.y = y - 8;
  fl.y -= 22;

  // the checklist
  const cN = PL + 4, wN = 26, cQ = PL + 30, wQ = PTW - 30 - 3 * 28 - 66, cA = cQ + wQ, wA = 28, cR = cA + 3 * wA, wR = 66;
  const BOX = 9, LEAD = 12.4, FS = 10.5;
  const tableHead = () => {
    const pp = fl.p, h = 16, top = fl.y;
    ['Y', 'N', 'N/A'].forEach((t, i) => pTextC(pp, cA + i * wA + wA / 2, top - 11, t, 'B', 10));
    pTextC(pp, cR + wR / 2, top - 11, 'Result', 'B', 10);
    fl.y -= h;
  };
  // Option 4: each section in its own box; a section that runs onto the next page closes its box and starts a new one there
  let curSec = null, boxTop = 0;
  const closeBox = () => { if (curSec) pRect(fl.p, PL, fl.y - 4, PTW, boxTop - (fl.y - 4), 0.8, RULE); };
  const secTitle = (sec, cont) => {
    const pp = fl.p, top = fl.y;
    boxTop = top;
    pText(pp, PL + 8, top - 15, fitText(sec.name + (cont ? '  (continued)' : ''), 'B', 11.5, PTW - 20), 'B', 11.5);
    pLine(pp, PL, top - 21, PR, top - 21, 0.5, RULE);
    fl.y -= 23;
  };
  const rowH = it => Math.max(19, it.lines.length * LEAD + 7);
  heading(fl, 'INSPECTION CHECKLIST', st.total + ' items in ' + u.sections.length + ' sections');
  tableHead();
  fl.cont = () => { heading(fl, 'INSPECTION CHECKLIST (continued)'); tableHead(); if (curSec) secTitle(curSec, true); };
  u.sections.forEach((sec, si) => {
    sec.items.forEach(it => { it.lines = wrapText(it.question, 'R', FS, wQ - 10); });
    curSec = null;
    if (si) fl.y -= 8;
    fl.ensure(23 + sec.items.slice(0, 3).reduce((t, it) => t + rowH(it), 0) + 8);      // start a section with at least three of its items on the page
    curSec = sec;
    secTitle(sec, false);
    sec.items.forEach((it, k) => {
      const h = rowH(it);
      if (fl.y - h - 4 < BOTTOM) { closeBox(); fl.page(); }
      const pp = fl.p, top = fl.y, base = top - 13;
      pTextR(pp, cN + wN - 4, base, it.n + '.', 'R', FS);
      it.lines.forEach((ln, j) => pText(pp, cQ + 2, base - j * LEAD, ln, 'R', FS));
      ['Y', 'N', 'NA'].forEach((a, i) => {
        const bx = cA + i * wA + (wA - BOX) / 2, by = top - 5.4 - BOX;
        pRect(pp, bx, by, BOX, BOX, 0.6, 0.25);
        if (it.answer === a) pFillPen(pp, bx, by, BOX, it.n * 3 + i);
      });
      if (it.res === 'def') pTextC(pp, cR + wR / 2, base, 'ERROR', 'B', 9);
      else if (it.res === 'ok') pTextC(pp, cR + wR / 2, base, 'OK', 'R', 10);
      else if (it.res === 'na') pTextC(pp, cR + wR / 2, base, 'N/A', 'R', 10, GREY);
      else pTextC(pp, cR + wR / 2, base, '—', 'R', 10, LIGHT);
      fl.y -= h;
      const lastOnPage = k < sec.items.length - 1 && fl.y - rowH(sec.items[k + 1]) - 4 < BOTTOM;
      if (k < sec.items.length - 1 && !lastOnPage) pLine(pp, PL + 8, fl.y, PR - 8, fl.y, 0.3, 0.78);
    });
    closeBox();
    fl.y -= 4;
  });
  fl.cont = null; curSec = null;
  fl.y -= 22;

  // deficiencies, with details and photos
  if (u.defs.length) {
    const defHead = () => heading(fl, 'ERRORS', plural2(u.defs.length, 'error', 'errors') + '  ·  ' + st.open + ' open' + (st.overdue ? '  ·  ' + st.overdue + ' overdue' : '') + '  ·  ' + st.closed + ' closed');
    u.defs.forEach((d, di) => {
      const qLines = wrapText(d.question, 'I', 10.5, PTW - 12);
      const LW = 104, VW = PTW - LW - 12, VL = 12;
      const longs = [['Notes / error:', d.notes], ['Corrective action:', d.corrective]].map(([l, v]) => [l, wrapText(v || '—', 'R', 10, VW)]);
      // keep the heading, the text and the first row of photos together when they fit on one page
      const GAP = 10, PER = 3, CW = (PTW - 12 - (PER - 1) * GAP) / PER, MAXH = CW * 0.92;
      const sized = d.photos.map(ph => {
        const sc = ph.img ? Math.min(CW / ph.w, MAXH / ph.h) : 0;
        return Object.assign({}, ph, { dw: ph.img ? ph.w * sc : CW, dh: ph.img ? ph.h * sc : CW * 0.75 });
      });
      const rowH = k => Math.max.apply(null, sized.slice(k, k + PER).map(r => r.dh)) + 14 + 4;
      const textH = 22 + qLines.length * 13 + 8 + longs.reduce((t, l) => t + l[1].length * VL + 3, 0) + 2 * VL + 6;
      const whole = textH + (sized.length ? rowH(0) : 0);
      const need = whole <= PH - 230 ? whole : 22 + qLines.length * 13 + 8 + 2 * VL;
      if (di === 0) { fl.ensure(27 + need); defHead(); fl.cont = () => heading(fl, 'ERRORS (continued)'); }      // the heading stays with the first one
      else fl.ensure(need);
      let pp = fl.p, top = fl.y;
      // header strip
      pText(pp, PL, top - 12.5, fitText(d.ref + '   ·   ' + d.section, 'B', 11, PTW - 90), 'B', 11);
      pTextR(pp, PR, top - 12.5, STATUS_TEXT[d.st], 'B', 9.5);
      pLine(pp, PL, top - 18, PR, top - 18, 0.5, RULE);
      fl.y -= 18 + 4;
      qLines.forEach((ln, j) => pText(pp, PL + 6, fl.y - 10 - j * 13, ln, 'I', 10.5));
      fl.y -= qLines.length * 13 + 8;
      // notes and corrective action (line by line, so a long note can run onto the next page)
      longs.forEach(([label, lines]) => {
        lines.forEach((ln, j) => {
          if (fl.ensure(VL + 2)) pp = fl.p;
          if (j === 0) pText(pp, PL + 6, fl.y - 9, label, 'B', 9.5);
          pText(pp, PL + 6 + LW, fl.y - 9, ln, 'R', 10, ln === '—' ? LIGHT : 0);
          fl.y -= VL;
        });
        fl.y -= 3;
      });
      // the four short fields, two to a line
      const shorts = [['Responsible:', d.responsible], ['Due date:', d.due], ['Corrected on:', d.corrected], ['Verified by:', d.verified]];
      for (let k = 0; k < 4; k += 2) {
        if (fl.ensure(VL + 2)) pp = fl.p;
        [shorts[k], shorts[k + 1]].forEach(([label, v], c) => {
          const x = PL + 6 + c * (PTW / 2);
          pText(pp, x, fl.y - 9, label, 'B', 9.5);
          pText(pp, x + (c ? 80 : LW), fl.y - 9, fitText(v || '—', 'R', 10, PTW / 2 - (c ? 80 : LW) - 12), 'R', 10, v ? 0 : LIGHT);
        });
        fl.y -= VL;
      }
      fl.y -= 6;
      // photos, three to a row
      if (sized.length) {
        for (let k = 0; k < sized.length; k += PER) {
          const row = sized.slice(k, k + PER), rh = rowH(k) - 4;
          if (fl.ensure(rh + 4)) pp = fl.p;
          row.forEach((ph, c) => {
            const cx = PL + 6 + c * (CW + GAP), x = cx + (CW - ph.dw) / 2, yTop = fl.y - 2;
            if (ph.img) pImage(pp, ph.img, x, yTop - ph.dh, ph.dw, ph.dh);
            else { pFill(pp, x, yTop - ph.dh, ph.dw, ph.dh, 0.95); pTextC(pp, cx + CW / 2, yTop - ph.dh / 2 - 3, 'Photo not available', 'I', 8, GREY); }
            pRect(pp, x, yTop - ph.dh, ph.dw, ph.dh, 0.6, FRAME);
            pTextC(pp, cx + CW / 2, yTop - ph.dh - 10, fitText(ph.label, 'I', 7.8, CW), 'I', 7.8, GREY);
          });
          fl.y -= rh + 4;
        }
      }
      fl.y -= di < u.defs.length - 1 ? 14 : 4;
    });
    fl.cont = null;
    fl.y -= 18;
  }

  // unit comments
  const cLines = u.comments ? wrapText(u.comments, 'R', 10.5, PTW) : [];
  fl.ensure(27 + Math.min(cLines.length || 1, 4) * 13.5 + 6);
  heading(fl, 'UNIT COMMENTS');
  fl.cont = () => heading(fl, 'UNIT COMMENTS (continued)');
  if (!cLines.length) { pText(fl.p, PL, fl.y - 10, 'None.', 'I', 10.5, GREY); fl.y -= 13.5; }
  cLines.forEach(ln => { fl.ensure(13.5); pText(fl.p, PL, fl.y - 10, ln, 'R', 10.5); fl.y -= 13.5; });
  fl.cont = null;
  fl.y -= 24;

  // sign-off
  const stmt = wrapText('By signing below, the representatives confirm that the plumbing rough-in for Floor ' + u.floor + ', Unit ' + u.unit +
    ' was inspected and that the results are as recorded in this report.', 'R', 10, PTW);
  fl.ensure(27 + stmt.length * 13 + 158);
  heading(fl, 'SIGN-OFF');
  stmt.forEach((ln, i) => pText(fl.p, PL, fl.y - 9 - i * 13, ln, 'R', 10, GREY));
  fl.y -= stmt.length * 13 + 22;
  drawSignatures(fl.p, fl.y, u.sigs || {});
  fl.y -= 150;
  return first;
}

function cap(lines, n) { if (lines.length <= n) return lines; const out = lines.slice(0, n); out[n - 1] = out[n - 1].replace(/\s*\S*$/, '') + '…'; return out; }
function capRows(rows, n) { if (rows.length <= n) return; rows.length = n; rows[n - 1] = Object.assign({}, rows[n - 1], { t: rows[n - 1].t.replace(/\s*\S*$/, '') + '…' }); }
function plural2(n, one, many) { return n + ' ' + (n === 1 ? one : many); }

function drawSignatures(p, y, sigs) {
  const colw = (PTW - 40) / 2;
  [[PL, 'Donato Representative', 'donato'], [PL + colw + 40, 'CCM Representative', 'ccm']].forEach(([x, who, role]) => {
    pText(p, x, y - 10, who, 'B', 12);
    const s = sigs[role] || {};
    const nameY = y - 44, sigY = nameY - 42, dateY = sigY - 36;
    if (s.img) {                               // signature first, so the labels print on top of it
      const h = 30, w = Math.min(colw - 4, h * (s.w / s.h));
      pImage(p, s.img, x + 2, sigY + 1.5, w, h);
    }
    if (s.name) pText(p, x + 2, nameY + 4, fitText(s.name, 'R', 12, colw - 4), 'R', 12);
    if (s.date) pText(p, x + 2, dateY + 4, s.date, 'R', 12);
    [['Print Name', nameY], ['Signature', sigY], ['Date', dateY]].forEach(([label, yy]) => {
      pLine(p, x, yy, x + colw, yy, 0.6, 0);
      pText(p, x, yy - 11, label, 'R', 9.5, GREY);
    });
  });
}

// adds a unit's images to the document and returns the unit with img fields filled
function withImages(doc, u) {
  u.defs.forEach(d => d.photos.forEach(ph => { ph.img = ph.jpeg ? doc.addJpeg(ph.jpeg) : null; ph.jpeg = null; }));
  Object.keys(u.sigs || {}).forEach(r => { const s = u.sigs[r]; s.img = s.jpeg ? doc.addJpeg(s.jpeg) : null; s.jpeg = null; });
  return u;
}

function buildUnitPdf(u, letterheadJpeg, title, exported) {
  const doc = new PdfDoc(title);
  const lh = doc.addJpeg(letterheadJpeg);
  unitReport(doc, lh, withImages(doc, u));
  addFooters(doc, exported);
  return doc.save();
}

// ---------- a whole floor: cover with every unit, punch list, then each unit's report
// f: {floor, project, exported, stats:{pass, fail, prog, none, defs, open, overdue, closed, signed, units},
//     units:[{unit, inspectedOn, inspectedBy, answered, total, open, result, signed}], defs:[{ref, section, question, notes, corrective, responsible, due, st}],
//     bySection:[{name, total, open}]}
// loadUnit(i) returns unit i's report data (see unitReport); it is called one unit at a time.
async function buildFloorPdf(f, letterheadJpeg, title, loadUnit) {
  const doc = new PdfDoc(title);
  const lh = doc.addJpeg(letterheadJpeg);
  const right = 'FLOOR ' + f.floor, n = f.units.length;
  const fl = new Flow(doc, lh, right, 'Floor ' + f.floor);

  // cover
  fl.p = doc.page(); fl.p.foot = fl.foot;
  doc.bookmark('Cover', 0);
  let p = fl.p, y = letterhead(p, lh);
  y -= 74; pTextC(p, PW / 2, y, 'FLOOR ' + f.floor, 'B', 26);
  y -= 28; pTextC(p, PW / 2, y, 'QA/QC Inspection Report', 'R', 16);
  y -= 22; pTextC(p, PW / 2, y, 'Units 1 through ' + n, 'R', 13);
  y -= 44;
  formField(p, PL, y, 'Project / Location:', f.project, PR);
  y -= 26;
  formField(p, PL, y, 'Floor:', String(f.floor), PL + 200);
  formField(p, PL + 220, y, 'Date:', f.exportedDay, PR);
  fl.y = y - 24;
  const s = f.stats;
  statBoxes(fl, [
    { label: 'PASSED', value: String(s.pass), color: s.pass ? GREEN : LIGHT },
    { label: 'FAILED', value: String(s.fail), color: s.fail ? RED : LIGHT },
    { label: 'IN PROGRESS', value: String(s.prog), color: s.prog ? NAVY : LIGHT },
    { label: 'NOT STARTED', value: String(s.none), color: s.none ? GREY : LIGHT },
    { label: 'ERRORS', value: String(s.defs) },
    { label: 'OPEN', value: String(s.open), color: s.open ? AMBER : LIGHT, fill: s.open ? WARN_FILL : null },
    { label: 'OVERDUE', value: String(s.overdue), color: s.overdue ? RED : LIGHT, fill: s.overdue ? DEF_FILL : null },
    { label: 'SIGNED OFF', value: s.signed + ' / ' + n, color: s.signed ? GREEN : LIGHT }
  ]);
  fl.y -= 24;

  // every unit, with its page number (filled in once the units are laid out)
  const cols = [['Unit', 38, 'c'], ['Inspected on', 76, 'l'], ['Inspected by', 112, 'l'], ['Answered', 60, 'c'], ['Open', 40, 'c'], ['Result', 70, 'c'], ['Signed', 52, 'c'], ['Page', 56, 'r']];
  const colX = []; let cx = PL; cols.forEach(c => { colX.push(cx); cx += c[1]; });
  const cell = (pp, i, yy, text, font, size, color) => {
    const [, w, al] = cols[i], x = colX[i];
    const t = fitText(text, font, size, w - 8);
    if (al === 'c') pTextC(pp, x + w / 2, yy, t, font, size, color); else if (al === 'r') pTextR(pp, x + w - 4, yy, t, font, size, color); else pText(pp, x + 4, yy, t, font, size, color);
  };
  const unitsHead = () => {
    const pp = fl.p, h = 18, top = fl.y;
    pLine(pp, PL, top, PR, top, 0.8, RULE);
    cols.forEach((c, i) => cell(pp, i, top - 12.5, c[0], 'B', 8.5));
    pLine(pp, PL, top - h, PR, top - h, 0.5, RULE);
    fl.y -= h;
  };
  heading(fl, 'UNITS', f.units.some(u => u.include) ? 'Tap a unit to go to its report' : '');
  unitsHead();
  fl.cont = () => { heading(fl, 'UNITS (continued)'); unitsHead(); };
  const pageCells = [];
  f.units.forEach((u, i) => {
    const h = 16;
    fl.ensure(h);
    const pp = fl.p, top = fl.y, yy = top - 11.3;
    cell(pp, 0, yy, String(u.unit), 'B', 10);
    cell(pp, 1, yy, u.inspectedOn || '—', 'R', 9.5, u.inspectedOn ? 0 : LIGHT);
    cell(pp, 2, yy, u.inspectedBy || '—', 'R', 9.5, u.inspectedBy ? 0 : LIGHT);
    cell(pp, 3, yy, u.answered + ' / ' + u.total, 'R', 9.5, u.answered ? 0 : LIGHT);
    cell(pp, 4, yy, String(u.open), u.open ? 'B' : 'R', 9.5, u.open ? 0 : LIGHT);
    cell(pp, 5, yy, RESULT_TEXT[u.result], u.result === 'none' ? 'R' : 'B', 8.5, u.result === 'none' ? LIGHT : 0);
    cell(pp, 6, yy, u.signed ? 'Yes' : '—', 'R', 9.5, u.signed ? 0 : LIGHT);
    pLine(pp, PL, top - h, PR, top - h, 0.3, HAIR);
    pageCells.push({ p: pp, top, yy });
    fl.y -= h;
  });
  fl.cont = null;

  // punch list
  fl.page();
  const punchPage = doc.pages.length - 1;
  doc.bookmark('Punch list', punchPage);
  const pc = [['Ref', 46], ['Inspection Item', 166], ['Notes / Corrective Action', 150], ['Responsible', 62], ['Due', 42], ['Status', 38]];
  const px = []; cx = PL; pc.forEach(c => { px.push(cx); cx += c[1]; });
  const punchHead = () => {
    const pp = fl.p, h = 18, top = fl.y;
    pLine(pp, PL, top, PR, top, 0.8, RULE);
    pc.forEach((c, i) => pText(pp, px[i] + 4, top - 12.5, c[0], 'B', 8.5));
    pLine(pp, PL, top - h, PR, top - h, 0.5, RULE);
    fl.y -= h;
  };
  const nOpen = f.defs.filter(d => d.st !== 'closed').length, nOver = f.defs.filter(d => d.st === 'overdue').length;
  heading(fl, 'PUNCH LIST', plural2(f.defs.length, 'error', 'errors') + '  ·  ' + nOpen + ' open' + (nOver ? '  ·  ' + nOver + ' overdue' : ''));
  if (!f.defs.length) { pText(fl.p, PL, fl.y - 12, 'No errors on Floor ' + f.floor + '.', 'I', 11, GREY); fl.y -= 22; }
  else {
    punchHead();
    fl.cont = () => { heading(fl, 'PUNCH LIST (continued)'); punchHead(); };
    const FS = 8.6, LD = 10.2;
    f.defs.forEach((d, i) => {
      const item = [{ t: d.section, f: 'B', c: GREY }].concat(wrapText(d.question, 'R', FS, pc[1][1] - 8).map(t => ({ t, f: 'R', c: 0 })));
      const note = (d.notes ? wrapText(d.notes, 'R', FS, pc[2][1] - 8).map(t => ({ t, f: 'R', c: 0 })) : [])
        .concat(d.corrective ? wrapText('Fix: ' + d.corrective, 'I', FS, pc[2][1] - 8).map(t => ({ t, f: 'I', c: GREY })) : []);
      if (!note.length) note.push({ t: '—', f: 'R', c: LIGHT });
      const resp = cap(wrapText(d.responsible || '—', 'R', FS, pc[3][1] - 8), 4);
      capRows(item, 7); capRows(note, 14);       // a very long note is cut here; the unit's report has all of it
      const h = Math.max(item.length, note.length, resp.length) * LD + 7;
      fl.ensure(h);
      const pp = fl.p, top = fl.y;
      const yy = top - 10.5;
      pText(pp, px[0] + 4, yy, d.ref, 'B', FS);
      item.forEach((l, j) => pText(pp, px[1] + 4, yy - j * LD, fitText(l.t, l.f, j ? FS : 7.4, pc[1][1] - 8), l.f, j ? FS : 7.4, l.c));
      note.forEach((l, j) => pText(pp, px[2] + 4, yy - j * LD, l.t, l.f, FS, l.c));
      resp.forEach((l, j) => pText(pp, px[3] + 4, yy - j * LD, l, 'R', FS, d.responsible ? 0 : LIGHT));
      pText(pp, px[4] + 4, yy, d.dueShort || '—', d.st === 'overdue' ? 'B' : 'R', FS, d.dueShort ? 0 : LIGHT);
      pText(pp, px[5] + 4, yy, STATUS_TEXT[d.st], 'B', 6.9);
      pLine(pp, PL, top - h, PR, top - h, 0.35, HAIR);
      fl.y -= h;
    });
    fl.cont = null;
    // deficiencies by section
    fl.y -= 22;
    fl.ensure(27 + 16 + (f.bySection.length + 1) * 15);
    heading(fl, 'ERRORS BY SECTION');
    const sc = [PL + 4, PR - 150, PR - 4];
    f.bySection.concat([{ name: 'All sections', total: f.defs.length, open: nOpen, tot: true }]).forEach(b => {
      fl.ensure(15);
      const pp = fl.p, yy = fl.y - 10.5;
      if (b.tot) pLine(pp, PL, fl.y, PR, fl.y, 0.6, RULE);
      pText(pp, sc[0], yy, fitText(b.name, b.tot ? 'B' : 'R', 10, 300), b.tot ? 'B' : 'R', 10);
      pTextR(pp, sc[1], yy, b.total + ' total', b.tot ? 'B' : 'R', 10, b.total ? 0 : LIGHT);
      pTextR(pp, sc[2], yy, b.open + ' open', b.open ? 'B' : 'R', 10, b.open ? 0 : LIGHT);
      if (!b.tot) pLine(pp, PL, fl.y - 15, PR, fl.y - 15, 0.3, HAIR);
      fl.y -= 15;
    });
  }

  // each unit that has been started (a unit with nothing answered and no signatures has nothing to show)
  for (let i = 0; i < n; i++) {
    const c = pageCells[i];
    if (!f.units[i].include) { pTextR(c.p, PR - 4, c.yy, '—', 'R', 9.5, LIGHT); continue; }
    const u = await loadUnit(i);
    const start = unitReport(doc, lh, withImages(doc, u));
    doc.bookmark('Unit ' + f.units[i].unit, start);
    const num = String(start + 1);
    pTextR(c.p, PR - 4, c.yy, num, 'R', 9.5);
    pDots(c.p, colX[7] + 4, PR - 8 - textWidth(num, 'R', 9.5), c.yy + 1.5, DOTS);
    c.p.links.push({ rect: [PL, c.top - 16, PR, c.top], page: start });
  }
  addFooters(doc, f.exported);
  return doc.save();
}
