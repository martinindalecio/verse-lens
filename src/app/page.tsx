import Link from "next/link";
import { BOOKS, type Testament } from "@/lib/bible";

const SECTIONS: { testament: Testament; title: string }[] = [
  { testament: "OT", title: "Old Testament" },
  { testament: "NT", title: "New Testament" },
];

export default function Home() {
  return (
    <div className="space-y-10">
      <section className="max-w-2xl space-y-2">
        <h1 className="text-3xl font-bold">Read with the world around the text</h1>
        <p className="text-muted">
          Pick a chapter, tap a verse (or two, for a range), and get who is speaking, where and when it
          happens, the history and culture behind it, key original-language words, and how different traditions
          read it, kept apart from the facts.
        </p>
      </section>

      {SECTIONS.map(({ testament, title }) => (
        <section key={testament} className="space-y-3">
          <h2 className="text-xl font-bold">{title}</h2>
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
            {BOOKS.filter((b) => b.testament === testament).map((book) => (
              <li key={book.slug}>
                <Link
                  href={`/read/${book.slug}/1`}
                  className="block flex min-h-12 items-center rounded-xl border border-line bg-card px-4 text-base hover:border-accent"
                >
                  {book.name}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
