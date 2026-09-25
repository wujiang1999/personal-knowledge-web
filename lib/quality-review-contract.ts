export const SPOT_CHECK_DEFAULT_SIZE = 3;
export const SPOT_CHECK_MAX_SIZE = 5;
export const SPOT_CHECK_PREVIEW_CHARS = 4_000;
export const AUTO_REVIEW_DEFAULT_SIZE = 3;
export const AUTO_REVIEW_MAX_SIZE = 5;
export const AUTO_REVIEW_MAX_BODY_CHARS = 12_000;

export const MANUAL_ISSUE_TYPES = ["factual", "outdated", "contradiction", "incomplete", "sensitive", "format"] as const;
export type ManualIssueType = (typeof MANUAL_ISSUE_TYPES)[number];

export const MANUAL_ISSUE_LABEL: Record<ManualIssueType, string> = {
  factual: "事实或数值错误",
  outdated: "内容过时",
  contradiction: "与库内内容矛盾",
  incomplete: "缺少关键上下文",
  sensitive: "隐私或敏感信息",
  format: "结构或格式问题",
};

export interface QualitySample {
  id: string;
  version: number;
  type: string;
  title: string;
  description: string | null;
  category: string | null;
  tags: string[];
  status: string;
  body: string;
}

export type QualityRiskLevel = "none" | "low" | "medium" | "high";

export const QUALITY_RISK_LABEL: Record<QualityRiskLevel, string> = {
  none: "未发现明确风险",
  low: "低风险",
  medium: "中风险",
  high: "高风险",
};

export interface AutoReviewFinding {
  type: string;
  severity: QualityRiskLevel;
  evidence: string;
  recommendation: string;
}

export interface AutoReviewAssessment {
  hasRisk: boolean;
  riskLevel: QualityRiskLevel;
  summary: string;
  findings: AutoReviewFinding[];
  suggestedBody?: string;
}

export interface AutoReviewTaskResult {
  [key: string]: unknown;
  total: number;
  completed: number;
  flagged: number;
  queued: number;
  skippedOversized: number;
  failed: number;
  currentTitle: string | null;
  finished: boolean;
  tookMs?: number;
}

function text(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

/** Narrow an arbitrary model response into the approval payload contract.
 * A declared risk without at least one concrete finding is treated as no-risk:
 * the UI must never ask a user to approve an unexplained warning. */
export function parseAutoReviewAssessment(raw: unknown): AutoReviewAssessment {
  const o = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const findings: AutoReviewFinding[] = Array.isArray(o.findings)
    ? o.findings
        .map((value): AutoReviewFinding | null => {
          if (typeof value !== "object" || value === null) return null;
          const finding = value as Record<string, unknown>;
          const evidence = text(finding.evidence, 800);
          const recommendation = text(finding.recommendation, 800);
          if (!evidence || !recommendation) return null;
          return {
            type: text(finding.type, 80) || "general",
            severity: finding.severity === "low" || finding.severity === "high" ? finding.severity : "medium",
            evidence,
            recommendation,
          };
        })
        .filter((value): value is AutoReviewFinding => value !== null)
        .slice(0, 8)
    : [];
  const hasRisk = o.hasRisk === true && findings.length > 0;
  const suggested = text(o.suggestedBody, AUTO_REVIEW_MAX_BODY_CHARS);
  const parsedLevel = o.riskLevel === "low" || o.riskLevel === "high" ? o.riskLevel : "medium";
  return {
    hasRisk,
    riskLevel: hasRisk ? parsedLevel : "none",
    summary: text(o.summary, 1000) || (hasRisk ? "发现需要人工确认的风险" : "未发现明确风险"),
    findings: hasRisk ? findings : [],
    ...(hasRisk && suggested ? { suggestedBody: suggested } : {}),
  };
}
