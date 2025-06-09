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
  comments: CommentConnection;
  reviews: ReviewConnection;
  suggestedReviewers: ReviewerConnection;
  author: User;
}

export interface CommentConnection {
  nodes: CommentNode[];
}

export interface CommentNode {
  author: Author;
}

export interface Author {
  resourcePath: string;
}

export interface ReviewConnection {
  totalCount: number;
}

export interface ReviewerConnection {
  reviewer: Reviewer;
}

export interface Reviewer {
  name: string;
}

export interface User {
  resourcePath: string;
  login: string;
}

// Top-level response type
export interface GetPullRequestsResponse {
  repository: Repository;
}