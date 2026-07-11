import type { Metadata } from "next";
import StageView from "@/components/stage/stage";
import "./stage.css";

export const metadata: Metadata = {
  title: "Hero Mandate · Stage",
  description:
    "Projector view of the Chain of Mandate console: live capacity bars, executed and refused events as they land on chain, receipt chain verified client side.",
};

export default function StagePage() {
  return <StageView />;
}
