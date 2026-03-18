export class DedupStore {
  constructor(posts = []) {
    this.keys = new Set();
    for (const post of posts) {
      this.add(post);
    }
  }

  stableKeys(post) {
    const keys = [];
    if (post.id) {
      keys.push(`id:${post.id}`);
    }

    if (post.url) {
      keys.push(`url:${post.url}`);
    }

    if (post.groupUrl && post.text) {
      keys.push(`group-text:${post.groupUrl}:${post.text.slice(0, 80).toLowerCase()}`);
    }

    return keys;
  }

  has(post) {
    return this.stableKeys(post).some((key) => this.keys.has(key));
  }

  add(post) {
    const keys = this.stableKeys(post);
    for (const key of keys) {
      this.keys.add(key);
    }
  }

  size() {
    return this.keys.size;
  }
}
