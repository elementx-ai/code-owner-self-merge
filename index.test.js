import { describe, expect, test } from "@jest/globals";

import {
  findCodeOwnersForChangedFiles,
  getFilesNotOwnedByCodeOwner,
  githubLoginIsInCodeowners,
  hasValidLgtmSubstring,
} from "./index.js";

test("determine who owns a set of files", () => {
  const noFiles = findCodeOwnersForChangedFiles(["src/one.two.js"], "./test");
  expect(noFiles.users).toEqual(["@two"]);

  const filesNotInCodeowners = findCodeOwnersForChangedFiles(["src/one.two.ts"], "./test");
  expect(filesNotInCodeowners.users).toEqual([]);
});

test("real world", () => {
  const changed = ["/packages/tsconfig-reference/copy/pt/options/files.md"];
  const filesNotInCodeowners = findCodeOwnersForChangedFiles(changed, "./test");
  expect(filesNotInCodeowners.users).toEqual(["@khaosdoctor", "@danilofuchs", "@orta"]);
});

test("real world 2", () => {
  const changed = ["/packages/typescriptlang-org/src/copy/pt/index.ts", "/packages/typescriptlang-org/src/copy/pt/nav.ts"];
  const filesNotInCodeowners = findCodeOwnersForChangedFiles(changed, "./test");
  expect(filesNotInCodeowners.users).toEqual(["@khaosdoctor", "@danilofuchs", "@orta"]);
});

test("real world with labels", () => {
  const changed = ["/packages/typescriptlang-org/src/copy/es/index.ts", "/packages/typescriptlang-org/src/copy/es/nav.ts"];
  const filesNotInCodeowners = findCodeOwnersForChangedFiles(changed, "./test");
  expect(filesNotInCodeowners.labels).toEqual(["translate", "es"]);
});

test("deciding if someone has access to merge", () => {
  const noFiles = getFilesNotOwnedByCodeOwner("@two", ["src/one.two.js"], "./test");
  expect(noFiles).toEqual([]);

  const filesNotInCodeowners = getFilesNotOwnedByCodeOwner("@two", ["random-path/file.ts"], "./test");
  expect(filesNotInCodeowners).toEqual(["random-path/file.ts"]);
});

test("files with no designated owners are accessible to anyone", () => {
  const files = getFilesNotOwnedByCodeOwner("@one", ["package.json"], "./test");
  expect(files).toEqual([]);

  const files2 = getFilesNotOwnedByCodeOwner("@two", ["package.json"], "./test");
  expect(files2).toEqual([]);

  const mixed = getFilesNotOwnedByCodeOwner("@one", ["package.json", "unowned/file.md"], "./test");
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

describe("hasValidLgtmSubstring", () => {
  test("allows lgtm", () => {
    const isValidSubstring = hasValidLgtmSubstring("this lgtm!");
    expect(isValidSubstring).toEqual(true);
  });
  test("allows later unquoted lgtm after a quoted one", () => {
    const isValidSubstring = hasValidLgtmSubstring("\"lgtm\" and then lgtm");
    expect(isValidSubstring).toEqual(true);
  });
  test("skips lgtm but and accepts later lgtm", () => {
    const isValidSubstring = hasValidLgtmSubstring("lgtm but not now; lgtm later");
    expect(isValidSubstring).toEqual(true);
  });
  test("skips lgtm, but and accepts later lgtm", () => {
    const isValidSubstring = hasValidLgtmSubstring("lgtm, but not now; ok lgtm");
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
    const isValidSubstring = hasValidLgtmSubstring("\"lgtm\"");
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
