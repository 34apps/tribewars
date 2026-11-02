// node:path stand-in (only reached for file-backed databases, which the preview never opens).

export function resolve(...parts: string[]): string {
  return parts.join('/');
}
export function dirname(p: string): string {
  const i = p.lastIndexOf('/');
  return i > 0 ? p.slice(0, i) : '.';
}
export default { resolve, dirname };
