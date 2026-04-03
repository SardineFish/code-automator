import type { Server, ServerResponse } from "node:http";

export interface RequestDrainController {
  tryStartRequest(response: ServerResponse): boolean;
  stopAcceptingRequests(): Promise<void>;
  waitForIdleRequests(): Promise<void>;
}

export function createRequestDrainController(server: Server): RequestDrainController {
  let acceptingRequests = true;
  let activeRequestCount = 0;
  let stopPromise: Promise<void> | undefined;
  let idleWaiters: Array<() => void> = [];

  return {
    tryStartRequest(response) {
      if (!acceptingRequests) {
        return false;
      }

      activeRequestCount += 1;
      response.once("close", () => {
        activeRequestCount -= 1;

        if (activeRequestCount === 0) {
          resolveIdleWaiters();
        }
      });

      return true;
    },
    stopAcceptingRequests() {
      if (stopPromise) {
        return stopPromise;
      }

      acceptingRequests = false;
      stopPromise = Promise.resolve().then(() => {
        server.close();
        server.closeIdleConnections?.();
      });
      return stopPromise;
    },
    waitForIdleRequests() {
      if (activeRequestCount === 0) {
        return Promise.resolve();
      }

      return new Promise((resolve) => {
        idleWaiters.push(resolve);
      });
    }
  };

  function resolveIdleWaiters(): void {
    const waiters = idleWaiters;
    idleWaiters = [];

    for (const resolve of waiters) {
      resolve();
    }
  }
}
