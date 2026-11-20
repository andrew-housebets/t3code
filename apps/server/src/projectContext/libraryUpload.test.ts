import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import * as AssetSigner from "../assets/AssetSigner.ts";
import {
  ATTACHMENT_UPLOAD_ROUTE_PREFIX,
  issueAttachmentUploadUrl,
  storeAttachmentUpload,
  validateAttachmentUploadToken,
} from "../assets/AttachmentUpload.ts";
import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as ServerConfig from "../config.ts";
import * as DocumentText from "../provider/DocumentText.ts";
import * as ProjectSidecar from "../projectSidecar/ProjectSidecar.ts";
import * as ProjectContext from "./ProjectContext.ts";

const layerTest = ProjectContext.layer.pipe(
  Layer.provideMerge(ProjectSidecar.layer),
  Layer.provideMerge(AssetSigner.layer),
  Layer.provideMerge(ServerSecretStore.layer),
  Layer.provideMerge(ServerConfig.layerTest(process.cwd(), { prefix: "t3-library-upload-" })),
  Layer.provideMerge(
    DocumentText.layer.pipe(
      Layer.provideMerge(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer)),
    ),
  ),
);

it.layer(layerTest, { excludeTestServices: true })("Library uploads", (it) => {
  it.effect.each([
    { name: "archive.zip", mimeType: "application/zip" },
    { name: "photo.png", mimeType: "image/png" },
    { name: "Makefile", mimeType: "application/octet-stream" },
    { name: "notes.unusual-extension", mimeType: "application/octet-stream" },
  ])("moves a signed upload of $name into the Library under its own name", ({ name, mimeType }) =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const context = yield* ProjectContext.ProjectContext;
      const bytes = new TextEncoder().encode(`contents of ${name}`);
      const issued = yield* issueAttachmentUploadUrl({
        type: "file",
        name,
        mimeType,
        sizeBytes: bytes.length,
      });
      const claims = yield* validateAttachmentUploadToken(
        issued.relativeUrl.slice(`${ATTACHMENT_UPLOAD_ROUTE_PREFIX}/`.length),
      );
      assert.isNotNull(claims);
      if (claims === null) return;
      assert.deepEqual(yield* storeAttachmentUpload(claims, bytes), { ok: true });

      const added = yield* context.addLibraryFile({
        projectId: "project:signed-upload",
        attachmentId: issued.attachmentId,
        name,
        replace: false,
      });
      const library = yield* context.ensureLibrary("project:signed-upload");
      assert.deepEqual(added, { path: name });
      assert.deepEqual(yield* fileSystem.readFile(path.join(library, name)), bytes);
    }),
  );
});
