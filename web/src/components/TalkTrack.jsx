export default function TalkTrack({ talk }) {
  return (
    <ol className="talk" data-testid="talk-track">
      {talk.map((t) => <li key={t.title}><h2>{t.title}</h2><p>{t.say}</p></li>)}
    </ol>
  );
}
