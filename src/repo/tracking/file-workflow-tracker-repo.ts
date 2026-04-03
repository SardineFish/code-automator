import { mkdir, readFile, rename, writeFile, appendFile } from "node:fs/promises";
import path from "node:path";

import type { TrackingConfig } from "../../types/config.js";
import type { WorkflowRunArtifacts, WorkflowTrackerState } from "../../types/tracking.js";

const EMPTY_STATE: WorkflowTrackerState = {
  version: 2,
  activeRuns: {},
  keyedWorkspaces: {}
};

export interface WorkflowTrackerRepo {
  ensureFiles(config: TrackingConfig): Promise<void>;
  loadState(config: TrackingConfig): Promise<WorkflowTrackerState>;
  saveState(config: TrackingConfig, state: WorkflowTrackerState): Promise<void>;
  appendLog(config: TrackingConfig, entry: Record<string, unknown>): Promise<void>;
  createArtifacts(config: TrackingConfig, runId: string): Promise<WorkflowRunArtifacts>;
}

export const fileWorkflowTrackerRepo: WorkflowTrackerRepo = {
  async ensureFiles(config) {
    await mkdir(path.dirname(config.stateFile), { recursive: true });
    await mkdir(path.dirname(config.logFile), { recursive: true });

    try {
      await readFile(config.stateFile, "utf8");
    } catch (error) {
      if (!isErrnoException(error, "ENOENT")) {
        throw error;
      }

      await writeFile(config.stateFile, JSON.stringify(EMPTY_STATE, null, 2));
    }
  },
  async loadState(config) {
    try {
      const contents = await readFile(config.stateFile, "utf8");
      return normalizeTrackerState(JSON.parse(contents) as Partial<WorkflowTrackerState>);
    } catch (error) {
      if (isErrnoException(error, "ENOENT")) {
        return {
          ...EMPTY_STATE,
          activeRuns: {},
          keyedWorkspaces: {}
        };
      }

      throw error;
    }
  },
  async saveState(config, state) {
    const tempFile = `${config.stateFile}.tmp`;
    await writeFile(tempFile, JSON.stringify(state, null, 2));
    await rename(tempFile, config.stateFile);
  },
  async appendLog(config, entry) {
    await appendFile(config.logFile, `${JSON.stringify(entry)}\n`);
  },
  async createArtifacts(config, runId) {
    const runDir = path.join(getArtifactsDir(config.stateFile), runId);
    await mkdir(runDir, { recursive: true });

    return {
      runDir,
      wrapperScriptPath: path.join(runDir, "run.sh"),
      pidFilePath: path.join(runDir, "wrapper.pid"),
      resultFilePath: path.join(runDir, "result.json"),
      stdoutPath: path.join(runDir, "stdout.log"),
      stderrPath: path.join(runDir, "stderr.log")
    };
  }
};

function getArtifactsDir(stateFile: string): string {
  const parsed = path.parse(stateFile);
  return path.join(parsed.dir, `${parsed.name}.runs`);
}

function normalizeTrackerState(
  state: Partial<WorkflowTrackerState> | { version?: number; activeRuns?: WorkflowTrackerState["activeRuns"] }
): WorkflowTrackerState {
  if (state.version === 2) {
    return {
      version: 2,
      activeRuns: state.activeRuns ?? {},
      keyedWorkspaces: "keyedWorkspaces" in state ? state.keyedWorkspaces ?? {} : {}
    };
  }

  return {
    version: 2,
    activeRuns: state.activeRuns ?? {},
    keyedWorkspaces: {}
  };
}

function isErrnoException(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === code;
}
