import { BugsList } from "../components/BugsList";
import type { Bug } from "../types";

export function BugsTab({ bugs }: { bugs: Bug[] }) {
  return <BugsList bugs={bugs} />;
}
