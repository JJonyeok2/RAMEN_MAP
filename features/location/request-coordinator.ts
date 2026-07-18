export interface CoordinatedRequest {
  token: number;
  signal: AbortSignal;
}

export class RequestCoordinator {
  private token = 0;
  private controller: AbortController | null = null;
  private mounted = true;

  begin(): CoordinatedRequest {
    this.controller?.abort();
    this.token += 1;
    this.controller = new AbortController();
    return { token: this.token, signal: this.controller.signal };
  }

  isCurrent(token: number): boolean {
    return this.mounted && token === this.token && this.controller?.signal.aborted === false;
  }

  dispose(): void {
    this.mounted = false;
    this.token += 1;
    this.controller?.abort();
    this.controller = null;
  }
}
