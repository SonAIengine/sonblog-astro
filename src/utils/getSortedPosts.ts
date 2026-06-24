import type { CollectionEntry } from "astro:content";
import { postFilter } from "./postFilter";
import { getPostSortDatetime } from "./postDatetime";

/**
 * Returns posts that are eligible to be shown to users, sorted by “last updated”
 * descending (uses `modDatetime` when present, otherwise `pubDatetime`).
 *
 * Note: filtering respects drafts and scheduled posts via `postFilter()`.
 */
export function getSortedPosts(posts: CollectionEntry<"posts">[]) {
  return posts
    .filter(postFilter)
    .sort(
      (a, b) =>
        Math.floor(getPostSortDatetime(b).getTime() / 1000) -
        Math.floor(getPostSortDatetime(a).getTime() / 1000)
    );
}
