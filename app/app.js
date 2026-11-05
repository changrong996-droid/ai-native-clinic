import { score } from "../engine/engine.js";
import { runGolden } from "../tests/run.js";

const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const DAY = 86400000;
const fmt = (t) => { const d = new Date(t); return `${d.getMonth() + 1}月${d.getDate()}日`; };
const uid = () => Math.random().toString(36).slice(2, 9);

const SKILLS = {}, ROLES = {};
const KEY = "anc-v2";
let db, view = "value", sel = null, pf = null;

/* ---------- 时间线（每人一条只追加的事件流） ---------- */
function save() { localStorage.setItem(KEY, JSON.stringify(db)); }
function addEvent(e) { db.events.push({ id: uid(), t: Date.now(), ...e }); save(); }
function eventsOf(pid) { return db.events.filter((e) => e.pid === pid).sort((a, b) => a.t - b.t); }
function assessments(pid, skill) { return eventsOf(pid).filter((e) => e.type === "assessment" && (!skill || e.skill === skill)); }

function record(pid, skillId, answers, t = Date.now()) {
  const r = score(SKILLS[skillId], answers);
  const ev = { id: uid(), pid, t, type: "assessment", skill: skillId, answers, result: r, signed: false };
  db.events.push(ev);
  for (const f of r.followups) db.tasks.push({ id: uid(), pid, due: t + f.after_days * DAY, action: f.action, staff: !!f.staff, from: ev.id, done: false });
  return ev;
}

function menqolAns(map) { const a = {}; for (let i = 1; i <= 29; i++) a["m" + i] = "no"; return Object.assign(a, map); }
function seed() {
  db = { patients: [
    { id: "p1", name: "王女士", age: 52, dept: "更年期门诊" },
    { id: "p2", name: "李女士", age: 48, dept: "更年期门诊" },
    { id: "p3", name: "张女士", age: 55, dept: "更年期门诊" },
    { id: "p4", name: "刘女士", age: 31, dept: "产科（孕产保健）", deliveryDate: Date.now() - 41 * DAY, dueDate: Date.now() - 42 * DAY },
    { id: "p5", name: "陈女士", age: 29, dept: "产科（孕产保健）", deliveryDate: Date.now() - 43 * DAY, dueDate: Date.now() - 45 * DAY } ], events: [], tasks: [] };
  for (const p of db.patients) p.role = p.dept.startsWith("产科") ? "obstetrics" : "menopause";
  const now = Date.now();
  record("p1", "menqol", menqolAns({ m1: 5, m2: 5, m3: 4, m4: 2, m5: 3, m8: 2, m13: 3, m14: 4, m16: 2, m27: 1, m28: 2 }), now - 92 * DAY);
  db.events.at(-1).signed = true;
  db.tasks.forEach((t) => (t.done = true));
  record("p1", "menqol", menqolAns({ m1: 3, m2: 2, m3: 2, m4: 4, m5: 4, m6: 3, m7: 4, m8: 4, m9: 3, m10: 3, m13: 3, m14: 5, m16: 2, m27: 1, m28: 2 }), now - 2 * 3600000);
  record("p2", "phq9", { q1: 2, q2: 2, q3: 1, q4: 2, q5: 1, q6: 2, q7: 1, q8: 1, q9: 1 }, now - 40 * 60000);
  record("p3", "menqol", menqolAns({ m1: 1, m2: 0, m14: 2, m19: 1, m27: "na", m28: "na", m29: "na" }), now - 30 * DAY);
  db.events.at(-1).signed = true;
  for (const p of db.patients) scheduleTasks(p);
  // 刘女士：孕晚期筛查已做（8 分），产后 42 天筛查两天后到期
  record("p4", "epds", { e1: 1, e2: 1, e3: 2, e4: 2, e5: 1, e6: 1, e7: 0, e8: 0, e9: 0, e10: 0 }, now - 80 * DAY);
  db.events.at(-1).signed = true;
  db.tasks.filter((t) => t.pid === "p4" && t.action.startsWith("孕晚期")).forEach((t) => (t.done = true));
  // 陈女士：今天完成产后 42 天筛查，14 分
  record("p5", "epds", { e1: 2, e2: 2, e3: 2, e4: 2, e5: 1, e6: 2, e7: 1, e8: 1, e9: 1, e10: 0 }, now - 3 * 3600000);
  db.tasks.filter((t) => t.pid === "p5" && t.action.includes("EPDS 筛查")).forEach((t) => (t.done = true));
  save();
}
// 角色文件里的时间表：按预产期、分娩日等锚点自动生成随访任务
function scheduleTasks(p) {
  for (const s of ROLES[p.role].schedule || []) {
    if (!p[s.anchor]) continue;
    db.tasks.push({ id: uid(), pid: p.id, due: p[s.anchor] + s.offset_days * DAY, action: s.action, from: "schedule", done: false });
  }
}

/* ---------- 语言层：简报（模板版；可选接入模型改写） ---------- */
function facts(pid) {
  const p = db.patients.find((x) => x.id === pid);
  const out = { 患者: `${p.name}，${p.age} 岁，${p.dept}`, 量表: [] };
  if (p.deliveryDate) out.阶段 = `产后第 ${Math.floor((Date.now() - p.deliveryDate) / DAY)} 天`;
  for (const sk of Object.keys(SKILLS)) {
    const list = assessments(pid, sk);
    if (!list.length) continue;
    const cur = list.at(-1), prev = list.at(-2);
    const f = { 名称: SKILLS[sk].name, 日期: fmt(cur.t), 总分: cur.result.total, 分级: cur.result.band.label, 危机: cur.result.crisis };
    if (cur.result.domains) f.维度 = cur.result.domains.map((d) => `${d.name} ${d.score ?? "不适用"}${d.band ? "（" + d.band.label + "）" : ""}`);
    if (prev) {
      f.上次 = { 日期: fmt(prev.t), 总分: prev.result.total, 分级: prev.result.band.label };
      if (cur.result.domains && prev.result.domains) f.维度变化 = cur.result.domains.map((d, i) => {
        const o = prev.result.domains[i]; if (d.score == null || o.score == null) return null;
        const dv = Math.round((d.score - o.score) * 100) / 100; return Math.abs(dv) >= 0.5 ? `${d.name} ${o.score}→${d.score}` : null; }).filter(Boolean);
    }
    out.量表.push(f);
  }
  out.待办 = db.tasks.filter((t) => t.pid === pid && !t.done).map((t) => `${t.action}（${t.due <= Date.now() ? "今天" : fmt(t.due)}）`);
  return out;
}
function templateBrief(pid) {
  const F = facts(pid), s = [];
  if (F.阶段) s.push(`${F.阶段}。`);
  const crisis = F.量表.find((q) => q.危机);
  if (crisis) s.push(`⚠️ ${crisis.日期}${crisis.名称.split(" ")[0]} 自伤题阳性，提示有自伤念头，需今天人工评估。`);
  for (const q of F.量表) {
    const short = q.名称.split(" ")[0];
    let line = `${short}：${q.日期}总分 ${q.总分}（${q.分级}）`;
    if (q.上次) line += `，${q.上次.日期}为 ${q.上次.总分}（${q.上次.分级}）`;
    if (q.维度变化 && q.维度变化.length) line += `；变化较大的维度：${q.维度变化.join("，")}`;
    s.push(line + "。");
  }
  if (F.待办.length) s.push(`待办：${F.待办.join("；")}。`);
  return s;
}
async function modelBrief(pid) {
  const c = JSON.parse(localStorage.getItem("anc-model") || "{}");
  const res = await fetch(c.base.replace(/\/$/, "") + "/chat/completions", {
    method: "POST", headers: { "Content-Type": "application/json", ...(c.key ? { Authorization: "Bearer " + c.key } : {}) },
    body: JSON.stringify({ model: c.model, temperature: 0.2, messages: [
      { role: "system", content: "你是医生的诊前简报助手。只能使用用户给出的事实 JSON，不得增加任何数字、诊断或治疗建议。用中文写 3 句以内，危机信息放第一句。" },
      { role: "user", content: JSON.stringify(facts(pid)) } ] }) });
  const j = await res.json();
  return j.choices[0].message.content;
}

/* ---------- 视图 ---------- */
function render() {
  document.querySelectorAll("#nav button").forEach((b) => b.classList.toggle("on", b.dataset.view === view));
  ({ value, ai, board, concept, patient, doctor, skills, confirm })[view]();
}

/* ---------- 说明层：写给医生、科主任、信息科看 ---------- */
const EXPLAIN = {
  patient: {
    title: "这一页：患者怎么填问卷",
    check: [
      "患者用手机扫码就能填，不用装 App，一屏一题，老人能不能顺利填完？",
      "题目一字不改，保证量表本身的有效性；看不懂可以点“这题是什么意思”。",
      "自伤题只要不是“完全没有”，就不显示分数，改为显示求助信息，同时通知医生。",
      "患者只看到通俗解读和生活建议，用药类建议只有医生能看到。",
    ],
    confirm: ["危机时患者看到的话和电话号码（现在用全国心理援助热线 12356）", "患者看到的解读文字是否合适", "患者怎么进入：扫码后是否需要手机号或就诊卡核验"],
    try: "选“王女士”，做 PHQ-9：前 8 题选“完全不会”，第 9 题选“好几天”。",
  },
  doctor: {
    title: "这一页：医生打开电脑看到什么",
    check: [
      "不用点进一个个报告：今天谁最要紧，系统已经排好序，危机排第一。",
      "每个病人有一段诊前简报，写清楚这次和上次比哪里变了、还有什么没做。",
      "简报里的每个数字都来自固定计算，不是 AI 编的；接入 AI 后它只负责把话说顺。",
      "结果要医生点“审阅并签字”才算数；随访任务由规则自动生成，做完勾掉。",
      "上方可切换科室：更年期门诊和产科共用同一套底座。",
    ],
    confirm: ["签字的含义：审阅即可，还是需要电子签名", "危机提醒发给谁、多长时间内要处理", "随访由谁执行：系统提醒患者，还是护士打电话"],
    try: "依次点王女士、李女士，再切到“产科”看陈女士；点“主任问一句”里的问题。",
  },
  skills: {
    title: "这一页：规则写在哪、怎么保证不出错",
    check: [
      "每个量表的题目、算分、分级、危机规则、随访规则，都写在一个文件里，医生可以逐条审。",
      "每个科室也是一个文件：用哪些量表、什么时间点随访。产科就是这样加进来的，程序没改。",
      "左边的“黄金用例”是一组标准答案。规则每改一次，系统都会自动核对一遍，全部通过才允许上线。",
    ],
    confirm: ["各量表的分级区间和措辞", "EPDS 用哪个中文版本、阈值是否用 10 分和 13 分", "产科筛查时间点"],
    try: "点 menqol 看更年期量表的全部规则，再点“角色：产科”看科室文件有多短。",
  },
};
const seen = (window.__seen = {});
function explain(k) {
  const e = EXPLAIN[k];
  return `<details class="card explain" ${seen[k] ? "" : "open"} ontoggle="window.__seen&&(window.__seen['${k}']=1)"><summary><span class="tag amber">说明</span><b>${e.title}</b><span class="small muted">（点击展开/收起）</span></summary>
    <h3>这里想验证什么</h3><ul>${e.check.map((x) => `<li>${x}</li>`).join("")}</ul>
    <h3>需要医院拍板的</h3><ul>${e.confirm.map((x) => `<li>${x}</li>`).join("")}</ul>
    <p class="small"><b>试一下：</b>${e.try}</p>
    <p class="small muted">上线前需要确认的事项汇总在“上线前确认”页。</p></details>`;
}

function concept() {
  $("#main").innerHTML = `
  <p class="tag gray">原理 · 给技术与信息科</p>
  <h1>原理：为什么七个科室能共用一套</h1>
  <p class="lead">这是一个可以点的样品，用来和医院一起确认“系统该长什么样”。数据全部是虚构的，量表文字和分级都还是草案。请重点看思路和流程，界面和细节后面都可以改。</p>

  <div class="grid g3" style="margin-top:20px">
    <div class="card"><h3>它是什么</h3><p class="small">一个“量表测评 + 结果解读 + 医生审阅 + 随访提醒”的轻量系统。现在做了更年期门诊和产科两个科室。</p></div>
    <div class="card"><h3>它不是什么</h3><p class="small">不是 HIS，也不替代医生诊断。当前不连医院现有系统，不存真实病人数据。</p></div>
    <div class="card"><h3>为什么这样做</h3><p class="small">七个健康管理系统的核心流程其实一样：填表、算分、出报告、医生看、定期随访。把这条流程做好，七个科室都能复用。</p></div>
  </div>

  <h2 style="margin-top:28px">一个病人在系统里走一遍</h2>
  <div class="flow">
    <div class="card"><b>1 扫码填表</b><p class="small">患者手机上一题一屏，不懂可以问。</p></div><div class="arrow">→</div>
    <div class="card"><b>2 自动算分</b><p class="small">按量表规则计算，结果固定、可核对。</p></div><div class="arrow">→</div>
    <div class="card"><b>3 风险分流</b><p class="small">有自伤念头立即转人工，不等报告。</p></div><div class="arrow">→</div>
    <div class="card"><b>4 医生审阅</b><p class="small">打开就是简报和前后对比，确认后签字。</p></div><div class="arrow">→</div>
    <div class="card"><b>5 随访</b><p class="small">按规则和时间点自动提醒复测。</p></div>
  </div>

  <h2 style="margin-top:28px">AI 在这里做什么、不做什么</h2>
  <div class="grid g3">
    <div class="card"><span class="tag">固定规则 · 程序</span><p class="small">算分、分级、危机判断、随访时间。同样的答案永远得到同样的结果，每次修改都要通过一组标准答案的核对。</p></div>
    <div class="card"><span class="tag amber">AI · 只管说话</span><p class="small">给患者解释题目，帮医生把结果写成简报，回答主任的统计问题。它只能引用程序算出的结果，不能自己下结论。</p></div>
    <div class="card"><span class="tag gray">医生 · 最后把关</span><p class="small">任何临床意见都要医生确认签字才生效。当前演示没有接 AI，用模板代替，流程不受影响。</p></div>
  </div>

  <h2 style="margin-top:28px">怎么加新科室</h2>
  <div class="card"><p>每个科室是一个很短的配置文件，写明用哪些量表、什么时间随访；每个量表也是一个文件。产科就是这样加进来的：新增两个文件，程序一行没改。其余五个科室（儿童心理、营养、妇女保健、精神等）也按同样方式添加。</p></div>

  <h2 style="margin-top:28px">建议这样看（约 3 分钟）</h2>
  <div class="card"><ol>
    <li><b>医生端</b>：李女士因危机排在第一。点王女士，看诊前简报：潮热明显好转，情绪维度加重，系统已经安排了“加做 PHQ-9”。</li>
    <li><b>患者端</b>：用王女士的身份做 PHQ-9，前 8 题选“完全不会”，第 9 题选“好几天”。按原来的文档，这会判为“情绪良好”；这里会立即转入危机流程。</li>
    <li>回到<b>医生端</b>：王女士已经排到最前面。再切到“产科”，看陈女士产后 42 天的筛查结果。</li>
    <li><b>规则与测试</b>：看规则文件长什么样，25 条标准答案当场核对。</li>
    <li><b>上线前确认</b>：正式上线前需要定下来的事。</li>
  </ol></div>`;
}

/* 待确认清单 */
const CONFIRM = [
  ["量表与规则", "PHQ-9 第 9 题、EPDS 第 10 题只要不是 0 分，就转入危机流程", "自伤念头不能等报告；原文档没有这条规则", "心理科 / 医务科"],
  ["量表与规则", "医院是否有危机干预预案？由谁接手，多长时间内处理？", "系统只负责提醒，后续必须有人处理", "医务科"],
  ["量表与规则", "危机时给患者看的热线：12356，还是本院电话？", "目前暂用全国统一心理援助热线 12356", "心理科"],
  ["量表与规则", "MENQOL 分级改为连续区间：1 / 1–4 / 4–6 / 6–8", "原文档按整数分档，1.33 这类得分落不进任何一档", "更年期门诊"],
  ["量表与规则", "MENQOL 性生活维度增加“不适用”，总分按其余三个维度计算", "没有性生活的患者，否则总分会被拉低", "更年期门诊"],
  ["量表与规则", "激素治疗、雌激素等用药建议只给医生看", "患者端只显示生活方式建议", "更年期门诊"],
  ["量表与规则", "PHQ-9 结果措辞用“抑郁症状”，而不是“抑郁症”", "自评量表不能作为诊断", "心理科"],
  ["量表与规则", "EPDS 采用哪个中文版本？阈值用 10 分、13 分，还是本院标准？", "医院资料中没有这份量表，由原型补充", "产科 / 心理科"],
  ["流程", "产科筛查时间点：孕晚期一次、产后 42 天一次，是否合适？", "原型的假设", "产科"],
  ["流程", "随访由谁执行：系统提醒患者自己复测，还是护士打电话？", "影响是否需要护士工作台", "各科室"],
  ["流程", "医生“签字”是审阅确认，还是需要正式电子签名？", "电子签名涉及 CA 和合规", "医务科 / 信息科"],
  ["接入与数据", "患者如何识别身份：手机号、就诊卡，还是对接 HIS？", "决定是否需要和医院现有系统对接", "信息科"],
  ["接入与数据", "数据放在哪里：院内服务器还是云上？", "决定部署方式", "信息科"],
  ["接入与数据", "是否允许使用 AI 模型？只能用院内部署的模型，还是可以调用外部服务？", "不接 AI 也能运行；接入后只用于把话说顺", "信息科 / 院办"],
  ["范围", "七个科室先上哪几个？", "建议先做 1 到 2 个，跑通后再复制", "院方 / 业务对接人"],
];
function confirm() {
  $("#main").innerHTML = `<p class="tag amber">上线前确认</p><h1>真正上线前，需要医院定下来的事</h1>
  <p class="lead">试用阶段可以先按默认做法跑起来；以下事项在正式上线前逐条确认即可，不影响先看效果。</p>
  <div class="card" style="margin-top:16px"><table><tr><th>#</th><th>类别</th><th>需要确认</th><th>为什么要问</th><th>建议由谁确认</th></tr>
  ${CONFIRM.map((c, i) => `<tr><td>${i + 1}</td><td class="small muted">${c[0]}</td><td>${c[1]}</td><td class="small">${c[2]}</td><td class="small muted">${c[3]}</td></tr>`).join("")}</table></div>`;
}

/* ---------- 价值页：一眼看出好处 ---------- */
// 医院原始文档的规则，原样写成代码，用来和新系统当场对比
function legacyPHQ(total) {
  const b = [[0, 4, "没有抑郁症状：您的情绪状态良好，在正常范围内"], [5, 9, "轻度抑郁"], [10, 14, "中度抑郁"], [15, 19, "中重度抑郁症"], [20, 27, "重度抑郁"]];
  return b.find(([lo, hi]) => total >= lo && total <= hi)[2];
}
function legacyMENQOL(s) {
  // 原文档：1 分无症状；2-4 分轻度；5-6 分中度；7-8 分重度（整数分档）
  if (s === 1) return "无症状";
  if (s >= 2 && s <= 4) return "轻度";
  if (s >= 5 && s <= 6) return "中度";
  if (s >= 7 && s <= 8) return "重度";
  return "无法判定（不在任何区间）";
}
const ma = (m) => { const a = {}; for (let i = 1; i <= 29; i++) a["m" + i] = "no"; return Object.assign(a, m); };
const CASES = [
  { title: "PHQ-9：前 8 题都选“完全不会”，第 9 题（伤害自己的念头）选“几乎每天”",
    run() { const ans = { q1: 0, q2: 0, q3: 0, q4: 0, q5: 0, q6: 0, q7: 0, q8: 0, q9: 3 }; const r = score(SKILLS.phq9, ans);
      return { old: `总分 3 → “${legacyPHQ(3)}”`, neu: `立即转危机流程，医生端置顶提醒，患者看到 12356 求助热线（系统未显示“情绪良好”）`, risk: "高" }; } },
  { title: "MENQOL：只有潮热，困扰程度 0；其余两项都没有",
    run() { const r = score(SKILLS.menqol, ma({ m1: 0 })); const d = r.domains[0];
      return { old: `血管舒缩维度 ${d.score} 分 → ${legacyMENQOL(d.score)}`, neu: `${d.score} 分 → ${d.band.label}，给出对应建议`, risk: "中" }; } },
  { title: "MENQOL：潮热、盗汗、白天出汗的困扰程度分别为 3、2、2",
    run() { const r = score(SKILLS.menqol, ma({ m1: 3, m2: 2, m3: 2 })); const d = r.domains[0];
      return { old: `血管舒缩维度 ${d.score} 分 → ${legacyMENQOL(d.score)}`, neu: `${d.score} 分 → ${d.band.label}，医生端给出非激素疗法参考`, risk: "中" }; } },
];

function value() {
  const k = cohortKPI();
  $("#main").innerHTML = `
  <h1>把纸质量表换成一张二维码<br>医生少做三件事，科室多出一份数据</h1>
  <p class="lead">不换现有系统，也不改门诊流程。门诊贴一张二维码就能和现有做法并行试用，随时可以停。</p>

  <div class="grid g3 kpis" style="margin-top:20px">
    <div class="card"><div class="big">0 秒</div><p>提交即出分。<br>不用手算，也不用录入。</p></div>
    <div class="card"><div class="big">${CASES.length} 处</div><p>贵院现有量表文档里会判错或判不出的地方，系统自动挡住。<a class="link" href="#check">当场核对 ↓</a></p></div>
    <div class="card"><div class="big">${k.patients} 人</div><p>上线半年，科室自动积累的随访档案（模拟）。<a class="link" data-go="board">看科室看板 →</a></p></div>
  </div>

  <h2 style="margin-top:30px">同一个门诊日，前后对比</h2>
  <div class="card"><table class="cmp">
    <tr><th></th><th>现在的常见做法 <span class="small muted">（以贵院实际为准）</span></th><th>用了之后</th></tr>
    ${[["填表", "纸质表，在诊室或候诊区填写", "候诊时用手机扫码填写，一题一屏"],
       ["算分", "护士或医生手算，查对照表", "提交即出分，规则固定，可以核对"],
       ["存档", "纸张归档，或手工抄进电脑", "自动进入个人档案，按时间排好"],
       ["医生看结果", "翻纸，和上次比较全靠记忆", "打开就是简报：这次和上次比，哪里变了"],
       ["高风险", "看总分；自伤题可能被淹没在总分里", "单题即可触发，立刻置顶提醒"],
       ["复测", "靠患者自己记得回来", "到期自动提醒，未完成的单独列出"],
       ["科室统计", "年底翻纸，或者干脆不统计", "随时看看板，可导出 Excel"]]
      .map(([a, b, c]) => `<tr><td><b>${a}</b></td><td class="muted">${b}</td><td>${c}</td></tr>`).join("")}
  </table></div>

  <h2 id="check" style="margin-top:30px">用贵院自己的量表文档，当场核对</h2>
  <p class="muted">左边按贵院提供的 PHQ-9、MENQOL 文档中的规则原样计算，右边是本系统的结果。点“运行”即可看到。</p>
  <div class="card"><table>
    <tr><th>情形</th><th>按原文档</th><th>本系统</th><th></th></tr>
    ${CASES.map((c, i) => `<tr><td>${c.title}</td><td id="old${i}" class="muted">—</td><td id="neu${i}" class="muted">—</td><td><button class="btn ghost" data-run="${i}">运行</button></td></tr>`).join("")}
  </table>
  <p class="small muted" style="margin-top:8px">另外，原 MENQOL 文档第 20 题、第 23 题下的程度编号写成了“10.1”和“13.1”，纸质录入时容易串题；系统按题目自动对应，不存在这个问题。</p></div>

  <h2 style="margin-top:30px">算一笔时间账</h2>
  <div class="card calc">
    <div class="grid g3">
      <label>每天量表份数<input type="number" id="c1" value="30"></label>
      <label>每份手工算分、录入（分钟）<input type="number" id="c2" value="3" step="0.5"></label>
      <label>医生每份翻看对比（分钟）<input type="number" id="c3" value="2" step="0.5"></label>
    </div>
    <p class="small muted">默认值是假设，请改成贵院的实际数字。按每月 22 个工作日计算；有简报后，医生每份按 0.5 分钟计。</p>
    <div id="calcout" class="big2"></div>
  </div>

  <h2 style="margin-top:30px">试用的代价</h2>
  <div class="grid g3">
    <div class="card"><h3>不换系统</h3><p class="small">不接 HIS，不改现有流程。纸质表可以照用，两套并行。</p></div>
    <div class="card"><h3>几乎不用培训</h3><p class="small">患者扫码即可填写，医生端只是一个网页，看完点一下确认。</p></div>
    <div class="card"><h3>随时可停</h3><p class="small">数据可以放在院内服务器，随时导出 Excel。不接 AI 也能完整运行。</p></div>
  </div>

  <div class="card" style="margin-top:24px;background:var(--teal2);border-color:#cfe7e4">
    <b>建议这样看：</b>先点上面的“运行”，再看<a class="link" data-go="ai">AI 能多做什么</a>，然后打开<a class="link" data-go="doctor">医生端</a>看看简报，最后打开<a class="link" data-go="board">科室看板</a>。如果想自己做一遍，可以进<a class="link" data-go="patient">患者端</a>。原理与规则见“原理”页，上线前需要确认的事项见“上线前确认”页。
  </div>`;
  document.querySelectorAll("[data-run]").forEach((b) => (b.onclick = () => {
    const i = b.dataset.run, r = CASES[i].run();
    $("#old" + i).innerHTML = `<span class="bad">${esc(r.old)}</span>`; $("#neu" + i).innerHTML = `<span class="ok">${esc(r.neu)}</span>`; }));
  bindGo();
  const calc = () => {
    const n = +$("#c1").value || 0, a = +$("#c2").value || 0, d = +$("#c3").value || 0;
    const perDay = n * a + n * Math.max(0, d - 0.5), month = (perDay * 22) / 60;
    $("#calcout").innerHTML = `每天省 <b>${Math.round(perDay)}</b> 分钟，每月约 <b>${month.toFixed(0)}</b> 小时`;
  };
  ["#c1", "#c2", "#c3"].forEach((s) => ($(s).oninput = calc)); calc();
}
function bindGo() { document.querySelectorAll("[data-go]").forEach((a) => (a.onclick = (e) => { e.preventDefault(); view = a.dataset.go; render(); window.scrollTo(0, 0); })); }

/* ---------- 科室看板：模拟三个月后自动得到的数据 ---------- */
function rng(seed) { return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
let COHORT = null;
function cohort() {
  if (COHORT) return COHORT;
  const R = rng(20261105), now = Date.now(), recs = [];
  const prev = { vasomotor: 0.75, psychosocial: 0.5, physical: 0.55, sexual: 0.45 };
  const dom = SKILLS.menqol.scoring.domains;
  for (let i = 0; i < 128; i++) {
    const t0 = now - (20 + Math.floor(R() * 160)) * DAY, base = {}, sev = R() * 1.6 + 0.5;
    for (const d of dom) for (const id of d.items) base[id] = R() < prev[d.id] ? Math.min(6, Math.floor(R() * 4 * sev)) : "no";
    const r0 = score(SKILLS.menqol, base);
    const rec = { t0, r0, retest: null, phq: null };
    if (now - t0 > 90 * DAY && R() < 0.72) {
      const f = {}; for (const [k, v] of Object.entries(base)) f[k] = v === "no" ? "no" : (R() < 0.2 ? "no" : Math.max(0, v - Math.floor(R() * 3)));
      rec.retest = score(SKILLS.menqol, f);
    }
    if ((r0.domains[1].band && r0.domains[1].band.level >= 2 && R() < 0.8) || R() < 0.2) {
      const q = {}; for (let j = 1; j <= 9; j++) q["q" + j] = Math.min(3, Math.floor(R() * 3 * sev * 0.8)); q.q9 = R() < 0.12 ? 1 : 0;
      rec.phq = { r: score(SKILLS.phq9, q), respMin: 10 + Math.floor(R() * 70) };
    }
    recs.push(rec);
  }
  return (COHORT = recs);
}
function cohortKPI() {
  const c = cohort(), due = c.filter((x) => Date.now() - x.t0 > 90 * DAY);
  const crises = c.filter((x) => x.phq && x.phq.r.crisis);
  return { patients: c.length, retestRate: Math.round((due.filter((x) => x.retest).length / due.length) * 100),
    modPlus: Math.round((c.filter((x) => x.r0.domains.some((d) => d.band && d.band.level >= 2)).length / c.length) * 100),
    phq: c.filter((x) => x.phq).length, crises: crises.length,
    resp: crises.length ? Math.round(crises.reduce((a, x) => a + x.phq.respMin, 0) / crises.length) : 0 };
}
function board() {
  const c = cohort(), k = cohortKPI(), paired = c.filter((x) => x.retest);
  const doms = SKILLS.menqol.scoring.domains.map((d, i) => {
    const ps = paired.filter((x) => x.r0.domains[i].score != null && x.retest.domains[i].score != null);
    const avg = (f) => ps.reduce((a, x) => a + f(x), 0) / (ps.length || 1);
    return { name: d.name, a: avg((x) => x.r0.domains[i].score), b: avg((x) => x.retest.domains[i].score), n: ps.length };
  });
  const months = {}, add = (t) => { const d = new Date(t), cur = new Date().getMonth() === d.getMonth() && Date.now() - t < 40 * DAY, key = `${d.getMonth() + 1}月${cur ? "至今" : ""}`; months[key] = (months[key] || 0) + 1; };
  for (const x of c) { add(x.t0); if (x.phq) add(x.t0); if (x.retest) add(x.t0 + 92 * DAY); }
  const mx = Math.max(...Object.values(months));
  $("#main").innerHTML = `
  <p class="tag amber">模拟数据</p>
  <h1>更年期门诊 · 科室看板</h1>
  <p class="lead">这是按上述流程模拟的半年数据，用来展示上线后、不额外花人力就能看到的内容。数字本身不代表贵院的实际情况。</p>
  <div class="grid kp4" style="margin-top:18px">
    <div class="card"><div class="big">${k.patients}</div><p class="small">建档患者</p></div>
    <div class="card"><div class="big">${k.retestRate}%</div><p class="small">到期复测完成率</p></div>
    <div class="card"><div class="big">${k.modPlus}%</div><p class="small">至少一个维度中度以上</p></div>
    <div class="card"><div class="big">${k.crises} 例</div><p class="small">自伤风险提醒${k.crises ? `，平均 ${k.resp} 分钟内有人跟进` : ""}</p></div>
  </div>
  <div class="grid g2b" style="margin-top:16px">
    <div class="card"><h2>复测患者：首诊与 3 个月后</h2><p class="small muted">${paired.length} 名完成复测的患者，各维度平均分（1–8，越低越好）</p>
      ${doms.map((d) => `<div class="pair"><span>${d.name}</span><div><i style="width:${(d.a / 8) * 100}%" class="a"></i><i style="width:${(d.b / 8) * 100}%" class="b"></i></div><span class="small">${d.a.toFixed(2)} → <b>${d.b.toFixed(2)}</b></span></div>`).join("")}
      <p class="small"><span class="sw a"></span>首诊 <span class="sw b"></span>3 个月后</p>
      <p class="small muted">这类前后对比数据，可以直接用于科室质控、年度总结和临床研究。</p></div>
    <div class="card"><h2>每月测评量</h2><div class="months">${Object.entries(months).sort((a, b) => parseInt(a[0]) - parseInt(b[0])).map(([m, v]) => `<div><i style="height:${(v / mx) * 140}px"></i><span>${m}</span><b>${v}</b></div>`).join("")}</div>
      <p class="small muted">包括首次测评、复测和加做的 PHQ-9。</p>
      <button class="btn ghost" id="csv">导出 Excel（CSV）</button></div>
  </div>`;
  $("#csv").onclick = () => {
    const rows = [["编号", "首诊日期", "首诊总分", ...SKILLS.menqol.scoring.domains.map((d) => d.name), "复测总分", "PHQ-9"]];
    c.forEach((x, i) => rows.push([i + 1, new Date(x.t0).toISOString().slice(0, 10), x.r0.total, ...x.r0.domains.map((d) => d.score ?? ""), x.retest ? x.retest.total : "", x.phq ? x.phq.r.total : ""]));
    const blob = new Blob(["\ufeff" + rows.map((r) => r.join(",")).join("\n")], { type: "text/csv" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "menqol_模拟数据.csv"; a.click();
  };
}

/* ---------- AI 能多做什么：真实模型输出（录制） ---------- */
let AIREC = null, aiState = { u: 0, q: 0, gold: false };
const GOLD = [["m1", "m2", "m14", "m6", "m9", "m24"], ["m7", "m13", "m18", "m10", "m19"], ["m26", "m29", "m15"]];
const OKX = [["m3"], ["m16", "m17", "m8"], ["m27"]];
const LV = { mild: 1, moderate: 2, severe: 3 }, PER = { "1m": 30, "3m": 90, "6m": 180 };
const LBL = { domain: { vasomotor: "血管舒缩", psychosocial: "心理社会", physical: "生理", sexual: "性生活", any: "不限维度" },
  level: { mild: "轻度及以上", moderate: "中度及以上", severe: "重度", any: "不限程度" },
  retest: { done: "已复测", not_done: "未复测", any: "不限复测" }, change: { improved: "好转", worse: "加重", any: "不限变化" },
  period: { "1m": "近一个月", "3m": "近三个月", "6m": "近半年", all: "不限时间" } };
async function ai() {
  if (!AIREC) AIREC = await (await fetch("app/ai_recorded.json")).json();
  const R = AIREC;
  $("#main").innerHTML = `
  <p class="tag">AI 能多做什么</p>
  <h1>同一件事，两种做法</h1>
  <p class="lead">下面三个例子都是真实模型的输出（${esc(R.recorded_at)} 在本机录制），网页本身不连模型。分工很简单：<b>算分、分级和危机判断只由规则完成，AI 不碰</b>；AI 负责听懂和起草，它给出的内容都要经过规则或医生确认。</p>

  <h2 style="margin-top:26px">① 听懂患者的原话 <span class="tag gray">本地模型 h2o · 数据不出本机</span></h2>
  <div class="grid vs2">
    <div class="card old"><h3>传统软件</h3><p>29 道题逐题点“有 / 没有”，再逐题选困扰程度。年纪大或者不识字的患者常常要护士陪着填。</p></div>
    <div class="card"><div class="seg">${R.intake.map((x, i) => `<button class="${i === aiState.u ? "on" : ""}" data-u="${i}">原话 ${i + 1}</button>`).join("")}</div>
      <blockquote>“${esc(R.intake[aiState.u].text)}”</blockquote>
      <div id="chips"></div>
      <p class="small muted">绿色为模型预填，黄色是模型把握不足的项，系统会追问。患者在确认页逐项核对，可以划掉误判，之后再选困扰程度，交给规则算分。用时 ${(R.intake[aiState.u].ms / 1000).toFixed(1)} 秒。
      <label style="margin-left:8px"><input type="checkbox" id="gold" ${aiState.gold ? "checked" : ""}> 和人工标注对照</label></p></div>
  </div>

  <h2 style="margin-top:26px">② 主任用一句话提问 <span class="tag gray">本地模型只负责理解问题 · 名单由规则从数据里筛</span></h2>
  <div class="grid vs2">
    <div class="card old"><h3>传统软件</h3><p>只能看已经开发好的报表。想换一种问法，就得提需求、等厂商改报表。</p></div>
    <div class="card"><div class="seg">${R.ask.map((x, i) => `<button class="${i === aiState.q ? "on" : ""}" data-q="${i}">提问 ${i + 1}</button>`).join("")}</div>
      <blockquote>“${esc(R.ask[aiState.q].q)}”</blockquote><div id="askout"></div></div>
  </div>

  <h2 style="margin-top:26px">③ 给医生写简报 <span class="tag amber">Gemini · 仅供参考</span></h2>
  <div class="grid vs2">
    <div class="card old"><h3>传统软件 / 规则模板</h3><p>${esc([].concat(templateBrief("p1")).join(" "))}</p><p class="small muted">每句话都可靠，但措辞固定，也不会把几项变化联系起来看。</p></div>
    <div class="card"><p class="small muted">同一份事实生成两次。<span class="ok">绿色</span>数字在规则算出的结果里找得到，<span class="bad">红色</span>找不到，需医生核对。</p>
      ${R.brief.map((b, i) => `<div class="brief"><b>第 ${i + 1} 次</b> ${checkNums(b.text, R.brief_facts)}</div>`).join("")}
      <p class="small muted">大模型会编造内容，所以简报只能当参考：每个数字都要自动比对，正式结论以规则结果和医生判断为准。</p></div>
  </div>

  <div class="card" style="margin-top:24px;background:var(--teal2);border-color:#cfe7e4"><b>一句话：</b>需要精确的部分继续由规则来做，繁琐的部分交给 AI。新增一个量表或科室，主要是给规则补一份配置，不需要重新开发一套软件。</div>`;
  const it = R.intake[aiState.u].answers, g = new Set(GOLD[aiState.u]), ok = new Set(OKX[aiState.u]);
  $("#chips").innerHTML = Object.entries(it).filter(([, v]) => v.choice === "present").map(([k, v]) => {
    const low = v.confidence < 0.9, mark = aiState.gold ? (g.has(k) ? " ✓" : ok.has(k) ? " ≈" : " ✗") : "";
    return `<span class="chip ${low ? "low" : "hi"}${aiState.gold && !g.has(k) && !ok.has(k) ? " fp" : ""}">${esc(SKILLS.menqol.items.find((q) => q.id === k).text)} <small>${Math.round(v.confidence * 100)}%</small>${mark}</span>`; }).join("") +
    (aiState.gold ? `<p class="small">人工标注 ${g.size} 项，模型漏掉 ${[...g].filter((k) => it[k].choice !== "present").length} 项；✗ 为误判，留给患者划掉；≈ 为可算可不算。</p>` : "");
  renderAsk();
  document.querySelectorAll("[data-u]").forEach((b) => (b.onclick = () => { aiState.u = +b.dataset.u; ai(); }));
  document.querySelectorAll("[data-q]").forEach((b) => (b.onclick = () => { aiState.q = +b.dataset.q; ai(); }));
  $("#gold").onchange = (e) => { aiState.gold = e.target.checked; ai(); };
}
function renderAsk() {
  const a = AIREC.ask[aiState.q], f = Object.fromEntries(Object.entries(a.filter).map(([k, v]) => [k, v.choice]));
  const di = SKILLS.menqol.scoring.domains.findIndex((d) => d.id === f.domain), now = Date.now();
  const rows = cohort().map((x, i) => ({ ...x, no: i + 1 })).filter((x) => {
    if (PER[f.period] && now - x.t0 > PER[f.period] * DAY) return false;
    if (f.retest === "done" && !x.retest) return false;
    if (f.retest === "not_done" && x.retest) return false;
    const doms = di >= 0 ? [di] : [0, 1, 2, 3];
    if (LV[f.level] && !doms.some((j) => x.r0.domains[j].band && (f.level === "severe" ? x.r0.domains[j].band.level >= 3 : x.r0.domains[j].band.level >= LV[f.level]))) return false;
    if (f.change !== "any") { if (!x.retest) return false; const ok = doms.some((j) => { const d = x.retest.domains[j].score - x.r0.domains[j].score; return f.change === "improved" ? d <= -0.5 : d >= 0.5; }); if (!ok) return false; }
    return true; });
  $("#askout").innerHTML = `<p class="small muted">模型理解成的筛选条件（${(a.ms / 1000).toFixed(1)} 秒）：</p>
    <div>${Object.entries(a.filter).map(([k, v]) => `<span class="chip ${v.confidence < 0.9 ? "low" : "hi"}">${LBL[k][v.choice] || v.choice} <small>${Math.round(v.confidence * 100)}%</small></span>`).join("")}</div>
    <p style="margin-top:10px">规则从模拟数据中筛出 <b>${rows.length}</b> 人${rows.length ? "：" : "。"}${rows.slice(0, 8).map((x) => `<span class="chip">${x.no} 号</span>`).join("")}${rows.length > 8 ? " …" : ""}</p>
    <p class="small muted">条件显示在名单上方，主任一眼就能看出模型有没有理解对；理解错了，点一下就能改。名单本身不会因为模型而出错。</p>`;
}
function checkNums(text, facts) {
  const pool = new Set((JSON.stringify(facts).match(/\d+(\.\d+)?/g) || []).map(Number));
  return esc(text).replace(/\d+(\.\d+)?/g, (n) => `<span class="${pool.has(Number(n)) ? "ok" : "bad"} num">${n}</span>`);
}

/* 患者端 */
function patient() {
  if (!pf) pf = { pid: "p1", phase: "pick" };
  const p = db.patients.find((x) => x.id === pf.pid);
  let body = "";
  if (pf.phase === "pick") {
    const todo = db.tasks.filter((t) => t.pid === pf.pid && !t.done && !t.staff && t.due <= Date.now() + DAY);
    body = `<div class="top">扫码进入 · ${esc(p.dept)}</div>
      <h2>您好，${esc(p.name)}</h2>
      ${todo.length ? `<div class="bubble">医生请您近期完成：${todo.map((t) => esc(t.action)).join("、")}</div>` : ""}
      <p class="muted small">请选择要填写的问卷：</p>
      ${ROLES[p.role].skills.map((id) => SKILLS[id]).map((s) => `<button class="opt" data-start="${s.id}"><b>${esc(s.name)}</b><br><span class="small muted">${s.items.length} 题 · 约 ${Math.ceil(s.items.length / 6)} 分钟</span></button>`).join("")}
      <div style="flex:1"></div>`;
  } else if (pf.phase === "q") {
    const s = SKILLS[pf.skill], it = s.items[pf.idx], a = pf.answers[it.id];
    let ctl = "";
    if (it.type === "choice") ctl = it.options.map((o) => `<button class="opt ${a === o.value ? "sel" : ""}" data-ans="${o.value}">${esc(o.label)}</button>`).join("");
    else if (pf.yes) ctl = `<p class="small muted">它对您的困扰有多大？0 = 完全不受困扰，6 = 极度困扰</p>
      <div class="sev">${[0, 1, 2, 3, 4, 5, 6].map((k) => `<button data-ans="${k}">${k}</button>`).join("")}</div>
      <button class="link" data-back-yes>返回</button>`;
    else ctl = `<button class="opt" data-ans="no">否，没有经历过</button><button class="opt" data-yes>是，经历过</button>
      ${it.allowNA ? `<button class="opt" data-ans="na">不适用（目前无性生活或不愿回答）</button>` : ""}`;
    body = `<div class="top">${esc(s.name)} · ${pf.idx + 1}/${s.items.length}</div>
      <div class="progress"><i style="width:${(pf.idx / s.items.length) * 100}%"></i></div>
      <p class="small muted">${esc(s.prompt)}</p>
      <div class="q">${esc(it.text)}</div>${ctl}
      ${(pf.chat || []).map((m) => `<div class="bubble ${m.me ? "me" : ""}">${esc(m.text)}</div>`).join("")}
      <div style="flex:1"></div>
      <div class="row"><button class="link" data-ask>这题是什么意思？</button>${pf.idx ? `<button class="link" data-prev>上一题</button>` : ""}</div>`;
  } else {
    const r = pf.result, s = SKILLS[pf.skill];
    let res;
    if (r.crisis) res = `<div class="crisis">${esc(r.patientMessage).replace(/\n/g, "<br>")}</div>`;
    else if (r.domains) res = `<p>总体：<b>${r.band.label}</b>（${r.total} 分，满分 8，分越高困扰越大）</p>
      <div class="bars">${r.domains.map((d) => `<div class="b"><span>${d.name}</span><span class="t"><i style="width:${d.score ? ((d.score - 1) / 7) * 100 : 0}%;background:${lvColor(d.band?.level)}"></i></span><span class="small">${d.score ?? "不适用"}</span></div>`).join("")}</div>
      ${r.domains.filter((d) => d.band && d.band.level > 0).map((d) => `<div class="bubble"><b>${d.name}（${d.band.label}）</b><br>${esc(s.domainAdvicePatient[d.id][d.band.level - 1])}</div>`).join("")}
      ${r.notes.map((n) => `<p class="small muted">注：${esc(n)}</p>`).join("")}`;
    else res = `<p>结果：<b>${r.band.label}</b>（${r.total} 分）</p><div class="bubble">${esc(r.patientMessage)}</div>`;
    body = `<div class="top">${esc(s.name)} · 已完成</div>${res}
      <p class="small muted" style="margin-top:14px">这是一份自评筛查结果，不是诊断。您的医生会查看并联系您。</p>
      <div style="flex:1"></div><button class="btn" data-home>完成</button>`;
  }
  $("#main").innerHTML = `<div class="grid g2">
    <div><div class="phone">${body}</div></div>
    <div class="card">${explain("patient")}
      <h3 style="margin-top:16px">切换患者</h3>
      <div class="row">${db.patients.map((x) => `<button class="btn ${x.id === pf.pid ? "" : "ghost"}" data-pid="${x.id}">${x.name} · ${ROLES[x.role].name.slice(0, 2)}</button>`).join("")}</div>
    </div></div>`;
  bindPatient();
}
const lvColor = (l) => ["#9cc9c3", "#4fa59c", "#d99a2b", "#c0392b"][l ?? 0];

function bindPatient() {
  const m = $("#main");
  m.querySelectorAll("[data-pid]").forEach((b) => (b.onclick = () => { pf = { pid: b.dataset.pid, phase: "pick" }; patient(); }));
  m.querySelectorAll("[data-start]").forEach((b) => (b.onclick = () => { pf = { ...pf, phase: "q", skill: b.dataset.start, idx: 0, answers: {}, chat: [] }; patient(); }));
  m.querySelectorAll("[data-ans]").forEach((b) => (b.onclick = () => {
    const s = SKILLS[pf.skill], it = s.items[pf.idx], v = b.dataset.ans;
    pf.answers[it.id] = v === "no" || v === "na" ? v : Number(v);
    pf.yes = false; pf.chat = [];
    if (pf.idx < s.items.length - 1) pf.idx++;
    else {
      const ev = record(pf.pid, pf.skill, pf.answers); save();
      db.tasks.filter((t) => t.pid === pf.pid && !t.done && t.action.includes(s.name.split(" ")[0]) && t.from !== ev.id).forEach((t) => (t.done = true)); save();
      pf.result = ev.result; pf.phase = "done";
    }
    patient();
  }));
  const yes = $("[data-yes]", m); if (yes) yes.onclick = () => { pf.yes = true; patient(); };
  const by = $("[data-back-yes]", m); if (by) by.onclick = () => { pf.yes = false; patient(); };
  const pv = $("[data-prev]", m); if (pv) pv.onclick = () => { pf.idx--; pf.yes = false; pf.chat = []; patient(); };
  const ask = $("[data-ask]", m); if (ask) ask.onclick = () => {
    const s = SKILLS[pf.skill], it = s.items[pf.idx];
    const hits = Object.entries(s.glossary || {}).filter(([k]) => it.text.includes(k) || s.prompt.includes(k) || (k === "不适用" && it.allowNA));
    pf.chat = [{ me: true, text: "这题是什么意思？" }, { text: hits.length ? hits.map(([k, v]) => `“${k}”：${v}`).join(" ") : "按您自己过去这段时间的真实感受回答就好；拿不准时，选最接近的一项。" }];
    patient();
  };
  const hm = $("[data-home]", m); if (hm) hm.onclick = () => { pf = { pid: pf.pid, phase: "pick" }; patient(); };
}

/* 医生端 */
function worklist() {
  return db.patients.map((p) => {
    const ev = eventsOf(p.id), unsigned = ev.filter((e) => e.type === "assessment" && !e.signed);
    const crisis = unsigned.some((e) => e.result.crisis);
    const due = db.tasks.filter((t) => t.pid === p.id && !t.done && t.due <= Date.now() + DAY);
    const last = ev.filter((e) => e.type === "assessment").at(-1);
    return { p, crisis, unsigned, due, lastT: last ? last.t : 0, rank: (crisis ? 100 : 0) + unsigned.length * 10 + due.length };
  }).sort((a, b) => b.rank - a.rank || b.lastT - a.lastT);
}
let roleSel = "menopause";
function doctor() {
  const wl = worklist().filter((w) => w.p.role === roleSel);
  if (!sel || !db.patients.find((p) => p.id === sel)) sel = wl[0].p.id;
  const p = db.patients.find((x) => x.id === sel), ev = eventsOf(sel);
  const mq = assessments(sel, "menqol");
  const model = JSON.parse(localStorage.getItem("anc-model") || "{}");
  $("#main").innerHTML = `${explain("doctor")}<div class="grid g2" style="margin-top:16px">
   <div>
    <div class="row" style="margin:0 0 10px">${Object.values(ROLES).map((r) => `<button class="btn ${r.id === roleSel ? "" : "ghost"}" data-role="${r.id}">${r.name}</button>`).join("")}</div>
    <h2>今天要处理的</h2>
    <div class="list">${wl.map((w) => `<div class="it ${w.p.id === sel ? "on" : ""} ${w.crisis ? "crit" : ""}" data-sel="${w.p.id}">
      <div><b>${w.p.name}</b> <span class="small muted">${w.p.age} 岁</span><br>
      ${w.crisis ? `<span class="tag red">危机</span>` : ""}${w.unsigned.length ? `<span class="tag amber">待签字 ${w.unsigned.length}</span>` : ""}${w.due.length ? `<span class="tag">随访 ${w.due.length}</span>` : ""}${!w.crisis && !w.unsigned.length && !w.due.length ? `<span class="tag gray">无待办</span>` : ""}</div>
      <span class="small muted">${w.lastT ? fmt(w.lastT) : ""}</span></div>`).join("")}</div>
    <div class="card" style="margin-top:16px"><h3>主任问一句</h3>
      <div class="chips">${["今天有几个危机？", "最近一次 MENQOL 中度以上的有几人？", "哪些人该随访了？"].map((q) => `<button data-q="${q}">${q}</button>`).join("")}</div>
      <div id="qa" class="small"></div></div>
   </div>
   <div class="card">
    <div class="row" style="justify-content:space-between"><h2 style="margin:0">${p.name} · ${p.age} 岁 · ${p.dept}</h2>
      <button class="btn" data-sign ${ev.some((e) => e.type === "assessment" && !e.signed) ? "" : "disabled"}>审阅并签字</button></div>
    <div class="brief" style="margin-top:14px"><div class="ai">诊前简报 · ${model.base ? "模型改写自确定性事实" : "模板生成（可接入模型）"}</div>
      <div id="brief">${templateBrief(sel).map((x) => `<p style="margin:6px 0">${esc(x)}</p>`).join("")}</div>
      ${model.base ? `<button class="link" data-ai>让模型改写</button>` : ""}</div>
    ${mq.length ? `<h3 style="margin-top:18px">MENQOL 各维度（医生版）</h3>${doctorMenqol(mq)}` : ""}
    ${["phq9", "epds"].filter((k) => assessments(sel, k).length).map((k) => doctorPhq(assessments(sel, k).at(-1))).join("")}
    ${tasksBlock(sel)}
    <h3 style="margin-top:18px">时间线</h3>
    <div class="tl">${ev.slice().reverse().map((e) => `<div><span class="muted small">${fmt(e.t)}</span> ${tlText(e)}</div>`).join("")}</div>
    <details style="margin-top:14px"><summary class="small muted">接入模型（可选，OpenAI 兼容接口，仅存本机浏览器）</summary>
      <div class="grid" style="margin-top:8px"><input type="text" id="mb" placeholder="Base URL，如 http://localhost:11434/v1" value="${esc(model.base || "")}">
      <input type="text" id="mm" placeholder="模型名" value="${esc(model.model || "")}"><input type="password" id="mk" placeholder="API Key（本地模型可留空）" value="${esc(model.key || "")}">
      <button class="btn ghost" data-savemodel>保存</button></div></details>
   </div></div>`;
  bindDoctor();
}
function tasksBlock(pid) {
  const ts = db.tasks.filter((t) => t.pid === pid && !t.done).sort((a, b) => a.due - b.due);
  if (!ts.length) return "";
  return `<h3 style="margin-top:18px">随访任务</h3><table>${ts.map((t) => `<tr><td>${esc(t.action)}${t.staff ? ' <span class="tag red">医护</span>' : ' <span class="tag">患者</span>'}</td><td class="small muted">${t.due <= Date.now() ? "今天" : fmt(t.due)}</td><td style="text-align:right"><button class="link" data-done="${t.id}">标记完成</button></td></tr>`).join("")}</table>`;
}
function doctorMenqol(list) {
  const cur = list.at(-1).result, prev = list.at(-2)?.result, sk = SKILLS.menqol;
  return `<table><tr><th>维度</th>${prev ? "<th>上次</th>" : ""}<th>本次</th><th>医生参考</th></tr>
   ${cur.domains.map((d, i) => `<tr><td>${d.name}</td>${prev ? `<td>${prev.domains[i].score ?? "—"}</td>` : ""}<td><b>${d.score ?? "不适用"}</b> ${d.band ? `<span class="tag ${d.band.level >= 3 ? "red" : d.band.level >= 2 ? "amber" : "gray"}">${d.band.label}</span>` : ""}</td>
   <td class="small">${d.band && d.band.level ? esc(sk.domainAdviceDoctor[d.id][d.band.level - 1]) : "—"}</td></tr>`).join("")}
   <tr><td>总分</td>${prev ? `<td>${prev.total}</td>` : ""}<td><b>${cur.total}</b> ${cur.band.label}</td><td class="small muted">${cur.notes.join("；")}</td></tr></table>`;
}
function doctorPhq(e) {
  const r = e.result;
  return `<h3 style="margin-top:18px">${SKILLS[e.skill].name.split(" ")[0]}（${fmt(e.t)}）</h3>
   <p>总分 <b>${r.total}</b>，${r.band.label}${r.band.doctor ? "。" + esc(r.band.doctor) : ""}</p>
   ${r.crisis ? `<div class="crisis">${esc(r.crises.map((c) => c.doctor).join(" "))}</div>` : ""}`;
}
function tlText(e) {
  if (e.type === "assessment") return `完成 ${SKILLS[e.skill].name.split(" ")[0]}：${e.result.total} 分，${e.result.band.label}${e.result.crisis ? ' <span class="tag red">危机</span>' : ""}${e.signed ? ' <span class="tag gray">已签字</span>' : ' <span class="tag amber">待签字</span>'}`;
  if (e.type === "sign") return `医生签字确认`;
  return esc(e.text || e.type);
}
function bindDoctor() {
  const m = $("#main");
  m.querySelectorAll("[data-role]").forEach((b) => (b.onclick = () => { roleSel = b.dataset.role; sel = null; doctor(); }));
  m.querySelectorAll("[data-sel]").forEach((b) => (b.onclick = () => { sel = b.dataset.sel; doctor(); }));
  m.querySelectorAll("[data-done]").forEach((b) => (b.onclick = () => {
    const t = db.tasks.find((x) => x.id === b.dataset.done); t.done = true;
    addEvent({ pid: t.pid, type: "note", text: `完成随访任务：${t.action}` }); doctor(); }));
  const sg = $("[data-sign]", m); if (sg) sg.onclick = () => {
    db.events.filter((e) => e.pid === sel && e.type === "assessment").forEach((e) => (e.signed = true));
    addEvent({ pid: sel, type: "sign" }); doctor(); };
  m.querySelectorAll("[data-q]").forEach((b) => (b.onclick = () => { $("#qa").innerHTML = `<div class="bubble me">${esc(b.dataset.q)}</div><div class="bubble">${esc(answer(b.dataset.q))}</div>`; }));
  const ai = $("[data-ai]", m); if (ai) ai.onclick = async () => {
    $("#brief").innerHTML = "<p class='muted'>改写中…</p>";
    try { $("#brief").innerHTML = `<p>${esc(await modelBrief(sel))}</p>`; } catch (err) { $("#brief").innerHTML = `<p class="bad">模型调用失败：${esc(err.message)}，已退回模板简报。</p>` + templateBrief(sel).map((x) => `<p>${esc(x)}</p>`).join(""); }
  };
  const sv = $("[data-savemodel]", m); if (sv) sv.onclick = () => {
    localStorage.setItem("anc-model", JSON.stringify({ base: $("#mb").value.trim(), model: $("#mm").value.trim(), key: $("#mk").value.trim() })); doctor(); };
}
function answer(q) {
  if (q.startsWith("今天有几个危机")) {
    const c = db.events.filter((e) => e.type === "assessment" && e.result.crisis && Date.now() - e.t < DAY);
    return c.length ? `${c.length} 个：${[...new Set(c.map((e) => db.patients.find((p) => p.id === e.pid).name))].join("、")}。` : "今天没有。";
  }
  if (q.startsWith("最近一次 MENQOL")) {
    const last = db.patients.map((p) => assessments(p.id, "menqol").at(-1)).filter(Boolean);
    const hi = last.filter((e) => e.result.band.level >= 2 || e.result.domains.some((d) => d.band && d.band.level >= 2));
    return `${last.length} 人做过 MENQOL，其中 ${hi.length} 人总分或任一维度在中度以上${hi.length ? "：" + hi.map((e) => db.patients.find((p) => p.id === e.pid).name).join("、") : ""}。`;
  }
  const due = db.tasks.filter((t) => !t.done && t.due <= Date.now() + DAY);
  return due.length ? due.map((t) => `${db.patients.find((p) => p.id === t.pid).name}：${t.action}`).join("；") + "。" : "暂时没有到期的随访。";
}

/* 技能包与测试 */
function skills() {
  const res = runGolden(SKILLS, window.__golden);
  const pass = res.filter((r) => r.pass).length;
  $("#main").innerHTML = `<div class="grid g2">
   <div style="grid-column:1/-1">${explain("skills")}</div>
   <div class="card"><h2>黄金用例 <span class="${pass === res.length ? "ok" : "bad"}">${pass}/${res.length} 通过</span></h2>
    <p class="small muted">每改一次技能包，这些用例都要重新跑一遍，全部通过才允许上线。AI 帮忙改规则也一样，必须先过测试，再由人确认。</p>
    <table>${res.map((r) => `<tr><td class="${r.pass ? "ok" : "bad"}">${r.pass ? "✓" : "✗"}</td><td class="small">${esc(r.name)}${r.errs.length ? `<br><span class="bad">${esc(r.errs.join("；"))}</span>` : ""}</td></tr>`).join("")}</table></div>
   <div class="card"><div class="row" style="justify-content:space-between"><h2 style="margin:0">技能包原文</h2>
    <div class="row">${Object.values(SKILLS).map((s) => `<button class="btn ghost" data-sk="${s.id}">${s.id}</button>`).join("")}${Object.values(ROLES).map((r) => `<button class="btn ghost" data-ro="${r.id}">角色：${r.name.slice(0, 3)}</button>`).join("")}</div></div>
    <p class="small muted">量表文件 = 一个量表的全部规则；角色文件 = 一个科室用哪些量表、什么时候随访。产科就是这样加进来的：一个角色文件 + 一个量表文件，代码没改。</p>
    <pre id="skjson"></pre></div></div>`;
  const show = (id) => ($("#skjson").textContent = JSON.stringify(SKILLS[id], null, 2));
  document.querySelectorAll("[data-sk]").forEach((b) => (b.onclick = () => show(b.dataset.sk)));
  document.querySelectorAll("[data-ro]").forEach((b) => (b.onclick = () => ($("#skjson").textContent = JSON.stringify(ROLES[b.dataset.ro], null, 2))));
  show("phq9");
}

/* ---------- 启动 ---------- */
async function boot() {
  const files = ["skills/phq9.json", "skills/menqol.json", "skills/epds.json", "roles/menopause.json", "roles/obstetrics.json", "tests/golden.json"];
  const [a, b, c, r1, r2, g] = await Promise.all(files.map((u) => fetch(u).then((r) => r.json())));
  SKILLS.phq9 = a; SKILLS.menqol = b; SKILLS.epds = c; ROLES.menopause = r1; ROLES.obstetrics = r2; window.__golden = g;
  db = JSON.parse(localStorage.getItem(KEY) || "null");
  if (!db) seed();
  document.querySelectorAll("#nav button").forEach((btn) => (btn.onclick = () => { view = btn.dataset.view; render(); window.scrollTo(0, 0); }));
  $("#reset").onclick = () => { localStorage.removeItem(KEY); pf = null; sel = null; seed(); render(); };
  const h = location.hash.slice(1); if (["value", "ai", "board", "concept", "patient", "doctor", "skills", "confirm"].includes(h)) view = h;
  render();
}
boot();
