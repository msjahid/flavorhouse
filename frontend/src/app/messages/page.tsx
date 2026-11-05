"use client";

import { useEffect, useMemo, useState } from "react";
import { dt, ErrorBox, useLoad } from "@/components/manage/ui";
import { usePosAuth } from "@/context/PosAuth";
import { manageApi, type Mail } from "@/lib/manage";

type Box = "inbox" | "sent" | "archived" | "team";
const BOXES: [Box, string][] = [["inbox", "📥 Inbox"], ["sent", "📤 Sent"], ["archived", "🗄 Archived"], ["team", "👀 Team messages"]];

const WHO_CAN: Record<number, string> = {
  1: "You can message your manager and supervisor.",
  2: "You can message your employees, your supervisor and super admin.",
  3: "You can message your team, the super admin and the admin.",
  4: "You can message your team and the admin.",
  5: "You can message everyone.",
};
const kb = (n: number) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(n / 1024)} KB`);

export default function MessagesPage() {
  const { user } = usePosAuth();
  const level = user?.level ?? 1;
  const [box, setBox] = useState<Box>("inbox");
  const list = useLoad(() => manageApi.mail(box), [box]);
  const [open, setOpen] = useState<Mail | null>(null);
  const [compose, setCompose] = useState<{ to?: string[]; subject?: string; reply_to?: number; quote?: string } | null>(null);
  const [q, setQ] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => { setOpen(null); }, [box]);
  useEffect(() => {
    const t = setInterval(() => { if (box === "inbox") list.reload(); }, 30_000);
    return () => clearInterval(t);
  }, [box, list]);

  const items = (list.data?.items ?? []).filter((m) => !q || `${m.subject} ${m.sender_name} ${m.body}`.toLowerCase().includes(q.toLowerCase()));

  const read = async (m: Mail) => {
    const full = await manageApi.openMail(m.id).catch(() => m);
    setOpen(full);
    if (!m.read && box === "inbox") list.reload();
  };
  const archive = async (m: Mail, archived: boolean) => { await manageApi.markMail(m.id, { archived }); setOpen(null); list.reload(); };
  const unread = async (m: Mail) => { await manageApi.markMail(m.id, { unread: true }); setOpen(null); list.reload(); };

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <h1 className="mr-auto font-display text-3xl font-extrabold">Messages</h1>
        <input className="input !w-60 !py-2" placeholder="Search messages…" value={q} onChange={(e) => setQ(e.target.value)} />
        <button className="btn-primary" onClick={() => setCompose({})}>✏️ New message</button>
      </div>
      {msg && <p className="mb-3 rounded-xl bg-leaf/10 p-3 text-sm font-semibold text-leaf">{msg}</p>}
      {box === "team" ? (
        <p className="mb-3 rounded-xl bg-white p-3 text-sm ring-1 ring-ink/5">👀 Read-only: messages sent by people below you{level < 5 ? " at your stores" : ""}. They don’t see that you opened them.</p>
      ) : <p className="mb-3 text-xs text-ink-soft">{WHO_CAN[level]} You can always reply to anyone who writes to you.</p>}
      <div className="grid min-h-[70vh] overflow-hidden rounded-3xl bg-white ring-1 ring-ink/5 md:grid-cols-[180px_340px_1fr]">
        <nav className="flex gap-1 border-b border-ink/10 bg-cream/60 p-2 md:flex-col md:border-b-0 md:border-r">
          {BOXES.filter(([k]) => k !== "team" || level >= 3).map(([k, l]) => (
            <button key={k} onClick={() => setBox(k)} className={`flex items-center justify-between rounded-xl px-3 py-2 text-left text-sm font-semibold ${box === k ? "bg-ink text-cream" : "hover:bg-ink/5"}`}>
              {l}{k === "inbox" && (list.data?.unread ?? 0) > 0 && box === "inbox" && <span className="rounded-full bg-flame px-2 text-xs text-white">{list.data!.unread}</span>}
            </button>
          ))}
        </nav>
        <ul className={`max-h-[75vh] divide-y divide-ink/5 overflow-y-auto border-r border-ink/10 ${open ? "hidden md:block" : ""}`}>
          <ErrorBox error={list.error} />
          {items.length === 0 && <li className="p-8 text-center text-sm text-ink-soft">{list.loading ? "Loading…" : "No messages"}</li>}
          {items.map((m) => (
            <li key={m.id}>
              <button onClick={() => read(m)} className={`block w-full px-4 py-3 text-left hover:bg-cream/60 ${open?.id === m.id ? "bg-cream" : ""}`}>
                <div className="flex items-center justify-between gap-2">
                  <p className={`truncate text-sm ${!m.read && box === "inbox" ? "font-extrabold" : "font-semibold"}`}>
                    {!m.read && box === "inbox" && <span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-flame" />}
                    {box === "sent" ? `To: ${m.to.join(", ")}` : box === "team" ? `${m.sender_name} → ${m.to.join(", ")}` : m.sender_name}
                  </p>
                  <span className="shrink-0 text-[11px] text-ink-soft">{dt(m.created_at)}</span>
                </div>
                <p className={`truncate text-sm ${!m.read && box === "inbox" ? "font-bold" : ""}`}>{m.subject}{m.attachments.length > 0 && " 📎"}</p>
                <p className="truncate text-xs text-ink-soft">{m.body}</p>
              </button>
            </li>
          ))}
        </ul>
        <section className={`min-w-0 p-6 ${open ? "" : "hidden md:block"}`}>
          {!open ? <p className="grid h-full place-items-center text-sm text-ink-soft">Choose a message to read</p> : (
            <article>
              <button className="mb-3 text-sm font-semibold text-flame md:hidden" onClick={() => setOpen(null)}>← Back</button>
              <h2 className="font-display text-2xl font-extrabold">{open.subject}</h2>
              <div className="mt-2 flex flex-wrap items-center gap-x-3 text-sm text-ink-soft">
                <span><b className="text-ink">{open.sender_name}</b> → {open.to.join(", ")}</span><span>{new Date(open.created_at).toLocaleString()}</span>
              </div>
              <div className="mt-5 whitespace-pre-wrap text-[15px] leading-relaxed">{open.body}</div>
              {open.attachments.length > 0 && (
                <div className="mt-6">
                  <p className="mb-2 text-xs font-bold uppercase text-ink-soft">Attachments</p>
                  <div className="flex flex-wrap gap-2">
                    {open.attachments.map((a) => (
                      <a key={a.id} href={a.url} target="_blank" rel="noreferrer" className="flex items-center gap-2 rounded-xl bg-cream px-3 py-2 text-sm font-semibold ring-1 ring-ink/10 hover:ring-flame">
                        {/\.(png|jpe?g|gif|webp)$/i.test(a.name) ? "🖼" : /\.pdf$/i.test(a.name) ? "📄" : "📎"} {a.name}<span className="text-xs font-normal text-ink-soft">{kb(a.size)}</span>
                      </a>
                    ))}
                  </div>
                </div>
              )}
              <div className="mt-8 flex flex-wrap gap-2 border-t border-ink/10 pt-4">
                {box !== "sent" && box !== "team" && <button className="btn-primary !py-2" onClick={() => setCompose({ subject: open.subject.startsWith("Re:") ? open.subject : `Re: ${open.subject}`, reply_to: open.id, quote: open.sender_name })}>↩ Reply</button>}
                {box === "inbox" && <button className="btn-ghost !py-2" onClick={() => archive(open, true)}>🗄 Archive</button>}
                {box === "inbox" && <button className="btn-ghost !py-2" onClick={() => unread(open)}>Mark unread</button>}
                {box === "archived" && <button className="btn-ghost !py-2" onClick={() => archive(open, false)}>Move to inbox</button>}
              </div>
            </article>
          )}
        </section>
      </div>
      {compose && <Compose init={compose} replyToSender={open && compose.reply_to === open.id ? open.sender_name : null}
        onClose={() => setCompose(null)} onSent={() => { setCompose(null); setMsg("Message sent ✓"); if (box === "sent") list.reload(); }} />}
    </div>
  );
}

function Compose({ init, replyToSender, onClose, onSent }: {
  init: { to?: string[]; subject?: string; reply_to?: number }; replyToSender: string | null; onClose: () => void; onSent: () => void;
}) {
  const contacts = useLoad(() => manageApi.mailContacts(), []);
  const [to, setTo] = useState<string[]>(init.to ?? []);
  const [find, setFind] = useState("");
  const [subject, setSubject] = useState(init.subject ?? "");
  const [body, setBody] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // When replying, pre-select the sender.
  useEffect(() => {
    if (replyToSender && contacts.data && !to.length) {
      const p = contacts.data.people.find((x) => x.name === replyToSender);
      if (p) setTo([String(p.id)]);
    }
  }, [contacts.data, replyToSender, to.length]);

  const label = (id: string) => contacts.data?.groups.find((g) => g.id === id)?.name ?? contacts.data?.people.find((p) => String(p.id) === id)?.name ?? id;
  const matches = useMemo(() => {
    const f = find.toLowerCase();
    const groups = (contacts.data?.groups ?? []).map((g) => ({ id: g.id, name: g.name, sub: "Group" }));
    const people = (contacts.data?.people ?? []).map((p) => ({ id: String(p.id), name: p.name, sub: `${p.role}${p.branch ? ` · ${p.branch}` : ""}` }));
    return [...groups, ...people].filter((x) => !to.includes(x.id) && (!f || `${x.name} ${x.sub}`.toLowerCase().includes(f))).slice(0, 8);
  }, [contacts.data, find, to]);
  const total = files.reduce((s, f) => s + f.size, 0);

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!to.length) { setErr("Choose who to send it to."); return; }
    if (total > 15 * 1024 * 1024) { setErr("Attachments must be under 15 MB in total."); return; }
    setBusy(true); setErr(null);
    const fd = new FormData();
    to.forEach((t) => fd.append("to", t));
    fd.append("subject", subject); fd.append("body", body);
    if (init.reply_to) fd.append("reply_to", String(init.reply_to));
    files.forEach((f) => fd.append("attachments", f));
    try { await manageApi.sendMail(fd); onSent(); } catch (x) { setErr(x instanceof Error ? x.message : "Failed"); setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/50 p-4 sm:items-center" onClick={onClose}>
      <form onSubmit={send} onClick={(e) => e.stopPropagation()} className="w-full max-w-2xl rounded-3xl bg-cream p-6 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-display text-2xl font-extrabold">{init.reply_to ? "Reply" : "New message"}</h2>
          <button type="button" onClick={onClose} className="grid h-9 w-9 place-items-center rounded-full hover:bg-ink/10">✕</button>
        </div>
        <div className="rounded-xl border-2 border-ink/10 bg-white px-3 py-2 focus-within:border-flame">
          <div className="flex flex-wrap items-center gap-1">
            <span className="mr-1 text-sm font-semibold text-ink-soft">To</span>
            {to.map((t) => (
              <span key={t} className="flex items-center gap-1 rounded-full bg-ink px-2.5 py-1 text-xs font-semibold text-cream">
                {label(t)}<button type="button" onClick={() => setTo(to.filter((x) => x !== t))} aria-label="Remove">✕</button>
              </span>
            ))}
            <input className="min-w-40 flex-1 py-1 text-sm outline-none" placeholder={to.length ? "" : "Name, store or role…"} value={find} onChange={(e) => setFind(e.target.value)} />
          </div>
          {(find || !to.length) && matches.length > 0 && (
            <ul className="mt-2 max-h-48 overflow-y-auto border-t border-ink/10 pt-1">
              {matches.map((m) => (
                <li key={m.id}><button type="button" onClick={() => { setTo([...to, m.id]); setFind(""); }} className="flex w-full justify-between rounded-lg px-2 py-1.5 text-left text-sm hover:bg-cream">
                  <span className="font-semibold">{m.sub === "Group" ? "👥 " : ""}{m.name}</span><span className="text-xs text-ink-soft">{m.sub}</span></button></li>
              ))}
            </ul>
          )}
        </div>
        <input className="input mt-3 !py-2" placeholder="Subject" required maxLength={200} value={subject} onChange={(e) => setSubject(e.target.value)} />
        <textarea className="input mt-3 !py-2" rows={8} placeholder="Write your message…" required value={body} onChange={(e) => setBody(e.target.value)} />
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <label className="btn-ghost cursor-pointer !px-4 !py-2 text-sm">📎 Attach files
            <input type="file" multiple className="hidden" accept="image/*,application/pdf,.doc,.docx,.xls,.xlsx,.csv,.txt"
                   onChange={(e) => { setFiles([...files, ...Array.from(e.target.files ?? [])]); e.target.value = ""; }} />
          </label>
          {files.map((f, i) => (
            <span key={i} className="flex items-center gap-1 rounded-full bg-white px-3 py-1 text-xs font-semibold ring-1 ring-ink/10">
              {f.name} <span className="text-ink-soft">{kb(f.size)}</span><button type="button" onClick={() => setFiles(files.filter((_, j) => j !== i))}>✕</button>
            </span>
          ))}
        </div>
        <ErrorBox error={err} />
        <div className="mt-4 flex items-center justify-between">
          <span className="text-xs text-ink-soft">Up to 15 MB of attachments</span>
          <button className="btn-primary" disabled={busy}>{busy ? "Sending…" : "Send"}</button>
        </div>
      </form>
    </div>
  );
}
