import { Icon } from '../art/Icon.tsx';

/**
 * The Clanfire flame icon. While `loading` it flickers and breathes with a warm glow (CSS `flame-flicker`, see
 * styles.css); it settles when loading ends. prefers-reduced-motion: no movement.
 */
export function Flame({ size, loading = false }: { size: number; loading?: boolean }) {
  return (
    <span className={`flame${loading ? ' is-loading' : ''}`}>
      <Icon name="flame" size={size} />
    </span>
  );
}
