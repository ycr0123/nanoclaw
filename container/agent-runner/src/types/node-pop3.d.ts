declare module 'node-pop3' {
  interface Pop3Options {
    host: string;
    port: number;
    tls?: boolean;
    user: string;
    password: string;
  }

  class Pop3Client {
    constructor(options: Pop3Options);
    UIDL(msgNumber?: number): Promise<string | string[][]>;
    LIST(msgNumber?: number): Promise<string | string[][]>;
    TOP(msgNumber: number, lines: number): Promise<string>;
    RETR(msgNumber: number): Promise<string>;
    QUIT(): Promise<string>;
  }

  export default Pop3Client;
}
