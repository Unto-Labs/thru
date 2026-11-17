# {{PROJECT_NAME}}

A Thru blockchain program written in C.

## Prerequisites

- Thru C SDK installed at `~/.thru/sdk/c/`
- Thru toolchain installed at `~/.thru/sdk/toolchain/`

You can install these using:
```bash
thru dev toolchain install
thru dev sdk install c
```

## Building

To build the program:

```bash
make -j
```

The compiled program will be output to:
```
build/thruvm/bin/{{PROGRAM_NAME}}_c.bin
```

## Project Structure

```
{{PROJECT_NAME}}/
├── GNUmakefile          # Main build configuration
├── README.md            # This file
├── .gitignore           # Git ignore rules
└── examples/
    ├── Local.mk         # Build rules for programs
    └── {{PROGRAM_NAME}}.c  # Program source code
```

## Accounts

The template owns no accounts. If you add one, byte 0 of its data is a
one-byte `account_type` discriminator: one value per account layout,
starting at 1 (0 is invalid). A changed layout takes the next unused value;
values are never reused. Write the byte on create and check the owner and
the byte on every load. Your ABI's account root is `account_type: u8`
followed by a payload enum keyed on it. See
https://thru.org/docs/abi/authoring-guide/#program-accounts

## Deploying

To deploy your program to the Thru blockchain, use the `thru` tools:

```bash
# Upload the program
thru uploader upload <seed> build/thruvm/bin/{{PROGRAM_NAME}}_c.bin

# Create a managed program with its ABI (or pass --dangerously-exclude-abi)
thru program create <seed> build/thruvm/bin/{{PROGRAM_NAME}}_c.bin --abi <program>.abi.yaml
```

## Development

Edit `examples/{{PROGRAM_NAME}}.c` to modify your program logic.

For more information on the Thru C SDK, see the SDK documentation at:
https://docs.thru.org/program-development/setting-up-thru-devkit

## License

See the main Thru network repository for license information.
