import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  policySaveBody,
  previewVehicleImpactMessage,
  readinessCellModel,
  readinessFrom,
} from "./fleet-readiness-ui.ts";

test("ready vehicle shows the app-only allocation guidance", () => {
  const model = readinessCellModel({
    status: "AVAILABLE",
    vehicleReadiness: {
      ready: true,
      blockers: [],
      nextStep: "Use the Fleet Manager app to allocate this scooter.",
    },
  });
  assert.deepEqual(model, {
    state: "ready",
    blockers: [],
    nextStep: "Use the Fleet Manager app to allocate this scooter.",
    guidance: "Allocate in the Fleet Manager app.",
  });
  const html = renderToStaticMarkup(React.createElement("div", { className: "vehicle-readiness-cell" },
    React.createElement("span", { className: "status status-ready" }, "Ready"),
    React.createElement("small", null, model.guidance),
  ));
  assert.match(html, /status-ready/);
  assert.match(html, /Allocate in the Fleet Manager app/);
});

test("coded blockers remain blocked and expose their next step", () => {
  const model = readinessCellModel({
    status: "AVAILABLE",
    vehicleReadiness: {
      ready: false,
      blockers: [
        { code: "PREPARATION_QC_REQUIRED", message: "Preparation and QC approval are required." },
        { code: "UNFINISHED_ALLOCATION", message: "Scooter has an unfinished allocation." },
      ],
      nextStep: "Complete preparation and QC approval.",
    },
  });
  assert.equal(model.state, "blocked");
  assert.deepEqual(model.blockers, [
    "Preparation and QC approval are required.",
    "Scooter has an unfinished allocation.",
  ]);
  assert.equal(model.nextStep, "Complete preparation and QC approval.");
  assert.equal(model.guidance, "Complete vehicle readiness first.");
});

test("missing readiness never becomes false-ready", () => {
  assert.equal(readinessFrom(undefined), null);
  assert.equal(readinessCellModel({ status: "AVAILABLE" }).state, "unavailable");
  assert.equal(readinessCellModel({ status: "AVAILABLE" }).guidance, "Readiness unavailable.");
  assert.equal(readinessCellModel({ status: "ALLOCATED" }).guidance, "Return this vehicle in the Fleet Manager app.");
});

test("empty vehicle impact distinguishes an unchanged mode from a changed mode", () => {
  assert.equal(
    previewVehicleImpactMessage("SIMPLE", "SIMPLE", []),
    "No vehicle effects: this mode is unchanged.",
  );
  assert.equal(
    previewVehicleImpactMessage("SIMPLE", "PREPARATION_QC", []),
    "No vehicle effects are reported for this mode change.",
  );
  assert.equal(
    previewVehicleImpactMessage("SIMPLE", "PREPARATION_QC", undefined),
    "Exact vehicle impact is unavailable.",
  );
});

test("authoritative response modes override stale local policy state", () => {
  assert.equal(
    previewVehicleImpactMessage("PREPARATION_QC", "SIMPLE", []),
    "No vehicle effects are reported for this mode change.",
  );
});

test("policy save body only sends the backend allowlist", () => {
  const body = policySaveBody({
    operatingMode: "STAGED_PREPARATION_QC",
    configuration: { stages: [{ code: "INTAKE" }] },
    version: 4,
    installationStageTemplates: [{ code: "SERVER_TEMPLATE" }],
  }, "Move the fleet to staged QC.");
  assert.deepEqual(body, {
    operatingMode: "STAGED_PREPARATION_QC",
    configuration: { stages: [{ code: "INTAKE" }] },
    expectedVersion: 4,
    reason: "Move the fleet to staged QC.",
  });
  assert.equal(Object.hasOwn(body, "installationStageTemplates"), false);
  assert.equal(Object.hasOwn(body, "version"), false);
});
