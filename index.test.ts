import { describe, expect, jest, test } from "@jest/globals";

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
