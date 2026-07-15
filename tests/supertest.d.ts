declare module 'supertest' {
  interface TestResponse {
    body: unknown;
    headers: Record<string, string | string[] | undefined>;
    text: string;
  }

  interface TestRequest {
    set(header: string, value: string): TestRequest;
    send(body: unknown): TestRequest;
    type(value: string): TestRequest;
    parse(
      parser: (response: NodeJS.ReadableStream, callback: (error: Error | null, body?: unknown) => void) => void
    ): TestRequest;
    query(params: Record<string, string | number | boolean>): TestRequest;
    expect(status: number): Promise<TestResponse>;
  }

  const request: (app: unknown) => {
    delete(path: string): TestRequest;
    get(path: string): TestRequest;
    patch(path: string): TestRequest;
    post(path: string): TestRequest;
  };
  export default request;
}
