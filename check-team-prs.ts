import { graphql } from "@octokit/graphql";
import { githubAccessToken } from "./secrets.json";
import { GetPullRequestsResponse } from "./types";

// Configuration
const CONFIG = {
  pageSize: 30 as const,
  repository: {
    owner: "apex-fintech-solutions",
    name: "source"
  },
  watchedAuthors: [
    "JeronimoUlloa",
    "timp-apex",
    "gmarin3",
    "apex-jcgamar",
    "tim-isakzhanov",
  ]
};

// Types
interface PullRequest {
  author: string;
  url: string;
  branch: string;
  isDraft: boolean;
  createdAt: string;
}

// Date formatting utilities
const formatDate = (dateStr: string): string => {
  const date = new Date(dateStr);
  const now = new Date();
  const diffDays = Math.floor(
    (now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24)
  );

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
    return days[date.getDay()];
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
  try {
    return await graphql<GetPullRequestsResponse>(
      `
        query ($owner: String!, $name: String!, $pageSize: Int!, $after: String) {
          repository(owner: $owner, name: $name) {
            pullRequests(
              first: $pageSize
              states: [OPEN]
              after: $after
              orderBy: { field: CREATED_AT, direction: DESC }
            ) {
              totalCount
              pageInfo {
                startCursor
                endCursor
                hasNextPage
                hasPreviousPage
              }
              nodes {
                id
                createdAt
                url
                isDraft
                headRefName
                author {
                  resourcePath
                  login
                }
              }
            }
          }
        }
      `,
      {
        owner: CONFIG.repository.owner,
        name: CONFIG.repository.name,
        pageSize: CONFIG.pageSize,
        after: nextPagePointer,
        headers: { authorization: `Bearer ${githubAccessToken}` },
      }
    );
  } catch (error) {
    console.error("Error fetching pull requests:", error instanceof Error ? error.message : String(error));
    throw error;
  }
};

const formatPullRequest = (pr: PullRequest): string => {
  const draftTag = pr.isDraft ? "[DRAFT] " : "";
  return `${draftTag}${pr.author} - ${pr.branch} (${pr.createdAt})\n${pr.url}\n`;
};

const main = async () => {
  try {
    let hasNextPage = false;
    let nextPage: string | null = null;
    let pageCount = 1;
    const allPRs: PullRequest[] = [];

    do {
      const response = await fetchPullRequests(nextPage);
      hasNextPage = response.repository.pullRequests.pageInfo.hasNextPage;
      nextPage = response.repository.pullRequests.pageInfo.endCursor;

      console.log(`Fetching page ${pageCount}...`);

      const prs = response.repository.pullRequests.nodes
        .map(({ author, url, isDraft, createdAt, headRefName }): PullRequest => ({
          author: author.login,
          url,
          branch: headRefName,
          isDraft,
          createdAt: formatDate(createdAt),
        }))
        .filter(({ author }) => CONFIG.watchedAuthors.includes(author));

      allPRs.push(...prs);
      pageCount++;
    } while (hasNextPage);

    if (allPRs.length === 0) {
      console.log("No open pull requests found for the watched authors.");
      return;
    }

    console.log("\nOpen Pull Requests:\n");
    allPRs.forEach((pr) => {
      console.log(formatPullRequest(pr));
    });
    console.log(`Total PRs found: ${allPRs.length}`);

  } catch (error) {
    console.error("An error occurred while running the script:", error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
};

main();
