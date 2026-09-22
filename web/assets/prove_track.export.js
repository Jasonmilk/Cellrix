/* The Markdown projection of the trajectory (ADR-0018: one tape, many targets).
 *
 * PULL, not push. This is NOT a target: nothing is serialised when a token
 * refreshes, and there is no second thing to keep in step. It is a pure function
 * of the rows the trajectory has ALREADY rendered — so what a reviewer opens is
 * what the screen showed, and that lock is structural rather than a rule someone
 * has to remember. It re-derives nothing: it cannot disagree with the view,
 * because the view's rows are its only input.
 *
 * A reviewer needs three things from an exported trace, and each has one source:
 *   what happened       the row's summary (the render table already said it)
 *   what it said        the row's detail / full text / payload (the panes)
 *   where to check it    the row's identity — source#lineNo — the same anchor the
 *                       view puts in data-e-ev
 */
(function () {
  'use strict';
  var PT = window.CxProveTrack = window.CxProveTrack || {};
  var D = PT.data;
  if (!D) {
    throw new Error('prove_track.export.js requires prove_track.data.js to load first');
  }
  var ABSENT = D.ABSENT;

  /* A value may not break the row it sits in. */
  function cell(s) {
    return String(s == null ? '' : s).replace(/\|/g, '\\|').replace(/[\r\n]+/g, ' ').trim();
  }

  /* A fence inside the body would end the block early. Widening it is the
   * documented way out and it costs nothing when it is not needed. */
  function fence(body, lang) {
    var text = String(body == null ? '' : body);
    var ticks = '```';
    while (text.indexOf(ticks) !== -1) { ticks += '`'; }
    return ticks + (lang || '') + '\n' + text + '\n' + ticks;
  }

  /* A row earns a block when it has something to quote beyond its one-line
   * summary. `detail` is the panes' own answer to that question, so the export
   * asks the panes rather than deciding again — an em dash there means the row
   * has nothing to say, and quoting it would be noise. */
  function hasArtifact(r) {
    if ((r.full || '') !== '') { return true; }
    return (r.detail || '') !== '' && r.detail !== ABSENT;
  }

  function group(session) {
    var groups = [], cur = null;
    (session || []).forEach(function (r) {
      if (r.kind === 'turn') { cur = { turn: r, rows: [] }; groups.push(cur); return; }
      if (r.kind !== 'ev') { return; }
      if (!cur) { cur = { turn: null, rows: [] }; groups.push(cur); }
      cur.rows.push(r);
    });
    return groups;
  }

  /* ---- the derivation: what each conclusion rests on ---------------------
   *
   * A timeline says when things happened. A certificate says what supports what.
   * This is the second half, derived from the rows already in hand — no new field
   * and nothing re-fetched:
   *
   *   verdict  the conclusion (a row whose class is VERDICT)
   *   checks   each one's judgement, and the evidence it read
   *   exhibits the evidence rows, carryable by the id a check cites
   *   dangling a check that cites evidence the window does not contain
   *
   * `dangling` is the point. A check saying "the evidence was fine" while the
   * evidence is not in the same document is the failure this structure exists to
   * make visible, and it is NOT the same as a check that passed.
   *
   * Two naming facts this has to respect, both measured:
   *   - the row's payload is camelCased by the event-family field table, so the
   *     citation key is `evidenceId`, not `evidence_id`;
   *   - the citation's id is `{period}#{index}` and a tool-result row carries the
   *     `index` in its payload, so the exhibit id is DERIVED here rather than
   *     stored. Storing it would be a second copy of a fact the row already has.
   */
  function derivation(session) {
    var exhibits = {}, checks = [], verdict = null;
    (session || []).forEach(function (r) {
      if (r.kind !== 'ev') { return; }
      var p = {};
      try { p = JSON.parse(r.payload || '{}'); } catch (e) { p = {}; }
      if (r.cls === 'VERDICT' && !verdict) {
        verdict = { id: r.id, status: p.status || r.status, checks: r.summary };
      } else if (r.cls === 'CHECK') {
        checks.push({ id: r.id, check: p.check, passed: p.passed === true,
          gate: p.gate, judge: p.judge, cites: p.evidenceId || null });
      } else if (r.cls === 'TOOL') {
        exhibits[r.source + '#' + p.index] = { id: r.id, tool: p.tool, ts: r.ts,
          durationMs: p.durationMs };
      }
    });
    var resolved = [], dangling = [];
    checks.forEach(function (c) {
      if (!c.cites) { dangling.push(c); return; }
      if (exhibits[c.cites]) { resolved.push(c); } else { dangling.push(c); }
    });
    return { verdict: verdict, checks: checks, exhibits: exhibits,
      resolved: resolved, dangling: dangling };
  }

  /* ---- what the certificate shows by default -----------------------------
   *
   * The certificate has one rule, and it is the opposite of the timeline's: a
   * timeline is complete or it is broken, while a certificate is READ. So the
   * default is not "everything" — it is exactly two things:
   *
   *   always  the conclusion, and every check that does NOT resolve
   *   folded  each resolving check, and every exhibit
   *
   * Because the only thing allowed to interrupt a reader is the thing they must
   * act on. A dangling citation is a fact about the document; a passing check is
   * a fact about the work, and the reader came for the conclusion. The opposite
   * was measured first: expanding everything puts the verdict dozens of rows from
   * its own evidence, which is how a certificate turns into a log with a heading.
   *
   * Pure, so the decision can be asserted without a DOM: the view draws what this
   * says rather than deciding again, which is the only way "what is folded by
   * default" can be reviewed as one thing.
   */
  function certificateState(d) {
    var der = d || { checks: [], exhibits: {}, dangling: [], resolved: [], verdict: null };
    var dangling = der.dangling || [];
    var open = {};
    dangling.forEach(function (c) { open[c.id] = { check: true, exhibit: true }; });
    return {
      verdict: der.verdict,
      head: dangling,
      foldedChecks: (der.resolved || []).length,
      foldedExhibits: Object.keys(der.exhibits || {}).length,
      open: open,
      totals: {
        checks: (der.checks || []).length,
        exhibits: Object.keys(der.exhibits || {}).length,
        dangling: dangling.length
      }
    };
  }

  function source(session) {
    var first = null, last = null, seen = {};
    (session || []).forEach(function (r) {
      if (r.kind !== 'ev' || !r.source) { return; }
      if (!first) { first = r.source; }
      last = r.source;
      seen[r.source] = true;
    });
    return { root: first, leaf: last, count: Object.keys(seen).length };
  }

  function span(session) {
    /* The window is a fact about the rows, not about the order they arrived in.
     * Subtracting the LAST timestamp from the FIRST made the result a function of
     * arrival order: the same rows reversed rendered `span: -428.0s` and
     * `not attributed: -525.0s`, i.e. a complete-looking exhibit whose two
     * headline numbers were subtraction artefacts. Measured against the real
     * 10-period chain, forward 428.0s / 331.0s, reversed -428.0s / -525.0s.
     * So the endpoints are min/max, which cannot depend on order. */
    var lo = null, hi = null, loTs = null, hiTs = null;
    (session || []).forEach(function (r) {
      if (r.kind !== 'ev' || !r.ts) { return; }
      if (loTs === null || r.ts < loTs) { loTs = r.ts; lo = r.ts; }
      if (hiTs === null || r.ts > hiTs) { hiTs = r.ts; hi = r.ts; }
    });
    var ms = (lo !== null && hi !== null) ? Date.parse(hi) - Date.parse(lo) : NaN;
    return { from: lo, to: hi, ms: isFinite(ms) ? ms : null };
  }

  /* The session vocabulary: kinds the REDUCER emits as carriers, which the
   * export consumes rather than drops. They belong here as a named list instead
   * of a `kind === 'ev'` test buried in the loop — the exception is a fact about
   * the session shape, and it should be readable as one. Measured while writing
   * this: without the list, `ev` was reported as an undeclared dropped kind on
   * the real chain, i.e. the checker's first red was its own blind spot. */
  var SESSION_CARRIERS = ['ev', 'turn'];

  /* The kinds a window carries that NO table accounts for: not drawn, not
   * declared, and not a carrier the reducer introduced. Split out so the export
   * and its test read the same function rather than each deciding what
   * "dropped" means. */
  function undeclaredKinds(session, carriers) {
    var R = PT.render;
    if (!R) { return []; }
    var allow = carriers || SESSION_CARRIERS;
    var seen = {}, out = [];
    (session || []).forEach(function (r) {
      if (!r || !r.kind || allow.indexOf(r.kind) !== -1) { return; }
      if (R.SUMMARY[r.kind] || (R.NOT_DRAWN && R.NOT_DRAWN[r.kind])) { return; }
      if (seen[r.kind]) { return; }
      seen[r.kind] = true; out.push(r.kind);
    });
    return out;
  }

  /* Rows arriving out of time order are a fact about the INPUT, and the export
   * must not paper over it. Re-sorting silently would hide exactly what the
   * document exists to let someone check — so this refuses instead. It is not a
   * behaviour change for ordered input (all 162 real event files measured
   * 2026-09-21 are ordered); it converts "upstream went out of order" from a
   * negative number nobody questions into an error at the door.
   *
   * Throws rather than returns: a caller that could ignore a boolean would. */
  function assertTimeOrdered(session) {
    var prev = null, prevTs = null;
    (session || []).forEach(function (r, i) {
      if (r.kind !== 'ev' || !r.ts) { return; }
      if (prevTs !== null && r.ts < prevTs) {
        throw new Error('export refused: row ' + i + ' (' + r.id + ') is at ' + r.ts +
          ', earlier than its predecessor ' + prev + ' at ' + prevTs +
          ' — the rows are not in time order, so every span computed from them' +
          ' would be a subtraction in the wrong direction. Fix the stream, not the export.');
      }
      prevTs = r.ts; prev = r.id;
    });
  }

  function markdown(session, meta, usage) {
    assertTimeOrdered(session);
    var groups = group(session);
    var rowCount = groups.reduce(function (a, g) { return a + g.rows.length; }, 0);
    var out = [];
    out.push('# ProveTrack export' + (meta && (meta.name || meta.job_id)
      ? ' — ' + cell(meta.name || meta.job_id) : ''));
    out.push('');
    var src = source(session), sp = span(session);
    out.push('- window: ' + (src.root ? '`' + cell(src.root) + '` → `' + cell(src.leaf) +
      '` · ' + src.count + ' period' + (src.count === 1 ? '' : 's') : 'no periods'));
    out.push('- rows: ' + rowCount + ' over ' + groups.length + ' turn' +
      (groups.length === 1 ? '' : 's'));
    /* Whether anything JUDGED this window, stated either way (K-114).
     *
     * A `Met` verdict with no judgement behind it is not a finding, it is the
     * absence of one — and an exhibit that prints only `Met` reads as "verified".
     * Measured in this workspace: 5 of the 6 most recent periods carry no
     * check/status row at all, and a wrong answer was stamped `success` in a
     * window that says so in every other line.
     *
     * Both cases are printed, not just the bad one, because a line that appears
     * only when something is wrong is itself a shape: "verified" and "unverified"
     * have to look different at a glance, which they only do if the good case also
     * carries a line. The count is the criterion — zero checks cannot support any
     * conclusion, whatever the verdict row says. */
    var judged = derivation(session);
    out.push(judged.checks.length
      ? '- judged by: ' + judged.checks.length + ' check' + (judged.checks.length === 1 ? '' : 's')
      : '- judged by: NOTHING — no check row in this window, so its verdict is ' +
        'UNVERIFIED and must not be read as "checked and passed"');
    if (sp.from) {
      /* Wall-clock in the window is a fact; so is the part of it the rows
       * account for. Reporting only the span let a reviewer assume the waits add
       * up — measured on one period: span 8.0s, visible waits 4.6s, and 3.4s of
       * inference that belongs to no row. Naming the difference turns an
       * unaccounted silence into a number someone can chase. */
      var waits = 0;
      (session || []).forEach(function (r) { if (r.kind === 'ev' && r.dur > 0) { waits += r.dur; } });
      out.push('- span: ' + cell(sp.from) + ' → ' + cell(sp.to) +
        (sp.ms == null ? '' : ' (' + (sp.ms / 1000).toFixed(1) + 's)') +
        ' · waits on rows: ' + D.fmtDur(waits) +
        (sp.ms == null ? '' :
          ' · **not attributed to any row: ' + ((sp.ms - waits) / 1000).toFixed(1) + 's**'));
    }
    if (usage) {
      out.push('- tokens: ' + D.fmtTok(usage.total) + ' over ' + usage.calls + ' call' +
        (usage.calls === 1 ? '' : 's') + ' · prompt ' + D.fmtTok(usage.prompt) +
        ' · completion ' + D.fmtTok(usage.completion) +
        (usage.cached == null ? '' : ' · cached ' + D.fmtTok(usage.cached)));
    }
    /* A `#` column that skips a number looks like missing data. The kinds that
     * are measured but not drawn are declared rather than left to be inferred.
     *
     * The table above is a claim about the CONTRACT; it cannot speak for the
     * window, which is merged from files written by more than one process. A
     * kind that reached the stream and is in neither table is dropped by the
     * render filter, and the declaration would not mention it — declared
     * coverage, actual coverage, one level apart. Measured before this line
     * existed: the contract's 10 kinds were exactly covered (no silent drop
     * today), so the gap opens the day a new kind arrives, which is the day
     * nobody is looking. */
    var notDrawn = [];
    if (PT.render && PT.render.NOT_DRAWN) {
      Object.keys(PT.render.NOT_DRAWN).forEach(function (k) {
        notDrawn.push(k + ' (' + PT.render.NOT_DRAWN[k] + ')');
      });
    }
    if (notDrawn.length) {
      out.push('- not drawn as rows: ' + notDrawn.join('; ') +
        ' — so a gap in the row numbering is expected');
    }
    /* Declared at runtime, from the rows actually dropped — not from the table.
     * The rows are still dropped (the document must not draw what the view did
     * not); what changes is that the drop is named instead of looking like
     * nothing was there. */
    var undeclared = undeclaredKinds(session);
    if (undeclared.length) {
      out.push('- not drawn and NOT declared: ' + undeclared.join(', ') +
        ' — these kinds reached the window and were dropped without a declaration,' +
        ' so the row set below is incomplete for reasons no table states');
    }
    out.push('- these are the rows the trajectory rendered: nothing is re-derived here');
    /* `wait` is the interval that ENDED at the row, not a stage's own time. One
     * model call produces thinking and answer together, so they share one call
     * and only the call has a duration — naming it after one of them would
     * report a certainty nobody measured. */
    out.push('- `wait` is the interval that ended at that row; for a model row it is the');
    out.push('  whole call (thinking and answer come from one call, so neither has its own)');
    out.push('- every row carries `ref` — `source#lineNo` — so it can be checked against its record');
    out.push('');
    var n = 0;
    groups.forEach(function (g) {
      out.push('## ' + (g.turn ? 'Turn ' + g.turn.index + ' · ' + cell(g.turn.note) : 'Rows'));
      out.push('');
      if (!g.rows.length) { out.push('_no rows_'); out.push(''); return; }
      /* The figure is a CALL's total (prompt + completion) — on a row whose
       * call re-sent a large context, most of it is prompt. Calling the column
       * 'tokens' invited reading it as the answer's size. */
      /* The figure is the TURN's metering total over its calls — measured: 2049 +
       * 2394 + 1501 = 5944 on one reply whose own answer was short. It was called
       * `call tok` for a round, which promised per-call and delivered per-turn:
       * a value standing where a different quantity was announced. */
      out.push('| # | ref | class | status | wait | turn tok | summary |');
      out.push('|---|-----|-------|--------|------|----------|---------|');
      g.rows.forEach(function (r) {
        n++;
        out.push('| ' + n + ' | `' + cell(r.id) + '` | ' + cell(r.cls) + ' | ' + cell(r.status) +
          ' | ' + cell(D.fmtDur(r.dur)) + ' | ' + cell(D.fmtTok(r.tok)) + ' | ' + cell(r.summary) + ' |');
      });
      out.push('');
      g.rows.forEach(function (r, i) {
        if (!hasArtifact(r)) { return; }
        out.push('### ' + r.cls + ' · `' + cell(r.id) + '`');
        out.push('');
        out.push('- status: ' + cell(r.status) + (r.tool ? ' · tool: ' + cell(r.tool) : '') +
          (r.ts ? ' · time: ' + cell(r.ts) : ''));
        if (r.kindNote) { out.push('- kind: ' + cell(r.kindNote)); }
        if (r.full) {
          out.push('');
          out.push(fence(r.full, 'text'));
        } else if (r.term) {
          out.push('');
          out.push(fence(r.detail, 'console'));
        }
        if (r.payload) {
          out.push('');
          out.push('payload');
          out.push('');
          out.push(fence(r.payload, 'json'));
        }
        if (r.detail && r.detail !== ABSENT && !r.full && !r.term) {
          out.push('');
          out.push('result');
          out.push('');
          out.push(fence(r.detail, 'text'));
        }
        out.push('');
      });
    });
    return out.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
  }

  PT.export = { markdown: markdown, hasArtifact: hasArtifact, source: source, span: span,
    assertTimeOrdered: assertTimeOrdered, undeclaredKinds: undeclaredKinds,
    derivation: derivation, certificateState: certificateState };
})();
