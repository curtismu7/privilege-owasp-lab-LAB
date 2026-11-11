// The story as data (server/src/storyData.js) with the cast of the chosen vertical filled in. Each scenario opens its
// command on the Commands tab. Every fact carries its status as a word, never colour alone.
const STATUS = {
  "observed-in-AI-DEMO2": ["chip--info", "Observed in AI-DEMO2 (UNVERIFIED here)"],
  captured: ["chip--ok", "Captured from the source system"],
  UNVERIFIED: ["chip--warn", "UNVERIFIED"],
  lab: ["chip--ok", "This lab (tested)"],
};

export default function StoryTab({ story, onOpenCommand }) {
  return (
    <div data-testid="story">
      <p className="lede">{story.intro}</p>
      <p className="section-label">Scenarios</p>
      <div className="card-grid scen-grid">
        {story.scenarios.map((sc, i) => (
          <article key={sc.id} id={`scenario-${sc.id}`} className="card" data-testid={`scenario-${sc.id}`}>
            <h3>{i + 1}. {sc.title}</h3>
            <p>{sc.say}</p>
            <p className="hint"><strong>Lesson:</strong> {sc.lesson}</p>
            <button type="button" onClick={() => onOpenCommand(sc.commandKey)}>Open <code>{sc.commandKey}</code></button>
          </article>
        ))}
      </div>
      <p className="section-label">What is claimed, and how we know</p>
      <ul className="facts">
        {story.facts.map((f) => {
          const [cls, word] = STATUS[f.status] || ["", f.status];
          return <li key={f.id}><span className={`chip ${cls}`}><span className="dot" aria-hidden="true" />{word}</span> {f.text}{f.source ? <span className="muted"> (source: {f.source})</span> : null}</li>;
        })}
      </ul>
      <p className="muted">{story.tokenLabel}</p>
    </div>
  );
}
