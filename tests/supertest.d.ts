declare module 'supertest' {
  const request: (app: unknown) => {
    post(path: string): {
      send(body: unknown): {
        expect(status: number): Promise<unknown>;
      };
    };
  };
  export default request;
}
