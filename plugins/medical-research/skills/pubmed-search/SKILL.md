---
name: PubMed 文献检索
description: 通过 NCBI E-utilities 检索 PubMed，构造检索式、去重并整理引用。当用户需要查文献、找证据、做综述或核对某篇文献的 PMID/DOI 时使用。
---

# PubMed 文献检索

## 何时使用

- 需要检索某疾病 / 干预 / 结局的文献
- 为综述或论文收集证据
- 核对某篇文献的 PMID / DOI 是否真实

## 第一步：把问题拆成 PICO

先把用户的问题拆成四要素，检索式围绕它们构造：

- **P**opulation：人群 / 疾病（如 `EGFR-mutant NSCLC`）
- **I**ntervention：干预（如 `osimertinib`）
- **C**omparison：对照（可省略）
- **O**utcome：结局（如 `progression-free survival`）

## 第二步：构造检索式

1. 每个要素同时用 **MeSH 主题词**和**自由词**，用 `OR` 连接：
   `("Carcinoma, Non-Small-Cell Lung"[Mesh] OR "non-small cell lung cancer"[tiab])`
2. 要素之间用 `AND`
3. 限定研究类型时追加：`AND (Clinical Trial[pt] OR Randomized Controlled Trial[pt])`
4. 限定时间：`AND ("2022"[dp] : "3000"[dp])`

**不要**直接照搬中文关键词去做英文检索，先翻译成标准医学术语。

## 第三步：调用 E-utilities

无需 API key，但**每秒不超过 3 次请求**，连续检索之间加 `sleep 1`。

搜索：
```bash
curl -s "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&retmax=20&sort=relevance&term=<URL编码后的检索式>"
```

取详情（XML，含标题、作者、期刊、年份、摘要）：
```bash
curl -s "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pubmed&id=<PMID用逗号分隔>&retmode=xml"
```

## 第四步：输出

1. **结果表格**（按证据等级从高到低排）：

   | 作者（年份） | 期刊 | 研究类型 | 样本量 | 干预 | 主要结局 | PMID |
   |---|---|---|---|---|---|---|

2. **每条引用都带 PMID + DOI**，不允许只给标题
3. 检索式本身也要写出来，便于复核
4. 样本量 / 主要结局若摘要里没有，明确写「摘要未报告」，**不要推测**

## 注意事项

- 找不到就如实说找不到，并建议放宽哪一条限制（时间 / 研究类型 / 用词）
- 区分**摘要结论**与**全文结论**，只用摘要时注明
- 中文文献检索用 CNKI / 万方，本技能只负责 PubMed
