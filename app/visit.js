/* ---------- 看一次就诊：同一位虚构病人，纸质量表 vs 新做法，自动播放 ----------
   只有“填表”一段用公开实测（UPMC 儿科门诊，Hanmer 2021，PMC8046593：纸质 3分24秒 → 平板 1分41秒）。
   其余时长一律为示意：手算录入 3 分钟、医生翻看对比 2 分钟、有简报后 0.5 分钟取自“算一笔时间账”的默认假设值。
   分数全部由 engine 现场计算，不手写。 */

const PAUSE_HOLD = 2.6;     // 停顿的真实秒数
const ANN = 4.5;            // 标注在时间轴上保留的秒数
const END_T = 119;          // 结尾总结出现
const TOTAL = 136;          // 时间轴总长（1× 时的秒数，不含停顿）

let P = null;               // 播放器状态

export function stopVisit() {
  if (P && P.raf) cancelAnimationFrame(P.raf);
  if (P) { P.playing = false; P.raf = 0; }
}

const mm = (s) => { s = Math.round(s); const m = Math.floor(s / 60), r = s % 60; return m ? `${m}分${String(r).padStart(2, "0")}秒` : `${r}秒`; };
const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const ease = (x) => 0.5 - Math.cos(Math.PI * clamp(x)) / 2;

/* ---------- SVG 小零件 ---------- */
const C = { ink: "#1d2a33", mute: "#8b98a1", line: "#d9e1e5", teal: "#0f6e6a", teal2: "#e3f2f0", red: "#c0392b", red2: "#fdecea", amber: "#a86b00", amber2: "#fff4dc", skin: "#f1d3bf", pat: "#d98ca0", nurse: "#7fb7c9", doc: "#ffffff", paper: "#fffdf6" };
const T = (x, y, s, o = {}) => `<text x="${x}" y="${y}" font-size="${o.size || 12}" fill="${o.fill || C.ink}" text-anchor="${o.anchor || "start"}" font-weight="${o.bold ? 700 : 400}">${s}</text>`;
function person(x, y, kind, s = 1) {
  const body = kind === "pat" ? C.pat : kind === "nurse" ? C.nurse : C.doc;
  const extra = kind === "doc" ? `<rect x="-15" y="-21" width="30" height="34" rx="12" fill="none" stroke="#9fb0ba" stroke-width="1.5"/><line x1="0" y1="-18" x2="0" y2="12" stroke="#9fb0ba"/><path d="M-6 -16 q6 14 12 0" fill="none" stroke="${C.teal}" stroke-width="1.6"/>`
    : kind === "nurse" ? `<rect x="-8" y="-50" width="16" height="6" rx="2" fill="#fff" stroke="${C.nurse}"/>` : "";
  return `<g transform="translate(${x},${y}) scale(${s})"><rect x="-15" y="-21" width="30" height="34" rx="12" fill="${body}"/><circle cy="-33" r="11" fill="${C.skin}"/>${extra}</g>`;
}
function paperSheet(x, y, w, h, rows, filled, opt = {}) {
  let g = `<g transform="translate(${x},${y})"><rect width="${w}" height="${h}" rx="4" fill="${C.paper}" stroke="#c8c1a8"/>`;
  const rh = (h - 16) / rows;
  for (let i = 0; i < rows; i++) {
    const yy = 10 + i * rh;
    g += `<rect x="8" y="${yy + 2}" width="${w * 0.5}" height="3" rx="1.5" fill="#d8d2bd"/>`;
    for (let k = 0; k < 4; k++) g += `<rect x="${w * 0.6 + k * (w * 0.09)}" y="${yy}" width="6" height="6" fill="none" stroke="#b9b29a" stroke-width=".8"/>`;
    if (i < filled) { const k = (i * 7 + 3) % 4; g += `<path d="M${w * 0.6 + k * (w * 0.09) - 1} ${yy + 3} l3 3 l6 -7" stroke="#2c3e50" stroke-width="1.4" fill="none"/>`; }
    if (opt.hi === i) g += `<ellipse cx="${w * 0.6 + w * 0.15}" cy="${yy + 3}" rx="${w * 0.24}" ry="${rh * 0.8}" fill="none" stroke="${C.red}" stroke-width="2"/>`;
  }
  return g + "</g>";
}
function tablet(x, y, w, h, inner) {
  return `<g transform="translate(${x},${y})"><rect width="${w}" height="${h}" rx="10" fill="#2b3a44"/><rect x="6" y="6" width="${w - 12}" height="${h - 12}" rx="6" fill="#fff"/>${inner}</g>`;
}
function monitor(x, y, w, h, inner) {
  return `<g transform="translate(${x},${y})"><rect x="${w / 2 - 6}" y="${h}" width="12" height="14" fill="#9fb0ba"/><rect x="${w / 2 - 26}" y="${h + 12}" width="52" height="5" rx="2" fill="#9fb0ba"/><rect width="${w}" height="${h}" rx="6" fill="#2b3a44"/><rect x="5" y="5" width="${w - 10}" height="${h - 10}" rx="3" fill="#f7fafb"/><g transform="translate(5,5)">${inner}</g></g>`;
}
function bubble(x, y, w, s, who = "doc", show = 1) {
  if (show <= 0) return "";
  const fill = who === "doc" ? C.teal2 : "#eef1f3";
  return `<g opacity="${clamp(show * 3)}" transform="translate(${x},${y})"><rect width="${w}" height="24" rx="10" fill="${fill}"/>${T(10, 16, s, { size: 11.5 })}</g>`;
}
function badgeNew(n) { return `<g transform="translate(232,8)"><rect width="120" height="22" rx="11" fill="${C.amber2}" stroke="#e6c27a"/>${T(60, 15, `新增动作 ${n}/3`, { size: 12, fill: C.amber, anchor: "middle", bold: true })}</g>`; }
function desk(y = 168) { return `<rect x="10" y="${y}" width="340" height="6" rx="3" fill="#e6ebee"/>`; }
function calendar(x, y, label) {
  return `<g transform="translate(${x},${y})"><rect width="74" height="66" rx="6" fill="#fff" stroke="${C.line}"/><rect width="74" height="18" rx="6" fill="${C.teal}"/><rect y="12" width="74" height="6" fill="${C.teal}"/>${T(37, 46, label, { size: 15, anchor: "middle", bold: true, fill: C.teal })}</g>`;
}
function qr(x, y, s) {
  let g = `<g transform="translate(${x},${y})"><rect width="${s}" height="${s}" fill="#fff" stroke="${C.ink}" stroke-width="1.5"/>`;
  const n = 7, c = (s - 8) / n;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) if ((i * 3 + j * 5 + i * j) % 3 === 0 || (i < 2 && j < 2) || (i > 4 && j < 2) || (i < 2 && j > 4)) g += `<rect x="${4 + i * c}" y="${4 + j * c}" width="${c}" height="${c}" fill="${C.ink}"/>`;
  return g + "</g>";
}

/* ---------- 演示数据（虚构病人），分数由 engine 现场计算 ---------- */
function buildData(D) {
  const ma = (m) => { const a = {}; for (let i = 1; i <= 29; i++) a["m" + i] = "no"; return Object.assign(a, m); };
  const prevM = D.score(D.SKILLS.menqol, ma({ m1: 4, m2: 3, m3: 2, m14: 3, m16: 2, m19: 2 }));
  const curM = D.score(D.SKILLS.menqol, ma({ m1: 0, m14: 2, m16: 1, m19: 1 }));
  const phqAns = { q1: 1, q2: 1, q3: 1, q4: 1, q5: 0, q6: 1, q7: 0, q8: 0, q9: 1 };
  const phq = D.score(D.SKILLS.phq9, phqAns);
  const vaso = curM.domains[0], vasoPrev = prevM.domains[0];
  return { prevM, curM, phq, phqAns, vaso, vasoPrev,
    oldPHQ: D.legacyPHQ(phq.total), oldVaso: D.legacyMENQOL(vaso.score),
    q9opt: D.SKILLS.phq9.items.find((i) => i.id === "q9")?.options?.find((o) => o.value === 1)?.label || "好几天",
    crisisDoc: phq.crises[0]?.doctor || "" };
}

/* ---------- 场景表 ---------- */
// clinic：这一段在门诊里的时长（秒）；real：是否为公开实测；when：发生在什么时候
function buildScenes(d) {
  const sumStr = Object.values(d.phqAns).join("+");
  const L = [
    { t0: 0, t1: 8, clinic: 30, when: "候诊", title: "发纸质表", cap: "挂号后，护士发纸质表和笔：MENQOL 29 题 + PHQ-9 9 题。",
      draw: (p) => desk() + person(70, 150, "nurse") + person(280, 150, "pat") + `<g transform="translate(${90 + ease(p) * 140},${112 - Math.sin(Math.PI * p) * 20})">${paperSheet(0, 0, 34, 44, 6, 0)}</g>` },
    { t0: 8, t1: 32, clinic: 204, real: true, when: "候诊", title: "病人用笔填表", cap: "病人在候诊区用笔一题一题填。纸质平均 3分24秒（UPMC 儿科门诊实测，仅作参考）。",
      draw: (p) => { const n = Math.floor(p * 38); return desk() + person(70, 150, "pat") + paperSheet(130, 22, 120, 140, 12, Math.min(12, n % 13 === 0 && n ? 12 : n % 13)) + T(260, 40, `第 ${Math.max(1, n)} / 38 题`, { size: 12, fill: C.mute }) + `<path d="M${140 + (n % 4) * 25} ${40 + (n % 12) * 10} l14 -26" stroke="#34495e" stroke-width="3" stroke-linecap="round"/>` + (n >= 37 ? T(260, 60, `第 9 题：${d.q9opt}`, { size: 12, fill: C.red }) : ""); } },
    { t0: 32, t1: 40, clinic: 30, when: "候诊", title: "护士收表", cap: "护士收表，夹进病历，等着算分。",
      draw: (p) => desk() + person(80, 150, "nurse") + `<g transform="translate(${230 - ease(p) * 110},${70 + ease(p) * 30})">${paperSheet(0, 0, 50, 64, 7, 7)}</g>` + `<rect x="250" y="120" width="80" height="44" rx="4" fill="#e9dfc7" stroke="#c8b98f"/>` + T(290, 147, "病历夹", { size: 12, anchor: "middle", fill: "#7d6a3d" }) },
    { t0: 40, t1: 64, clinic: 180, when: "候诊", title: "手算分、查对照表、抄进电脑", short: "手算查表", sub: true,
      cap: (p) => p < 0.42 ? `护士或医生逐题相加：PHQ-9 总分 ${d.phq.total}，查原文档 →“${d.oldPHQ}”。`
        : p < 0.67 ? `翻到第 9 题才看到：选了“${d.q9opt}”（1 分）。总分里看不出来。`
        : `MENQOL 血管舒缩维度：(2+1+1)÷3 = ${d.vaso.score}，原文档对照表里查不到这一档。`,
      draw: (p) => {
        let g = desk() + paperSheet(20, 20, 110, 140, 9, 9, p >= 0.42 && p < 0.67 ? { hi: 8 } : {});
        g += `<g transform="translate(150,90)"><rect width="56" height="76" rx="6" fill="#3c4a54"/><rect x="6" y="6" width="44" height="16" fill="#cfe3d9"/>${[0, 1, 2].map((r) => [0, 1, 2].map((c) => `<rect x="${7 + c * 15}" y="${28 + r * 15}" width="12" height="11" rx="2" fill="#9fb0ba"/>`).join("")).join("")}</g>`;
        if (p < 0.42) { const k = Math.floor(clamp(p / 0.36) * 9); g += T(220, 50, "PHQ-9 相加", { size: 12, fill: C.mute }) + T(220, 72, sumStr.split("+").slice(0, k).join("+") || "…", { size: 12 }) + (p > 0.36 ? T(220, 96, `= ${d.phq.total} → ${d.oldPHQ}`, { size: 13, bold: true }) : ""); }
        else if (p < 0.67) g += T(220, 60, "第 9 题 = 1", { size: 14, bold: true, fill: C.red }) + T(220, 82, "这时才发现", { size: 13, fill: C.red });
        else { g += T(220, 44, `(2+1+1)÷3 = ${d.vaso.score}`, { size: 13, bold: true }); const bands = ["1", "2–4", "5–6", "7–8"];
          g += bands.map((b, i) => `<rect x="${220 + i * 32}" y="60" width="30" height="22" fill="#fff" stroke="${C.line}"/>${T(235 + i * 32, 75, b, { size: 11, anchor: "middle" })}`).join("");
          if (p > 0.78) g += `<path d="M251 96 l0 -12" stroke="${C.red}" stroke-width="2"/>` + T(251, 112, "？查不到", { size: 13, anchor: "middle", fill: C.red, bold: true }); }
        return g; } },
    { t0: 66, t1: 86, clinic: 120, when: "诊间", title: "诊间：翻上次的纸对比", short: "翻纸对比", cap: "医生一手这次、一手上次的纸，边翻边问；和上次比全靠翻找和记忆。",
      draw: (p) => desk() + person(70, 150, "doc") + person(290, 150, "pat") + paperSheet(96, 108, 34, 46, 5, 5) + paperSheet(136 + Math.sin(p * 20) * 3, 112, 34, 46, 5, 5) +
        bubble(40, 20, 170, "上次潮热是几分来着？", "doc", p - 0.05) + bubble(150, 54, 150, "记不太清了……", "pat", p - 0.35) + bubble(40, 88 - 0, 150, "我再翻翻上次的表。", "doc", p - 0.65) },
    { t0: 86, t1: 98, clinic: 60, when: "诊后", title: "手工登记复测", cap: "医生或护士在本子上登记“3 个月后复测”。回不回来，靠病人自己记得。",
      draw: (p) => desk() + `<g transform="translate(90,40)"><rect width="180" height="120" rx="6" fill="${C.paper}" stroke="#c8c1a8"/>${[0, 1, 2, 3, 4].map((i) => `<line x1="12" x2="168" y1="${24 + i * 20}" y2="${24 + i * 20}" stroke="#e3dcc6"/>`).join("")}<clipPath id="vzc"><rect x="0" y="0" width="${20 + p * 150}" height="120"/></clipPath><g clip-path="url(#vzc)">${T(16, 40, "赵女士　3 个月后复测", { size: 14, fill: "#2c3e50" })}</g><path d="M${16 + p * 150} 44 l12 -30" stroke="#34495e" stroke-width="3" stroke-linecap="round"/></g>` },
    { t0: 98, t1: 118, clinic: 0, tag: "不计时", when: "3 个月后", title: "3 个月后", cap: "没有到期提醒：病人记得就回来，忘了就断了。科室要统计，只能年底翻一摞纸。",
      draw: (p) => desk() + calendar(30, 30, "3 个月后") + person(170, 150, "pat") + `<g opacity="${clamp(p * 4)}">${T(196, 92, "？", { size: 30, fill: C.mute, bold: true })}</g>` + `<g opacity="${clamp(p * 2 - 0.6)}">${[0, 1, 2, 3, 4, 5].map((i) => `<rect x="${250 + (i % 2) * 3}" y="${150 - i * 9}" width="70" height="8" fill="${C.paper}" stroke="#c8c1a8"/>`).join("")}${T(285, 82, "年底翻纸统计", { size: 11.5, anchor: "middle", fill: C.mute })}</g>` },
  ];
  const brief = `血管舒缩 ${d.vasoPrev.score} → ${d.vaso.score}，好转`;
  const R = [
    { t0: 0, t1: 6, clinic: 20, when: "候诊", title: "贴码扫码", isNew: 1, cap: "护士把二维码贴在桌上，病人扫码打开问卷（也可以用科室平板）。",
      draw: (p) => desk() + badgeNew(1) + person(70, 150, "nurse") + qr(130, 110, 50) + person(280, 150, "pat") + tablet(222, 96, 44, 62, "") + `<path d="M222 ${110 + Math.sin(p * 12) * 14} L184 ${135}" stroke="${C.teal}" stroke-width="2" stroke-dasharray="4 3" opacity="${clamp(p * 3)}"/>` },
    { t0: 6, t1: 17.9, clinic: 101, real: true, when: "候诊", title: "平板上一屏一题", cap: "病人在平板上一屏一题点选。平板平均 1分41秒（同一研究，仅作参考）。",
      draw: (p) => { const n = Math.max(1, Math.ceil(p * 38)); const q9 = n >= 37;
        return desk() + person(70, 150, "pat") + tablet(130, 20, 150, 146, `<rect x="16" y="16" width="${118 * p}" height="5" rx="2" fill="${C.teal}"/><rect x="16" y="16" width="118" height="5" rx="2" fill="none" stroke="${C.line}"/>` + T(16, 42, q9 ? "PHQ-9 第 9 题" : `第 ${n} / 38 题`, { size: 12, fill: C.mute }) +
          ["完全不会", "好几天", "一半以上的天数", "几乎每天"].map((o, i) => { const on = q9 ? i === 1 : i === n % 4; return `<rect x="16" y="${52 + i * 20}" width="118" height="16" rx="5" fill="${on ? C.teal2 : "#fff"}" stroke="${on ? C.teal : C.line}"/>${T(24, 64 + i * 20, o, { size: 10.5 })}`; }).join("")); } },
    { t0: 18, t1: 28, clinic: 0, tag: "提交即出分 · 0 秒", when: "候诊", title: "提交即出分 · 高危提醒", cap: `提交即出分，电脑按量表标准算：PHQ-9 ${d.phq.total} 分（${d.phq.band.label}）。第 9 题非零，医生网页立刻置顶高危提醒。`,
      draw: (p) => desk() + tablet(18, 70, 70, 92, `${T(29, 44, "已提交", { size: 12, anchor: "middle", fill: C.teal, bold: true })}<path d="M20 54 l7 7 l13 -14" stroke="${C.teal}" stroke-width="3" fill="none"/>`) +
        `<path d="M96 116 L ${96 + ease(p * 2) * 40} 116" stroke="${C.teal}" stroke-width="2.5" marker-end="url(#vzarr)"/>` +
        monitor(146, 14, 200, 128, `<rect x="6" y="6" width="${178}" height="30" rx="4" fill="${C.red2}" stroke="${C.red}" opacity="${clamp(p * 4 - 0.3)}"/>${p > 0.1 ? T(14, 26, "⚠ 高危提醒 · 第 9 题 1 分", { size: 11.5, fill: C.red, bold: true }) : ""}` +
          `<rect x="6" y="44" width="178" height="22" rx="4" fill="#fff" stroke="${C.line}"/>${T(14, 59, `PHQ-9 ${d.phq.total} 分 · ${d.phq.band.label}`, { size: 11 })}` +
          `<rect x="6" y="72" width="178" height="22" rx="4" fill="#fff" stroke="${C.line}"/>${T(14, 87, `MENQOL 已算好 · 血管舒缩 ${d.vaso.score}`, { size: 11 })}`) },
    { t0: 28, t1: 66, clinic: 0, wait: true, when: "候诊", title: "候诊（已完成，等叫号）",
      cap: (p, t) => (t >= 57 && t < 66) ? `MENQOL 血管舒缩 ${d.vaso.score} 分：按草案区间暂列“${d.vaso.band.label}”，并标“原标准此处有空档，需主任审定”。` : "病人候诊。医生网页上，高危提醒一直置顶，MENQOL 各维度已算好。",
      draw: (p, t) => { const hi = t >= 57 && t < 66; return desk() + person(48, 150, "pat", 0.9) + T(48, 172 - 6, "", {}) +
        monitor(96, 6, 250, 146, `<rect x="6" y="6" width="228" height="26" rx="4" fill="${C.red2}" stroke="${C.red}"/>${T(14, 24, "⚠ 高危提醒置顶 · 需当日人工评估", { size: 11.5, fill: C.red, bold: true })}` +
          T(8, 50, "MENQOL 各维度", { size: 11, fill: C.mute }) +
          d.curM.domains.map((x, i) => { const flag = i === 0; const y = 58 + i * 18; return `<rect x="6" y="${y}" width="228" height="16" rx="3" fill="${flag && hi ? C.amber2 : "#fff"}" stroke="${flag && hi ? "#e6c27a" : C.line}"/>${T(12, y + 12, `${x.name.replace("症状", "").replace("状态", "")} ${x.score ?? "—"}`, { size: 10.5 })}${flag ? T(228, y + 12, hi ? "原标准此处有空档，需主任审定" : `${x.band.label}`, { size: 10, anchor: "end", fill: hi ? C.amber : C.mute, bold: hi }) : T(228, y + 12, x.band ? x.band.label : "", { size: 10, anchor: "end", fill: C.mute })}`; }).join("")); } },
    { t0: 66, t1: 78, clinic: 30, when: "诊间", title: "诊间：看简报", short: "看简报", cap: "医生打开就是简报：这次和上次比，哪里变了。外部大模型默认关闭，简报不靠它。",
      draw: (p) => desk() + person(40, 150, "doc") + person(320, 150, "pat", 0.9) +
        monitor(70, 6, 210, 112, T(8, 18, "诊前简报 · 自动生成", { size: 11, fill: C.teal }) + T(8, 38, brief, { size: 11.5 }) + T(8, 56, `PHQ-9 ${d.phq.total} 分，第 9 题阳性`, { size: 11.5, fill: C.red }) +
          `<rect x="6" y="64" width="188" height="34" rx="5" fill="#eef1f3" stroke="#c9d1d6" stroke-dasharray="4 3"/>${T(14, 79, "外部大模型 · 只作参考", { size: 10.5, fill: "#9aa6ae" })}${T(14, 93, "（默认关闭）", { size: 10.5, fill: "#9aa6ae" })}<rect x="150" y="74" width="30" height="14" rx="7" fill="#c9d1d6"/><circle cx="158" cy="81" r="5" fill="#fff"/>`) +
        bubble(88, 142, 200, "潮热比上次好多了。", "doc", p - 0.2) },
    { t0: 78, t1: 86, clinic: 30, when: "诊间", title: "医生审阅签字", isNew: 2, cap: "医生看完，点“审阅并签字”，结果才算数。",
      draw: (p) => desk() + badgeNew(2) + person(50, 150, "doc") + monitor(90, 30, 200, 110, T(10, 22, "赵女士 · 本次量表", { size: 11.5, bold: true }) +
        `<rect x="40" y="44" width="110" height="30" rx="8" fill="${p > 0.55 ? "#fff" : C.teal}" stroke="${C.teal}"/>${T(95, 64, p > 0.55 ? "✓ 已签字" : "审阅并签字", { size: 12, anchor: "middle", fill: p > 0.55 ? C.teal : "#fff", bold: true })}`) +
        `<path d="M${260 - ease(p * 1.8) * 70} ${150 - ease(p * 1.8) * 50} l0 16 l5 -5 l7 9 l3 -2 l-7 -9 l7 0 z" fill="#fff" stroke="${C.ink}"/>` },
    { t0: 86, t1: 106, clinic: 60, when: "3 个月后", title: "处理到期提醒", isNew: 3, cap: "3 个月后，到期复测自动列出；护士处理到期提醒（怎么联系病人由医院定）。",
      draw: (p) => desk() + badgeNew(3) + calendar(14, 40, "3 个月后") + person(320, 150, "nurse", 0.9) + monitor(100, 34, 196, 110, T(8, 18, "到期提醒", { size: 11.5, bold: true }) +
        `<rect x="6" y="28" width="174" height="26" rx="4" fill="${p > 0.6 ? "#f3f6f7" : C.amber2}" stroke="${p > 0.6 ? C.line : "#e6c27a"}"/>${T(12, 45, "赵女士 · 复测到期", { size: 11 })}${T(176, 45, p > 0.6 ? "已处理" : "待处理", { size: 10.5, anchor: "end", fill: p > 0.6 ? C.teal : C.amber, bold: true })}` +
        `<rect x="6" y="60" width="174" height="22" rx="4" fill="#fff" stroke="${C.line}"/>${T(12, 75, "未完成的单独列出", { size: 10.5, fill: C.mute })}`) },
    { t0: 106, t1: 118, clinic: 0, tag: "随时可看 · 不计时", when: "随时", title: "科室统计 · 导出 Excel", cap: "科室统计随时看，可导出 Excel，不用年底翻纸。",
      draw: (p) => desk() + monitor(30, 20, 180, 120, [30, 52, 40, 64, 58, 72].map((h, i) => `<rect x="${14 + i * 26}" y="${100 - h * clamp(p * 2)}" width="18" height="${h * clamp(p * 2)}" rx="2" fill="${C.teal}"/>`).join("")) +
        `<g opacity="${clamp(p * 3 - 1)}" transform="translate(236,52)"><rect width="84" height="96" rx="6" fill="#fff" stroke="#2e7d4f" stroke-width="2"/><rect width="84" height="20" rx="6" fill="#2e7d4f"/>${T(42, 15, "Excel", { size: 12, anchor: "middle", fill: "#fff", bold: true })}${[0, 1, 2, 3].map((r) => `<line x1="6" x2="78" y1="${36 + r * 16}" y2="${36 + r * 16}" stroke="#cfe3d9"/>`).join("")}<line x1="34" x2="34" y1="24" y2="90" stroke="#cfe3d9"/></g>` },
  ];
  return { L, R };
}

const PAUSES = [
  { t: 20, side: "both", title: "停顿 · 第 9 题选了非零（自伤念头）",
    body: (d) => `新做法：病人一提交，医生网页立刻置顶高危提醒。纸质：表还在病人手里，要等收表、翻到第 9 题才会发现。<b>提醒目前只出现在医生网页上，非门诊时段谁接手由医院定。</b>` },
  { t: 60, side: "both", title: "停顿 · MENQOL 某维度均分 1.33",
    body: (d) => `血管舒缩维度 (2+1+1)÷3 = ${d.vaso.score}。原文档分级只有整数档（1 / 2–4 / 5–6 / 7–8），${d.vaso.score} 落在空档，原件查不到。新做法照样算出分数，并标<b>“原标准此处有空档，需主任审定”</b>。` },
  { t: 72, side: "R", title: "停顿 · 外部大模型默认关闭",
    body: () => `简报里的数字都由电脑按量表标准算出。右边灰掉的<b>“外部大模型 · 只作参考（默认关闭）”</b>：开启前须医院同意；不开也能完整运行。` },
  { t: 100, side: "R", title: "停顿 · 新做法新增的三个动作",
    body: () => `<b>贴码扫码 ✓　医生审阅签字 ✓　处理到期提醒 ✓</b><br>这三件是护士和医生多出来的工作，时长已经算进右边的计时器（示意）。` },
];

/* ---------- 计时 ---------- */
function clinicAt(scenes, t) {
  let s = 0, cur = null;
  for (const sc of scenes) {
    if (t >= sc.t1) s += sc.clinic;
    else if (t >= sc.t0) { s += sc.clinic * (t - sc.t0) / (sc.t1 - sc.t0); cur = sc; }
  }
  return { s, cur };
}
const sceneAt = (scenes, t) => scenes.find((s) => t >= s.t0 && t < s.t1) || (t >= scenes.at(-1).t1 ? scenes.at(-1) : scenes[0]);

/* ---------- 视图 ---------- */
export function visitView(root, D) {
  stopVisit();
  const d = buildData(D), S = buildScenes(d);
  const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const totL = S.L.reduce((a, s) => a + s.clinic, 0), totR = S.R.reduce((a, s) => a + s.clinic, 0);
  const stepList = (arr) => `<ol class="vz-steps">${arr.map((s, i) => `<li data-i="${i}">${s.isNew ? '<span class="vz-new">新增</span>' : ""}${s.title}</li>`).join("")}</ol>`;
  root.innerHTML = `<div class="vz">
  <div class="vz-head">
    <h1>看一次就诊：纸质量表 vs 新做法</h1>
    <p class="lead">同一位病人、同一次复诊，左右同时播放。只看，不用点。</p>
    <p class="vz-who"><span class="tag amber">演示用虚构病人</span><span class="small muted">赵女士，51 岁，更年期门诊复诊；填 MENQOL 和 PHQ-9。</span></p>
  </div>
  <div class="vz-timers">
    <div class="vz-timer old"><div class="small muted">纸质 · 量表相关累计用时</div><div class="vz-clock" id="vzcL">0秒</div><div class="vz-seg" id="vzsL"></div></div>
    <div class="vz-timer new"><div class="small muted">新做法 · 量表相关累计用时</div><div class="vz-clock" id="vzcR">0秒</div><div class="vz-seg" id="vzsR"></div></div>
  </div>
  <div class="vz-note" id="vznote" aria-live="polite"></div>
  <div class="vz-split" id="vzsplit">
    <section class="vz-side old"><h2>现在：纸质量表</h2><div class="vz-stage"><div class="vz-when" id="vzwL"></div><svg viewBox="0 0 360 180" id="vzgL" role="img" aria-label="纸质量表流程动画"></svg><p class="vz-cap" id="vzpL"></p></div>${stepList(S.L)}</section>
    <section class="vz-side new"><h2>新做法</h2><div class="vz-stage"><div class="vz-when" id="vzwR"></div><svg viewBox="0 0 360 180" id="vzgR" role="img" aria-label="新做法流程动画"></svg><p class="vz-cap" id="vzpR"></p></div>${stepList(S.R)}</section>
    <div class="vz-end" id="vzend" hidden>
      <h2>看完了：这是演示样品，不是成品</h2>
      <div class="vz-endgrid">
        <div class="card"><h3>医生少做的三件事</h3><ul><li>免手算分</li><li>免翻纸对比</li><li>免手工登记复测</li></ul></div>
        <div class="card vz-newcard"><h3>新增的三个动作</h3><ul><li>贴码扫码</li><li>医生审阅签字</li><li>处理到期提醒</li></ul></div>
        <div class="card"><h3>还要医院来定</h3><ul><li>高危提醒目前只在医生网页上，非门诊时段谁接手</li><li>MENQOL 空档分数的分级，需主任审定</li><li>外部大模型默认关闭，是否开启</li></ul></div>
      </div>
      <p class="small muted">病人是虚构的。只有“填表”一段用了公开实测（儿科研究，仅作参考），其余时长都是示意。右边合计（示意）<span class="nw">${mm(totR)}</span>，含新增动作；左边合计（示意）<span class="nw">${mm(totL)}</span>。</p>
      <div class="row"><button class="btn" id="vzagain">再看一遍</button><button class="btn ghost" data-go="value">看“一眼看懂”</button></div>
    </div>
  </div>
  <div class="vz-ctrl" id="vzctrl">
    <button class="btn" id="vzplay" aria-label="播放或暂停">▶ 播放</button>
    <div class="vz-track"><input type="range" id="vzrange" min="0" max="${TOTAL}" step="0.1" value="0" aria-label="时间轴">${PAUSES.map((p) => `<i style="left:${(p.t / TOTAL) * 100}%"></i>`).join("")}</div>
    <span class="small muted vz-time" id="vztime"></span>
    <button class="btn ghost" id="vzre">重播</button>
    <div class="seg" id="vzspd">${[0.5, 1, 2].map((s) => `<button data-s="${s}" class="${s === 1 ? "on" : ""}">${s}×</button>`).join("")}</div>
  </div>
  <p class="small muted vz-src">计时说明：只有“填表”一段用了公开实测——美国匹兹堡大学医学中心（UPMC）儿科社区门诊，纸质平均 3分24秒，平板平均 1分41秒（Hanmer 等，Applied Clinical Informatics 2021，<a class="link" href="https://pmc.ncbi.nlm.nih.gov/articles/PMC8046593" target="_blank" rel="noopener">原文</a>）；这是儿科研究，仅作参考。其余环节的时长一律是示意：手算录入 3 分钟、医生翻看对比 2 分钟、有简报后 0.5 分钟取自“算一笔时间账”的默认假设值，其他为估计，不是实测。分数由电脑按量表标准现场算出。</p>
  <div id="vzstatic"></div>
</div>`;

  const $ = (s) => root.querySelector(s);
  P = { t: 0, playing: false, speed: 1, raf: 0, last: 0, hold: 0, held: new Set(), mode: reduce ? "static" : "anim" };
  const defs = `<defs><marker id="vzarr" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0 L10 5 L0 10 z" fill="${C.teal}"/></marker></defs>`;

  function side(k, t) {
    const arr = S[k], sc = sceneAt(arr, t), p = clamp((t - sc.t0) / (sc.t1 - sc.t0));
    $("#vzg" + k).innerHTML = defs + sc.draw(p, t);
    $("#vzp" + k).textContent = typeof sc.cap === "function" ? sc.cap(p, t) : sc.cap;
    $("#vzw" + k).innerHTML = `<span class="tag gray">${sc.when}</span>${sc.isNew ? `<span class="tag amber">新增动作 ${sc.isNew}/3</span>` : ""}`;
    root.querySelectorAll(`.vz-side.${k === "L" ? "old" : "new"} .vz-steps li`).forEach((li, i) => { li.className = t >= arr[i].t1 ? "done" : arr[i] === sc ? "cur" : ""; });
    const c = clinicAt(arr, t);
    $("#vzc" + k).textContent = mm(c.s);
    const cur = c.cur;
    $("#vzs" + k).innerHTML = P.t >= END_T ? `<span class="tag gray">合计（示意）</span>` : !cur ? (t >= arr.at(-1).t1 ? `<span class="tag gray">合计（示意）</span>` : "") : cur.real ? `<span class="tag">填表 · 实测参考</span>` : cur.wait ? `<span class="tag gray">已完成，等叫号</span>` : cur.clinic ? `<span class="tag gray">${cur.short || cur.title} · 示意</span>` : `<span class="tag gray">${cur.tag || "不计时"}</span>`;
  }
  function draw() {
    const t = P.t;
    side("L", Math.min(t, 117.99)); side("R", Math.min(t, 117.99));
    const pa = PAUSES.find((p) => t >= p.t && t < p.t + ANN);
    const note = $("#vznote");
    if (pa) { note.innerHTML = `<b>${pa.title}</b><br>${pa.body(d)}`; note.className = "vz-note on"; }
    else if (t >= 50.1 && t < 57) { note.innerHTML = `<b>纸质这边，此时才在第 9 题上发现自伤念头。</b><br>新做法在病人提交时就已提醒。`; note.className = "vz-note soft"; }
    else { note.innerHTML = ""; note.className = "vz-note"; }
    root.querySelectorAll(".vz-side").forEach((s) => s.classList.toggle("hl", !!pa && (pa.side === "both" || (pa.side === "R" && s.classList.contains("new")))));
    $("#vzend").hidden = t < END_T; root.querySelector(".vz").classList.toggle("ended", t >= END_T);
    $("#vzrange").value = t;
    $("#vztime").textContent = `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")} / ${Math.floor(TOTAL / 60)}:${String(TOTAL % 60).padStart(2, "0")}`;
    $("#vzplay").textContent = P.playing ? "❚❚ 暂停" : "▶ 播放";
  }
  function tick(now) {
    if (!P || !P.playing) return;
    const dt = Math.min(0.1, (now - P.last) / 1000); P.last = now;
    if (P.hold > 0) P.hold -= dt;
    else {
      const nt = P.t + dt * P.speed, pa = PAUSES.find((p) => P.t < p.t && nt >= p.t && !P.held.has(p.t));
      if (pa) { P.t = pa.t + 0.01; P.held.add(pa.t); P.hold = PAUSE_HOLD; } else P.t = nt;
      if (P.t >= TOTAL) { P.t = TOTAL; P.playing = false; }
    }
    draw();
    if (P.playing) P.raf = requestAnimationFrame(tick);
  }
  function setMode(m) { P.mode = m; root.querySelector(".vz").classList.toggle("static", m === "static"); if (m === "static") renderStatic(); else $("#vzstatic").innerHTML = ""; }
  function play() { if (P.mode === "static") setMode("anim"); if (P.t >= TOTAL) seek(0); P.playing = true; P.last = performance.now(); cancelAnimationFrame(P.raf); P.raf = requestAnimationFrame(tick); draw(); }
  function pause() { P.playing = false; cancelAnimationFrame(P.raf); draw(); }
  function seek(t) { P.t = clamp(t, 0, TOTAL); P.hold = 0; P.held = new Set(PAUSES.filter((p) => p.t < P.t).map((p) => p.t)); draw(); }
  function renderStatic() {
    const card = (sc, k) => `<div class="vz-scard ${sc.isNew ? "isnew" : ""}"><div><span class="tag gray">${sc.when}</span>${sc.isNew ? `<span class="tag amber">新增动作 ${sc.isNew}/3</span>` : ""}${sc.real ? `<span class="tag">实测参考</span>` : sc.clinic ? `<span class="tag gray">示意 ${mm(sc.clinic)}</span>` : ""}</div><b>${sc.title}</b><svg viewBox="0 0 360 180">${defs}${sc.draw(1, sc.t1 - 0.01)}</svg><p class="small">${typeof sc.cap === "function" ? sc.cap(1, sc.t1 - 0.01) : sc.cap}</p></div>`;
    $("#vzstatic").innerHTML = `<h2>分步看（已按系统设置关闭自动播放，可点上方“播放”）</h2>
      <div class="vz-sgrid"><div><h3>现在：纸质量表</h3>${S.L.map((s) => card(s, "L")).join("")}</div><div><h3>新做法</h3>${S.R.map((s) => card(s, "R")).join("")}</div></div>
      <h3>四个停顿点</h3>${PAUSES.map((p) => `<div class="vz-note on static"><b>${p.title}</b><br>${p.body(d)}</div>`).join("")}`;
  }

  $("#vzplay").onclick = () => (P.playing ? pause() : play());
  $("#vzre").onclick = () => { seek(0); play(); };
  $("#vzagain").onclick = () => { seek(0); play(); };
  $("#vzrange").oninput = (e) => { seek(+e.target.value); };
  root.querySelectorAll("#vzspd button").forEach((b) => (b.onclick = () => { P.speed = +b.dataset.s; root.querySelectorAll("#vzspd button").forEach((x) => x.classList.toggle("on", x === b)); }));
  if (D.bindGo) D.bindGo();
  window.__vz = { seek: (t) => { pause(); seek(t); }, play, pause, state: () => ({ t: P.t, playing: P.playing, mode: P.mode, speed: P.speed }), pauses: PAUSES.map((p) => p.t), END_T, TOTAL };

  seek(0);
  if (reduce) setMode("static"); else play();
}
