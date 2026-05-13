import fs from "node:fs";
import path from "node:path";
import { v4 as uuid } from "uuid";
import {
  DEFAULT_ASPECT_RATIO,
  DEFAULT_DURATION,
  DEFAULT_RESOLUTION,
  DEFAULT_SEED,
  DEFAULT_STYLE,
} from "./config.js";
import { ProjectState as PipelineState } from "./pipeline/state.js";
import type { StageName } from "./types.js";
import {
  type ProjectConfig,
  type ProjectState as ProjectStateJSON,
  STAGE_NAMES,
} from "./types.js";

const PROJECT_DIRS = [
  "characters",
  "scenes",
  "storyboard",
  "clips",
  "frames",
  "prompts",
  "output",
];

/**
 * Create a new project directory structure and save initial state.
 * Returns the project directory path.
 */
export function createProject(baseDir: string, config: ProjectConfig): string {
  const projectId = uuid();
  const projectDir = path.join(baseDir, "projects", projectId);

  // Create project directory and subdirectories
  fs.mkdirSync(projectDir, { recursive: true });
  for (const sub of PROJECT_DIRS) {
    fs.mkdirSync(path.join(projectDir, sub), { recursive: true });
  }

  // Create and save initial state
  const state = new PipelineState(projectId, config, projectDir);
  state.save();

  return projectDir;
}

/**
 * Load a project state from its directory.
 */
export function loadProject(projectDir: string): PipelineState {
  return PipelineState.load(projectDir);
}

/**
 * List all projects under the base directory.
 * Returns sorted by createdAt ascending.
 */
export function listProjects(
  baseDir: string,
): Array<{ id: string; dir: string; createdAt: string }> {
  const projectsDir = path.join(baseDir, "projects");

  if (!fs.existsSync(projectsDir)) {
    return [];
  }

  const entries = fs.readdirSync(projectsDir, { withFileTypes: true });
  const results: Array<{ id: string; dir: string; createdAt: string }> = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const projectDir = path.join(projectsDir, entry.name);
    const stateFile = path.join(projectDir, "state.json");

    if (!fs.existsSync(stateFile)) continue;

    try {
      const raw = fs.readFileSync(stateFile, "utf-8");
      const json: ProjectStateJSON = JSON.parse(raw);
      results.push({
        id: json.projectId,
        dir: projectDir,
        createdAt: json.createdAt,
      });
    } catch {
      // Skip malformed state files
    }
  }

  results.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return results;
}

/**
 * Find a project directory by project ID.
 * Returns null if not found.
 */
export function findProjectDir(
  baseDir: string,
  projectId: string,
): string | null {
  const projectDir = path.join(baseDir, "projects", projectId);
  if (fs.existsSync(path.join(projectDir, "state.json"))) {
    return projectDir;
  }
  return null;
}

/**
 * Remove intermediate directories under a project dir.
 */
export function cleanIntermediate(projectDir: string): void {
  const intermediates = ["clips", "frames", "prompts", "storyboard", "output"];
  for (const sub of intermediates) {
    const subPath = path.join(projectDir, sub);
    if (fs.existsSync(subPath)) {
      fs.rmSync(subPath, { recursive: true, force: true });
    }
    // Recreate the empty directory
    fs.mkdirSync(subPath, { recursive: true });
  }
}

export type { StageName };
/**
 * Get the list of stage names for external use.
 */
export { STAGE_NAMES };
