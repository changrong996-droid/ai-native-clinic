/* ---------- v1.0 演示稿：两个角度，各自一屏的“之前 / 之后”对照 ----------
   病人这边：只讲病人感受到的变化。医院这边：整体收益 + 流程对照 + 各岗位的增减。
   唯一实测：填表时间（UPMC 儿科门诊，Hanmer 2021，PMC8046593，仅作参考）；其余时长均为示意（取自“算一笔时间账”的默认假设值）。
   岗位增减条的长度只表示方向，不是测量值。 */
import { C, T, paperSheet, tablet, monitor, calendar } from "./visit.js";

const pop = (label, html, cls = "") => `<details class="pop ${cls}"><summary>${label}</summary><div class="pop-body"><button class="pop-x" type="button" aria-label="关闭" onclick="this.closest('details').open=false">×</button>${html}</div></details>`;
const svg = (inner) => `<svg viewBox="0 0 120 72" aria-hidden="true">${inner}</svg>`;
const SRC = `<a class="link" href="https://pmc.ncbi.nlm.nih.gov/articles/PMC8046593" target="_blank" rel="noopener">原文</a>`;

/* 小插图 */
const clock = (x, y, r) => `<circle cx="${x}" cy="${y}" r="${r}" fill="#fff" stroke="${C.mute}" stroke-width="2"/><path d="M${x} ${y - r * 0.6} L${x} ${y} L${x + r * 0.5} ${y + r * 0.3}" stroke="${C.mute}" stroke-width="2" fill="none" stroke-linecap="round"/>`;
const check = (x, y, s = 1, col = C.teal) => `<path d="M${x} ${y} l${7 * s} ${7 * s} l${14 * s} ${-15 * s}" stroke="${col}" stroke-width="${3.2 * s}" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`;
const opts = (w, sel) => [0, 1, 2].map((i) => `<rect x="6" y="${18 + i * 14}" width="${w}" height="10" rx="3" fill="${i === sel ? C.teal2 : "#fff"}" stroke="${i === sel ? C.teal : C.line}"/>`).join("");
const bell = (x, y) => `<g transform="translate(${x},${y})"><path d="M0 18 q0 -18 12 -18 q12 0 12 18 l4 5 h-32 z" fill="${C.amber2}" stroke="${C.amber}" stroke-width="2"/><circle cx="12" cy="27" r="3.5" fill="${C.amber}"/></g>`;
const lines = (x, y, n, w, col = "#d8d2bd") => Array.from({ length: n }, (_, i) => `<rect x="${x}" y="${y + i * 8}" width="${w - (i % 3) * 8}" height="3" rx="1.5" fill="${col}"/>`).join("");
const calc = (x, y) => `<g transform="translate(${x},${y})"><rect width="30" height="42" rx="4" fill="#3c4a54"/><rect x="4" y="4" width="22" height="9" fill="#cfe3d9"/>${[0, 1, 2].map((r) => [0, 1, 2].map((c) => `<rect x="${4 + c * 8}" y="${17 + r * 8}" width="6" height="6" rx="1" fill="#9fb0ba"/>`).join("")).join("")}</g>`;
const excel = (x, y) => `<g transform="translate(${x},${y})"><rect width="50" height="58" rx="4" fill="#fff" stroke="#2e7d4f" stroke-width="2"/><rect width="50" height="13" rx="4" fill="#2e7d4f"/>${T(25, 10, "Excel", { size: 9, anchor: "middle", fill: "#fff", bold: true })}${[0, 1, 2].map((r) => `<line x1="4" x2="46" y1="${24 + r * 10}" y2="${24 + r * 10}" stroke="#cfe3d9"/>`).join("")}<line x1="20" x2="20" y1="15" y2="54" stroke="#cfe3d9"/></g>`;
const ring = (x, y) => `<ellipse cx="${x}" cy="${y}" rx="13" ry="5" fill="none" stroke="${C.red}" stroke-width="2"/>`;

/* ---------- 病人这边 ---------- */
const PAT = [
  { k: "填表", real: true,
    a: { v: "3分24秒", s: "纸质，一次填 38 题", pic: paperSheet(38, 2, 44, 66, 10, 10) },
    b: { v: "1分41秒", s: "平板，一屏一题", pic: tablet(34, 1, 52, 70, opts(28, 1) + `<rect x="6" y="8" width="28" height="3" rx="1.5" fill="${C.teal}"/>`) } },
  { k: "交完以后",
    a: { v: "等结果", s: "不知道分数，不知道还要做什么", pic: clock(44, 36, 22) + T(84, 48, "？", { size: 30, fill: C.mute, bold: true }) },
    b: { v: "✓ 完成", s: "交完就完成，安心等叫号", pic: tablet(34, 1, 52, 70, check(15, 30, 1.1) + T(26, 58, "已提交", { size: 9, anchor: "middle", fill: C.teal, bold: true })) } },
  { k: "3 个月后复测",
    a: { v: "靠记得", s: "回不回来，全靠自己记得", pic: `<g transform="translate(14,4) scale(.92)">${calendar(0, 0, "3 个月后")}</g>` + T(98, 48, "？", { size: 30, fill: C.mute, bold: true }) },
    b: { v: "到期提醒", s: "到期会被提醒（怎么联系由医院定）", pic: `<g transform="translate(10,4) scale(.92)">${calendar(0, 0, "3 个月后")}</g>` + bell(84, 18) } },
  { k: "高危时，谁注意到我", warn: true,
    a: { v: "等翻到", s: "要等医生翻到第 9 题才发现", pic: paperSheet(30, 2, 44, 66, 9, 9, { hi: 8 }) + clock(96, 22, 13) },
    b: { v: "立即置顶", s: "提交即在医生网页置顶", pic: monitor(14, 2, 92, 50, `<rect x="4" y="5" width="74" height="13" rx="3" fill="${C.red2}" stroke="${C.red}"/>${T(41, 15, "⚠ 高危提醒", { size: 9, anchor: "middle", fill: C.red, bold: true })}${lines(6, 24, 2, 60, C.line)}`), note: "非门诊时段谁接手，由医院定" } },
];

/* ---------- 医院这边 ---------- */
const FLOW = [
  { k: "算分", a: { v: "3 分钟/份", s: "手算、查表、抄进电脑", pic: paperSheet(14, 6, 40, 60, 8, 8) + calc(66, 18), est: 1 },
    b: { v: "提交即出", s: "电脑按量表标准算", pic: monitor(14, 2, 92, 50, [0, 1, 2].map((i) => `<rect x="4" y="${5 + i * 13}" width="74" height="10" rx="2" fill="#fff" stroke="${C.line}"/>`).join("") + check(60, 18, 0.7)) } },
  { k: "和上次比", a: { v: "2 分钟/份", s: "两张纸翻着对比", pic: paperSheet(20, 8, 40, 56, 7, 7) + paperSheet(58, 12, 40, 56, 7, 7), est: 1 },
    b: { v: "0.5 分钟/份", s: "看就诊记录和简报", pic: monitor(14, 2, 92, 50, T(6, 13, "诊前简报", { size: 8, fill: C.teal }) + lines(6, 18, 3, 64, C.line)), est: 1 } },
  { k: "复测登记", a: { v: "手工登记", s: "记在本子上", pic: `<rect x="22" y="6" width="76" height="60" rx="4" fill="${C.paper}" stroke="#c8c1a8"/>${lines(30, 16, 5, 58)}<path d="M84 50 l10 -24" stroke="#34495e" stroke-width="3" stroke-linecap="round"/>` },
    b: { v: "到期自动列出", s: "未完成的单独列出", pic: monitor(14, 2, 92, 50, `<rect x="4" y="5" width="74" height="12" rx="2" fill="${C.amber2}" stroke="#e6c27a"/>${T(8, 14, "复测到期", { size: 8, fill: C.amber, bold: true })}${lines(6, 24, 2, 60, C.line)}`) } },
  { k: "科室统计", a: { v: "年底翻纸", s: "或者干脆不统计", pic: [0, 1, 2, 3, 4, 5].map((i) => `<rect x="${30 + (i % 2) * 4}" y="${58 - i * 9}" width="60" height="8" fill="${C.paper}" stroke="#c8c1a8"/>`).join("") },
    b: { v: "随时导出", s: "科室看板 + Excel", pic: [22, 34, 28, 44].map((h, i) => `<rect x="${16 + i * 12}" y="${62 - h}" width="9" height="${h}" rx="1.5" fill="${C.teal}"/>`).join("") + excel(64, 8) } },
  { k: "原文档问题", a: { v: "藏在纸上", s: "没人专门去查", pic: paperSheet(38, 2, 44, 66, 9, 9) },
    b: { v: "3 处当场标出", s: "<span class=nw>第 9 题</span> · <span class=nw>1.33 空档</span> · <span class=nw>题号笔误</span>", pic: paperSheet(38, 2, 44, 66, 9, 9) + ring(64, 66 - 8) + ring(64, 34) + ring(64, 18) } },
];
// 各岗位的变化（可能；需医院确认）。每块 = 一件事，块数只表示方向示意，不是测量值。
// more：多做的事（红，左）；less：少做的事（绿，右）。[短标签, 完整说明, 宽度(块), 是否新增动作]
const ROLES = [
  { r: "护士", more: [["扫码", "贴码、引导病人扫码", 1, 1], ["提醒", "处理到期提醒", 1, 1]], less: [["收表", "收纸质表", 1], ["手算", "手算分、查对照表", 1], ["抄录", "抄进电脑", 1], ["登记", "手工登记复测", 1]] },
  { r: "医生", more: [["签字", "审阅签字", 1, 1], ["担责", "承担签字责任", 1]], less: [["手算", "手算分、查表", 1], ["翻纸", "翻上次的纸对比", 1]] },
  { r: "科室主任", more: [["透明", "科室数据变透明，好坏都看得见", 1]], less: [["统计", "年底翻纸统计", 1]] },
  { r: "信息科", more: [["维护", "多一套系统要维护", 2]], less: [] },
];
const GAINS = [["高危不漏", "第 9 题单题即置顶"], ["一致可查", "按量表标准算，原文档问题当场标出"], ["看全貌", "科室随时看统计"]];
const sumW = (a) => a.reduce((x, c) => x + c[2], 0);
const UNIT_ROW = 5;   // 岗位行：半边最多 5 块
/* 一行对照：之前（灰）→ 之后（品牌色） */
function row(it, i, o = {}) {
  const tag = (x, side) => (it.real ? `<span class="cmp-tag real">实测参考</span>` : (x.est ? `<span class="cmp-tag">示意</span>` : ""));
  return `<div class="cmp-row${it.warn ? " warn" : ""}" style="--i:${i}">
    <div class="cmp-k">${it.k}</div>
    <div class="cmp-cell before">${o.pic === false ? "" : svg(it.a.pic)}<div class="cmp-tx"><b class="cmp-v">${it.a.v}</b>${tag(it.a)}<span class="cmp-s">${it.a.s}</span></div></div>
    <div class="cmp-arr" aria-hidden="true"><span>→</span></div>
    <div class="cmp-cell after">${o.pic === false ? "" : svg(it.b.pic)}<div class="cmp-tx"><b class="cmp-v">${it.b.v}</b>${tag(it.b)}<span class="cmp-s">${it.b.s}</span>${it.b.note ? `<span class="cmp-note">${it.b.note}</span>` : ""}</div></div>
  </div>`;
}
const colHead = (a, b) => `<div class="cmp-row cmp-head"><div></div><div class="before">${a}</div><div></div><div class="after">${b}</div></div>`;

export function patientSide(root, bindGo) {
  const src = `<h2>出处与说明</h2><p>只有“填表”用了公开实测：美国匹兹堡大学医学中心（UPMC）儿科社区门诊，纸质平均 3 分 24 秒，平板平均 1 分 41 秒（Hanmer 等，Applied Clinical Informatics 2021，${SRC}）。这是儿科研究，仅作参考，不是贵院的数字。</p>
    <ul><li>“交完以后”：病人交完即完成；结果由医生审阅签字后才算数。</li><li>“到期提醒”：系统列出到期复测；用短信、电话还是别的方式联系病人，由医院定。</li><li>“高危提醒”：PHQ-9 第 9 题只要不是 0 分，医生网页立即置顶。目前只出现在医生网页上，非门诊时段谁接手由医院定。</li><li>病人和数据都是虚构的。</li></ul>`;
  root.innerHTML = `<div class="pg cmp-pg">
  <div class="ph"><div><h1>病人这边：少等、少填、不被漏掉</h1></div>
    <div class="ph-act">${pop("出处与说明", src, "info")}<a class="link small" data-go="visit">看完整一次就诊 →</a><a class="link small" data-go="patient">自己填一次 →</a></div></div>
  <div class="cmp">${colHead("之前 · 纸质量表", "之后 · 扫码填写")}${PAT.map((it, i) => row(it, i)).join("")}</div>
  </div>`;
  bindGo();
}

export function hospitalSide(root, bindGo) {
  const M = window.matchMedia("(max-width:820px)").matches;
  const chip = (c, cls) => `<span class="rk ${cls}${c[3] ? " isnew" : ""}" style="--w:${c[2]}" title="${c[1]}">${c[0]}</span>`;
  const roleRows = ROLES.map((x) => `<div class="rrow"><span class="rr">${x.r}</span>
      <span class="rl" style="--u:${100 / UNIT_ROW}%">${x.more.map((c) => chip(c, "m")).join("")}</span><i class="rax"></i>
      <span class="rg" style="--u:${100 / UNIT_ROW}%">${x.less.map((c) => chip(c, "p")).join("") || '<span class="rk none">—</span>'}</span></div>`).join("");
  const M_ = ROLES.reduce((a, x) => a + sumW(x.more), 0), P_ = ROLES.reduce((a, x) => a + sumW(x.less), 0), G_ = GAINS.length, MAXU = Math.max(M_, P_ + G_) + (M ? 4 : 3);
  const netRow = `<div class="rrow net"><span class="rr">合计</span>
      <span class="rl" style="--u:${100 / MAXU}%"><span class="rk m sum" style="--w:${M_}" title="各岗位多做的事加起来（示意）">多做</span></span><i class="rax"></i>
      <span class="rg" style="--u:${100 / MAXU}%"><span class="rk p sum" style="--w:${P_}" title="各岗位少做的事加起来（示意）">少做</span><span class="rk g sum" style="--w:${G_}" title="整体收益：高危不漏、一致可查、看全貌（示意）">整体</span><span class="netlbl">＝ 净收益</span></span></div>`;
  const roleText = ROLES.map((x) => `<li><b>${x.r}</b>：可能多了 ${x.more.map((c) => c[1]).join("、")}；可能少了 ${x.less.map((c) => c[1]).join("、") || "暂无明显减少"}。</li>`).join("");
  const note = `<h2>说明</h2><ul>
    <li>时长都是示意（手算录入 3 分钟、翻看对比 2 分钟、有简报后 0.5 分钟，取自“算一笔时间账”的默认假设值），不是实测，请按贵院实际改。</li>
    <li>原文档 3 处问题：PHQ-9 第 9 题（自伤念头）没有单独处理，只看总分；MENQOL 维度均分会出现 1.33 这样的小数，原分级只有整数档，落在空档；第 20、23 题下的程度编号写成“10.1”“13.1”。</li>
    <li>“各岗位”图：每一块是一件事，块数和长短只表示方向（多做 / 少做），不是测量值；都是可能的变化，需医院确认，不代表贵院实际流程。<ul>${roleText}</ul>“合计”一行：左边是各岗位多做的事加起来，右边是少做的事，再加上整体收益（高危不漏、一致可查、看全貌）。</li>
    <li>新增的三个动作：贴码扫码、医生审阅签字、处理到期提醒。</li></ul>`;
  root.innerHTML = `<div class="pg cmp-pg hos">
  <div class="ph"><div><h1>医院这边：局部有增有减，整体是净收益</h1></div>
    <div class="ph-act">${pop("说明", note, "info")}<a class="link small" data-go="doctor">打开医生端 →</a><a class="link small" data-go="confirm">上线前确认 →</a></div></div>
  <div class="gain">
    <div class="gain-h"><b>整体收益</b><span>岗位之间有增有减，科室整体得到：</span></div>
    <div class="gain3">${GAINS.map(([t, d]) => `<div><b>${t}</b><span>${d}</span></div>`).join("")}
    </div>
  </div>
  <div class="hos2">
    <section class="card hos-flow"><div class="sec-t">流程：之前 → 之后</div><div class="cmp sm">${colHead("之前 · 纸质", "之后 · 新做法")}${FLOW.map((it, i) => row(it, i, { pic: !M })).join("")}</div></section>
    <section class="card hos-roles"><div class="sec-t">各岗位：多做 ← │ → 少做 <span class="cmp-tag">示意</span><span class="cmp-tag amber">需医院确认</span></div>
      <div class="rgraph">${netRow}${roleRows}</div>
      <p class="hos-new"><span class="rk m isnew mini"></span><b>新增三个动作</b>贴码扫码 · 审阅签字 · 处理到期提醒</p>
    </section>
  </div></div>`;
  bindGo();
}
