// While a big, hidden piece of work is being built as a React transition (the Village scene behind a building page), the one-second
// clock tick must not interrupt it: an urgent update restarts a transition render from the top, and a build that takes longer than a
// second would then never finish (it only finishes when React's own expiry forces it, seconds later). So during that time the tick
// itself is a transition too: updates of the same lane do not restart each other.

let held = 0;

/** Make the clock tick a transition until the returned function is called (call it once). */
export function deferTicks(): () => void {
  held += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    held -= 1;
  };
}

export const ticksDeferred = (): boolean => held > 0;
