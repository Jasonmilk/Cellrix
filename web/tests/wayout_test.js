#!/usr/bin/env node
/* The exit layer's own net (Cellrix:ADR-0044 §4).
 *
 * Scope, stated honestly: this suite covers THE RESOLVER. The site migration
 * (12 dead-end errors, the missing zero state in #eTbody) is P1b/P1c, and its
 * assertions — "no asset hand-writes a failure string", "every code is reachable
 * from a site" — belong to those steps, because until they land those strings
 * legitimately exist. Writing them now would mean shipping a red or a fudged
 * test, and a check nobody can trust is worse than no check.
 *
 * What CAN be settled today is settled today, and settled against the shipped
 * vocabulary rather than against a copy of it:
 *
 *   * the vocabulary is internally consistent (every code: valid kind, text,
 *     a surface, and an action WHEN the kind demands one)
 *   * the resolver is total — it never throws, whatever it is handed
 *   * a caller's run() is carried through and its label wins
 *   * render() produces a real <button> (keyboard-reachable), keeps the raw
 *     exception OUT of the sentence and behind a disclosure, and returns null
 *     instead of throwing when there is nowhere to render
 *   * the audit itself is not vacuous: it is a pure function, and a synthetic
 *     vocabulary that violates each rule MUST be reported
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ASSET = path.join(__dirname, '..', 'assets', 'wayout.js');

let pass = 0, fail = 0;
function check(label, cond, detail) {
  const tail = detail ? '  [' + detail + ']' : '';
  if (cond) { pass++; console.log('  PASS  ' + label + tail); }
  else { fail++; console.log('  FAIL  ' + label + tail); }
}

/* Load the real asset the way the page does: an IIFE that hangs its interface
 * on `window`. No copy of the vocabulary lives in this file — a second copy is
 * the thing this whole ecosystem keeps removing. */
function loadAsset() {
  const src = fs.readFileSync(ASSET, 'utf8');
  const prev = global.window;
  global.window = {};
  try { (0, eval)(src); return global.window.CxWayout; }
  finally { global.window = prev; }
}

/* ── the audit, as a pure function so it can audit a fake too ──────────────
 * Returns violations. `surfaceEq` is the list of surfaces a caller expects to
 * be covered; an empty list means "do not check coverage". */
function auditResolver(R, surfaces) {
  const bad = { kind: [], text: [], surface: [], action: [], missing: [], coverage: [] };
  let codes = [];
  try { codes = R.codes(); } catch (e) { bad.missing.push('codes() threw: ' + e.message); return bad; }
  if (!codes.length) bad.missing.push('the vocabulary is empty');
  const seen = {};
  for (const code of codes) {
    let r;
    try { r = R.resolve(code); } catch (e) { bad.missing.push(code + ' threw: ' + e.message); continue; }
    if (!r || r.known !== true) { bad.missing.push(code + ' does not resolve as known'); continue; }
    if (!R.KINDS[r.kind]) bad.kind.push(code + ' → ' + r.kind);
    if (typeof r.text !== 'string' || !r.text.trim()) bad.text.push(code);
    if (typeof r.surface !== 'string' || !r.surface.trim()) bad.surface.push(code);
    else seen[r.surface] = true;
    /* An error must never be a dead end. A loading or empty state may be
     * action-less: waiting is itself a legitimate answer.
     *
     * Reported ONCE per code. The first version checked the action in two
     * places and reported a malformed one twice; the self-test below caught
     * that, which is what it is for. */
    if (r.action) {
      if (!r.action.label || !R.ACTION_KINDS[r.action.kind]) {
        bad.action.push(code + ' has a malformed action: ' + JSON.stringify(r.action));
      }
    } else if (r.kind === 'error') {
      bad.action.push(code + ' is an error with no exit');
    }
  }
  for (const s of (surfaces || [])) if (!seen[s]) bad.coverage.push(s);
  return bad;
}

const flat = (bad) => Object.keys(bad).reduce((a, k) => a.concat(bad[k]), []);

console.log('wayout — the exit layer resolves state to (sentence, action)');

/* ── 1. the audit is not vacuous ──────────────────────────────────────────── */
{
  const KINDS = { empty: 1, loading: 1, error: 1, blocked: 1 };
  const ACTION_KINDS = { retry: 1, focus: 1, open: 1, command: 1, 'switch-view': 1 };
  const fake = (entries) => ({
    KINDS, ACTION_KINDS,
    codes: () => Object.keys(entries),
    resolve: (c) => entries[c]
  });
  const good = fake({
    'ok-code': { known: true, kind: 'error', text: 'x', surface: 'v',
                 action: { label: 'l', kind: 'retry' } }
  });
  check('a clean synthetic vocabulary reports nothing',
    flat(auditResolver(good, ['v'])).length === 0, JSON.stringify(flat(auditResolver(good, ['v']))));
  check('an error with no exit is caught',
    auditResolver(fake({ 'e': { known: true, kind: 'error', text: 'x', surface: 'v', action: null } }), [])
      .action.length === 1);
  check('an invalid kind is caught',
    auditResolver(fake({ 'e': { known: true, kind: 'meh', text: 'x', surface: 'v' } }), []).kind.length === 1);
  check('empty text is caught',
    auditResolver(fake({ 'e': { known: true, kind: 'empty', text: '  ', surface: 'v' } }), []).text.length === 1);
  check('a code with no surface is caught',
    auditResolver(fake({ 'e': { known: true, kind: 'empty', text: 'x', surface: null } }), []).surface.length === 1);
  check('a surface with no exit at all is caught',
    auditResolver(good, ['v', 'uncovered']).coverage.length === 1);
  check('a malformed action kind is caught',
    auditResolver(fake({ 'e': { known: true, kind: 'error', text: 'x', surface: 'v',
                                action: { label: 'l', kind: 'nope' } } }), []).action.length === 1);
}

/* ── 2. the shipped vocabulary ────────────────────────────────────────────── */
const W = loadAsset();
check('the asset publishes its interface', !!W && typeof W.resolve === 'function');
if (!W) {
  console.log('');
  console.log('FAILED — the asset did not load');
  process.exit(1);
}
/* The six surfaces the panel actually has. Derived from base.html's nav plus
 * the shared period list and the shell — not a count of anything. */
const SURFACES = ['shell', 'sessions', 'chat', 'prove-track', 'flows', 'cockpit'];
{
  const bad = auditResolver(W, SURFACES);
  check('every registered code is consistent (kind · text · surface · action)',
    flat(bad).length === 0, flat(bad).join(' | '));
  check('every error carries an exit', bad.action.length === 0, bad.action.join(' | '));
  const missing = bad.coverage;
  check('every surface has at least one exit', missing.length === 0, missing.join(', '));
  console.log('        vocabulary: ' + W.codes().length + ' codes over ' + SURFACES.length + ' surfaces');
}

/* ── 3. totality: never throws, whatever it is handed ─────────────────────── */
{
  const junk = [null, undefined, '', 0, 42, [], {}, true, 'no-such-code',
    { code: 'no-such-code' }, { code: 123 }, { code: 'send-failed', detail: null },
    { code: 'send-failed', action: 'not-an-object' }, Object.create(null)];
  let threw = null, noText = [];
  for (const j of junk) {
    let r;
    try { r = W.resolve(j); }
    catch (e) { threw = JSON.stringify(j) + ' → ' + e.message; break; }
    if (!r || typeof r.text !== 'string' || !r.text.trim()) noText.push(JSON.stringify(j));
  }
  check('resolve is total — no input makes it throw', threw === null, threw || '');
  check('resolve always returns a sentence', noText.length === 0, noText.join(', '));
  const unknown = W.resolve({ code: 'no-such-code', detail: 'boom' });
  check('an unregistered code is flagged rather than guessed',
    unknown.unclassified === true && unknown.known === false, JSON.stringify(unknown.kind));
  check('an unregistered code keeps the raw detail instead of dropping it',
    unknown.detail === 'boom');
  check('a registered code is NOT flagged unclassified', W.resolve('send-failed').unclassified === false);
}

/* ── 4. the caller keeps the capability, the vocabulary keeps the words ───── */
{
  let ran = 0;
  const r = W.resolve({ code: 'trajectory-load-failed', detail: 'ECONNREFUSED',
                        action: { run: () => { ran++; } } });
  check('the vocabulary supplies the label', r.action && r.action.label === '重新载入',
    r.action && r.action.label);
  check('the caller supplies the capability', typeof r.action.run === 'function');
  r.action.run();
  check('the capability is the caller\'s own function', ran === 1, 'ran=' + ran);
  const overridden = W.resolve({ code: 'send-failed', action: { label: '我的说法', run: () => {} } });
  check('a caller may override the label', overridden.action.label === '我的说法',
    overridden.action.label);
}

/* ── 5. render: a real button, the raw error behind a disclosure ──────────── */
{
  const dom = new JSDOM('<!doctype html><html><body><div id="host"></div></body></html>');
  const doc = dom.window.document;
  const host = doc.getElementById('host');

  let ran = 0;
  const box = W.render(host, { code: 'trajectory-load-failed', detail: 'TypeError: boom',
                               action: { run: () => { ran++; } } });
  check('render builds a block', !!box && !!box.id === false && box.parentNode === host);
  const btn = host.querySelector('button[data-wo-act]');
  check('an error renders a real <button> (keyboard-reachable)', !!btn,
    btn ? 'tag=' + btn.tagName : 'no button');
  check('the button carries the vocabulary\'s label', !!btn && btn.textContent === '重新载入',
    btn && btn.textContent);
  if (btn) btn.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  check('clicking it runs the caller\'s capability', ran === 1, 'ran=' + ran);

  /* D3: the exception is kept, not pasted into the sentence. */
  const sentence = host.querySelector('p').textContent;
  check('the raw exception is NOT in the sentence', sentence.indexOf('boom') < 0, sentence.slice(0, 60));
  const det = host.querySelector('details');
  check('the raw exception is kept behind a disclosure',
    !!det && det.querySelector('pre').textContent === 'TypeError: boom');

  /* A loading state has no exit, and must then render no button. */
  W.render(host, 'trajectory-loading');
  check('a loading state renders no button',
    host.querySelector('button') === null && host.querySelector('p').textContent.length > 0,
    host.querySelector('p').textContent);

  check('render returns null instead of throwing with nowhere to render', W.render(null, 'chat-empty') === null);
  check('render survives a garbage state', !!W.render(host, { code: 'nope', detail: 'x' }));
  check('render replaces previous content rather than stacking it',
    host.querySelectorAll('p').length === 1, host.querySelectorAll('p').length + ' <p>');

  /* ── build: each surface keeps its own wrapper ────────────────────────────
   * `.empty` is a wide centred block and `.fl-empty` is a plain centred line.
   * Imposing either on the other would be a visual change smuggled inside a
   * refactor, so the wrapper is the caller's to choose. */
  const made = W.build('chat-empty', { document: doc });
  check('build makes a block without a host', !!made && made.tagName === 'DIV');
  check('the default wrapper is the repo\'s established block', !!made && made.className === 'empty',
    made && made.className);
  const custom = W.build('flows-fetch-failed', { document: doc, className: 'fl-empty' });
  check('a surface may keep its own wrapper class', !!custom && custom.className === 'fl-empty',
    custom && custom.className);
  check('build needs a document and says so instead of throwing',
    W.build('chat-empty') === null && W.build('chat-empty', {}) === null);
  W.render(host, 'chat-empty', { className: 'fl-empty' });
  check('render forwards the wrapper choice',
    host.firstChild.className === 'fl-empty', host.firstChild.className);

  /* ── `auto`: the exit is time, not a click ────────────────────────────────
   * The shell already retries on its own timer. A button there would package
   * "this is being handled" as "you must press something", and would put a
   * control on a surface whose only job is to report state. */
  W.render(host, 'snapshot-fetch-failed');
  check('an `auto` exit renders as a note, not a button',
    host.querySelector('button') === null &&
      host.querySelector('[data-wo-act="auto"]') !== null,
    host.querySelector('div').textContent.trim());
  check('the note says what will happen', /自动重试/.test(host.textContent), host.textContent.trim());
  check('an `auto` state is still an error with an exit',
    W.resolve('snapshot-fetch-failed').kind === 'error' &&
      !!W.resolve('snapshot-fetch-failed').action, JSON.stringify(W.resolve('snapshot-fetch-failed').action));

  /* ── a button the layer cannot honour is a lie ────────────────────────────
   * The vocabulary carries words for exits whose capability belongs to the
   * surface (a command to type, a flag to pass). When no function came with
   * them, rendering a button would be a CONTROL THAT DOES NOTHING. Measured:
   * this is how removing a site's action still left a button behind — the
   * mutation proved the check was too weak, and this is the fix it forced. */
  W.render(host, 'providers-empty');
  check('an exit with no capability renders as a note, not a button',
    host.querySelector('button') === null &&
      host.querySelector('[data-wo-act="note"]') !== null,
    host.querySelector('div').textContent.trim());
  check('that note still names the way out',
    /flowmodus supplier add/.test(host.textContent), host.textContent.trim());

  /* ── renderInline: no wrapper, the surface's own layout is the box ──────── */
  const line = doc.createElement('div');
  line.className = 'sub';
  W.renderInline(line, { code: 'ecosystem-unavailable' });
  check('inline render adds no block wrapper', line.querySelector('div') === null,
    line.innerHTML.slice(0, 60));
  check('inline render still marks the state', !!line.firstChild.getAttribute('data-wo-kind'),
    line.firstChild.getAttribute('data-wo-kind'));
  check('inline render keeps the sentence', /生态探测不可用/.test(line.textContent), line.textContent.trim());
  W.renderInline(line, { code: 'no-snapshot', action: { run: () => { ran++; } } });
  const ib = line.querySelector('button');
  check('an inline exit that IS a click renders a button', !!ib, ib ? ib.textContent : 'none');
  if (ib) ib.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  check('the inline button runs the caller\'s capability', ran === 2, 'ran=' + ran);
  check('renderInline returns null with nowhere to render', W.renderInline(null, 'chat-empty') === null);
  dom.window.close();
}

console.log('');
console.log((fail ? 'FAILED' : 'OK') + ' — ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
