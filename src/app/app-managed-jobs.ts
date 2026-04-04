import type { LogSink } from "../types/logging.js";
import type { AppJobIntervalOptions, AppJobScheduleMode } from "../types/runtime.js";

interface ActiveJob {
  debugName: string;
  promise: Promise<unknown>;
}

export interface AppManagedJobs {
  trackJob<TResult>(debugName: string, job: Promise<TResult>): Promise<TResult>;
  scheduleInterval(
    debugName: string,
    intervalMs: number,
    createJob: () => Promise<unknown>,
    options?: AppJobIntervalOptions
  ): () => void;
  scheduleDelay(debugName: string, delayMs: number, createJob: () => Promise<unknown>): () => void;
  stopSchedulers(): void;
  waitForTrackedJobsDuringShutdown(): Promise<void>;
}

export function createAppManagedJobs(log: LogSink): AppManagedJobs {
  const activeJobs = new Set<ActiveJob>();
  const schedulerStops = new Set<() => void>();
  let shutdownWaiting = false;

  return { trackJob, scheduleInterval, scheduleDelay, stopSchedulers, waitForTrackedJobsDuringShutdown };

  function trackJob<TResult>(debugName: string, job: Promise<TResult>): Promise<TResult> {
    assertDebugName(debugName);
    const record: ActiveJob = { debugName, promise: job as Promise<unknown> };
    activeJobs.add(record);
    void job.then(
      () => settle(record, "resolved"),
      () => settle(record, "rejected")
    );
    return job;
  }

  function scheduleInterval(
    debugName: string,
    intervalMs: number,
    createJob: () => Promise<unknown>,
    options: AppJobIntervalOptions = {}
  ): () => void {
    assertDebugName(debugName);
    assertDelay("Interval", intervalMs);
    const mode = resolveMode(options.mode);
    let running = false;
    let stopped = false;
    let timer: NodeJS.Timeout | undefined;
    const stop = registerStop(() => {
      stopped = true;
      if (timer) {
        clearTimeout(timer);
        timer = undefined;
      }
    });

    const finishRun = () => {
      running = false;
      if (mode === "delay") {
        scheduleNext();
      }
    };
    const startJob = () => {
      if (stopped) {
        return;
      }
      if (mode !== "overlap" && running) {
        return;
      }
      if (mode !== "overlap") {
        running = true;
      }
      const job = runScheduledJob(debugName, createJob);
      if (mode !== "overlap") {
        void job.then(finishRun, finishRun);
      }
    };
    const handleTick = () => {
      timer = undefined;
      if (stopped) {
        return;
      }
      if (mode === "skip" && running) {
        scheduleNext();
        return;
      }
      startJob();
      if (mode !== "delay") {
        scheduleNext();
      }
    };
    const scheduleNext = () => {
      if (stopped) {
        return;
      }
      timer = setTimeout(handleTick, intervalMs);
      timer.unref();
    };

    if (mode === "delay") {
      if (options.runImmediately) {
        startJob();
      } else {
        scheduleNext();
      }
      return stop;
    }

    if (options.runImmediately) {
      startJob();
    }
    scheduleNext();
    return stop;
  }

  function scheduleDelay(
    debugName: string,
    delayMs: number,
    createJob: () => Promise<unknown>
  ): () => void {
    assertDebugName(debugName);
    assertDelay("Delay", delayMs);
    let stopped = false;
    let timer: NodeJS.Timeout | undefined = setTimeout(() => {
      timer = undefined;
      if (stopped) {
        return;
      }
      schedulerStops.delete(stop);
      runScheduledJob(debugName, createJob);
    }, delayMs);
    timer.unref();
    const stop = registerStop(() => {
      stopped = true;
      if (timer) {
        clearTimeout(timer);
        timer = undefined;
      }
    });
    return stop;
  }

  function stopSchedulers(): void {
    for (const stop of [...schedulerStops]) {
      stop();
    }
  }

  async function waitForTrackedJobsDuringShutdown(): Promise<void> {
    if (activeJobs.size === 0) {
      return;
    }
    shutdownWaiting = true;
    logWaitingJobs(activeJobs, log);
    while (activeJobs.size > 0) {
      await Promise.allSettled([...activeJobs].map((job) => job.promise));
    }
    shutdownWaiting = false;
  }

  function settle(record: ActiveJob, status: "resolved" | "rejected"): void {
    activeJobs.delete(record);
    if (shutdownWaiting) {
      log.info({ message: "tracked app job settled during shutdown", debugName: record.debugName, status });
    }
  }

  function runScheduledJob(debugName: string, createJob: () => Promise<unknown>): Promise<unknown> {
    const job = trackJob(debugName, Promise.resolve().then(createJob));
    void job.then(undefined, (error) => {
      log.warn({
        message: "scheduled app job failed",
        debugName,
        errorMessage: error instanceof Error ? error.message : "Unknown scheduled job error."
      });
    });
    return job;
  }

  function registerStop(stopImpl: () => void): () => void {
    let stopped = false;
    const stop = () => {
      if (stopped) {
        return;
      }
      stopped = true;
      schedulerStops.delete(stop);
      stopImpl();
    };
    schedulerStops.add(stop);
    return stop;
  }
}

function assertDebugName(debugName: string): void {
  if (debugName.trim() === "") {
    throw new Error("App job debugName must be a non-empty string.");
  }
}

function assertDelay(label: "Delay" | "Interval", ms: number): void {
  if (!Number.isFinite(ms) || ms <= 0) {
    throw new Error(`${label} milliseconds must be greater than 0.`);
  }
}

function resolveMode(mode: AppJobScheduleMode | undefined): AppJobScheduleMode {
  if (!mode) {
    return "skip";
  }
  if (mode === "skip" || mode === "delay" || mode === "overlap") {
    return mode;
  }
  throw new Error(`Unsupported app job schedule mode '${String(mode)}'.`);
}

function logWaitingJobs(activeJobs: Set<ActiveJob>, log: LogSink): void {
  const counts = new Map<string, number>();
  for (const job of activeJobs) {
    counts.set(job.debugName, (counts.get(job.debugName) ?? 0) + 1);
  }
  for (const [debugName, count] of [...counts.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    log.info({ message: "waiting for tracked app job during shutdown", debugName, count });
  }
}
