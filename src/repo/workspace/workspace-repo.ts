import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

export interface WorkspaceRepo {
  createRunWorkspace(baseDir: string): Promise<string>;
  ensureReusableWorkspace(baseDir: string, directoryName: string): Promise<string>;
  removeWorkspace(path: string): Promise<void>;
}

export const defaultWorkspaceRepo: WorkspaceRepo = {
  async createRunWorkspace(baseDir: string): Promise<string> {
    const root = resolveWorkspaceRoot(baseDir);
    await mkdir(root, { recursive: true });
    return mkdtemp(join(root, "run-"));
  },
  async ensureReusableWorkspace(baseDir: string, directoryName: string): Promise<string> {
    const root = resolveWorkspaceRoot(baseDir);
    const workspacePath = join(root, directoryName);
    await mkdir(workspacePath, { recursive: true });
    return workspacePath;
  },
  async removeWorkspace(path: string): Promise<void> {
    await rm(path, { recursive: true, force: true });
  }
};

function resolveWorkspaceRoot(baseDir: string): string {
  return baseDir.trim() === "" ? tmpdir() : baseDir;
}
