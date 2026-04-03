const baseRepository = {
  name: "demo",
  full_name: "acme/demo",
  default_branch: "main",
  private: false,
  html_url: "https://github.com/acme/demo",
  owner: { login: "acme" }
};

const baseSender = {
  login: "octocat",
  id: 1,
  type: "User",
  html_url: "https://github.com/octocat"
};

const baseInstallation = { id: 42 };

export function issueOpenedPayload() {
  return {
    action: "opened",
    repository: baseRepository,
    sender: baseSender,
    installation: baseInstallation,
    issue: {
      number: 7,
      title: "Fix failing check",
      body: "Need a plan",
      state: "open",
      html_url: "https://github.com/acme/demo/issues/7",
      user: { login: "octocat" }
    }
  };
}

export function issueClosedPayload() {
  return {
    ...issueOpenedPayload(),
    action: "closed",
    issue: {
      ...issueOpenedPayload().issue,
      state: "closed"
    }
  };
}

export function issueCommentPayload(
  body: string,
  options?: { pullRequest?: boolean; senderLogin?: string; issueState?: "open" | "closed" }
) {
  return {
    action: "created",
    repository: baseRepository,
    sender: { ...baseSender, login: options?.senderLogin ?? baseSender.login },
    installation: baseInstallation,
    issue: {
      number: 7,
      title: "Fix failing check",
      body: "Need a plan",
      state: options?.issueState ?? "open",
      html_url: "https://github.com/acme/demo/issues/7",
      user: { login: "octocat" },
      ...(options?.pullRequest ? { pull_request: { url: "https://api.github.com/repos/acme/demo/pulls/7" } } : {})
    },
    comment: {
      id: 99,
      body,
      html_url: "https://github.com/acme/demo/issues/7#issuecomment-99"
    }
  };
}

export function reviewCommentPayload(body: string) {
  return {
    action: "created",
    repository: baseRepository,
    sender: baseSender,
    installation: baseInstallation,
    pull_request: {
      number: 8,
      title: "Improve runtime",
      body: "Adds the runtime",
      state: "open",
      html_url: "https://github.com/acme/demo/pull/8"
    },
    comment: {
      id: 101,
      body,
      html_url: "https://github.com/acme/demo/pull/8#discussion_r101"
    }
  };
}

export function reviewPayload(body: string, state = "changes_requested") {
  return {
    action: "submitted",
    repository: baseRepository,
    sender: baseSender,
    installation: baseInstallation,
    pull_request: {
      number: 8,
      title: "Improve runtime",
      body: "Adds the runtime",
      state: "open",
      html_url: "https://github.com/acme/demo/pull/8"
    },
    review: {
      id: 202,
      node_id: "PRR_kwDOdemo202",
      body,
      state,
      html_url: "https://github.com/acme/demo/pull/8#pullrequestreview-202"
    }
  };
}
