"use client";

import { useState } from "react";

export default function OperatorCommandButton({
  command,
  label,
}: {
  command: string;
  label: string;
}) {
  const [feedback, setFeedback] = useState<"idle" | "copied" | "error">("idle");

  async function handleClick() {
    try {
      await navigator.clipboard.writeText(command);
      setFeedback("copied");
      window.setTimeout(() => setFeedback("idle"), 1800);
    } catch {
      setFeedback("error");
      window.setTimeout(() => setFeedback("idle"), 2200);
    }
  }

  return (
    <button type="button" className="operator-command-button" onClick={handleClick}>
      {feedback === "copied" ? "Commande copiee" : feedback === "error" ? "Copie impossible" : label}
    </button>
  );
}
