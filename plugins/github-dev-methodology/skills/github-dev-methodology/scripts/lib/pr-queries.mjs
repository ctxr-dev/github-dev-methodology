const THREADS_FIELDS = `pageInfo{hasNextPage endCursor}
        nodes{isResolved isOutdated comments(first:1){nodes{author{login}}}}`;

export const SNAPSHOT_QUERY = `query($o:String!,$r:String!,$n:Int!,$c:String){
  repository(owner:$o,name:$r){
    pullRequest(number:$n){
      headRefOid
      author{login}
      latestReviews(first:100){nodes{author{login} state commit{oid}}}
      reviewRequests(first:100){nodes{requestedReviewer{... on User{login} ... on Bot{login} ... on Team{slug}}}}
      commits(last:1){nodes{commit{pushedDate committedDate statusCheckRollup{state}}}}
      reviewThreads(first:100,after:$c){
        ${THREADS_FIELDS}
      }
    }
  }
}`;

export const THREADS_PAGE_QUERY = `query($o:String!,$r:String!,$n:Int!,$c:String){
  repository(owner:$o,name:$r){
    pullRequest(number:$n){
      reviewThreads(first:100,after:$c){
        ${THREADS_FIELDS}
      }
    }
  }
}`;

export const THREAD_LIST_QUERY = `query($o:String!,$r:String!,$n:Int!,$cursor:String){
  repository(owner:$o,name:$r){
    pullRequest(number:$n){
      reviewThreads(first:100,after:$cursor){
        pageInfo{hasNextPage endCursor}
        nodes{id isResolved isOutdated path line comments(first:1){nodes{author{login} body url}}}
      }
    }
  }
}`;

export const RESOLVE_THREAD_MUTATION = `mutation($id:ID!){
  resolveReviewThread(input:{threadId:$id}){thread{id isResolved}}
}`;

export const REVIEW_REQUESTS_QUERY = `query($o:String!,$r:String!,$n:Int!){
  repository(owner:$o,name:$r){
    pullRequest(number:$n){
      id
      reviewRequests(first:100){nodes{requestedReviewer{... on User{login} ... on Bot{login} ... on Team{slug}}}}
    }
  }
}`;

export const SUGGESTED_REVIEWERS_QUERY = `query($o:String!,$r:String!){
  repository(owner:$o,name:$r){
    suggestedActors(capabilities:[CAN_BE_REVIEWER],first:100){
      nodes{... on User{id login} ... on Bot{id login}}
    }
  }
}`;

export const REQUEST_REVIEWS_MUTATION = `mutation($pr:ID!,$userIds:[ID!],$botIds:[ID!]){
  requestReviews(input:{pullRequestId:$pr,userIds:$userIds,botIds:$botIds,union:true}){pullRequest{id}}
}`;

export function userIdsQuery(count) {
  const variables = Array.from({ length: count }, (_, index) => `$l${index}:String!`).join(",");
  const fields = Array.from({ length: count }, (_, index) => `u${index}:user(login:$l${index}){id login}`).join(" ");
  return `query(${variables}){${fields}}`;
}
