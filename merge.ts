// Merging a PR: what the merge lands (with GitHub stacked PRs, every PR below
// it too), whether all of that is ready, and merging through the async merge
// API that stacked PRs require.
import type { getOctokit } from "@actions/github";

export type MergeMethod = "merge" | "squash" | "rebase";

// Not yet in @octokit/openapi-types: the `stack` field on a pull request, the
// Stacks REST API, and the async merge API that stacked PRs require.
type PullRequestStackRef = { number: number; size: number; position: number };

type StackPullRequest = {
  number: number;
  state: string;
  draft: boolean;
  merged_at: string | null;
};

type AsyncMergeStatus = "pending" | "merged" | "enqueued" | "failed";

export type AsyncMergeResult = {
  status: AsyncMergeStatus;
  details: { message?: string; uuid?: string; sha?: string };
};

type AsyncMergeOptions = {
  owner: string;
  repo: string;
  pull_number: number;
  merge_method: MergeMethod;
  commit_message?: string;
  sha?: string;
};

type Octokit = ReturnType<typeof getOctokit>;
type RequestLike = Pick<Octokit, "request">;
type PullRequest = Awaited<ReturnType<Octokit["rest"]["pulls"]["get"]>>["data"];
type RepoRef = { owner: string; repo: string };

// The PRs a merge of `pr` would land, bottom of the stack first. Merging a
// stacked PR atomically merges every unmerged PR below it too, so those all
// need the same access and status checks. An unstacked PR is just itself.
export const getMergeRange = async (
  octokit: RequestLike,
  repo: RepoRef,
  pr: { number: number },
): Promise<number[]> => {
  const stackRef = (pr as { stack?: PullRequestStackRef | null }).stack;
  if (!stackRef) {
    return [pr.number];
  }

  const { data } = await octokit.request(
    "GET /repos/{owner}/{repo}/stacks/{stack_number}",
    { owner: repo.owner, repo: repo.repo, stack_number: stackRef.number },
  );
  const members = (data as { pull_requests: StackPullRequest[] }).pull_requests;
  const index = members.findIndex((member) => member.number === pr.number);
  if (index === -1) {
    throw new Error(
      `PR #${pr.number} is not in stack #${stackRef.number}, refusing to merge.`,
    );
  }
  return members
    .slice(0, index + 1)
    .filter((member) => !member.merged_at)
    .map((member) => member.number);
};

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

// Merges through the async merge API, which stacked PRs require (the classic
// endpoint rejects them) and which works for unstacked PRs too. Polls until
// the merge settles or `timeoutMs` passes, returning the last result seen.
// Returns undefined if the API isn't available (404), e.g. on older GHES.
export const mergePullRequestAsync = async (
  octokit: RequestLike,
  options: AsyncMergeOptions,
  { pollIntervalMs = 2000, timeoutMs = 60_000 } = {},
): Promise<AsyncMergeResult | undefined> => {
  const { owner, repo } = options;
  let result: AsyncMergeResult;
  try {
    const response = await octokit.request(
      "PUT /repos/{owner}/{repo}/pulls/{pull_number}/merge-async",
      { ...options, merge_action: "default" },
    );
    result = response.data as AsyncMergeResult;
  } catch (error) {
    const status = (error as { status?: number }).status;
    if (status === 404) return undefined;
    if (status === 409) {
      throw new Error("A merge is already in progress for this PR.");
    }
    throw error;
  }

  const deadline = Date.now() + timeoutMs;
  while (result.status === "pending" && result.details.uuid) {
    if (Date.now() >= deadline) break;
    await sleep(pollIntervalMs);
    const response = await octokit.request(
      "GET /repos/{owner}/{repo}/pulls/{pull_number}/merge-async/{uuid}",
      {
        owner,
        repo,
        pull_number: options.pull_number,
        uuid: result.details.uuid,
      },
    );
    result = response.data as AsyncMergeResult;
  }
  return result;
};

// Prefers the API's own explanation (e.g. why a merge was rejected) over
// Octokit's generic "HttpError" wrapper.
export const errorMessage = (error: unknown): string => {
  const response = (error as { response?: { data?: unknown } }).response;
  const data = response?.data as
    | { message?: string; details?: { message?: string } }
    | undefined;
  return (
    data?.details?.message ||
    data?.message ||
    (error instanceof Error ? error.message : String(error))
  );
};

// Returns a reason the PR can't be merged yet, or undefined if it can.
// `which` names the PR in the message ("this PR" or "#12").
const getMergeBlocker = async (
  octokit: Octokit,
  repo: RepoRef,
  pr: PullRequest,
  which: string,
): Promise<string | undefined> => {
  if (pr.draft) {
    return `${which} is a draft.`;
  }

  // Don't try merge if mergability is not yet known
  if (pr.mergeable === null) {
    return `${which} is still running background checks to compute mergeability. They'll need to complete before this can be merged.`;
  }

  // Don't try merge unmergable stuff
  if (!pr.mergeable) {
    return `${which} has merge conflicts. They'll need to be fixed before this can be merged.`;
  }

  // Don't merge red PRs or PRs with pending statuses
  const statusInfo = await octokit.rest.repos.listCommitStatusesForRef({
    ...repo,
    ref: pr.head.sha,
  });
  const latestStatuses = statusInfo.data.filter(
    (thing, index, self) =>
      index === self.findIndex((item) => item.target_url === thing.target_url),
  );

  const pendingStatus = latestStatuses.find(
    (status) => status.state === "pending",
  );
  if (pendingStatus) {
    return `${which} has pending status checks that haven't completed yet. Blocked by [${pendingStatus.context}](${pendingStatus.target_url}): '${pendingStatus.description}'.`;
  }

  const failedStatus = latestStatuses.find(
    (status) => status.state !== "success",
  );
  if (failedStatus) {
    return `${which} could not be merged because it wasn't green. Blocked by [${failedStatus.context}](${failedStatus.target_url}): '${failedStatus.description}'.`;
  }

  return undefined;
};

// Checks each PR the merge would land (see getMergeRange), bottom first.
export const getMergeBlockerInRange = async (
  octokit: Octokit,
  repo: RepoRef,
  target: PullRequest,
  range: number[],
): Promise<string | undefined> => {
  for (const number of range) {
    const isTarget = number === target.number;
    const pr = isTarget
      ? target
      : (await octokit.rest.pulls.get({ ...repo, pull_number: number })).data;
    const blocker = await getMergeBlocker(
      octokit,
      repo,
      pr,
      isTarget ? "this PR" : `#${number} (below in the stack)`,
    );
    if (blocker) {
      return blocker;
    }
  }
  return undefined;
};
