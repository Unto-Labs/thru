# {{PROJECT_NAME}}

A Thru blockchain program written in C.

## Prerequisites

- Thru C SDK installed at `~/.thru/sdk/c/`
- Thru toolchain installed at `~/.thru/sdk/toolchain/`

You can install these using:
```bash
thru-cli dev toolchain install
thru-cli dev sdk install c
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

## Deploying

To deploy your program to the Thru blockchain, use the thru-cli tools:

```bash
# Upload the program
thru-cli uploader upload <seed> build/thruvm/bin/{{PROGRAM_NAME}}_c.bin

# Create a managed program
thru-cli program create <seed> build/thruvm/bin/{{PROGRAM_NAME}}_c.bin
```

## Development

Edit `examples/{{PROGRAM_NAME}}.c` to modify your program logic.

For more information on the Thru C SDK, see the SDK documentation at:
https://docs.thru.org/program-development/setting-up-thru-devkit

## License

See the main Thru network repository for license information.
