import * as core from "@actions/core";
import { context, getOctokit } from "@actions/github";
import Codeowners from "codeowners";

import { readFileSync } from "fs";

type Octokit = ReturnType<typeof getOctokit>;
type PullsGetResponse = Awaited<ReturnType<Octokit["rest"]["pulls"]["get"]>>;
type PullsListFilesResponseData = Awaited<ReturnType<Octokit["rest"]["pulls"]["listFiles"]>>["data"];
type PullsListFilesResponseItem = PullsListFilesResponseData[number];
type RepoLabel = { name: string };

type RepoDetails = {
  owner: string;
  repo: string;
  id?: number;
};

type LabelConfig = {
  name: string;
  color: string;
  description?: string;
};

const githubServerUrl = process.env["GITHUB_SERVER_URL"] || "https://github.com";

// eslint-disable-next-line complexity
const commentOnMergablePRs = async (): Promise<void> => {
  if (context.eventName !== "pull_request_target") {
    throw new Error("This function can only run when the workflow specifies `pull_request_target` in the `on:`.");
  }

  // Setup
  const cwd = core.getInput("cwd") || process.cwd();
  const octokit = getOctokit(process.env.GITHUB_TOKEN ?? "");
  const pr = context.payload.pull_request;
  const thisRepo = { owner: context.repo.owner, repo: context.repo.repo };

  core.info(`\nLooking at PR: '${pr?.title ?? ""}' to see if the changed files all fit inside one set of code-owners to make a comment`);

  const co = new Codeowners(cwd);
  core.info(`Code-owners file found at: ${co.codeownersFilePath}`);

  if (!pr) {
    throw new Error("Missing pull_request payload");
  }

  const changedFiles = await getPRChangedFiles(octokit, thisRepo, pr.number);
  core.info(`Changed files: \n - ${changedFiles.join("\n - ")}`);

  const codeowners = findCodeOwnersForChangedFiles(changedFiles, cwd);
  core.info(`Code-owners: \n - ${codeowners.users.join("\n - ")}`);
  core.info(`Labels: \n - ${codeowners.labels.join("\n - ")}`);

  // Determine who has access to merge every file in this PR
  const ownersWhoHaveAccessToAllFilesInPR: string[] = [];
  codeowners.users.forEach((owner) => {
    const filesWhichArentOwned = getFilesNotOwnedByCodeOwner(owner, changedFiles, cwd);
    if (filesWhichArentOwned.length === 0) {
      ownersWhoHaveAccessToAllFilesInPR.push(owner);
    }
  });

  if (!ownersWhoHaveAccessToAllFilesInPR.length) {
    console.log("This PR does not have any code-owners who own all of the files in the PR");
    listFilesWithOwners(changedFiles, cwd);

    const labelToAdd = core.getInput("if_no_maintainers_add_label");
    if (labelToAdd) {
      const labelConfig = { name: labelToAdd, color: Math.random().toString(16).slice(2, 8) };
      await createOrAddLabel(octokit, { ...thisRepo, id: pr.number }, labelConfig);
    }

    const assignees = core.getInput("if_no_maintainers_assign");
    if (assignees) {
      const usernames = assignees.split(" ").map((user) => user.replace("@", "").trim()).filter(Boolean);
      if (usernames.length > 0) {
        await octokit.rest.issues.addAssignees({ ...thisRepo, issue_number: pr.number, assignees: usernames });
      }
    }

    return;
  }

  const ourSignature = "<!-- Message About Merging -->";
  const comments = await octokit.rest.issues.listComments({ ...thisRepo, issue_number: pr.number });
  const existingComment = comments.data.find((comment) => comment.body?.includes(ourSignature));
  if (existingComment) {
    console.log("There is an existing comment");
    return;
  }

  const ownerNoPings = JSON.parse(core.getInput("ownerNoPings")) as string[];
  const formattedOwnersWhoHaveAccessToAllFilesInPR = ownersWhoHaveAccessToAllFilesInPR.map((owner) =>
    ownerNoPings.includes(owner) ? `\`${owner}\`` : owner
  );
  const owners = formatList(formattedOwnersWhoHaveAccessToAllFilesInPR);
  const message = `Thanks for the PR!

This section of the codebase is owned by ${owners} - if they write a comment saying "LGTM" then it will be merged.
${ourSignature}`;

  const skipOutput = core.getInput("quiet");
  if (!skipOutput) {
    await octokit.rest.issues.createComment({ ...thisRepo, issue_number: pr.number, body: message });
  }

  // Add labels
  for (const label of codeowners.labels) {
    const labelConfig = { name: label, color: Math.random().toString(16).slice(2, 8) };
    await createOrAddLabel(octokit, { ...thisRepo, id: pr.number }, labelConfig);
  }
};

const pathListToMarkdown = (files: string[]): string =>
  files
    .map(
      (item) =>
        `* [\`${item}\`](${githubServerUrl}/${context.repo.owner}/${context.repo.repo}/tree/HEAD${encodeURIComponent(item)})`
    )
    .join("\n");

const getPayloadBody = (): string => {
  const body = context.payload.comment?.body ?? context.payload.review?.body;
  if (body == null) {
    return "";
  }
  return body;
};

type IssueLike = { number: number; title?: string };

class Actor {
  private cwd: string;
  private octokit: Octokit;
  private thisRepo: RepoDetails;
  private issue: IssueLike;
  private sender: string;

  constructor() {
    const issue = context.payload.issue ?? context.payload.pull_request;
    const sender = context.payload.sender?.login;

    if (!issue) {
      throw new Error("Missing issue or pull_request payload");
    }
    if (!sender) {
      throw new Error("Missing sender payload");
    }

    this.cwd = core.getInput("cwd") || process.cwd();
    this.octokit = getOctokit(process.env.GITHUB_TOKEN ?? "");
    this.thisRepo = { owner: context.repo.owner, repo: context.repo.repo };
    this.issue = issue;
    this.sender = sender;
  }

  async getTargetPRIfHasAccess(): Promise<PullsGetResponse | undefined> {
    const { octokit, thisRepo, sender, issue, cwd } = this;
    core.info(`\n\nLooking at the ${context.eventName} from ${sender} in '${issue.title ?? ""}' to see if we can proceed`);

    const changedFiles = await getPRChangedFiles(octokit, thisRepo, issue.number);
    core.info(`Changed files: \n - ${changedFiles.join("\n - ")}`);

    const filesWhichArentOwned = getFilesNotOwnedByCodeOwner(`@${sender}`, changedFiles, cwd);
    if (filesWhichArentOwned.length !== 0) {
      console.log(`@${sender} does not have access to \n - ${filesWhichArentOwned.join("\n - ")}\n`);
      listFilesWithOwners(changedFiles, cwd);
      await octokit.rest.issues.createComment({
        ...thisRepo,
        issue_number: issue.number,
        body: `Sorry @${sender}, you don't have access to these files:\n\n${pathListToMarkdown(filesWhichArentOwned)}.`,
      });
      return;
    }

    const prInfo = await octokit.rest.pulls.get({ ...thisRepo, pull_number: issue.number });
    if (prInfo.data.state.toLowerCase() !== "open") {
      await octokit.rest.issues.createComment({
        ...thisRepo,
        issue_number: issue.number,
        body: `Sorry @${sender}, this PR isn't open.`,
      });
      return;
    }
    return prInfo;
  }

  async mergeIfHasAccess(): Promise<void> {
    const prInfo = await this.getTargetPRIfHasAccess();
    if (!prInfo) {
      return;
    }

    const { octokit, thisRepo, issue, sender } = this;

    // Don't try merge if mergability is not yet known
    if (prInfo.data.mergeable === null) {
      await octokit.rest.issues.createComment({
        ...thisRepo,
        issue_number: issue.number,
        body: `Sorry @${sender}, this PR is still running background checks to compute mergeability. They'll need to complete before this can be merged.`,
      });
      return;
    }

    // Don't try merge unmergable stuff
    if (!prInfo.data.mergeable) {
      await octokit.rest.issues.createComment({
        ...thisRepo,
        issue_number: issue.number,
        body: `Sorry @${sender}, this PR has merge conflicts. They'll need to be fixed before this can be merged.`,
      });
      return;
    }

    // Don't merge red PRs or PRs with pending statuses
    const statusInfo = await octokit.rest.repos.listCommitStatusesForRef({
      ...thisRepo,
      ref: prInfo.data.head.sha,
    });
    const latestStatuses = statusInfo.data.filter(
      (thing, index, self) => index === self.findIndex((item) => item.target_url === thing.target_url)
    );

    const pendingStatus = latestStatuses.find((status) => status.state === "pending");
    if (pendingStatus) {
      await octokit.rest.issues.createComment({
        ...thisRepo,
        issue_number: issue.number,
        body: `Sorry @${sender}, this PR has pending status checks that haven't completed yet. Blocked by [${pendingStatus.context}](${pendingStatus.target_url}): '${pendingStatus.description}'.`,
      });
      return;
    }

    const failedStatus = latestStatuses.find((status) => status.state !== "success");
    if (failedStatus) {
      await octokit.rest.issues.createComment({
        ...thisRepo,
        issue_number: issue.number,
        body: `Sorry @${sender}, this PR could not be merged because it wasn't green. Blocked by [${failedStatus.context}](${failedStatus.target_url}): '${failedStatus.description}'.`,
      });
      return;
    }

    core.info("Creating comments and merging");
    try {
      const coauthor = `Co-authored-by: ${sender} <${sender}@users.noreply.github.com>`;
      const mergeMethodInput = core.getInput("merge_method") as "merge" | "squash" | "rebase" | "";
      await octokit.rest.pulls.merge({
        ...thisRepo,
        pull_number: issue.number,
        merge_method: mergeMethodInput || "merge",
        commit_message: coauthor,
      });
      await octokit.rest.issues.createComment({
        ...thisRepo,
        issue_number: issue.number,
        body: `Merging because @${sender} is a code-owner of all the changes - thanks!`,
      });
    } catch (error) {
      core.info("Merging (or commenting) failed:");
      core.error(error as Error);
      core.setFailed("Failed to merge");

      const linkToCI = `${githubServerUrl}/${thisRepo.owner}/${thisRepo.repo}/actions/runs/${process.env.GITHUB_RUN_ID}?check_suite_focus=true`;
      await octokit.rest.issues.createComment({
        ...thisRepo,
        issue_number: issue.number,
        body: `There was an issue merging, maybe try again ${sender}. <a href="${linkToCI}">Details</a>`,
      });
    }
  }

  async closePROrIssueIfInCodeowners(): Promise<void> {
    // Because closing a PR/issue does not mutate the repo, we can use a weaker
    // authentication method: basically is the person in the codeowners? Then they can close
    // an issue or PR.
    if (!githubLoginIsInCodeowners(this.sender, this.cwd)) {
      return;
    }

    const { octokit, thisRepo, issue, sender } = this;

    core.info("Creating comments and closing");
    await octokit.rest.issues.update({ ...thisRepo, issue_number: issue.number, state: "closed" });
    await octokit.rest.issues.createComment({
      ...thisRepo,
      issue_number: issue.number,
      body: `Closing because @${sender} is one of the code-owners of this repository.`,
    });
  }

  async reopenPROrIssueIfInCodeowners(): Promise<void> {
    if (!githubLoginIsInCodeowners(this.sender, this.cwd)) {
      return;
    }

    const { octokit, thisRepo, issue, sender } = this;

    core.info("Creating comments and reopening");
    await octokit.rest.issues.update({ ...thisRepo, issue_number: issue.number, state: "open" });
    await octokit.rest.issues.createComment({
      ...thisRepo,
      issue_number: issue.number,
      body: `Reopening because @${sender} is one of the code-owners of this repository.`,
    });
  }
}

export const getFilesNotOwnedByCodeOwner = (owner: string, files: string[], cwd: string): string[] => {
  const filesWhichArentOwned: string[] = [];
  const codeowners = new Codeowners(cwd);

  for (const file of files) {
    const relative = file.startsWith("/") ? file.slice(1) : file;
    const owners = codeowners.getOwner(relative);
    if (owners.length > 0 && !owners.includes(owner)) {
      filesWhichArentOwned.push(file);
    }
  }

  return filesWhichArentOwned;
};

// This is a reasonable security measure for proving an account is specified in the codeowners
// but SHOULD NOT be used for authentication for something which mutates the repo.
export const githubLoginIsInCodeowners = (login: string, cwd: string): boolean => {
  const codeowners = new Codeowners(cwd);
  const contents = readFileSync(codeowners.codeownersFilePath, "utf8").toLowerCase();
  const loginLower = login.toLowerCase();

  const pattern = new RegExp(`(^|\\s)@${loginLower.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:\\s|$)`, "m");
  return pattern.test(contents);
};

export const hasValidLgtmSubstring = (bodyLower: string): boolean => {
  const quoteChars = new Set(["\"", "'", "`"]);
  const wordCharPattern = /[a-z0-9_]/;
  let searchFrom = 0;

  while (searchFrom < bodyLower.length) {
    const idx = bodyLower.indexOf("lgtm", searchFrom);
    if (idx === -1) {
      break;
    }

    searchFrom = idx + 4;

    const afterLgtm = bodyLower.slice(idx + 4).trimStart();
    if (afterLgtm.startsWith("but") || afterLgtm.startsWith(", but")) {
      continue;
    }

    const charBefore = idx > 0 ? bodyLower.charAt(idx - 1) : "";
    const charAfter = bodyLower.charAt(idx + 4);
    if (quoteChars.has(charBefore) || quoteChars.has(charAfter)) {
      continue;
    }
    if (wordCharPattern.test(charBefore) || wordCharPattern.test(charAfter)) {
      continue;
    }

    return true;
  }

  return false;
};

const listFilesWithOwners = (files: string[], cwd: string): void => {
  const codeowners = new Codeowners(cwd);
  console.log("\nKnown code-owners for changed files:");
  for (const file of files) {
    const relative = file.startsWith("/") ? file.slice(1) : file;
    const owners = codeowners.getOwner(relative);
    console.log(`- ${file} (${formatList(owners)})`);
  }
  console.log("\n> CODEOWNERS file:");
  console.log(readFileSync(codeowners.codeownersFilePath, "utf8"));
};

export const findCodeOwnersForChangedFiles = (
  changedFiles: string[], cwd: string
): { users: string[]; labels: string[] } => {
  const owners = new Set<string>();
  const labels = new Set<string>();
  const codeowners = new Codeowners(cwd);

  for (const file of changedFiles) {
    const relative = file.startsWith("/") ? file.slice(1) : file;
    const filesOwners = codeowners.getOwner(relative);
    filesOwners.forEach((owner) => {
      if (owner.startsWith("@")) {
        owners.add(owner);
      }
      if (owner.startsWith("[")) {
        labels.add(owner.slice(1, owner.length - 1));
      }
    });
  }

  return {
    users: Array.from(owners),
    labels: Array.from(labels),
  };
};

const getPRChangedFiles = async (octokit: Octokit, repoDeets: RepoDetails, prNumber: number): Promise<string[]> => {
  const options = octokit.rest.pulls.listFiles.endpoint.merge({ ...repoDeets, pull_number: prNumber });
  const files = await octokit.paginate(options);
  return (files as PullsListFilesResponseItem[]).map((file) => `/${file.filename}`);
};

const createOrAddLabel = async (octokit: Octokit, repoDeets: RepoDetails, labelConfig: LabelConfig): Promise<void> => {
  const existingLabels = await octokit.paginate("GET /repos/:owner/:repo/labels", {
    owner: repoDeets.owner,
    repo: repoDeets.repo,
  });
  const label = (existingLabels as RepoLabel[]).find((item) => item.name === labelConfig.name);

  // Create the label if it doesn't exist yet
  if (!label) {
    try {
      await octokit.rest.issues.createLabel({
        owner: repoDeets.owner,
        repo: repoDeets.repo,
        name: labelConfig.name,
        color: labelConfig.color,
        description: labelConfig.description,
      });
    } catch (error) {
      const status = (error as { status?: number }).status;
      if (status !== 422) {
        throw error;
      }
      core.info(`Label '${labelConfig.name}' already exists (created concurrently), continuing`);
    }
  }

  if (repoDeets.id == null) {
    throw new Error("Missing issue id for label creation");
  }

  await octokit.rest.issues.addLabels({
    owner: repoDeets.owner,
    repo: repoDeets.repo,
    issue_number: repoDeets.id,
    labels: [labelConfig.name],
  });
};

type ListFormatLike = new (...args: never[]) => { format: (items: string[]) => string };

const formatList = (items: string[]): string => {
  const listFormat = (Intl as unknown as { ListFormat?: ListFormatLike }).ListFormat;
  if (listFormat) {
    return new listFormat().format(items);
  }
  return items.join(", ");
};

// Effectively the main function
const run = async (): Promise<void> => {
  core.info("Running version 0.1.0");

  // Tell folks they can merge
  if (context.eventName === "pull_request_target") {
    await commentOnMergablePRs();
  }

  // Merge if they say they have access
  if (context.eventName === "issue_comment" || context.eventName === "pull_request_review") {
    const bodyLower = getPayloadBody().toLowerCase();
    if (hasValidLgtmSubstring(bodyLower)) {
      await new Actor().mergeIfHasAccess();
    } else if (bodyLower.includes("@github-actions close")) {
      await new Actor().closePROrIssueIfInCodeowners();
    } else if (bodyLower.includes("@github-actions reopen")) {
      await new Actor().reopenPROrIssueIfInCodeowners();
    } else {
      console.log("Doing nothing because the body does not include a command");
    }
  }
};

run().catch((error) => {
  core.setFailed(error instanceof Error ? error.message : String(error));
});

// Bail correctly
process.on("uncaughtException", (err) => {
  core.setFailed(err.message);
  console.error(new Date().toUTCString() + " uncaughtException:", err.message);
  console.error(err.stack);
  process.exit(1);
});
