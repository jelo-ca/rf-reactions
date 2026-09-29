// Footer (PLAN.md §10.2): shortcuts hint, data credits, Riot Games notice.
// The notice follows the wording in Riot's "Legal Jibber Jabber" policy; owner to confirm before a public demo.

export function AppFooter({ asOf, onShortcuts }: { asOf: string | null; onShortcuts: () => void }) {
  return (
    <footer className="keys">
      <button type="button" className="linkish" onClick={onShortcuts}>? shortcuts</button>
      <span>Card data: Riftcodex · Prices: TCGplayer via TCGCSV{asOf ? `, as of ${asOf}` : ""}</span>
      <small className="legal">
        Rift Pulls isn&apos;t endorsed by Riot Games and doesn&apos;t reflect the views or opinions of Riot Games or anyone
        officially involved in producing or managing Riot Games properties. Riot Games, and all associated properties are
        trademarks or registered trademarks of Riot Games, Inc.
      </small>
    </footer>
  );
}
