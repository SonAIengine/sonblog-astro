import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import {
  imagePathForPostUrl,
  imagePathForSourceFile,
} from "../scripts/restore-legacy-assets.mjs";

test("maps a canonical post URL to its social image", () => {
  assert.equal(
    imagePathForPostUrl(
      "https://infoedu.co.kr/posts/ai/agent/scenario-validation-automation-recording-execution-validation-pipeline/"
    ),
    "ai/agent/scenario-validation-automation-recording-execution-validation-pipeline.png"
  );
});

test("preserves the case of legacy source paths", () => {
  assert.equal(
    imagePathForSourceFile(
      path.resolve(
        "src/content/posts/ai/XGEN/xgen-1-0-gpu-model-serving-impl.md"
      )
    ),
    "ai/XGEN/xgen-1-0-gpu-model-serving-impl.png"
  );
});

test("rejects paths that cannot map to post assets", () => {
  assert.throws(() => imagePathForPostUrl("https://infoedu.co.kr/"));
  assert.throws(() => imagePathForPostUrl("/posts/ai/%2Fescape/"));
  assert.throws(() => imagePathForPostUrl("https://example.com/posts/ai/post/"));
});
