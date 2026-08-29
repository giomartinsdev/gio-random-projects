import Skeleton from "./Skeleton.js";

// Suspense fallback for lazily-loaded routes (the two live rooms).
// Deliberately generic -- no commitment to the loaded page's layout
// -- but wide enough to read as "a page is coming", not a spinner
// glitch.
export function PageSkeleton() {
  return (
    <div role="status" aria-label="Carregando" className="mx-auto w-full max-w-5xl px-4 sm:px-6 pt-14 pb-8 sm:pt-10 sm:pb-10 flex flex-col gap-4">
      <Skeleton className="h-10 w-2/3 rounded-xl" />
      <Skeleton className="h-72 w-full rounded-2xl" />
      <Skeleton className="h-40 w-full rounded-2xl" />
    </div>
  );
}

export default PageSkeleton;