import { describe, expect, it } from "vitest";
import { formatReference, getBook } from "@/lib/bible";

describe("formatReference", () => {
  const book = getBook("acts")!;

  it("formats a single verse", () => {
    expect(formatReference({ book, chapter: 9, start: 4, end: 4 })).toBe("Acts 9:4");
  });

  it("formats a verse range", () => {
    expect(formatReference({ book, chapter: 13, start: 9, end: 12 })).toBe("Acts 13:9-12");
  });
});
