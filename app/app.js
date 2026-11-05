import { score } from "../engine/engine.js";
import { runGolden } from "../tests/run.js";

const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const DAY = 86400000;
const fmt = (t) => { const d = new Date(t); return `${d.getMonth() + 1}月${d.getDate()}日`; };
const uid = () => Math.random().toString(36).slice(2, 9);

const SKILLS = {};
const KEY = "anc-v1";
let db, view = "concept", sel = null, pf = null;

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
    { id: "p3", name: "张女士", age: 55, dept: "更年期门诊" } ], events: [], tasks: [] };
  const now = Date.now();
  record("p1", "menqol", menqolAns({ m1: 5, m2: 5, m3: 4, m4: 2, m5: 3, m8: 2, m13: 3, m14: 4, m16: 2, m27: 1, m28: 2 }), now - 92 * DAY);
  db.events.at(-1).signed = true;
  db.tasks.forEach((t) => (t.done = true));
  record("p1", "menqol", menqolAns({ m1: 3, m2: 2, m3: 2, m4: 4, m5: 4, m6: 3, m7: 4, m8: 4, m9: 3, m10: 3, m13: 3, m14: 5, m16: 2, m27: 1, m28: 2 }), now - 2 * 3600000);
  record("p2", "phq9", { q1: 2, q2: 2, q3: 1, q4: 2, q5: 1, q6: 2, q7: 1, q8: 1, q9: 1 }, now - 40 * 60000);
  record("p3", "menqol", menqolAns({ m1: 1, m2: 0, m14: 2, m19: 1, m27: "na", m28: "na", m29: "na" }), now - 30 * DAY);
  db.events.at(-1).signed = true;
  save();
}

/* ---------- 语言层：简报（模板版；可选接入模型改写） ---------- */
function facts(pid) {
  const p = db.patients.find((x) => x.id === pid);
  const out = { 患者: `${p.name}，${p.age} 岁，${p.dept}`, 量表: [] };
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
  const crisis = F.量表.find((q) => q.危机);
  if (crisis) s.push(`⚠️ ${crisis.日期}${crisis.名称.split(" ")[0]} 第 9 题阳性，提示有自伤念头，需今天人工评估。`);
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
  ({ concept, patient, doctor, skills })[view]();
}

function concept() {
  $("#main").innerHTML = `
  <p class="tag">探索原型</p>
  <h1>不做“七个系统”，只做三样东西</h1>
  <p class="lead">一条时间线、一组技能包、几个角色。量表、规则、报告口径都写在人和 AI 都读得懂的文件里；计分和危机判断用代码锁死，AI 只负责说人话。</p>
  <div class="grid g3" style="margin-top:20px">
    <div class="card"><h2>① 时间线</h2><p>每个患者一条只追加的事件流：填表、结果、签字、随访都是事件。没有几十张业务表，报表就是在时间线上现算。</p></div>
    <div class="card"><h2>② 技能包</h2><p>一个量表 = 一个文件：题目、计分、连续分级、危机规则、患者版和医生版文案、随访规则。改需求就是改文件，测试全绿才生效。</p></div>
    <div class="card"><h2>③ 角色</h2><p>“更年期系统”“精神系统”只是不同角色挂不同技能包，共用一条时间线。加一个科室 = 加一个文件夹。</p></div>
  </div>
  <h2 style="margin-top:28px">两层分离</h2>
  <div class="flow">
    <div class="card"><span class="tag">确定性层 · 代码</span><p class="small">计分、分级、PHQ-9 第 9 题危机规则、随访触发、签字。同样输入永远同样结果，有黄金用例守着。</p></div>
    <div class="arrow">→</div>
    <div class="card"><span class="tag amber">语言层 · AI</span><p class="small">解释题目、写诊前简报、回答主任的问题。只能引用确定性层给出的事实。</p></div>
    <div class="arrow">→</div>
    <div class="card"><span class="tag gray">人</span><p class="small">任何临床结论要医生签字才生效。</p></div>
  </div>
  <h2 style="margin-top:28px">3 分钟体验</h2>
  <div class="card"><ol>
    <li>去 <b>医生端</b>：李女士排在第一位，红色危机；王女士的简报已经写好，血管舒缩维度比 3 个月前明显好转，但心理社会维度升到中度，系统已自动加了一条“加做 PHQ-9”。</li>
    <li>去 <b>患者端</b>：以王女士身份做 PHQ-9。前 8 题都选“完全不会”，第 9 题选“好几天”。原文档会判“情绪良好”，这里会立刻转危机流程。</li>
    <li>回 <b>医生端</b>：王女士已经顶到第一位。</li>
    <li>去 <b>技能包与测试</b>：看规则长什么样，20 条黄金用例当场跑。</li>
  </ol></div>`;
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
      ${todo.length ? `<div class="bubble">医生请您今天完成：${todo.map((t) => esc(t.action)).join("、")}</div>` : ""}
      <p class="muted small">请选择要填写的问卷：</p>
      ${Object.values(SKILLS).map((s) => `<button class="opt" data-start="${s.id}"><b>${esc(s.name)}</b><br><span class="small muted">${s.items.length} 题 · 约 ${Math.ceil(s.items.length / 6)} 分钟</span></button>`).join("")}
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
    <div class="card"><h2>你在看什么</h2>
      <p>患者扫码就能填，不装 App。题目是<b>原题原文</b>，保证量表信效度；卡片之间可以随时问“这是什么意思”，由助手解释（这里用技能包里的词表模拟，接上模型后可以自由问答）。</p>
      <p>提交后，<b>计分和危机判断由代码完成</b>，AI 不参与。第 9 题只要不是“完全不会”，常规报告就会中止，直接给出危机文案和 12356 热线，同时推到医生端最上面。</p>
      <p>MENQOL 的分级用连续区间，1.33 这类分数不会再“无处安放”；性生活维度可以选“不适用”，不会再把总分拉低。处方类建议只在医生端出现。</p>
      <h3 style="margin-top:16px">切换患者</h3>
      <div class="row">${db.patients.map((x) => `<button class="btn ${x.id === pf.pid ? "" : "ghost"}" data-pid="${x.id}">${x.name}</button>`).join("")}</div>
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
function doctor() {
  const wl = worklist();
  if (!sel || !db.patients.find((p) => p.id === sel)) sel = wl[0].p.id;
  const p = db.patients.find((x) => x.id === sel), ev = eventsOf(sel);
  const mq = assessments(sel, "menqol");
  const model = JSON.parse(localStorage.getItem("anc-model") || "{}");
  $("#main").innerHTML = `<div class="grid g2">
   <div>
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
    ${assessments(sel, "phq9").length ? doctorPhq(assessments(sel, "phq9").at(-1)) : ""}
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
  return `<h3 style="margin-top:18px">PHQ-9（${fmt(e.t)}）</h3>
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
   <div class="card"><h2>黄金用例 <span class="${pass === res.length ? "ok" : "bad"}">${pass}/${res.length} 通过</span></h2>
    <p class="small muted">每改一次技能包，这些用例都要重新跑一遍，全部通过才允许上线。AI 帮忙改规则也一样，必须先过测试，再由人确认。</p>
    <table>${res.map((r) => `<tr><td class="${r.pass ? "ok" : "bad"}">${r.pass ? "✓" : "✗"}</td><td class="small">${esc(r.name)}${r.errs.length ? `<br><span class="bad">${esc(r.errs.join("；"))}</span>` : ""}</td></tr>`).join("")}</table></div>
   <div class="card"><div class="row" style="justify-content:space-between"><h2 style="margin:0">技能包原文</h2>
    <div class="row">${Object.values(SKILLS).map((s) => `<button class="btn ghost" data-sk="${s.id}">${s.id}</button>`).join("")}</div></div>
    <p class="small muted">这就是“系统”的全部业务规则。医生能审，AI 能执行，改需求就是改这个文件。</p>
    <pre id="skjson"></pre></div></div>`;
  const show = (id) => ($("#skjson").textContent = JSON.stringify(SKILLS[id], null, 2));
  document.querySelectorAll("[data-sk]").forEach((b) => (b.onclick = () => show(b.dataset.sk)));
  show("phq9");
}

/* ---------- 启动 ---------- */
async function boot() {
  const [a, b, g] = await Promise.all(["skills/phq9.json", "skills/menqol.json", "tests/golden.json"].map((u) => fetch(u).then((r) => r.json())));
  SKILLS.phq9 = a; SKILLS.menqol = b; window.__golden = g;
  db = JSON.parse(localStorage.getItem(KEY) || "null");
  if (!db) seed();
  document.querySelectorAll("#nav button").forEach((btn) => (btn.onclick = () => { view = btn.dataset.view; render(); window.scrollTo(0, 0); }));
  $("#reset").onclick = () => { localStorage.removeItem(KEY); pf = null; sel = null; seed(); render(); };
  const h = location.hash.slice(1); if (["concept", "patient", "doctor", "skills"].includes(h)) view = h;
  render();
}
boot();
