import { expect, test } from "@playwright/test";

import {
  buildLayoutPreset,
  normalizeDockLayout,
  riskAlertDefaultsForPreset,
} from "../../app/terminal/terminalLayoutWorkspace";

test("workspace change -> reset risk alert -> persist -> reload", async () => {
  const scalpWorkspace = buildLayoutPreset("scalp", false);
  const swingWorkspace = buildLayoutPreset("swing", false);
  const activeWorkspaceName = "Swing-NY";

  const workspaces = {
    "Scalp-1": scalpWorkspace,
    "Swing-NY": swingWorkspace,
  };

  const customizedSwingWorkspace = normalizeDockLayout({
    ...workspaces[activeWorkspaceName],
    riskAlert: {
      window: 19,
      missThreshold: 7,
      refreshSec: 30,
      hardAlertEnabled: true,
      hardAlertThresholdPct: 72,
    },
  }, workspaces[activeWorkspaceName]);

  const resetSwingWorkspace = normalizeDockLayout({
    ...customizedSwingWorkspace,
    riskAlert: riskAlertDefaultsForPreset(customizedSwingWorkspace.preset),
  }, customizedSwingWorkspace);

  const reloadedSwingWorkspace = normalizeDockLayout(resetSwingWorkspace, swingWorkspace);

  expect(activeWorkspaceName).toBe("Swing-NY");
  expect(reloadedSwingWorkspace.riskAlert.window).toBe(10);
  expect(reloadedSwingWorkspace.riskAlert.missThreshold).toBe(3);
  expect(reloadedSwingWorkspace.riskAlert.refreshSec).toBe(15);
  expect(reloadedSwingWorkspace.riskAlert.hardAlertEnabled).toBe(false);
  expect(reloadedSwingWorkspace.riskAlert.hardAlertThresholdPct).toBe(60);
});
