import { describe, it, expect } from "vitest";
import { globMatch, anyGlobMatch } from "./glob.js";

describe("globMatch", () => {
  it("matches exact paths", () => {
    expect(globMatch("app/models/ticket.rb", "app/models/ticket.rb")).toBe(true);
    expect(globMatch("app/models/ticket.rb", "app/models/user.rb")).toBe(false);
  });

  it("`*` matches within a segment but not across /", () => {
    expect(globMatch("app/controllers/Site*", "app/controllers/SitesController.rb")).toBe(true);
    expect(globMatch("app/*.rb", "app/a/b.rb")).toBe(false);
  });

  it("`**` matches across path separators", () => {
    expect(globMatch("app/controllers/**", "app/controllers/admin/x.rb")).toBe(true);
    expect(globMatch("app/**/policy.rb", "app/a/b/policy.rb")).toBe(true);
    expect(globMatch("app/**", "app/a")).toBe(true);
  });

  it("`?` matches a single non-slash char", () => {
    expect(globMatch("a?c", "abc")).toBe(true);
    expect(globMatch("a?c", "a/c")).toBe(false);
  });

  it("escapes regex metacharacters in literals", () => {
    expect(globMatch("a.b+c", "a.b+c")).toBe(true);
    expect(globMatch("a.b+c", "axbxc")).toBe(false);
  });
});

describe("anyGlobMatch", () => {
  it("true when any glob matches any path", () => {
    expect(anyGlobMatch(["app/a/*", "app/b/*"], ["app/b/x.rb"])).toBe(true);
  });
  it("false on empty globs or empty paths (no-git)", () => {
    expect(anyGlobMatch([], ["app/b/x.rb"])).toBe(false);
    expect(anyGlobMatch(["app/b/*"], [])).toBe(false);
  });
  it("false on a clean miss", () => {
    expect(anyGlobMatch(["app/a/*"], ["lib/x.rb"])).toBe(false);
  });
});
