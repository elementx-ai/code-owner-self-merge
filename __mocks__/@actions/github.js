export const context = {};
export function getOctokit() {
  const notImplemented = (methodName) => {
    throw new Error(`Octokit mock for method "${methodName}" is not implemented. Extend __mocks__/@actions/github.js for this test.`);
  };

  return {
    issues: {
      create: () => notImplemented('issues.create'),
      listForRepo: () => notImplemented('issues.listForRepo'),
    },
    pulls: {
      create: () => notImplemented('pulls.create'),
      list: () => notImplemented('pulls.list'),
    },
    repos: {
      get: () => notImplemented('repos.get'),
      listForOrg: () => notImplemented('repos.listForOrg'),
    },
  };
}
