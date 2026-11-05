import sys, json, time, os
sys.path.insert(0, os.path.expanduser("~/AI工作区/reflex"))
import switchloop as S
skill = json.load(open(os.path.expanduser("~/Hark/repos/ai-native-clinic/skills/menqol.json")))
items = {q["id"]: q["text"] for q in skill["items"]}
CASES = [
 ("最近半年老是半夜热醒，一身汗，白天也一阵一阵发热，一天七八次，挺烦的。觉睡不好，记性也差了，跟老公动不动就发火。腰也酸。别的没什么。",
  {"m1", "m2", "m14", "m6", "m9", "m24"}, {"m3"}),
 ("我这人以前干活麻利，现在干啥都慢半拍，老觉得累，提不起劲，也不想出门见人。脸上皮肤干巴巴的。没有出汗啥的。",
  {"m7", "m13", "m18", "m10", "m19"}, {"m16", "m17", "m8"}),
 ("笑一下就漏尿，挺尴尬的。老公那方面我现在是能躲就躲。头也经常疼，脖子僵。",
  {"m26", "m29", "m15"}, {"m27"}),
]
def qs():
    return {k: {"type": "choice", "instructions": "根据患者的原话，判断她是否有这个症状：%s。没提到就选 unknown，不要猜。" % t,
                "criteria": {"present": "原话明确或间接表明有", "absent": "原话明确表示没有", "unknown": "原话没有提到"}} for k, t in items.items()}
models = S.mac_models()
pick = sys.argv[1:] or ["h2o", "bivia", "gem"]
res = {}
for m in pick:
    res[m] = []
    for text, gold, ok_extra in CASES:
        t = time.time()
        try:
            a = models[m].decide("患者原话：" + text if m == "bivia" else {"患者原话": text}, qs())
        except Exception as e:
            res[m].append({"error": str(e)[:200]}); continue
        ms = round((time.time() - t) * 1000)
        pres = {k for k, v in a.items() if v.get("choice") == "present"}
        hit = gold & pres; miss = gold - pres; fp = pres - gold - ok_extra
        conf = {k: v.get("confidence") for k, v in a.items() if k in gold | pres}
        res[m].append({"ms": ms, "recall": "%d/%d" % (len(hit), len(gold)), "miss": sorted(miss), "fp": sorted(fp), "conf": conf})
    print(m, json.dumps(res[m], ensure_ascii=False))
json.dump(res, open("/tmp/intake_res.json", "w"), ensure_ascii=False, indent=1)
