"use client";

import HelpTooltip from "./ui/HelpTooltip";
import { useUiMode } from "../lib/userUiPrefs";

type HelpHintProps = {
  text: string;
  examples?: string[];
  label?: string;
};

export default function HelpHint({ text, examples = [], label = "Pour lire ce bloc" }: HelpHintProps) {
  const [uiMode] = useUiMode();

  return (
    <HelpTooltip
      mode={uiMode}
      entry={{
        label,
        simple: text,
        example: examples.join(" "),
        whyItMatters: "Lis cette aide pour comprendre rapidement ce que montre le bloc et ce qu'il faut regarder.",
      }}
    />
  );
}
