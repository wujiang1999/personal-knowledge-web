import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import pkg from "../package.json";
import {
  CHANGE_KINDS,
  CHANGE_KIND_LABELS,
  CHANGELOG,
  CURRENT_VERSION,
  groupChanges,
} from "../lib/changelog";

/**
 * 版本记录是"随代码发布的事实"，最容易烂掉的方式是忘记更新：
 * package.json 升了、记录没升，页面就开始说假话。这些测试把这个不变量钉死。
 */

vi.mock("@/lib/requireUser", () => ({
  requireUser: async () => ({ id: "u1", username: "admin", role: "admin" }),
}));

vi.mock("@/lib/stats", () => ({
  getBuildCommit: async () => "9699628fa891bf4177c45de40f01d5062dda88bb",
}));

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

describe("changelog data", () => {
  it("keeps the newest entry first", () => {
    const dates = CHANGELOG.map((e) => e.date);
    const sorted = [...dates].sort().reverse();
    expect(dates).toEqual(sorted);
  });

  it("has no duplicate versions and valid semver-ish numbers", () => {
    const versions = CHANGELOG.map((e) => e.version);
    expect(new Set(versions).size).toBe(versions.length);
    for (const v of versions) expect(v).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("has a parseable date and a title for every entry", () => {
    for (const e of CHANGELOG) {
      expect(e.date).toMatch(DATE_RE);
      expect(Number.isNaN(Date.parse(e.date))).toBe(false);
      expect(e.title.trim().length).toBeGreaterThan(0);
      expect(e.changes.length).toBeGreaterThan(0);
    }
  });

  it("uses only known change kinds, with a Chinese label for each", () => {
    for (const e of CHANGELOG) {
      for (const c of e.changes) {
        expect(CHANGE_KINDS).toContain(c.kind);
        expect(CHANGE_KIND_LABELS[c.kind]).toBeTruthy();
      }
    }
  });

  it("writes every change as a full sentence, not a fragment", () => {
    // 记录是给人读的：只写"修复 X"没有价值，要写清"此前会怎样"。
    for (const e of CHANGELOG) {
      for (const c of e.changes) expect(c.text.length).toBeGreaterThan(20);
    }
  });

  it("derives CURRENT_VERSION from the newest entry", () => {
    expect(CURRENT_VERSION).toBe(CHANGELOG[0].version);
  });

  it("keeps the changelog version in step with package.json", () => {
    // 忘记升版本时这条会失败——这正是本页最容易出现的腐坏。
    expect(CURRENT_VERSION).toBe(pkg.version);
  });
});

describe("groupChanges", () => {
  const entry = {
    version: "9.9.9",
    date: "2026-01-01",
    title: "t",
    changes: [
      { kind: "fix" as const, text: "b" },
      { kind: "security" as const, text: "a" },
      { kind: "fix" as const, text: "c" },
    ],
  };

  it("orders groups by CHANGE_KINDS and drops empty ones", () => {
    const groups = groupChanges(entry);
    expect(groups.map((g) => g.kind)).toEqual(["security", "fix"]);
  });

  it("preserves every change exactly once", () => {
    const texts = groupChanges(entry).flatMap((g) => g.texts);
    expect(texts.sort()).toEqual(["a", "b", "c"]);
  });
});

describe("version page", () => {
  it("renders the current version, the running commit, and each entry", async () => {
    const { default: VersionPage } = await import("../app/(app)/version/page");
    const html = renderToStaticMarkup(await VersionPage());

    expect(html).toContain(CURRENT_VERSION);
    expect(html).toContain("9699628"); // running commit, shortened
    for (const entry of CHANGELOG) {
      expect(html).toContain(entry.version);
      expect(html).toContain(entry.title);
      for (const change of entry.changes) expect(html).toContain(change.text);
    }
  });

  it("marks exactly one entry as the current version", async () => {
    const { default: VersionPage } = await import("../app/(app)/version/page");
    const html = renderToStaticMarkup(await VersionPage());
    expect(html.match(/当前<\/span>/g)?.length ?? 0).toBe(1);
  });
});
