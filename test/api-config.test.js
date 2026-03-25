import assert from "node:assert/strict";
import test from "node:test";

import { loadApiServerConfig } from "../src/api/config.js";

test("loadApiServerConfig requires API_AUTH_KEY", () => {
  assert.throws(
    () =>
      loadApiServerConfig({
        API_ALLOWED_ORIGIN: "https://app.example.com",
      }),
    /API_AUTH_KEY is required\./,
  );
});

test("loadApiServerConfig requires API_ALLOWED_ORIGIN", () => {
  assert.throws(
    () =>
      loadApiServerConfig({
        API_AUTH_KEY: "secret",
      }),
    /API_ALLOWED_ORIGIN is required\./,
  );
});

test("loadApiServerConfig normalizes host, port, and allowed origin", () => {
  const config = loadApiServerConfig({
    API_HOST: "127.0.0.1",
    API_PORT: "4000",
    API_AUTH_KEY: "secret",
    API_ALLOWED_ORIGIN: "https://app.example.com/path?q=1",
    API_COOKIES_FILE: "cookies.json",
  });

  assert.deepEqual(config, {
    host: "127.0.0.1",
    port: 4000,
    authKey: "secret",
    allowedOrigin: "https://app.example.com",
    cookiesFile: "cookies.json",
  });
});
