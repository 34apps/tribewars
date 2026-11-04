// `ws` ships without types here (@types/ws is not installed); the live tests only use a small part of it.
declare module 'ws' {
  export default class WebSocket {
    constructor(url: string, options?: object);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    on(event: string, listener: (...args: any[]) => void): this;
    send(data: string | Buffer): void;
    close(code?: number): void;
    terminate(): void;
  }
}
