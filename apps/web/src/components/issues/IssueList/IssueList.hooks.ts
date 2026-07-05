// IssueList is a pure presentational list: its filter value and selection are owned
// upstream by the IssueTriageView hook, and every derived row string (age, label
// chips) is a pure render-time transform. This module exists to satisfy the
// folder-per-component sibling contract and is the home for any future state.
export {};
