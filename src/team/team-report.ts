// Shape the team report renders; built by aggregation, read by the HTML renderer
export interface OutcomeSplit { shipped: number; reverted: number; neverMerged: number; stillOpen: number; noChanges: number }
export interface TeamGroup { repo: string; agent: string; sessions: number; pricedUsd: number; unpricedSessions: number; outcomes: OutcomeSplit }
export interface CostlyUnshipped { date: string; repo: string; agent: string; outcome: "never-merged" | "reverted"; usd: number | null }
export interface TeamReport {
  window: { from: string; to: string };
  totals: { sessions: number; pricedUsd: number; unpricedSessions: number; outcomes: OutcomeSplit };
  groups: TeamGroup[];
  costliestUnshipped: CostlyUnshipped[];
}
