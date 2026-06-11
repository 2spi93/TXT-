"use client";

import dynamic from "next/dynamic";

const OpsChatbot = dynamic(() => import("./OpsChatbot"), {
  ssr: false,
  loading: () => null,
});

export default function LazyOpsChatbot() {
  return <OpsChatbot />;
}