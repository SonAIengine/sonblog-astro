import type { CollectionEntry } from "astro:content";
import { postFilter } from "./postFilter";
import { slugifyStr } from "./slugify";

type Tag = {
  tag: string;
  tagName: string;
  count: number;
};

type Options = {
  minCount?: number;
};

export const PUBLIC_TAG_MIN_COUNT = 4;

/**
 * Builds a de-duplicated, sorted tag list from posts.
 *
 * - Drafts and scheduled posts are excluded via `postFilter()`
 * - `tag` is the slug used in URLs; `tagName` is the original label for display
 * - Uniqueness is based on the slug (so differently-cased labels collapse)
 */
export function getUniqueTags(
  posts: CollectionEntry<"posts">[],
  { minCount = 1 }: Options = {}
) {
  const tagsBySlug = new Map<string, Tag>();

  posts
    .filter(postFilter)
    .flatMap(post => post.data.tags)
    .forEach(tagName => {
      const tag = slugifyStr(tagName);
      const current = tagsBySlug.get(tag);
      if (current) {
        current.count += 1;
      } else {
        tagsBySlug.set(tag, { tag, tagName, count: 1 });
      }
    });

  const tags: Tag[] = [...tagsBySlug.values()]
    .filter(tag => tag.count >= minCount)
    .sort(
      (tagA, tagB) =>
        tagB.count - tagA.count || tagA.tag.localeCompare(tagB.tag)
    );

  return tags;
}
