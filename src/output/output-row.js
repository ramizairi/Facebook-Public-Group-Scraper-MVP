export function toOutputRow(post) {
  return {
    url: post?.url ?? null,
    group_url: post?.groupUrl ?? null,
    author_name: post?.authorName ?? null,
    created_at: post?.createdAt ?? null,
    text: post?.text ?? null,
    reaction_count: post?.reactionCount ?? null,
    comment_count: post?.commentCount ?? null,
    share_count: post?.shareCount ?? null,
  };
}

export function toOutputRows(posts) {
  return (Array.isArray(posts) ? posts : []).map(toOutputRow);
}
