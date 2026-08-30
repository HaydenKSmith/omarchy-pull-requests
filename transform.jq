# Requires --arg partial "<message>": a non-fatal error from the GraphQL
# response (an SSO-gated org, say) that should surface without discarding the
# data that did come back. Pass "" when there is none.
#
# Flattens the four GraphQL searches into one deduplicated list of pull
# requests, each carrying the involvement flags that produced it. Search nodes
# for plain issues come back as `{}` because the fragment only matches
# PullRequest, so `select(.url != null)` drops them.

def fields(flags):
  {
    url:            .url,
    number:         .number,
    title:          (.title // ""),
    repo:           (.repository.nameWithOwner // ""),
    isPrivate:      (.repository.isPrivate // false),
    author:         (.author.login // "ghost"),
    isDraft:        (.isDraft // false),
    createdAt:      (.createdAt // ""),
    updatedAt:      (.updatedAt // ""),
    reviewDecision: (.reviewDecision // ""),
    mergeable:      (.mergeable // "UNKNOWN"),
    ci:             (.commits.nodes[0].commit.statusCheckRollup.state // ""),
    unresolved:     ([.reviewThreads.nodes[]? | select(.isResolved == false and .isOutdated == false)] | length),
    comments:       (.comments.totalCount // 0),
    additions:      (.additions // 0),
    deletions:      (.deletions // 0),
    headRefName:    (.headRefName // ""),
    baseRefName:    (.baseRefName // ""),
    reviewers:      ([.reviewRequests.nodes[]? | .requestedReviewer | select(. != null) | (.login // .slug // "")] | map(select(. != "")))
  } + flags;

def collect(bucket; flags):
  [.data[bucket].nodes[]? | select(.url != null) | fields(flags)];

def counted(bucket):
  (.data[bucket] // {}) | ((.issueCount // 0) > ((.nodes // []) | length));

{
  ok:        true,
  error:     $partial,
  needsAuth: false,
  login:     (.data.viewer.login // ""),
  fetchedAt: (now | floor),
  truncated: ([counted("involves"), counted("review"), counted("mentions"), counted("assigned")] | any),
  prs: (
    (   collect("involves"; {reviewRequested: false, mentioned: false, assigned: false})
      + collect("review";   {reviewRequested: true,  mentioned: false, assigned: false})
      + collect("mentions"; {reviewRequested: false, mentioned: true,  assigned: false})
      + collect("assigned"; {reviewRequested: false, mentioned: false, assigned: true})
    )
    | group_by(.url)
    | map(
        .[0] + {
          reviewRequested: (map(.reviewRequested) | any),
          mentioned:       (map(.mentioned)       | any),
          assigned:        (map(.assigned)        | any)
        }
      )
  )
}
