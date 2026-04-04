import assert from "node:assert/strict";
import test from "node:test";

import { readGitHubPullRequestLinkedIssueId } from "../../../src/app/providers/github-utils.js";

test("readGitHubPullRequestLinkedIssueId returns the first linked issue and sends the PR number to GraphQL", async (t) => {
  const originalFetch = global.fetch;
  let receivedQuery = "";
  let receivedVariables: Record<string, unknown> | undefined;

  global.fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as {
      query?: string;
      variables?: Record<string, unknown>;
    };
    receivedQuery = body.query ?? "";
    receivedVariables = body.variables;

    return new Response(
      JSON.stringify({
        data: {
          repository: {
            pullRequest: {
              closingIssuesReferences: {
                nodes: [{ number: 16 }]
              }
            }
          }
        }
      }),
      {
        status: 200,
        headers: { "content-type": "application/json" }
      }
    );
  };

  t.after(() => {
    global.fetch = originalFetch;
  });

  const issueId = await readGitHubPullRequestLinkedIssueId({
    repoFullName: "acme/demo",
    prId: "25",
    token: "installation-token"
  });

  assert.equal(issueId, "16");
  assert.match(receivedQuery, /closingIssuesReferences\(first: 1\)/);
  assert.deepEqual(receivedVariables, {
    owner: "acme",
    repo: "demo",
    pr: 25
  });
});

test("readGitHubPullRequestLinkedIssueId returns undefined when GitHub reports no linked issues", async (t) => {
  const originalFetch = global.fetch;

  global.fetch = async () =>
    new Response(
      JSON.stringify({
        data: {
          repository: {
            pullRequest: {
              closingIssuesReferences: {
                nodes: []
              }
            }
          }
        }
      }),
      {
        status: 200,
        headers: { "content-type": "application/json" }
      }
    );

  t.after(() => {
    global.fetch = originalFetch;
  });

  const issueId = await readGitHubPullRequestLinkedIssueId({
    repoFullName: "acme/demo",
    prId: "25",
    token: "installation-token"
  });

  assert.equal(issueId, undefined);
});

test("readGitHubPullRequestLinkedIssueId chooses the first linked issue when GitHub returns multiple", async (t) => {
  const originalFetch = global.fetch;

  global.fetch = async () =>
    new Response(
      JSON.stringify({
        data: {
          repository: {
            pullRequest: {
              closingIssuesReferences: {
                nodes: [{ number: 16 }, { number: 17 }]
              }
            }
          }
        }
      }),
      {
        status: 200,
        headers: { "content-type": "application/json" }
      }
    );

  t.after(() => {
    global.fetch = originalFetch;
  });

  const issueId = await readGitHubPullRequestLinkedIssueId({
    repoFullName: "acme/demo",
    prId: "25",
    token: "installation-token"
  });

  assert.equal(issueId, "16");
});
