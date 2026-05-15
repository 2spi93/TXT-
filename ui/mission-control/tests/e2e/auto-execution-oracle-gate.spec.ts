import { expect, test } from "@playwright/test";

import { buildAutoExecutionOracleGate } from "../../app/terminal/autoExecutionOracleGate";

test("auto execution gate stays blocked when the oracle blocks execution", () => {
  const gate = buildAutoExecutionOracleGate({
    oracleBlocksExecution: true,
    oracleBlockingLayer: "information_density",
    autoMetaPass: true,
    autoRiskHardPass: true,
    riskAiLiveBlocked: false,
    capitalScalingLiveBlocked: false,
    journalWindowScalingLiveBlocked: false,
    profitOptimizerLiveExitBlocked: false,
    autoRiskKillSwitchActive: false,
    autoSessionPass: true,
    autoSessionLabel: "open",
    autoSymbolLossPass: true,
    selfLearningPass: true,
    microAlphaExecutable: true,
    autoEntryReady: true,
    hasSuggestedBracket: true,
    replayEnabled: false,
    journalTierLabel: "NORMAL",
    capitalStatusLabel: "BALANCED",
    riskAiReasonLabel: "ALLOW",
    profitOptimizerReasonLabel: "ALLOW",
    microAlphaSetupType: "breakout",
    autoCorrelationCluster: "btc-beta",
    autoCorrelationClusterBreached: false,
    autoVolatilitySpikeBreached: false,
    autoVolatilityBps: 0,
    autoAlphaRejectBreached: false,
  });

  expect(gate.ready).toBe(false);
  expect(gate.autoState).toBe("BLOCKED");
  expect(gate.riskLabel).toBe("BLOCKED");
  expect(gate.ruleLabel).toBe("oracle information_density");
});

test("kill switch still outranks oracle in auto execution gate state", () => {
  const gate = buildAutoExecutionOracleGate({
    oracleBlocksExecution: true,
    oracleBlockingLayer: "truth",
    autoMetaPass: true,
    autoRiskHardPass: true,
    riskAiLiveBlocked: false,
    capitalScalingLiveBlocked: false,
    journalWindowScalingLiveBlocked: false,
    profitOptimizerLiveExitBlocked: false,
    autoRiskKillSwitchActive: true,
    autoSessionPass: true,
    autoSessionLabel: "open",
    autoSymbolLossPass: true,
    selfLearningPass: true,
    microAlphaExecutable: true,
    autoEntryReady: true,
    hasSuggestedBracket: true,
    replayEnabled: false,
    journalTierLabel: "NORMAL",
    capitalStatusLabel: "BALANCED",
    riskAiReasonLabel: "ALLOW",
    profitOptimizerReasonLabel: "ALLOW",
    microAlphaSetupType: "breakout",
    autoCorrelationCluster: "btc-beta",
    autoCorrelationClusterBreached: false,
    autoVolatilitySpikeBreached: false,
    autoVolatilityBps: 0,
    autoAlphaRejectBreached: false,
  });

  expect(gate.ready).toBe(false);
  expect(gate.autoState).toBe("KILLED");
  expect(gate.ruleLabel).toBe("kill switch");
});