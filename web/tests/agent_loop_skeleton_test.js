/* agent_loop_skeleton_test — THE EIGHT CRITERIA, WRITTEN BEFORE THE LOOP (ADR-0048 §196).
 *
 * The rule this lands: write the criteria first, then the code that turns them green. Measured in
 * this repo, every red came from a criterion that existed BEFORE the code was wrong, and all four
 * "committed with a red" incidents were笔 where the criterion was written afterwards.
 *
 * BUT (a distinction the review document did not need to make and this repo does): a criterion that
 * is red because the code does not exist is not the same failure as a criterion that is red and
 * unattributed. The first is a DECLARATION ("not implemented"); the second is the disease. So each
 * skeleton below is registered with one of two homes:
 *   · 'live'      — a criterion that already exists and already guards this claim (no second truth)
 *   · 'absent'    — declared absent, carrying the EXACT assertion it will make and the mutation
 *                   that must be able to break it
 * and this suite asserts that EVERY claim has a home, that an 'absent' home carries both an
 * assertion and a mutation, and that a 'live' home really names an existing suite.
 */
const fs = require('fs'), path = require('path');
const HERE = __dirname;

const CLAIMS = [
  { id: 1, claim: '步数 == DAG 新增节点数（不造第二套历史）',
    home: 'live', suite: 'usage_by_turn_test.js',
    note: '每个 turn 的节点数与 DAG 一致；Loop 的多步必须落在已有 DAG 上，判据形状已由 per-turn 归属证明' },
  { id: 2, claim: '重试 == 新分支（新 child），旧节点不可变',
    home: 'absent',
    assertion: '同一 attempt 第二次 ⇒ 新 period 的 parent 指向旧 period；旧 period 的字节不变（hash 相同）',
    mutation: '把"重试"实现成覆盖旧 period ⇒ 必须红' },
  { id: 3, claim: 'Σ(每步实测) == 周期总量（可加事实自检）',
    home: 'live', suite: 'usage_by_model_test.js',
    note: '已落：Σ(按模型) == period 且 Σ(步级) == period（§183/§189/§190）' },
  { id: 4, claim: '超预算 ⇒ 声明式停止 + reason（不是静默截断）',
    home: 'absent',
    assertion: '一步的实测费用 > 该步声明的预算 ⇒ 运行以 reason=budget-exceeded 停止，且该 reason 出现在 /v1/events 与面板',
    mutation: '把超预算改成静默继续 ⇒ 必须红' },
  { id: 5, claim: '每步预算是一等输入（入口），不是事后统计',
    home: 'absent',
    assertion: '调用方在发起该步之前声明 {maxTokens,maxCost,tier}；未声明 ⇒ 抛（rule ⑩），而不是用缺省',
    mutation: '让预算缺省生效 ⇒ 必须红（"没声明"必须与"声明为零"可分辨）' },
  { id: 6, claim: '重放 ⇒ 零副作用（工具调用数不变、费用不变）',
    home: 'absent',
    assertion: '重放一条已完成路径：工具调用计数与费用计数逐项不变（Saga 的语义逆 / Event Sourcing 的 replay 告诫）',
    mutation: '让重放走执行路径 ⇒ 必须红（重放 10 次 ⇒ 扣 10 次费）' },
  { id: 7, claim: '循环检测 ⇒ 声明（不是静默无限）',
    home: 'live', suite: 'walk_state_test.js',
    note: '已落：lineage walk 的四态里 kind="cycle" 是一个具名终局（§185）；Loop 的循环检测必须复用这个形状' },
  { id: 8, claim: '步序 = 拓扑序 ⊕ 组内序（不得由时间戳派生）',
    home: 'live', suite: 'usage_by_turn_test.js',
    note: '已落：stepModels 按 (turn, ord, lineNo) 稳定排序；order_contract_test 守住"顺序是结构的，不是时间的"' }
];

let bad = 0;
const ok = (c, m) => { console.log((c ? '  ok   ' : '  FAIL ') + m); if (!c) bad++; };
const exists = (f) => fs.existsSync(path.join(HERE, f));

ok(CLAIMS.length === 8, 'the eight criteria are registered (' + CLAIMS.length + ')');
const seen = {};
CLAIMS.forEach((c) => {
  seen[c.id] = true;
  if (c.home === 'live') {
    ok(exists(c.suite), 'claim ' + c.id + ': its live home EXISTS (' + c.suite + ') — ' + c.claim);
  } else {
    ok(typeof c.assertion === 'string' && c.assertion.length > 20,
      'claim ' + c.id + ': DECLARED ABSENT **with the exact assertion it will make** — ' + c.claim);
    ok(typeof c.mutation === 'string' && c.mutation.length > 5,
      'claim ' + c.id + ': and with the mutation that must be able to break it — ' + c.mutation);
  }
});
ok(Object.keys(seen).length === 8, 'no claim is missing and none is duplicated');

/* The registry itself must be able to fail: removing a home must be visible. */
const noHome = CLAIMS.filter((c) => c.home !== 'live' && c.home !== 'absent');
ok(noHome.length === 0, 'MUTATION scope: a claim with no home (neither live nor absent) would be caught');

/* And it must state — for every claim — what a red MEANS (the §195.4 lesson: a red must name its
 * cause; a silent 0/false that merges several causes is the disease this repo keeps meeting). */
const NAMED = {
  1: '红 = 步数与 DAG 节点数不符（要么造了第二套历史，要么漏记节点）',
  2: '红 = 重试覆盖了旧节点（历史被改写，而不是长出新枝）',
  3: '红 = 分项之和 != 总量（有计量被丢或被重复计）',
  4: '红 = 超预算没有声明（钱花了而没有 reason）',
  5: '红 = 预算来自缺省（"没声明"与"声明为零"不可分辨）',
  6: '红 = 重放有副作用（费用或工具调用被执行了第二次）',
  7: '红 = 循环静默（没有终局名字，只有无限）',
  8: '红 = 顺序由时间戳派生（因果序丢失）'
};
ok(Object.keys(NAMED).length === 8, 'every claim names what its RED means (not just pass/fail)');
CLAIMS.forEach((c) => {
  ok(typeof NAMED[c.id] === 'string' && NAMED[c.id].indexOf('红') === 0,
    'claim ' + c.id + ' red-meaning: ' + NAMED[c.id]);
});

console.log(bad === 0
  ? 'OK — 8 criteria for a Loop that does not exist yet: 4 already have live homes, 4 are declared absent with their assertion and mutation'
  : 'FAILED — ' + bad + ' check(s) red');
process.exit(bad ? 1 : 0);
