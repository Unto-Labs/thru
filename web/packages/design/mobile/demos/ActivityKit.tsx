/* Visual reference for the Activity parts of @thru/design/mobile (the
   UNTO-3095 handoff, §10): the row catalogue (every kind, done, pending and
   failed), the feed's four states, the detail's pieces, and the desktop
   sidebar, in light and dark. The detail sheet (the Activity sheet handoff,
   §9) opens live from the "Detail sheet" section, with its loading and
   failed bodies and the expanded Transaction details drawn beside it.

   Reference only, like LoadingLab.tsx: not exported and not mounted by any
   app. The screens built from these are in web/wallet-app. */

import { useState, type ComponentType } from 'react';
import { Pressable, Text, View } from 'react-native';
import {
  ActivityRow,
  Button,
  DataCard,
  DetailSkeleton,
  DetentSheet,
  IconButton,
  IconClose,
  IconReceipt,
  IconShareOut,
  KeyValueGrid,
  SheetFooter,
  SheetHeader,
  type SheetDetent,
  ActivitySkeleton,
  DesktopSidebar,
  DetailHero,
  Disclosure,
  EmptyState,
  IconAccount,
  IconArrowIn,
  IconArrowOut,
  IconClock,
  IconCode,
  IconHome,
  IconKey,
  IconSettings,
  IconSignIn,
  IconTray,
  InlineError,
  LargeTitle,
  MetaTable,
  NavBar,
  Screen,
  SectionLabel,
  Segmented,
  ThemeProvider,
  font,
  makeStyles,
  space,
  text,
  touch,
  type ActivityAmountTone,
  type ActivityRowStatus,
  type IconProps,
  type IconTileTone,
  type ThemeName,
} from '../src';

/* Same reason as the loading lab: a host pinned to light never reports dark,
   so an explicit preference is the only way to see these in dark. */
export function ActivityKitScreen() {
  const [theme, setTheme] = useState<ThemeName>('light');
  return (
    <ThemeProvider preference={theme}>
      <ActivityKit theme={theme} onToggleTheme={setTheme} />
    </ThemeProvider>
  );
}

interface Kind {
  title: string;
  icon: ComponentType<IconProps>;
  incoming?: boolean;
  sub: string;
  amount?: string;
}

/* The handoff's sample data (History Feed.dc.html). */
const KINDS: Kind[] = [
  { title: 'Sent', icon: IconArrowOut, sub: 'to taB3…9kDe', amount: '$10.00' },
  { title: 'Received', icon: IconArrowIn, incoming: true, sub: 'from ta7Q…x2Lp', amount: '$25.00' },
  { title: 'Deposit', icon: IconTray, incoming: true, sub: '', amount: '$50.00' },
  { title: 'Account created', icon: IconAccount, sub: 'Main · ta1k…9fq2' },
  { title: 'Signed in', icon: IconSignIn, sub: 'Safari on iPhone' },
  { title: 'Signing session created', icon: IconClock, sub: 'Expires Oct 6, 9:41 AM' },
  { title: 'Signing session ended', icon: IconClock, sub: '' },
  { title: 'Passkey added', icon: IconKey, sub: 'iPhone 17 Pro' },
  { title: 'Passkey removed', icon: IconKey, sub: 'iPhone 17 Pro' },
  { title: 'Unknown program', icon: IconCode, sub: 'Program taAM…7mQs' },
];

function rowOf(kind: Kind, status: ActivityRowStatus) {
  const tone: IconTileTone =
    status === 'failed' ? 'failed' : status === 'pending' ? 'pending' : kind.incoming ? 'incoming' : 'neutral';
  const amountTone: ActivityAmountTone = status !== 'done' ? 'muted' : kind.incoming ? 'in' : 'out';
  const amount = kind.amount ? `${kind.incoming ? '+' : '−'}${kind.amount}` : null;
  return (
    <ActivityRow
      key={`${kind.title}-${status}`}
      icon={kind.icon}
      tone={tone}
      title={kind.title}
      status={status}
      sub={kind.sub || null}
      amount={amount}
      amountTone={amountTone}
      time="2:14 PM"
      accessibilityLabel={`${kind.title}${status === 'done' ? '' : `, ${status}`}, 2:14 PM`}
      onPress={() => undefined}
    />
  );
}

const PRESETS = [
  { value: 'all', label: 'All' },
  { value: 'deposits', label: 'Deposits' },
  { value: 'transfers', label: 'Transfers' },
  { value: 'account', label: 'Account' },
] as const;

function ActivityKit({
  theme,
  onToggleTheme,
}: {
  theme: ThemeName;
  onToggleTheme: (next: ThemeName) => void;
}) {
  const styles = useStyles();
  const [preset, setPreset] = useState<(typeof PRESETS)[number]['value']>('all');
  const [sheetOpen, setSheetOpen] = useState(false);
  const [detent, setDetent] = useState<SheetDetent>('half');
  const sheetHeader = (
    <SheetHeader
      icon={IconArrowIn}
      tone="incoming"
      title="Received"
      actions={
        <>
          <IconButton icon={IconShareOut} accessibilityLabel="Share" onPress={() => undefined} />
          <IconButton icon={IconClose} accessibilityLabel="Close" onPress={() => setSheetOpen(false)} />
        </>
      }
    />
  );
  const thruScan = (
    <SheetFooter>
      <Button label="View on ThruScan" onPress={() => undefined} variant="outline" icon={<IconArrowOut size={16} />} iconPosition="end" />
    </SheetFooter>
  );
  const sheetBody = (
    <>
      <DetailHero compact amount="+$25.00" amountTone="in" status="done" />
      <MetaTable
        variant="detail"
        rows={[
          { label: 'Date & time', value: 'Oct 2, 2026 · 2:14:05 PM' },
          { label: 'From', value: 'ta7Q…x2Lp', copy: true, copyLabel: 'Copy address' },
          { label: 'To', value: 'You' },
          { label: 'Network', value: 'thru-alphanet' },
          { label: 'Signature', value: '3nVq…8Hd2', copy: true },
        ]}
        onCopy={() => undefined}
      />
      <Disclosure title="Transaction details" open={detent === 'full'} onToggle={(open) => setDetent(open ? 'full' : 'half')}>
        <MetaTable
          variant="detail"
          rows={[
            { label: 'Program', value: 'Token program' },
            { label: 'Fee payer', value: 'ta7Q…x2Lp' },
            { label: 'Slot', value: '1,234,567' },
            { label: 'Instruction', value: 'transfer' },
          ]}
        />
        <View style={styles.decoded}>
          <SectionLabel tone="muted">Decoded data</SectionLabel>
          <DataCard title="transfer" meta="instruction 0" defaultOpen>
            <KeyValueGrid rows={[['amount', '25000000'], ['decimals', '6'], ['source', 'ta7Q…x2Lp'], ['destination', 'ta1k…9fq2']]} />
          </DataCard>
          <DataCard title="TransferEvent" meta="event 0">
            <KeyValueGrid rows={[['from', 'ta7Q…x2Lp'], ['to', 'ta1k…9fq2'], ['amount', '25000000']]} />
          </DataCard>
          <DataCard title="Raw instruction bytes" meta="1 instruction · 164 bytes" action={{ label: 'Copy', accessibilityLabel: 'Copy raw instruction bytes', onPress: () => undefined }}>
            <Text style={styles.hex}>01 00 02 05 3a 1f 9c 44 d2 07 e1 5b 88 90 0c 3f</Text>
          </DataCard>
        </View>
      </Disclosure>
    </>
  );
  return (
    <Screen>
      <NavBar
        title="Activity kit"
        right={
          <Pressable
            accessibilityLabel={`Switch to ${theme === 'light' ? 'dark' : 'light'} theme`}
            accessibilityRole="button"
            hitSlop={8}
            onPress={() => onToggleTheme(theme === 'light' ? 'dark' : 'light')}
          >
            <Text style={styles.themeToggle}>{theme === 'light' ? 'DARK' : 'LIGHT'}</Text>
          </Pressable>
        }
      />

      <LargeTitle title="Activity" />
      <View style={styles.inset}>
        <Segmented accessibilityLabel="Filter" options={PRESETS} value={preset} onChange={setPreset} />
      </View>

      <SectionLabel tone="muted" style={styles.section}>
        Row catalogue
      </SectionLabel>
      {(['done', 'pending', 'failed'] as const).map((status) => (
        <View key={status}>
          <SectionLabel style={styles.subsection}>{status}</SectionLabel>
          <View style={styles.rule}>{KINDS.map((kind) => rowOf(kind, status))}</View>
        </View>
      ))}

      <SectionLabel tone="muted" style={styles.section}>
        Feed states
      </SectionLabel>
      <SectionLabel style={styles.subsection}>Loading</SectionLabel>
      <ActivitySkeleton />
      <SectionLabel style={styles.subsection}>Load failed</SectionLabel>
      <EmptyState
        variant="error"
        title="Couldn't load your transactions"
        body="Check your connection and try again."
        action={{ label: 'Try again', onPress: () => undefined }}
        style={styles.state}
      />
      <SectionLabel style={styles.subsection}>Refresh failed</SectionLabel>
      <InlineError message="Couldn't refresh — showing what loaded earlier." onAction={() => undefined} />
      <View style={styles.rule}>{KINDS.slice(0, 2).map((kind) => rowOf(kind, 'done'))}</View>
      <SectionLabel style={styles.subsection}>Empty · Deposits</SectionLabel>
      <EmptyState title="No deposits yet" body="Money you add to your wallet shows up here." style={styles.state} />

      <SectionLabel tone="muted" style={styles.section}>
        Detail
      </SectionLabel>
      <DetailHero icon={IconArrowIn} tone="incoming" title="Received" amount="+$25.00" amountTone="in" status="done" />
      <DetailHero
        icon={IconArrowOut}
        tone="failed"
        title="Sent"
        amount="−$5.00"
        amountTone="muted"
        status="failed"
        reason="Not enough $ in your account when it ran. Nothing left your account."
      />
      <DetailHero icon={IconClock} tone="neutral" title="Signing session created" status="done" />
      <MetaTable
        variant="detail"
        rows={[
          { label: 'Date & time', value: 'Oct 2, 2026 · 2:14:05 PM' },
          { label: 'From', value: 'ta7Q…x2Lp', copy: true, copyLabel: 'Copy address' },
          { label: 'To', value: 'You' },
          { label: 'Network', value: 'thru-alphanet' },
          { label: 'Signature', value: '3nVq…8Hd2', copy: true },
        ]}
        onCopy={() => undefined}
        copied="Signature"
      />
      <Disclosure title="Technical details" defaultOpen>
        <MetaTable
          variant="detail"
          rows={[
            { label: 'Program', value: 'Token program' },
            { label: 'Fee payer', value: 'You' },
            { label: 'Slot', value: '1,234,567' },
            { label: 'Error', value: 'InsufficientFunds (4)' },
          ]}
        />
      </Disclosure>

      <SectionLabel tone="muted" style={styles.section}>
        Detail sheet
      </SectionLabel>
      <View style={styles.inset}>
        <Button label="Open the sheet" variant="outline" onPress={() => { setDetent('half'); setSheetOpen(true); }} />
      </View>
      <DetentSheet
        visible={sheetOpen}
        accessibilityLabel="Received, +$25.00, Completed"
        detent={detent}
        onDetentChange={setDetent}
        onDismiss={() => setSheetOpen(false)}
        header={sheetHeader}
        footer={thruScan}
      >
        {sheetBody}
      </DetentSheet>
      <SectionLabel style={styles.subsection}>Loading, opened from a link</SectionLabel>
      <View style={styles.frame}>
        <SheetHeader title="" loading actions={<IconButton icon={IconClose} accessibilityLabel="Close" onPress={() => undefined} />} />
        <DetailSkeleton />
      </View>
      <SectionLabel style={styles.subsection}>Couldn't load</SectionLabel>
      <View style={styles.frame}>
        <SheetHeader icon={IconReceipt} title="Details" actions={<IconButton icon={IconClose} accessibilityLabel="Close" onPress={() => undefined} />} />
        <InlineError message="Couldn't load this transaction." actionLabel="Try again" onAction={() => undefined} />
        <MetaTable variant="detail" rows={[{ label: 'Signature', value: '3nVq…8Hd2', copy: true }]} onCopy={() => undefined} />
        {thruScan}
      </View>
      <SectionLabel style={styles.subsection}>Expanded</SectionLabel>
      <View style={styles.frame}>
        {sheetHeader}
        <DetailHero compact amount="−$5.00" amountTone="muted" status="failed" reason="Not enough $ in your account when it ran. Nothing left your account." />
        <MetaTable variant="detail" rows={[{ label: 'Error', value: 'InsufficientFunds (4)', danger: true }]} />
        {sheetBody}
      </View>

      <SectionLabel tone="muted" style={styles.section}>
        Desktop sidebar
      </SectionLabel>
      <View style={styles.sidebarFrame}>
        <DesktopSidebar
          items={[
            { key: 'home', label: 'Home', Icon: IconHome },
            { key: 'activity', label: 'Activity', Icon: IconClock },
            { key: 'settings', label: 'Settings', Icon: IconSettings },
          ]}
          active="activity"
          onChange={() => undefined}
          account={{ name: 'Main', address: 'ta1kqVxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx9fq2' }}
        />
      </View>
    </Screen>
  );
}

const useStyles = makeStyles((c) => ({
  themeToggle: { fontFamily: font.monoSemiBold, fontSize: text.xxs, color: c.accent },
  inset: { paddingHorizontal: touch.screenX, paddingBottom: space[2] },
  section: { paddingHorizontal: touch.screenX, paddingTop: space[6], paddingBottom: space[2] },
  subsection: { paddingHorizontal: touch.screenX, paddingTop: space[4], paddingBottom: space[2] },
  rule: { borderTopWidth: 1, borderTopColor: c.bgMuted },
  state: { flex: 0, paddingTop: space[5], paddingBottom: space[5] },
  sidebarFrame: { height: 420, flexDirection: 'row' },
  frame: { borderTopWidth: 1, borderBottomWidth: 1, borderColor: c.border },
  decoded: { gap: 8, padding: touch.screenX },
  hex: { fontFamily: font.mono, fontSize: 12, lineHeight: 18, color: c.fg },
}));
