---
name: 临床试验检索
description: 通过 ClinicalTrials.gov v2 API 检索在研或已完成的临床试验，按适应症、分期、终点筛选。当用户想知道某疗法的试验进展、入排标准、注册号（NCT）时使用。
---

# 临床试验检索

## 何时使用

- 某药物 / 疗法目前有哪些试验在做
- 需要 III 期试验的主要终点和样本量
- 核对某个 NCT 注册号是否真实、结论是否与发表一致

## 调用 API

ClinicalTrials.gov v2，**无需 API key**：

```bash
curl -s "https://clinicaltrials.gov/api/v2/studies?query.cond=non-small+cell+lung+cancer&query.intr=osimertinib&filter.overallStatus=RECRUITING&pageSize=20"
```

常用参数：

| 参数 | 作用 | 示例 |
|---|---|---|
| `query.cond` | 适应症 / 疾病 | `non-small+cell+lung+cancer` |
| `query.intr` | 干预 / 药物 | `osimertinib` |
| `filter.overallStatus` | 状态 | `RECRUITING`、`COMPLETED`、`ACTIVE_NOT_RECRUITING` |
| `filter.phase` | 分期 | `PHASE3`、`PHASE2` |
| `pageSize` | 返回条数 | 最多 1000 |

只要计数时用 `/api/v2/studies?countTotal=true`。

## 输出要求

表格，按分期从高到低、状态从在研到已完成排序：

| NCT 号 | 标题 | 分期 | 状态 | 计划样本 | 主要终点 | 申办方 | 起始年 |
|---|---|---|---|---|---|---|---|

- **NCT 号必须原样引用**，绝不允许自己编造或推测编号
- 入排标准若被问到，摘录关键几条，不要整段复制
- 明确区分「注册信息」与「已发表结果」——两者不一致时要指出来

## 注意事项

- 查不到就如实说，并建议放宽哪个条件（分期 / 状态 / 用词）
- 试验方案（protocol）和实际执行常有差异，涉及安全性结论时提醒用户核对原文
