import { graphql } from "@octokit/graphql";
import { githubAccessToken } from "./secrets.json";
import chalk from "chalk";
import simpleGit from "simple-git";

// Configuration
const CONFIG = {
  pageSize: 10 as const,
  repository: {
    owner: "apex-fintech-solutions",
    name: "source",
  },
  paths: {
    baseDir: "/home/jgama/workspace/source",
  },
  watchedAuthors: [
    "apex-jcgamar",
    "JeronimoUlloa",
    "timp-apex",
    "gmarin3",
    "tim-isakzhanov",
    "amy-moore-apex",
  ],
  style: {
    author: chalk.cyan.bold,
    draft: chalk.yellow,
    date: chalk.gray,
    branch: chalk.green,
    url: chalk.blue.underline,
    count: chalk.magenta.bold,
    queue: chalk.yellow("🔀"),
    currentBranch: "📌",
    status: {
      success: chalk.green("✓"),
      failure: chalk.red("✗"),
      pending: chalk.yellow("○"),
      neutral: chalk.gray("○"),
      unknown: chalk.gray("?"),
    },
    reviews: {
      approved: "👍",
      changesRequested: "👎",
    },
  },
};

const git = simpleGit({ baseDir: CONFIG.paths.baseDir });

// Types
interface PullRequest {
  author: string;
  url: string;
  branch: string;
  isDraft: boolean;
  createdAt: string;
  status: "SUCCESS" | "FAILURE" | "PENDING" | "NEUTRAL" | "UNKNOWN";
  reviewStatus: {
    approved: number;
    changesRequested: boolean;
  };
  inQueue: boolean;
  mandatoryReviewers: { name: string; type: "User" | "Team" }[];
}

interface Review {
  state: string;
}

interface Commit {
  commit: {
    statusCheckRollup: {
      state: string;
    } | null;
  } | null;
}

interface PullRequestNode {
  id: string;
  createdAt: string;
  url: string;
  isDraft: boolean;
  headRefName: string;
  author: {
    resourcePath: string;
    login: string;
  };
  commits: {
    nodes: Commit[];
  };
  reviews: {
    nodes: Review[];
  };
  labels: {
    nodes: {
      name: string;
    }[];
  };
  reviewRequests: {
    nodes: {
      requestedReviewer:
        | { __typename: "User"; login: string }
        | { __typename: "Team"; name: string }
        | null;
    }[];
  };
}

interface SearchResponse {
  search: {
    pageInfo: {
      startCursor: string;
      endCursor: string;
      hasNextPage: boolean;
      hasPreviousPage: boolean;
    };
    nodes: (PullRequestNode | null)[];
  };
}

// Date formatting utilities
const formatDate = (dateStr: string): string => {
  const date = new Date(dateStr);
  const now = new Date();
  const diffDays = Math.floor(
    (now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24)
  );

  const days = [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
  ];

  // Check if the date is today
  if (date.toDateString() === now.toDateString()) {
    return `${days[date.getDay()]} (today)`;
  }

  // Show day of week and days ago
  return `${days[date.getDay()]} (${diffDays} ${
    diffDays === 1 ? "day" : "days"
  } ago)`;
};

const fetchPullRequests = async (nextPagePointer: string | null) => {
  const authorFilters = CONFIG.watchedAuthors
    .map((author) => `author:${author}`)
    .join(" ");

  try {
    return await graphql<SearchResponse>(
      `
        query ($pageSize: Int!, $after: String, $searchQuery: String!) {
          search(
            query: $searchQuery
            type: ISSUE
            first: $pageSize
            after: $after
          ) {
            pageInfo {
              startCursor
              endCursor
              hasNextPage
              hasPreviousPage
            }
            nodes {
              ... on PullRequest {
                id
                createdAt
                url
                isDraft
                headRefName
                author {
                  resourcePath
                  login
                }
                commits(last: 1) {
                  nodes {
                    commit {
                      statusCheckRollup {
                        state
                      }
                    }
                  }
                }
                reviews(last: 100, states: [APPROVED, CHANGES_REQUESTED]) {
                  nodes {
                    state
                  }
                }
                labels(first: 100) {
                  nodes {
                    name
                  }
                }
                reviewRequests(first: 10) {
                  nodes {
                    requestedReviewer {
                      __typename
                      ... on User {
                        login
                      }
                      ... on Team {
                        name
                      }
                    }
                  }
                }
              }
            }
          }
        }
      `,
      {
        pageSize: CONFIG.pageSize,
        after: nextPagePointer,
        searchQuery: `repo:${CONFIG.repository.owner}/${CONFIG.repository.name} is:pr is:open ${authorFilters}`,
        headers: { authorization: `Bearer ${githubAccessToken}` },
      }
    );
  } catch (error) {
    console.error(
      "Error fetching pull requests:",
      error instanceof Error ? error.message : String(error)
    );
    throw error;
  }
};

const transformPullRequest = (node: PullRequestNode): PullRequest => {
  const status =
    node.commits.nodes[0]?.commit?.statusCheckRollup?.state ?? "UNKNOWN";
  const reviews = node.reviews.nodes;
  const reviewStatus = {
    approved: reviews.filter((r) => r.state === "APPROVED").length,
    changesRequested: reviews.some((r) => r.state === "CHANGES_REQUESTED"),
  };
  const mandatoryReviewers = node.reviewRequests.nodes
    .map((req) => {
      if (!req.requestedReviewer) return null;
      if (req.requestedReviewer.__typename === "User")
        return { name: req.requestedReviewer.login, type: "User" };
      if (req.requestedReviewer.__typename === "Team")
        return { name: req.requestedReviewer.name, type: "Team" };
      return null;
    })
    .filter((r): r is { name: string; type: "User" | "Team" } => !!r);
  return {
    author: node.author.login,
    url: node.url,
    branch: node.headRefName,
    isDraft: node.isDraft,
    createdAt: node.createdAt,
    status: status as PullRequest["status"],
    reviewStatus,
    inQueue: node.labels.nodes.some((label) => label.name === "queue"),
    mandatoryReviewers,
  };
};

const isPullRequestNode = (node: unknown): node is PullRequestNode =>
  node !== null &&
  node !== undefined &&
  typeof node === "object" &&
  "author" in node;

const main = async () => {
  try {
    const response = await fetchPullRequests(null);
    console.log("Fetching pull requests...");

    // Get current branch
    let currentBranch: string | null = null;
    try {
      const status = await git.status();
      currentBranch = status.current || null;
    } catch (error) {
      console.warn("Could not determine current git branch");
    }

    const prs = response.search.nodes
      .filter(isPullRequestNode)
      .map(transformPullRequest);

    if (prs.length === 0) {
      console.log("No open pull requests found for the watched authors.");
      return;
    }

    // Group PRs by author
    const prsByAuthor = prs.reduce((groups, pr) => {
      if (!groups[pr.author]) {
        groups[pr.author] = [];
      }
      groups[pr.author].push(pr);
      return groups;
    }, {} as Record<string, PullRequest[]>);

    console.log("\nOpen Pull Requests:\n");

    // Display grouped PRs
    Object.entries(prsByAuthor).forEach(([author, authorPrs]) => {
      console.log(
        CONFIG.style.author(
          `${author} (${authorPrs.length} PR${authorPrs.length > 1 ? "s" : ""})`
        )
      );
      console.log("─".repeat(50));

      authorPrs.forEach((pr) => {
        console.log(formatPullRequest(pr, currentBranch));
      });
    });

    console.log(`Total PRs found: ${CONFIG.style.count(prs.length)}`);
  } catch (error) {
    console.error(
      "An error occurred while running the script:",
      error instanceof Error ? error.message : String(error)
    );
    process.exit(1);
  }
};

main();

const formatPullRequest = (
  pr: PullRequest,
  currentBranch: string | null = null
): string => {
  const draftTag = pr.isDraft ? CONFIG.style.draft("[DRAFT] ") : "";
  const statusIcon =
    CONFIG.style.status[
      pr.status.toLowerCase() as keyof typeof CONFIG.style.status
    ];

  // Collect all icons for the right side
  const icons = [
    pr.author === "apex-jcgamar" ? "⭐" : "",
    currentBranch && pr.branch === currentBranch
      ? CONFIG.style.currentBranch
      : "",
    pr.reviewStatus.approved > 0
      ? `${CONFIG.style.reviews.approved} ${pr.reviewStatus.approved}`
      : "",
    pr.reviewStatus.changesRequested
      ? CONFIG.style.reviews.changesRequested
      : "",
    pr.inQueue ? CONFIG.style.queue : "",
  ]
    .filter(Boolean)
    .join(" ");

  const iconsSection = icons ? ` ${icons}` : "";

  // Print px-frontend-c, core-services, or watchedAuthors in red
  const reviewersSection =
    pr.mandatoryReviewers.length > 0
      ? "\t" +
        pr.mandatoryReviewers
          .map((r) => {
            if (
              [
                ...CONFIG.watchedAuthors,
                "px-frontend-c",
                "core-services",
              ].includes(r.name)
            ) {
              return chalk.red(r.name);
            }
            return r.name;
          })
          .join(", ") +
        "\n"
      : "";

  return `${statusIcon} ${draftTag}${CONFIG.style.branch(
    pr.branch
  )}${iconsSection}\n   (${CONFIG.style.date(
    formatDate(pr.createdAt)
  )})\n   ${CONFIG.style.url(pr.url)}\n${reviewersSection}`;
};
