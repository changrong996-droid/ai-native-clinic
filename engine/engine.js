// 确定性层：计分、分级、危机规则、随访规则。
// 纯函数，不调用 AI，不依赖浏览器。同一份技能包 + 同一组答案 = 永远同一个结果。

const round2 = (x) => Math.round(x * 100) / 100;

export function inBand(v, b) {
  const lowOk = b.minExclusive ? v > b.min : v >= b.min;
  const highOk = b.maxExclusive ? v < b.max : v <= b.max;
  return lowOk && highOk;
}

export function findBand(bands, v) {
  const hit = bands.filter((b) => inBand(v, b));
  if (hit.length !== 1) throw new Error(`分值 ${v} 命中 ${hit.length} 个分级区间，技能包区间定义有误`);
  return hit[0];
}

// 答案格式：
//  choice:        { q1: 2 }
//  yes_severity:  { m1: "no" } | { m1: 3 }（0–6，表示“是”及困扰程度） | { m1: "na" }
export function validate(skill, answers) {
  const missing = [];
  for (const it of skill.items) {
    const a = answers[it.id];
    if (a === undefined || a === null) { missing.push(it.id); continue; }
    if (it.type === "choice" && !it.options.some((o) => o.value === a)) throw new Error(`${it.id} 的答案 ${a} 不在选项中`);
    if (it.type === "yes_severity") {
      const ok = a === "no" || (a === "na" && it.allowNA) || (Number.isInteger(a) && a >= 0 && a <= 6);
      if (!ok) throw new Error(`${it.id} 的答案 ${a} 无效`);
    }
  }
  return missing;
}

export function score(skill, answers) {
  const missing = validate(skill, answers);
  if (missing.length) return { complete: false, missing };

  const notes = [];
  let total, domains = null;

  if (skill.scoring.method === "sum") {
    total = skill.items.reduce((s, it) => s + answers[it.id], 0);
  } else if (skill.scoring.method === "menqol") {
    const conv = (a) => (a === "no" ? 1 : a === "na" ? null : a + 2);
    domains = skill.scoring.domains.map((d) => {
      const vals = d.items.map((id) => conv(answers[id]));
      const used = vals.filter((v) => v !== null);
      if (used.length === 0) return { id: d.id, name: d.name, score: null, band: null, notApplicable: true };
      if (used.length < vals.length) notes.push(`${d.name}维度有 ${vals.length - used.length} 题选择“不适用”，按其余题目计算`);
      const s = round2(used.reduce((a, b) => a + b, 0) / used.length);
      return { id: d.id, name: d.name, score: s, band: findBand(skill.bands, s) };
    });
    const valid = domains.filter((d) => d.score !== null);
    if (valid.length < domains.length) notes.push(`有 ${domains.length - valid.length} 个维度不适用，总分按 ${valid.length} 个维度计算`);
    total = round2(valid.reduce((a, d) => a + d.score, 0) / valid.length);
  } else {
    throw new Error(`未知计分方法 ${skill.scoring.method}`);
  }

  const band = findBand(skill.bands, total);

  const crises = (skill.crisis || []).filter((c) => answers[c.when.item] >= c.when.gte);
  const crisis = crises.length > 0;

  const followups = (skill.followup || []).filter((f) => {
    const w = f.when;
    if (w.crisis) return crisis;
    if (w.levelGte !== undefined) return !crisis && band.level >= w.levelGte;
    if (w.anyDomainLevelGte !== undefined) return (domains || []).some((d) => d.band && d.band.level >= w.anyDomainLevelGte);
    if (w.domainLevelGte) return Object.entries(w.domainLevelGte).some(([id, lv]) => {
      const d = (domains || []).find((x) => x.id === id);
      return d && d.band && d.band.level >= lv;
    });
    return false;
  });

  return {
    complete: true,
    skill: skill.id,
    skillVersion: skill.version,
    total,
    band,
    domains,
    crisis,
    crises,
    // 危机优先于分级：常规报告被中止，只给危机文案
    patientMessage: crisis ? crises.map((c) => c.patient).join("\n") : band.patient || null,
    followups,
    notes,
  };
}
