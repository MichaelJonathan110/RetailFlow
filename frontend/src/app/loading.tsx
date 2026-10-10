export default function Loading() {
  return (
    <div className="rf-hero">
      <div className="rf-skeleton" style={{ height: 14, width: 120, marginBottom: 16 }} />
      <div className="rf-skeleton" style={{ height: 40, width: '60%', marginBottom: 12 }} />
      <div className="rf-skeleton" style={{ height: 14, width: '80%' }} />
      <div className="rf-kpi-grid" style={{ marginTop: 26 }}>
        {[0, 1, 2, 3].map((i) => (
          <div className="rf-kpi-card" key={i}>
            <div className="rf-skeleton" style={{ height: 84 }} />
          </div>
        ))}
      </div>
    </div>
  );
}
