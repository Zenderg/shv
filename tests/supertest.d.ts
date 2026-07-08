declare module 'supertest' {
  const request: (app: unknown) => {
    get(path: string): {
      expect(status: number): Promise<{ body: unknown }>;
    };
    post(path: string): {
      send(body: unknown): {
        expect(status: number): Promise<{ body: unknown }>;
      };
    };
  };
  export default request;
}
