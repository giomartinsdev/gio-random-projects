import type { ReactNode } from "react";
import PageShell from "../ui/PageShell.js";

// Full-bleed room layout: header row, stage column, aside column. On
// desktop both columns pin to the viewport height and scroll
// internally -- the page itself never scrolls, terminals-style. On
// mobile the aside flows under the stage and the page scrolls
// naturally instead. min-h-0 on every level is what lets the inner
// overflow actually engage inside a fixed-height grid row.
export default function RoomShell({ header, children, aside }: { header: ReactNode; children: ReactNode; aside: ReactNode }) {
  return (
    // calc(100dvh-5rem): PageShell's pt-10 + pb-10 on sm+ -- the room
    // then fills exactly the remaining viewport with zero page scroll.
    <PageShell width="full">
      <div className="flex flex-col gap-4 lg:grid lg:grid-cols-[minmax(0,1fr)_22rem] lg:gap-5 lg:h-[calc(100dvh-5rem)]">
        <div className="flex flex-col min-w-0 min-h-0 gap-3">
          {header}
          <div className="flex flex-col flex-1 min-h-0">{children}</div>
        </div>
        <aside className="flex flex-col min-w-0 min-h-0">{aside}</aside>
      </div>
    </PageShell>
  );
}