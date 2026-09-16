import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { uploadFile } from "./upload.ts";

const apiUrl = "https://api.example.test/api/v1";
const file = new File(["photo"], "photo.jpg", { type: "image/jpeg" });

function captureFetch(response = new Response(null, { status: 200 })) {
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    calls.push({ input, init });
    return response;
  };
  return {
    calls,
    restore() {
      globalThis.fetch = originalFetch;
    },
  };
}

function headersOf(init) {
  return Object.fromEntries(new Headers(init.headers));
}

test("authenticates and resolves an origin-root local upload", async () => {
  const fetchSpy = captureFetch();
  try {
    await uploadFile(
      {
        uploadUrl: "/api/v1/storage/local/upload",
        uploadHeaders: { "X-Upload-Token": "local-secret" },
      },
      file,
      { apiUrl, accessToken: "api-token" },
    );

    assert.equal(fetchSpy.calls.length, 1);
    assert.equal(
      fetchSpy.calls[0].input,
      "https://api.example.test/api/v1/storage/local/upload",
    );
    assert.deepEqual(headersOf(fetchSpy.calls[0].init), {
      authorization: "Bearer api-token",
      "content-type": "image/jpeg",
      "x-upload-token": "local-secret",
    });
    assert.equal(fetchSpy.calls[0].init.method, "PUT");
    assert.equal(fetchSpy.calls[0].init.body, file);
    assert.equal(fetchSpy.calls[0].init.redirect, "error");
  } finally {
    fetchSpy.restore();
  }
});

test("uses an absolute S3 target unchanged and strips returned Authorization", async () => {
  const target = "https://s3.example.test/object?X-Amz-Signature=secret";
  const fetchSpy = captureFetch();
  try {
    await uploadFile(
      {
        uploadUrl: target,
        uploadHeaders: {
          Authorization: "Bearer malicious",
          "X-Amz-Signed": "signed-value",
        },
      },
      file,
      { apiUrl, accessToken: "api-token" },
    );

    assert.equal(fetchSpy.calls[0].input, target);
    const headers = headersOf(fetchSpy.calls[0].init);
    assert.equal(headers.authorization, undefined);
    assert.equal(headers["x-amz-signed"], "signed-value");
    assert.equal(headers["content-type"], "image/jpeg");
    assert.equal(fetchSpy.calls[0].init.redirect, undefined);
  } finally {
    fetchSpy.restore();
  }
});

test("merges returned headers and keeps a supplied Content-Type", async () => {
  const fetchSpy = captureFetch();
  try {
    await uploadFile(
      {
        uploadUrl: "https://s3.example.test/object",
        uploadHeaders: {
          "Content-Type": "application/octet-stream",
          "X-Custom": "value",
        },
      },
      file,
      { apiUrl, accessToken: "api-token" },
    );

    assert.deepEqual(headersOf(fetchSpy.calls[0].init), {
      "content-type": "application/octet-stream",
      "x-custom": "value",
    });
  } finally {
    fetchSpy.restore();
  }
});

test("rejects missing or unsafe upload intents", async () => {
  for (const intent of [
    null,
    {},
    { uploadUrl: "" },
    { uploadUrl: "//evil.example.test/upload" },
    { uploadUrl: "javascript:alert(1)" },
    { uploadUrl: "https://s3.example.test/object", uploadHeaders: { Bad: 1 } },
  ]) {
    await assert.rejects(
      uploadFile(intent, file, { apiUrl, accessToken: "api-token" }),
      /invalid upload/i,
    );
  }
});

test("requires an API token for relative uploads", async () => {
  const fetchSpy = captureFetch();
  try {
    await assert.rejects(
      uploadFile({ uploadUrl: "/api/v1/storage/local/upload" }, file, {
        apiUrl,
        accessToken: "",
      }),
      /access token/i,
    );
    assert.equal(fetchSpy.calls.length, 0);
  } finally {
    fetchSpy.restore();
  }
});

test("throws a status-only error for non-2xx responses", async () => {
  const target = "https://s3.example.test/object?X-Amz-Signature=secret";
  const fetchSpy = captureFetch(new Response("secret body", { status: 403 }));
  try {
    await assert.rejects(
      uploadFile(
        {
          uploadUrl: target,
          uploadHeaders: { "X-Upload-Token": "local-secret" },
        },
        file,
        { apiUrl, accessToken: "api-token" },
      ),
      (error) => {
        assert.match(error.message, /403/);
        assert.doesNotMatch(error.message, /s3\.example|X-Amz|secret|token/i);
        return true;
      },
    );
  } finally {
    fetchSpy.restore();
  }
});

test("all seven intent uploads use the shared helper", () => {
  const sources = [
    "../app/page.tsx",
    "../app/client/page.tsx",
    "../app/platform/dashboard/page.tsx",
  ].map((path) => readFileSync(new URL(path, import.meta.url), "utf8"));
  const source = sources.join("\n");

  assert.equal((source.match(/await uploadFile\(/g) ?? []).length, 7);
  assert.doesNotMatch(source, /fetch\(\s*intent(?:Body\.data)?\.uploadUrl/);
});
