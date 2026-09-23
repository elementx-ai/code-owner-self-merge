import { describe, expect, jest, test } from "@jest/globals";

import {
  findChangesSinceChecks,
  findMovedHeads,
  getMergeRange,
  mergePullRequestAsync,
} from "./merge.js";

import {
  findCodeOwnersForChangedFiles,
  getEffectiveOwnerStrings,
  getFilesNotOwnedByCodeOwner,
  getFilesNotOwnedByEffectiveOwner,
  githubLoginIsInCodeowners,
  hasValidLgtmSubstring,
} from "./index.js";

test("determine who owns a set of files", () => {
  const noFiles = findCodeOwnersForChangedFiles(["src/one.two.js"], "./test");
  expect(noFiles.users).toEqual(["@two"]);

  const filesNotInCodeowners = findCodeOwnersForChangedFiles(
    ["src/one.two.ts"],
    "./test",
  );
  expect(filesNotInCodeowners.users).toEqual([]);
});

test("real world", () => {
  const changed = ["/packages/tsconfig-reference/copy/pt/options/files.md"];
  const filesNotInCodeowners = findCodeOwnersForChangedFiles(changed, "./test");
  expect(filesNotInCodeowners.users).toEqual([
    "@khaosdoctor",
    "@danilofuchs",
    "@orta",
  ]);
});

test("real world 2", () => {
  const changed = [
    "/packages/typescriptlang-org/src/copy/pt/index.ts",
    "/packages/typescriptlang-org/src/copy/pt/nav.ts",
  ];
  const filesNotInCodeowners = findCodeOwnersForChangedFiles(changed, "./test");
  expect(filesNotInCodeowners.users).toEqual([
    "@khaosdoctor",
    "@danilofuchs",
    "@orta",
  ]);
});

test("real world with labels", () => {
  const changed = [
    "/packages/typescriptlang-org/src/copy/es/index.ts",
    "/packages/typescriptlang-org/src/copy/es/nav.ts",
  ];
  const filesNotInCodeowners = findCodeOwnersForChangedFiles(changed, "./test");
  expect(filesNotInCodeowners.labels).toEqual(["translate", "es"]);
});

test("deciding if someone has access to merge", () => {
  const noFiles = getFilesNotOwnedByCodeOwner(
    "@two",
    ["src/one.two.js"],
    "./test",
  );
  expect(noFiles).toEqual([]);

  const filesNotInCodeowners = getFilesNotOwnedByCodeOwner(
    "@two",
    ["random-path/file.ts"],
    "./test",
  );
  expect(filesNotInCodeowners).toEqual(["random-path/file.ts"]);
});

describe("getFilesNotOwnedByEffectiveOwner", () => {
  test("returns empty when an effective owner string matches", () => {
    const result = getFilesNotOwnedByEffectiveOwner(
      ["@nobody", "@two"],
      ["src/one.two.js"],
      "./test",
    );
    expect(result).toEqual([]);
  });

  test("returns files when no effective owner matches", () => {
    const result = getFilesNotOwnedByEffectiveOwner(
      ["@nobody", "@also-nobody"],
      ["src/one.two.js"],
      "./test",
    );
    expect(result).toEqual(["src/one.two.js"]);
  });

  test("returns empty for unowned files (no owner = open to all)", () => {
    const result = getFilesNotOwnedByEffectiveOwner(
      ["@nobody"],
      ["package.json"],
      "./test",
    );
    expect(result).toEqual([]);
  });

  test("returns empty when team owner string matches in team fixture", () => {
    const result = getFilesNotOwnedByEffectiveOwner(
      ["@kat-kleb", "@elementx-ai/marketing"],
      ["/src/pages/events/page.astro"],
      "./test/team-codeowners-fixture",
    );
    expect(result).toEqual([]);
  });

  test("returns files when neither individual nor team matches", () => {
    const result = getFilesNotOwnedByEffectiveOwner(
      ["@kat-kleb"],
      ["/src/pages/events/page.astro"],
      "./test/team-codeowners-fixture",
    );
    expect(result).toEqual(["/src/pages/events/page.astro"]);
  });

  test("matches owners case-insensitively", () => {
    const result = getFilesNotOwnedByEffectiveOwner(
      ["@ElementX-AI/Marketing"],
      ["/src/pages/events/page.astro"],
      "./test/team-codeowners-fixture",
    );
    expect(result).toEqual([]);
  });
});

describe("getEffectiveOwnerStrings", () => {
  const makeOctokit = (
    handler: (args: {
      org: string;
      team_slug: string;
      username: string;
    }) => Promise<{ data: { state: string } }>,
  ) => ({
    rest: {
      teams: {
        getMembershipForUserInOrg: jest.fn(handler),
      },
    },
  });

  test("returns only @username when CODEOWNERS has no team entries", async () => {
    const octokit = makeOctokit(async () => ({ data: { state: "active" } }));
    const result = await getEffectiveOwnerStrings(
      octokit as any,
      "kat-kleb",
      ["src/one.two.js"],
      "./test",
      "some-org",
    );
    expect(result).toEqual(["@kat-kleb"]);
    expect(octokit.rest.teams.getMembershipForUserInOrg).not.toHaveBeenCalled();
  });

  test("includes team string when user is an active member", async () => {
    const octokit = makeOctokit(async () => ({ data: { state: "active" } }));
    const result = await getEffectiveOwnerStrings(
      octokit as any,
      "kat-kleb",
      ["/src/pages/events/page.astro"],
      "./test/team-codeowners-fixture",
      "elementx-ai",
    );
    expect(result).toContain("@kat-kleb");
    expect(result).toContain("@elementx-ai/marketing");
    expect(octokit.rest.teams.getMembershipForUserInOrg).toHaveBeenCalledWith({
      org: "elementx-ai",
      team_slug: "marketing",
      username: "kat-kleb",
    });
  });

  test("excludes team when user is not a member (API throws 404)", async () => {
    const octokit = makeOctokit(async () => {
      throw { status: 404 };
    });
    const result = await getEffectiveOwnerStrings(
      octokit as any,
      "kat-kleb",
      ["/src/pages/events/page.astro"],
      "./test/team-codeowners-fixture",
      "elementx-ai",
    );
    expect(result).toEqual(["@kat-kleb"]);
  });

  test("excludes team when membership state is pending", async () => {
    const octokit = makeOctokit(async () => ({ data: { state: "pending" } }));
    const result = await getEffectiveOwnerStrings(
      octokit as any,
      "kat-kleb",
      ["/src/pages/events/page.astro"],
      "./test/team-codeowners-fixture",
      "elementx-ai",
    );
    expect(result).toEqual(["@kat-kleb"]);
  });

  test("ignores teams belonging to a different org", async () => {
    const octokit = makeOctokit(async () => ({ data: { state: "active" } }));
    const result = await getEffectiveOwnerStrings(
      octokit as any,
      "kat-kleb",
      ["/src/pages/events/page.astro"],
      "./test/team-codeowners-fixture",
      "other-org",
    );
    expect(result).toEqual(["@kat-kleb"]);
    expect(octokit.rest.teams.getMembershipForUserInOrg).not.toHaveBeenCalled();
  });

  test("skips team lookup when @username already covers all files", async () => {
    const octokit = makeOctokit(async () => ({ data: { state: "active" } }));
    const result = await getEffectiveOwnerStrings(
      octokit as any,
      "kat-kleb",
      ["/src/pages/events/page.astro"],
      "./test/user-and-team-codeowners-fixture",
      "elementx-ai",
    );
    expect(result).toEqual(["@kat-kleb"]);
    expect(octokit.rest.teams.getMembershipForUserInOrg).not.toHaveBeenCalled();
  });

  test("rethrows on non-404 membership errors", async () => {
    const octokit = makeOctokit(async () => {
      throw { status: 403 };
    });
    await expect(
      getEffectiveOwnerStrings(
        octokit as any,
        "kat-kleb",
        ["/src/pages/events/page.astro"],
        "./test/team-codeowners-fixture",
        "elementx-ai",
      ),
    ).rejects.toThrow(/HTTP 403.*read:org/);
  });
});

test("files with no designated owners are accessible to anyone", () => {
  const files = getFilesNotOwnedByCodeOwner("@one", ["package.json"], "./test");
  expect(files).toEqual([]);

  const files2 = getFilesNotOwnedByCodeOwner(
    "@two",
    ["package.json"],
    "./test",
  );
  expect(files2).toEqual([]);

  const mixed = getFilesNotOwnedByCodeOwner(
    "@one",
    ["package.json", "unowned/file.md"],
    "./test",
  );
  expect(mixed).toEqual([]);
});

describe("githubLoginIsInCodeowners", () => {
  test("allows folks found in the codeowners", () => {
    const ortaIn = githubLoginIsInCodeowners("orta", "./test");
    expect(ortaIn).toEqual(true);
  });
  test("ignores case", () => {
    const ortaIn = githubLoginIsInCodeowners("OrTa", "./test");
    expect(ortaIn).toEqual(true);
  });
  test("denies other accounts", () => {
    const noDogMan = githubLoginIsInCodeowners("dogman", "./test");
    expect(noDogMan).toEqual(false);
  });
  test("denies subsets of existing accounts", () => {
    const noOrt = githubLoginIsInCodeowners("ort", "./test");
    expect(noOrt).toEqual(false);
  });
  test("matches logins with regex special characters", () => {
    const dotLogin = githubLoginIsInCodeowners("user.name", "./test");
    expect(dotLogin).toEqual(true);

    const plusLogin = githubLoginIsInCodeowners("user+test", "./test");
    expect(plusLogin).toEqual(true);
  });
  test("matches end-of-line and end-of-file logins", () => {
    const endOfLine = githubLoginIsInCodeowners("user.name", "./test");
    expect(endOfLine).toEqual(true);

    const endOfFile = githubLoginIsInCodeowners("user.eof", "./test");
    expect(endOfFile).toEqual(true);
  });
  test("does not match subsets of special character logins", () => {
    const noUser = githubLoginIsInCodeowners("user", "./test");
    expect(noUser).toEqual(false);
  });
});

describe("no CODEOWNERS present", () => {
  const noCOPath = "./test/no-codeowners-fixture"; // directory with no CODEOWNERS file

  test("findCodeOwnersForChangedFiles returns empty users and labels", () => {
    const result = findCodeOwnersForChangedFiles(
      ["src/foo.ts", "README.md"],
      noCOPath,
    );
    expect(result.users).toEqual([]);
    expect(result.labels).toEqual([]);
  });

  test("getFilesNotOwnedByCodeOwner returns all files (no access granted)", () => {
    const files = ["src/foo.ts", "README.md"];
    const result = getFilesNotOwnedByCodeOwner("@someuser", files, noCOPath);
    expect(result).toEqual(files);
  });

  test("getFilesNotOwnedByCodeOwner does not grant access for any user", () => {
    const files = ["src/secret.ts"];
    expect(getFilesNotOwnedByCodeOwner("@admin", files, noCOPath)).toEqual(
      files,
    );
    expect(getFilesNotOwnedByCodeOwner("@owner", files, noCOPath)).toEqual(
      files,
    );
  });

  test("githubLoginIsInCodeowners returns false", () => {
    expect(githubLoginIsInCodeowners("orta", noCOPath)).toEqual(false);
    expect(githubLoginIsInCodeowners("anyuser", noCOPath)).toEqual(false);
  });
});

describe("hasValidLgtmSubstring", () => {
  test("allows lgtm", () => {
    const isValidSubstring = hasValidLgtmSubstring("this lgtm!");
    expect(isValidSubstring).toEqual(true);
  });
  test("allows later unquoted lgtm after a quoted one", () => {
    const isValidSubstring = hasValidLgtmSubstring('"lgtm" and then lgtm');
    expect(isValidSubstring).toEqual(true);
  });
  test("skips lgtm but and accepts later lgtm", () => {
    const isValidSubstring = hasValidLgtmSubstring(
      "lgtm but not now; lgtm later",
    );
    expect(isValidSubstring).toEqual(true);
  });
  test("skips lgtm, but and accepts later lgtm", () => {
    const isValidSubstring = hasValidLgtmSubstring(
      "lgtm, but not now; ok lgtm",
    );
    expect(isValidSubstring).toEqual(true);
  });
  test("denies lgtm embedded in words", () => {
    expect(hasValidLgtmSubstring("slgtm")).toEqual(false);
    expect(hasValidLgtmSubstring("algtm")).toEqual(false);
    expect(hasValidLgtmSubstring("lgtmish")).toEqual(false);
  });
  test("denies lgtm but", () => {
    const isValidSubstring = hasValidLgtmSubstring("this lgtm but");
    expect(isValidSubstring).toEqual(false);
  });
  test("denies lgtm but", () => {
    const isValidSubstring = hasValidLgtmSubstring("this lgtm, but");
    expect(isValidSubstring).toEqual(false);
  });
  test("denies lgtm in double quotes", () => {
    const isValidSubstring = hasValidLgtmSubstring('"lgtm"');
    expect(isValidSubstring).toEqual(false);
  });
  test("denies lgtm in single quotes", () => {
    const isValidSubstring = hasValidLgtmSubstring("'lgtm");
    expect(isValidSubstring).toEqual(false);
  });
  test("denies lgtm in inline code blocks", () => {
    const isValidSubstring = hasValidLgtmSubstring("lgtm`");
    expect(isValidSubstring).toEqual(false);
  });
});

describe("getMergeRange", () => {
  const repo = { owner: "elementx-ai", repo: "app" };
  const stackMember = (number: number, merged = false) => ({
    number,
    state: merged ? "closed" : "open",
    draft: false,
    merged_at: merged ? "2026-09-01T00:00:00Z" : null,
  });
  const makeOctokit = (pullRequests: ReturnType<typeof stackMember>[]) => ({
    request: jest.fn(async (..._args: unknown[]) => ({
      data: { pull_requests: pullRequests },
    })),
  });

  test("an unstacked PR is only itself, without calling the Stacks API", async () => {
    const octokit = makeOctokit([]);
    expect(await getMergeRange(octokit as any, repo, { number: 7 })).toEqual([
      7,
    ]);
    expect(octokit.request).not.toHaveBeenCalled();
  });

  test("a stacked PR includes every PR below it, but none above", async () => {
    const octokit = makeOctokit([10, 11, 12, 13].map((n) => stackMember(n)));
    const pr = { number: 12, stack: { number: 9, size: 4, position: 3 } };
    expect(await getMergeRange(octokit as any, repo, pr)).toEqual([10, 11, 12]);
    expect(octokit.request).toHaveBeenCalledWith(
      "GET /repos/{owner}/{repo}/stacks/{stack_number}",
      { owner: "elementx-ai", repo: "app", stack_number: 9 },
    );
  });

  test("skips PRs below that have already merged", async () => {
    const octokit = makeOctokit([
      stackMember(10, true),
      stackMember(11),
      stackMember(12),
    ]);
    const pr = { number: 12, stack: { number: 9, size: 3, position: 3 } };
    expect(await getMergeRange(octokit as any, repo, pr)).toEqual([11, 12]);
  });

  test("the bottom PR of a stack is only itself", async () => {
    const octokit = makeOctokit([10, 11].map((n) => stackMember(n)));
    const pr = { number: 10, stack: { number: 9, size: 2, position: 1 } };
    expect(await getMergeRange(octokit as any, repo, pr)).toEqual([10]);
  });

  test("refuses when the PR isn't in the stack it claims", async () => {
    const octokit = makeOctokit([10, 11].map((n) => stackMember(n)));
    const pr = { number: 12, stack: { number: 9, size: 2, position: 3 } };
    await expect(getMergeRange(octokit as any, repo, pr)).rejects.toThrow(
      /not in stack #9/,
    );
  });
});

describe("mergePullRequestAsync", () => {
  const options = {
    owner: "elementx-ai",
    repo: "app",
    pull_number: 12,
    merge_method: "squash" as const,
    commit_message: "Co-authored-by: someone",
    sha: "abc123",
  };
  const fast = { pollIntervalMs: 1, timeoutMs: 1000 };

  test("submits to the async endpoint and returns an immediate result", async () => {
    const octokit = {
      request: jest.fn(async (..._args: unknown[]) => ({
        data: { status: "merged", details: { sha: "def456" } },
      })),
    };
    const result = await mergePullRequestAsync(octokit as any, options, fast);
    expect(result?.status).toBe("merged");
    expect(octokit.request).toHaveBeenCalledTimes(1);
    expect(octokit.request).toHaveBeenCalledWith(
      "PUT /repos/{owner}/{repo}/pulls/{pull_number}/merge-async",
      { ...options, merge_action: "default" },
    );
  });

  test("polls a pending merge until it settles", async () => {
    const responses = [
      { status: "pending", details: { uuid: "u-1" } },
      { status: "pending", details: { uuid: "u-1" } },
      { status: "merged", details: { sha: "def456" } },
    ];
    const octokit = {
      request: jest.fn(async (..._args: unknown[]) => ({
        data: responses.shift(),
      })),
    };
    const result = await mergePullRequestAsync(octokit as any, options, fast);
    expect(result?.status).toBe("merged");
    expect(octokit.request).toHaveBeenLastCalledWith(
      "GET /repos/{owner}/{repo}/pulls/{pull_number}/merge-async/{uuid}",
      { owner: "elementx-ai", repo: "app", pull_number: 12, uuid: "u-1" },
    );
  });

  test("returns a failed result with GitHub's reason", async () => {
    const responses = [
      { status: "pending", details: { uuid: "u-1" } },
      { status: "failed", details: { message: "Required checks failed" } },
    ];
    const octokit = {
      request: jest.fn(async (..._args: unknown[]) => ({
        data: responses.shift(),
      })),
    };
    const result = await mergePullRequestAsync(octokit as any, options, fast);
    expect(result).toEqual({
      status: "failed",
      details: { message: "Required checks failed" },
    });
  });

  test("gives up polling at the timeout and reports still pending", async () => {
    const octokit = {
      request: jest.fn(async (..._args: unknown[]) => ({
        data: { status: "pending", details: { uuid: "u-1" } },
      })),
    };
    const result = await mergePullRequestAsync(octokit as any, options, {
      pollIntervalMs: 5,
      timeoutMs: 20,
    });
    expect(result?.status).toBe("pending");
  });

  test("returns undefined when the async API isn't available", async () => {
    const octokit = {
      request: jest.fn(async (..._args: unknown[]) => {
        throw { status: 404 };
      }),
    };
    expect(
      await mergePullRequestAsync(octokit as any, options, fast),
    ).toBeUndefined();
  });

  test("explains a conflicting in-flight merge", async () => {
    const octokit = {
      request: jest.fn(async (..._args: unknown[]) => {
        throw { status: 409 };
      }),
    };
    await expect(
      mergePullRequestAsync(octokit as any, options, fast),
    ).rejects.toThrow(/already in progress/);
  });
});

describe("findMovedHeads", () => {
  const repo = { owner: "elementx-ai", repo: "app" };
  const pr = (number: number, sha: string) =>
    ({ number, head: { sha } }) as any;
  const makeOctokit = (heads: Record<number, string>) => ({
    rest: {
      pulls: {
        get: jest.fn(async ({ pull_number }: { pull_number: number }) => ({
          data: pr(pull_number, heads[pull_number]!),
        })),
      },
    },
  });

  test("returns nothing when no head has moved", async () => {
    const octokit = makeOctokit({ 10: "a", 11: "b" });
    expect(
      await findMovedHeads(octokit as any, repo, [pr(10, "a"), pr(11, "b")]),
    ).toEqual([]);
  });

  test("returns the PRs pushed to since they were fetched", async () => {
    const octokit = makeOctokit({ 10: "a", 11: "b2" });
    expect(
      await findMovedHeads(octokit as any, repo, [pr(10, "a"), pr(11, "b")]),
    ).toEqual([11]);
  });
});

describe("findChangesSinceChecks", () => {
  const repo = { owner: "elementx-ai", repo: "app" };
  const stack = { number: 9, size: 2, position: 2 };
  const pr = (number: number, sha: string) =>
    ({ number, head: { sha }, stack }) as any;
  const member = (number: number) => ({
    number,
    state: "open",
    draft: false,
    merged_at: null,
  });
  const makeOctokit = (heads: Record<number, string>, members: number[]) => ({
    request: jest.fn(async (..._args: unknown[]) => ({
      data: { pull_requests: members.map(member) },
    })),
    rest: {
      pulls: {
        get: jest.fn(async ({ pull_number }: { pull_number: number }) => ({
          data: pr(pull_number, heads[pull_number]!),
        })),
      },
    },
  });
  const authorised = [pr(10, "a"), pr(11, "b")];

  test("returns nothing when the stack and its heads are unchanged", async () => {
    const octokit = makeOctokit({ 10: "a", 11: "b" }, [10, 11]);
    expect(
      await findChangesSinceChecks(octokit as any, repo, authorised),
    ).toBeUndefined();
  });

  test("reports a PR added below the target", async () => {
    const octokit = makeOctokit({ 10: "a", 11: "b" }, [10, 12, 11]);
    expect(
      await findChangesSinceChecks(octokit as any, repo, authorised),
    ).toMatch(/stack changed/);
  });

  test("reports a replaced lower PR", async () => {
    const octokit = makeOctokit({ 10: "a", 11: "b" }, [12, 11]);
    expect(
      await findChangesSinceChecks(octokit as any, repo, authorised),
    ).toMatch(/stack changed/);
  });

  test("reports the target PR getting new commits", async () => {
    const octokit = makeOctokit({ 10: "a", 11: "b2" }, [10, 11]);
    expect(
      await findChangesSinceChecks(octokit as any, repo, authorised),
    ).toMatch(/#11 got new commits/);
  });

  test("reports a lower PR that got new commits", async () => {
    const octokit = makeOctokit({ 10: "a2", 11: "b" }, [10, 11]);
    expect(
      await findChangesSinceChecks(octokit as any, repo, authorised),
    ).toMatch(/#10 got new commits/);
  });
});
