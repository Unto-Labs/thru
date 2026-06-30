import { useState } from "react";
import {
  // Actions
  Button,
  // Forms
  Input,
  Select,
  Checkbox,
  Switch,
  RadioGroup,
  Toggle,
  ToggleGroup,
  NumberField,
  OTPField,
  Slider,
  Field,
  Fieldset,
  Form,
  // Overlays
  Dialog,
  AlertDialog,
  Popover,
  Tooltip,
  PreviewCard,
  Combobox,
  Autocomplete,
  Menu,
  // Navigation & Disclosure
  Tabs,
  Accordion,
  Collapsible,
  NavigationMenu,
  ScrollArea,
  Toolbar,
  // Display
  Card,
  Tag,
  Avatar,
  Progress,
  Meter,
  Separator,
  Spinner,
  Address,
  Timestamp,
  Banner,
  Skeleton,
  Detail,
  // Typography
  Heading1,
  Heading2,
  Heading3,
  Heading4,
  Heading5,
  Body1,
  Body3,
  Body4,
  Body5,
  Ui1,
  Ui2,
  Ui3,
  Ui4,
  Ui5,
  Button1,
  Paragraph,
  Text,
  Toast,
  // Wallet
  Disc,
  ChainIcon,
  TokenIcon,
  ButtonArea,
  CopyButton,
  Spacer,
  ShowAfter,
  ThemeSwitch,
  Balance,
  ChainsPath,
  Details,
  Deposit,
  Frame,
  Screen,
  PresetsInput,
  chainMeta,
  tokenMeta,
  type ColorScheme,
} from "@thru/design/web";

/* ---- layout helpers ---------------------------------------------------- */

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section style={{ marginBottom: 56 }}>
      <Heading3 style={{ marginBottom: 4 }}>{title}</Heading3>
      <Separator />
      <div style={{ display: "grid", gap: 28, marginTop: 20 }}>{children}</div>
    </section>
  );
}

function Demo({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <Ui4 as="div" style={{ marginBottom: 10, opacity: 0.6 }}>
        {label}
      </Ui4>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 16,
          alignItems: "center",
        }}
      >
        {children}
      </div>
    </div>
  );
}

const CHAINS = ["Ethereum", "Bitcoin", "Solana", "Polygon", "Arbitrum", "Base"];

/* ---- sections ---------------------------------------------------------- */

function ActionsSection() {
  return (
    <Section title="Actions">
      <Demo label="Button — variants">
        <Button variant="primary">Primary</Button>
        <Button variant="secondary">Secondary</Button>
        <Button variant="outline">Outline</Button>
        <Button variant="ghost">Ghost</Button>
      </Demo>
      <Demo label="Button — sizes & disabled">
        <Button size="md">Medium</Button>
        <Button size="sm">Small</Button>
        <Button size="xs">Extra-small</Button>
        <Button disabled>Disabled</Button>
      </Demo>
    </Section>
  );
}

function FormsSection() {
  const [checked, setChecked] = useState(true);
  const [on, setOn] = useState(true);
  const [radio, setRadio] = useState("eth");
  const [toggle, setToggle] = useState(false);
  const [toggleGroup, setToggleGroup] = useState<string[]>(["bold"]);
  const [select, setSelect] = useState("mainnet");
  const [slider, setSlider] = useState<number>(40);

  return (
    <Section title="Forms">
      <Demo label="Input">
        <Input label="RPC endpoint" placeholder="https://rpc.thru.org" />
        <Input label="With error" defaultValue="bad value" error />
      </Demo>

      <Demo label="Select">
        <Select
          value={select}
          onValueChange={setSelect}
          items={[
            { label: "Mainnet", value: "mainnet" },
            { label: "Testnet", value: "testnet" },
            { label: "Devnet", value: "devnet" },
          ]}
          ariaLabel="Network"
        />
      </Demo>

      <Demo label="Checkbox">
        <Checkbox checked={checked} onCheckedChange={setChecked}>
          Accept terms
        </Checkbox>
        <Checkbox indeterminate>Indeterminate</Checkbox>
        <Checkbox disabled>Disabled</Checkbox>
      </Demo>

      <Demo label="Switch">
        <Switch checked={on} onCheckedChange={setOn} label="Notifications" />
        <Switch disabled label="Disabled" />
      </Demo>

      <Demo label="RadioGroup">
        <RadioGroup
          value={radio}
          onValueChange={setRadio}
          options={[
            { label: "Ethereum", value: "eth" },
            { label: "Solana", value: "sol" },
            { label: "Bitcoin (soon)", value: "btc", disabled: true },
          ]}
        />
      </Demo>

      <Demo label="Toggle / ToggleGroup">
        <Toggle pressed={toggle} onPressedChange={setToggle}>
          Watch
        </Toggle>
        <ToggleGroup.Group value={toggleGroup} onValueChange={setToggleGroup}>
          <ToggleGroup.Item value="bold">B</ToggleGroup.Item>
          <ToggleGroup.Item value="italic">I</ToggleGroup.Item>
          <ToggleGroup.Item value="underline">U</ToggleGroup.Item>
        </ToggleGroup.Group>
      </Demo>

      <Demo label="NumberField">
        <NumberField.Root defaultValue={12} min={0} max={100}>
          <NumberField.Group>
            <NumberField.Decrement>−</NumberField.Decrement>
            <NumberField.Input />
            <NumberField.Increment>+</NumberField.Increment>
          </NumberField.Group>
        </NumberField.Root>
      </Demo>

      <Demo label="OTPField">
        <OTPField.Root length={6}>
          {Array.from({ length: 6 }).map((_, i) => (
            <OTPField.Input key={i} />
          ))}
        </OTPField.Root>
      </Demo>

      <Demo label="Slider">
        <div style={{ width: 280 }}>
          <Slider.Root
            value={slider}
            onValueChange={(v) => setSlider(v as number)}
          >
            <Slider.Head>
              <span>slippage</span>
              <Slider.Value />
            </Slider.Head>
            <Slider.Control>
              <Slider.Track>
                <Slider.Indicator />
                <Slider.Thumb />
              </Slider.Track>
            </Slider.Control>
          </Slider.Root>
        </div>
      </Demo>

      <Demo label="Field / Fieldset / Form">
        <Form
          style={{ width: 320 }}
          onSubmit={(e) => e.preventDefault()}
        >
          <Fieldset.Root>
            <Fieldset.Legend>Connection</Fieldset.Legend>
            <Field.Root>
              <Field.Label>RPC endpoint</Field.Label>
              <Field.Control placeholder="https://rpc.thru.org" />
              <Field.Description>Used for read calls only.</Field.Description>
              <Field.Error />
            </Field.Root>
          </Fieldset.Root>
          <Spacer size={12} />
          <Button type="submit">Validate</Button>
        </Form>
      </Demo>
    </Section>
  );
}

function OverlaysSection() {
  return (
    <Section title="Overlays">
      <Demo label="Dialog">
        <Dialog.Root>
          <Dialog.Trigger render={<Button />}>Open dialog</Dialog.Trigger>
          <Dialog.Portal>
            <Dialog.Backdrop />
            <Dialog.Popup>
              <Dialog.Head>
                <Dialog.Title>Confirm action</Dialog.Title>
                <Dialog.Close render={<Button variant="ghost" size="sm" />}>
                  esc ×
                </Dialog.Close>
              </Dialog.Head>
              <Dialog.Description>
                This is a standard dialog with a backdrop you can click to
                dismiss.
              </Dialog.Description>
              <Dialog.Footer>
                <Dialog.Close render={<Button variant="outline" />}>
                  Cancel
                </Dialog.Close>
                <Dialog.Close render={<Button />}>Confirm</Dialog.Close>
              </Dialog.Footer>
            </Dialog.Popup>
          </Dialog.Portal>
        </Dialog.Root>
      </Demo>

      <Demo label="AlertDialog">
        <AlertDialog.Root>
          <AlertDialog.Trigger render={<Button variant="outline" />}>
            Delete…
          </AlertDialog.Trigger>
          <AlertDialog.Portal>
            <AlertDialog.Backdrop />
            <AlertDialog.Popup>
              <AlertDialog.Title>Delete wallet?</AlertDialog.Title>
              <AlertDialog.Description>
                This action cannot be undone.
              </AlertDialog.Description>
              <AlertDialog.Footer>
                <AlertDialog.Close render={<Button variant="outline" />}>
                  Cancel
                </AlertDialog.Close>
                <AlertDialog.Close render={<Button />}>Delete</AlertDialog.Close>
              </AlertDialog.Footer>
            </AlertDialog.Popup>
          </AlertDialog.Portal>
        </AlertDialog.Root>
      </Demo>

      <Demo label="Popover">
        <Popover.Root>
          <Popover.Trigger render={<Button variant="secondary" />}>
            Details
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Positioner sideOffset={8}>
              <Popover.Popup>
                <Popover.Title>Network info</Popover.Title>
                <Popover.Description>
                  Connected to Mainnet. Block height 19,482,109.
                </Popover.Description>
                <Popover.Arrow />
              </Popover.Popup>
            </Popover.Positioner>
          </Popover.Portal>
        </Popover.Root>
      </Demo>

      <Demo label="Tooltip (wrapped in Provider)">
        <Tooltip.Provider>
          <Tooltip.Root>
            <Tooltip.Trigger render={<Button variant="ghost" />}>
              Hover me
            </Tooltip.Trigger>
            <Tooltip.Portal>
              <Tooltip.Positioner sideOffset={8}>
                <Tooltip.Popup>
                  Signs locally — never leaves your device.
                  <Tooltip.Arrow />
                </Tooltip.Popup>
              </Tooltip.Positioner>
            </Tooltip.Portal>
          </Tooltip.Root>
        </Tooltip.Provider>
      </Demo>

      <Demo label="PreviewCard">
        <PreviewCard.Root>
          <PreviewCard.Trigger
            render={<a href="#" style={{ textDecoration: "underline" }} />}
          >
            taAAA…AAMD
          </PreviewCard.Trigger>
          <PreviewCard.Portal>
            <PreviewCard.Positioner sideOffset={8}>
              <PreviewCard.Popup>
                <Body4>Account taAAA…AAMD — balance 12.4 ETH.</Body4>
                <PreviewCard.Arrow />
              </PreviewCard.Popup>
            </PreviewCard.Positioner>
          </PreviewCard.Portal>
        </PreviewCard.Root>
      </Demo>

      <Demo label="Combobox">
        <Combobox.Root items={CHAINS}>
          <Combobox.Input placeholder="Search chains…" />
          <Combobox.Portal>
            <Combobox.Positioner sideOffset={6}>
              <Combobox.Popup>
                <Combobox.Empty>No chains found.</Combobox.Empty>
                <Combobox.List>
                  {(item: string) => (
                    <Combobox.Item key={item} value={item}>
                      <Combobox.ItemIndicator>✓</Combobox.ItemIndicator>
                      {item}
                    </Combobox.Item>
                  )}
                </Combobox.List>
              </Combobox.Popup>
            </Combobox.Positioner>
          </Combobox.Portal>
        </Combobox.Root>
      </Demo>

      <Demo label="Autocomplete">
        <Autocomplete.Root items={CHAINS}>
          <Autocomplete.Input placeholder="Type a chain…" />
          <Autocomplete.Portal>
            <Autocomplete.Positioner sideOffset={6}>
              <Autocomplete.Popup>
                <Autocomplete.Empty>No matches.</Autocomplete.Empty>
                <Autocomplete.List>
                  {(item: string) => (
                    <Autocomplete.Item key={item} value={item}>
                      {item}
                    </Autocomplete.Item>
                  )}
                </Autocomplete.List>
              </Autocomplete.Popup>
            </Autocomplete.Positioner>
          </Autocomplete.Portal>
        </Autocomplete.Root>
      </Demo>

      <Demo label="Menu">
        <Menu.Root>
          <Menu.Trigger render={<Button variant="outline" />}>
            Actions
          </Menu.Trigger>
          <Menu.Portal>
            <Menu.Positioner sideOffset={6} align="start">
              <Menu.Popup>
                <Menu.Item>Duplicate</Menu.Item>
                <Menu.Item>Rename</Menu.Item>
                <Menu.Separator />
                <Menu.Group>
                  <Menu.GroupLabel>Danger</Menu.GroupLabel>
                  <Menu.Item>Delete</Menu.Item>
                </Menu.Group>
              </Menu.Popup>
            </Menu.Positioner>
          </Menu.Portal>
        </Menu.Root>
      </Demo>
    </Section>
  );
}

function NavSection() {
  return (
    <Section title="Navigation & Disclosure">
      <Demo label="Tabs">
        <div style={{ width: 420 }}>
          <Tabs.Root defaultValue="overview">
            <Tabs.List>
              <Tabs.Tab value="overview">Overview</Tabs.Tab>
              <Tabs.Tab value="specs">Specs</Tabs.Tab>
              <Tabs.Tab value="activity">Activity</Tabs.Tab>
              <Tabs.Indicator />
            </Tabs.List>
            <Tabs.Panel value="overview">
              <Body4>Overview panel content.</Body4>
            </Tabs.Panel>
            <Tabs.Panel value="specs">
              <Body4>Specs panel content.</Body4>
            </Tabs.Panel>
            <Tabs.Panel value="activity">
              <Body4>Activity panel content.</Body4>
            </Tabs.Panel>
          </Tabs.Root>
        </div>
      </Demo>

      <Demo label="Accordion">
        <div style={{ width: 420 }}>
          <Accordion.Root>
            <Accordion.Item>
              <Accordion.Header>
                <Accordion.Trigger>What is Thru?</Accordion.Trigger>
              </Accordion.Header>
              <Accordion.Panel>
                <Accordion.PanelInner>
                  A high-performance blockchain network.
                </Accordion.PanelInner>
              </Accordion.Panel>
            </Accordion.Item>
            <Accordion.Item>
              <Accordion.Header>
                <Accordion.Trigger>How do I connect?</Accordion.Trigger>
              </Accordion.Header>
              <Accordion.Panel>
                <Accordion.PanelInner>
                  Use the embedded wallet connect flow.
                </Accordion.PanelInner>
              </Accordion.Panel>
            </Accordion.Item>
          </Accordion.Root>
        </div>
      </Demo>

      <Demo label="Collapsible">
        <div style={{ width: 420 }}>
          <Collapsible.Root>
            <Collapsible.Trigger render={<Button variant="ghost" size="sm" />}>
              Toggle advanced
            </Collapsible.Trigger>
            <Collapsible.Panel>
              <Collapsible.Inner>
                <Body4>Advanced settings live here.</Body4>
              </Collapsible.Inner>
            </Collapsible.Panel>
          </Collapsible.Root>
        </div>
      </Demo>

      <Demo label="NavigationMenu">
        <NavigationMenu.Root>
          <NavigationMenu.List>
            <NavigationMenu.Item>
              <NavigationMenu.Trigger>Build</NavigationMenu.Trigger>
              <NavigationMenu.Content>
                <NavigationMenu.Link href="#">
                  <b>Docs</b>
                  <span>Read the guides</span>
                </NavigationMenu.Link>
                <NavigationMenu.Link href="#">
                  <b>SDK</b>
                  <span>TypeScript & Rust</span>
                </NavigationMenu.Link>
              </NavigationMenu.Content>
            </NavigationMenu.Item>
          </NavigationMenu.List>
          <NavigationMenu.Portal>
            <NavigationMenu.Positioner sideOffset={8}>
              <NavigationMenu.Popup>
                <NavigationMenu.Viewport />
              </NavigationMenu.Popup>
            </NavigationMenu.Positioner>
          </NavigationMenu.Portal>
        </NavigationMenu.Root>
      </Demo>

      <Demo label="ScrollArea">
        <ScrollArea.Root style={{ height: 120, width: 280 }}>
          <ScrollArea.Viewport style={{ height: 120 }}>
            <ScrollArea.Content>
              {Array.from({ length: 20 }).map((_, i) => (
                <Body4 key={i} as="div" style={{ padding: "4px 0" }}>
                  Row {i + 1}
                </Body4>
              ))}
            </ScrollArea.Content>
          </ScrollArea.Viewport>
          <ScrollArea.Scrollbar>
            <ScrollArea.Thumb />
          </ScrollArea.Scrollbar>
        </ScrollArea.Root>
      </Demo>

      <Demo label="Toolbar">
        <Toolbar.Root aria-label="Formatting">
          <Toolbar.Button render={<Button variant="ghost" size="sm" />}>
            Export
          </Toolbar.Button>
          <Toolbar.Button render={<Button variant="ghost" size="sm" />}>
            Share
          </Toolbar.Button>
          <Toolbar.Separator />
          <Toolbar.Link href="#">edited 51m ago</Toolbar.Link>
        </Toolbar.Root>
      </Demo>
    </Section>
  );
}

function DisplaySection() {
  return (
    <Section title="Display">
      <Demo label="Card — variants">
        <Card variant="default" style={{ padding: 16, width: 180 }}>
          <Ui3 as="div">Default</Ui3>
          <Body5>Token-driven surface.</Body5>
        </Card>
        <Card variant="elevated" style={{ padding: 16, width: 180 }}>
          <Ui3 as="div">Elevated</Ui3>
          <Body5>Raised surface.</Body5>
        </Card>
        <Card variant="outlined" style={{ padding: 16, width: 180 }}>
          <Ui3 as="div">Outlined</Ui3>
          <Body5>Bordered surface.</Body5>
        </Card>
      </Demo>

      <Demo label="Tag — tones">
        <Tag>neutral</Tag>
        <Tag tone="dark">dark</Tag>
        <Tag tone="brick">brick</Tag>
        <Tag tone="sky">sky</Tag>
        <Tag tone="grass">grass</Tag>
        <Tag tone="yellow">yellow</Tag>
      </Demo>

      <Demo label="Avatar">
        <Avatar.Root>
          <Avatar.Image src="https://i.pravatar.cc/64?img=12" />
          <Avatar.Fallback>LH</Avatar.Fallback>
        </Avatar.Root>
        <Avatar.Root>
          <Avatar.Fallback>TN</Avatar.Fallback>
        </Avatar.Root>
      </Demo>

      <Demo label="Progress">
        <div style={{ width: 280 }}>
          <Progress.Root value={62}>
            <Progress.Head>
              <Progress.Label>deploying</Progress.Label>
              <Progress.Value />
            </Progress.Head>
            <Progress.Track>
              <Progress.Indicator />
            </Progress.Track>
          </Progress.Root>
        </div>
      </Demo>

      <Demo label="Meter">
        <div style={{ width: 280 }}>
          <Meter.Root value={78}>
            <Meter.Head>
              <Meter.Label>blockspace used</Meter.Label>
              <Meter.Value />
            </Meter.Head>
            <Meter.Track>
              <Meter.Indicator />
            </Meter.Track>
          </Meter.Root>
        </div>
      </Demo>

      <Demo label="Separator">
        <div style={{ width: 280 }}>
          <Body4 as="div">Above</Body4>
          <Separator />
          <Body4 as="div">Below</Body4>
        </div>
        <div style={{ height: 40, display: "flex", alignItems: "center", gap: 12 }}>
          <span>A</span>
          <Separator orientation="vertical" />
          <span>B</span>
        </div>
      </Demo>

      <Demo label="Spinner">
        <Spinner />
        <Spinner tone="brick" style={{ width: 24, height: 24 }} />
      </Demo>

      <Demo label="Address — truncated identifier + copy">
        <Address value="tao8TehQg5gHlzh1IBzyzcgijDryHRbo-rAZ5N9UhIPh-s" />
        <Address value="tao8TehQg5gHlzh1IBzyzcgijDryHRbo-rAZ5N9UhIPh-s" href="#" />
        <Address value="tao8TehQg5gHlzh1IBzyzcgijDryHRbo-rAZ5N9UhIPh-s" display="thru.system" copy />
      </Demo>

      <Demo label="Timestamp">
        <Timestamp value={1719446400000} relative="2 minutes ago" copy />
        <Timestamp formatted="2026-06-29 00:00:00 UTC" />
      </Demo>

      <Demo label="Banner — wing bar">
        <div style={{ width: 280 }}>
          <Banner />
          <div style={{ height: 8 }} />
          <Banner height={6} slant={7} />
        </div>
      </Demo>

      <Demo label="Skeleton">
        <div style={{ display: "flex", flexDirection: "column", gap: 8, width: 280 }}>
          <Skeleton height={16} />
          <Skeleton height={16} width="70%" />
          <Skeleton height={32} width={32} />
        </div>
      </Demo>

      <Demo label="Detail — label / value rows">
        <div style={{ width: 280, display: "flex", flexDirection: "column", gap: 8 }}>
          <Detail label="balance">12.40 THRU</Detail>
          <Detail label="owner">
            <Address value="tao8TehQg5gHlzh1IBzyzcgijDryHRbo-rAZ5N9UhIPh-s" />
          </Detail>
          <Detail label="executable" stacked>yes</Detail>
        </div>
      </Demo>
    </Section>
  );
}

const TA_ADDRESS = "taAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAMD";

function WalletSection() {
  const [scheme, setScheme] = useState<ColorScheme>("light");
  const [preset, setPreset] = useState("50");
  const [fetching, setFetching] = useState<string | null>(null);
  const refetch = (k: string) => {
    setFetching(k);
    window.setTimeout(() => setFetching(null), 1400);
  };

  return (
    <Section title="Wallet">
      <Demo label="Disc">
        <Disc size="small" color={chainMeta(1).color} glyph="Ξ" />
        <Disc size="medium" color={chainMeta(8453).color} glyph="B" />
        <Disc size="large" color={tokenMeta("WBTC").color} glyph="₿" border />
      </Demo>

      <Demo label="ChainIcon / TokenIcon">
        <ChainIcon chainId={1} />
        <ChainIcon chainId={8453} />
        <ChainIcon chainId={137} />
        <TokenIcon symbol="USDC" />
        <TokenIcon symbol="WBTC" />
        <TokenIcon symbol="USDT" />
      </Demo>

      <Demo label="ButtonArea">
        <ButtonArea onClick={() => {}}>Plain action</ButtonArea>
        <ButtonArea filled onClick={() => {}}>
          Filled action
        </ButtonArea>
      </Demo>

      <Demo label="CopyButton">
        <CopyButton value={TA_ADDRESS} variant="primary" label="Copy" />
        <CopyButton
          value={TA_ADDRESS}
          variant="outline"
          label={{ normal: "Copy address", copied: "Copied!" }}
        />
        <CopyButton value={TA_ADDRESS} text label="taAAAA…AAMD" />
      </Demo>

      <Demo label="Spacer (between two boxes)">
        <div style={{ display: "flex" }}>
          <Tag>left</Tag>
          <Spacer size={24} orientation="horizontal" />
          <Tag>right</Tag>
        </div>
      </Demo>

      <Demo label="ShowAfter (fades in after 300ms)">
        <ShowAfter delay={300}>
          <Tag tone="grass">visible</Tag>
        </ShowAfter>
      </Demo>

      <Demo label="ThemeSwitch">
        <ThemeSwitch colorScheme={scheme} onChange={setScheme} />
        <Ui4>current: {scheme}</Ui4>
      </Demo>

      <Demo label="Balance (click the amount to refresh → spinner)">
        <div style={{ width: 360, display: "flex", flexDirection: "column", gap: 8 }}>
          <Balance tokenSymbol="ETH" tokenName="Ether" chainId={42161} amountFiat="$1,284.50" fetching={fetching === "a"} onRefetch={() => refetch("a")} />
          <Balance tokenSymbol="WBTC" tokenName="Wrapped BTC" chainId={137} amountFiat="$642.10" fetching={fetching === "b"} onRefetch={() => refetch("b")} />
          <Balance tokenSymbol="USDT" tokenName="Tether" chainId={8453} amountFiat="$0.00" warn fetching={fetching === "c"} onRefetch={() => refetch("c")} />
        </div>
      </Demo>

      <Demo label="ChainsPath">
        <ChainsPath chains={[chainMeta(1)]} />
        <ChainsPath chains={[chainMeta(8453), chainMeta(1)]} />
      </Demo>

      <Demo label="Details">
        <div style={{ width: 320 }}>
          <Details label="Show transaction details">
            <Details.Item label="Status" value="Confirmed" />
            <Details.Item label="Network fee" value="$1.24" />
            <Details.Item label="Total" value="$1,235.80" />
          </Details>
        </div>
      </Demo>

      <Demo label="Deposit">
        <div style={{ width: 320 }}>
          <Deposit address={TA_ADDRESS} seed={42} />
        </div>
      </Demo>

      <Demo label="PresetsInput">
        <div style={{ width: 320 }}>
          <PresetsInput
            presets={[
              { label: "$10", value: "10" },
              { label: "$50", value: "50" },
              { label: "$100", value: "100" },
            ]}
            value={preset}
            onValueChange={setPreset}
            max="Max: $5,000"
          />
        </div>
      </Demo>

      <Demo label="Frame + Screen (composed wallet surface)">
        <div style={{ width: 380 }}>
          <Frame
            mode="dialog"
            site={{ label: "app.thru.org", verified: true, tag: "mainnet" }}
            onClose={() => {}}
          >
            <Screen
              bottomAction={{ label: "Continue", onClick: () => {} }}
            >
              <Screen.Header
                title="Send funds"
                content="Choose an amount and destination."
              />
              <ChainsPath chains={[chainMeta(1)]} />
            </Screen>
          </Frame>
        </div>
      </Demo>
    </Section>
  );
}

function TypographySection() {
  return (
    <Section title="Typography">
      <Demo label="Headings">
        <div style={{ display: "grid", gap: 6 }}>
          <Heading1>Heading 1</Heading1>
          <Heading2>Heading 2</Heading2>
          <Heading3>Heading 3</Heading3>
          <Heading4>Heading 4</Heading4>
          <Heading5>Heading 5</Heading5>
        </div>
      </Demo>
      <Demo label="Body">
        <div style={{ display: "grid", gap: 6 }}>
          <Body1>Body 1 — the quick brown fox.</Body1>
          <Body3>Body 3 — the quick brown fox.</Body3>
          <Body4>Body 4 — the quick brown fox.</Body4>
          <Body5>Body 5 — the quick brown fox.</Body5>
        </div>
      </Demo>
      <Demo label="UI & Button label">
        <div style={{ display: "grid", gap: 6 }}>
          <Ui1>Ui 1</Ui1>
          <Ui2>Ui 2</Ui2>
          <Ui3>Ui 3</Ui3>
          <Ui4>Ui 4</Ui4>
          <Ui5>Ui 5</Ui5>
          <Button1>Button 1 label</Button1>
        </div>
      </Demo>
    </Section>
  );
}

/* ---- app --------------------------------------------------------------- */

function ToastDemo() {
  const toast = Toast.useToast();
  const fire = (kind: "success" | "error" | "info" | "warn", title: string, description: string) =>
    toast.add({ title, description, timeout: 5000, data: { kind } });
  return (
    <Section title="Toast">
      <Demo label="by kind (signal accent + timeout bar)">
        <Button size="sm" onClick={() => fire("success", "Transaction confirmed", "taAAA…AAQE · block 1,900,312")}>Success</Button>
        <Button size="sm" onClick={() => fire("error", "Transaction reverted", "require(amount > 0) failed")}>Error</Button>
        <Button size="sm" onClick={() => fire("info", "Switched network", "Now on Base Sepolia")}>Info</Button>
        <Button size="sm" onClick={() => fire("warn", "Low balance", "Under 0.01 ETH for gas")}>Warn</Button>
      </Demo>
      <Demo label="Text / Paragraph">
        <Text variant="ui4">Text variant=ui4 (mono)</Text>
        <Paragraph>Paragraph — the default body copy (type-body-3, renders a p).</Paragraph>
      </Demo>
    </Section>
  );
}

export function App() {
  return (
    <Toast.Provider>
      <main
        style={{
          maxWidth: 960,
          margin: "0 auto",
          padding: "48px 24px 120px",
        }}
      >
        <header style={{ marginBottom: 48 }}>
          <Heading1>@thru/design — Visual QA Gallery</Heading1>
          <Body3 style={{ opacity: 0.7, marginTop: 8 }}>
            Every component exported from{" "}
            <code>@thru/design/web</code>, grouped by section.
          </Body3>
        </header>

        <ActionsSection />
        <FormsSection />
        <OverlaysSection />
        <NavSection />
        <DisplaySection />
        <WalletSection />
        <TypographySection />
        <ToastDemo />
      </main>
      <Toast.Viewport />
    </Toast.Provider>
  );
}
