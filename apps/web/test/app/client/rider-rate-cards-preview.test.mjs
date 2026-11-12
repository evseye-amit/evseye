import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const panelPath = new URL(
  "../../../src/app/client/kyc/rider-rate-cards-panel.tsx",
  import.meta.url,
);
const rulesPath = new URL(
  "../../../src/app/client/kyc/rider-rate-card-rules.tsx",
  import.meta.url,
);

test("visible rate-card screen mounts the preview controls and submits preview requests", async () => {
  const panel = await readFile(panelPath, "utf8");
  const rules = await readFile(rulesPath, "utf8");

  assert.match(
    panel,
    /import \{ RuleEditor \} from "\.\/rider-rate-card-rules"/,
  );
  assert.match(panel, /<RuleEditor[\s\S]*?version=\{version\}/);
  assert.match(rules, /function PricingPreview\(\{ version \}/);
  assert.match(rules, /<summary>Preview pricing resolution<\/summary>/);
  assert.match(rules, /request\(`\/preview-rules`/);
  assert.match(rules, /name=\"Preview\"|>Preview<\/button>/);
});
