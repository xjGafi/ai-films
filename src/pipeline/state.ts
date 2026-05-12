import fs from "fs";
import path from "path";
import type { StageName } from "../types.js";
import {
  type ProjectConfig,
  type ProjectState as ProjectStateJSON,
  STAGE_NAMES,
  type StageState,
} from "../types.js";

function makeInitialStage(): StageState {
  return {
    status: "pending",
    attempts: 0,
    artifacts: {},
  };
}

export class ProjectState {
  projectId: string;
  config: ProjectConfig;
  createdAt: string;
  stages: Record<StageName, StageState>;
  projectDir?: string;

  constructor(projectId: string, config: ProjectConfig, projectDir?: string) {
    this.projectId = projectId;
    this.config = config;
    this.createdAt = new Date().toISOString();
    this.stages = {} as Record<StageName, StageState>;
    this.projectDir = projectDir;
    for (const name of STAGE_NAMES) {
      this.stages[name] = makeInitialStage();
    }
  }

  // ── Persistence ──

  static load(dir: string): ProjectState {
    const raw = fs.readFileSync(path.join(dir, "state.json"), "utf-8");
    const json: ProjectStateJSON = JSON.parse(raw);
    const state = Object.create(ProjectState.prototype) as ProjectState;
    state.projectId = json.projectId;
    state.config = json.config;
    state.createdAt = json.createdAt;
    state.stages = json.stages;
    state.projectDir = dir;
    return state;
  }

  save(): void {
    const dir = this.resolveProjectDir();
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "state.json"),
      JSON.stringify(this.toJSON(), null, 2),
      "utf-8",
    );
  }

  // ── Queries ──

  isCompleted(stage: StageName): boolean {
    return this.stages[stage].status === "completed";
  }

  getResumeStage(): StageName | null {
    for (const name of STAGE_NAMES) {
      if (this.stages[name].status !== "completed") {
        return name;
      }
    }
    return null;
  }

  // ── Mutations ──

  markInProgress(stage: StageName): void {
    this.stages[stage].status = "in_progress";
    this.stages[stage].startedAt = new Date().toISOString();
  }

  markCompleted(stage: StageName, artifacts: Record<string, string>): void {
    this.stages[stage].status = "completed";
    this.stages[stage].completedAt = new Date().toISOString();
    Object.assign(this.stages[stage].artifacts, artifacts);
  }

  recordError(stage: StageName, error: string): void {
    this.stages[stage].status = "failed";
    this.stages[stage].attempts += 1;
    this.stages[stage].error = error;
  }

  /** Reset a stage and all subsequent stages back to "pending". */
  resetFrom(stage: StageName): void {
    let resetting = false;
    for (const name of STAGE_NAMES) {
      if (name === stage) resetting = true;
      if (resetting) {
        this.stages[name] = makeInitialStage();
      }
    }
  }

  // ── Serialization ──

  toJSON(): ProjectStateJSON {
    return {
      projectId: this.projectId,
      createdAt: this.createdAt,
      config: this.config,
      stages: { ...this.stages },
    };
  }

  // ── Private helpers ──

  private resolveProjectDir(): string {
    if (this.projectDir) return this.projectDir;
    return path.join(process.cwd(), "projects", this.projectId);
  }
}
