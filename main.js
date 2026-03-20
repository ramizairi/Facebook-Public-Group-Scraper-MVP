import { runApifyMain } from "./src/apify/main.js";
import { runCliMain } from "./src/index.js";

function isApifyRuntime() {
  return Boolean(
    process.env.APIFY_IS_AT_HOME ||
      process.env.APIFY_TOKEN ||
      process.env.APIFY_LOCAL_STORAGE_DIR ||
      process.env.APIFY_DEFAULT_KEY_VALUE_STORE_ID,
  );
}

const runner = isApifyRuntime() ? runApifyMain : runCliMain;

runner().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
