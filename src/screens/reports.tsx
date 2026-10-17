import { useState } from "react";
import { Page, Card, Button, Field, Select, ClientPicker, AiOutput, Table, Empty, toast, fmtDate } from "../core/ui";
import { useCollection, getAll, create, collections, storeReady } from "../core/store";
import { aiText } from "../core/ai";
import { subLabel, clientMrr } from "../core/biz";
import { eur } from "../core/plans";
import type { Client, Rec } from "../core/types";

interface Report extends Rec { clientId: string; month: string; text: string; live: boolean }

const months = () => Array.from({ length: 6 }, (_, i) => {
  const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - i);
  return d.toISOString().slice(0, 7);
});
const monthName = (m: string) => new Date(m + "-15").toLocaleDateString("en-GB", { month: "long", year: "numeric" });

export default function Reports() {
  const clients = useCollection<Client>("clients").filter((c) => c.stage !== "churned");
  const reports = useCollection<Report>("reports");
  const [clientId, setClientId] = useState("");
  const [month, setMonth] = useState(months()[0]);
  const [out, setOut] = useState<{ text: string; live: boolean; error?: string }>();
  const [busy, setBusy] = useState(false);
  const client = clients.find((c) => c.id === (clientId || clients[0]?.id));

  const run = async () => {
    if (!client) return;
    setBusy(true);
    await storeReady;
    // Gather everything any module stored for this client.
    const activity: Record<string, number> = {};
    for (const col of collections()) {
      if (["clients", "reports", "settings"].includes(col)) continue;
      const n = getAll<Rec & { clientId?: string }>(col).filter((r) => r.clientId === client.id && (r.createdAt || "").startsWith(month)).length;
      if (n) activity[col] = n;
    }
    const r = await aiText(
      `Write a short monthly report for ${client.name} (${client.kind}, ${client.town}) for ${monthName(month)}. ` +
      `Services: ${client.subs.map(subLabel).join(", ") || "none"}. Records created this month per area: ${JSON.stringify(activity)}. ` +
      `Write in Spanish, friendly and plain, max 180 words: what we did, what changed, one next action. Don't invent numbers that aren't given.`,
      () => demoReport(client, month, activity),
      { onText: (text) => setOut({ text, live: true }) },
    );
    setOut({ text: r.data, live: r.live, error: r.error });
    setBusy(false);
  };

  return (
    <Page title="Client reports" intro="Monthly reports keep clients from cancelling after month three. Each one pulls what every service did for that client.">
      <div className="split">
        <Card title="New report">
          {clients.length ? (
            <>
              <Field label="Client"><ClientPicker id="r-client" clients={clients} value={client?.id ?? ""} onChange={setClientId} /></Field>
              <Field label="Month"><Select id="r-month" value={month} onChange={setMonth} options={months().map((m) => ({ value: m, label: monthName(m) }))} /></Field>
              {client && <p className="small muted">{client.subs.map(subLabel).join(", ") || "No services"} · {eur(Math.round(clientMrr(client)))}/mo</p>}
              <Button kind="primary" busy={busy} onClick={run}>Write report</Button>
            </>
          ) : <Empty>Add a client first.</Empty>}
        </Card>
        <div className="stack">
          <AiOutput title="Report" text={out?.text} live={out?.live} error={out?.error}
            actions={out && client && <Button small onClick={async () => { await create<Report>("reports", { clientId: client.id, month, text: out.text, live: out.live }); toast("Report saved"); }}>Save</Button>} />
          <Card title="Saved reports">
            <Table rows={reports} rowKey={(r) => r.id} empty="No saved reports yet." onRow={(r) => setOut({ text: r.text, live: r.live })}
              cols={[
                { label: "Client", render: (r) => clients.find((c) => c.id === r.clientId)?.name ?? "Unknown" },
                { label: "Month", render: (r) => monthName(r.month) },
                { label: "Saved", render: (r) => fmtDate(r.createdAt) },
              ]} />
          </Card>
        </div>
      </div>
    </Page>
  );
}

function demoReport(c: Client, month: string, activity: Record<string, number>) {
  const lines = Object.entries(activity).map(([k, n]) => `· ${k.replace(/_/g, " ")}: ${n}`).join("\n") || "· Seguimiento y ajustes del servicio";
  return `Hola ${c.contact || c.name},

Resumen de ${monthName(month)} para ${c.name}:

${lines}

Lo más importante: respondemos a todos los clientes en su idioma y tu perfil se mantiene activo cada semana, que es lo que Google y los asistentes de IA tienen en cuenta.

Próximo paso: este mes nos centramos en conseguir más reseñas con el código QR en las mesas. Si te parece bien, te dejo dos expositores nuevos el martes.

Un saludo`;
}
