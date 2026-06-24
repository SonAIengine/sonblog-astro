import type { CollectionEntry } from "astro:content";
import config from "@/config";
import postTimes from "@/generated/post-times.json";

type MaybeDate = Date | string | null | undefined;

type GeneratedPostTimes = {
  posts: Record<
    string,
    {
      datetime: string;
      source: string;
      frontmatterDate: string;
      firstAddedAt: string;
    }
  >;
};

const generatedPostTimes = (postTimes as GeneratedPostTimes).posts;

export function toDate(value: MaybeDate): Date | undefined {
  if (!value) return undefined;
  return value instanceof Date ? value : new Date(value);
}

export function getGeneratedPostDatetime(
  postId?: string | null
): Date | undefined {
  const datetime = postId
    ? (generatedPostTimes[postId]?.datetime ??
      generatedPostTimes[postId.toLowerCase()]?.datetime)
    : undefined;
  return datetime ? new Date(datetime) : undefined;
}

export function hasGeneratedPostDatetime(postId?: string | null): boolean {
  return Boolean(
    postId &&
    (generatedPostTimes[postId] ?? generatedPostTimes[postId.toLowerCase()])
  );
}

export function getPostPublishedDatetime(post: CollectionEntry<"posts">): Date {
  return getGeneratedPostDatetime(post.id) ?? post.data.pubDatetime;
}

export function getPostSortDatetime(post: CollectionEntry<"posts">): Date {
  return toDate(post.data.modDatetime) ?? getPostPublishedDatetime(post);
}

export function getDatePartsInSiteTimeZone(date: Date): {
  year: number;
  month: number;
  day: number;
} {
  const fallback = {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  };
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: config.site.timezone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).formatToParts(date);

  const lookup: Record<string, number> = Object.fromEntries(
    parts
      .filter(part => ["year", "month", "day"].includes(part.type))
      .map(part => [part.type, Number(part.value)])
  );

  return {
    year: lookup.year ?? fallback.year,
    month: lookup.month ?? fallback.month,
    day: lookup.day ?? fallback.day,
  };
}

export function formatDateInSiteTimeZone(date: Date): string {
  const { year, month, day } = getDatePartsInSiteTimeZone(date);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(
    2,
    "0"
  )}`;
}
