import { test } from "node:test";
import assert from "node:assert/strict";
import { parseAddressList, stripQuoted, worthClassifying, lastDateFor, simplifyMessage, type SimpleThread, type SimpleMessage } from "../lib/gmail.ts";

const owner = "noahgold100@gmail.com";
const msg = (p: Partial<SimpleMessage>): SimpleMessage => ({ id: "m", date: new Date("2026-10-01"), from: { name: "", email: "x@y.com" }, to: [], cc: [], subject: "s", body: "", automated: false, ...p });
const thread = (messages: SimpleMessage[]): SimpleThread => ({ id: "t", lastMessageId: "m", subject: "s", messages });

test("parses names with commas and plain addresses", () => {
  assert.deepEqual(parseAddressList('"Doe, Jane" <Jane@Prod.com>, bob@x.io, Sam Lee <sam@lee.co>'), [
    { name: "Doe, Jane", email: "jane@prod.com" },
    { name: "", email: "bob@x.io" },
    { name: "Sam Lee", email: "sam@lee.co" },
  ]);
  assert.deepEqual(parseAddressList("undisclosed-recipients:;"), []);
});

test("strips quoted history", () => {
  const t = "Sounds great, send it over.\n\nOn Mon, Oct 5, 2026 at 3:12 PM Noah Gold <noahgold100@gmail.com> wrote:\n> Here is the script";
  assert.equal(stripQuoted(t), "Sounds great, send it over.");
  assert.equal(stripQuoted("Hi\n> old\nThanks"), "Hi\nThanks");
});

test("keeps threads Noah wrote in, or personal mail to him", () => {
  const out = thread([msg({ from: { name: "Noah", email: owner }, to: [{ name: "J", email: "j@prod.com" }] })]);
  assert.equal(worthClassifying(out, [owner], []), true);
  const inbound = thread([msg({ from: { name: "J", email: "j@prod.com" }, to: [{ name: "", email: owner }] })]);
  assert.equal(worthClassifying(inbound, [owner], []), true);
});

test("skips bulk mail, notes to self, and do-not-track", () => {
  const bulk = thread([msg({ from: { name: "", email: "news@festival.org" }, automated: true })]);
  assert.equal(worthClassifying(bulk, [owner], []), false);
  const self = thread([msg({ from: { name: "", email: owner }, to: [{ name: "", email: owner }] })]);
  assert.equal(worthClassifying(self, [owner], []), false);
  const blocked = thread([msg({ from: { name: "", email: "mom@family.com" }, to: [{ name: "", email: owner }] })]);
  assert.equal(worthClassifying(blocked, [owner], ["family.com"]), false);
});

test("keeps Calendly booking emails even though they're automated", () => {
  const cal = thread([msg({ from: { name: "Calendly", email: "notifications@calendly.com" }, automated: true })]);
  assert.equal(worthClassifying(cal, [owner], []), true);
});

test("last date is per person", () => {
  const t = thread([
    msg({ date: new Date("2026-09-01"), from: { name: "", email: "a@x.com" }, to: [{ name: "", email: owner }] }),
    msg({ date: new Date("2026-09-20"), from: { name: "", email: owner }, to: [{ name: "", email: "b@x.com" }] }),
  ]);
  assert.equal(lastDateFor(t, "a@x.com")!.toISOString().slice(0, 10), "2026-09-01");
  assert.equal(lastDateFor(t, "b@x.com")!.toISOString().slice(0, 10), "2026-09-20");
});

test("simplifies a Gmail API message and flags bulk", () => {
  const b64 = (s: string) => Buffer.from(s).toString("base64url");
  const m = simplifyMessage({
    id: "1",
    internalDate: String(Date.parse("2026-10-10T12:00:00Z")),
    payload: {
      headers: [
        { name: "From", value: "Jane Doe <jane@prod.com>" },
        { name: "To", value: "noahgold100@gmail.com" },
        { name: "Subject", value: "Morpho" },
      ],
      mimeType: "multipart/alternative",
      parts: [
        { mimeType: "text/plain", body: { data: b64("Loved Morpho. Can we talk Thursday?") } },
        { mimeType: "text/html", body: { data: b64("<p>Loved Morpho.</p>") } },
      ],
    },
  });
  assert.equal(m.body, "Loved Morpho. Can we talk Thursday?");
  assert.equal(m.automated, false);
  assert.equal(m.from.email, "jane@prod.com");
  const n = simplifyMessage({ id: "2", payload: { headers: [{ name: "From", value: "no-reply@x.com" }, { name: "List-Unsubscribe", value: "<mailto:u@x.com>" }], mimeType: "text/html", body: { data: b64("<b>Sale</b>") } } });
  assert.equal(n.automated, true);
  assert.equal(n.body, "Sale");
});
