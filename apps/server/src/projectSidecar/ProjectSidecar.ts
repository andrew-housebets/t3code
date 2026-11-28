import * as Arr from "effect/Array";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Migrator from "effect/sql/Migrator";
import * as SqlClient from "effect/sql/SqlClient";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import { ModelSelection, type ProjectModelDefaults } from "@t3tools/contracts";

import * as ServerConfig from "../config.ts";

/** Directly in the state dir, so the `*.sqlite` rule keeps it out of client file reads. */
export const PROJECT_SIDECAR_FILE_NAME = "projects-sidecar.sqlite";

export const ProjectArtifactSource = Schema.Literals(["library", "html_render", "upload"]);
export type ProjectArtifactSource = typeof ProjectArtifactSource.Type;

export class ProjectSidecarError extends Schema.TaggedError<ProjectSidecarError>()(
  "ProjectSidecarError",
  { operation: Schema.String, cause: Schema.Defect() },
) {
  override get message(): string {
    return `The projects sidecar database failed to ${this.operation}.`;
  }
}

export interface ProjectArtifactInput {
  readonly projectId: string;
  /** Null for a user's upload. */
  readonly threadId: string | null;
  readonly source: ProjectArtifactSource;
  /** Library-relative for files, the attachment id for an HTML render. */
  readonly path: string;
  readonly title: string;
  readonly sizeBytes: number | null;
}

export interface ProjectArtifactRow extends ProjectArtifactInput {
  readonly id: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ProjectLibraryFile {
  readonly path: string;
  readonly sizeBytes: number | null;
}

const NO_MODEL_DEFAULTS: ProjectModelDefaults = {
  coordinatorModelSelection: null,
};

const ModelSelectionJson = Schema.fromJsonString(ModelSelection);
const decodeModelSelection = Schema.decodeUnknownOption(ModelSelectionJson);
const encodeModelSelection = Schema.encodeEffect(ModelSelectionJson);

const projectArtifactId = (source: ProjectArtifactSource, path: string) =>
  `${source === "html_render" ? "render" : "file"}:${path}`;

/**
 * Index rows beside the main database, with no shared transaction: rows may briefly lag it, and
 * every reader treats a missing row as "nothing known".
 */
export class ProjectSidecar extends Context.Reference<{
  /** Certain attribution (a finished turn, an upload): replaces the owner of an existing row. */
  readonly recordArtifacts: (
    artifacts: ReadonlyArray<ProjectArtifactInput>,
  ) => Effect.Effect<void, ProjectSidecarError>;
  readonly listArtifacts: (
    projectId: string,
  ) => Effect.Effect<ReadonlyArray<ProjectArtifactRow>, ProjectSidecarError>;
  /**
   * Adds files nothing attributed yet, with no owner, and never changes an owner. With `complete`,
   * also drops file rows whose file is gone; a truncated listing cannot tell.
   */
  readonly syncLibraryFiles: (
    projectId: string,
    files: ReadonlyArray<ProjectLibraryFile>,
    options: { readonly complete: boolean },
  ) => Effect.Effect<void, ProjectSidecarError>;
  readonly removeArtifacts: (
    projectId: string,
    ids: ReadonlyArray<string>,
  ) => Effect.Effect<void, ProjectSidecarError>;
  /** A stored selection that no longer decodes reads as null. */
  readonly getModelDefaults: (
    projectId: string,
  ) => Effect.Effect<ProjectModelDefaults, ProjectSidecarError>;
  readonly setModelDefaults: (
    projectId: string,
    defaults: ProjectModelDefaults,
  ) => Effect.Effect<ProjectModelDefaults, ProjectSidecarError>;
  /** Drops rows of projects or threads that no longer exist, unless written at or after `before`. */
  readonly prune: (live: {
    readonly projectIds: ReadonlyArray<string>;
    readonly threadIds: ReadonlyArray<string>;
    readonly before: string;
  }) => Effect.Effect<number, ProjectSidecarError>;
}>("t3/projectSidecar/ProjectSidecar", {
  defaultValue: () => ({
    recordArtifacts: () => Effect.void,
    listArtifacts: () => Effect.succeed([]),
    syncLibraryFiles: () => Effect.void,
    removeArtifacts: () => Effect.void,
    getModelDefaults: () => Effect.succeed(NO_MODEL_DEFAULTS),
    setModelDefaults: () =>
      Effect.fail(
        new ProjectSidecarError({ operation: "save model defaults", cause: "unavailable" }),
      ),
    prune: () => Effect.succeed(0),
  }),
}) {}

/** Ids only, from the main database: a full shell snapshot takes seconds on large homes. */
export const readLiveIds = (mainSql: SqlClient.SqlClient) =>
  Effect.all({
    projects: mainSql<{ readonly id: string }>`
      SELECT project_id AS id FROM projection_projects WHERE deleted_at IS NULL
    `.pipe(NodeSqliteClient.readOnly),
    threads: mainSql<{ readonly id: string }>`
      SELECT thread_id AS id FROM orchestration_v2_projection_threads WHERE deleted_at IS NULL
    `.pipe(NodeSqliteClient.readOnly),
  });

/** Reads the live ids after taking the cutoff, so rows written meanwhile survive. */
export const pruneAgainst = Effect.fn("ProjectSidecar.pruneAgainst")(function* <E, R>(
  sidecar: Context.Service.Shape<typeof ProjectSidecar>,
  readLive: Effect.Effect<
    {
      readonly projects: ReadonlyArray<{ readonly id: string }>;
      readonly threads: ReadonlyArray<{ readonly id: string }>;
    },
    E,
    R
  >,
) {
  const before = DateTime.formatIso(yield* DateTime.now);
  const live = yield* readLive;
  return yield* sidecar.prune({
    projectIds: live.projects.map((project) => project.id),
    threadIds: live.threads.map((thread) => thread.id),
    before,
  });
});

const MIGRATIONS = {
  "1_ProjectArtifactsAndSettings": Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`
      CREATE TABLE project_artifacts (
        project_id TEXT NOT NULL,
        id TEXT NOT NULL,
        thread_id TEXT,
        source TEXT NOT NULL CHECK (source IN ('library', 'html_render', 'upload')),
        path TEXT NOT NULL,
        title TEXT NOT NULL,
        size_bytes INTEGER,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (project_id, id)
      ) WITHOUT ROWID
    `;
    yield* sql`
      CREATE TABLE project_settings (
        project_id TEXT PRIMARY KEY NOT NULL,
        thread_model_selection_json TEXT,
        coordinator_model_selection_json TEXT,
        updated_at TEXT NOT NULL
      )
    `;
  }),
};

// SQLite caps bound parameters, so id lists travel as one JSON array for json_each.
const encodeJsonList = Schema.encodeEffect(Schema.fromJsonString(Schema.Array(Schema.String)));

interface ArtifactDbRow {
  readonly project_id: string;
  readonly id: string;
  readonly thread_id: string | null;
  readonly source: ProjectArtifactSource;
  readonly path: string;
  readonly title: string;
  readonly size_bytes: number | null;
  readonly created_at: string;
  readonly updated_at: string;
}

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`PRAGMA busy_timeout = 5000;`;
  yield* sql`PRAGMA journal_mode = WAL;`;
  yield* sql`PRAGMA synchronous = NORMAL;`;
  yield* Migrator.make({})({
    loader: Migrator.fromRecord(MIGRATIONS),
    table: "project_sidecar_migrations",
  });

  const failed =
    (operation: string) =>
    <A, E, R>(effect: Effect.Effect<A, E, R>) =>
      effect.pipe(Effect.mapError((cause) => new ProjectSidecarError({ operation, cause })));
  const nowIso = DateTime.now.pipe(Effect.map(DateTime.formatIso));

  const recordArtifacts = Effect.fn("ProjectSidecar.recordArtifacts")(function* (
    artifacts: ReadonlyArray<ProjectArtifactInput>,
  ) {
    if (artifacts.length === 0) return;
    const now = yield* nowIso;
    yield* sql
      .withTransaction(
        Effect.forEach(
          artifacts,
          (artifact) => sql`
            INSERT INTO project_artifacts
              (project_id, id, thread_id, source, path, title, size_bytes, created_at, updated_at)
            VALUES (
              ${artifact.projectId},
              ${projectArtifactId(artifact.source, artifact.path)},
              ${artifact.threadId},
              ${artifact.source},
              ${artifact.path},
              ${artifact.title},
              ${artifact.sizeBytes},
              ${now},
              ${now}
            )
            ON CONFLICT (project_id, id) DO UPDATE SET
              thread_id = excluded.thread_id,
              source = excluded.source,
              title = excluded.title,
              size_bytes = excluded.size_bytes,
              updated_at = excluded.updated_at
          `,
          { discard: true },
        ),
      )
      .pipe(failed("record artifacts"));
  });

  const listArtifacts = Effect.fn("ProjectSidecar.listArtifacts")(function* (projectId: string) {
    const rows = yield* sql<ArtifactDbRow>`
      SELECT * FROM project_artifacts WHERE project_id = ${projectId} ORDER BY updated_at DESC
    `.pipe(failed("list artifacts"));
    return rows.map((row): ProjectArtifactRow => ({
      id: row.id,
      projectId: row.project_id,
      threadId: row.thread_id,
      source: row.source,
      path: row.path,
      title: row.title,
      sizeBytes: row.size_bytes,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  });

  const syncLibraryFiles = Effect.fn("ProjectSidecar.syncLibraryFiles")(function* (
    projectId: string,
    files: ReadonlyArray<ProjectLibraryFile>,
    options: { readonly complete: boolean },
  ) {
    const now = yield* nowIso;
    yield* Effect.gen(function* () {
      const paths = yield* encodeJsonList(files.map((file) => file.path));
      yield* sql.withTransaction(
        Effect.gen(function* () {
          if (options.complete) {
            yield* sql`
              DELETE FROM project_artifacts
              WHERE project_id = ${projectId}
                AND source IN ('library', 'upload')
                AND path NOT IN (SELECT value FROM json_each(${paths}))
            `;
          }
          if (!Arr.isReadonlyArrayNonEmpty(files)) return;
          yield* sql`
            INSERT INTO project_artifacts ${sql.insert(
              Arr.map(files, (file) => ({
                project_id: projectId,
                id: projectArtifactId("library", file.path),
                thread_id: null,
                source: "library",
                path: file.path,
                title: file.path.split("/").at(-1) ?? file.path,
                size_bytes: file.sizeBytes,
                created_at: now,
                updated_at: now,
              })),
            )}
            ON CONFLICT (project_id, id) DO NOTHING
          `;
        }),
      );
    }).pipe(failed("sync Library files"));
  });

  const removeArtifacts = Effect.fn("ProjectSidecar.removeArtifacts")(function* (
    projectId: string,
    ids: ReadonlyArray<string>,
  ) {
    if (ids.length === 0) return;
    yield* encodeJsonList(ids).pipe(
      Effect.flatMap(
        (json) => sql`
          DELETE FROM project_artifacts
          WHERE project_id = ${projectId} AND id IN (SELECT value FROM json_each(${json}))
        `,
      ),
      failed("remove artifacts"),
    );
  });

  const getModelDefaults = Effect.fn("ProjectSidecar.getModelDefaults")(function* (
    projectId: string,
  ) {
    const [row] = yield* sql<{
      readonly coordinator_model_selection_json: string | null;
    }>`
      SELECT coordinator_model_selection_json
      FROM project_settings WHERE project_id = ${projectId}
    `.pipe(failed("read model defaults"));
    const decoded = (json: string | null | undefined) =>
      json == null ? null : Option.getOrNull(decodeModelSelection(json));
    return {
      coordinatorModelSelection: decoded(row?.coordinator_model_selection_json),
    };
  });

  const setModelDefaults = Effect.fn("ProjectSidecar.setModelDefaults")(function* (
    projectId: string,
    defaults: ProjectModelDefaults,
  ) {
    const now = yield* nowIso;
    const encoded = (selection: ModelSelection | null) =>
      selection === null ? Effect.succeed(null) : encodeModelSelection(selection);
    yield* Effect.gen(function* () {
      const coordinator = yield* encoded(defaults.coordinatorModelSelection);
      yield* sql`
        INSERT INTO project_settings
          (project_id, coordinator_model_selection_json, updated_at)
        VALUES (${projectId}, ${coordinator}, ${now})
        ON CONFLICT (project_id) DO UPDATE SET
          coordinator_model_selection_json = excluded.coordinator_model_selection_json,
          updated_at = excluded.updated_at
      `;
    }).pipe(failed("save model defaults"));
    return defaults;
  });

  const prune = Effect.fn("ProjectSidecar.prune")(function* (live: {
    readonly projectIds: ReadonlyArray<string>;
    readonly threadIds: ReadonlyArray<string>;
    readonly before: string;
  }) {
    return yield* Effect.gen(function* () {
      const projectIds = yield* encodeJsonList(live.projectIds);
      const threadIds = yield* encodeJsonList(live.threadIds);
      return yield* sql.withTransaction(
        Effect.gen(function* () {
          const artifacts = yield* sql<{ readonly count: number }>`
            DELETE FROM project_artifacts
            WHERE updated_at < ${live.before}
              AND (
                project_id NOT IN (SELECT value FROM json_each(${projectIds}))
                OR (thread_id IS NOT NULL
                  AND thread_id NOT IN (SELECT value FROM json_each(${threadIds})))
              )
            RETURNING 1 AS count
          `;
          const settings = yield* sql<{ readonly count: number }>`
            DELETE FROM project_settings
            WHERE updated_at < ${live.before}
              AND project_id NOT IN (SELECT value FROM json_each(${projectIds}))
            RETURNING 1 AS count
          `;
          return artifacts.length + settings.length;
        }),
      );
    }).pipe(failed("prune"));
  });

  return {
    recordArtifacts,
    listArtifacts,
    syncLibraryFiles,
    removeArtifacts,
    getModelDefaults,
    setModelDefaults,
    prune,
  };
});

const layerClient = Layer.unwrap(
  Effect.gen(function* () {
    const { stateDir } = yield* ServerConfig.ServerConfig;
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    yield* fileSystem.makeDirectory(stateDir, { recursive: true });
    return NodeSqliteClient.layer({ filename: path.join(stateDir, PROJECT_SIDECAR_FILE_NAME) });
  }),
);

/** A sidecar that cannot open or migrate leaves the feature without its index, never the server down. */
export const layer = Layer.effect(ProjectSidecar, make).pipe(
  Layer.provide(layerClient),
  Layer.catchCause((cause) =>
    Layer.effect(
      ProjectSidecar,
      Effect.logWarning("The projects sidecar database is unavailable.", { cause }).pipe(
        Effect.as(ProjectSidecar.defaultValue()),
      ),
    ),
  ),
);
