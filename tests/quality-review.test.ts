import { describe, expect, it } from "vitest";
import { parseAutoReviewAssessment } from "../lib/quality-review-contract";

describe("parseAutoReviewAssessment", () => {
  it("rejects an unexplained warning and malformed findings", () => {
    expect(
      parseAutoReviewAssessment({
        hasRisk: true,
        riskLevel: "high",
        summary: "有问题",
        findings: [{ evidence: "缺少证据" }, { evidence: "有证据", recommendation: "" }],
      })
    ).toEqual({
      hasRisk: false,
      riskLevel: "none",
      summary: "有问题",
      findings: [],
    });
  });

  it("keeps a concrete finding and optional full-body suggestion", () => {
    expect(
      parseAutoReviewAssessment({
        hasRisk: true,
        riskLevel: "low",
        summary: "日期可能过时",
        findings: [
          {
            type: "outdated",
            severity: "low",
            evidence: "正文写明年份为 2024",
            recommendation: "核对来源日期",
          },
        ],
        suggestedBody: "修订后的完整正文",
      })
    ).toEqual({
      hasRisk: true,
      riskLevel: "low",
      summary: "日期可能过时",
      findings: [
        {
          type: "outdated",
          severity: "low",
          evidence: "正文写明年份为 2024",
          recommendation: "核对来源日期",
        },
      ],
      suggestedBody: "修订后的完整正文",
    });
  });

  it("fails closed when the model returns a non-object", () => {
    expect(parseAutoReviewAssessment("risky")).toMatchObject({
      hasRisk: false,
      riskLevel: "none",
      findings: [],
    });
  });
});
