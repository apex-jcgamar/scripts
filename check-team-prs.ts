import { graphql } from "@octokit/graphql";
import { githubAccessToken } from "./secrets.json";
import { GetPullRequestsResponse } from "./types";

const pageSize: Readonly<number> = 30;
const watchedAuthors = [
  "JeronimoUlloa",
  "timp-apex",
  "gmarin3",
  "apex-jcgamar",
  "tim-isakzhanov",
];

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
      owner: "apex-fintech-solutions",
      name: "source",
      pageSize,
      after: nextPagePointer,
      headers: { authorization: `Bearer ${githubAccessToken}` },
    }
  );
};

const main = async () => {
  let hasNextPage = false;
  let nextPage: string | null = null;

  do {
    const response = await fetchPullRequests(nextPage);
    hasNextPage = response.repository.pullRequests.pageInfo.hasNextPage;
    nextPage = response.repository.pullRequests.pageInfo.endCursor;

    const prs = response.repository.pullRequests.nodes
      .map(({ author, url, isDraft, createdAt, headRefName }) => ({
        author: author.login,
        url,
        branch: headRefName,
        isDraft,
        createdAt: formatDate(createdAt),
      }))
      .filter(({ author }) => watchedAuthors.includes(author))
      .forEach((pr) => {
        console.log(pr);
      });
  } while (hasNextPage);
};

main();
