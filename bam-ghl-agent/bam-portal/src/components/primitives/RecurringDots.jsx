const DEFAULT_TASK_NAMES = [
  "Weekly Check-in Call",
  "Monthly KPI Review",
  "Ad Performance Report",
  "Content Calendar Approval",
  "Systems Audit",
  "Renewal Check (60 days out)",
];

export default function RecurringDots({ recurring, tokens, taskNames }) {
  const names = taskNames || DEFAULT_TASK_NAMES;
  return (
    <div style={{ display: "flex", gap: 5, alignItems: "center" }}>
      {recurring.map((done, i) => (
        <div key={i} title={names[i] || `Task ${i + 1}`} style={{
          width: 7, height: 7, borderRadius: 2,
          background: done ? tokens.green : tokens.borderMed,
          transition: "all 0.25s",
        }} />
      ))}
    </div>
  );
}
