declare module 'supertest' {
  interface TestResponse {
    body: unknown;
    headers: Record<string, string | string[] | undefined>;
  }

  interface TestRequest {
    set(header: string, value: string): TestRequest;
    send(body: unknown): TestRequest;
    type(value: string): TestRequest;
    expect(status: number): Promise<TestResponse>;
  }

  const request: (app: unknown) => {
    get(path: string): TestRequest;
    post(path: string): TestRequest;
  };
  export default request;
}
