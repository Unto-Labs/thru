/**
 * Checks of the connection driver on a scripted transport (plan B2): the two
 * recorded conversations of `contrib/test/vectors/trezor/host_vectors.json`
 * played through the driver byte for byte, and the faults the file does not
 * hold (a lost acknowledgement, a busy answer, duplicates, other channels'
 * packets, an over-long declared length, button requests without end, the
 * four guards, an abort). Like `vector-checks.ts` it takes the package's API
 * as an argument and uses no Node API: the same code runs under vitest in Node
 * and, bundled, in a page in Chromium, against the built browser bundle.
 */
import { loadAppWithoutModelCheck } from '../extapp';
import { unitCases } from './unit-checks';
import {
  bufferOf,
  buildFrame,
  Conversation,
  errorFrame,
  FakeClock,
  FreeDevice,
  macrotask,
  newCheck,
  randomValuesOf,
  runVirtual,
  samePackets,
  ScriptedTransport,
  scriptRandom,
  stepsOf,
  type Case,
  type CaseResult,
  type ConversationOptions,
  type Ctx,
  type DeviceMessage,
  type Step,
} from './driver-support';
import type { AppImage, ExtAppLoad, ExtAppMessage, Link, TrezorClient, TrezorUi } from '../index';
import type { Api, Frame as VFrame, Scenario, Vectors } from './vector-checks';

export type { Case, CaseResult, Check } from './driver-support';

// ---- helpers over the vector file ----

const scenarioOf = (v: Vectors, name: string): Scenario => {
  const found = v.handshake.scenarios.find((s) => s.name === name);
  if (!found) throw new Error(`no scenario ${name}`);
  return found;
};
const PAIR = 'pair_by_code_entry';
const RECONNECT = 'reconnect_with_credential';

const allFrames = (sc: Scenario): VFrame[] => [...sc.handshake_frames, ...sc.conversation_frames];

type Obj = { [key: string]: never };

/** Captured messages of a scenario, in order, one entry per message. */
function captured(v: Vectors, scenario: string, name: string, direction?: 'host' | 'device'): Obj[] {
  return (v.messages.captured as unknown as Record<string, unknown>[]).filter(
    (c) =>
      c.scenario === scenario &&
      c.name === name &&
      (direction === undefined || c.direction === (direction === 'host' ? 'host_to_device' : 'device_to_host')),
  ) as unknown as Obj[];
}

const fieldsOf = (entry: Obj): Record<string, never> => (entry as unknown as { fields: Record<string, never> }).fields;

/** The path of the vectors: `44'/8478'/0'/0'`. */
const PATH = [0x8000002c, 0x8000211e, 0x80000000, 0x80000000];

type Recorded = {
  clock: FakeClock;
  transport: ScriptedTransport;
  conversation: Conversation;
};

function replayOf(_api: Api, steps: Step[], options: ConversationOptions = {}): Recorded {
  const clock = new FakeClock();
  const transport = new ScriptedTransport(clock, () => undefined);
  const conversation = new Conversation(steps, options);
  conversation.attach(transport);
  return { clock, transport, conversation };
}

function recordOf(api: Api, sc: Scenario): { trezorStaticPubkey: Uint8Array; hostStaticPrivkey: Uint8Array; credential: Uint8Array } {
  const c = sc.inputs.stored_credential;
  if (!c) throw new Error('the scenario has no stored credential');
  return {
    trezorStaticPubkey: api.fromHex(c.trezor_static_pubkey),
    hostStaticPrivkey: api.fromHex(c.host_static_privkey),
    credential: api.fromHex(c.credential),
  };
}

type UiLog = { calls: string[] };

function uiOf(code: string | (() => string | Promise<string>), log: UiLog = { calls: [] }): { ui: TrezorUi; log: UiLog } {
  return {
    log,
    ui: {
      pairingCode: () => (typeof code === 'string' ? code : code()),
      confirmOnDevice: () => void log.calls.push('confirm'),
      enterPassphraseOnDevice: () => void log.calls.push('passphrase'),
    },
  };
}

/** The image of the recorded load exchange, rebuilt from the captured messages. */
function imageOf(api: Api, v: Vectors) {
  const load = fieldsOf(captured(v, PAIR, 'ExtAppLoad', 'host')[0]) as unknown as {
    id: string;
    version: { major: number; minor: number; patch: number; build: number };
    fingerprint: string;
  };
  const ack = fieldsOf(captured(v, PAIR, 'ExtAppHeaderAck', 'host')[0]) as unknown as {
    header: string;
    proof: string;
    root_packet_timestamp: string;
  };
  const root = fieldsOf(captured(v, PAIR, 'ExtAppRootPacketAck', 'host')[0]) as unknown as { root_packet: string };
  const chunks = captured(v, PAIR, 'ExtAppDataChunkAck', 'host').map((c) => {
    const f = fieldsOf(c) as unknown as { data: string; hash: string };
    return { data: api.fromHex(f.data), hash: api.fromHex(f.hash) };
  });
  const image: AppImage = {
    id: load.id,
    version: [load.version.major, load.version.minor, load.version.patch, load.version.build],
    appRing: 2,
    header: api.fromHex(ack.header),
    proof: api.fromHex(ack.proof),
    rootPacket: api.fromHex(root.root_packet),
    rootPacketTimestamp: BigInt(ack.root_packet_timestamp),
    chunks,
  };
  return { image, fingerprint: load.fingerprint };
}

/** Everything after a recorded conversation: the transport and the conversation must have been used up. */
function finish(ctx: Ctx, w: Recorded, steps: Step[], what: string, unread = 0): void {
  const { t } = ctx;
  t.eq(`${what}: no host packet differs from the file`, [], w.conversation.mismatches);
  t.ok(`${what}: every frame of the recording was played`, w.conversation.finished, `at ${w.conversation.position} of ${steps.length}`);
  t.eq(`${what}: no packet of the device is left unread`, unread, w.transport.unread);
  t.eq(
    `${what}: the host wrote as many packets as the file has`,
    steps.filter((s) => s.direction === 'host_to_device').reduce((n, s) => n + s.packets.length, 0),
    w.transport.written.length -
      w.conversation.retransmissions.reduce((n, f) => n + f.length, 0) -
      w.conversation.repeatedAcks -
      w.conversation.interceptedPackets,
  );
  t.eq(`${what}: one read outstanding at a time`, 0, w.transport.overlappingReads);
}

// ---- 1. the recorded conversations through the driver ----

type ReplayOptions = {
  scenario: string;
  /** Records in the store before connecting. */
  seed?: { trezorStaticPubkey: Uint8Array; hostStaticPrivkey: Uint8Array; credential: Uint8Array }[];
  conversation?: ConversationOptions;
  allowSkipPairing?: boolean;
  emulator?: boolean;
  /** Text of a step to name the replay. */
  what: string;
  /** The last device frame was sent twice: its copy is left unread. */
  lastCopyUnread?: boolean;
  /** Looks at the connection and the replay before they are closed. */
  inspect?: (client: TrezorClient, w: Recorded) => void;
};

async function replayWhole(ctx: Ctx, options: ReplayOptions): Promise<void> {
  const { api, v, t } = ctx;
  const sc = scenarioOf(v, options.scenario);
  const steps = stepsOf(api, allFrames(sc));
  const w = replayOf(api, steps, options.conversation);
  w.transport.isEmulator = options.emulator === true;
  const random = scriptRandom(api, randomValuesOf(api, sc));
  const store = new api.MemoryCredentialStore();
  const reconnect = options.scenario === RECONNECT;
  for (const record of options.seed ?? (reconnect ? [recordOf(api, sc)] : [])) await store.store(record);
  const pairing = sc.inputs.pairing as { code: string } | undefined;
  const { ui, log } = uiOf(pairing?.code ?? 'no code is typed in this scenario');
  const what = options.what;
  let client: TrezorClient | undefined;
  try {
    client = await runVirtual(
      w.clock,
      api.TrezorClient.connect(w.transport, {
        hostName: 'vector-host',
        appName: 'thru',
        credentialStore: store,
        ui,
        passphraseOnDevice: reconnect,
        allowSkipPairing: options.allowSkipPairing,
        clock: w.clock,
      }),
    );
    t.eq(`${what}: device properties`, 'T3W1', client.properties.internalModel);
    t.eq(`${what}: protocol version`, [2, 1], client.properties.protocolVersion);

    const { image, fingerprint } = imageOf(api, v);
    t.eq(`${what}: fingerprint of the image header`, fingerprint, api.toHex(api.appFingerprint(image)));
    // The recorded image is made up: its header names no model, so it is loaded without the check of the model, which the package does not export (the check is tested on its own).
    const result = await runVirtual(w.clock, loadAppWithoutModelCheck(client, image));
    const loaded = { ...result, app: api.ThruApp.attach(client, result.instanceId) };
    t.eq(`${what}: the app is uploaded only when the device lacks it`, !reconnect, loaded.uploaded);
    t.eq(`${what}: instance id`, 3, loaded.instanceId);

    const key = captured(v, options.scenario, 'PublicKey', 'device')[0];
    const request = fieldsOf(captured(v, options.scenario, 'GetPublicKey', 'host')[0]) as unknown as {
      address_n: number[];
      show_display: boolean;
    };
    t.eq(`${what}: the path`, PATH, request.address_n);
    const pub = await runVirtual(w.clock, loaded.app.getPublicKey(request.address_n, { showOnDevice: request.show_display }));
    const wantKey = fieldsOf(key) as unknown as { public_key: string; address: string };
    t.eq(`${what}: public key`, wantKey.public_key, api.toHex(pub.publicKey));
    t.eq(`${what}: address`, wantKey.address, pub.address);

    if (!reconnect) {
      // `SignMessage` and `SignEoaAuth` are the next phase's requests: the
      // recorded bytes are sent through the generic call.
      for (const name of ['SignMessage', 'SignEoaAuth']) {
        const entry = captured(v, PAIR, 'ExtAppMessage', 'host').find(
          (m) => (fieldsOf(m) as unknown as { message_id: number }).message_id === (api.codecByName(name)?.id ?? -1),
        );
        const message = api.fieldsFromJson(api.ExtAppMessage as never, fieldsOf(entry as Obj) as never) as ExtAppMessage;
        const answer = await runVirtual(
          w.clock,
          client.call(api.ExtAppMessage, message, api.ExtAppResponse),
        );
        t.ok(`${what}: ${name} is answered`, answer.data.length > 0);
      }
      const signs = captured(v, PAIR, 'SignTx', 'host');
      const acks = captured(v, PAIR, 'TxDataAck', 'host');
      const signatures = captured(v, PAIR, 'TxSignature', 'device');
      let used = 0;
      for (let i = 0; i < signs.length; i++) {
        const f = fieldsOf(signs[i]) as unknown as { body_size: number; token_hint?: string };
        const parts: Uint8Array[] = [];
        let size = 0;
        while (size < f.body_size) {
          const piece = api.fromHex((fieldsOf(acks[used++]) as unknown as { data: string }).data);
          parts.push(piece);
          size += piece.length;
        }
        const body = new Uint8Array(size);
        let at = 0;
        for (const p of parts) {
          body.set(p, at);
          at += p.length;
        }
        const signature = await runVirtual(
          w.clock,
          loaded.app.signTransaction(PATH, body, { tokenHint: f.token_hint ? api.fromHex(f.token_hint) : undefined }),
        );
        t.eq(
          `${what}: signature ${i} (${f.body_size} bytes${f.token_hint ? ', token hint' : ''})`,
          (fieldsOf(signatures[i]) as unknown as { signature: string }).signature,
          api.toHex(signature),
        );
      }
      const stored = await store.load();
      const issued = recordOf(api, scenarioOf(v, RECONNECT));
      t.eq(`${what}: one credential is stored`, 1, stored.length);
      t.eq(`${what}: the stored device key`, api.toHex(issued.trezorStaticPubkey), api.toHex(stored[0].trezorStaticPubkey));
      t.eq(`${what}: the stored host key`, api.toHex(issued.hostStaticPrivkey), api.toHex(stored[0].hostStaticPrivkey));
      t.eq(`${what}: the stored credential`, api.toHex(issued.credential), api.toHex(stored[0].credential));
      t.eq(`${what}: the person is asked to confirm once, for the message`, ['confirm'], log.calls);
    } else {
      t.eq(`${what}: the passphrase is typed on the device`, ['passphrase'], log.calls.slice(0, 1));
    }
    options.inspect?.(client, w);
  } finally {
    random.restore();
    if (client) await client.close();
  }
  // A repeated last frame of the device may be left unread: the host has what it needs.
  const lastDevice = [...steps].reverse().find((s) => s.direction === 'device_to_host');
  finish(ctx, w, steps, what, options.lastCopyUnread && lastDevice ? lastDevice.packets.length : 0);
  t.eq(`${what}: the transport is closed once`, 1, w.transport.closeCalls);
}

// ---- 2. faults ----

/** The link after the handshake of the reconnect scenario, and the frames that follow it. */
async function reconnectLink(ctx: Ctx, w: Recorded) {
  const { api, v } = ctx;
  const sc = scenarioOf(v, RECONNECT);
  const random = scriptRandom(api, randomValuesOf(api, sc));
  try {
    return await runVirtual(
      w.clock,
      api.Link.open(w.transport, { clock: w.clock, knownCredentials: [recordOf(api, sc)] }),
    );
  } finally {
    random.restore();
  }
}

/** Recorded frames 0..10 of the reconnect scenario: the handshake, `ThpEndRequest`, its acknowledgement and answer, our acknowledgement. */
const ENDEXCHANGE = 11;

async function endExchange(ctx: Ctx, w: Recorded, link: Link): Promise<DeviceMessageLike> {
  const { api } = ctx;
  await runVirtual(w.clock, link.send(0, api.ThpEndRequest.id as number, api.ThpEndRequest.encode({})));
  return runVirtual(w.clock, link.receive(5000, 'the answer'));
}

type DeviceMessageLike = { session: number; messageType: number; payload: Uint8Array };

function retransmitSchedule(api: Api): number {
  // The number of retransmissions of a message that is never acknowledged:
  // one after each wait, until the budget is spent.
  let now = 0;
  let retry = 0;
  let count = 0;
  for (;;) {
    now += api.retransmitAfterMs(retry);
    if (now > api.ACK_BUDGET_MS) return count;
    retry++;
    count++;
  }
}

const cases: Case[] = [...unitCases];
const add = (group: string, name: string, run: (ctx: Ctx) => Promise<void>): void => void cases.push({ group, name, run });

// ---- recorded conversations ----

add('recorded conversations', `${PAIR}: connect, load, public key, message, authorization, two transactions`, (ctx) =>
  replayWhole(ctx, { scenario: PAIR, what: PAIR }),
);
add('recorded conversations', `${RECONNECT}: stored credential, passphrase on the device, app held, public key`, (ctx) =>
  replayWhole(ctx, { scenario: RECONNECT, what: RECONNECT }),
);
add('recorded conversations', `${PAIR}: asking for skipped pairing on a device transport changes nothing`, (ctx) =>
  replayWhole(ctx, { scenario: PAIR, allowSkipPairing: true, what: 'skip asked, not emulator' }),
);
add('recorded conversations', `${PAIR}: asking for skipped pairing on an emulator whose device offers none changes nothing`, (ctx) =>
  replayWhole(ctx, { scenario: PAIR, allowSkipPairing: true, emulator: true, what: 'skip asked, emulator, no skip offered' }),
);

// ---- scripted faults ----

add('faults', 'a lost acknowledgement: the retransmission is the same bytes, once, after 200 ms', async (ctx) => {
  const { api, t } = ctx;
  const steps = stepsOf(api, allFrames(scenarioOf(ctx.v, RECONNECT)).slice(0, ENDEXCHANGE));
  const w = replayOf(api, steps, {
    retransmits: true,
    // The device took the message and answered; the acknowledgement and the
    // answer are lost. They come when the message comes again.
    device: (step) => (step.frame.index === 8 || step.frame.index === 9 ? 'hold' : step.packets),
  });
  const link = await reconnectLink(ctx, w);
  const answer = await endExchange(ctx, w, link);
  t.eq('the answer is ThpEndResponse', api.ThpEndResponse.id, answer.messageType);
  t.eq('one retransmission', 1, link.stats.retransmissions);
  t.eq('the conversation saw one retransmission', 1, w.conversation.retransmissions.length);
  t.ok('the retransmission is byte-identical to the first send', samePackets(w.conversation.retransmissions[0], steps[7].packets));
  const sends = w.transport.written.map((p, i) => ({ p, at: w.transport.writeTimes[i] })).filter((x) => x.p[0] === 0x0c);
  t.eq('the retransmission follows after 200 ms', 200, sends[1].at - sends[0].at);
  finish(ctx, w, steps, 'lost acknowledgement');
  t.ok('a timeout does not abandon the read: no read is started for it', w.transport.readCalls <= w.transport.delivered + 1, `${w.transport.readCalls} reads, ${w.transport.delivered} packets`);
  await link.close();
});

add('faults', 'an acknowledgement that never comes: bounded retransmissions of the same bytes, then an error that says the outcome is unknown', async (ctx) => {
  const { api, t } = ctx;
  const steps = stepsOf(api, allFrames(scenarioOf(ctx.v, RECONNECT)).slice(0, 8));
  const w = replayOf(api, steps, { retransmits: true });
  const link = await reconnectLink(ctx, w);
  const error = await t.rejects(
    'the send fails',
    runVirtual(w.clock, link.send(0, api.ThpEndRequest.id as number, api.ThpEndRequest.encode({}))),
  );
  t.ok('a timeout of the acknowledgement', error instanceof api.TrezorTimeoutError && error.kind === 'ack', String(error));
  t.eq('the outcome is unknown', true, (error as { outcomeUnknown?: boolean }).outcomeUnknown);
  const expected = retransmitSchedule(api);
  t.eq('the retransmissions follow the schedule until the budget is spent', expected, link.stats.retransmissions);
  t.ok('and are bounded', link.stats.retransmissions <= api.MAX_RETRANSMISSIONS && expected > 0);
  t.ok('every retransmission is the first send, byte for byte', w.conversation.retransmissions.every((f) => samePackets(f, steps[7].packets)));
  t.ok('the link is closed', link.isClosed);
  t.eq('the transport was closed', 1, w.transport.closeCalls);
});

const BUSY = 1;

add('faults', 'a busy answer: back-off 100 ms then 200 ms, the same bytes each time, then the exchange goes on', async (ctx) => {
  const { api, t } = ctx;
  const sc = scenarioOf(ctx.v, RECONNECT);
  const steps = stepsOf(api, allFrames(sc).slice(0, ENDEXCHANGE));
  let busy = 0;
  const times: number[] = [];
  const same: boolean[] = [];
  const channel = api.fromHex(sc.inputs.channel_id);
  const w: Recorded = replayOf(api, steps, {
    intercept: (packets, conversation) => {
      if (!samePackets(packets, steps[7].packets) || busy >= 2) return false;
      busy++;
      times.push(conversation.transport.writeTimes[conversation.transport.writeTimes.length - 1]);
      same.push(samePackets(packets, steps[7].packets));
      conversation.transport.push(errorFrame(api, channel, BUSY));
      return true;
    },
  });
  const link = await reconnectLink(ctx, w);
  const answer = await endExchange(ctx, w, link);
  t.eq('the answer arrives after the busy answers', api.ThpEndResponse.id, answer.messageType);
  t.eq('two busy back-offs', 2, link.stats.busyBackoffs);
  t.eq('the third send comes 100 ms + 200 ms after the first', [0, 100], [0, times[1] - times[0]]);
  const sends = w.transport.written.map((p, i) => ({ p, at: w.transport.writeTimes[i] })).filter((x) => x.p[0] === 0x0c);
  t.eq('three sends of the message', 3, sends.length);
  t.eq('wait before the second send', 100, sends[1].at - sends[0].at);
  t.eq('wait before the third send', 200, sends[2].at - sends[1].at);
  t.ok('every send is the same bytes', same.every(Boolean) && sends.every((s) => s.p.every((x, i) => x === sends[0].p[i])));
  finish(ctx, w, steps, 'busy');
  await link.close();
});

add('faults', 'a busy answer during channel allocation and during the handshake: the request goes out again, the same bytes', async (ctx) => {
  const { api, v, t } = ctx;
  const sc = scenarioOf(v, RECONNECT);
  const steps = stepsOf(api, sc.handshake_frames);
  const ours = api.fromHex(sc.inputs.channel_id);
  for (const [index, channel, what] of [
    [0, new Uint8Array([0xff, 0xff]), 'the allocation request'],
    [2, ours, 'the handshake initiation'],
    [4, ours, 'the handshake completion'],
  ] as const) {
    let busy = 0;
    const w = replayOf(api, steps, {
      intercept: (packets, conversation) => {
        if (busy > 0 || !samePackets(packets, steps[index].packets)) return false;
        busy++;
        conversation.transport.push(errorFrame(api, channel, BUSY));
        return true;
      },
    });
    const random = scriptRandom(api, randomValuesOf(api, sc));
    try {
      const link = await runVirtual(w.clock, api.Link.open(w.transport, { clock: w.clock, knownCredentials: [recordOf(api, sc)] }));
      t.eq(`${what}: one back-off`, 1, link.stats.busyBackoffs);
      const sends = w.transport.written.map((p, i) => ({ p, at: w.transport.writeTimes[i] })).filter((x) => samePackets([x.p], [steps[index].packets[0]]));
      t.eq(`${what}: sent twice`, 2, sends.length);
      t.eq(`${what}: after 100 ms`, 100, sends[1].at - sends[0].at);
      t.eq(`${what}: the handshake completed`, 'paired', link.pairingState);
      finish(ctx, w, steps, what);
      await link.close();
    } finally {
      random.restore();
    }
  }
});

add('faults', 'a device that is busy for ever: bounded back-off, then an error a person can act on', async (ctx) => {
  const { api, t } = ctx;
  const sc = scenarioOf(ctx.v, RECONNECT);
  const steps = stepsOf(api, allFrames(sc).slice(0, 8));
  const channel = api.fromHex(sc.inputs.channel_id);
  const w: Recorded = replayOf(api, steps, {
    intercept: (packets, conversation) => {
      if (!samePackets(packets, steps[7].packets)) return false;
      conversation.transport.push(errorFrame(api, channel, BUSY));
      return true;
    },
  });
  const link = await reconnectLink(ctx, w);
  const started = w.clock.now();
  const error = await t.rejects(
    'the send fails',
    runVirtual(w.clock, link.send(0, api.ThpEndRequest.id as number, api.ThpEndRequest.encode({}))),
  );
  t.ok('a busy timeout', error instanceof api.TrezorTimeoutError && error.kind === 'busy', String(error));
  t.ok('the text says what to do', /close other Trezor programs/.test(String((error as Error).message)) && /reconnect/.test(String((error as Error).message)));
  t.eq('the device never took the message, so the outcome is known', false, (error as { outcomeUnknown?: boolean }).outcomeUnknown);
  t.ok('the wait is within the budget', w.clock.now() - started <= api.BUSY_POLICY.budgetMs, `${w.clock.now() - started} ms`);
  const sends = w.transport.written.filter((p) => p[0] === 0x0c).length;
  t.ok('and the number of sends is bounded', sends > 2 && sends < 100, `${sends} sends`);
  t.ok('the link is closed', link.isClosed);
});

add('faults', 'duplicated packets of the device are ignored: the whole recorded scenario through the client, every device frame twice', async (ctx) => {
  // A message delivered twice would break the calls; each repeated message is
  // acknowledged again with the bytes of the first acknowledgement.
  await replayWhole(ctx, {
    scenario: RECONNECT,
    what: 'every device frame twice',
    lastCopyUnread: true,
    conversation: { repeatedAcks: true, device: (step) => [...step.packets, ...step.packets] },
    inspect: (client, w) => {
      const { t } = ctx;
      const stats = client.channel.stats;
      t.ok('repeated messages were recognised', stats.duplicates > 0, String(stats.duplicates));
      t.eq('each was acknowledged again', stats.duplicates, w.conversation.repeatedAcks + 0);
      t.ok('repeated acknowledgements of the device were counted as strays', stats.strayAcks > 0);
    },
  });
});

add('faults', 'every device packet twice: the repeat count of the link is exact', async (ctx) => {
  const { api, t } = ctx;
  const sc = scenarioOf(ctx.v, RECONNECT);
  const steps = stepsOf(api, allFrames(sc).slice(0, ENDEXCHANGE));
  const w = replayOf(api, steps, { repeatedAcks: true, device: (step) => [...step.packets, ...step.packets] });
  const link = await reconnectLink(ctx, w);
  const answer = await endExchange(ctx, w, link);
  t.eq('the answer is delivered once', api.ThpEndResponse.id, answer.messageType);
  // Reading on takes in the copy of the answer; there is nothing to deliver.
  const error = await t.rejects('and nothing else is waiting to be delivered', runVirtual(w.clock, link.receive(1000, 'a second copy')));
  t.ok('the wait ends in a timeout, not in a second delivery', error instanceof api.TrezorTimeoutError, String(error));
  // Duplicates: the completion response and the answer, each acknowledged again.
  t.eq('two repeated messages were recognised', 2, link.stats.duplicates);
  t.eq('each was acknowledged again, with the same bytes as the first acknowledgement', 2, w.conversation.repeatedAcks);
  t.ok('the repeated acknowledgement of the device is not taken for a new one', link.stats.strayAcks >= 1);
});

add('faults', 'packets of other channels and other nonces are ignored', async (ctx) => {
  const { api, t } = ctx;
  const sc = scenarioOf(ctx.v, RECONNECT);
  const ours = api.fromHex(sc.inputs.channel_id);
  const other = new Uint8Array([0x99, 0x99]);
  const noise = (): Uint8Array[] => {
    // A first packet of another channel that declares the largest length, a
    // continuation of it, a whole valid acknowledgement of it, and an
    // allocation response on the broadcast channel with another nonce.
    const huge = new Uint8Array(64);
    huge.set([0x04, other[0], other[1], 0xff, 0xff]);
    const cont = new Uint8Array(64);
    cont.set([0x80, other[0], other[1]]);
    const ack = api.splitFrame(buildFrame(api, 0x28, other, new Uint8Array(0)));
    const strangerNonce = new Uint8Array(8).fill(0x5a);
    const props = api.ThpDeviceProperties.encode({
      internal_model: 'T3W1',
      protocol_version_major: 2,
      protocol_version_minor: 1,
      pairing_methods: [2],
    });
    const body = new Uint8Array(8 + 2 + props.length);
    body.set(strangerNonce);
    body.set([0x77, 0x77], 8);
    body.set(props, 10);
    const allocation = api.splitFrame(buildFrame(api, 0x41, new Uint8Array([0xff, 0xff]), body));
    void ours;
    return [huge, cont, ...ack, ...allocation];
  };
  await replayWhole(ctx, {
    scenario: RECONNECT,
    what: 'noise before every device frame',
    conversation: {
      device: (step) => {
        // Noise before the frame, and, inside a frame of two or more packets, between its packets.
        const [first, ...rest] = step.packets;
        return [...noise(), first, ...noise().slice(0, 2), ...rest];
      },
    },
    inspect: (client) => {
      const stats = client.channel.stats;
      t.ok('packets of other channels were ignored', stats.otherChannel > 0, String(stats.otherChannel));
    },
  });
  void t;
});

add('faults', 'a declared length over the bound is a protocol error; the bound itself is not', async (ctx) => {
  const { api, t } = ctx;
  const sc = scenarioOf(ctx.v, RECONNECT);
  const ours = api.fromHex(sc.inputs.channel_id);
  const steps = stepsOf(api, allFrames(sc).slice(0, 7));
  const first = (length: number): Uint8Array => {
    const p = new Uint8Array(64);
    p.set([0x04, ours[0], ours[1], length >> 8, length & 0xff]);
    return p;
  };
  const at = async (length: number): Promise<{ error: unknown; link: Link }> => {
    const w = replayOf(api, steps);
    const link = await reconnectLink(ctx, w);
    w.transport.push([first(length)]);
    let error: unknown;
    try {
      await runVirtual(w.clock, link.receive(1000, 'a message'));
    } catch (e) {
      error = e;
    }
    return { error, link };
  };
  const over = await at(api.MAX_INBOUND_LENGTH + 1);
  t.ok('over the bound: a protocol error', over.error instanceof api.TrezorProtocolError, String(over.error));
  t.ok('that names the declared length', /declared a message of 8193 bytes/.test(String((over.error as Error)?.message)));
  t.ok('and ends the link', over.link.isClosed);
  const edge = await at(api.MAX_INBOUND_LENGTH);
  t.ok('at the bound the frame is waited for, and the wait times out', edge.error instanceof api.TrezorTimeoutError, String(edge.error));
  const tiny = await at(3);
  t.ok('a length too small for a checksum is dropped, not buffered', tiny.error instanceof api.TrezorTimeoutError, String(tiny.error));
});

add('faults', 'a corrupted checksum is ignored and the repeat is taken', async (ctx) => {
  const { api, t } = ctx;
  const sc = scenarioOf(ctx.v, RECONNECT);
  const steps = stepsOf(api, allFrames(sc).slice(0, ENDEXCHANGE));
  const w = replayOf(api, steps, {
    device: (step) => {
      if (step.frame.index !== 9) return step.packets;
      const bad = step.packets.map((p) => p.slice());
      const last = 5 + step.frame.length - 1;
      if (last < 64) bad[0][last] ^= 1;
      else bad[1 + Math.floor((last - 64) / 61)][3 + ((last - 64) % 61)] ^= 1;
      return [...bad, ...step.packets];
    },
  });
  const link = await reconnectLink(ctx, w);
  const answer = await endExchange(ctx, w, link);
  t.eq('the intact copy is delivered', api.ThpEndResponse.id, answer.messageType);
  t.eq('the damaged copy was counted', 1, link.stats.badChecksum);
  finish(ctx, w, steps, 'corrupted checksum');
  await link.close();
});

// ---- a free device: what the recorded conversations do not hold ----

type Free = {
  w: Recorded;
  free: FreeDevice;
  clock: FakeClock;
  client: () => Promise<TrezorClient>;
  /** Runs `connect` on the device's transport with the options of the client of {@link Free.client}, on virtual time. */
  connectWith: <T>(connect: (transport: ScriptedTransport, options: ConnectionOptions) => Promise<T>) => Promise<T>;
  uiLog: UiLog;
};

type ConnectionOptions = {
  hostName: string;
  appName: string;
  credentialStore: InstanceType<Api['MemoryCredentialStore']>;
  ui: TrezorUi;
  clock: FakeClock;
  passphraseOnDevice?: boolean;
};

/**
 * The reconnect scenario's handshake through the client, and then a device the
 * test controls. `answer` decides what the device does with each message.
 */
function freeDevice(
  ctx: Ctx,
  answer: (message: DeviceMessage, index: number, free: FreeDevice) => { ack?: boolean; send?: DeviceMessage[] } | undefined,
  options: { passphraseOnDevice?: boolean; signal?: AbortSignal } = {},
): Free {
  const { api, v } = ctx;
  const sc = scenarioOf(v, RECONNECT);
  const steps = stepsOf(api, sc.handshake_frames);
  const clock = new FakeClock();
  const transport = new ScriptedTransport(clock, () => undefined);
  const device: { free?: FreeDevice } = {};
  const conversation = new Conversation(steps, { after: (packets) => device.free?.onHostFrame(packets) });
  conversation.attach(transport);
  const free: FreeDevice = new FreeDevice(api, sc, transport, (message, index): { ack?: boolean; send?: DeviceMessage[] } => {
    // The two requests of the client's own connection: end of pairing, session.
    if (message.type === api.ThpEndRequest.id) {
      return { send: [{ session: 0, type: api.ThpEndResponse.id as number, payload: api.ThpEndResponse.encode({}) }] };
    }
    if (message.type === api.ThpCreateNewSession.id) {
      return { send: [{ session: 1, type: api.Success.id as number, payload: api.Success.encode({}) }] };
    }
    return answer(message, index, free) ?? {};
  });
  device.free = free;
  const w: Recorded = { clock, transport, conversation };
  const { ui, log } = uiOf('000000');
  const connectWith: Free['connectWith'] = async (connect) => {
    const random = scriptRandom(api, randomValuesOf(api, sc));
    try {
      const store = new api.MemoryCredentialStore();
      await store.store(recordOf(api, sc));
      return await runVirtual(
        clock,
        connect(transport, {
          hostName: 'h',
          appName: 'a',
          credentialStore: store,
          ui,
          clock,
          passphraseOnDevice: options.passphraseOnDevice,
        }),
      );
    } finally {
      random.restore();
    }
  };
  return {
    w,
    free,
    clock,
    uiLog: log,
    client: () => connectWith((t, o) => api.TrezorClient.connect(t, o)),
    connectWith,
  };
}

const buttonRequest = (api: Api, code?: number): DeviceMessage => ({
  session: 1,
  type: api.ButtonRequest.id as number,
  payload: api.ButtonRequest.encode({ code }),
});

/** A call whose answer comes after `n` button requests. */
function buttons(ctx: Ctx, n: number): Free {
  const { api } = ctx;
  let asked = 0;
  return freeDevice(ctx, (message) => {
    if (message.type === api.ExtAppLoad.id) {
      asked = 1;
      return { send: [buttonRequest(api)] };
    }
    if (message.type === api.ButtonAck.id) {
      if (asked < n) {
        asked++;
        return { send: [buttonRequest(api, asked === 3 ? 19 : 1)] };
      }
      return {
        send: [{ session: 1, type: api.ExtAppLoaded.id as number, payload: api.ExtAppLoaded.encode({ instance_id: 3, version: { major: 0, minor: 1, patch: 1, build: 0 } }) }],
      };
    }
    return undefined;
  });
}

const loadRequest = (_api: Api): ExtAppLoad => ({
  id: 'thru.thru.org',
  version: { major: 0, minor: 1, patch: 1, build: 0 },
});

add('faults', '64 button requests are answered, the 65th ends the call', async (ctx) => {
  const { api, t } = ctx;
  const f = buttons(ctx, 64);
  const client = await f.client();
  const loaded = await runVirtual(f.clock, client.call(api.ExtAppLoad, loadRequest(api), api.ExtAppLoaded));
  t.eq('the answer after 64 button requests', 3, loaded.instance_id);
  const acks = f.free.received.filter((m) => m.type === api.ButtonAck.id).length;
  t.eq('64 acknowledgements were sent', 64, acks);
  t.eq('the person was told 64 times, once about the passphrase', 63, f.uiLog.calls.filter((c) => c === 'confirm').length);
  t.eq('the passphrase screen was named', 1, f.uiLog.calls.filter((c) => c === 'passphrase').length);
  await client.close();
});

add('faults', '65 button requests: the call is cut off at the bound and the connection is closed', async (ctx) => {
  const { api, t } = ctx;
  const f = buttons(ctx, 65);
  const client = await f.client();
  const error = await t.rejects(
    'the call fails',
    runVirtual(f.clock, client.call(api.ExtAppLoad, loadRequest(api), api.ExtAppLoaded)),
  );
  t.ok('an unexpected-answer error naming the bound', error instanceof api.TrezorUnexpectedError && /more than 64 confirmations/.test(String((error as Error).message)), String(error));
  t.eq('the 65th request was not acknowledged', 64, f.free.received.filter((m) => m.type === api.ButtonAck.id).length);
  t.eq('the outcome is unknown', true, (error as { outcomeUnknown?: boolean }).outcomeUnknown);
  t.ok('the connection is closed', client.isClosed);
  t.eq('the transport was closed', 1, f.w.transport.closeCalls);
});

add('faults', 'a message for another session is refused', async (ctx) => {
  const { api, t } = ctx;
  const f = freeDevice(ctx, (message) =>
    message.type === api.ExtAppLoad.id
      ? { send: [{ session: 9, type: api.ExtAppLoaded.id as number, payload: api.ExtAppLoaded.encode({ instance_id: 3, version: { major: 0, minor: 1, patch: 1 } }) }] }
      : undefined,
  );
  const client = await f.client();
  const error = await t.rejects('the call fails', runVirtual(f.clock, client.call(api.ExtAppLoad, loadRequest(api), api.ExtAppLoaded)));
  t.ok('an unexpected-answer error naming both sessions', error instanceof api.TrezorUnexpectedError && /for session 9, expected session 1/.test(String((error as Error).message)), String(error));
  t.ok('the connection is closed', client.isClosed);
});

add('faults', 'an abort during a call: an aborted error that says the outcome is unknown, nothing written after it, the connection closed', async (ctx) => {
  const { api, t } = ctx;
  const f = freeDevice(ctx, () => undefined); // acknowledges, never answers
  const client = await f.client();
  const controller = new AbortController();
  f.clock.setTimeout(() => controller.abort(), 1500);
  const call = client.call(api.ExtAppLoad, loadRequest(api), api.ExtAppLoaded, { signal: controller.signal });
  const error = await t.rejects('the call fails', runVirtual(f.clock, call));
  const written = f.w.transport.written.length;
  t.ok('an aborted error', error instanceof api.TrezorAbortedError, String(error));
  t.eq('the outcome is unknown', true, (error as { outcomeUnknown?: boolean }).outcomeUnknown);
  t.ok('the connection is closed', client.isClosed);
  t.eq('the transport was closed (the outstanding read cancelled)', 1, f.w.transport.closeCalls);
  await f.clock.fireNext();
  t.eq('nothing is written after the abort', written, f.w.transport.written.length);
  t.eq('the request went out once', 1, f.free.received.filter((m) => m.type === api.ExtAppLoad.id).length);
  t.eq('and was not sent again', 0, f.free.retransmittedFrames.length);
  await t.rejects('a later call finds the connection closed', client.call(api.ExtAppLoad, loadRequest(api), api.ExtAppLoaded));
});

add('faults', 'a signal that has fired before the call: nothing is sent, the connection stays', async (ctx) => {
  const { api, t } = ctx;
  const f = freeDevice(ctx, () => undefined);
  const client = await f.client();
  const before = f.w.transport.written.length;
  const controller = new AbortController();
  controller.abort();
  const error = await t.rejects(
    'the call fails',
    runVirtual(f.clock, client.call(api.ExtAppLoad, loadRequest(api), api.ExtAppLoaded, { signal: controller.signal })),
  );
  t.ok('an aborted error', error instanceof api.TrezorAbortedError);
  t.eq('the outcome is known: nothing was sent', false, (error as { outcomeUnknown?: boolean }).outcomeUnknown);
  t.eq('no packet was written', before, f.w.transport.written.length);
  t.ok('the connection is open', !client.isClosed);
  await client.close();
});

add('faults', 'a request that times out is not repeated: one request frame reaches the device', async (ctx) => {
  const { api, t } = ctx;
  const f = freeDevice(ctx, () => undefined);
  const client = await f.client();
  const error = await t.rejects(
    'the call times out',
    runVirtual(f.clock, client.call(api.ExtAppLoad, loadRequest(api), api.ExtAppLoaded)),
  );
  t.ok('a timeout waiting for the answer', error instanceof api.TrezorTimeoutError && error.kind === 'answer', String(error));
  t.eq('after the call timeout', true, f.clock.now() >= api.CALL_TIMEOUT_MS);
  t.eq('the outcome is unknown', true, (error as { outcomeUnknown?: boolean }).outcomeUnknown);
  t.eq('the request reached the device once', 1, f.free.received.filter((m) => m.type === api.ExtAppLoad.id).length);
  t.eq('without a retransmission', 0, f.free.retransmittedFrames.length);
  t.ok('the connection is closed', client.isClosed);
});

add('faults', 'calls are serialized: the second request waits for the first answer', async (ctx) => {
  const { api, t } = ctx;
  const order: string[] = [];
  const f = freeDevice(ctx, (message) => {
    if (message.type === api.ExtAppLoad.id) {
      order.push('load');
      return { send: [{ session: 1, type: api.ExtAppLoaded.id as number, payload: api.ExtAppLoaded.encode({ instance_id: 3, version: { major: 0, minor: 1, patch: 1 } }) }] };
    }
    if (message.type === api.ExtAppMessage.id) {
      order.push('message');
      return { send: [{ session: 1, type: api.ExtAppResponse.id as number, payload: api.ExtAppResponse.encode({ message_id: 1, data: new Uint8Array(0) }) }] };
    }
    return undefined;
  });
  const client = await f.client();
  const a = client.call(api.ExtAppLoad, loadRequest(api), api.ExtAppLoaded);
  const b = client.call(api.ExtAppMessage, { instance_id: 3, message_id: 0, data: new Uint8Array(0) }, api.ExtAppResponse);
  const [first, second] = await runVirtual(f.clock, Promise.all([a, b]));
  t.eq('the first answer', 3, first.instance_id);
  t.eq('the second answer', 1, second.message_id);
  t.eq('the device saw them in order', ['load', 'message'], order);
  // The second request is written after the host acknowledged the first answer.
  const controls = f.w.transport.written.map((p) => p[0]);
  const messageFrames = controls.map((c, i) => ({ c, i })).filter((x) => (x.c & 0xe7) === 0x04);
  const acks = controls.map((c, i) => ({ c, i })).filter((x) => (x.c & 0xf7) === 0x20);
  const lastAckBefore = acks.filter((x) => x.i < messageFrames[messageFrames.length - 1].i).length;
  t.ok('the host acknowledged the first answer before the second request', lastAckBefore >= 3, `${lastAckBefore}`);
  await client.close();
});

add('faults', 'a close cancels the read and discards channel, session and the loaded app', async (ctx) => {
  const { api, t } = ctx;
  const f = freeDevice(ctx, () => undefined);
  const client = await f.client();
  client.setLoadedApp(3);
  t.eq('the app is known', 3, client.loadedApp);
  await client.close();
  t.eq('the app is forgotten', undefined, client.loadedApp);
  t.eq('the transport was closed once', 1, f.w.transport.closeCalls);
  t.ok('the link is closed', client.isClosed);
  await t.rejects('a call on the closed connection', client.call(api.ExtAppLoad, loadRequest(api), api.ExtAppLoaded));
  await client.close();
  t.eq('closing twice closes the transport once', 1, f.w.transport.closeCalls);
});

// ---- guards ----

/**
 * Sets the library's send counter by reaching into the link's state, as a test
 * must: sending 2^31 messages is not an option, and the package offers no way to
 * set the counter (a counter that is not the number of messages sent makes the
 * device fail to decrypt).
 */
function setSendCounter(link: Link, value: number): void {
  const { state } = link as unknown as { state: { _sendNonce: number } };
  state._sendNonce = value;
}

add('guards', 'the message counter: the last counter below 2^31 gives the right nonce, 2^31 is refused before anything is sent', async (ctx) => {
  const { api, v, t } = ctx;
  const sc = scenarioOf(v, RECONNECT);
  const f = freeDevice(ctx, (message) =>
    message.type === api.ExtAppLoad.id
      ? { send: [{ session: 1, type: api.ExtAppLoaded.id as number, payload: api.ExtAppLoaded.encode({ instance_id: 3, version: { major: 0, minor: 1, patch: 1 } }) }] }
      : undefined,
  );
  const client = await f.client();
  const link = client.channel;
  const last = 2 ** 31 - 1;
  setSendCounter(link, last);
  f.free.hostCounter = last;
  const before = f.w.transport.written.length;
  await runVirtual(f.clock, link.send(1, api.ExtAppLoad.id as number, api.ExtAppLoad.encode(loadRequest(api))));
  // The frame decrypts under the nonce of the counter 2^31 - 1, written out in full.
  const packets = f.w.transport.written.slice(before);
  const frame = new api.FrameAssembler().push(packets[0]);
  const nonce = new Uint8Array(12);
  new DataView(nonce.buffer).setBigUint64(4, BigInt(last));
  const tagAt = (frame?.length ?? 0) - 4 - 16;
  const aes = api.thpCrypto.aesgcm(api.Buffer.from(api.fromHex(sc.noise.host_to_device_key)) as never, api.Buffer.from(nonce) as never);
  aes.auth(api.Buffer.alloc(0) as never);
  let plain: Uint8Array | undefined;
  try {
    plain = aes.decrypt(
      api.Buffer.from(frame!.body.subarray(0, tagAt)) as never,
      api.Buffer.from(frame!.body.subarray(tagAt, tagAt + 16)) as never,
    );
  } catch {
    plain = undefined;
  }
  t.ok('the message of counter 2^31 - 1 decrypts under that nonce', plain !== undefined);
  t.eq('and carries the request', api.toHex(api.ExtAppLoad.encode(loadRequest(api))), plain ? api.toHex(plain.subarray(3)) : '');
  setSendCounter(link, 2 ** 31);
  const after = f.w.transport.written.length;
  const error = await t.rejects('the send fails', runVirtual(f.clock, link.send(1, 0, new Uint8Array(0))));
  t.ok('a protocol error naming the counter', error instanceof api.TrezorProtocolError && /2\^31/.test(String((error as Error).message)), String(error));
  t.eq('nothing was sent', after, f.w.transport.written.length);
  t.ok('the link is closed', link.isClosed);
});

add('guards', 'a low-order device key in CPace ends pairing and nothing more is sent', async (ctx) => {
  const { api, v, t } = ctx;
  const sc = scenarioOf(v, PAIR);
  for (const key of ['00'.repeat(32), `01${'00'.repeat(31)}`]) {
    // The device's CpaceTrezor message (frame 17) carries the low-order key instead of its own.
    const steps = stepsOf(api, allFrames(sc).slice(0, 19));
    const replaced = deviceMessagePackets(ctx, sc, 3, steps[17].frame, api.ThpCodeEntryCpaceTrezor.id as number, api.ThpCodeEntryCpaceTrezor.encode({ cpace_trezor_public_key: api.fromHex(key) }));
    const w = replayOf(api, steps, { device: (step) => (step.frame.index === 17 ? replaced : step.packets) });
    const random = scriptRandom(api, randomValuesOf(api, sc));
    try {
      const error = await t.rejects(
        `the connection fails (key ${key.slice(0, 4)})`,
        runVirtual(
          w.clock,
          api.TrezorClient.connect(w.transport, {
            hostName: 'vector-host',
            appName: 'thru',
            credentialStore: new api.MemoryCredentialStore(),
            ui: uiOf('888203').ui,
            clock: w.clock,
          }),
        ),
      );
      t.ok(
        `the error is low_order_point (key ${key.slice(0, 4)})`,
        error instanceof api.TrezorPairingError && error.reason === 'low_order_point',
        String(error),
      );
    } finally {
      random.restore();
    }
    t.eq('the host sent nothing after its acknowledgement of that message', [], w.conversation.mismatches);
    t.eq('the transport was closed', 1, w.transport.closeCalls);
  }
});

/** The device's encrypted message with the control byte of the recorded frame `frame` and a counter of its own. */
function deviceMessagePackets(ctx: Ctx, sc: Scenario, counter: number, frame: VFrame, type: number, payload: Uint8Array): Uint8Array[] {
  const { api } = ctx;
  const aes = api.thpCrypto.aesgcm(
    api.Buffer.from(api.fromHex(sc.noise.device_to_host_key)) as never,
    api.thpCrypto.getIvFromNonce(counter),
  );
  aes.auth(api.Buffer.alloc(0) as never);
  const plain = new Uint8Array(3 + payload.length);
  plain[0] = frame.message?.session ?? 0;
  plain[1] = type >> 8;
  plain[2] = type & 0xff;
  plain.set(payload, 3);
  const ciphertext = aes.encrypt(api.Buffer.from(plain) as never);
  const tag = aes.finish();
  const body = new Uint8Array(ciphertext.length + tag.length);
  body.set(ciphertext);
  body.set(tag, ciphertext.length);
  return api.splitFrame(buildFrame(api, parseInt(frame.control_byte, 16), api.fromHex(frame.channel_id), body));
}

add('guards', 'a pairing code that is not exactly six digits is refused before CPace, and nothing more is sent', async (ctx) => {
  const { api, v, t } = ctx;
  const sc = scenarioOf(v, PAIR);
  for (const code of ['12345', '1234567', 'abcdef', '12 456', '', '٠٠٠٠٠٠', '888203\n']) {
    const steps = stepsOf(api, allFrames(sc).slice(0, 19));
    const w = replayOf(api, steps);
    const random = scriptRandom(api, randomValuesOf(api, sc));
    try {
      const error = await t.rejects(
        `the connection fails (code ${JSON.stringify(code)})`,
        runVirtual(
          w.clock,
          api.TrezorClient.connect(w.transport, {
            hostName: 'vector-host',
            appName: 'thru',
            credentialStore: new api.MemoryCredentialStore(),
            ui: uiOf(code).ui,
            clock: w.clock,
          }),
        ),
      );
      t.ok(
        `the error is invalid_code (code ${JSON.stringify(code)})`,
        error instanceof api.TrezorPairingError && error.reason === 'invalid_code',
        String(error),
      );
    } finally {
      random.restore();
    }
    t.eq(`nothing was sent after the challenge (code ${JSON.stringify(code)})`, [], w.conversation.mismatches);
  }
});

add('faults', 'an abort while the person has not typed the code ends the connection at the prompt', async (ctx) => {
  const { api, v, t } = ctx;
  const sc = scenarioOf(v, PAIR);
  const steps = stepsOf(api, allFrames(sc).slice(0, 19));
  const w = replayOf(api, steps);
  const random = scriptRandom(api, randomValuesOf(api, sc));
  const controller = new AbortController();
  let asked = 0;
  w.clock.setTimeout(() => controller.abort(), 20_000);
  try {
    const error = await t.rejects(
      'the connection fails',
      runVirtual(
        w.clock,
        api.TrezorClient.connect(w.transport, {
          hostName: 'vector-host',
          appName: 'thru',
          credentialStore: new api.MemoryCredentialStore(),
          ui: { pairingCode: () => (asked++, new Promise<string>(() => undefined)) },
          clock: w.clock,
          signal: controller.signal,
        }),
      ),
    );
    t.ok('an aborted error', error instanceof api.TrezorAbortedError, String(error));
    t.eq('the person was asked once', 1, asked);
    t.eq('nothing was sent after the prompt', [], w.conversation.mismatches);
    t.eq('the transport was closed', 1, w.transport.closeCalls);
  } finally {
    random.restore();
  }
});

add('guards', 'the vector file\'s CPace refusals through the driver: low_order_point and input_too_long', async (ctx) => {
  const { api, v, t } = ctx;
  for (const [i, x] of v.cpace.crypto.low_order_device_keys.entries()) {
    const random = scriptRandom(api, [api.fromHex(x.host_private_key as string)]);
    try {
      let reason: string | undefined;
      try {
        api.cpaceExchange(x.code as string, api.fromHex(x.handshake_hash as string), api.fromHex(x.device_public_key as string));
      } catch (e) {
        reason = e instanceof api.TrezorPairingError ? e.reason : String(e);
      }
      t.eq(`low-order device key ${i}`, x.error, reason);
    } finally {
      random.restore();
    }
  }
  for (const [i, x] of v.cpace.crypto.generator_string_too_long.entries()) {
    const random = scriptRandom(api, [new Uint8Array(32).fill(9)]);
    try {
      let reason: string | undefined;
      try {
        api.cpaceExchange(
          'x'.repeat(x.code_length as number).replace(/^x{6}$/, '123456'),
          new Uint8Array(x.handshake_hash_length as number).fill(7),
          new Uint8Array(32).fill(1),
        );
      } catch (e) {
        reason = e instanceof api.TrezorPairingError ? e.reason : String(e);
      }
      t.eq(`too-long input ${i}`, x.error, reason);
    } finally {
      random.restore();
    }
  }
  // The non-canonical encoding of zero is a low-order key too.
  const p = new Uint8Array(32).fill(0xff);
  p[0] = 0xed;
  p[31] = 0x7f;
  const random = scriptRandom(api, [new Uint8Array(32).fill(9)]);
  try {
    let reason: string | undefined;
    try {
      api.cpaceExchange('123456', new Uint8Array(32).fill(7), p);
    } catch (e) {
      reason = e instanceof api.TrezorPairingError ? e.reason : String(e);
    }
    t.eq('the key 2^255 - 19 (zero, not reduced)', 'low_order_point', reason);
  } finally {
    random.restore();
  }
});

add('guards', 'credentials of 126 bytes are used, of 127 are not (the recorded pairing replays unchanged around a stored 127-byte one)', async (ctx) => {
  const { api, v, t } = ctx;
  const sc = scenarioOf(v, PAIR);
  const device = api.fromHex(sc.inputs.device_static_pubkey as string);
  const host = api.fromHex(sc.inputs.host_static_privkey);
  // The stored record belongs to the device of this recording: its masked key matches.
  const long = { trezorStaticPubkey: device, hostStaticPrivkey: new Uint8Array(32).fill(5), credential: new Uint8Array(127).fill(0xab) };
  await replayWhole(ctx, { scenario: PAIR, seed: [long], what: '127-byte credential stored' });
  void host;

  // With 126 bytes the credential is sent: the completion request is longer by the credential.
  const steps = stepsOf(api, allFrames(sc).slice(0, 4));
  const w = replayOf(api, steps);
  const random = scriptRandom(api, randomValuesOf(api, sc));
  const used = { ...long, credential: new Uint8Array(126).fill(0xab) };
  const store = new api.MemoryCredentialStore();
  await store.store(used);
  const open = api.Link.open(w.transport, { clock: w.clock, knownCredentials: await store.load() });
  const error = await t.rejects('the handshake cannot complete against the recording', runVirtual(w.clock, open));
  random.restore();
  void error;
  const assembler = new api.FrameAssembler();
  const frames = w.transport.written.map((p) => assembler.push(p)).filter((f) => f !== undefined);
  const completion = frames.find((f) => f!.control === 0x12);
  // Recorded frame 4 is the completion request without a credential.
  t.eq('the completion request carries the 126-byte credential (2 bytes of wrapping more)', allFrames(sc)[4].length + 126 + 2, completion?.length);
});

add('guards', 'a device that claims a pairing no stored credential matched is an error', async (ctx) => {
  const { api, v, t } = ctx;
  const sc = scenarioOf(v, PAIR);
  // Recorded frame 5, the completion response, answers "paired" instead of "unpaired".
  const steps = stepsOf(api, allFrames(sc).slice(0, 7));
  const state = (b: number): Uint8Array[] => {
    const aes = api.thpCrypto.aesgcm(api.Buffer.from(api.fromHex(sc.noise.device_to_host_key)) as never, api.thpCrypto.getIvFromNonce(0));
    aes.auth(api.Buffer.alloc(0) as never);
    const ct = aes.encrypt(api.Buffer.from([b]) as never);
    const tag = aes.finish();
    const body = new Uint8Array(ct.length + tag.length);
    body.set(ct);
    body.set(tag, ct.length);
    return api.splitFrame(buildFrame(api, 0x1b, api.fromHex(sc.inputs.channel_id), body));
  };
  for (const [name, byte] of [['paired', 1], ['paired_autoconnect', 2]] as const) {
    const w = replayOf(api, steps, { device: (step) => (step.frame.index === 5 ? state(byte) : step.packets) });
    const random = scriptRandom(api, randomValuesOf(api, sc));
    try {
      const error = await t.rejects(
        `the connection fails (${name})`,
        runVirtual(
          w.clock,
          api.TrezorClient.connect(w.transport, {
            hostName: 'vector-host',
            appName: 'thru',
            credentialStore: new api.MemoryCredentialStore(),
            ui: uiOf('888203').ui,
            clock: w.clock,
          }),
        ),
      );
      t.ok(
        `an unrecorded pairing (${name})`,
        error instanceof api.TrezorPairingError && error.reason === 'unrecorded_pairing',
        String(error),
      );
    } finally {
      random.restore();
    }
    t.eq(`only the acknowledgement of the response was sent after the handshake (${name})`, [], w.conversation.mismatches);
  }
});

add('guards', 'the wrong code: the device\'s refusal is a pairing error that says so; nothing is stored', async (ctx) => {
  const { api, v, t } = ctx;
  const sc = scenarioOf(v, PAIR);
  // The device answers the host's tag (frame 19) with Failure(DataError, "Unexpected Code Entry Tag").
  const steps = stepsOf(api, allFrames(sc).slice(0, 22));
  const failure = deviceMessagePackets(ctx, sc, 4, steps[21].frame, api.Failure.id as number, api.Failure.encode({ code: 3, message: 'Unexpected Code Entry Tag' }));
  const w = replayOf(api, steps, { device: (step) => (step.frame.index === 21 ? failure : step.packets) });
  const store = new api.MemoryCredentialStore();
  const random = scriptRandom(api, randomValuesOf(api, sc));
  try {
    // Any six digits: the host types them, the device refuses the tag.
    const error = await t.rejects(
      'the connection fails',
      runVirtual(
        w.clock,
        api.TrezorClient.connect(w.transport, {
          hostName: 'vector-host',
          appName: 'thru',
          credentialStore: store,
          ui: uiOf('888203').ui,
          clock: w.clock,
        }),
      ),
    );
    t.ok('the wrong-code pairing error', error instanceof api.TrezorPairingError && error.reason === 'wrong_code', String(error));
    t.ok('the text says the code is wrong', /the code is wrong/.test(String((error as Error).message)));
  } finally {
    random.restore();
  }
  t.eq('no credential was stored', 0, (await store.load()).length);
});

// ---- the model of the image, the loading callback, whole operations, Buffers, the handshake's lengths ----

/** The image with `model` written where the header names it (bytes 104 to 108), or with that field zeroed for `null`. */
function withModel(image: AppImage, model: string | null): AppImage {
  const header = new Uint8Array(image.header);
  header.fill(0, 104, 108);
  if (model !== null) header.set(new TextEncoder().encode(model), 104);
  return { ...image, header };
}

const appVersion = { major: 0, minor: 1, patch: 1, build: 0 };

/** The device's answer to a request for the app: held (`undefined`) or `ExtAppLoaded` with instance 3. */
const loadedMessage = (api: Api): DeviceMessage => ({
  session: 1,
  type: api.ExtAppLoaded.id as number,
  payload: api.ExtAppLoaded.encode({ instance_id: 3, version: appVersion }),
});

add('guards', 'an app image built for another model than the device is refused before any load message, naming both models', async (ctx) => {
  const { api, v, t } = ctx;
  const f = freeDevice(ctx, (message) => (message.type === api.ExtAppLoad.id ? { send: [loadedMessage(api)] } : undefined));
  const client = await f.client();
  t.eq('the device is a Safe 7', 'T3W1', client.properties.internalModel);
  const { image } = imageOf(api, v);
  const sent = f.free.received.length;
  const refusals: [string, AppImage, RegExp][] = [
    ['an image of a Safe 5', withModel(image, 'T3T1'), /built for the T3T1.*this Trezor is a T3W1.*T3W1/],
    ['an image of a model with a shorter name', withModel(image, 'T3'), /built for the T3,.*T3W1/],
    ['an image with no model in its header', withModel(image, null), /does not name the model/],
    ['an image whose model is not ASCII', { ...image, header: Uint8Array.from(withModel(image, 'T3W1').header, (b, i) => (i === 105 ? 0xff : b)) }, /does not name the model/],
    ['an image whose header ends before the model', { ...image, header: new Uint8Array(100) }, /too short/],
  ];
  for (const [what, offered, pattern] of refusals) {
    const error = await t.rejects(what, runVirtual(f.clock, api.loadApp(client, offered)));
    t.ok(`${what}: an app image error`, error instanceof api.TrezorAppImageError, String(error));
    t.ok(`${what}: says what is wrong`, pattern.test(String((error as Error | undefined)?.message)), String((error as Error | undefined)?.message));
    t.eq(`${what}: nothing reached the device`, sent, f.free.received.length);
    t.ok(`${what}: the connection stays open`, !client.isClosed);
    t.eq(`${what}: no app is recorded`, undefined, client.loadedApp);
  }
  const loaded = await runVirtual(f.clock, api.loadApp(client, withModel(image, 'T3W1')));
  t.eq('an image of the device\'s model is loaded', 3, loaded.instanceId);
  t.eq('the first message of the device is the load request', api.ExtAppLoad.id, f.free.received[sent].type);
  t.eq('the model an image names', ['T3W1', 'T3T1'], [api.appImageModel(withModel(image, 'T3W1')), api.appImageModel(withModel(image, 'T3T1'))]);
  await client.close();
});

add('guards', 'connectTrezor tells the application that the app is being loaded: once, after pairing, before the first load message; a callback that throws changes nothing', async (ctx) => {
  const { api, v, t } = ctx;
  for (const throws of [false, true]) {
    const label = throws ? 'a callback that throws' : 'a callback';
    const f = freeDevice(ctx, (message) => (message.type === api.ExtAppLoad.id ? { send: [loadedMessage(api)] } : undefined));
    const seen: number[][] = [];
    const image = withModel(imageOf(api, v).image, 'T3W1');
    const signer = await f.connectWith((transport, options) =>
      api.connectTrezor({
        ...options,
        transport,
        image,
        transactionSigningScheme: 'rfc8032' as never,
        onAppLoading: () => {
          seen.push(f.free.received.map((m) => m.type));
          if (throws) throw new Error('the callback fails');
        },
      }),
    );
    t.eq(`${label}: called once`, 1, seen.length);
    t.eq(`${label}: after the end of pairing and the session, before any load message`, [api.ThpEndRequest.id, api.ThpCreateNewSession.id], seen[0]);
    t.eq(`${label}: the load request comes next`, api.ExtAppLoad.id, f.free.received[2]?.type);
    t.eq(`${label}: and is the only one`, 1, f.free.received.filter((m) => m.type === api.ExtAppLoad.id).length);
    await signer.close();
  }
  // Without the callback nothing changes.
  const f = freeDevice(ctx, (message) => (message.type === api.ExtAppLoad.id ? { send: [loadedMessage(api)] } : undefined));
  const signer = await f.connectWith((transport, options) =>
    api.connectTrezor({ ...options, transport, image: withModel(imageOf(api, v).image, 'T3W1'), transactionSigningScheme: 'rfc8032' as never }),
  );
  t.ok('connects without it', signer instanceof api.ThruTrezorSigner);
  t.eq('a standard session is not a passphrase wallet\'s', false, signer.passphraseOnDevice);
  await signer.close();
  // The signer knows that the session was opened for a passphrase typed on the device.
  const typed = freeDevice(ctx, (message) => (message.type === api.ExtAppLoad.id ? { send: [loadedMessage(api)] } : undefined), { passphraseOnDevice: true });
  const passphraseSigner = await typed.connectWith((transport, options) =>
    api.connectTrezor({ ...options, transport, image: withModel(imageOf(api, v).image, 'T3W1'), transactionSigningScheme: 'rfc8032' as never }),
  );
  t.eq('a passphrase session is', true, passphraseSigner.passphraseOnDevice);
  await passphraseSigner.close();
});

/**
 * The Thru app as a device runs it: one request at a time. While a
 * transaction waits for the rest of its body, or the app is being loaded,
 * a request that is not the next step of that is answered with `Failure`.
 */
function appDevice(ctx: Ctx, log: string[]): (message: DeviceMessage) => { send: DeviceMessage[] } | undefined {
  const { api } = ctx;
  let transaction: { size: number; got: number } | undefined;
  let loading = false;
  const answer = (type: number, payload: Uint8Array): { send: DeviceMessage[] } => ({ send: [{ session: 1, type, payload }] });
  const respond = (id: number, data: Uint8Array) => answer(api.ExtAppResponse.id as number, api.ExtAppResponse.encode({ message_id: id, data }));
  const unexpected = (what: string) => {
    log.push(`${what} (refused)`);
    return answer(api.Failure.id as number, api.Failure.encode({ code: 1, message: 'Unexpected message' }));
  };
  const more = (): { send: DeviceMessage[] } => {
    const t = transaction as { size: number; got: number };
    return respond(api.TxDataRequest.id as number, api.TxDataRequest.encode({ offset: t.got, length: Math.min(2048, t.size - t.got) }));
  };
  return (message) => {
    if (message.type === api.ExtAppLoad.id) {
      if (transaction) return unexpected('ExtAppLoad');
      log.push('ExtAppLoad');
      loading = true;
      return answer(api.ExtAppHeaderRequest.id as number, api.ExtAppHeaderRequest.encode({}));
    }
    if (message.type === api.ExtAppHeaderAck.id) {
      log.push('ExtAppHeaderAck');
      loading = false;
      return answer(api.ExtAppLoaded.id as number, api.ExtAppLoaded.encode({ instance_id: 3, version: appVersion }));
    }
    if (message.type !== api.ExtAppMessage.id) return undefined;
    const request = api.ExtAppMessage.decode(message.payload);
    switch (request.message_id) {
      case api.GetPublicKey.id: {
        if (transaction || loading) return unexpected('GetPublicKey');
        log.push('GetPublicKey');
        return respond(api.PublicKey.id as number, api.PublicKey.encode({ public_key: new Uint8Array(32).fill(5), address: 'ta' }));
      }
      case api.SignTx.id: {
        if (transaction || loading) return unexpected('SignTx');
        log.push('SignTx');
        transaction = { size: api.SignTx.decode(request.data).body_size, got: 0 };
        return more();
      }
      case api.TxDataAck.id: {
        if (!transaction) return unexpected('TxDataAck');
        log.push('TxDataAck');
        transaction.got += api.TxDataAck.decode(request.data).data.length;
        if (transaction.got < transaction.size) return more();
        transaction = undefined;
        return respond(api.TxSignature.id as number, api.TxSignature.encode({ signature: new Uint8Array(64).fill(6) }));
      }
      default:
        return unexpected(`message ${request.message_id}`);
    }
  };
}

add('faults', 'whole operations are serialized: two transactions and a public key started together reach the device one after the other, and so do a load and a request', async (ctx) => {
  const { api, v, t } = ctx;
  const log: string[] = [];
  const f = freeDevice(ctx, appDevice(ctx, log));
  const client = await f.client();
  client.setLoadedApp(3);
  const app = api.ThruApp.attach(client, 3);
  const first = app.signTransaction(PATH, new Uint8Array(5000));
  const second = app.signTransaction(PATH, new Uint8Array(3000));
  const key = app.getPublicKey(PATH);
  const results = await runVirtual(f.clock, Promise.all([first, second, key]));
  t.eq('the signatures', [64, 64], [results[0].length, results[1].length]);
  t.eq('the public key', 32, results[2].publicKey.length);
  t.eq(
    'the device saw the first transaction whole, then the second, then the key',
    ['SignTx', 'TxDataAck', 'TxDataAck', 'TxDataAck', 'SignTx', 'TxDataAck', 'TxDataAck', 'GetPublicKey'],
    log,
  );

  // A request that waits behind another and is aborted there is never sent, and does not delay the others.
  log.length = 0;
  const running = app.signTransaction(PATH, new Uint8Array(5000));
  const controller = new AbortController();
  const waiting = app.getPublicKey(PATH, { signal: controller.signal });
  const last = app.getPublicKey(PATH);
  controller.abort();
  const error = await t.rejects('the aborted request that was waiting', runVirtual(f.clock, waiting));
  t.ok('is an aborted error', error instanceof api.TrezorAbortedError, String(error));
  t.eq('that says nothing was sent', false, (error as { outcomeUnknown?: boolean }).outcomeUnknown);
  await runVirtual(f.clock, Promise.all([running, last]));
  t.eq('the others were served in order, the aborted one never reached the device', ['SignTx', 'TxDataAck', 'TxDataAck', 'TxDataAck', 'GetPublicKey'], log);

  // The load of the app is one operation too.
  log.length = 0;
  const image = withModel(imageOf(api, v).image, 'T3W1');
  const load = api.loadApp(client, image);
  const afterLoad = app.getPublicKey(PATH);
  const [loaded] = await runVirtual(f.clock, Promise.all([load, afterLoad]));
  t.eq('the app was uploaded', true, loaded.uploaded);
  t.eq('the load went through before the request', ['ExtAppLoad', 'ExtAppHeaderAck', 'GetPublicKey'], log);
  t.ok('the connection is open', !client.isClosed);
  await client.close();
});

add('guards', 'the bytes of a queued call are those of the moment of the call, whatever their holder does afterwards', async (ctx) => {
  const { api, t } = ctx;
  const f = freeDevice(ctx, (message) => {
    if (message.type === api.ExtAppMessage.id) {
      return { send: [{ session: 1, type: api.ExtAppResponse.id as number, payload: api.ExtAppResponse.encode({ message_id: 1, data: new Uint8Array(0) }) }] };
    }
    return undefined;
  });
  const client = await f.client();
  // The first call is answered late: the others wait behind it.
  const first = client.call(api.ExtAppLoad, loadRequest(api), api.ExtAppLoaded);
  const data = bufferOf(api, new Uint8Array(100).fill(0x11));
  const second = client.call(api.ExtAppMessage, { instance_id: 3, message_id: 6, data }, api.ExtAppResponse);
  const raw = bufferOf(api, api.ExtAppMessage.encode({ instance_id: 3, message_id: 6, data: new Uint8Array(40).fill(0x22) }));
  const third = client.callAny(api.ExtAppMessage.id as number, raw);
  data.fill(0xee);
  raw.fill(0xee);
  f.clock.setTimeout(() => f.free.send(loadedMessage(api)), 100);
  await runVirtual(f.clock, Promise.all([first, second, third]));
  const sent = f.free.received
    .filter((m) => m.type === api.ExtAppMessage.id)
    .map((m) => {
      try {
        return api.ExtAppMessage.decode(m.payload).data;
      } catch {
        return new Uint8Array(0);
      }
    });
  t.eq('two app messages were sent', 2, sent.length);
  t.eq('the data of the call is what it was at the call', api.toHex(new Uint8Array(100).fill(0x11)), api.toHex(sent[0]));
  t.eq('the payload of callAny is what it was at the call', api.toHex(new Uint8Array(40).fill(0x22)), api.toHex(sent[1]));
  await client.close();
});

add('guards', 'an abort while a packet of a request is being written ends the call at once; no later packet is written, the connection is closed, the outcome is unknown', async (ctx) => {
  const { api, t } = ctx;
  const f = freeDevice(ctx, () => undefined);
  const client = await f.client();
  const transport = f.w.transport;
  const before = transport.written.length;
  let release!: () => void;
  const held = new Promise<void>((resolve) => void (release = resolve));
  // The second packet of the request is the one on its way when the signal fires.
  const start = transport.writesBegun;
  transport.holdWrite = (index) => (index === start + 1 ? held : undefined);
  const controller = new AbortController();
  let outcome: unknown = 'pending';
  void client
    .call(api.ExtAppMessage, { instance_id: 3, message_id: 6, data: new Uint8Array(400).fill(7) }, api.ExtAppResponse, { signal: controller.signal })
    .then(
      () => (outcome = 'answered'),
      (error: unknown) => (outcome = error),
    );
  await macrotask();
  t.eq('the first packet of the request left, the second is on its way', before + 1, transport.written.length);
  controller.abort();
  await macrotask();
  t.ok('the call ended at once, without waiting for the pending write', outcome instanceof api.TrezorAbortedError, String(outcome));
  t.eq('and says the device may have acted: part of the request was written', true, (outcome as { outcomeUnknown?: boolean }).outcomeUnknown);
  t.ok('the connection is closed', client.isClosed);
  t.eq('the transport was closed once', 1, transport.closeCalls);
  release();
  await macrotask();
  await macrotask();
  t.ok('after the abort at most the packet that was already on its way was written', transport.written.length - before <= 2, `${transport.written.length - before} packets`);
  t.eq('the request never reached the device whole', 0, f.free.received.filter((m) => m.type === api.ExtAppMessage.id).length);
});

add('guards', 'an abort during the handshake stops the packets of the message being written there too', async (ctx) => {
  const { api, v, t } = ctx;
  const sc = scenarioOf(v, RECONNECT);
  const steps = stepsOf(api, sc.handshake_frames);
  const w = replayOf(api, steps);
  // The first host frame is a request of one packet; hold its write, abort, then release.
  let release!: () => void;
  const held = new Promise<void>((resolve) => void (release = resolve));
  w.transport.holdWrite = (index) => (index === 0 ? held : undefined);
  const random = scriptRandom(api, randomValuesOf(api, sc));
  const controller = new AbortController();
  try {
    let outcome: unknown = 'pending';
    void api.Link.open(w.transport, { clock: w.clock, knownCredentials: [recordOf(api, sc)], signal: controller.signal }).then(
      () => (outcome = 'opened'),
      (error: unknown) => (outcome = error),
    );
    await macrotask();
    controller.abort();
    await macrotask();
    t.ok('the open ended at once with an aborted error', outcome instanceof api.TrezorAbortedError, String(outcome));
    release();
    await macrotask();
    t.eq('nothing was written', 0, w.transport.written.length);
    t.eq('the transport was closed', 1, w.transport.closeCalls);
  } finally {
    random.restore();
  }
});

/** The recorded handshake with the device's frame `index` one byte longer (or shorter), its checksum recomputed. */
async function handshakeWithLength(ctx: Ctx, index: number, delta: 1 | -1): Promise<{ error: unknown; hostFrames: number }> {
  const { api, v } = ctx;
  const sc = scenarioOf(v, RECONNECT);
  const steps = stepsOf(api, sc.handshake_frames);
  const w = replayOf(api, steps, {
    device: (step) => {
      if (step.frame.index !== index) return step.packets;
      const payload = api.fromHex(step.frame.payload);
      const body = delta === 1 ? new Uint8Array([...payload, 0]) : payload.slice(0, -1);
      return api.splitFrame(buildFrame(api, parseInt(step.frame.control_byte, 16), api.fromHex(step.frame.channel_id), body));
    },
  });
  let error: unknown;
  try {
    await reconnectLink(ctx, w);
  } catch (e) {
    error = e;
  }
  return { error, hostFrames: w.conversation.hostFrames.length };
}

add('guards', 'the handshake answers must have exactly the length of the protocol: a byte more, with a valid checksum, ends the connection', async (ctx) => {
  const { api, t } = ctx;
  // Frame 3 is the initiation response (96 bytes), frame 5 the completion response (the state: 1 byte and a 16-byte tag).
  for (const [what, index, hostFramesBefore] of [
    ['the initiation response', 3, 2],
    ['the completion response', 5, 3],
  ] as const) {
    for (const delta of [1, -1] as const) {
      const label = `${what} ${delta === 1 ? 'a byte too long' : 'a byte too short'}`;
      const { error, hostFrames } = await handshakeWithLength(ctx, index, delta);
      t.ok(`${label}: a protocol error`, error instanceof api.TrezorProtocolError, String(error));
      if (delta === 1) t.ok(`${label}: names the length`, /has \d+ bytes, the protocol has exactly \d+/.test(String((error as Error | undefined)?.message)), String((error as Error | undefined)?.message));
      t.eq(`${label}: the host sent nothing after it`, hostFramesBefore, hostFrames);
    }
  }
});

// ---- second review: stores of the application, options and signals read once, queued calls, outcomes ----

const MARKER = 'RECORD-MARKER-5f3a9c71-host-private-key';

/** Where `MARKER` shows in what `error` offers a reader: its text, stack, JSON, own properties and cause. */
function whereMarkerShows(error: unknown): string[] {
  const found: string[] = [];
  const look = (what: string, text: string | undefined): void => {
    if (text !== undefined && text.includes(MARKER)) found.push(what);
  };
  const e = error as Error & { cause?: unknown };
  look('message', e.message);
  look('String(error)', String(e));
  look('stack', e.stack);
  try {
    look('JSON.stringify', JSON.stringify(e));
  } catch {
    found.push('JSON.stringify threw');
  }
  for (const key of Object.getOwnPropertyNames(e)) {
    const value = (e as unknown as Record<string, unknown>)[key];
    try {
      look(`property ${key}`, typeof value === 'string' ? value : JSON.stringify(value));
    } catch {
      found.push(`property ${key} could not be read`);
    }
  }
  if (e.cause !== undefined) found.push('cause');
  return found;
}

class StoreParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StoreParseError';
  }
}

/** What an application's store may throw: a record in the text, in the cause, in a property, or no error at all. */
function leaks(): { what: string; make: () => unknown; name?: string }[] {
  const named = (name: string): (() => unknown) => () => {
    const error = Object.assign(new Error(`cannot parse ${MARKER}`), { cause: { record: MARKER }, record: MARKER });
    error.name = name;
    return error;
  };
  return [
    { what: 'an error with a class of the application (not on the list of names kept)', make: () => Object.assign(new StoreParseError(`bad record ${MARKER}`), { cause: { record: MARKER }, record: MARKER }) },
    { what: 'an error of a built-in class', make: named('TypeError'), name: 'TypeError' },
    { what: 'an error named as a DOMException of the stores\' tests', make: named('SecurityError'), name: 'SecurityError' },
    { what: 'a string', make: () => `the record is ${MARKER}` },
    { what: 'an error whose name is not an identifier', make: named(`not a name ${MARKER}`) },
    { what: 'an error whose name is too long', make: named('N'.repeat(65)) },
    { what: 'an error whose name is an identifier of 64 characters', make: named('N'.repeat(64)) },
  ];
}

type FailingStore = { load(): Promise<never>; store(): Promise<never>; forget(): Promise<never> };
const failingStore = (make: () => unknown): FailingStore => ({
  load: () => Promise.reject(make()),
  store: () => Promise.reject(make()),
  forget: () => Promise.reject(make()),
});

/** Connects through the recorded pairing; the store gets the device's credential at its end. */
function connectPairing(ctx: Ctx, store: object, options: Record<string, unknown> = {}): Promise<TrezorClient> {
  const { api, v } = ctx;
  const sc = scenarioOf(v, PAIR);
  const w = replayOf(api, stepsOf(api, allFrames(sc)));
  const random = scriptRandom(api, randomValuesOf(api, sc));
  const connecting = api.TrezorClient.connect(w.transport, {
    hostName: 'vector-host',
    appName: 'thru',
    credentialStore: store as never,
    ui: uiOf((sc.inputs.pairing as { code: string }).code).ui,
    clock: w.clock,
    ...options,
  });
  return runVirtual(w.clock, connecting).finally(() => random.restore());
}

add('guards', 'a credential store of the application that throws: the connection error names the operation and the error class, and carries neither the message nor the cause', async (ctx) => {
  const { api, t } = ctx;
  for (const operation of ['load', 'store'] as const) {
    const wording = operation === 'load' ? /could not be read/ : /could not be stored/;
    for (const { what, make, name } of leaks()) {
      const label = `${operation}, ${what}`;
      const store = failingStore(make);
      let error: unknown;
      if (operation === 'load') {
        const clock = new FakeClock();
        const transport = new ScriptedTransport(clock, () => undefined);
        error = await t.rejects(label, runVirtual(clock, api.TrezorClient.connect(transport, { hostName: 'h', appName: 'a', credentialStore: store as never, ui: uiOf('000000').ui, clock })));
      } else {
        error = await t.rejects(label, connectPairing(ctx, { load: async () => [], store: store.store, forget: store.forget }));
      }
      t.ok(`${label}: a credentials error`, error instanceof api.TrezorCredentialsError, String(error));
      t.ok(`${label}: the text names the operation`, wording.test(String((error as Error | undefined)?.message)), String((error as Error | undefined)?.message));
      t.eq(`${label}: the marker shows nowhere`, [], whereMarkerShows(error));
      const text = String((error as Error | undefined)?.message);
      if (name !== undefined) t.ok(`${label}: the class name is named`, text.includes(`the credential store threw ${name}`), text);
      else t.ok(`${label}: no class name is given`, /the credential store failed/.test(text), text);
    }
  }
  // An error of the package's own classes that an application's store throws is the application's: it is
  // reduced like any other, whatever its class, and neither its message nor its cause reaches the caller.
  class AppStoreError extends api.TrezorCredentialsError {}
  const appMade = (): unknown => new AppStoreError(`cannot read ${MARKER}`, { cause: new Error(`parser quotes ${MARKER}`) });
  for (const operation of ['load', 'store'] as const) {
    const label = `a TrezorError subclass thrown by the store's ${operation}`;
    const store = failingStore(appMade);
    let error: unknown;
    if (operation === 'load') {
      const clock = new FakeClock();
      error = await t.rejects(label, runVirtual(clock, api.TrezorClient.connect(new ScriptedTransport(clock, () => undefined), { hostName: 'h', appName: 'a', credentialStore: store as never, ui: uiOf('000000').ui, clock })));
    } else {
      error = await t.rejects(label, connectPairing(ctx, { load: async () => [], store: store.store, forget: store.forget }));
    }
    t.ok(`${label}: the client's credentials error`, error instanceof api.TrezorCredentialsError && !(error instanceof AppStoreError), String(error));
    t.eq(`${label}: the marker shows nowhere (message, cause, properties, text, JSON)`, [], whereMarkerShows(error));
    t.eq(`${label}: no cause`, undefined, (error as { cause?: unknown } | undefined)?.cause);
    const text = String((error as Error | undefined)?.message);
    t.ok(`${label}: names the operation and no class`, (operation === 'load' ? /could not be read/ : /could not be stored/).test(text) && /the credential store failed/.test(text) && !text.includes('AppStoreError'), text);
  }
  // The package's own base classes thrown by an application are reduced too.
  for (const make of [() => new api.TrezorError('credentials', `base ${MARKER}`, { cause: MARKER }), () => new api.TrezorProtocolError(`protocol ${MARKER}`)]) {
    const clock = new FakeClock();
    const error = await t.rejects('another class of the package', runVirtual(clock, api.TrezorClient.connect(new ScriptedTransport(clock, () => undefined), { hostName: 'h', appName: 'a', credentialStore: failingStore(make) as never, ui: uiOf('000000').ui, clock })));
    t.ok('a credentials error of the client', error instanceof api.TrezorCredentialsError, String(error));
    t.eq('the marker shows nowhere', [], whereMarkerShows(error));
  }
});

add('guards', 'the name of a store\'s error is kept only if it is on the fixed list: an identifier that is a credential appears nowhere', async (ctx) => {
  const { api, t } = ctx;
  const hex = 'abcdef0123456789'.repeat(4);
  t.eq('the name is a 64-character hexadecimal string that starts with a letter', true, /^[a-f][0-9a-f]{63}$/.test(hex));
  for (const operation of ['load', 'store'] as const) {
    const make = (): unknown => Object.assign(new Error('failed'), { name: hex });
    const store = failingStore(make);
    let error: unknown;
    if (operation === 'load') {
      const clock = new FakeClock();
      error = await t.rejects(operation, runVirtual(clock, api.TrezorClient.connect(new ScriptedTransport(clock, () => undefined), { hostName: 'h', appName: 'a', credentialStore: store as never, ui: uiOf('000000').ui, clock })));
    } else {
      error = await t.rejects(operation, connectPairing(ctx, { load: async () => [], store: store.store, forget: store.forget }));
    }
    t.ok(`${operation}: a credentials error`, error instanceof api.TrezorCredentialsError, String(error));
    const e = error as Error;
    const shown = [e.message, e.stack ?? '', JSON.stringify(e, Object.getOwnPropertyNames(e)), String(e)].join('\n');
    t.eq(`${operation}: the name shows nowhere`, false, shown.includes(hex));
    t.ok(`${operation}: no class is named`, /the credential store failed/.test(e.message), e.message);
  }
  for (const name of ['Error', 'TypeError', 'RangeError', 'SyntaxError', 'ReferenceError', 'EvalError', 'URIError', 'AggregateError', 'DOMException', 'SecurityError']) {
    const store = failingStore(() => Object.assign(new Error('failed'), { name }));
    const clock = new FakeClock();
    const error = await t.rejects(name, runVirtual(clock, api.TrezorClient.connect(new ScriptedTransport(clock, () => undefined), { hostName: 'h', appName: 'a', credentialStore: store as never, ui: uiOf('000000').ui, clock })));
    t.ok(`${name}: is named`, String((error as Error).message).includes(`the credential store threw ${name}`), String((error as Error).message));
  }
});

add('guards', 'the size check of a credential record throws the package\'s own marked error, which names a size and never a value', async (ctx) => {
  const { api, t } = ctx;
  const mark = Symbol.for('@thru/trezor/own-store-error');
  const good = { trezorStaticPubkey: new Uint8Array(32).fill(1), hostStaticPrivkey: new Uint8Array(32).fill(2), credential: new Uint8Array(8).fill(3) };
  const bad: [string, unknown][] = [
    ['a short device key', { ...good, trezorStaticPubkey: new Uint8Array(31) }],
    ['a short host key', { ...good, hostStaticPrivkey: new Uint8Array(33) }],
    ['an empty credential', { ...good, credential: new Uint8Array(0) }],
    ['a host key that is not bytes', { ...good, hostStaticPrivkey: MARKER }],
  ];
  for (const [what, record] of bad) {
    const error = await t.rejects(what, new api.MemoryCredentialStore().store(record as never));
    t.ok(`${what}: a credentials error`, error instanceof api.TrezorCredentialsError, String(error));
    t.eq(`${what}: carries the mark`, true, (error as Record<symbol, unknown>)[mark]);
    t.eq(`${what}: shows no value`, [], whereMarkerShows(error));
  }
});

add('guards', 'connect reads its options once, at the call: the options object changed while the store is read changes neither the session, the names, the store nor the code prompt', async (ctx) => {
  const { api, v, t } = ctx;
  const sc = scenarioOf(v, PAIR);
  const steps = stepsOf(api, allFrames(sc));
  const w = replayOf(api, steps);
  const random = scriptRandom(api, randomValuesOf(api, sc));
  const kept = new api.MemoryCredentialStore();
  const other = new api.MemoryCredentialStore();
  const wrongUi = { pairingCode: () => '000000' };
  const options: Record<string, unknown> = {
    hostName: 'vector-host',
    appName: 'thru',
    ui: uiOf((sc.inputs.pairing as { code: string }).code).ui,
    clock: w.clock,
    passphraseOnDevice: false,
    allowSkipPairing: false,
  };
  options.credentialStore = {
    load: async () => {
      // The caller changes everything while the credentials are being read.
      options.passphraseOnDevice = true;
      options.allowSkipPairing = true;
      options.hostName = 'another-host';
      options.appName = 'another-app';
      options.ui = wrongUi;
      options.credentialStore = other;
      return kept.load();
    },
    store: (record: Parameters<typeof kept.store>[0]) => kept.store(record),
    forget: () => kept.forget(),
  };
  let client: TrezorClient | undefined;
  try {
    client = await runVirtual(w.clock, api.TrezorClient.connect(w.transport, options as never));
    t.eq('the host sent what the recording holds: the names, the code and the standard wallet\'s session', [], w.conversation.mismatches);
    t.eq('the credential went to the store of the call', 1, (await kept.load()).length);
    t.eq('and not to the store it was replaced with', 0, (await other.load()).length);
  } finally {
    random.restore();
    if (client) await client.close();
  }
});

add('faults', 'the signal of a queued call is the one it was queued with: replacing or deleting options.signal while it waits does not disable its abort', async (ctx) => {
  const { api, t } = ctx;
  for (const [how, queue] of [
    ['call', (client: TrezorClient, options: { signal?: AbortSignal }) => client.call(api.ExtAppMessage, { instance_id: 3, message_id: 6, data: new Uint8Array(0) }, api.ExtAppResponse, options)],
    ['callAny', (client: TrezorClient, options: { signal?: AbortSignal }) => client.callAny(api.ExtAppMessage.id as number, api.ExtAppMessage.encode({ instance_id: 3, message_id: 6, data: new Uint8Array(0) }), options)],
  ] as const) {
    for (const change of ['deleted', 'replaced'] as const) {
      const label = `${how}, signal ${change}`;
      const f = freeDevice(ctx, () => undefined);
      const client = await f.client();
      const first = client.call(api.ExtAppLoad, loadRequest(api), api.ExtAppLoaded);
      const controller = new AbortController();
      const options: { signal?: AbortSignal } = { signal: controller.signal };
      const second = queue(client, options);
      if (change === 'deleted') delete options.signal;
      else options.signal = new AbortController().signal;
      // The first call is answered at 100 ms, so the second starts then; its signal fires at 2 s, while the device has not answered it.
      f.clock.setTimeout(() => f.free.send(loadedMessage(api)), 100);
      f.clock.setTimeout(() => controller.abort(), 2000);
      const [, outcome] = await runVirtual(f.clock, Promise.allSettled([first, second]));
      const error = outcome.status === 'rejected' ? outcome.reason : undefined;
      t.ok(`${label}: the call ended with an aborted error`, error instanceof api.TrezorAbortedError, String(error));
      t.ok(`${label}: when its signal fired, not at the call timeout`, f.clock.now() < 10_000, `${f.clock.now()} ms`);
      await client.close();
    }
  }
});

add('faults', 'a queued call whose signal fires ends at once, sends nothing, and the calls behind it keep their order after the call before it', async (ctx) => {
  const { api, t } = ctx;
  const order: number[] = [];
  const f = freeDevice(ctx, (message) => {
    if (message.type === api.ExtAppMessage.id) {
      order.push(api.ExtAppMessage.decode(message.payload).message_id);
      return { send: [{ session: 1, type: api.ExtAppResponse.id as number, payload: api.ExtAppResponse.encode({ message_id: 1, data: new Uint8Array(0) }) }] };
    }
    return undefined;
  });
  const client = await f.client();
  const settledAt: Record<string, number> = {};
  const note = <T>(name: string, promise: Promise<T>): Promise<T> => promise.finally(() => void (settledAt[name] = f.clock.now()));
  // A waits for the device (a confirmation that does not come until 3 s); B and C queue behind it.
  const a = note('a', client.call(api.ExtAppLoad, loadRequest(api), api.ExtAppLoaded));
  const controller = new AbortController();
  const b = note('b', client.call(api.ExtAppMessage, { instance_id: 3, message_id: 6, data: new Uint8Array(0) }, api.ExtAppResponse, { signal: controller.signal }));
  const c = note('c', client.call(api.ExtAppMessage, { instance_id: 3, message_id: 7, data: new Uint8Array(0) }, api.ExtAppResponse));
  f.clock.setTimeout(() => controller.abort(), 1000);
  f.clock.setTimeout(() => f.free.send(loadedMessage(api)), 3000);
  const [ra, rb, rc] = await runVirtual(f.clock, Promise.allSettled([a, b, c]));
  t.eq('B ended with an aborted error', true, rb.status === 'rejected' && rb.reason instanceof api.TrezorAbortedError);
  t.eq('when its signal fired, while A still waited', 1000, settledAt.b);
  t.eq('and said nothing was sent', false, rb.status === 'rejected' && (rb.reason as { outcomeUnknown?: boolean }).outcomeUnknown);
  t.eq('A was answered at 3 s', ['fulfilled', 3000], [ra.status, settledAt.a]);
  t.eq('C ran after A', ['fulfilled', true], [rc.status, settledAt.c >= 3000]);
  t.eq('the device saw C only: B was never sent', [7], order);
  t.ok('the connection is open', !client.isClosed);
  await client.close();
});

add('guards', 'Link.open reads the credentials at the call: the array and its records changed while the channel is allocated change neither the lookup nor the keys', async (ctx) => {
  const { api, v, t } = ctx;
  const sc = scenarioOf(v, RECONNECT);
  const w = replayOf(api, stepsOf(api, sc.handshake_frames));
  let release!: () => void;
  const held = new Promise<void>((resolve) => void (release = resolve));
  w.transport.holdWrite = (index) => (index === 0 ? held : undefined);
  const random = scriptRandom(api, randomValuesOf(api, sc));
  try {
    const known = [recordOf(api, sc)];
    const record = known[0];
    const open = api.Link.open(w.transport, { clock: w.clock, knownCredentials: known });
    await macrotask();
    // The caller empties its array and wipes the record while the allocation request is being written.
    record.trezorStaticPubkey.fill(0);
    record.hostStaticPrivkey.fill(0);
    record.credential.fill(0);
    known.length = 0;
    release();
    const link = await runVirtual(w.clock, open);
    t.ok('the stored credential was found', link.credentialMatched);
    t.eq('the handshake the file records was made with its keys', [], w.conversation.mismatches);
    await link.close();
  } finally {
    random.restore();
  }
});

add('guards', 'a failure before the first packet of a request is written does not say the outcome is unknown; one after it does', async (ctx) => {
  const { api, t } = ctx;
  const f = freeDevice(ctx, () => undefined);
  const client = await f.client();
  const written = f.w.transport.written.length;
  const tooLarge = new Uint8Array(70_000);
  const error = await t.rejects('a payload too large for a frame', runVirtual(f.clock, client.callAny(api.ExtAppMessage.id as number, tooLarge)));
  t.ok('a protocol error', error instanceof api.TrezorProtocolError, String(error));
  t.eq('the outcome is known: nothing was written', false, (error as { outcomeUnknown?: boolean }).outcomeUnknown);
  t.eq('no packet was written', written, f.w.transport.written.length);
  t.ok('the connection is closed', client.isClosed);

  // After the first packet: the device does not answer, and the call times out.
  const g = freeDevice(ctx, () => undefined);
  const second = await g.client();
  const late = await t.rejects('a request the device never answers', runVirtual(g.clock, second.call(api.ExtAppLoad, loadRequest(api), api.ExtAppLoaded)));
  t.eq('the outcome is unknown', true, (late as { outcomeUnknown?: boolean }).outcomeUnknown);
});

add('guards', 'onAppLoading that returns a promise: a rejection is handled and not awaited', async (ctx) => {
  const { api, v, t } = ctx;
  const image = withModel(imageOf(api, v).image, 'T3W1');
  const attached: string[] = [];
  const f = freeDevice(ctx, (message) => (message.type === api.ExtAppLoad.id ? { send: [loadedMessage(api)] } : undefined));
  const thenable = {
    then(_resolved: unknown, rejected: unknown) {
      attached.push(typeof rejected);
    },
  };
  const signer = await f.connectWith((transport, options) =>
    api.connectTrezor({ ...options, transport, image, transactionSigningScheme: 'rfc8032' as never, onAppLoading: (() => thenable) as never }),
  );
  await macrotask();
  t.eq('a rejection handler was attached to what the callback returned', ['function'], attached);
  await signer.close();

  // A promise that never settles is not waited for; one that rejects is not an unhandled rejection.
  const never = freeDevice(ctx, (message) => (message.type === api.ExtAppLoad.id ? { send: [loadedMessage(api)] } : undefined));
  const unhandled: unknown[] = [];
  const g = globalThis as unknown as { addEventListener?: (type: string, listener: (event: unknown) => void) => void; removeEventListener?: (type: string, listener: (event: unknown) => void) => void };
  const listener = (event: unknown): void => void unhandled.push(event);
  g.addEventListener?.('unhandledrejection', listener);
  const rejecting = await never.connectWith((transport, options) =>
    api.connectTrezor({ ...options, transport, image, transactionSigningScheme: 'rfc8032' as never, onAppLoading: (() => Promise.reject(new Error('the status line failed'))) as never }),
  );
  await macrotask();
  await macrotask();
  g.removeEventListener?.('unhandledrejection', listener);
  t.ok('the connection went on', rejecting instanceof api.ThruTrezorSigner);
  t.eq('no unhandled rejection', 0, unhandled.length);
  await rejecting.close();
});

add('guards', 'a transport that reuses the array its read returned: the link keeps its own copy of a packet that waits to be taken', async (ctx) => {
  const { api, t } = ctx;
  const f = freeDevice(ctx, () => ({ ack: false })); // takes the request and says nothing
  const transport = f.w.transport;
  // The transport hands out the array it received and clears it once the macrotask is over, as one that reuses a buffer does.
  const read = transport.readPacket.bind(transport);
  transport.readPacket = () =>
    read().then((packet) => {
      void macrotask().then(() => packet.fill(0));
      return packet;
    });
  const client = await f.client();
  let release!: () => void;
  const held = new Promise<void>((resolve) => void (release = resolve));
  const start = transport.writesBegun;
  // The first retransmission is held while the acknowledgement arrives.
  transport.holdWrite = (index) => (index === start + 1 ? held : undefined);
  const call = client.callAny(api.ExtAppMessage.id as number, api.ExtAppMessage.encode({ instance_id: 3, message_id: 6, data: new Uint8Array(0) }));
  void call.catch(() => undefined);
  await macrotask();
  // The wait for the acknowledgement times out (200 ms); the retransmission starts and is held.
  f.clock.fireNext();
  await macrotask();
  await macrotask();
  const frame = f.free.receivedFrames[f.free.receivedFrames.length - 1][0];
  f.free.sendAck((frame[0] >> 4) & 1);
  await macrotask();
  await macrotask();
  release();
  await macrotask();
  await macrotask();
  t.eq('the acknowledgement that waited was taken whole: no packet was dropped as another channel\'s', 0, client.channel.stats.otherChannel);
  void call;
  transport.holdWrite = undefined;
  await client.close();
});

/** A raw answer of the device (a Core message) in the session of the client. */
const coreReply = (type: number, payload: Uint8Array): { send: DeviceMessage[] } => ({ send: [{ session: 1, type, payload }] });

const flagOf = (error: unknown): boolean | undefined => (error as { outcomeUnknown?: boolean } | undefined)?.outcomeUnknown;

add('guards', 'a signing request whose answer cannot be used says the outcome is unknown and closes the connection; a refusal of the device or the app is a known outcome', async (ctx) => {
  const { api, t } = ctx;
  const appReply = (id: number, data: Uint8Array) => coreReply(api.ExtAppResponse.id as number, api.ExtAppResponse.encode({ message_id: id, data }));
  const garbage = new Uint8Array([0xff, 0xff, 0xff, 0xff]);
  const body = new Uint8Array(10).fill(3);
  const text = new TextEncoder().encode('hello');
  const key = (n: number): Uint8Array => new Uint8Array(32).fill(n);
  const kinds: { name: string; signatureId: number; run: (app: ReturnType<Api['ThruApp']['attach']>) => Promise<unknown> }[] = [
    { name: 'transaction', signatureId: api.TxSignature.id as number, run: (app) => app.signTransaction(PATH, body) },
    { name: 'message', signatureId: api.MessageSignature.id as number, run: (app) => app.signMessage(PATH, text) },
    { name: 'EOA authorization', signatureId: api.EoaAuthSignature.id as number, run: (app) => app.signEoaAuth(PATH, 'create', 1, key(1), key(2)) },
  ];
  type Bad = (kind: { signatureId: number }) => { send: DeviceMessage[] };
  const unusable: [string, Bad][] = [
    ['another Core message type', () => coreReply(api.Success.id as number, api.Success.encode({}))],
    ['a Core payload that does not decode', () => coreReply(api.ExtAppResponse.id as number, garbage)],
    ['another message of the app', () => appReply(api.PublicKey.id as number, api.PublicKey.encode({ public_key: key(5), address: 'ta' }))],
    ['an app response that does not decode', (k) => appReply(k.signatureId, garbage)],
    ['a signature one byte short', (k) => appReply(k.signatureId, api.TxSignature.encode({ signature: new Uint8Array(63).fill(6) }))],
    ['a signature one byte long', (k) => appReply(k.signatureId, api.TxSignature.encode({ signature: new Uint8Array(65).fill(6) }))],
  ];
  const refusals: [string, Bad, string][] = [
    ['a Failure', () => coreReply(api.Failure.id as number, api.Failure.encode({ code: 1, message: 'Unexpected message' })), 'TrezorFailureError'],
    ['a refusal of the app', () => coreReply(api.Failure.id as number, api.Failure.encode({ code: 3, message: 'message_not_text' })), 'TrezorAppRefusedError'],
    ['the person\'s refusal', () => coreReply(api.Failure.id as number, api.Failure.encode({ code: 4, message: 'Action cancelled by user' })), 'TrezorCancelledError'],
  ];
  const attempt = async (kind: (typeof kinds)[number], bad: Bad): Promise<{ error: unknown; closed: boolean }> => {
    const f = freeDevice(ctx, (message) => {
      if (message.type !== api.ExtAppMessage.id) return undefined;
      const request = api.ExtAppMessage.decode(message.payload);
      // A transaction asks for its body first; the answer under test comes to the piece that completes it.
      if (request.message_id === api.SignTx.id) return appReply(api.TxDataRequest.id as number, api.TxDataRequest.encode({ offset: 0, length: body.length }));
      return bad(kind);
    });
    const client = await f.client();
    client.setLoadedApp(3);
    const error = await t.rejects(`${kind.name}`, runVirtual(f.clock, kind.run(api.ThruApp.attach(client, 3))));
    return { error, closed: client.isClosed };
  };
  for (const kind of kinds) {
    for (const [what, bad] of unusable) {
      const { error, closed } = await attempt(kind, bad);
      t.eq(`${kind.name}: ${what}: the outcome is unknown`, true, flagOf(error));
      t.ok(`${kind.name}: ${what}: the connection is closed`, closed);
    }
    for (const [what, bad, cls] of refusals) {
      const { error, closed } = await attempt(kind, bad);
      t.eq(`${kind.name}: ${what}: the class`, cls, (error as Error | undefined)?.constructor.name);
      t.eq(`${kind.name}: ${what}: the outcome is known`, false, flagOf(error));
      t.ok(`${kind.name}: ${what}: the connection stays open`, !closed);
    }
  }
});

add('guards', 'client.call: a signing request answered with the wrong codec or an undecodable payload says the outcome is unknown, a request that does not sign does not', async (ctx) => {
  const { api, t } = ctx;
  const answer = (type: number, payload: Uint8Array) => coreReply(type, payload);
  const signRequest = { instance_id: 3, message_id: api.SignMessage.id as number, data: api.SignMessage.encode({ address_n: [...PATH], message: new TextEncoder().encode('hi') }) };

  // The device reviews and answers ExtAppResponse; the caller named ExtAppLoaded as the answer.
  const wrong = freeDevice(ctx, (m) => (m.type === api.ExtAppMessage.id ? answer(api.ExtAppResponse.id as number, api.ExtAppResponse.encode({ message_id: 7, data: new Uint8Array(64) })) : undefined));
  const wrongClient = await wrong.client();
  const wrongError = await t.rejects('the wrong answer codec', runVirtual(wrong.clock, wrongClient.call(api.ExtAppMessage, signRequest, api.ExtAppLoaded)));
  t.ok('an unexpected-answer error', wrongError instanceof api.TrezorUnexpectedError, String(wrongError));
  t.eq('the outcome is unknown', true, flagOf(wrongError));
  t.ok('the connection is closed', wrongClient.isClosed);

  // The same through callAny, which answers the id and the payload and decodes nothing: the answer is usable there.
  const viaAny = freeDevice(ctx, (m) => (m.type === api.ExtAppMessage.id ? answer(api.ExtAppResponse.id as number, api.ExtAppResponse.encode({ message_id: 7, data: new Uint8Array(64) })) : undefined));
  const anyClient = await viaAny.client();
  const reply = await runVirtual(viaAny.clock, anyClient.callAny(api.ExtAppMessage.id as number, api.ExtAppMessage.encode(signRequest)));
  t.eq('callAny returns the answer as it came', api.ExtAppResponse.id, reply.id);
  await anyClient.close();

  // A payload that does not decode.
  const bad = freeDevice(ctx, (m) => (m.type === api.ExtAppMessage.id ? answer(api.ExtAppResponse.id as number, new Uint8Array([0xff, 0xff, 0xff])) : undefined));
  const badClient = await bad.client();
  const badError = await t.rejects('a payload that does not decode', runVirtual(bad.clock, badClient.call(api.ExtAppMessage, signRequest, api.ExtAppResponse)));
  t.ok('an unexpected-answer error', badError instanceof api.TrezorUnexpectedError, String(badError));
  t.eq('the outcome is unknown', true, flagOf(badError));
  t.ok('the connection is closed', badClient.isClosed);

  // A request that does not sign keeps its meaning: the answer was not usable, nothing says the device signed.
  const read = freeDevice(ctx, (m) => (m.type === api.ExtAppMessage.id ? answer(api.Success.id as number, api.Success.encode({})) : undefined));
  const readClient = await read.client();
  const readError = await t.rejects('a public-key request answered with another message', runVirtual(read.clock, readClient.call(api.ExtAppMessage, { instance_id: 3, message_id: api.GetPublicKey.id as number, data: api.GetPublicKey.encode({ address_n: [...PATH] }) }, api.ExtAppResponse)));
  t.ok('an unexpected-answer error', readError instanceof api.TrezorUnexpectedError, String(readError));
  t.eq('the outcome is known', false, flagOf(readError));
  t.ok('the connection is closed', readClient.isClosed);

  // A failure before the first packet of a signing request is a known outcome (a closed connection).
  const closed = freeDevice(ctx, () => undefined);
  const closedClient = await closed.client();
  closedClient.setLoadedApp(3);
  const app = api.ThruApp.attach(closedClient, 3);
  await closedClient.close();
  const early = await t.rejects('a signing request on a closed connection', app.signMessage(PATH, new TextEncoder().encode('hi')));
  t.eq('nothing was written: the outcome is known', false, flagOf(early));
});

add('guards', 'client.call: a request that does not sign, answered with a Failure that does not decode, says the outcome is known; a signing request says it is unknown', async (ctx) => {
  const { api, t } = ctx;
  const garbage = new Uint8Array([0xff, 0xff, 0xff, 0xff]);
  const readRequest = { instance_id: 3, message_id: api.GetPublicKey.id as number, data: api.GetPublicKey.encode({ address_n: [...PATH] }) };
  const signRequest = { instance_id: 3, message_id: api.SignMessage.id as number, data: api.SignMessage.encode({ address_n: [...PATH], message: new TextEncoder().encode('hi') }) };
  for (const [what, request, flag] of [['a request that does not sign', readRequest, false], ['a request that signs', signRequest, true]] as const) {
    const f = freeDevice(ctx, (m) => (m.type === api.ExtAppMessage.id ? coreReply(api.Failure.id as number, garbage) : undefined));
    const client = await f.client();
    const error = await t.rejects(what, runVirtual(f.clock, client.call(api.ExtAppMessage, request, api.ExtAppResponse)));
    t.ok(`${what}: an unexpected-answer error`, error instanceof api.TrezorUnexpectedError && /Failure could not be decoded/.test((error as Error).message), String(error));
    t.eq(`${what}: the outcome flag`, flag, flagOf(error));
    t.ok(`${what}: the connection is closed`, client.isClosed);
  }
});

add('guards', 'a custom request codec is read once, at the call: its output is copied and its ids and decoder are those of the call, whatever it does while the call waits', async (ctx) => {
  const { api, t } = ctx;
  const f = freeDevice(ctx, (message) => {
    if (message.type === api.ExtAppMessage.id) {
      return coreReply(api.ExtAppResponse.id as number, api.ExtAppResponse.encode({ message_id: 1, data: new Uint8Array([9, 9]) }));
    }
    return undefined;
  });
  const client = await f.client();
  // The first call is answered late: the second waits behind it.
  const first = client.call(api.ExtAppLoad, loadRequest(api), api.ExtAppLoaded);
  const original = api.ExtAppMessage.encode({ instance_id: 3, message_id: 6, data: new Uint8Array(40).fill(0x22) });
  const held = original.slice();
  const request = {
    id: api.ExtAppMessage.id,
    name: 'ExtAppMessage',
    encode: (): Uint8Array => original,
    decode: api.ExtAppMessage.decode,
  };
  let decoded = 0;
  const answerCodec = {
    id: api.ExtAppResponse.id,
    name: 'ExtAppResponse',
    decode: (bytes: Uint8Array) => {
      decoded++;
      return api.ExtAppResponse.decode(bytes);
    },
    encode: api.ExtAppResponse.encode,
  };
  const second = client.call(request as never, {} as never, answerCodec as never);
  // The codec changes everything it handed out while the call waits.
  original.fill(0xee);
  (request as { id: number }).id = 1;
  (request as { encode: unknown }).encode = () => {
    throw new Error('encoded again');
  };
  (answerCodec as { id: number }).id = 2;
  (answerCodec as { decode: unknown }).decode = () => {
    throw new Error('decoded by the changed codec');
  };
  f.clock.setTimeout(() => f.free.send(loadedMessage(api)), 100);
  const [, answer] = await runVirtual(f.clock, Promise.all([first, second]));
  t.eq('the answer was decoded by the decoder of the call', 1, decoded);
  t.eq('with the id of the call', 1, (answer as { message_id: number }).message_id);
  const sent = f.free.received.filter((m) => m.type === api.ExtAppMessage.id).map((m) => m.payload);
  t.eq('one request reached the device', 1, sent.length);
  t.eq('with the bytes the codec returned at the call', api.toHex(held), api.toHex(sent[0] ?? new Uint8Array(0)));

  await client.close();

  // The names are read at the call too: a diagnostic names what the call was made with, whatever the codec says later.
  for (const kind of ['another message', 'a payload that does not decode'] as const) {
    const g = freeDevice(ctx, (message) => (message.type === api.ExtAppMessage.id ? coreReply(api.ExtAppResponse.id as number, api.ExtAppResponse.encode({ message_id: 1, data: new Uint8Array(0) })) : undefined));
    const other = await g.client();
    const asked = { id: api.ExtAppMessage.id, name: 'RequestNameAtTheCall', encode: api.ExtAppMessage.encode, decode: api.ExtAppMessage.decode };
    const answers = {
      id: kind === 'another message' ? api.ExtAppLoaded.id : api.ExtAppResponse.id,
      name: 'AnswerNameAtTheCall',
      decode: kind === 'another message' ? api.ExtAppLoaded.decode : () => {
        throw new Error('cannot decode');
      },
      encode: api.ExtAppResponse.encode,
    };
    const gate = other.call(api.ExtAppLoad, loadRequest(api), api.ExtAppLoaded);
    const waiting = other.call(asked as never, { instance_id: 3, message_id: 6, data: new Uint8Array(0) } as never, answers as never);
    (asked as { name: string }).name = 'RequestNameChanged';
    (answers as { name: string }).name = 'AnswerNameChanged';
    g.clock.setTimeout(() => g.free.send(loadedMessage(api)), 100);
    const outcome = runVirtual(g.clock, Promise.all([gate, waiting]));
    const error = await t.rejects(`${kind}: the call fails`, outcome);
    const text = String((error as Error | undefined)?.message);
    if (kind === 'another message') {
      t.ok(`${kind}: names the request and the answer of the call`, /answer to RequestNameAtTheCall is message \d+, expected AnswerNameAtTheCall \(/.test(text), text);
    } else {
      t.ok(`${kind}: names the codec of the call`, /AnswerNameAtTheCall could not be decoded/.test(text), text);
    }
    t.ok(`${kind}: and not the names the codec has since`, !/Changed/.test(text), text);
  }
});


// ---- round 4: busy, callbacks, closing, class names ----

add('guards', 'a device that stays busy: a refusal of the first message of a request is a known outcome, one of a later message (the answer to a review screen) is not', async (ctx) => {
  const { api, v, t } = ctx;
  const channel = api.fromHex(scenarioOf(v, RECONNECT).inputs.channel_id);
  const signRequest = api.ExtAppMessage.encode({
    instance_id: 3,
    message_id: api.SignMessage.id as number,
    data: api.SignMessage.encode({ address_n: [...PATH], message: new TextEncoder().encode('hi') }),
  });
  type Run = (client: TrezorClient) => Promise<unknown>;
  const requests: [string, number, Run][] = [
    ['a signing request', api.ExtAppMessage.id as number, (client) => client.callAny(api.ExtAppMessage.id as number, signRequest)],
    ['a request that does not sign', api.ExtAppLoad.id as number, (client) => client.call(api.ExtAppLoad, loadRequest(api), api.ExtAppLoaded)],
  ];
  for (const [what, requestType, run] of requests) {
    for (const stage of ['first', 'later'] as const) {
      const refuse = { on: false };
      const f = freeDevice(ctx, (message) => {
        if (message.type !== requestType) return undefined;
        // The request is taken and the person is asked; from here on every message of the host is refused as busy.
        if (stage === 'later') refuse.on = true;
        return { send: [buttonRequest(api)] };
      });
      const client = await f.client();
      const original = f.w.transport.onWrite;
      f.w.transport.onWrite = (packet) => {
        if (refuse.on && (packet[0] & 0xe7) === 0x04) f.w.transport.push(errorFrame(api, channel, BUSY));
        else original(packet);
      };
      if (stage === 'first') refuse.on = true;
      const error = await t.rejects(`${what}: ${stage} message refused for ever`, runVirtual(f.clock, run(client)));
      t.ok(`${what}: ${stage}: a busy time-out`, error instanceof api.TrezorTimeoutError && error.kind === 'busy', String(error));
      t.eq(
        `${what}: ${stage}: the outcome is ${stage === 'first' ? 'known' : 'unknown'}`,
        stage === 'later',
        flagOf(error),
      );
      t.ok(`${what}: ${stage}: the connection is closed`, client.isClosed);
    }
  }
});

/** A device that reviews a message in two screens (the review, then the closing one) and then signs it. */
function twoScreenSigner(ctx: Ctx, code?: number): Free {
  const { api } = ctx;
  let screens = 0;
  return freeDevice(ctx, (message) => {
    if (message.type === api.ExtAppMessage.id) {
      screens = 1;
      return { send: [buttonRequest(api, code)] };
    }
    if (message.type === api.ButtonAck.id) {
      if (screens === 1) {
        screens = 2;
        return { send: [buttonRequest(api, code)] };
      }
      return coreReply(
        api.ExtAppResponse.id as number,
        api.ExtAppResponse.encode({ message_id: api.MessageSignature.id as number, data: api.MessageSignature.encode({ signature: new Uint8Array(64).fill(6) }) }),
      );
    }
    return undefined;
  });
}

add('guards', 'a notification callback of the application never ends an exchange: a throw at the review or at the closing screen, a rejected promise, a thenable that throws', async (ctx) => {
  const { api, t } = ctx;
  const unhandled: unknown[] = [];
  const g = globalThis as unknown as {
    addEventListener?: (type: string, listener: (event: unknown) => void) => void;
    removeEventListener?: (type: string, listener: (event: unknown) => void) => void;
    process?: { on?: (type: string, listener: (reason: unknown) => void) => void; off?: (type: string, listener: (reason: unknown) => void) => void };
  };
  const listener = (event: unknown): void => void unhandled.push(event);
  g.addEventListener?.('unhandledrejection', listener);
  g.process?.on?.('unhandledRejection', listener);
  try {
    const behaviours: [string, (screen: number) => unknown][] = [
      ['an Error thrown at the review', (screen) => {
        if (screen === 1) throw new Error('the status line broke');
        return undefined;
      }],
      ['an Error thrown at the closing screen', (screen) => {
        if (screen === 2) throw new Error('the status line broke');
        return undefined;
      }],
      ['a value that is not an Error thrown at the closing screen', (screen) => {
        if (screen === 2) throw 'broken';
        return undefined;
      }],
      ['a rejected promise at the closing screen', (screen) => (screen === 2 ? Promise.reject(new Error('the status line failed')) : undefined)],
      ['a thenable that throws', () => ({
        then() {
          throw new Error('thenable');
        },
      })],
      ['a thenable that rejects', () => ({
        then(_resolve: unknown, reject: (reason: unknown) => void) {
          reject(new Error('thenable rejected'));
        },
      })],
    ];
    for (const [what, behave] of behaviours) {
      for (const via of ['confirm', 'passphrase'] as const) {
        const f = twoScreenSigner(ctx, via === 'passphrase' ? 19 : undefined);
        let screen = 0;
        const callback = (): unknown => behave(++screen);
        const client = await f.connectWith((transport, options) =>
          api.TrezorClient.connect(transport, {
            ...options,
            ui: via === 'passphrase'
              ? { pairingCode: () => '000000', enterPassphraseOnDevice: callback as never }
              : { pairingCode: () => '000000', confirmOnDevice: callback as never },
          }),
        );
        client.setLoadedApp(3);
        const app = api.ThruApp.attach(client, 3);
        const signature = await runVirtual(f.clock, app.signMessage(PATH, new TextEncoder().encode('hello')));
        t.eq(`${what}: the call returns the signature`, 64, signature.length);
        t.ok(`${what}: the connection stays open`, !client.isClosed);
        t.eq(`${what}: both screens were answered`, 2, f.free.received.filter((m) => m.type === api.ButtonAck.id).length);
        await client.close();
      }
    }
    await macrotask();
    await macrotask();
    t.eq('no unhandled rejection', 0, unhandled.length);
  } finally {
    g.removeEventListener?.('unhandledrejection', listener);
    g.process?.off?.('unhandledRejection', listener);
  }
});

add('guards', 'a public key answer that fails validation ends the connection; the next call fails as closed', async (ctx) => {
  const { api, t } = ctx;
  const appReply = (id: number, data: Uint8Array) => coreReply(api.ExtAppResponse.id as number, api.ExtAppResponse.encode({ message_id: id, data }));
  const answers: [string, () => { send: DeviceMessage[] }][] = [
    ['an answer of another app message', () => appReply(api.TxSignature.id as number, api.TxSignature.encode({ signature: new Uint8Array(64) }))],
    ['an answer that does not decode', () => appReply(api.PublicKey.id as number, new Uint8Array([0xff, 0xff, 0xff, 0xff]))],
    ['a key of 31 bytes', () => appReply(api.PublicKey.id as number, api.PublicKey.encode({ public_key: new Uint8Array(31).fill(5), address: 'ta' }))],
    ['a key of 33 bytes', () => appReply(api.PublicKey.id as number, api.PublicKey.encode({ public_key: new Uint8Array(33).fill(5), address: 'ta' }))],
  ];
  for (const [what, reply] of answers) {
    const f = freeDevice(ctx, (message) => (message.type === api.ExtAppMessage.id ? reply() : undefined));
    const client = await f.client();
    client.setLoadedApp(3);
    const app = api.ThruApp.attach(client, 3);
    const error = await t.rejects(what, runVirtual(f.clock, app.getPublicKey(PATH)));
    t.ok(`${what}: an app error`, error instanceof api.TrezorAppError, String(error));
    t.ok(`${what}: the connection is closed`, client.isClosed);
    const later = await t.rejects(`${what}: a later call`, runVirtual(f.clock, app.getPublicKey(PATH)));
    t.ok(`${what}: fails as closed`, later instanceof api.TrezorClosedError, String(later));
  }
  // A Failure is the app's answer to the request and leaves the connection as it was.
  const refused = freeDevice(ctx, (message) => (message.type === api.ExtAppMessage.id ? coreReply(api.Failure.id as number, api.Failure.encode({ code: 3, message: 'path_not_allowed' })) : undefined));
  const client = await refused.client();
  client.setLoadedApp(3);
  await t.rejects('a refusal', runVirtual(refused.clock, api.ThruApp.attach(client, 3).getPublicKey(PATH)));
  t.ok('a refusal leaves the connection open', !client.isClosed);
  await client.close();
});

add('guards', 'loadApp: a response that fails validation in the middle of a load ends the connection the loader was given; a refusal of the device does not', async (ctx) => {
  const { api, v, t } = ctx;
  const image = withModel(imageOf(api, v).image, 'T3W1');
  const headerRequest = coreReply(api.ExtAppHeaderRequest.id as number, api.ExtAppHeaderRequest.encode({}));
  const chunkRequest = (index: number) => coreReply(api.ExtAppDataChunkRequest.id as number, api.ExtAppDataChunkRequest.encode({ index }));
  type Step = (message: DeviceMessage) => { send: DeviceMessage[] } | undefined;
  const afterHeader = (reply: () => { send: DeviceMessage[] }): Step => (message) => {
    if (message.type === api.ExtAppLoad.id) return headerRequest;
    if (message.type === api.ExtAppHeaderAck.id) return reply();
    return undefined;
  };
  const cases: [string, Step, 'closed' | 'open'][] = [
    ['a request for a chunk the image does not have', afterHeader(() => chunkRequest(image.chunks.length + 5)), 'closed'],
    ['a chunk request that does not decode', afterHeader(() => coreReply(api.ExtAppDataChunkRequest.id as number, new Uint8Array([0xff, 0xff, 0xff, 0xff]))), 'closed'],
    ['an answer of another type', afterHeader(() => coreReply(api.Success.id as number, api.Success.encode({}))), 'closed'],
    ['a refusal of the device', afterHeader(() => coreReply(api.Failure.id as number, api.Failure.encode({ code: 1, message: 'Unexpected message' }))), 'open'],
  ];
  for (const [what, step, state] of cases) {
    const f = freeDevice(ctx, step);
    const client = await f.client();
    const error = await t.rejects(what, runVirtual(f.clock, api.loadApp(client, image)));
    t.ok(`${what}: the loader fails`, error instanceof api.TrezorError, String(error));
    t.eq(`${what}: the connection is ${state}`, state === 'closed', client.isClosed);
    if (state === 'closed') {
      const later = await t.rejects(`${what}: a later call`, runVirtual(f.clock, client.call(api.ExtAppLoad, loadRequest(api), api.ExtAppLoaded)));
      t.ok(`${what}: fails as closed`, later instanceof api.TrezorClosedError, String(later));
      const again = await t.rejects(`${what}: a later load`, runVirtual(f.clock, api.ThruApp.load(client, image)));
      t.ok(`${what}: fails as closed too`, again instanceof api.TrezorClosedError, String(again));
    } else await client.close();
  }
  // A load that completes is not touched.
  const g = freeDevice(ctx, (message) => (message.type === api.ExtAppLoad.id ? { send: [loadedMessage(api)] } : undefined));
  const ok = await g.client();
  const loaded = await runVirtual(g.clock, api.loadApp(ok, image));
  t.eq('a load that completes', 3, loaded.instanceId);
  t.ok('leaves the connection open', !ok.isClosed);
  await ok.close();
});

add('guards', 'loadApp: an abort between two exchanges of a load ends the connection; one before anything was sent does not', async (ctx) => {
  const { api, v, t } = ctx;
  const image = withModel(imageOf(api, v).image, 'T3W1');
  const headerRequest = coreReply(api.ExtAppHeaderRequest.id as number, api.ExtAppHeaderRequest.encode({}));
  const device = (message: DeviceMessage) => (message.type === api.ExtAppLoad.id ? headerRequest : undefined);

  // The signal fires once the header request has been read and before the next message is sent.
  const between = freeDevice(ctx, device);
  const client = await between.client();
  const controller = new AbortController();
  const callAny = client.callAny.bind(client);
  client.callAny = async (id, payload, options) => {
    const answer = await callAny(id, payload, options);
    if (id === (api.ExtAppLoad.id as number)) controller.abort();
    return answer;
  };
  const error = await t.rejects('an abort after the header request', runVirtual(between.clock, api.loadApp(client, image, { signal: controller.signal })));
  t.ok('an aborted error', error instanceof api.TrezorAbortedError, String(error));
  t.ok('the connection is closed', client.isClosed);
  t.eq('the device was sent the load request only', [api.ExtAppLoad.id], between.free.received.filter((m) => m.type === api.ExtAppLoad.id || m.type === api.ExtAppHeaderAck.id).map((m) => m.type));
  const later = await t.rejects('a later call', runVirtual(between.clock, client.call(api.ExtAppLoad, loadRequest(api), api.ExtAppLoaded)));
  t.ok('fails as closed', later instanceof api.TrezorClosedError, String(later));

  // Aborted before the load began: nothing was sent, the connection stays as it was.
  const before = freeDevice(ctx, device);
  const open = await before.client();
  const early = new AbortController();
  early.abort();
  const refused = await t.rejects('an abort before anything was sent', runVirtual(before.clock, api.loadApp(open, image, { signal: early.signal })));
  t.ok('an aborted error', refused instanceof api.TrezorAbortedError, String(refused));
  t.ok('the connection is open', !open.isClosed);
  t.eq('and no load request reached the device', 0, before.free.received.filter((m) => m.type === api.ExtAppLoad.id).length);
  await open.close();
});

// ---- running ----

export function driverCases(): { group: string; name: string }[] {
  return cases.map(({ group, name }) => ({ group, name }));
}

/** Runs one case; a case that throws is a failed case, not a crashed run. */
export async function runDriverCase(api: Api, vectors: Vectors, index: number): Promise<CaseResult> {
  const { group, name, run } = cases[index];
  const { check, failures, count } = newCheck();
  try {
    await run({ api, v: vectors, t: check });
  } catch (error) {
    failures.push({
      label: `${name}: the case itself threw`,
      expected: 'no exception',
      actual: String((error as Error)?.stack ?? error),
    });
  }
  return { group, name, checks: count(), failures };
}

export async function runAllDriverCases(api: Api, vectors: Vectors): Promise<CaseResult[]> {
  const results: CaseResult[] = [];
  for (let i = 0; i < cases.length; i++) results.push(await runDriverCase(api, vectors, i));
  return results;
}
