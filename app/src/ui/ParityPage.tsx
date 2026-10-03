// Parity page (PLAN.md §6.7, route #parity): run the Python fixtures through the real worker path.
import { assetUrl } from "../assetUrl";
import { useEffect, useState } from "react";
import { transfer, vision } from "../vision/client";
import type { InitInfo } from "../vision/worker";

const EMBED_MIN = 0.98;
const LAYOUT_MIN = 0.999;

interface Expected {
  file: string;
  printingId: string;
  embedding: number[];
  layout: number[];
}
interface Row {
  file: string;
  embedCos: number;
  layoutCos: number;
  ms: number;
}

function cosine(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let d = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    d += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return d / Math.sqrt(na * nb);
}

export function ParityPage() {
  const [info, setInfo] = useState<InitInfo | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false; // StrictMode runs effects twice in dev; ignore the discarded run
    (async () => {
      const v = vision();
      const i = await v.init();
      if (cancelled) return;
      setInfo(i);
      const expected: Expected[] = await (await fetch(assetUrl("/fixtures/parity/expected.json"))).json();
      for (const e of expected) {
        const blob = await (await fetch(assetUrl(`/fixtures/parity/${e.file}`))).blob();
        const bmp = await createImageBitmap(blob);
        const t = performance.now();
        const got = await v.signatures(transfer(bmp));
        if (cancelled) return;
        const row = { file: e.file, embedCos: cosine(got.embedding, e.embedding), layoutCos: cosine(got.layout, e.layout), ms: performance.now() - t };
        console.log(`[parity] ${JSON.stringify(row)}`);
        setRows((r) => [...r, row]);
      }
    })().catch((e: unknown) => !cancelled && setError(String(e)));
    return () => {
      cancelled = true;
    };
  }, []);

  const pass = rows.length > 0 && rows.every((r) => r.embedCos >= EMBED_MIN && r.layoutCos >= LAYOUT_MIN);
  const done = rows.length === 5;
  useEffect(() => {
    if (done) console.log(`[parity] ${pass ? "PASS" : "FAIL"} backend=${info?.backend}`);
  }, [done, pass, info]);

  return (
    <div className="parity">
      <h1>Parity check</h1>
      {info && (
        <p>
          backend <b>{info.backend}</b> · load {info.loadMs.toFixed(0)} ms · warm-up {info.warmupMs.toFixed(0)} ms ·{" "}
          {info.rows} rows × {info.dim} · threads {info.threads} · isolated {String(info.crossOriginIsolated)}
        </p>
      )}
      {error && <p className="error-inline">{error}</p>}
      <table>
        <thead>
          <tr><th>fixture</th><th>embedding cos (≥ {EMBED_MIN})</th><th>layout cos (≥ {LAYOUT_MIN})</th><th>ms</th></tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.file}>
              <td>{r.file}</td>
              <td className={r.embedCos >= EMBED_MIN ? "ok" : "bad"}>{r.embedCos.toFixed(6)}</td>
              <td className={r.layoutCos >= LAYOUT_MIN ? "ok" : "bad"}>{r.layoutCos.toFixed(6)}</td>
              <td>{r.ms.toFixed(0)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {done && <p className={`verdict ${pass ? "ok" : "bad"}`}>{pass ? "PASS" : "FAIL"}</p>}
      <p><a href="#">← back to the app</a></p>
    </div>
  );
}
