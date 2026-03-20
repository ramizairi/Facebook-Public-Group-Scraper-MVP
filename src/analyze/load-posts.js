import fs from "node:fs/promises";

function normalizeLoadedPost(post) {
  return {
    url: post?.url ?? null,
    groupUrl: post?.groupUrl ?? post?.group_url ?? null,
    authorName: post?.authorName ?? post?.author_name ?? null,
    createdAt: post?.createdAt ?? post?.created_at ?? null,
    text: post?.text ?? null,
    reactionCount: post?.reactionCount ?? post?.reaction_count ?? null,
    commentCount: post?.commentCount ?? post?.comment_count ?? null,
    shareCount: post?.shareCount ?? post?.share_count ?? null,
    rawFragment: post?.rawFragment ?? null,
  };
}

export async function loadAnalysisPosts(config) {
  const raw = await fs.readFile(config.inputPostsFile, "utf8");
  const posts = JSON.parse(raw);
  if (!Array.isArray(posts)) {
    throw new Error(`Expected an array of posts in ${config.inputPostsFile}`);
  }

  const limitedPosts = config.maxPostsToAnalyze ? posts.slice(0, config.maxPostsToAnalyze) : posts;
  return limitedPosts.map(normalizeLoadedPost);
}
