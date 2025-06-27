import { graphql } from "@octokit/graphql";
import { githubAccessToken } from "./secrets.json";
import chalk from "chalk";

// Configuration
const CONFIG = {
  pageSize: 10 as const,
  repository: {
    owner: "apex-fintech-solutions",
    name: "source",
  },
  watchedAuthors: [
    "JeronimoUlloa",
    "timp-apex",
    "gmarin3",
    "apex-jcgamar",
    "tim-isakzhanov",
  ],
  style: {
    author: chalk.cyan.bold,
    draft: chalk.yellow,
    date: chalk.gray,
    branch: chalk.green,
    url: chalk.blue.underline,
    count: chalk.magenta.bold,
    queue: chalk.yellow("🔀"),
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

  // Check if the date is today
  if (date.toDateString() === now.toDateString()) {
    return "today";
  }

  if (diffDays < 7) {
    const days = [
      "Sunday",
      "Monday",
      "Tuesday",
      "Wednesday",
      "Thursday",
      "Friday",
      "Saturday",
    ];
    return `${days[date.getDay()]} (${diffDays + 1} ${
      diffDays === 1 ? "day" : "days"
    } ago)`;
  }

  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  return `${date.getDate().toString().padStart(2, "0")}-${
    months[date.getMonth()]
  }`;
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
  return {
    author: node.author.login,
    url: node.url,
    branch: node.headRefName,
    isDraft: node.isDraft,
    createdAt: node.createdAt,
    status: status as PullRequest["status"],
    reviewStatus,
    inQueue: node.labels.nodes.some((label) => label.name === "queue"),
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

    const prs = response.search.nodes
      .filter(isPullRequestNode)
      .map(transformPullRequest);

    if (prs.length === 0) {
      console.log("No open pull requests found for the watched authors.");
      return;
    }

    console.log("\nOpen Pull Requests:\n");
    prs.forEach((pr) => {
      console.log(formatPullRequest(pr));
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

const formatPullRequest = (pr: PullRequest): string => {
  const draftTag = pr.isDraft ? CONFIG.style.draft("[DRAFT] ") : "";
  const statusIcon =
    CONFIG.style.status[
      pr.status.toLowerCase() as keyof typeof CONFIG.style.status
    ];
  const reviewIcons = [
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

  return `${statusIcon} ${draftTag}${CONFIG.style.author(
    pr.author
  )} - ${CONFIG.style.branch(
    pr.branch
  )} ${reviewIcons}\n   (${CONFIG.style.date(
    pr.createdAt
  )})\n   ${CONFIG.style.url(pr.url)}\n`;
};
