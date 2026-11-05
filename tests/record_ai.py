import sys, json, time, os, re, urllib.request
sys.path.insert(0, os.path.expanduser("~/AI工作区/reflex"))
import switchloop as S
skill = json.load(open(os.path.expanduser("~/Hark/repos/ai-native-clinic/skills/menqol.json")))
items = {q["id"]: q["text"] for q in skill["items"]}
M = S.mac_models(); h2o = M["h2o"]
out = {"recorded_at": time.strftime("%Y-%m-%d %H:%M CST"), "intake": [], "ask": [], "brief": []}

UTTER = [
 "最近半年老是半夜热醒，一身汗，白天也一阵一阵发热，一天七八次，挺烦的。觉睡不好，记性也差了，跟老公动不动就发火。腰也酸。别的没什么。",
 "我这人以前干活麻利，现在干啥都慢半拍，老觉得累，提不起劲，也不想出门见人。脸上皮肤干巴巴的。没有出汗啥的。",
 "笑一下就漏尿，挺尴尬的。老公那方面我现在是能躲就躲。头也经常疼，脖子僵。",
]
qs = {k: {"type": "choice", "instructions": "根据患者的原话，判断她是否有这个症状：%s。没提到就选 unknown，不要猜。" % t,
          "criteria": {"present": "原话明确或间接表明有", "absent": "原话明确表示没有", "unknown": "原话没有提到"}} for k, t in items.items()}
for u in UTTER:
    t = time.time(); a = h2o.decide({"患者原话": u}, qs)
    out["intake"].append({"text": u, "ms": round((time.time() - t) * 1000),
        "answers": {k: {"choice": v.get("choice"), "confidence": round(v.get("confidence") or 0, 3)} for k, v in a.items()}})

FIELDS = {
 "domain": ("问题关心的是哪个维度？", {"vasomotor": "血管舒缩（潮热、出汗）", "psychosocial": "心理社会（情绪、焦虑、抑郁）", "physical": "生理状态（疲劳、疼痛、睡眠等）", "sexual": "性生活", "any": "没有指定维度"}),
 "level": ("问题要求的最低严重程度？", {"mild": "轻度及以上", "moderate": "中度及以上", "severe": "重度", "any": "没有指定"}),
 "retest": ("问题对复测的要求？", {"done": "已经完成复测", "not_done": "还没有复测", "any": "没有提到复测"}),
 "change": ("问题对前后变化的要求？", {"improved": "好转、减轻", "worse": "加重、变差", "any": "没有提到变化"}),
 "period": ("问题限定的首诊时间范围？", {"1m": "最近一个月", "3m": "最近三个月", "6m": "最近半年", "all": "没有限定"}),
}
ASK = ["最近三个月来看的，心理状态中度以上、还没复测的有哪些人？",
       "潮热这些症状属于重度的病人，一共有多少？",
       "半年里做过复测、而且潮热出汗好转了的有哪些？"]
for q in ASK:
    t = time.time()
    a = h2o.decide({"主任的提问": q}, {k: {"type": "choice", "instructions": "把这句提问翻译成筛选条件：" + ins, "criteria": c} for k, (ins, c) in FIELDS.items()})
    out["ask"].append({"q": q, "ms": round((time.time() - t) * 1000), "filter": {k: {"choice": v.get("choice"), "confidence": round(v.get("confidence") or 0, 3)} for k, v in a.items()}})

FACTS = json.load(open("/tmp/cdpdir/p1facts.json"))
prompt = ("你是门诊助手，给医生写一段 3-4 句的中文简报。只能使用下面给出的事实，不要诊断，不要开药，不要编造事实之外的内容或数字。\n事实：" + json.dumps(FACTS, ensure_ascii=False))
g = M["gem"]
for k in range(2):
    t = time.time()
    body = {"contents": [{"role": "user", "parts": [{"text": prompt}]}], "generationConfig": {"temperature": 0.7}}
    for r in range(5):
        try: d = S._post(g.url, body, {"Authorization": "Bearer " + os.environ[g.key_env]}, 90); break
        except Exception as e:
            print("gem retry", e); time.sleep(4)
    else: raise SystemExit("gemini failed")
    txt = "".join(x.get("text", "") for x in d["candidates"][0]["content"].get("parts", []) if not x.get("thought"))
    out["brief"].append({"text": txt.strip(), "ms": round((time.time() - t) * 1000)})
out["brief_facts"] = FACTS
json.dump(out, open("/tmp/cdpdir/ai_recorded.json", "w"), ensure_ascii=False, indent=1)
print("done", [x["ms"] for x in out["intake"]], [x["filter"] for x in out["ask"]], [b["text"] for b in out["brief"]])
