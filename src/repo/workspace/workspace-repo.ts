import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

export interface WorkspaceRepo {
  createRunWorkspace(baseDir: string): Promise<string>;
  removeWorkspace(path: string): Promise<void>;
}

export const defaultWorkspaceRepo: WorkspaceRepo = {
  async createRunWorkspace(baseDir: string): Promise<string> {
    const root = baseDir.trim() === "" ? tmpdir() : baseDir;
    await mkdir(root, { recursive: true });
    return mkdtemp(join(root, "run-"));
  },
  async removeWorkspace(path: string): Promise<void> {
    await rm(path, { recursive: true, force: true });
  }
};
