// node:fs stand-in. The preview never touches the file system: the database is in memory and the web client is inlined.

export function mkdirSync(): void {}
export function existsSync(): boolean {
  return false;
}
export default { mkdirSync, existsSync };
