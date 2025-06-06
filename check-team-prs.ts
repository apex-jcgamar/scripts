import { graphql } from "@octokit/graphql";
import { githubAccessToken } from './secrets.json'

const fetchPullRequests = async () => {
  return await graphql<>(
    `
      query {
        repository(owner: "apex-fintech-solutions", name: "source") {
          pullRequests(
            first: 10
            states: [OPEN]
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
              comments(first: 50) {
                nodes {
                  author {
                    resourcePath
                  }
                }
              }
              reviews {
                totalCount
              }
              suggestedReviewers {
                reviewer {
                  name
                }
              }
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
      headers: { authorization: `Bearer ${githubAccessToken}` },
    }
  );
}

const main = async () => {

  do {

  } while ();

  console.log(JSON.stringify(a, null, 2));
};

main();
