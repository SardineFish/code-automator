const INVALID_WORKSPACE_KEY_SEGMENT_PATTERN = /[<>:"/\\|?*\u0000-\u001f]/g;

export function escapeWorkspaceKeyForPath(workspaceKey: string): string {
  const escaped = workspaceKey.trim().replaceAll(INVALID_WORKSPACE_KEY_SEGMENT_PATTERN, "_");

  if (escaped === "" || escaped === "." || escaped === "..") {
    return "_";
  }

  return escaped;
}
