// 黄金用例：每次修改技能包或引擎，都必须全部通过。浏览器和 Node 共用。
import { score } from "../engine/engine.js";

export function runGolden(skills, cases) {
  return cases.map((c) => {
    const r = score(skills[c.skill], c.answers);
    const e = c.expect, errs = [];
    if (e.total !== undefined && r.total !== e.total) errs.push(`总分 ${r.total} ≠ ${e.total}`);
    if (e.level !== undefined && r.band.level !== e.level) errs.push(`分级 ${r.band.level} ≠ ${e.level}`);
    if (e.crisis !== undefined && r.crisis !== e.crisis) errs.push(`危机 ${r.crisis} ≠ ${e.crisis}`);
    if (e.crisis && !/12356/.test(r.patientMessage)) errs.push("危机文案缺 12356");
    if (e.domain) for (const [id, [s, lv]] of Object.entries(e.domain)) {
      const d = r.domains.find((x) => x.id === id);
      if (d.score !== s) errs.push(`${id} 得分 ${d.score} ≠ ${s}`);
      if (d.band.level !== lv) errs.push(`${id} 分级 ${d.band.level} ≠ ${lv}`);
    }
    if (e.sexualNA && !r.domains.find((x) => x.id === "sexual").notApplicable) errs.push("性生活维度未标记不适用");
    if (e.followupIncludes && !r.followups.some((f) => f.action === e.followupIncludes)) errs.push(`随访缺“${e.followupIncludes}”`);
    return { name: `${c.skill} · ${e.name}`, pass: errs.length === 0, errs, result: r };
  });
}
