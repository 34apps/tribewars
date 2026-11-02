// node:util stand-in: only promisify (callback-last functions).

export function promisify<A extends unknown[], R>(
  fn: (...args: [...A, (err: Error | null, value?: R) => void]) => void,
): (...args: A) => Promise<R> {
  return (...args: A) =>
    new Promise<R>((resolve, reject) => {
      fn(...args, (err, value) => (err ? reject(err) : resolve(value as R)));
    });
}
