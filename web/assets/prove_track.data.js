/* ============================================================
  Cellrix prove-track primitives (ADR-0016 D1/D6) — pure functions, zero state

  What is left here after the Node-side layer took over consumption: the
  formatting and DOM primitives the trajectory's other layers share. There is no
  event knowledge in this file and no protocol name — nothing here can tell one
  kind of row from another, deliberately.

  Cross-asset communication goes through the window.CxProveTrack namespace
  (ADR-0016 D2). This file must load FIRST of the prove_track.* assets.
  ============================================================ */
(function () {
  'use strict';
  var PT = window.CxProveTrack = window.CxProveTrack || {};

  function $ (id) { return document.getElementById(id); }

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function jsonOf(d) { try { return JSON.stringify(d, null, 2); } catch (e) { return String(d); } }
  function short(s, n) { s = String(s || ''); return s.length > n ? s.slice(0, n) + '…' : s; }
  /* The first line a PERSON reads, not the zero-th line of the string. A body
   * that opens with a blank line and nothing else made every reply's one-line
   * summary empty — visible only once a UI hint that used to trail it was
   * removed, which is why "the hint is leaking into the document" turned out to
   * be two things: the hint, and this. */
  function firstLine(s, n) {
    var lines = String(s || '').split('\n');
    for (var i = 0; i < lines.length; i++) {
      if (lines[i].trim() !== '') { return short(lines[i], n || 100); }
    }
    return '';
  }

  /* The status vocabulary the view renders. A closed set: the four words a row
   * can be in, each with its colour class. */
  var STATUS = {
    ok: { t: 'success', c: 'ok' }, fail: { t: 'failure', c: 'fail' },
    pending: { t: 'pending', c: 'pending' }, done: { t: 'done', c: 'done' }
  };

  /* The glyph for "there is no such fact". It has exactly one source, because
   * three layers need to recognise it: the formatters write it, the panes write
   * it, and the export must not quote a row whose detail is only this. */
  var ABSENT = '\u2014';

  function fmtDur(ms) { return ms === 0 ? ABSENT : (ms < 1000 ? ms + 'ms' : (ms / 1000).toFixed(2) + 's'); }
  /* null/undefined = the fact does not exist; 0 = the fact IS zero. Two
   * different things, two different renderings (DNA principle 11: never a fake
   * placeholder). */
  function fmtTok(n) { return (n == null) ? ABSENT : Number(n).toLocaleString('en-US'); }

  PT.data = {
    $: $, esc: esc, jsonOf: jsonOf, short: short, firstLine: firstLine,
    STATUS: STATUS, fmtDur: fmtDur, fmtTok: fmtTok, ABSENT: ABSENT
  };
})();
