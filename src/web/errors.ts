export class ApiFailure extends Error {
  constructor(message: string, readonly status: number, readonly details?: unknown) {
    super(message);
  }
}
