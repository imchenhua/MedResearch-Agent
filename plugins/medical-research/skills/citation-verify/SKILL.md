---
name: 引文核验
description: 核验参考文献真实性——DOI/PMID 是否有效、标题作者期刊年份是否对得上、是否存在编造的"幻觉引用"。投稿前自查或综述定稿时使用。
---

# 引文核验

## 何时使用

- 论文投稿前自查参考文献列表
- 怀疑某条引用是编造的（AI 生成的引用常见假 DOI、错期刊）
- 需要统一引用格式

## 核验流程

### 1. 有 DOI → 直接解析

```bash
curl -s -H "Accept: application/json" "https://api.crossref.org/works/10.xxxx/xxxxx"
```

把返回的 `title` / `container-title` / `published` / 作者列表与用户提供的引用**逐项比对**。

### 2. 有 PMID → 走 PubMed

```bash
curl -s "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&id=<PMID>&retmode=json"
```

### 3. 两者都没有 → 用标题反查

```bash
curl -s "https://api.crossref.org/works?query.bibliographic=<标题URL编码>&rows=3"
```

标题匹配度低于 90%、或作者年份对不上，都要标为存疑。

## 判定标准

| 情况 | 结论 |
|---|---|
| DOI 解析成功，字段全部一致 | ✅ 真实 |
| DOI 返回 404，或字段明显不符 | ❌ 疑似伪造 |
| 查到相近标题但作者 / 年份不符 | ⚠️ 存疑，需人工确认 |
| 各种途径都查不到 | ❌ 无法验证，**不能引用** |

## 输出要求

逐条给出：原引用 → 核验结论 → 具体问题 → 建议修正。

**不允许**出现"看起来没问题"这类没有依据的结论 —— 每条都必须有接口返回作为证据。查不到的条目要明确列为「未通过核验」，不要默默略过。
