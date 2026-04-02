import Link from "next/link";
import { updateClientMessageStatusAction } from "@/app/admin/(private)/actions";
import { listClientMessages } from "@/lib/client-messages/client-message-service";

type SearchParams = Promise<{ error?: string; view?: string }>;

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("en-BE", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export default async function AdminInboxPage({ searchParams }: { searchParams: SearchParams }) {
  const { error, view } = await searchParams;
  const mailboxView = view === "spam" ? "spam" : "inbox";
  const returnTo = mailboxView === "spam" ? "/admin/inbox?view=spam" : "/admin/inbox";

  try {
    const messages = await listClientMessages({
      limit: 50,
      mailbox: mailboxView === "spam" ? "SPAM" : "INBOX",
    });

    return (
      <section className="space-y-4">
        <header>
          <h1 className="text-2xl font-semibold text-[#1f2735]">Inbox</h1>
          <p className="mt-1 text-sm text-[#4b5a72]">Unified client messages from contact and booking note flows.</p>
          <div className="mt-3 flex items-center gap-2">
            <Link
              href="/admin/inbox"
              className={`rounded-md border px-3 py-1 text-xs ${
                mailboxView === "inbox"
                  ? "border-[#1f2735] bg-[#1f2735] text-white"
                  : "border-[#d3dbe5] bg-white text-[#1f2735]"
              }`}
            >
              Inbox
            </Link>
            <Link
              href="/admin/inbox?view=spam"
              className={`rounded-md border px-3 py-1 text-xs ${
                mailboxView === "spam"
                  ? "border-[#7b2d2d] bg-[#7b2d2d] text-white"
                  : "border-[#d3dbe5] bg-white text-[#1f2735]"
              }`}
            >
              Spam
            </Link>
          </div>
        </header>

        {error ? <p className="text-sm text-[#7b2d2d]">{error}</p> : null}

        <section className="rounded-xl border border-[#d3dbe5] bg-white p-4">
          {messages.length === 0 ? (
            <p className="text-sm text-[#4b5a72]">No client messages yet.</p>
          ) : (
            <ul className="space-y-2">
              {messages.map((message) => (
                <li key={message.id} className="rounded-md border border-[#e2e8f0] p-3 text-sm text-[#334155]">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-medium">
                      {message.type} - {message.name} ({message.email})
                    </p>
                    <form action={updateClientMessageStatusAction} className="flex items-center gap-2">
                      <input type="hidden" name="id" value={message.id} />
                      <input type="hidden" name="returnTo" value={returnTo} />
                      <select
                        name="status"
                        defaultValue={message.status}
                        className="rounded-md border border-[#d3dbe5] bg-white px-2 py-1 text-xs"
                      >
                        <option value="NEW">NEW</option>
                        <option value="READ">READ</option>
                        <option value="ARCHIVED">ARCHIVED</option>
                      </select>
                      <button
                        type="submit"
                        className="rounded-md border border-[#d3dbe5] px-2 py-1 text-xs text-[#1f2735] hover:bg-[#f3f6fb]"
                      >
                        Update
                      </button>
                    </form>
                  </div>
                  {message.bookingId ? <p className="mt-1 text-xs text-[#5a6d86]">Booking ID: {message.bookingId}</p> : null}
                  {message.phone ? <p className="mt-1 text-xs text-[#5a6d86]">Phone: {message.phone}</p> : null}
                  {message.subject ? <p className="mt-1 text-xs text-[#5a6d86]">Subject: {message.subject}</p> : null}
                  {message.spamReason ? <p className="mt-1 text-xs text-[#7b2d2d]">Spam reason: {message.spamReason}</p> : null}
                  <p className="mt-2">{message.message}</p>
                  <p className="mt-2 text-xs text-[#5a6d86]">{formatDateTime(message.createdAt.toISOString())}</p>
                </li>
              ))}
            </ul>
          )}
        </section>
      </section>
    );
  } catch {
    return (
      <section className="rounded-xl border border-[#d3dbe5] bg-white p-6">
        <h1 className="text-2xl font-semibold text-[#1f2735]">Inbox</h1>
        <p className="mt-2 text-sm text-[#7b2d2d]">Unable to load client messages right now.</p>
      </section>
    );
  }
}

