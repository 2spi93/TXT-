"use client";

import dynamic from "next/dynamic";

const RustExecutionAdminDesk = dynamic(() => import("../../components/internal/RustExecutionAdminDesk"), {
  ssr: false,
});

export default function AdvancedRustExecutionAdminDesk() {
  return <RustExecutionAdminDesk />;
}