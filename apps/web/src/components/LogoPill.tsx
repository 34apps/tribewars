import { Flame } from './Flame.tsx';

/** The phone lobby's logo: flame and name in a chunky cream pill over the village picture. */
export function LogoPill({ loading = false }: { loading?: boolean }) {
  return (
    <span className="lp-pill">
      <Flame size={32} loading={loading} />
      Clanfire
    </span>
  );
}
