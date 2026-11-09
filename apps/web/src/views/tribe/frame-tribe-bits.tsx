// Small pieces shared by the seven desktop Tribe sub-tab pages: the paging buttons and a page counter.

import { useState } from 'react';
import { pageSlice, paging } from '../reports/frame-reports-logic.ts';
import { Chev } from '../village/FrameParts.tsx';

/** Previous / next buttons (38 px, as on the Members table). */
export function PageButtons({ page, pages, onPage, label }: { page: number; pages: number; onPage: (p: number) => void; label: string }) {
  return (
    <span className="frt-pb">
      <button type="button" className="fv-pg" aria-label={`Previous ${label}`} disabled={page <= 0} onClick={() => onPage(page - 1)}>
        <Chev flip size={16} />
      </button>
      <button type="button" className="fv-pg" aria-label={`More ${label}`} disabled={page >= pages - 1} onClick={() => onPage(page + 1)}>
        <Chev size={16} />
      </button>
    </span>
  );
}

/** A list cut into pages that fit the frame. `slice` is the rows to show; the page snaps back when the list shrinks. */
export function usePaged<T>(list: T[], perPage: number) {
  const [page, setPage] = useState(0);
  const pg = paging(list.length, page, perPage);
  return { pg, slice: pageSlice(list, pg.page, perPage), setPage, paged: pg.pages > 1 };
}
