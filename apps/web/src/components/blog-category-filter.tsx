import { cn } from "@workspace/tailwind-config/utils";
import Link from "next/link";

import { BLOG_CATEGORIES } from "@/lib/blog-categories";

export function BlogCategoryFilter({
  activeCategory,
  className,
  q,
}: Readonly<{ activeCategory: string; className?: string; q?: string }>) {
  return (
    <nav
      aria-label="Filter posts by category"
      className={cn("grid gap-2", className)}
    >
      {BLOG_CATEGORIES.map(({ label, value }) => {
        const isActive = activeCategory === value;
        // Plain links: filtering works with JavaScript off, inside a search too.
        const params = new URLSearchParams();
        if (q) {
          params.set("q", q);
        }
        if (value) {
          params.set("category", value);
        }
        const query = params.toString();
        const href = query ? `/blog?${query}` : "/blog";

        return (
          <Link
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "focus-ring inline-flex w-max items-center rounded-none px-1 py-px font-mono text-sm uppercase tracking-wide transition-colors",
              isActive
                ? "bg-accent-green text-accent-green-foreground"
                : "text-muted-foreground hover:text-foreground"
            )}
            href={href}
            key={value || "all"}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
