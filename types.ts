// Types for the GraphQL query

export interface Repository {
  pullRequests: PullRequests;
}

export interface PullRequests {
  totalCount: number;
  pageInfo: PageInfo;
  nodes: PullRequestNode[];
}

export interface PageInfo {
  startCursor: string | null;
  endCursor: string | null;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}

export interface PullRequestNode {
  id: string;
  isDraft: boolean;
  createdAt: string;
  url: string;
  headRefName: string;
  author: User;
  commits: CommitConnection;
  reviews: ReviewConnection;
}

export interface CommitConnection {
  nodes: CommitNode[];
}

export interface CommitNode {
  commit: {
    statusCheckRollup: {
      state: "SUCCESS" | "FAILURE" | "PENDING" | "NEUTRAL" | "UNKNOWN";
    } | null;
  };
}

export interface ReviewConnection {
  nodes: ReviewNode[];
}

export interface ReviewNode {
  state:
    | "APPROVED"
    | "CHANGES_REQUESTED"
    | "COMMENTED"
    | "DISMISSED"
    | "PENDING";
}

export interface User {
  resourcePath: string;
  login: string;
}

// Top-level response type
export interface GetPullRequestsResponse {
  repository: Repository;
}