import assert from "node:assert/strict";
import test from "node:test";
import { normalizeUploadFilename } from "./filenames.js";

test("normalizes multer latin1 mojibake without damaging valid names", () => {
  assert.equal(normalizeUploadFilename("æµç¨å¾(2).xls"), "流程图(2).xls");
  assert.equal(normalizeUploadFilename("流程图(2).xls"), "流程图(2).xls");
  assert.equal(normalizeUploadFilename("haixun-v1.xlsx"), "haixun-v1.xlsx");
});
