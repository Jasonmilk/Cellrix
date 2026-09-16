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
    var a = null, b = null;
    (session || []).forEach(function (r) {
      if (r.kind !== 'ev' || !r.ts) { return; }
      if (!a) { a = r.ts; }
      b = r.ts;
    });
    var ms = (a && b) ? Date.parse(b) - Date.parse(a) : NaN;
    return { from: a, to: b, ms: isFinite(ms) ? ms : null };
  }

  function markdown(session, meta, usage) {
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
    if (sp.from) {
      out.push('- span: ' + cell(sp.from) + ' → ' + cell(sp.to) +
        (sp.ms == null ? '' : ' (' + (sp.ms / 1000).toFixed(1) + 's)'));
    }
    if (usage) {
      out.push('- tokens: ' + D.fmtTok(usage.total) + ' over ' + usage.calls + ' call' +
        (usage.calls === 1 ? '' : 's') + ' · prompt ' + D.fmtTok(usage.prompt) +
        ' · completion ' + D.fmtTok(usage.completion) +
        (usage.cached == null ? '' : ' · cached ' + D.fmtTok(usage.cached)));
    }
    /* A `#` column that skips a number looks like missing data. The kinds that
     * are measured but not drawn are declared rather than left to be inferred. */
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
    out.push('- these are the rows the trajectory rendered: nothing is re-derived here');
    out.push('- every row carries `ref` — `source#lineNo` — so it can be checked against its record');
    out.push('');
    var n = 0;
    groups.forEach(function (g) {
      out.push('## ' + (g.turn ? 'Turn ' + g.turn.index + ' · ' + cell(g.turn.note) : 'Rows'));
      out.push('');
      if (!g.rows.length) { out.push('_no rows_'); out.push(''); return; }
      out.push('| # | ref | class | status | duration | tokens | summary |');
      out.push('|---|-----|-------|--------|----------|--------|---------|');
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

  PT.export = { markdown: markdown, hasArtifact: hasArtifact, source: source, span: span };
})();
